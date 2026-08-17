/**
 * `factory autonomy <ensure|status|preflight>` — autonomous-mode relaunch, inline-settings form.
 *
 * v1.47 (Slice 6, spike-gated): the merged settings are built IN MEMORY and passed
 * to `claude` as ONE inline `--settings <json>` argument — nothing is written to
 * disk, so the old `${CLAUDE_PLUGIN_DATA}/merged-settings.json` artifact (atomic
 * write, `FACTORY_SETTINGS_HASH` content stamp, staleness state machine) is gone.
 * The 2026-08-17 live spike (Claude Code 2.1.233) chose the inline-settings
 * FALLBACK branch over native `--permission-mode auto`: auto-mode classification
 * is probabilistic (a pipeline op — `gh issue close` — stayed blocked despite an
 * `autoMode.allow` entry, and an out-of-root write was approved), while inline
 * settings preserved every control: env export, the `.claude/` guard hook firing
 * under the session, deterministic deny rules, data-dir access, statusLine
 * chaining. See the Decision 13/17/31/65/67 amendment in
 * docs/explanation/decisions.md for the full spike record.
 *
 * What is PRESERVED from the merged-settings era (all in-memory now):
 *   - template + user-settings merge semantics ({@link materializeMergedSettings}):
 *     user settings as base, template overlay, env union with
 *     `CLAUDE_PLUGIN_DATA` baked, permissions.allow union, statusLine chaining
 *     via `FACTORY_ORIGINAL_STATUSLINE`;
 *   - placeholder substitution ({@link substitutePlaceholders});
 *   - the `ci-raw-env` path: `FACTORY_AUTONOMOUS_MODE=1` exported directly (CI)
 *     satisfies the gate with no settings involved at all.
 *
 * The relaunch is a typed {@link RelaunchSpec} (`executable` + readonly argv)
 * rendered to a paste-able shell command by ONE audited POSIX renderer
 * ({@link renderPosixCommand}); the settings JSON is exactly one argv element.
 *
 * The real security boundary stays the path-resolving hook dispatcher
 * (branch-protection, secret-guard, pipeline-guards, holdout-guard,
 * write-protection); `permissions.deny` is deliberately short — accident
 * prevention for a non-adversarial agent, not a containment boundary (Decision 65).
 */
import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {homedir} from 'node:os'

import type {ExitCode} from '../../shared/exit-codes.js'
import {EXIT} from '../../shared/exit-codes.js'
import {parseArgs} from '../args.js'
import {emitError, emitHelp} from '../io.js'
import {resolveDataDir, resolvePluginRoot} from '../../config/index.js'
import {isAutonomous} from '../../autonomy/mode.js'
import {stringifyJson} from '../../shared/json.js'
import {createLogger} from '../../shared/logging.js'
import {tildeShorten} from '../../shared/paths.js'
import {withUsageGuard, type Subcommand} from '../registry-types.js'

const log = createLogger('autonomy')

const HELP = `factory autonomy <ensure|status|preflight> — manage / inspect autonomous mode

The pipeline runs unattended: \`run create\`/\`run resume\` HALT unless the session
is autonomous (FACTORY_AUTONOMOUS_MODE=1). There is no opt-out.

ensure     Builds the autonomous settings in memory (templates/settings.autonomous.json
           merged with your existing settings — placeholders substituted, env baked,
           statusLine wired to \`factory statusline\`) and prints the relaunch command,
           with the settings passed inline as one --settings argument. Nothing is
           written to disk.

status     Reports whether THIS session is autonomous (FACTORY_AUTONOMOUS_MODE=1).
           Exits 0 when autonomous, 1 when not (never throws).

preflight  The run-entry check (what \`/factory:run\` calls). Two states: the session
           is autonomous → proceed (exit 0); it is not → print the inline-settings
           relaunch command and halt (exit 1). A directly-exported
           FACTORY_AUTONOMOUS_MODE=1 (CI / raw env) satisfies the gate with no
           settings involved. Never throws on the decision path.

Usage:
  factory autonomy ensure
  factory autonomy status [--json]
  factory autonomy preflight

Options:
  --user-settings <path>   (ensure / preflight) Override the user-settings source (default: ~/.claude/settings.json)
  --json                   (status) Emit machine-readable JSON`

