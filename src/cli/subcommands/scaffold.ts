/**
 * `factory scaffold` — prepare a target repo to be run by the factory (WS3 / Δ A).
 *
 *   factory scaffold [--repo <owner/name>] [--provision]
 *
 * `--repo` is OPTIONAL (Prompt G / F-repo): auto-derived from the `origin` remote
 * when omitted (the CLI is always cwd-rooted in the target repo).
 *
 * Idempotently copies the per-repo COMMITTED artifacts the new design consumes —
 * the CI net (`.github/workflows/quality-gate.yml`, Δ Z) and the gate configs
 * (`.stryker.config.json` mutation, `.dependency-cruiser.cjs` arch, `eslint.config.mjs`
 * lint baseline) the GateRunner runs in the target worktree — plus a `.gitignore`
 * guard, then PROBES branch protection on `develop` (the integration base):
 * refuse-to-run when it is missing (#2 / Δ A), unless `--provision` is opted in to
 * write it. Per-run staging branches (`staging-<run-id>`) are minted at `run create`
 * — scaffold no longer creates or protects a shared `staging` branch.
 *
 * Run/spec STATE is never written here (it lives outside the repo under the data
 * dir). The bash-era progress files + init.sh are dropped — the new code does not
 * read them; partial-run reporting lands in WS12.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {homedir} from 'node:os'
import {dirname, join, relative} from 'node:path'
import {fileURLToPath} from 'node:url'

import {EXIT, type ExitCode} from '../../shared/exit-codes.js'
import {parseArgs, optionalString} from '../args.js'
import {emitJson, emitHelp} from '../io.js'
import {createLogger, nonNull} from '../../shared/index.js'
import {STRYKER_CONFIG_BASENAMES} from '../../shared/gate-config-names.js'
import {
    DefaultGitClient,
    DefaultGhClient,
    probeProtection,
    requireProtectionOrRefuse,
    provisionProtection,
    effectiveProfiles,
    putBaselineProtection,
    resolveRepo,
    splitRepoSlug,
    type GitClient,
    type GhClient,
} from '../../git/index.js'
import {loadConfig, resolveDataDir, type Config} from '../../config/index.js'
import {
    injectGateEnvIntoWorkflow,
    renderQualityGate,
    renderMutationNightly,
    resolveNodeRuntimeDeclarations,
    NODE_VERSION_FILE,
    NVMRC_FILE,
    type NodeRuntime,
    type NodeRuntimeDeclarations,
} from '../../ci/index.js'
import {StateManager} from '../../core/state/index.js'
import {ensureTargetSettings, buildTargetDataDirRules, type TargetDataDirRules} from './target-settings.js'
import {ensureGateContract, recommendFastCheck} from './scaffold-gates.js'
import {loadScaffoldLock, saveScaffoldLock, sha256Hex, SCAFFOLD_LOCK_REL, type ScaffoldLock} from './scaffold-lock.js'
import {GATE_CONTRACT_REL, mutationRoots, requiredCheckExtras} from '../../verifier/deterministic/gate-contract.js'
import type {GateContractStack} from '../../verifier/deterministic/gate-contract.js'
import {UsageError} from '../../shared/usage-error.js'
import {withUsageGuard, type Subcommand} from '../registry-types.js'

const log = createLogger('scaffold')

const HELP = `factory scaffold — prepare a repo for the factory pipeline

Usage:
  factory scaffold [--repo <owner/name>] [--provision] [--waive mutation|coverage]

Copies the committed CI + gate-config templates and probes branch protection on
develop (the integration base). Default mode (git.developProtection=run-scoped, D74):
an UNPROTECTED develop causes scaffold to REFUSE loudly; --provision writes the light
BASELINE profile (git.developBaselineStatusChecks required for non-admins, strict off,
admins push freely) — the strict CI profile is escalated per-run at run create and
dropped when the run ends. Under git.developProtection=permanent the strict profile
(strict up-to-date + git.developRequiredStatusChecks) is asserted/provisioned instead
and never removed. Per-run staging branches are minted at run create — scaffold no
longer touches them. The managed quality-gate.yml is rendered with the configured
quality.gateEnv (set via 'factory configure --set quality.gateEnv.<KEY>=<value>').

Options:
  --repo <owner/name>   OPTIONAL. Target GitHub repo (used for the protection probe).
                        Auto-derived from the 'origin' remote when omitted; an
                        explicit value disagreeing with the remote fails loud.
  --provision           Write branch protection if missing (default: refuse). In
                        run-scoped mode the PUT always writes the BASELINE profile —
                        re-running it is also the one-shot migration off the old
                        permanent strict profile (refused while a run is active).
  --waive mutation      Record the mutation gate as deliberately waived in the gate
                        contract instead of refusing when stryker is not installed
  --waive coverage      Record the coverage gate as deliberately waived instead of
                        refusing when no vitest coverage provider is installed

Also resolves + writes the GATE CONTRACT (.factory/gates.json, Decision 46): the
committed per-gate applicability agreement. Refuses below the floor (test + type +
build equivalents must be contractable). COMMIT the file — 'factory run' requires
it tracked. The contract is seed-like: an existing valid gates.json is never
touched — delete it and re-scaffold to pick up new resolution rules (e.g. the
S8 coverage flip).

Re-scaffold refreshes OUTDATED files: managed files (the CI net) on any drift, and
seed configs ONLY while pristine — untouched since scaffold wrote them, per the
committed .factory/scaffold.lock hash record. A customized seed is project-owned
and never overwritten; delete it and re-scaffold to re-adopt the latest baseline.`

/**
 * The `.gitignore` lines scaffold guarantees. Two invariants drive the list:
 *
 *   - The TRACKED/IGNORED split inside `.claude/` is made EXPLICIT — each ignored
 *     `.claude/` child (per-machine local state) is enumerated individually so the
 *     guarantee never relies on a wildcard, a global `core.excludesfile`, or Claude
 *     Code's own gitignore management. Crucially `.claude/` is NOT ignored wholesale
 *     and `.claude/settings.json` is NOT listed, so the factory-emitted
 *     `.claude/settings.json` stays TRACKED while `.claude/settings.local.json`
 *     (per-machine overrides) is IGNORED.
 *   - Factory + worktree state (`.claude-plugin-data/`, `*.worktree`) must never be
 *     committed.
 *
 * NOTE: `docs/factory/**` (the generated spec.md + tasks.json a run mirrors into the
 * repo) is deliberately NOT ignored — it is tracked as durable, PR-reviewable
 * provenance of the spec that drove each merged PR.
 */
