/**
 * E1 (F-perm) — TARGET-repo `.claude/settings.json` + `.claude/settings.local.json`
 * emit + idempotent merge (Decision 17, corrected).
 *
 * `factory scaffold` calls {@link ensureTargetSettings} so an interactive
 * `/factory:run` in the scaffolded repo runs the CLI + agents WITHOUT a
 * permission prompt per call. It writes (or non-destructively MERGES into) TWO
 * files, split by what is safe to commit:
 *   - `.claude/settings.json` (COMMITTED): unions {@link FACTORY_TARGET_BASE_ALLOWLIST}
 *     + the baked, TILDE-form data-dir allow globs (from {@link buildTargetDataDirRules})
 *     into `permissions.allow`, and forces `worktree.baseRef: "head"` (the
 *     staging-determinism invariant — CLAUDE.md "Worktree base invariant",
 *     Decision 12). Carries NO `additionalDirectories` — see below.
 *   - `.claude/settings.local.json` (GITIGNORED, per-machine): the factory-managed
 *     `permissions.additionalDirectories` entry, ALWAYS ABSOLUTE. Claude Code does
 *     not expand `~/` there (verified live: the tilde form left the
 *     working-directory-boundary prompt firing on task-worktree writes,
 *     run-20260630-095544), so this entry necessarily leaks `$HOME`/username and
 *     is wrong on any other machine/CI — it must never land in the committed file.
 * Both merges leave every other user key — including the user's OWN `statusLine`
 * — untouched.
 *
 * Why NO statusLine here (deliberate trade-off): the target repo's
 * `.claude/settings.json` is the user's interactive settings for that repo.
 * Injecting `statusLine` would clobber their own statusline. The factory
 * statusline (usage-cache pacing) belongs ONLY in the separate E2
 * inline-settings relaunch (`factory autonomy ensure`), never here.
 *
 * Why this allow-list and not autonomous-mode's coarse `Bash(*)`: this is an
 * INTERACTIVE session with a human present (Decision 17 "Scope"). We grant the
 * concrete command families the pipeline genuinely invokes — the `factory` CLI,
 * git/gh plumbing, the agent tools, and the data-dir reads/writes — and nothing
 * wider. The autonomous-mode deny-list / `Bash(*)` is intentionally NOT mirrored
 * here; a human approves anything the pipeline didn't anticipate.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs seam: paths are internal derived run/spec/state/repo paths, never external input; runtime write-danger is covered by the TCB write-deny hook */
