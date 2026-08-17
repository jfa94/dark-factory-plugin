/**
 * Config loading + data-dir resolution — frozen seam.
 *
 * `resolveDataDir()` ports `bin/pipeline-lib.sh`'s `$CLAUDE_PLUGIN_DATA`
 * resolution + foreign-plugin canonicalization (`_factory_expected_data_dir`)
 * and the `require_plugin_data` loud-fail guard. This is THE data-dir seam WS1's
 * two stores (`specs/<repo>/<spec-id>/`, `runs/<run_id>/`) build on.
 *
 * `loadConfig()` reads `<dataDir>/config.json` if present (lock-free), parses it
 * through {@link ConfigSchema}, and returns a fully-typed {@link Config}:
 *   - file missing      → all defaults (legitimate "no config").
 *   - key missing       → that key's default (Zod `.default`).
 *   - JSON parse error  → LOUD throw (NOT a silent default — this fixes the
 *                         f1f5264-class bug the bash code warned about, where a
 *                         corrupt config silently reverted every threshold).
 *   - schema violation  → LOUD throw (ZodError) for the same reason.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {existsSync, readFileSync} from 'node:fs'
import {basename, dirname, join, resolve, sep} from 'node:path'
import {homedir} from 'node:os'
import {createLogger} from '../shared/logging.js'
import {parseJson} from '../shared/json.js'
import {ConfigSchema, type Config} from './schema.js'

const log = createLogger('config')

/** This plugin's manifest name (matches `.claude-plugin/plugin.json` "name"). */
const PLUGIN_NAME = 'factory'

/**
 * Options for {@link resolveDataDir} / {@link loadConfig}. Primarily for tests
 * and explicit overrides; production callers pass nothing and rely on env.
 */
export interface DataDirOptions {
    /**
     * Explicit data dir override. When set, canonicalization is SKIPPED and this
     * path is used verbatim (after `resolve`). Useful for tests.
     */
    dataDir?: string
    /** Override `$CLAUDE_PLUGIN_DATA` (defaults to the real env var). */
    env?: NodeJS.ProcessEnv
    /** Override `$HOME` (defaults to os.homedir()). For tests. */
    home?: string
    /**
     * Plugin root dir, used by the cache-layout canonicalization. Defaults to the
     * repo root inferred from this module's location at runtime. For tests.
     */
    pluginRoot?: string
    /**
     * Sink for the foreign-plugin redirect warning. Defaults to {@link log.warn}.
     * Injectable so tests can assert the once-per-process guard (and the message
     * text) without scraping stderr — mirrors how `env`/`home`/`pluginRoot` are
     * injected. Production callers pass nothing.
     */
    warn?: (message: string) => void
}

/**
 * Module-level set of already-warned `<current → corrected>` redirect pairs, so
 * the foreign-plugin warning fires ONCE per distinct leak per process instead of
 * on every one of the ~20 `resolveDataDir` calls a single command makes. Keyed
 * on the pair (not a blanket one-shot) so a genuinely different redirect still
 * warns. Reset between tests via {@link __resetDataDirWarnings}.
 */
const warnedRedirects = new Set<string>()

/** Test-only: clear the once-per-process redirect-warn guard. */
export function __resetDataDirWarnings(): void {
    warnedRedirects.clear()
    retiredKeyWarned.clear()
}

/**
 * Derive the canonical data dir when `$CLAUDE_PLUGIN_DATA` points at a FOREIGN
 * plugin's dir (the leak `_factory_expected_data_dir` guards against). Returns
 * the corrected path, or `null` if no correction applies (already ours / a temp
 * / a custom path / unset).
 *
 * Algorithm (ported 1:1 from the bash):
 *   - Only paths explicitly under `~/.claude/plugins/data/` are candidates;
 *     temp/custom/unset are left alone.
 *   - "Already ours": basename === "factory" or starts with "factory-".
 *   - Foreign leak: derive the id from the cache layout
 *     `cache/<marketplace>/<plugin>/<version>/`, falling back to
 *     `.claude-plugin/marketplace.json`.
 */