const GITIGNORE_ENTRIES = [
    '# Claude Code local state (factory scaffold guarantee)',
    '.claude/worktrees/',
    '.claude/plugins/',
    '.claude/file-history/',
    '.claude/backups/',
    '.claude/debug/',
    '.claude/todos/',
    '.claude/plans/',
    '.claude/memory/',
    '.claude/statsig/',
    '.claude/cache/',
    '.claude/paste-cache/',
    '.claude/projects/',
    '.claude/shell-snapshots/',
    '.claude/tasks/',
    '.claude/telemetry/',
    '.claude/workflows/',
    '.claude/history.jsonl',
    '.claude/CLAUDE.local.md',
    '.claude/tool-audit.jsonl',
    '.claude/settings.local.json',
    '# factory plugin state',
    '.claude-plugin-data/',
    '*.worktree',
]

/** Injectable inputs to the scaffold CORE (the `run(argv)` wrapper wires real ones). */
export interface ScaffoldOptions {
    /** The repo working tree to scaffold (defaults to cwd in the CLI wrapper). */
    readonly targetRoot: string
    /** The plugin `templates/` dir (resolved from the bundle location by default). */
    readonly templatesDir: string
    readonly owner: string
    readonly repo: string
    readonly config: Config
    readonly ghClient: GhClient
    /**
     * The baked, CLI-resolved data-dir permission rules for the target repo's
     * `.claude/settings.json` (from {@link buildTargetDataDirRules}). Injected at
     * the command boundary — `run(argv)` resolves the canonical data dir via
     * `resolveDataDir()` (which corrects the foreign-plugin env-var leak) so the
     * emitted rules never carry the broken `${CLAUDE_PLUGIN_DATA}` placeholder.
     */
    readonly dataDirRules: TargetDataDirRules
    /** --provision: write protection when missing instead of refusing. */
    readonly provision: boolean
    /**
     * Answers "does ANY non-terminal run exist for this repo?" (D74). Guards the
     * run-scoped `--provision` PUT: writing the baseline while a run is active
     * would downgrade the escalated strict profile mid-run. The CLI wrapper wires
     * the StateManager query; omitted (tests without run state) → treated as no
     * active run.
     */
    readonly hasActiveRun?: () => Promise<boolean>
    /** --waive mutation: record the mutation gate as waived instead of refusing. */
    readonly waiveMutation?: boolean
    /** --waive coverage: record the coverage gate as waived instead of refusing. */
    readonly waiveCoverage?: boolean
}

/** Machine-readable scaffold report (emitted as JSON). */
export interface ScaffoldReport {
    readonly repo: string
    readonly files_created: string[]
    readonly files_present: string[]
    /**
     * Template files AUTO-OVERWRITTEN on this run because they were outdated:
     * plugin-MANAGED files (the CI net) that drifted from the shipped template,
     * plus PRISTINE seeds (bytes still matching their `.factory/scaffold.lock`
     * hash) whose shipped template moved. Git is the safety net (the change
     * shows in `git diff`); customized seeds are never touched.
     */
    readonly files_updated: string[]
    readonly protection: {
        readonly enabled: boolean
        readonly strict_up_to_date: boolean
        readonly required_status_checks: string[]
        readonly provisioned: boolean
    }
    /**
     * E1 (F-perm): the target `.claude/settings.json` (committed) +
     * `.claude/settings.local.json` (gitignored, `local`) emit/merge — whether
     * each file was freshly created and whether its merge altered it. Stops the
     * per-call permission prompts for interactive `/factory:run` in this repo.
     */
    readonly settings: {
        readonly created: boolean
        readonly changed: boolean
        readonly local: {readonly created: boolean; readonly changed: boolean}
    }
    /** Detected stack driving the gate-contract resolution (S7, Decision 46). */
    readonly stack: GateContractStack
    /** Whether `.factory/gates.json` was freshly resolved+written or already present. */
    readonly gates_contract: 'created' | 'present'
}

