/**
 * WS3 — SERIAL WRITER #1 (Δ L, §9.2).
 *
 * Merges into `staging` are serialized in EVERY mode: task PRs land ONE at a
 * time. The mechanism is an app-level merge LOCK (proper-lockfile, the SAME lock
 * primitive WS1's StateManager uses) on a data-dir merge-lock file, plus
 * required-branches-up-to-date enforcement (which works on ANY GitHub plan):
 *
 *   acquire lock
 *     -> verify the PR is mergeable AND its head is up-to-date with staging
 *     -> if BEHIND: refuse/yield (no force-push, no rebase-publish — global rule)
 *     -> `gh pr merge --squash` (NOT N concurrent `--auto`)
 *   release lock
 *
 * Probe-detected upgrade: if mergeQueueProbe() reports native GitHub merge-queue,
 * enqueue via `--auto` and let GitHub serialize instead (still one logical
 * serializer; never N concurrent app-level merges). merge-queue-as-default is v2.
 *
 * The app-level lock NEVER arms N concurrent `--auto`: two concurrent merge()
 * calls observe strictly non-overlapping critical sections.
 */
import {join} from 'node:path'
import {FALLBACK_STAGING_BRANCH} from './run-staging.js'
import {createLogger, withFileLock, DEFAULT_FILE_LOCK_TUNING, type FileLockTuning} from '../shared/index.js'
import {resolveDataDir, type DataDirOptions} from '../config/load.js'
import type {GhClient, PullRequest} from './gh-client.js'

const log = createLogger('git')

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Issue #1 (transient not-mergeable false positive): right after a PR is pushed/
// updated, GitHub reports `mergeable: UNKNOWN` for a beat while it computes
// mergeability in the background — not a real conflict. 5 tries * 2s = ~10s ceiling.
// ponytail: keep maxTries*intervalMs well under MERGE_LOCK_DEFAULTS.stale (30s below)
// — the poll runs INSIDE the merge lock, so approaching the stale window risks a
// concurrent acquirer breaking the "stale" lock mid-poll and racing a second merge.
const DEFAULT_MERGEABILITY_POLL_MAX_TRIES = 5
const DEFAULT_MERGEABILITY_POLL_INTERVAL_MS = 2_000

// Merge-queue landing poll: an `--auto` enqueue is a PROMISE to merge, not a
// merge — the queue runs CI (minutes, not seconds) and can kick the PR out.
// 30 tries * 10s = ~5min ceiling. Holding the merge lock that long is safe:
// proper-lockfile auto-refreshes the lockfile mtime (update = stale/2), so the
// lock never goes stale under a live holder.
const DEFAULT_MERGE_QUEUE_POLL_MAX_TRIES = 30
const DEFAULT_MERGE_QUEUE_POLL_INTERVAL_MS = 10_000

/**
 * Lock tuning — the shared {@link FileLockTuning}; kept as a local alias so the
 * re-export from `./index.ts` stays stable.
 */
export type MergeLockTuning = FileLockTuning

/**
 * Merge overrides on the shared baseline: a git+GitHub merge legitimately runs
 * longer than a state write, so widen the stale window and retry budget.
 */
const MERGE_LOCK_DEFAULTS: MergeLockTuning = {
    ...DEFAULT_FILE_LOCK_TUNING,
    stale: 30_000,
    retries: 100,
    retryMinTimeout: 25,
    retryMaxTimeout: 1000,
}

/** Outcome of a {@link MergeSerializer.merge} attempt. */
export type MergeOutcome =
    | {merged: true; via: 'app-level' | 'merge-queue'; number: number}
    | {merged: false; reason: 'behind' | 'not-mergeable'; number: number}

/**
 * Bounds the transient-UNKNOWN mergeability poll (Issue #1). All fields optional;
 * defaults give a ~10s ceiling — see the module-level constants.
 */
export interface MergeabilityPollOptions {
    /** Max prView reads while `mergeable === 'UNKNOWN'`. Default 5. */
    maxTries?: number
    /** Delay between reads (ms). Default 2000. */
    intervalMs?: number
    /** Injectable sleep (tests pass a no-op / instrumented fn). Default a real timer. */
    sleep?: (ms: number) => Promise<void>
}