/**
 * The `factory` bundle entrypoint (the PATH shim onto the CLI bundle). The
 * statusLine WRITER the template wires is `<this> statusline`; the ownership check
 * below compares a user statusLine's first token against this path, so deriving it
 * here (not by re-splitting a constructed command string) keeps the two in step.
 */
function factoryBinPath(pluginRoot: string): string {
    return `${pluginRoot}/bin/factory`
}

/** Expand a leading `~` in a user command to the absolute `$HOME` path. */
function tildeExpand(value: string, home: string): string {
    if (value.startsWith('~')) {
        return home + value.slice(1)
    }
    return value
}

/**
 * Recursively substitute the three plugin placeholders in every string of a
 * JSON value (the `walk()` the old jq did). ORDER MATTERS: `_DATA_TILDE` is
 * replaced before `_DATA` so the longer token is not partially consumed.
 */
export function substitutePlaceholders(
    value: unknown,
    vars: {pluginRoot: string; dataDir: string; dataDirTilde: string}
): unknown {
    if (typeof value === 'string') {
        return value
            .split('${CLAUDE_PLUGIN_ROOT}')
            .join(vars.pluginRoot)
            .split('${CLAUDE_PLUGIN_DATA_TILDE}')
            .join(vars.dataDirTilde)
            .split('${CLAUDE_PLUGIN_DATA}')
            .join(vars.dataDir)
    }
    if (Array.isArray(value)) {
        return value.map((v) => substitutePlaceholders(v, vars))
    }
    if (typeof value === 'object' && value !== null) {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value)) {
            out[k] = substitutePlaceholders(v, vars)
        }
        return out
    }
    return value
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Read `.statusLine.command` from a settings object, if present and a string. */
function statusLineCommandOf(settings: Record<string, unknown>): string | undefined {
    const sl = settings.statusLine
    if (!isObject(sl)) {
        return undefined
    }
    const cmd = sl.command
    return typeof cmd === 'string' && cmd.length > 0 ? cmd : undefined
}

/** Inputs to {@link materializeMergedSettings}. */
export interface MaterializeInput {
    /** The raw `templates/settings.autonomous.json` text. */
    readonly template: string
    /** The user's existing settings object (or `{}` when none / unparseable). */
    readonly userSettings: Record<string, unknown>
    /** Resolved `$CLAUDE_PLUGIN_DATA` (real value). */
    readonly dataDir: string
    /** Resolved `$CLAUDE_PLUGIN_ROOT` (real value). */
    readonly pluginRoot: string
    /** `$HOME` for the `~`-shortened DATA_TILDE form + statusline expansion. */
    readonly home: string
}

/**
 * Build the merged settings object: user settings as the base, the
 * placeholder-substituted template overlaid (permissions/env/statusLine/hooks),
 * `env.CLAUDE_PLUGIN_DATA` baked, and the user's own statusLine chained via
 * `env.FACTORY_ORIGINAL_STATUSLINE`. Pure — no IO. In-memory only since v1.47:
 * the result becomes the inline `--settings` argument, never a file.
 */