/**
 * Resolve the plugin `templates/` directory from this module's runtime location.
 * The build inlines this module into `dist/factory.js` (repo root → `templates/`);
 * in dev it runs from `src/cli/subcommands/` (four up → `templates/`). Walk up
 * until a dir with the CI template is found.
 */
export function resolveTemplatesDir(): string {
    let dir = dirname(fileURLToPath(import.meta.url))
    for (let i = 0; i < 6; i++) {
        const candidate = join(dir, 'templates')
        if (existsSync(join(candidate, '.github', 'workflows', 'quality-gate.yml'))) {
            return candidate
        }
        const parent = dirname(dir)
        if (parent === dir) {
            break
        }
        dir = parent
    }
    throw new Error('scaffold: could not locate the plugin templates/ directory')
}

/**
 * Per-file scaffold policy (the user's "plugin-managed vs user-owned" split):
 *
 *   - `managed` — the plugin is the SOLE author (the CI net + its helper script).
 *     Auto-overwritten when it drifts from the shipped template so a template fix
 *     reaches already-scaffolded repos on the next `factory scaffold`. Git is the
 *     safety net; customizing a managed file is unsupported by contract.
 *   - `seed` — PROJECT-OWNED once touched by the project. Copied verbatim when
 *     ABSENT (a load-safe baseline). Once present, a seed is auto-refreshed ONLY
 *     while provably PRISTINE — its bytes still sha256-match the `.factory/scaffold.lock`
 *     entry recorded when scaffold wrote it (Decision 15). Any customization (or a
 *     missing lock entry: cold start, garbage lock) makes it project-owned forever:
 *     reported `present`, never overwritten — a repo that has grown its own richer
 *     config (e.g. an eslint.config.mjs that imports plugins) is recognized as
 *     current, not stale. Delete the file and re-scaffold to re-adopt the baseline.
 */
type TemplatePolicy = 'managed' | 'seed'

interface TemplateEntry {
    /** Path relative to BOTH `templatesDir` and `targetRoot` (forward-slashed). */
    readonly rel: string
    readonly policy: TemplatePolicy
    /** Only scaffold this file when the target is a Node package (has package.json). */
    readonly nodeOnly?: boolean
    /** Exact historical factory-authored SEED hashes safe to upgrade without a lock entry. */
    readonly legacySeedHashes?: readonly string[]
}

/**
 * The committed per-repo artifacts the factory consumes. The CI workflow and its
 * cost-aware shard helper are MANAGED (plugin-authored, auto-updated); the gate
 * configs are SEED (a starting point the project then owns + tunes).
 */
/** The managed CI workflow — also the render/injection target (the only transformed file). */
const QUALITY_GATE_REL = '.github/workflows/quality-gate.yml'

/**
 * Broken pre-lock e2e seeds shipped by factory v1.10.0–v1.27.0. Both contain an
 * eslint-disable for a Playwright rule the scaffold never installed/configured.
 * Whole-file hashes make the migration safe: any customization stays project-owned.
 */
const LEGACY_E2E_EXAMPLE_HASHES: readonly string[] = [
    '2fcc468328b2070bd07ede3e524bf1bf33ec2957d2d0e9bef29302251a24356d',
    '629824a48477223cfcef02bcb6c850aa9622d73d41c93bc3b76486831a98770e',
]

/** The manual full-surface workflow — rendered only when mutation is contracted. */
const MUTATION_NIGHTLY_REL = '.github/workflows/mutation-nightly.yml'

/** Pre-v1.46.1 Node test name, which broad Vitest discovery mistakes for a Vitest suite. */
const LEGACY_SHARD_TEST_REL = '.github/scripts/shard-mutation-scope.test.mjs'

/** The stryker seed — deferred to pass 2a: its `mutate` globs render from the contract's roots. */
const STRYKER_SEED_REL = '.stryker.config.json'

/** The managed CI net: rendered from the gate contract in pass 2 (npm stack only). */
const CI_NET_RELS: readonly string[] = [
    QUALITY_GATE_REL,
    '.github/scripts/shard-mutation-scope.mjs',
    '.github/scripts/shard-mutation-scope.node-test.mjs',
    MUTATION_NIGHTLY_REL,
]

const TEMPLATE_MANIFEST: readonly TemplateEntry[] = [
    {rel: QUALITY_GATE_REL, policy: 'managed'},
    {rel: '.github/scripts/shard-mutation-scope.mjs', policy: 'managed'},
    {rel: '.github/scripts/shard-mutation-scope.node-test.mjs', policy: 'managed'},
    {rel: MUTATION_NIGHTLY_REL, policy: 'managed'},
    {rel: STRYKER_SEED_REL, policy: 'seed', nodeOnly: true},
    {rel: '.dependency-cruiser.cjs', policy: 'seed', nodeOnly: true},
    {rel: 'eslint.config.mjs', policy: 'seed', nodeOnly: true},
    // e2e (Decision 39) — seed only; @playwright/test must already be a devDependency
    // (scaffold never installs packages) and the config's webServer.command is a TODO
    // the project fills in. testDir here MUST match `e2e.testDir` (default "e2e") —
    // and must STAY "./e2e" in any template edit: pristine auto-refresh propagates
    // template changes into already-scaffolded repos, and S4 assertE2ePrereqs
    // refuses an --e2e run whose config declares any other testDir.
    {rel: 'playwright.config.ts', policy: 'seed', nodeOnly: true},
    {
        rel: 'e2e/example.spec.ts',
        policy: 'seed',
        nodeOnly: true,
        legacySeedHashes: LEGACY_E2E_EXAMPLE_HASHES,
    },
]

