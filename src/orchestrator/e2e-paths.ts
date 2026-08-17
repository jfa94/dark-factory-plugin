/**
 * The e2e coroutine's PATH + BOOT resolution (Decision 39/40): worktree/branch names,
 * the boot pair, and the two Playwright env builders. Split out of `e2e.ts` as a leaf
 * (pure path/env math, no dependency on the coroutine core); `e2e.ts` re-exports the
 * worktree-path names the tests import.
 */
import {join} from 'node:path'
import type {Config, RunState} from './deps.js'

// All four e2e dirs live under `<workDir>/<runId>/` (`.claude/worktrees` — the
// protected-path exemption, Decision 67) — the agent-WRITABLE sibling of the
// TCB-write-denied `runs/` tree (core/state/paths.ts). They originally lived under
// `runs/<runId>/…`, where the `data-runs` deny rule blocked the e2e-author's own
// Write calls into its worktree (verified live, Decision 40). The DOT prefix makes
// collision with a task worktree `<runId>/<taskId>` impossible (task ids are
// validateId-constrained to [a-zA-Z0-9_-], never a leading dot), and the pipeline-guards
// write-scope arm resolves run `<runId>` (exists) / task `.e2e-…` (unknown → no scope).

/**
 * Repo-relative directory the COMMITTED critical e2e suite lives in. Persistence in
 * this directory IS the criticality signal (Decision 39) — no `@critical` tag exists.
 * NOT configurable: the scaffolded `templates/playwright.config.ts` hardcodes `e2e/`
 * and the TCB write-deny protects the literal path, so a config knob could only
 * silently diverge from what actually runs (the retired `e2e.testDir` key's
 * superRefine already rejected every non-default value). Lives here (the e2e
 * path leaf) rather than the config schema — it is a path constant, not a knob.
 */
export const E2E_TEST_DIR = 'e2e'

/** The e2e-phase author worktree path (torn down once its specs are merged/rejected). */
export function e2eWorktreePath(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-author')
}

/** The persistent "run the suite against current staging" worktree — reused every pass. */
export function e2eRunWorktreePath(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-run')
}

/** Scratch worktree used ONLY for the fail-first base-side proof (removed after use). */
export function e2eBaseProofWorktreePath(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-base-proof')
}

/** The run's ephemeral throwaway-spec directory — gitignored (under the repo's
 * `.claude/worktrees/`, D67), so never committed; discarded at run end. */
export function e2eThrowawayDir(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-throwaway')
}

/** The adjudicator's worktree (D7) — torn down once its spec updates are merged/rejected. */
export function e2eAdjudicateWorktreePath(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-adjudicate')
}

export function e2eBranchName(runId: string): string {
    return `e2e-${runId}`
}

export function adjudicateBranchName(runId: string): string {
    return `e2e-adjudicate-${runId}`
}

/** The boot pair every Playwright invocation + author prompt needs. */
export interface BootConfig {
    readonly startCommand: string
    readonly baseURL: string
}

/**
 * Single source of truth for boot config (Decision 40 D10): an operator config
 * override wins; otherwise the values the run-start ASSESSMENT resolved (and wrote
 * into the repo's `playwright.config.ts`). `null` = genuinely unknown — the caller
 * suspends/fails loud rather than booting with a fabricated command.
 */
export function resolveBootConfig(cfg: Config['e2e'], run: RunState): BootConfig | null {
    const startCommand = cfg.startCommand ?? run.e2e_assessment?.resolved?.start_command
    const baseURL = cfg.baseURL ?? run.e2e_assessment?.resolved?.base_url
    return startCommand !== undefined && baseURL !== undefined ? {startCommand, baseURL} : null
}

/**
 * The env every Playwright invocation gets — read by the scaffolded
 * `templates/playwright.config.ts`'s `webServer` block so the app boots the
 * SAME command/URL/timeout the engine resolved ({@link resolveBootConfig}),
 * fresh every run (`FACTORY_E2E=1` forces `reuseExistingServer: false`).
 */
function e2eEnv(cfg: Config['e2e'], boot: BootConfig): Record<string, string> {
    return {
        BASE_URL: boot.baseURL,
        FACTORY_E2E_START_COMMAND: boot.startCommand,
        FACTORY_E2E_READY_TIMEOUT_MS: String(cfg.readyTimeoutMs),
        FACTORY_E2E: '1',
    }
}

/**
 * The env an AUTHORED SPEC actually executes with (Decision 39 W5). The spec file
 * is autonomously-authored, unreviewed code — it must not inherit the parent
 * process's full environment (CI tokens, cloud creds, ...). Allowlists exactly
 * PATH/HOME (so node/npm/the Playwright bin's shebang still resolves) plus the
 * {@link e2eEnv} vars the scaffolded `webServer` block reads. Pass alongside
 * `replaceEnv: true` so `exec` does NOT merge this over `process.env`.
 */
export function scrubbedE2eEnv(cfg: Config['e2e'], boot: BootConfig): Record<string, string> {
    const env = e2eEnv(cfg, boot)
    for (const key of ['PATH', 'HOME']) {
        const v = process.env[key]
        if (v !== undefined) {
            env[key] = v
        }
    }
    return env
}