export function materializeMergedSettings(input: MaterializeInput): Record<string, unknown> {
    const {dataDir, pluginRoot, home} = input

    const parsedTemplate: unknown = JSON.parse(input.template)
    if (!isObject(parsedTemplate)) {
        throw new Error('autonomy: settings.autonomous.json is not a JSON object')
    }
    const template = substitutePlaceholders(parsedTemplate, {
        pluginRoot,
        dataDir,
        dataDirTilde: tildeShorten(dataDir, home),
    }) as Record<string, unknown>

    // User settings is the base; template keys overlay it (template wins on
    // conflicts — autonomous mode's permissions/hooks/statusLine must take effect).
    // NOTE: a top-level `hooks` in the template REPLACES the user's `hooks` (object
    // spread is shallow). That is intentional and NOT a security regression: the
    // factory's enforcement hooks load independently via `hooks/hooks.json` (the
    // plugin's own hook wiring), so the guard boundary holds regardless of what the
    // inline settings carry. The template's `hooks` here only configures the
    // autonomous *session*, not the enforcement layer.
    const merged: Record<string, unknown> = {...input.userSettings, ...template}

    // env: union user + template, then bake CLAUDE_PLUGIN_DATA. Both user and
    // template envs are preserved (template wins on key conflicts) so the pin and
    // FACTORY_AUTONOMOUS_MODE always survive.
    const userEnv = isObject(input.userSettings.env) ? input.userSettings.env : {}
    const templateEnv = isObject(template.env) ? template.env : {}
    const env: Record<string, unknown> = {...userEnv, ...templateEnv}
    env.CLAUDE_PLUGIN_DATA = dataDir

    // permissions.allow: union user + template (deny/other keys: template wins).
    const userPerms = isObject(input.userSettings.permissions) ? input.userSettings.permissions : {}
    const templatePerms = isObject(template.permissions) ? template.permissions : {}
    const userAllow = Array.isArray(userPerms.allow)
        ? userPerms.allow.filter((e): e is string => typeof e === 'string')
        : []
    const templateAllow = Array.isArray(templatePerms.allow)
        ? templatePerms.allow.filter((e): e is string => typeof e === 'string')
        : []
    const unionedAllow = [...userAllow, ...templateAllow.filter((e) => !userAllow.includes(e))]
    merged.permissions = {...userPerms, ...templatePerms, allow: unionedAllow}

    // statusLine chaining: if the user has their OWN statusLine that is NOT the
    // factory writer, preserve it via FACTORY_ORIGINAL_STATUSLINE (tilde-expanded)
    // so `factory statusline` chains to it. The template's statusLine (the factory
    // writer) always wins as the displayed command.
    const ourPath = factoryBinPath(pluginRoot) // ".../bin/factory"
    const userStatusLine = statusLineCommandOf(input.userSettings)
    // Resolve the user's OWN (non-factory) statusLine to chain, if any.
    const chained = ((): string | undefined => {
        if (userStatusLine === undefined) {
            return undefined
        }
        const expanded = tildeExpand(userStatusLine, home)
        const parts = expanded.split(/\s+/)
        const expandedPath = parts[0] ?? expanded
        const expandedSub = parts[1]
        // "Ours" = the factory statusline WRITER specifically: the `.../bin/factory`
        // path with the `statusline` subcommand. TIGHTENED (was a path-only compare,
        // which mis-claimed any `.../bin/factory <other-subcommand>` as ours): a user
        // who wired some OTHER factory subcommand as their statusLine must still be
        // chained — only the writer itself is skipped, to avoid a self-referential loop.
        const isOurs = expandedPath === ourPath && expandedSub === 'statusline'
        return isOurs ? undefined : expanded
    })()
    // Set the chained original, or DROP a stale one. The env block is seeded from the
    // user's own env (`{...userEnv, ...templateEnv}`), so a FACTORY_ORIGINAL_STATUSLINE
    // left over from a PRIOR autonomous relaunch can ride along; when there is nothing
    // legitimate to chain (no user statusLine, or it IS our writer) it must be deleted,
    // else `factory statusline` would chain to a phantom command — or to itself.
    if (chained !== undefined) {
        env.FACTORY_ORIGINAL_STATUSLINE = chained
    } else {
        delete env.FACTORY_ORIGINAL_STATUSLINE
    }

    // A FACTORY_SETTINGS_HASH inherited from a pre-v1.47 merged-settings relaunch is
    // dead weight (the staleness machinery is gone) — drop it rather than re-export it.
    delete env.FACTORY_SETTINGS_HASH

    merged.env = env

    return merged
}

/** Best-effort read of a user settings.json: missing / unparseable / non-object → `{}`. */
async function readUserSettings(path: string): Promise<Record<string, unknown>> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- user-settings path from CLI flag or the fixed ~/.claude default, read-only
    if (!existsSync(path)) {
        return {}
    }
    try {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path as above
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (isObject(parsed)) {
            return parsed
        }
        log.warn(`${path} is not a JSON object; ignoring`)
    } catch (err) {
        log.warn(`could not parse ${path} (${(err as Error).message}); ignoring`)
    }
    return {}
}

/**
 * A relaunch as data: the executable and its exact argv, unrendered. The settings
 * JSON is exactly one argv element (`--settings` value) — no shell parsing ever
 * splits it.
 */
export interface RelaunchSpec {
    readonly executable: string
    readonly argv: readonly string[]
}

/**
 * THE one audited shell renderer: each token single-quoted for POSIX sh, embedded
 * single quotes escaped as `'\''`. Single quotes suppress every other shell
 * metacharacter (spaces, `$`, `;`, backticks, newlines), so this is total.
 */