/** Options for {@link MergeSerializer}. */
export interface MergeSerializerOptions extends DataDirOptions {
    ghClient: GhClient
    owner: string
    repo: string
    /** Integration branch. Defaults to the configured staging branch. */
    stagingBranch?: string
    /** Override the merge-lock scope id (default: repo-scoped key). */
    lockScope?: string
    lock?: Partial<MergeLockTuning>
    /** Override the transient-UNKNOWN mergeability poll bounds (Issue #1). */
    mergeabilityPoll?: MergeabilityPollOptions
    /** Override the merge-queue landing poll bounds (default 30 × 10s ≈ 5min). */
    mergeQueuePoll?: MergeabilityPollOptions
}

/**
 * Serializes task-PR merges into staging behind an app-level lock. The lock is
 * REPO-SCOPED by default (keyed on owner/repo + staging branch) so concurrent
 * RUNS sharing the same staging branch still serialize (§9.2: staging is THE
 * single serial writer).
 */
export class MergeSerializer {
    private readonly ghClient: GhClient
    private readonly owner: string
    private readonly repo: string
    private readonly staging: string
    private readonly dataDir: string
    private readonly lockScope: string
    private readonly tuning: MergeLockTuning
    private readonly mergeabilityPollMaxTries: number
    private readonly mergeabilityPollIntervalMs: number
    private readonly mergeabilityPollSleep: (ms: number) => Promise<void>
    private readonly mergeQueuePollMaxTries: number
    private readonly mergeQueuePollIntervalMs: number
    private readonly mergeQueuePollSleep: (ms: number) => Promise<void>

    constructor(opts: MergeSerializerOptions) {
        this.ghClient = opts.ghClient
        this.owner = opts.owner
        this.repo = opts.repo
        this.staging = opts.stagingBranch ?? FALLBACK_STAGING_BRANCH
        this.dataDir = resolveDataDir(opts)
        this.lockScope = opts.lockScope ?? `${opts.owner}__${opts.repo}__${this.staging}`.replace(/[^\w.-]/g, '-')
        this.tuning = {...MERGE_LOCK_DEFAULTS, ...(opts.lock ?? {})}
        this.mergeabilityPollMaxTries = opts.mergeabilityPoll?.maxTries ?? DEFAULT_MERGEABILITY_POLL_MAX_TRIES
        this.mergeabilityPollIntervalMs = opts.mergeabilityPoll?.intervalMs ?? DEFAULT_MERGEABILITY_POLL_INTERVAL_MS
        this.mergeabilityPollSleep = opts.mergeabilityPoll?.sleep ?? realSleep
        this.mergeQueuePollMaxTries = opts.mergeQueuePoll?.maxTries ?? DEFAULT_MERGE_QUEUE_POLL_MAX_TRIES
        this.mergeQueuePollIntervalMs = opts.mergeQueuePoll?.intervalMs ?? DEFAULT_MERGE_QUEUE_POLL_INTERVAL_MS
        this.mergeQueuePollSleep = opts.mergeQueuePoll?.sleep ?? realSleep
    }

    private lockfilePath(): string {
        return join(this.dataDir, 'locks', `merge-${this.lockScope}.lock`)
    }

    /** Run `fn` while holding the app-level merge lock (the serial section). */
    private async withMergeLock<T>(fn: () => Promise<T>): Promise<T> {
        return withFileLock(
            {
                dir: join(this.dataDir, 'locks'),
                lockfile: this.lockfilePath(),
                label: `merge '${this.lockScope}'`,
                dirPolicy: 'create',
                tuning: this.tuning,
            },
            fn
        )
    }

