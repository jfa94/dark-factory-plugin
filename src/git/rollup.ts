/**
 * WS12 — staging → develop ROLLUP (§④ "ONE full-CI gate"; Δ S).
 *
 * After every task PR has serial-merged into `staging`, the rollup opens ONE PR
 * (head = staging, base = develop), waits for the single full-CI gate to resolve,
 * and squash-merges it into develop. Decision 34: develop receives only COMPLETE
 * runs, so the rollup is only ever called on a fully-completed run (no partial path).
 * NEVER targets `main` (D16 — enforced here and upstream by {@link ensureStaging}).
 *
 * PURE over {@link GhClient}: no StateManager, no report/issue knowledge. The
 * finalize coordinator builds the report, posts the PRD-issue failure comment on a
 * dropped run, and calls THIS for the git mechanics only — keeping the dependency
 * direction right (src/git is a lower layer than src/scoring / src/orchestrator).
 *
 * Idempotent (resume-safe): a finalize that died mid-rollup re-enters here. A
 * single `pr list --state all` distinguishes (a) already-merged → short-circuit
 * (re-creating would fail "no commits between develop and staging"); (b) an open
 * rollup PR → resume it; (c) none → create. So a kill between create+merge never
 * opens a duplicate and never double-merges.
 *
 * no-merge cutover mode: the coordinator passes `merge:false` (ShipMode `no-merge`)
 * so the rollup PR is OPENED for inspection but never auto-merged (plan §V step 4).
 */
import {createLogger} from '../shared/index.js'
import {FALLBACK_STAGING_BRANCH} from './run-staging.js'
import {GitSchema} from '../config/schema.js'
import type {ChecksState, GhClient} from './gh-client.js'

const log = createLogger('git')

const GIT_DEFAULTS = GitSchema.parse({})

export const DEFAULT_POLL_INTERVAL_MS = 15_000
// Fallback when the caller passes no maxPolls; finalize derives the real bound
// from `git.rollupCiWaitMinutes` (default 30 min).
const DEFAULT_MAX_POLLS = 80 // ~20 min at 15s

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * True iff `err` is the specific `gh pr merge` failure GitHub raises when branch
 * protection on `base` blocks an IMMEDIATE merge (e.g. a required status check
 * that only the merge queue / auto-merge satisfies) even though this module's own
 * CI + mergeable checks just passed. NOT a general "any merge failure" catch —
 * anything else (auth, rate-limit, a genuinely non-mergeable PR) re-throws.
 */
function isBranchPolicyBlock(err: unknown): boolean {
    return err instanceof Error && /base branch policy prohibits the merge/i.test(err.message)
}

/** Args to {@link rollup}. */
export interface RollupArgs {
    ghClient: GhClient
    /** Head branch. Defaults to the configured staging branch. */
    stagingBranch?: string
    /** Base branch. Defaults to the configured base (`develop`). NEVER `main`. */
    baseBranch?: string
    /** Rollup PR title (also the squash subject — develop only ever gets a complete run, Decision 34). */
    title: string
    /** Rollup PR body — the run report markdown is the natural fit. */
    body: string
    /**
     * `true` (live) → wait for CI + squash-merge. `false` (no-merge cutover) → open
     * the PR and stop. The coordinator maps ShipMode (`live`/`no-merge`) → this.
     */
    merge: boolean
    /** Poll interval between CI reads (ms). Default 15_000. */
    pollIntervalMs?: number
    /** Max CI polls before giving up → `ci-timeout`. Default 80. */
    maxPolls?: number
    /** Injectable sleep (tests pass a no-op). Default a real timer. */
    sleep?: (ms: number) => Promise<void>
}

/** Why the rollup did not merge (absent when `merged`). */
export type RollupNotMergedReason = 'no-merge' | 'ci-failing' | 'ci-timeout' | 'not-mergeable' | 'auto-armed'

/** Result of {@link rollup}. */
export interface RollupResult {
    number: number
    url: string
    /** True iff an existing rollup PR was reused (open or already-merged). */
    resumed: boolean
    merged: boolean
    /** The squash subject used (the plain rollup title). Set when merged. */
    subject?: string
    /** Why not merged. Absent when `merged`. */
    reason?: RollupNotMergedReason
    /** Terminal CI state observed. Absent in no-merge mode / resume short-circuit. */
    ci?: ChecksState
}

/**
 * Poll the PR's CI until it leaves `pending` or the poll budget is exhausted.
 * Returns the terminal state; a budget exhaustion returns the last `pending`
 * reading (the caller maps it to `ci-timeout`).
 */