export function renderPosixCommand(spec: RelaunchSpec): string {
    const quote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`
    return [spec.executable, ...spec.argv].map(quote).join(' ')
}

/** Build the relaunch spec for a materialized settings object. */
export function buildRelaunchSpec(settings: Record<string, unknown>): RelaunchSpec {
    return {
        executable: 'claude',
        argv: ['--worktree', '--settings', JSON.stringify(settings)],
    }
}

/** Options for {@link runAutonomyEnsure}; all paths injectable for tests. */
export interface AutonomyEnsureOptions {
    /** Resolved data dir (defaults to {@link resolveDataDir}). */
    readonly dataDir?: string
    /** Resolved plugin root (defaults to {@link resolvePluginRoot}). */
    readonly pluginRoot?: string
    /** User-settings source path (defaults to `~/.claude/settings.json`). */
    readonly userSettingsPath?: string | undefined
    /** `$HOME` (defaults to os.homedir()). */
    readonly home?: string
    /** stdout sink (defaults to process.stdout). */
    readonly writeStdout?: (text: string) => void
}

/** Result of {@link runAutonomyEnsure}: the relaunch as structured data + rendered command. */
export interface AutonomyEnsureResult {
    /** The typed relaunch (executable + exact argv; settings JSON is one argv element). */
    readonly spec: RelaunchSpec
    /** The POSIX-rendered command printed to stdout. */
    readonly relaunchCommand: string
}

/**
 * Build the autonomous settings in memory and print the inline-settings relaunch
 * command. Reads the user's settings (missing/unparseable → `{}`) and the
 * template; writes NOTHING to disk.
 */
export async function runAutonomyEnsure(opts: AutonomyEnsureOptions = {}): Promise<AutonomyEnsureResult> {
    const home = opts.home ?? homedir()
    const dataDir = opts.dataDir ?? resolveDataDir()
    const pluginRoot = opts.pluginRoot ?? resolvePluginRoot()
    const userSettingsPath = opts.userSettingsPath ?? join(home, '.claude', 'settings.json')
    const write = opts.writeStdout ?? ((t: string) => process.stdout.write(t))

    const userSettings = await readUserSettings(userSettingsPath)

    // Read the template from the plugin install.
    const templatePath = join(pluginRoot, 'templates', 'settings.autonomous.json')
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed template path under the resolved plugin root
    const template = await readFile(templatePath, 'utf8')

    const merged = materializeMergedSettings({template, userSettings, dataDir, pluginRoot, home})
    const spec = buildRelaunchSpec(merged)
    const relaunchCommand = renderPosixCommand(spec)

    write(
        `Relaunch the session in autonomous mode with (settings passed inline — nothing written to disk):\n\n` +
            `  ${relaunchCommand}\n\n` +
            `(the first agent turn refreshes the usage cache → session-mode quota pacing.)\n`
    )

    return {spec, relaunchCommand}
}

/** Machine-readable autonomy status (the `--json` payload). BREAKING in v1.47: the
 * `mergedSettingsPresent` / `mergedSettingsPath` fields are gone with the artifact. */
export interface AutonomyStatus {
    /** The gate predicate: FACTORY_AUTONOMOUS_MODE === "1". */
    readonly autonomous: boolean
    /** Whether the env var is present at all (distinguishes "unset" from "wrong value"). */
    readonly envSet: boolean
}

/** Options for {@link runAutonomyStatus}; injectable for tests. */
export interface AutonomyStatusOptions {
    readonly env?: NodeJS.ProcessEnv
    readonly json?: boolean
    readonly writeStdout?: (text: string) => void
}

/**
 * Report whether the current session is autonomous. Exits 0 when autonomous, 1
 * when not — and NEVER throws, because this is the diagnostic the user runs
 * precisely WHEN the mandatory gate has halted them.
 */
export function runAutonomyStatus(opts: AutonomyStatusOptions = {}): Promise<ExitCode> {
    const env = opts.env ?? process.env
    const write = opts.writeStdout ?? ((t: string) => process.stdout.write(t))

    const status: AutonomyStatus = {
        autonomous: isAutonomous(env),
        envSet: env.FACTORY_AUTONOMOUS_MODE !== undefined,
    }

    if (opts.json === true) {
        write(stringifyJson(status) + '\n')
    } else if (status.autonomous) {
        write('autonomous: yes (FACTORY_AUTONOMOUS_MODE=1)\n')
    } else {
        write(
            `autonomous: NO — the pipeline will refuse to start or resume a run.\n` +
                `Run \`factory autonomy ensure\` and relaunch with the printed command.\n`
        )
    }

    return Promise.resolve(status.autonomous ? EXIT.OK : EXIT.ERROR)
}