import {mkdir, readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {join} from 'node:path'

import {atomicWriteFile} from '../../shared/atomic-write.js'
import {stringifyJson} from '../../shared/json.js'
import {createLogger} from '../../shared/logging.js'
import {tildeShorten} from '../../shared/paths.js'

const log = createLogger('cli:target-settings')

/**
 * The data-dir-INDEPENDENT half of the permission allow-list an interactive
 * factory run needs in the TARGET repo. Each entry maps to a concrete pipeline
 * action:
 *
 *   - `Bash(factory:*)`        — the runner shells `factory next-task/next-action/…`.
 *   - `Bash(git:*)` / `Bash(gh:*)` — preflight `git rev-parse`, reviewer
 *                                 `git -C <wt> diff`, scaffold's `gh repo view`,
 *                                 plus producers' commit/branch plumbing.
 *   - `Bash(npm:*)` / `Bash(npx:*)` — test-writer/implementer run the project
 *                                 test runner + the GateRunner's npm/npx tools.
 *   - `Read`/`Write`/`Edit`/`Grep`/`Glob`/`Agent` — the agent tools every
 *                                 producer + reviewer (and the runner's
 *                                 Agent() spawns) use.
 *
 * The data-dir-SCOPED rules (`Read|Edit(<data-dir>/**)`) are NOT here —
 * they are baked per-install from the CLI-resolved data dir by
 * {@link buildTargetDataDirRules} (see below for why).
 */
export const FACTORY_TARGET_BASE_ALLOWLIST: readonly string[] = [
    'Bash(factory:*)',
    'Bash(git:*)',
    'Bash(gh:*)',
    'Bash(npm:*)',
    'Bash(npx:*)',
    'Read',
    'Write',
    'Edit',
    'Grep',
    'Glob',
    'Agent',
]

/**
 * The verbs scoped to the data dir in the baked `Read|Edit(<dir>/**)` rules.
 * No `Write`: Claude Code's file permission checks match only `Edit(path)` rules
 * (they cover ALL file-editing tools); a path-form `Write(...)` rule is dead and
 * triggers a session-start warning.
 */
const DATA_DIR_VERBS = ['Read', 'Edit'] as const

/** Path-form `Write(...)` rules — dead (see {@link DATA_DIR_VERBS}), stripped on merge. */
const DEAD_WRITE_RULE = /^Write\(.+\)$/

/**
 * The baked, per-install data-dir permission strings. Built from the CLI-resolved
 * canonical data dir (which already CORRECTS the foreign-plugin env-var leak via
 * `resolveDataDir`), NOT from the runtime `${CLAUDE_PLUGIN_DATA}` placeholder — so
 * the rules keep matching even when another plugin has hijacked the env var.
 */
export interface TargetDataDirRules {
    /**
     * Base path for the `Read|Edit(<base>/**)` allow globs. The `~`-tilde
     * form when the data dir is under `$HOME` (git-safe in a committed
     * `.claude/settings.json` — no username leaked; Claude Code expands `~/` in
     * Read/Write/Edit globs), else the absolute path.
     */
    readonly allowGlobBase: string
    /**
     * The `permissions.additionalDirectories` value — ALWAYS the absolute path.
     * Claude Code does not expand `~/` in `additionalDirectories` (verified live:
     * the tilde form left the working-directory-boundary prompt firing on task
     * worktree writes, run-20260630-095544), so this entry trades the `$HOME`
     * leak for a rule that actually matches.
     */
    readonly additionalDir: string
}

/**
 * Build the {@link TargetDataDirRules} for a CLI-resolved data dir. The allow
 * globs prefer the `~`-tilde form (documented to expand; keeps a committed target
 * `.claude/settings.json` free of `$HOME`), falling back to the absolute path when
 * the data dir is outside `$HOME` (e.g. a custom `CLAUDE_PLUGIN_DATA`).
 * `additionalDir` is ALWAYS absolute — see {@link TargetDataDirRules.additionalDir}.
 */
export function buildTargetDataDirRules(opts: {
    /** The absolute, canonical data dir (from `resolveDataDir()`). */
    readonly dataDir: string
    /** `$HOME`, for the tilde shortening. */
    readonly home: string
}): TargetDataDirRules {
    return {
        allowGlobBase: tildeShorten(opts.dataDir, opts.home),
        additionalDir: opts.dataDir,
    }
}

/** The baked `Read|Edit(<base>/**)` allow rules for a resolved dir. */
function dataDirAllowRules(allowGlobBase: string): string[] {
    return DATA_DIR_VERBS.map((verb) => `${verb}(${allowGlobBase}/**)`)
}

/** Result of an idempotent {@link mergeTargetSettings}. */
export interface MergeResult {
    /** The merged settings object (a NEW object; the input is not mutated). */
    readonly settings: Record<string, unknown>
    /** Whether the merge actually altered anything (false ⇒ already complete). */
    readonly changed: boolean
}

/** On-disk merge result for one settings file (shared shape for the committed + local files). */
export interface EnsureFileResult extends MergeResult {
    /** Absolute path to the written file. */
    readonly path: string
    /** Whether the file did not exist before (a fresh emit vs. a merge). */
    readonly created: boolean
}

/** Result of {@link ensureTargetSettings} (the on-disk wrapper). */
export interface EnsureResult extends EnsureFileResult {
    /** The sibling, GITIGNORED `.claude/settings.local.json` (additionalDirectories only). */
    readonly local: EnsureFileResult
}

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Union the factory permission rules into `existing` and force
 * `worktree.baseRef:"head"`, preserving every other key. Pure: clones the input
 * and never mutates it.
 *
 * `permissions.allow` UNIONS the target entries ({@link FACTORY_TARGET_BASE_ALLOWLIST}
 * + the baked data-dir rules from `dataDirRules`), order-preserving, deduped,
 * after stripping any dead path-form `Write(...)` rule an older scaffold baked
 * ({@link DEAD_WRITE_RULE} — bare `Write` is kept). Idempotent: re-merging an
 * already-baked settings reports `changed:false`.
 *
 * Deliberately does NOT touch `permissions.additionalDirectories` — that entry is
 * always absolute (never tilde-expanded by Claude Code) and so must never land in
 * this COMMITTED file; see {@link mergeLocalSettings}.
 */
export function mergeTargetSettings(existing: Record<string, unknown>, dataDirRules: TargetDataDirRules): MergeResult {
    // Structured clone so the caller's object is never mutated (test isolation +
    // safe re-merge of an already-merged object).
    const settings: Record<string, unknown> = structuredClone(existing)
    let changed = false

    // permissions.allow — union the base allow-list + the baked data-dir rules.
    // User entries kept first.
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    const currentAllow = Array.isArray(permissions.allow)
        ? permissions.allow.filter((e): e is string => typeof e === 'string')
        : []
    const keptAllow = currentAllow.filter((e) => !DEAD_WRITE_RULE.test(e))
    const targetAllow = [...FACTORY_TARGET_BASE_ALLOWLIST, ...dataDirAllowRules(dataDirRules.allowGlobBase)]
    const have = new Set(keptAllow)
    const additions = targetAllow.filter((e) => !have.has(e))
    if (additions.length > 0 || keptAllow.length !== currentAllow.length) {
        permissions.allow = [...keptAllow, ...additions]
        settings.permissions = permissions
        changed = true
    }

    // worktree.baseRef: "head" — the staging-determinism invariant. Only mutate when
    // baseRef is not already "head": bind the (possibly fresh) worktree object AND
    // flip baseRef together inside the change branch, so an existing `{baseRef:"head"}`
    // is a true no-op (no redundant self-assignment).
    const worktree = isObject(settings.worktree) ? settings.worktree : {}
    if (worktree.baseRef !== 'head') {
        worktree.baseRef = 'head'
        settings.worktree = worktree
        changed = true
    }

    return {settings, changed}
}

/**
 * Entries in `permissions.additionalDirectories` considered factory-managed and
 * eligible for pruning: the raw `${CLAUDE_PLUGIN_DATA}` placeholder some older
 * scaffold left literally (never resolved), the tilde form (never valid here —
 * Claude Code doesn't expand `~/` in `additionalDirectories`), and a
 * previously-baked absolute path that may no longer match after a data-dir move.
 * Anything else is a user's own entry and is preserved verbatim.
 */
function staleLocalDirs(dataDirRules: TargetDataDirRules): Set<string> {
    return new Set(['${CLAUDE_PLUGIN_DATA}', dataDirRules.allowGlobBase, dataDirRules.additionalDir])
}

/**
 * Merge the factory `permissions.additionalDirectories` entry into `existing`
 * (the target repo's GITIGNORED `.claude/settings.local.json`). Prune-then-add:
 * strips any {@link staleLocalDirs} entry, then appends the current absolute
 * `dataDirRules.additionalDir`. User-added directories outside that stale set are
 * kept, in place. Pure: clones the input and never mutates it. Idempotent: a
 * second merge against its own output reports `changed:false`.
 */
export function mergeLocalSettings(existing: Record<string, unknown>, dataDirRules: TargetDataDirRules): MergeResult {
    const settings: Record<string, unknown> = structuredClone(existing)
    const permissions = isObject(settings.permissions) ? settings.permissions : {}
    const currentDirs = Array.isArray(permissions.additionalDirectories)
        ? permissions.additionalDirectories.filter((e): e is string => typeof e === 'string')
        : []

    const stale = staleLocalDirs(dataDirRules)
    const nextDirs = [...currentDirs.filter((e) => !stale.has(e)), dataDirRules.additionalDir]

    const changed = JSON.stringify(nextDirs) !== JSON.stringify(currentDirs)
    if (changed) {
        permissions.additionalDirectories = nextDirs
        settings.permissions = permissions
    }

    return {settings, changed}
}

/**
 * Read + parse an existing settings JSON file, if present. Valid-JSON-but-not-an-object
 * content (array / number / string) is treated as absent — we're about to write a
 * merged settings object, which REPLACES the file, so warn loudly that the
 * overwrite is destructive (the non-JSON case already throws via `JSON.parse`;
 * this is the silently-coerced gap). Shared by the committed + local files.
 */
async function readExistingSettings(path: string): Promise<Record<string, unknown>> {
    if (!existsSync(path)) {
        return {}
    }
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = raw.trim().length > 0 ? JSON.parse(raw) : {}
    if (isObject(parsed)) {
        return parsed
    }
    log.warn(
        `${path} is valid JSON but not an object (${
            Array.isArray(parsed) ? 'array' : typeof parsed
        }); replacing it with the factory settings object`
    )
    return {}
}

/**
 * Read the target repo's `.claude/settings.json` + `.claude/settings.local.json`
 * (if any), merge the factory rules into each, and write back atomically. Creates
 * `.claude/` as needed. Idempotent: a second call reports `changed:false` on both
 * and rewrites nothing.
 *
 * The split (Decision 17, corrected): `.claude/settings.json` is COMMITTED (allow-list
 * + tilde-form data-dir globs + `worktree.baseRef`, via {@link mergeTargetSettings});
 * `.claude/settings.local.json` is GITIGNORED and per-machine (the absolute
 * `additionalDirectories` entry, via {@link mergeLocalSettings}) — Claude Code
 * doesn't expand `~/` there, so that entry always leaks `$HOME`/username and must
 * never be committed.
 *
 * @param opts.targetRoot   The target repo working tree.
 * @param opts.dataDirRules The baked, CLI-resolved data-dir permission rules
 *   (from {@link buildTargetDataDirRules}). REQUIRED — there is no placeholder
 *   fallback by design, so a misresolved dir fails loud instead of silently
 *   re-emitting the broken `${CLAUDE_PLUGIN_DATA}` rule.
 */
export async function ensureTargetSettings(opts: {
    readonly targetRoot: string
    readonly dataDirRules: TargetDataDirRules
}): Promise<EnsureResult> {
    const dir = join(opts.targetRoot, '.claude')
    const path = join(dir, 'settings.json')
    const localPath = join(dir, 'settings.local.json')
    const created = !existsSync(path)
    const localCreated = !existsSync(localPath)

    const [existing, existingLocal] = await Promise.all([readExistingSettings(path), readExistingSettings(localPath)])
    const {settings, changed} = mergeTargetSettings(existing, opts.dataDirRules)
    const {settings: localSettings, changed: localChanged} = mergeLocalSettings(existingLocal, opts.dataDirRules)

    // Write when creating OR when the merge altered something. A no-op merge of an
    // existing file leaves the file byte-for-byte untouched (idempotent on disk).
    if (created || changed || localCreated || localChanged) {
        await mkdir(dir, {recursive: true})
    }
    if (created || changed) {
        await atomicWriteFile(path, stringifyJson(settings))
    }
    if (localCreated || localChanged) {
        await atomicWriteFile(localPath, stringifyJson(localSettings))
    }

    return {
        settings,
        changed,
        created,
        path,
        local: {settings: localSettings, changed: localChanged, created: localCreated, path: localPath},
    }
}