async function waitForCi(gh: GhClient, number: number, args: RollupArgs): Promise<ChecksState> {
    const sleep = args.sleep ?? realSleep
    const interval = args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const maxPolls = args.maxPolls ?? DEFAULT_MAX_POLLS
    let state: ChecksState = 'pending'
    for (let i = 0; i < maxPolls; i++) {
        state = await gh.prChecks(number)
        if (state !== 'pending') {
            return state
        }
        if (i < maxPolls - 1) {
            await sleep(interval)
        }
    }
    return state
}

/**
 * Open (or resume) the staging→develop rollup PR and, in live mode, gate it on the
 * single full-CI run before squash-merging into develop. See the module header for
 * the idempotency contract.
 */
export async function rollup(args: RollupArgs): Promise<RollupResult> {
    const staging = args.stagingBranch ?? FALLBACK_STAGING_BRANCH
    const base = args.baseBranch ?? GIT_DEFAULTS.baseBranch
    if (base === 'main') {
        throw new Error("rollup: baseBranch must not be 'main' (Decision 16 — the factory never touches main)")
    }
    const subject = args.title

    // Single lookup over ALL states → distinguish already-merged / open / none.
    const existing = await args.ghClient.prList({head: staging, base, state: 'all'})
    const merged = existing.find((p) => p.state === 'MERGED')
    if (merged) {
        log.info(`rollup PR #${merged.number} already merged into ${base} — finalize resuming`)
        return {number: merged.number, url: merged.url ?? '', resumed: true, merged: true, subject}
    }

    const open = existing.find((p) => p.state === 'OPEN')
    let number: number
    let url: string
    let resumed: boolean
    if (open) {
        log.info(`resuming rollup PR #${open.number} (${staging}→${base})`)
        number = open.number
        url = open.url ?? ''
        resumed = true
    } else {
        const created = await args.ghClient.prCreate({
            base,
            head: staging,
            title: args.title,
            body: args.body,
        })
        log.info(`opened rollup PR #${created.number} (${staging}→${base})`)
        number = created.number
        url = created.url
        resumed = false
    }

    // no-merge cutover: leave the PR open for human inspection, never auto-merge.
    if (!args.merge) {
        log.info(`rollup PR #${number}: no-merge mode — opened, not merged`)
        return {number, url, resumed, merged: false, reason: 'no-merge'}
    }

    // The ONE full-CI gate (§④). `none` (no checks configured) → nothing to gate.
    const ci = await waitForCi(args.ghClient, number, args)
    if (ci === 'failing') {
        log.warn(`rollup PR #${number}: CI failing — not merged`)
        return {number, url, resumed, merged: false, reason: 'ci-failing', ci}
    }
    if (ci === 'pending') {
        log.warn(
            `rollup PR #${number}: CI still pending after ${args.maxPolls ?? DEFAULT_MAX_POLLS} polls — not merged`
        )
        return {number, url, resumed, merged: false, reason: 'ci-timeout', ci}
    }

    // Confirm mergeable just before the squash (CI green ≠ conflict-free).
    const view = await args.ghClient.prView(number, ['number', 'state', 'mergeable', 'mergeStateStatus'])
    if (view.state === 'MERGED') {
        return {number, url, resumed, merged: true, subject, ci}
    }
    if (view.mergeable === 'CONFLICTING') {
        log.warn(`rollup PR #${number} is CONFLICTING — not merged`)
        return {number, url, resumed, merged: false, reason: 'not-mergeable', ci}
    }

    try {
        await args.ghClient.prMergeSquash(number, {subject, body: args.body})
        log.info(`rollup PR #${number} squash-merged into ${base}`)
        return {number, url, resumed, merged: true, subject, ci}
    } catch (err) {
        if (!isBranchPolicyBlock(err)) {
            throw err
        }
        // Surgical fallback, NOT an unconditional --auto (that would error on a repo
        // with no branch protection at all — `gh pr merge --auto` requires auto-merge
        // to be enabled). Retry ONCE, arming the merge to land once GitHub's own
        // policy is satisfied; the PR is armed, not merged, so this is still a
        // `merged: false` outcome — finalize's existing not-merged path (PRD
        // comment/close skipped, staging branch retained) applies unchanged.
        log.warn(`rollup PR #${number}: base branch policy prohibits an immediate merge — arming --auto`)
        await args.ghClient.prMergeSquash(number, {subject, body: args.body, auto: true})
        return {number, url, resumed, merged: false, reason: 'auto-armed', ci}
    }
}