/** Mutable file buckets a scaffold run accumulates, surfaced in the report. */
interface FileLists {
    readonly created: string[]
    readonly present: string[]
    readonly updated: string[]
}

/** Mutable scaffold-lock state threaded through the seed pass (see scaffold-lock.ts). */
interface LockState {
    readonly seeds: Record<string, string>
    dirty: boolean
}

/**
 * Apply one {@link TemplateEntry}, landing it in exactly one bucket:
 *   - absent           → write the rendered template in (`created`; seeds record
 *                        their content hash into the scaffold lock)
 *   - present + seed    → PRISTINE (bytes still match the lock hash): refresh on
 *                        template drift (`updated`), else `present`. Customized /
 *                        no lock entry: project-owned `present`, never overwritten
 *   - present + managed → refresh on drift vs the rendered template (`updated`),
 *                        else `present`
 *
 * `transform` renders the template text before write/compare (managed files only,
 * e.g. injecting the resolved gateEnv into `quality-gate.yml`). Because drift is
 * measured against the RENDERED template, an injected managed file stays
 * byte-identical across re-runs — no spurious `updated` flag.
 */
async function applyTemplate(
    entry: TemplateEntry,
    templatesDir: string,
    targetRoot: string,
    lists: FileLists,
    lock?: LockState,
    transform?: (text: string) => string
): Promise<void> {
    const segs = entry.rel.split('/')
    const src = join(templatesDir, ...segs)
    const dest = join(targetRoot, ...segs)
    if (!existsSync(src)) {
        log.warn(`template missing, skipping: ${src}`)
        return
    }
    const render = async (): Promise<string> => {
        const text = await readFile(src, 'utf8')
        return transform ? transform(text) : text
    }
    if (!existsSync(dest)) {
        const rendered = await render()
        await mkdir(dirname(dest), {recursive: true})
        await writeFile(dest, rendered, 'utf8')
        if (entry.policy === 'seed' && lock) {
            lock.seeds[entry.rel] = sha256Hex(rendered)
            lock.dirty = true
        }
        lists.created.push(entry.rel)
        return
    }
    // A present SEED file auto-refreshes ONLY while provably PRISTINE: its bytes
    // still sha256-match the scaffold-lock entry recorded when scaffold wrote it.
    // Everything else — customized bytes, no lock entry (cold start: scaffolded
    // before the lock existed), garbage lock — is PROJECT-OWNED: reported `present`
    // and never overwritten. A repo's grown-up config (e.g. an eslint.config.mjs
    // that imports plugins) is recognized as current, not stale (Decision 15).
    //
    // KNOWN, DELIBERATE LIMITATION: a NEW baseline rule added to a shipped SEED
    // template therefore does NOT propagate to a repo whose copy was customized (or
    // predates the lock) — that is the price of the project-ownership guarantee.
    // Such a repo opts into a refreshed baseline by deleting the file and
    // re-scaffolding (which re-adopts it into the lock). Note git line-ending
    // rewrites (autocrlf/.gitattributes) change bytes on disk and read as
    // "customized" — fail safe, never a clobber. Machinery that must stay in
    // lockstep belongs in the MANAGED tier. See Decision 15.
    if (entry.policy === 'seed') {
        const recorded = lock?.seeds[entry.rel]
        const destText = await readFile(dest, 'utf8')
        const destHash = sha256Hex(destText)
        if (recorded !== undefined) {
            if (destHash === recorded) {
                const rendered = await render()
                if (rendered === destText) {
                    lists.present.push(entry.rel)
                    return
                }
                await writeFile(dest, rendered, 'utf8')
                if (lock) {
                    lock.seeds[entry.rel] = sha256Hex(rendered)
                    lock.dirty = true
                }
                lists.updated.push(entry.rel)
                return
            }
        }
        // Narrow migration exception for known pre-lock factory-authored seeds.
        // Exact whole-file hashes prove provenance without treating arbitrary
        // missing-lock files as factory-owned. The replacement is immediately
        // adopted into the lock so every later refresh follows the normal path.
        if (lock !== undefined && entry.legacySeedHashes?.includes(destHash) === true) {
            const rendered = await render()
            if (rendered !== destText) {
                await writeFile(dest, rendered, 'utf8')
                lists.updated.push(entry.rel)
            } else {
                lists.present.push(entry.rel)
            }
            lock.seeds[entry.rel] = sha256Hex(rendered)
            lock.dirty = true
            return
        }
        // Stale lock entries are KEPT: harmless (the hash never matches again), and
        // reverting the file to the exact scaffold-written bytes re-adopts it.
        lists.present.push(entry.rel)
        return
    }
    // MANAGED: the plugin is the sole author — refresh the target when it drifts from
    // the rendered template so a template fix propagates to already-scaffolded repos.
    // Git is the safety net.
    const [rendered, destText] = await Promise.all([render(), readFile(dest, 'utf8')])
    if (rendered === destText) {
        lists.present.push(entry.rel)
        return
    }
    await writeFile(dest, rendered, 'utf8')
    lists.updated.push(entry.rel)
}

