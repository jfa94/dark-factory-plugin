/**
 * Per-run integration branch (Decision 33). Each run integrates its task PRs on a
 * PRIVATE `staging-<run-id>` branch cut from `develop` at `run create`, so an
 * unfinished run's work never sits on a shared branch — that is what lets
 * supersede/resume/rescue stay non-destructive to `develop`.
 *
 * The delimiter is a hyphen, NOT a slash: git stores refs as files, so a slashed
 * `staging/<run-id>` needs `staging` to be a directory and collides with a repo's
 * long-lived `refs/heads/staging` release branch (`develop → staging → main`).
 * A flat `staging-<run-id>` shares no path segment with `refs/heads/staging`, so
 * the two coexist regardless of the target repo's branch layout.
 */
export const RUN_STAGING_PREFIX = 'staging'

/**
 * Legacy fallback branch name for git-module call sites whose optional
 * `stagingBranch`/`base` argument is absent. Every live orchestrator path passes
 * the per-run pin (`RunState.staging_branch`); this exists only so those optional
 * parameters keep a deterministic default now that the retired `git.stagingBranch`
 * config key is gone (it was never read — every consumer parsed the schema default).
 */
export const FALLBACK_STAGING_BRANCH = 'staging'

/**
 * Map a run id to its per-run staging branch (`staging-<run-id>`). LOUD on empty.
 * Computed ONCE per run — at `run create`, which pins the result on the required
 * `RunState.staging_branch`; every later consumer reads the pin directly.
 */
export function runStagingBranch(runId: string): string {
    if (runId.length === 0) {
        throw new Error("runStagingBranch: empty run id (would yield a bare 'staging-' branch)")
    }
    return `${RUN_STAGING_PREFIX}-${runId}`
}