function expectedDataDir(opts: {
    current: string | undefined
    home: string
    pluginRoot: string
    warn: (message: string) => void
}): string | null {
    const {current, home, pluginRoot, warn} = opts
    if (current == null || current.length === 0) {
        return null
    }

    const dataRoot = join(home, '.claude', 'plugins', 'data')
    // Must be under ~/.claude/plugins/data/ to be a candidate. Use the platform
    // path separator, not a literal '/', so the guard fires consistently with the
    // path.join'd dataRoot above.
    if (!current.startsWith(dataRoot + sep)) {
        return null
    }

    const currentBase = basename(current)
    // Already ours.
    if (currentBase === PLUGIN_NAME || currentBase.startsWith(`${PLUGIN_NAME}-`)) {
        return null
    }

    // Foreign-plugin leak. Try the cache-install layout first:
    //   <cacheRoot>/cache/<marketplace>/<plugin>/<version>/   (pluginRoot)
    // pluginRoot is the <version> dir, so:
    //   dirname(pluginRoot)            = <plugin>
    //   dirname(dirname(pluginRoot))   = <marketplace>
    //   pluginRoot/../../..            = <cacheRoot>/cache
    const pluginFromPath = basename(dirname(pluginRoot))
    const marketplaceFromPath = basename(dirname(dirname(pluginRoot)))
    const cacheAnchor = resolve(pluginRoot, '..', '..', '..')
    const expectedCacheRoot = join(home, '.claude', 'plugins', 'cache')
    if (cacheAnchor === expectedCacheRoot && pluginFromPath.length > 0 && marketplaceFromPath.length > 0) {
        return join(dataRoot, `${pluginFromPath}-${marketplaceFromPath}`)
    }

    // Dev checkout: derive the marketplace name from marketplace.json.
    const marketplaceJson = join(pluginRoot, '.claude-plugin', 'marketplace.json')
    if (existsSync(marketplaceJson)) {
        try {
            const parsed = parseJson(readFileSync(marketplaceJson, 'utf8'), marketplaceJson)
            const name = parsed !== null && typeof parsed === 'object' ? (parsed as {name?: unknown}).name : undefined
            const marketplaceName = typeof name === 'string' ? name : ''
            if (marketplaceName.length > 0) {
                return join(dataRoot, `${PLUGIN_NAME}-${marketplaceName}`)
            }
        } catch (err) {
            // Unparseable marketplace.json: we can't derive the canonical name, so the
            // foreign-plugin redirect can't fire and state may land in a FOREIGN data
            // dir (the leak H warns about). Surface it rather than swallow — the silent
            // catch masked exactly that failure mode.
            warn(
                `could not parse ${marketplaceJson} (${(err as Error).message}); cannot ` +
                    `canonicalize the foreign-plugin data dir — state may land in a foreign ` +
                    `directory. Set CLAUDE_PLUGIN_DATA explicitly to factory's own data dir.`
            )
        }
    }

    return null
}

/**
 * Best-effort guess of the plugin root (the dir containing `.claude-plugin/`)
 * from this module's runtime location. The build inlines this module into
 * `dist/factory.js`, so at runtime `import.meta.url` points into `dist/`; the
 * repo root is its parent. This is only used by the foreign-plugin
 * canonicalization heuristic, which itself only fires for paths under
 * `~/.claude/plugins/data/`, so an imperfect guess here is harmless in dev.
 */
export function inferPluginRoot(): string {
    try {
        const here = new URL('.', import.meta.url).pathname
        // dist/ -> repo root is one up; src/config/ -> two up. Walk up to the dir
        // that has .claude-plugin, capped at 4 levels.
        let dir = here
        for (let i = 0; i < 4; i++) {
            if (existsSync(join(dir, '.claude-plugin'))) {
                return dir
            }
            dir = dirname(dir)
        }
        return resolve(here, '..')
    } catch (err) {
        log.debug(`inferPluginRoot: ${(err as Error).message}; falling back to cwd`)
        return process.cwd()
    }
}

/**
 * Resolve the plugin ROOT dir (the dir containing `.claude-plugin/`, `bin/`,
 * `hooks/`, `templates/`). Prefers the real `$CLAUDE_PLUGIN_ROOT` Claude Code
 * injects when the plugin is loaded, falling back to the runtime-location
 * inference. This is the value substituted for the `${CLAUDE_PLUGIN_ROOT}`
 * placeholder in the inline autonomous settings (E2 autonomy port), so it must point at a
 * stable on-disk plugin install, not at `dist/`.
 *
 * @param env Override the environment (defaults to `process.env`). For tests.
 */
export function resolvePluginRoot(env: NodeJS.ProcessEnv = process.env): string {
    const fromEnv = env.CLAUDE_PLUGIN_ROOT
    if (typeof fromEnv === 'string' && fromEnv.length > 0) {
        return resolve(fromEnv)
    }
    return inferPluginRoot()
}

/**
 * Resolve the plugin data dir, applying foreign-plugin canonicalization and
 * loud-failing if it is unset (and no explicit override is given).
 *
 * @throws Error if no data dir can be determined.
 */