/** The repo facts (beyond the contract) the workflow render needs (Decision 53). */
interface WorkflowFacts {
    readonly packageManager: 'pnpm' | 'npm'
    readonly hasLockfile: boolean
    readonly scripts: Readonly<Record<string, string>>
    readonly hasNextDep: boolean
    readonly nodeRuntime: NodeRuntime
}

/** Lockfile-detect the package manager + read the scripts/next facts from package.json. */
async function readWorkflowFacts(targetRoot: string): Promise<WorkflowFacts> {
    const pnpm = existsSync(join(targetRoot, 'pnpm-lock.yaml'))
    const raw = await readFile(join(targetRoot, 'package.json'), 'utf8')
    let pkg: {
        scripts?: Record<string, string>
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        engines?: unknown
        volta?: unknown
        devEngines?: unknown
    }
    try {
        pkg = JSON.parse(raw) as typeof pkg
    } catch (err) {
        throw new Error(`scaffold: package.json is not valid JSON: ${(err as Error).message}`)
    }
    const declarations: {
        nodeVersion?: string
        nvmrc?: string
        enginesNode?: unknown
        packageJsonRuntimeShadows?: string[]
    } = {}
    if (existsSync(join(targetRoot, NODE_VERSION_FILE))) {
        declarations.nodeVersion = await readFile(join(targetRoot, NODE_VERSION_FILE), 'utf8')
    }
    if (existsSync(join(targetRoot, NVMRC_FILE))) {
        declarations.nvmrc = await readFile(join(targetRoot, NVMRC_FILE), 'utf8')
    }
    if (typeof pkg.engines === 'object' && pkg.engines !== null && Object.hasOwn(pkg.engines, 'node')) {
        declarations.enginesNode = (pkg.engines as {node?: unknown}).node
    }
    const packageJsonRuntimeShadows: string[] = []
    if (typeof pkg.volta === 'object' && pkg.volta !== null) {
        if (Object.hasOwn(pkg.volta, 'node')) {
            packageJsonRuntimeShadows.push('volta.node')
        }
        if (Object.hasOwn(pkg.volta, 'extends')) {
            packageJsonRuntimeShadows.push('volta.extends')
        }
    }
    if (typeof pkg.devEngines === 'object' && pkg.devEngines !== null && Object.hasOwn(pkg.devEngines, 'runtime')) {
        packageJsonRuntimeShadows.push('devEngines.runtime')
    }
    declarations.packageJsonRuntimeShadows = packageJsonRuntimeShadows

    return {
        packageManager: pnpm ? 'pnpm' : 'npm',
        hasLockfile: pnpm || existsSync(join(targetRoot, 'package-lock.json')),
        scripts: pkg.scripts ?? {},
        hasNextDep: pkg.dependencies?.next !== undefined || pkg.devDependencies?.next !== undefined,
        nodeRuntime: resolveNodeRuntimeDeclarations(declarations satisfies NodeRuntimeDeclarations),
    }
}

/** Append any of `entries` missing from `<root>/<filename>`, creating it if absent. */
async function ensureIgnoreFile(
    root: string,
    filename: string,
    entries: readonly string[],
    lists: FileLists
): Promise<void> {
    const path = join(root, filename)
    const rel = relative(root, path)
    if (!existsSync(path)) {
        await writeFile(path, entries.join('\n') + '\n', 'utf8')
        lists.created.push(rel)
        return
    }
    const current = await readFile(path, 'utf8')
    const missing = entries.filter((e) => !current.split('\n').includes(e))
    if (missing.length === 0) {
        lists.present.push(rel)
        return
    }
    const sep = current.endsWith('\n') ? '' : '\n'
    await writeFile(path, current + sep + missing.join('\n') + '\n', 'utf8')
    lists.present.push(rel)
}

/** Append any missing {@link GITIGNORE_ENTRIES} to the target `.gitignore`. */
async function ensureGitignore(root: string, lists: FileLists): Promise<void> {
    await ensureIgnoreFile(root, '.gitignore', GITIGNORE_ENTRIES, lists)
}

/**
 * `.github/scripts/shard-mutation-scope.mjs` is an esbuild bundle (see
 * `templates/.github/scripts/shard-mutation-scope.mjs` — generated, not
 * hand-formatted); it never matches a target repo's own prettier style.
 * The plugin repo itself `.prettierignore`s the equivalent path for the same
 * reason — scaffold must guarantee the same exclusion in the target so
 * `prettier --check .` stays clean there too.
 */
const PRETTIERIGNORE_ENTRIES = [
    '# factory plugin: generated bundle (esbuild output, not hand-formatted)',
    '.github/scripts/',
]

/** Append any missing {@link PRETTIERIGNORE_ENTRIES} to the target `.prettierignore`. */
async function ensurePrettierignore(root: string, lists: FileLists): Promise<void> {
    await ensureIgnoreFile(root, '.prettierignore', PRETTIERIGNORE_ENTRIES, lists)
}

/**
 * The scaffold CORE: copy templates, probe/refuse/provision protection on
 * `develop` (the integration base). Pure of `process`/argv — driven by
 * {@link ScaffoldOptions} so units exercise it with fakes + temp dirs. Throws
 * loud on a protection shortfall when `--provision` is not set.
 *
 * Per-run staging branches (`staging-<run-id>`) are minted at `run create` —
 * scaffold no longer creates or protects a shared `staging` branch.
 */