    /**
     * Serial-merge one task PR into staging. Acquires the app-level lock, RE-VERIFIES
     * mergeable + up-to-date against the CURRENT staging tip (so the 2nd of two
     * queued merges re-checks against the post-first-merge state), then either
     * enqueues via native merge-queue (probe upgrade) or squash-merges now. NEVER
     * arms N concurrent `--auto`.
     */
    async merge(prNumber: number): Promise<MergeOutcome> {
        return this.withMergeLock(async () => {
            // Re-read the PR INSIDE the lock — its mergeable/up-to-date state may have
            // changed since the caller queued (e.g. a prior merge advanced staging).
            // Polls while GitHub is still computing mergeability (Issue #1).
            const pr = await this.readSettledPr(prNumber)

            // Idempotent resume (Δ P): ship can crash AFTER the merge lands but BEFORE
            // the run records `done` (e.g. a post-merge cleanup error). Re-running drive
            // — the sanctioned retry — re-enters here; re-merging a MERGED PR errors, so
            // treat it as success and (best-effort) finish the remote-ref cleanup that
            // the interrupted attempt may have skipped.
            if (pr.state === 'MERGED') {
                log.info(`PR #${prNumber} already MERGED into ${this.staging} — ship resuming`)
                await this.deleteMergedHeadBestEffort(pr.headRefName)
                return {merged: true, via: 'app-level', number: prNumber}
            }

            if (pr.mergeable === 'CONFLICTING') {
                log.warn(`PR #${prNumber} is CONFLICTING — not merged`)
                return {merged: false, reason: 'not-mergeable', number: prNumber}
            }

            // Up-to-date enforcement (Δ L): GitHub reports BEHIND when the head is not
            // on top of the latest staging. We REFUSE and surface for the producer
            // fix-loop — no force-push, no rebase-publish (global rule). The producer
            // re-syncs and we retry on a later turn.
            if (pr.mergeStateStatus === 'BEHIND') {
                log.warn(`PR #${prNumber} head is BEHIND ${this.staging} — refusing to merge (no force-push)`)
                return {merged: false, reason: 'behind', number: prNumber}
            }

            // Probe for native merge-queue (optional upgrade). When present, enqueue via
            // --auto and let GitHub serialize. Otherwise app-level squash-merge now. The
            // probe THROWS on a "couldn't tell" gh failure (auth/rate-limit/5xx); CONTAIN
            // it here — log and degrade to app-level squash rather than letting it crash
            // `factory next-action` (which catches only UsageError, so a bare throw would WEDGE
            // the run). The degrade is benign: both paths squash-merge, only --auto differs.
            let hasMergeQueue = false
            try {
                hasMergeQueue = await this.ghClient.mergeQueueProbe(this.owner, this.repo, this.staging)
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err)
                log.warn(`merge-queue probe failed (${detail}) — falling back to app-level squash`)
            }
            if (hasMergeQueue) {
                await this.ghClient.prMergeSquash(prNumber, {auto: true, deleteBranch: true})
                log.info(`PR #${prNumber} enqueued via native merge-queue — polling until the queue lands it`)
                return this.awaitQueueMerge(prNumber)
            }

            // App-level squash NOW only when GitHub confirms the PR is actually mergeable.
            // CLEAN, HAS_HOOKS, and UNSTABLE (only non-required checks red) all merge fine
            // via `gh pr merge --squash`. Everything else — BLOCKED (required checks still
            // pending), UNKNOWN (mergeability still computing), DIRTY, DRAFT — would make the
            // squash exit nonzero and THROW out of merge()→shipTask→next-action (which catches
            // only UsageError), WEDGING the run on every drive. Refuse instead: ship turns a
            // {merged:false} into a bounded wait-retry (ship.ts) and re-checks on a later turn.
            // NOTE: this is placed AFTER the merge-queue branch on purpose — a native queue's
            // --auto legitimately waits out BLOCKED, so only the app-level path is gated.
            const mergeableNow =
                pr.mergeStateStatus === 'CLEAN' ||
                pr.mergeStateStatus === 'HAS_HOOKS' ||
                pr.mergeStateStatus === 'UNSTABLE'
            if (!mergeableNow) {
                log.warn(
                    `PR #${prNumber} not mergeable now (mergeStateStatus=${pr.mergeStateStatus ?? 'unset'}) — ` +
                        'refusing app-level squash; ship will wait-retry'
                )
                return {merged: false, reason: 'not-mergeable', number: prNumber}
            }

            // Squash-merge NOW, then delete ONLY the remote head ref. We deliberately do
            // NOT pass --delete-branch: gh would also `git branch -D` the local branch,
            // which the per-task worktree holds checked-out (preflight `checkout -B`), so
            // that delete fails and takes the already-succeeded merge down with it
            // (exit 1). Splitting the remote-ref delete out keeps the merge worktree-safe;
            // the local branch/worktree are ephemeral data-dir state torn down with the run.
            await this.ghClient.prMergeSquash(prNumber, {})
            log.info(`PR #${prNumber} squash-merged into ${this.staging} (app-level serial)`)
            await this.deleteMergedHeadBestEffort(pr.headRefName)
            return {merged: true, via: 'app-level', number: prNumber}
        })
    }

    /**
     * Read the PR, polling while GitHub is still computing mergeability
     * (`mergeable === 'UNKNOWN'`) — Issue #1: a fresh push/update reports UNKNOWN
     * for a beat while GitHub's background mergeability job runs. Treating that as
     * a real refusal burns a full exec resync (MERGE_RESYNC_CAP) on a PR that was
     * actually fine. Stops as soon as `mergeable` settles to ANY terminal value
     * (MERGEABLE or CONFLICTING) or the budget is spent — still-UNKNOWN after the
     * budget falls through UNCHANGED to the existing refuse-and-resync path, so
     * this is never worse than today's behavior.
     *
     * NOTE: does NOT poll on `mergeStateStatus === 'UNKNOWN'` alone — that field
     * co-settles with `mergeable` in practice, and gating strictly on `mergeable`
     * keeps the poll narrow (see the serial-writer tests for the exact contract).
     */
    private async readSettledPr(prNumber: number): Promise<PullRequest> {
        const fields = ['number', 'headRefName', 'baseRefName', 'state', 'mergeable', 'mergeStateStatus']
        let pr = await this.ghClient.prView(prNumber, fields)
        for (let tries = 1; pr.mergeable === 'UNKNOWN' && tries < this.mergeabilityPollMaxTries; tries++) {
            await this.mergeabilityPollSleep(this.mergeabilityPollIntervalMs)
            pr = await this.ghClient.prView(prNumber, fields)
        }
        return pr
    }

    /**
     * After a merge-queue `--auto` enqueue, poll until GitHub actually LANDS the
     * PR (`state === 'MERGED'`). An enqueue is a promise to merge, not a merge —
     * the queue can kick the PR out (CI failure) leaving it OPEN/CLOSED forever;
     * reporting `merged: true` at enqueue recorded a possibly-unmerged PR as done
     * (silent partial delivery). Exhaustion / a CLOSED PR → `not-mergeable`: ship
     * turns that into a bounded wait-retry, and a later drive re-enters merge()'s
     * idempotent MERGED-resume branch if the queue landed it in the meantime.
     */
    private async awaitQueueMerge(prNumber: number): Promise<MergeOutcome> {
        for (let tries = 0; tries < this.mergeQueuePollMaxTries; tries++) {
            await this.mergeQueuePollSleep(this.mergeQueuePollIntervalMs)
            const pr = await this.ghClient.prView(prNumber, ['number', 'state'])
            if (pr.state === 'MERGED') {
                log.info(`PR #${prNumber} landed via native merge-queue`)
                return {merged: true, via: 'merge-queue', number: prNumber}
            }
            if (pr.state === 'CLOSED') {
                log.warn(`PR #${prNumber} was CLOSED without merging — the queue kicked it out`)
                return {merged: false, reason: 'not-mergeable', number: prNumber}
            }
        }
        log.warn(
            `PR #${prNumber} still unmerged after the merge-queue poll budget ` +
                `(${this.mergeQueuePollMaxTries} × ${this.mergeQueuePollIntervalMs}ms) — refusing to report success`
        )
        return {merged: false, reason: 'not-mergeable', number: prNumber}
    }

    /**
     * Delete the merged PR's remote head ref — BEST EFFORT. The squash-merge has
     * already landed, so a failed delete is cosmetic (a leaked remote branch): WARN
     * and continue, never throw. A throw here would turn the merge success into an
     * exception and, on the sanctioned `drive` retry, re-enter the MERGED branch and
     * fail on the SAME delete again — a wedge. (Contrast the cancel `--cleanup` path,
     * which surfaces this loudly: there the ref teardown IS the whole operation.)
     */
    private async deleteMergedHeadBestEffort(headRefName: string): Promise<void> {
        try {
            await this.ghClient.deleteRemoteBranch(this.owner, this.repo, headRefName)
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err)
            log.warn(
                `post-merge cleanup: failed to delete remote head ref '${headRefName}' ` +
                    `(merge already landed — leaked ref is cosmetic): ${detail}`
            )
        }
    }
}