export function resolveDataDir(opts: DataDirOptions = {}): string {
    if (opts.dataDir != null && opts.dataDir.length > 0) {
        return resolve(opts.dataDir)
    }

    const env = opts.env ?? process.env
    const home = opts.home ?? homedir()
    const pluginRoot = opts.pluginRoot ?? inferPluginRoot()
    const current = env.CLAUDE_PLUGIN_DATA
    const warn =
        opts.warn ??
        ((m: string) => {
            log.warn(m)
        })

    // A SUCCESSFUL redirect is self-correcting → debug by default (Fix 8); real
    // problems inside expectedDataDir (unparseable marketplace.json) keep `warn`.
    const notifyRedirect =
        opts.warn ??
        ((m: string) => {
            log.debug(m)
        })

    const corrected = expectedDataDir({current, home, pluginRoot, warn})
    if (corrected != null && corrected.length > 0 && corrected !== current) {
        // Fire the notice ONCE per distinct redirect per process (resolveDataDir is
        // called ~20×/command). Keyed on the (current, corrected) pair so a different
        // leak still notifies; JSON-encoded so the two paths can't ambiguously collide
        // (a path may contain spaces, so a raw separator would be unsound).
        const key = JSON.stringify([current ?? '', corrected])
        if (!warnedRedirects.has(key)) {
            warnedRedirects.add(key)
            notifyRedirect(
                `CLAUDE_PLUGIN_DATA is set to '${current ?? ''}', which belongs to ` +
                    `another plugin — factory auto-redirected to its canonical data dir ` +
                    `'${corrected}'. This is benign and self-corrected: no action is ` +
                    `required for correctness. To silence this notice permanently, set ` +
                    `CLAUDE_PLUGIN_DATA to factory's own dir ` +
                    `(e.g. export CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/factory-<your-marketplace-id>").`
            )
        }
        return resolve(corrected)
    }

    if (current == null || current.length === 0) {
        throw new Error(
            'CLAUDE_PLUGIN_DATA must be set ' +
                '(e.g. export CLAUDE_PLUGIN_DATA="$HOME/.claude/plugins/data/factory-<your-marketplace-id>")'
        )
    }
    return resolve(current)
}

/** Path to the config file inside a data dir. */
export function configPath(dataDir: string): string {
    return join(dataDir, 'config.json')
}

/**
 * Load and validate config. Returns a fully-defaulted {@link Config}.
 *
 * @throws JsonParseError if config.json exists but is invalid JSON.
 * @throws ZodError       if config.json violates the schema.
 * @throws Error          if the data dir cannot be resolved (and no explicit
 *                        config file path is implied by `opts.dataDir`).
 */
export function loadConfig(opts: DataDirOptions = {}): Config {
    let dataDir: string
    try {
        dataDir = resolveDataDir(opts)
    } catch {
        // No data dir resolvable (e.g. unset env in a bare dev shell). The config
        // surface is still well-defined: return all defaults. State-using callers
        // resolve the data dir explicitly and will get the loud error there.
        return ConfigSchema.parse({})
    }

    const file = configPath(dataDir)
    if (!existsSync(file)) {
        return ConfigSchema.parse({})
    }

    // Lock-free read; parse errors are loud (not silently defaulted).
    const raw = parseJson(readFileSync(file, 'utf8'), file)
    warnRetiredKeys(raw, file)
    return ConfigSchema.parse(raw)
}

/**
 * Retired config keys Zod silently strips. A user overlay still carrying one gets a
 * loud warning (once per process per file) instead of a silent no-op: the value was
 * NEVER read even before retirement (`git.stagingBranch` — every consumer parsed the
 * schema default; the real branch is per-run `staging-<run-id>`) or was frozen to
 * its default by a superRefine (`e2e.testDir`).
 */
const RETIRED_KEYS: readonly [section: string, key: string][] = [
    ['git', 'stagingBranch'],
    ['e2e', 'testDir'],
]
const retiredKeyWarned = new Set<string>()

function warnRetiredKeys(raw: unknown, file: string): void {
    if (typeof raw !== 'object' || raw === null) {
        return
    }
    for (const [section, key] of RETIRED_KEYS) {
        const sectionVal = (raw as Record<string, unknown>)[section]
        if (typeof sectionVal === 'object' && sectionVal !== null && key in sectionVal) {
            const id = `${file}:${section}.${key}`
            if (!retiredKeyWarned.has(id)) {
                retiredKeyWarned.add(id)
                log.warn(
                    `config: '${section}.${key}' is retired and ignored (${file}) — remove it ` +
                        `(factory configure --unset ${section}.${key})`
                )
            }
        }
    }
}