export async function runScaffold(opts: ScaffoldOptions): Promise<ScaffoldReport> {
    const lists: FileLists = {created: [], present: [], updated: []}

    // 1. SEED template artifacts (Δ Z): baseline when absent, auto-refreshed only
    //    while pristine per the scaffold lock; `nodeOnly` configs apply only to a
    //    Node-package target. Seeds go FIRST so the freshly seeded eslint config
    //    participates in the npm lint resolution below.
    const isNodePackage = existsSync(join(opts.targetRoot, 'package.json'))
    const lockLoad = await loadScaffoldLock(opts.targetRoot)
    const lock: LockState = {seeds: {...lockLoad.lock.seeds}, dirty: false}
    for (const entry of TEMPLATE_MANIFEST) {
        if (CI_NET_RELS.includes(entry.rel) || entry.rel === STRYKER_SEED_REL) {
            continue // the managed CI net + stryker seed render AFTER the contract (pass 2)
        }
        if (entry.nodeOnly === true && !isNodePackage) {
            continue
        }
        await applyTemplate(entry, opts.templatesDir, opts.targetRoot, lists, lock)
    }
    // Persist the lock NOW — the gate-contract / protection steps below can throw
    // (refusal paths) AFTER seeds already landed on disk, and losing the recorded
    // hashes would strand those seeds as permanently "customized". A garbage lock
    // is rewritten valid; a lock that would be empty and didn't exist is skipped
    // (no `{seeds:{}}` noise on non-node targets where every seed is skipped).
    let lockReported = false
    if (lock.dirty || lockLoad.invalid) {
        const toSave: ScaffoldLock = {version: 1, seeds: lock.seeds}
        await saveScaffoldLock(opts.targetRoot, toSave)
        lock.dirty = false
        lockReported = true
        if (lockLoad.existed) {
            lists.present.push(SCAFFOLD_LOCK_REL)
        } else {
            lists.created.push(SCAFFOLD_LOCK_REL)
            log.info(`wrote ${SCAFFOLD_LOCK_REL} (seed pristine-tracking) — COMMIT it alongside the seeds`)
        }
    } else if (lockLoad.existed) {
        lists.present.push(SCAFFOLD_LOCK_REL)
        lockReported = true
    }

    // 2. The GATE CONTRACT (S7, Decision 46): resolve the stack + write
    //    `.factory/gates.json` (seed-like — an existing VALID contract is
    //    project-owned; an invalid one refuses). Throws loud below the floor
    //    (test/type/build equivalents uncontractable).
    const gates = await ensureGateContract({
        targetRoot: opts.targetRoot,
        securityCommand: opts.config.quality.securityCommand,
        waiveMutation: opts.waiveMutation === true,
        waiveCoverage: opts.waiveCoverage === true,
    })
    if (gates.status === 'created') {
        lists.created.push(GATE_CONTRACT_REL)
        log.info(
            `wrote ${GATE_CONTRACT_REL} (stack: ${gates.stack}) — COMMIT it; 'factory run' requires the contract tracked`
        )
    } else {
        lists.present.push(GATE_CONTRACT_REL)
    }

    // 2a. The stryker SEED, deferred until the contract exists: its `mutate` globs
    //     render from the contracted mutation roots (A4), and seeding is
    //     SHADOW-GUARDED (A5): when any OTHER Stryker config basename exists, the
    //     project already owns mutation config — writing ours could silently shadow
    //     it (Stryker's discovery is first-existing-wins), so scaffold refuses to
    //     seed and names the file discovery actually loads.
    if (isNodePackage) {
        const present = STRYKER_CONFIG_BASENAMES.filter((b) => existsSync(join(opts.targetRoot, b)))
        const others = present.filter((b) => b !== STRYKER_SEED_REL)
        if (others.length > 0) {
            log.warn(
                `not seeding ${STRYKER_SEED_REL}: found existing Stryker config(s) ${others.join(', ')} — ` +
                    `discovery order loads '${nonNull(present[0])}'; consolidate into ONE config ` +
                    `(shadowed siblings are silently ignored by Stryker)`
            )
        } else {
            const roots = mutationRoots(gates.contract)
            const includes = roots.map((r) => `"${r}/**/*.ts"`).join(',\n        ')
            const entry = nonNull(TEMPLATE_MANIFEST.find((e) => e.rel === STRYKER_SEED_REL))
            await applyTemplate(entry, opts.templatesDir, opts.targetRoot, lists, lock, (text) =>
                text.replace('"src/**/*.ts"', includes)
            )
            // A written/refreshed seed recorded a new lock hash — persist it (the
            // pass-1 save already happened; TS CFA can't see applyTemplate's mutation
            // of lock.dirty, so key off the file lists instead).
            const wroteSeed = lists.created.includes(STRYKER_SEED_REL) || lists.updated.includes(STRYKER_SEED_REL)
            if (wroteSeed) {
                await saveScaffoldLock(opts.targetRoot, {version: 1, seeds: lock.seeds})
                lock.dirty = false
                if (!lockReported) {
                    if (lockLoad.existed) {
                        lists.present.push(SCAFFOLD_LOCK_REL)
                    } else {
                        lists.created.push(SCAFFOLD_LOCK_REL)
                        log.info(`wrote ${SCAFFOLD_LOCK_REL} (seed pristine-tracking) — COMMIT it alongside the seeds`)
                    }
                    lockReported = true
                }
            }
        }
    }

    // 2b. The managed CI net, RENDERED from the contract (Decision 53): one source
    //     of truth for the local GateRunner and CI. quality-gate.yml gets the
    //     per-stack setup + gate steps plus the configured quality.gateEnv. Non-npm
    //     stacks get no CI net — the render supports npm-stack repos only, and a
    //     hardcoded workflow would fail at its install step (fail loud, not broken).
    if (gates.contract.stack === 'npm') {
        const facts = await readWorkflowFacts(opts.targetRoot)
        // This was always plugin-MANAGED. Remove it before installing the renamed
        // Node test so Vitest's default `*.test.mjs` discovery cannot collect a
        // dependency-free `node:test` suite and fail with "No test suite found".
        const legacyShardTest = join(opts.targetRoot, ...LEGACY_SHARD_TEST_REL.split('/'))
        if (existsSync(legacyShardTest)) {
            await rm(legacyShardTest)
            lists.updated.push(LEGACY_SHARD_TEST_REL)
        }
        for (const entry of TEMPLATE_MANIFEST) {
            if (!CI_NET_RELS.includes(entry.rel)) {
                continue
            }
            // The manual full-surface workflow exists only where mutation is
            // contracted (renderMutationNightly returns null otherwise).
            if (entry.rel === MUTATION_NIGHTLY_REL && !gates.contract.gates.mutation.contracted) {
                continue
            }
            const transform =
                entry.rel === QUALITY_GATE_REL
                    ? (text: string) =>
                          injectGateEnvIntoWorkflow(
                              renderQualityGate(text, {contract: gates.contract, ...facts}),
                              opts.config.quality.gateEnv
                          )
                    : entry.rel === MUTATION_NIGHTLY_REL
                      ? (text: string) => nonNull(renderMutationNightly(text, {contract: gates.contract, ...facts}))
                      : undefined
            await applyTemplate(entry, opts.templatesDir, opts.targetRoot, lists, undefined, transform)
        }
        // The shard script above is an esbuild bundle in the plugin's own style —
        // exclude it from the target's prettier pass the same way the plugin repo does.
        await ensurePrettierignore(opts.targetRoot, lists)
    } else {
        log.info(
            `skipping the CI net (${CI_NET_RELS.join(', ')}) — the quality-gate workflow renders for ` +
                `npm-stack repos only; stack '${gates.stack}' relies on the local GateRunner`
        )
    }
    // Surface auto-updated files (managed CI net on drift + pristine seeds on
    // template change) — these are the propagation path, worth a loud line.
    if (lists.updated.length > 0) {
        log.info(`auto-updated ${lists.updated.length} outdated scaffold file(s): ${lists.updated.join(', ')}`)
    }
    // S8 PBT advisory (never blocks, never installs): fast-check unlocks the
    // test-writer's property-based tests.
    if (await recommendFastCheck(opts.targetRoot)) {
        log.info(
            "property-based testing: fast-check not installed — consider 'npm i -D fast-check' " +
                'so the test-writer can write property tests (advisory only)'
        )
    }

    // 3. .gitignore guard (factory state must never be committed).
    await ensureGitignore(opts.targetRoot, lists)

    // 3b. E1 (F-perm): emit / idempotently merge TWO target-repo settings files
    //     (Decision 17, corrected): the COMMITTED `.claude/settings.json` (factory
    //     allow-list + baked TILDE-form data-dir rules + worktree.baseRef:"head";
    //     NO statusLine — that belongs to E2's merged-settings) and the GITIGNORED
    //     `.claude/settings.local.json` (the absolute `additionalDirectories`
    //     entry — Claude Code never expands `~/` there, so it must never be
    //     committed). Non-destructive: a user's existing keys in either file
    //     (incl. their own statusLine, their own extra additionalDirectories) are
    //     kept; any stale factory-managed additionalDirectories entry (a literal
    //     `${CLAUDE_PLUGIN_DATA}` placeholder, a tilde form, or a previously-baked
    //     path that moved) is pruned from settings.local.json and replaced.
    const settings = await ensureTargetSettings({
        targetRoot: opts.targetRoot,
        dataDirRules: opts.dataDirRules,
    })
    // Surface the committed .claude/settings.json path in the file lists for
    // transparency (git add/commit visibility). settings.local.json is NOT
    // listed here — it's gitignored (GITIGNORE_ENTRIES above), never meant to be
    // committed, so it would be misleading to report it as a trackable file.
    const settingsRel = relative(opts.targetRoot, settings.path)
    if (settings.created) {
        lists.created.push(settingsRel)
    } else {
        lists.present.push(settingsRel)
    }

    // 4. branch protection on develop: probe → refuse-if-missing, OR provision when opted in.
    //    develop is a PRECONDITION — scaffold does not create it (a missing develop
    //    makes the probe fail loud, which is acceptable).
    //    D74 (run-scoped, default): `--provision` writes the light BASELINE profile
    //    (developBaselineStatusChecks for non-admins, strict off, admins bypass) —
    //    the strict run profile is escalated per-run at `run create` and dropped at
    //    every run-terminal path. The unconditional PUT is also the one-shot
    //    migration for repos stuck on the old permanent strict profile.
    //    `permanent`: the pre-D74 behavior verbatim.
    const branch = opts.config.git.baseBranch
    const runScoped = opts.config.git.developProtection === 'run-scoped'
    // Per-repo extras (gates.json `requiredChecks` / `requireMutationAtRest`)
    // merge into both profiles — additive-only, so risk-invariance holds.
    const profiles = effectiveProfiles(opts.config.git, requiredCheckExtras(gates.contract))
    const required = runScoped ? profiles.baseline : profiles.run
    let state = await probeProtection({
        ghClient: opts.ghClient,
        owner: opts.owner,
        repo: opts.repo,
        branch,
    })
    let provisioned = false
    if (opts.provision) {
        if (runScoped) {
            if (await (opts.hasActiveRun?.() ?? Promise.resolve(false))) {
                throw new UsageError(
                    `--provision refused: an active run exists for ${opts.owner}/${opts.repo} — writing the ` +
                        `baseline now would downgrade the escalated protection on '${branch}' mid-run. ` +
                        `Finish or cancel the run first.`
                )
            }
            await putBaselineProtection({
                ghClient: opts.ghClient,
                owner: opts.owner,
                repo: opts.repo,
                branch,
                contexts: required,
            })
            state = await probeProtection({ghClient: opts.ghClient, owner: opts.owner, repo: opts.repo, branch})
        } else {
            state = await provisionProtection({
                ghClient: opts.ghClient,
                owner: opts.owner,
                repo: opts.repo,
                branch,
                requiredChecks: required,
                provision: true,
            })
        }
        provisioned = true
    }
    // Assert the gate in both paths: a post-provision re-probe must satisfy it too.
    // Run-scoped asserts the RELAXED gate (enabled + baseline contexts, strict not
    // required — the baseline deliberately runs strict-off); strict + full contexts
    // are asserted per-run at escalation time instead.
    requireProtectionOrRefuse(state, required, branch, {requireStrict: !runScoped})

    return {
        repo: `${opts.owner}/${opts.repo}`,
        files_created: lists.created,
        files_present: lists.present,
        files_updated: lists.updated,
        protection: {
            enabled: state.enabled,
            strict_up_to_date: state.strictUpToDate,
            required_status_checks: state.requiredStatusChecks,
            provisioned,
        },
        settings: {
            created: settings.created,
            changed: settings.changed,
            local: {created: settings.local.created, changed: settings.local.changed},
        },
        stack: gates.stack,
        gates_contract: gates.status,
    }
}