/**
 * The run-entry preflight verdict — two states since v1.47 (the staleness state
 * machine died with the on-disk artifact): the session is autonomous (however the
 * env got set — inline-settings relaunch or a directly-exported CI env) → ready;
 * it is not → here is the relaunch.
 */
export type AutonomyPreflightResult =
    | {readonly state: 'ready'}
    | {readonly state: 'relaunch'; readonly spec: RelaunchSpec; readonly relaunchCommand: string}

/** Options for {@link runAutonomyPreflight}; injectable for tests. */
export interface AutonomyPreflightOptions {
    readonly dataDir?: string
    readonly pluginRoot?: string
    readonly userSettingsPath?: string | undefined
    readonly home?: string
    readonly env?: NodeJS.ProcessEnv
    readonly writeStdout?: (text: string) => void
}

/**
 * Pure-ish half of preflight: decide over the env alone. `ready` when the session
 * is autonomous; `relaunch` (with the built spec) when it is not. Throws only if
 * the ensure build itself fails — the CLI wrapper degrades that to a message.
 */
export async function evaluateAutonomyPreflight(opts: AutonomyPreflightOptions = {}): Promise<AutonomyPreflightResult> {
    const env = opts.env ?? process.env
    if (isAutonomous(env)) {
        return {state: 'ready'}
    }
    const ensured = await runAutonomyEnsure({
        ...(opts.dataDir !== undefined ? {dataDir: opts.dataDir} : {}),
        ...(opts.pluginRoot !== undefined ? {pluginRoot: opts.pluginRoot} : {}),
        ...(opts.home !== undefined ? {home: opts.home} : {}),
        userSettingsPath: opts.userSettingsPath,
        writeStdout: opts.writeStdout ?? ((): void => undefined),
    })
    return {state: 'relaunch', spec: ensured.spec, relaunchCommand: ensured.relaunchCommand}
}

/**
 * The run-entry check (`/factory:run` calls this): autonomous → proceed;
 * otherwise print the inline-settings relaunch command and halt. Infallible on
 * the decision path — an unresolvable data/root dir or template degrades to a
 * halt-with-message rather than a throw. Returns `EXIT.OK` to proceed,
 * `EXIT.ERROR` to halt.
 */
export async function runAutonomyPreflight(opts: AutonomyPreflightOptions = {}): Promise<ExitCode> {
    const write = opts.writeStdout ?? ((t: string) => process.stdout.write(t))

    let result: AutonomyPreflightResult
    try {
        result = await evaluateAutonomyPreflight({...opts, writeStdout: write})
    } catch (err) {
        write(
            `HALT: this session is not autonomous, and the relaunch settings could not be built ` +
                `(${(err as Error).message}) — run \`factory autonomy ensure\` once the environment ` +
                'is set, then relaunch with the printed command.\n'
        )
        return EXIT.ERROR
    }

    if (result.state === 'ready') {
        write('OK: autonomous mode ready (FACTORY_AUTONOMOUS_MODE=1).\n')
        return EXIT.OK
    }
    write('\nHALT: this session is not autonomous — relaunch to continue (command above).\n')
    return EXIT.ERROR
}

async function run(argv: string[]): Promise<ExitCode> {
    const args = parseArgs(argv, {booleans: ['json']})
    if (args.flag('help') === true) {
        return emitHelp(HELP)
    }

    // Verbs: `ensure` (default) prints the inline-settings relaunch; `status`
    // reports + exits 0/1; `preflight` decides + halts when needed (the run-entry call).
    const verb = args.positionals[0]
    if (verb === 'status') {
        return runAutonomyStatus({json: args.flag('json') === true})
    }
    const userSettings = args.flag('user-settings')
    if (verb === 'preflight') {
        return runAutonomyPreflight({
            userSettingsPath: typeof userSettings === 'string' ? userSettings : undefined,
        })
    }
    if (verb !== undefined && verb !== 'ensure') {
        emitError(`autonomy: unknown verb '${verb}' (expected: ensure | status | preflight)`)
        return EXIT.USAGE
    }

    await runAutonomyEnsure({
        userSettingsPath: typeof userSettings === 'string' ? userSettings : undefined,
    })
    return EXIT.OK
}

export const autonomyCommand: Subcommand = {
    describe: 'Print the inline-settings autonomous relaunch command',
    run: withUsageGuard('autonomy', run),
}
