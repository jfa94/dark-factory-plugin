/**
 * WS3 — idempotent PR create (Δ P).
 *
 * The resume-after-kill window: a run can die AFTER `gh pr create` succeeded but
 * BEFORE the orchestrator recorded `pr_number` in state.json. On resume, blindly
 * creating a PR would open a DUPLICATE. The fix: ALWAYS look up by head branch
 * first (`gh pr list --head <branch>`); only create when no open PR exists.
 *
 * This module is PURE over GhClient — it never reads/writes StateManager (WS3 is
 * a reporter; the orchestrator persists `{number}` via StateManager.updateTask). It
 * tests against the fake with zero network.
 */
import {createLogger} from '../shared/index.js'
import {FALLBACK_STAGING_BRANCH} from './run-staging.js'
import type {GhClient} from './gh-client.js'

const log = createLogger('git')

/** Args to {@link createTaskPrIdempotent}. */
export interface CreateTaskPrArgs {
    ghClient: GhClient
    /** Head branch (the run-scoped task branch). */
    branch: string
    title: string
    body: string
    /** Base branch to target. Defaults to the configured staging branch. */
    base?: string
    /**
     * The PR number state currently remembers for this task, if any. Gates the
     * MERGED-PR fallback: a MERGED PR is rebound ONLY when it matches this number
     * (true post-merge-crash resume). When state has forgotten it (e2e-reopen cleared
     * `pr_number`), the fallback is skipped and a FRESH PR opens for the new commits.
     */
    knownPrNumber?: number | undefined
}

/** Result of {@link createTaskPrIdempotent}. */
export interface TaskPrResult {
    number: number
    url: string
    /** True iff an existing open PR was found (no new PR opened). */
    resumed: boolean
}

/**
 * Create the task PR, or RESUME the existing one. Looks up by head branch FIRST
 * (Δ P) so a kill between create+record never opens a duplicate. Returns the PR
 * number + url and whether it was resumed.
 */
export async function createTaskPrIdempotent(args: CreateTaskPrArgs): Promise<TaskPrResult> {
    const base = args.base ?? FALLBACK_STAGING_BRANCH

    // Δ P: look up by head FIRST (state "all"). A kill can land after the PR was
    // opened OR even after it MERGED but before the run recorded `done` — BOTH are
    // the same logical PR, and re-creating either would open a duplicate (or hit
    // "no commits between" once the squashed branch diverged from staging). Prefer
    // an OPEN PR (the normal resume). The MERGED fallback (post-merge-crash resume, so
    // ship re-enters and the serial-writer merge step idempotently no-ops) is GATED on
    // `knownPrNumber`: rebind a MERGED PR ONLY when state still remembers that exact
    // number. e2e-reopen re-runs a `done` task with NEW commits on the SAME
    // deterministic branch and clears `pr_number` first (resetTaskRow's `clearShippedPr`)
    // → `knownPrNumber` is undefined → the old MERGED PR is NOT rebound and a FRESH PR
    // opens for the new commits. Without this gate the old merged PR is rebound and the
    // serializer no-ops the reopened fix into oblivion (it never reaches staging).
    // A CLOSED-unmerged PR is NOT a resume target (manual intervention) — fall through
    // and open a fresh PR.
    const existing = await args.ghClient.prList({head: args.branch, base, state: 'all'})
    const mergedResume =
        args.knownPrNumber !== undefined
            ? existing.find((p) => p.state === 'MERGED' && p.number === args.knownPrNumber)
            : undefined
    const pr = existing.find((p) => p.state === 'OPEN') ?? mergedResume
    if (pr !== undefined) {
        log.info(`resuming existing PR #${pr.number} (${pr.state}) for head '${args.branch}' (no duplicate created)`)
        return {number: pr.number, url: pr.url ?? '', resumed: true}
    }

    const created = await args.ghClient.prCreate({
        base,
        head: args.branch,
        title: args.title,
        body: args.body,
    })
    log.info(`created PR #${created.number} for head '${args.branch}'`)
    return {number: created.number, url: created.url, resumed: false}
}