/**
 * Test seam for {@link run}'s repo resolution: inject the git seam + cwd so the
 * auto-derive path (Prompt G) is exercised with a fake remote. Production passes
 * the real {@link DefaultGitClient} + `process.cwd()`.
 */
export interface ScaffoldRepoOverrides {
    readonly gitClient?: GitClient
    readonly cwd?: string
}

/**
 * Resolve the scaffold target's `<owner>/<name>` — `--repo` is OPTIONAL (Prompt G),
 * auto-derived from the origin remote when omitted; an explicit value that
 * disagrees with the remote fails loud.
 */
export async function resolveScaffoldRepo(
    args: ReturnType<typeof parseArgs>,
    overrides: ScaffoldRepoOverrides = {}
): Promise<{owner: string; repo: string}> {
    const slug = await resolveRepo({
        explicit: optionalString(args.flag('repo')),
        cwd: overrides.cwd ?? process.cwd(),
        gitClient: overrides.gitClient ?? new DefaultGitClient(),
    })
    return splitRepoSlug(slug)
}

async function run(argv: string[]): Promise<ExitCode> {
    const args = parseArgs(argv, {booleans: ['provision']})
    if (args.flag('help') === true) {
        return emitHelp(HELP)
    }

    // --waive takes exactly "mutation" or "coverage" (the scaffold-waivable gates).
    const waived = args.all('waive').map(String)
    for (const w of waived) {
        if (w !== 'mutation' && w !== 'coverage') {
            throw new UsageError(`--waive accepts only 'mutation' or 'coverage' (got '${w}')`)
        }
    }

    const {owner, repo} = await resolveScaffoldRepo(args)
    // Resolve the CANONICAL data dir ONCE at the command boundary (corrects the
    // foreign-plugin env-var leak). resolveDataDir() throwing on an unresolvable dir
    // is the correct loud failure — there is deliberately no placeholder fallback.
    const dataDir = resolveDataDir()
    const report = await runScaffold({
        targetRoot: process.cwd(),
        templatesDir: resolveTemplatesDir(),
        owner,
        repo,
        config: loadConfig(),
        ghClient: new DefaultGhClient(),
        // Bake the resolved data dir into the target permission rules.
        dataDirRules: buildTargetDataDirRules({dataDir, home: homedir()}),
        provision: args.flag('provision') === true,
        hasActiveRun: () => new StateManager({dataDir}).hasOtherActiveForRepo(`${owner}/${repo}`),
        waiveMutation: waived.includes('mutation'),
        waiveCoverage: waived.includes('coverage'),
    })
    emitJson(report)
    return EXIT.OK
}

export const scaffoldCommand: Subcommand = {
    describe: 'Prepare a repo (templates + develop branch protection) for the pipeline',
    run: withUsageGuard('scaffold', run),
}
