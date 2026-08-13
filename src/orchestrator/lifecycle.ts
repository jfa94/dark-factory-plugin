/**
 * Run-lifecycle cores — the testable engine behind `factory run create|resume`,
 * extracted from the CLI subcommand so `run.ts` stays a thin wrapper (parse args,
 * wire deps, call these, emit one envelope; components.md).
 *
 * `createRun`/`resolveOrCreateRun` resolve a DURABLE spec, mint a run, seed its task
 * rows, and (with `stagingDeps`) cut + protect the per-run `staging-<run-id>` branch
 * (Decision 33) BEFORE persisting the run row — rollback-safe. `applyResume` re-reads
 * the LIVE quota window through the pure {@link planResume} seam and clears the
 * checkpoint when it has recovered. Seeding maps each SpecTask to a `pending`
 * TaskState carrying ONLY dependency edges (derive-don't-store for risk_tier /
 * tdd_exempt); dangling/self/cyclic/duplicate edges are caught LOUDLY at seed time.
 */
import {seedTaskRows, assertAcyclic, type StateManager} from '../core/state/index.js'
import {epochToIso} from '../shared/time.js'
import {createLogger, nowIso} from '../shared/index.js'
import {latestByTask} from '../spec/ledger.js'
import type {SpecStore, SpecManifest} from '../spec/index.js'
import {planResume, type UsageReading} from '../quota/index.js'
import {isTerminalRunStatus} from '../types/index.js'
import type {Config, RunState, RunStatus, TaskState} from '../types/index.js'
import {
    effectiveProfiles,
    ensureStaging,
    provisionProtection,
    putBaselineProtection,
    requireProtectionOrRefuse,
    runStagingBranch,
    type GitClient,
    type GhClient,
} from '../git/index.js'
import {loadRequiredCheckExtras} from '../verifier/deterministic/gate-contract.js'
import {UsageError} from '../shared/usage-error.js'

const log = createLogger('run')

/**
 * Decision 70 — flip seeded rows to `done` for tasks whose latest ledger entry's
 * SHAs are ALL ancestors of the fresh staging tip. Mutates `seeded` in place
 * (pre-persist — the run row is created from it right after). An unresolvable SHA
 * is a normal NO (the base moved past it, or the commit never reached this remote).
 */
async function seedFromLedger(
    specStore: SpecStore,
    request: SpecManifest,
    seeded: Record<string, TaskState>,
    stagingDeps: RunStagingDeps,
    stagingTip: string
): Promise<void> {
    const latest = latestByTask(await specStore.ledger(request.repo, request.spec_id))
    if (latest.size === 0) {
        return
    }
    const git = stagingDeps.gitClient
    const cwd = stagingDeps.targetRoot
    const isAncestor = async (sha: string): Promise<boolean> => {
        try {
            const resolved = await git.revParse(sha, {cwd})
            return (await git.mergeBase(resolved, stagingTip, {cwd})) === resolved
        } catch {
            return false
        }
    }
    const shippedIds: string[] = []
    for (const [taskId, entry] of latest) {
        const row = seeded[taskId]
        if (row === undefined) {
            continue // stale ledger entry for a task the (regenerated) spec no longer has
        }
        const checks = await Promise.all(entry.shas.map(isAncestor))
        if (checks.every(Boolean)) {
            seeded[taskId] = {...row, status: 'done', ended_at: nowIso()}
            shippedIds.push(taskId)
        }
    }
    if (shippedIds.length > 0) {
        log.info(
            `run create: seeded ${shippedIds.length} task(s) as already-shipped from ledger (${shippedIds.join(', ')})`
        )
    }
}

export function seedTasksFromSpec(request: SpecManifest): Record<string, TaskState> {
    const ctx = {context: 'run create', specLabel: `spec ${request.spec_id}`}
    const tasks = seedTaskRows(request.tasks, ctx)
    assertAcyclic(tasks, ctx)
    return tasks
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

/**
 * Git/gh deps needed to cut + protect the per-run staging branch (Decision 33).
 * Passed from `runCreate` into `createRunFromManifest` after all deps are wired.
 * Absent on the bare `createRun` (direct-API) path so existing unit tests that
 * call `createRun` directly continue to work without fakes.
 */
export interface RunStagingDeps {
    readonly gitClient: GitClient
    readonly ghClient: GhClient
    readonly config: Config
    readonly targetRoot: string
    /**
     * Absolute orchestrator-worktree path (`<repo-root>/.claude/worktrees/orchestrator-<run_id>`)
     * where `ensureStaging` materialises the run's staging branch — never the user's
     * primary checkout (D2). Resolved from `git rev-parse --show-toplevel` so it matches
     * the `$ORCH` the runner skill `cd`s into.
     */
    readonly orchestratorWorktreePath: string
    readonly owner: string
    readonly repo: string
}

/**
 * Selects the durable spec to run — EXACTLY one of the two keys, never both,
 * never neither. The `?: never` padding makes the XOR a genuine TYPE constraint:
 * a bare `{ issue } | { specId }` only forbids NEITHER (a both-keys object still
 * structurally satisfies `{ issue: number }`), so each arm explicitly forbids the
 * OTHER key. Both illegal states (neither / both) are now compile errors, not just
 * runtime checks. {@link resolveSpec} discriminates on the VALUE
 * (`opts.specId !== undefined`), not `"specId" in opts` — the `?: never` padding keeps
 * the unused key structurally present, so the `in` test would not discriminate cleanly.
 */
export type SpecSelector =
    | {readonly issue: number; readonly specId?: never}
    | {readonly specId: string; readonly issue?: never}

/**
 * The run-creation intent — exactly one of the mutually-exclusive lifecycle modes
 * (Decision 35). Modeled as a discriminated union so illegal combinations
 * (force+supersede, supersede+resume, …) are UN-REPRESENTABLE at compile time — the
 * same illegal-states-unrepresentable discipline {@link SpecSelector} uses for
 * issue/spec-id — replacing three independent booleans whose XOR was only runtime-checked.
 *
 *  - `"default"`   : resolve-or-report — an active run is returned as kind:"exists" (CONFLICT).
 *  - `"fresh"`     : `--new` / an explicit `--run-id` — always create, even if a run exists.
 *  - `"supersede"` : Decision 35 — terminate the active run + create a fresh one. Requires
 *                    `stagingDeps` (the gh client must be wired) to delete the old branch.
 *  - `"resume"`    : signal intent to continue the active run; currently reported as
 *                    kind:"exists" (the caller hand-off is Task 4.2).
 */
export type RunIntent =
    | {readonly intent?: 'default'}
    | {readonly intent: 'fresh'}
    | {readonly intent: 'supersede'}
    | {readonly intent: 'resume'}

/** Resolved options for {@link createRun} — {@link SpecSelector} + {@link RunIntent} + run metadata. */
export type CreateRunOptions = SpecSelector &
    RunIntent & {
        readonly repo: string
        readonly runId: string
        readonly shipMode?: RunState['ship_mode']
        /**
         * The owning Claude Code session id (Prompt J — session-scoped Stop gate),
         * stamped once onto the run so the Stop hook can session-scope its block. Absent
         * when the launching session id could not be resolved (best-effort).
         */
        readonly ownerSession?: RunState['owner_session']
        /** When true, persist `ignore_quota: true` on the run (from `--ignore-quota`). */
        readonly ignoreQuota?: boolean
        /** When true, persist `e2e: true` on the run (from `--e2e`) — opts into the e2e phase. */
        readonly e2e?: boolean
        /**
         * When true, persist `debug: true` on the run — a `/factory:debug` session
         * (Decision 39, Task 6). No CLI flag on `run create`; only the debug driver
         * (`factory debug seed`) ever passes this.
         */
        readonly debug?: boolean
    }

/**
 * Resolve the durable spec named by `opts` — by explicit spec-id when given, else
 * by the stable issue number. LOUD if no spec exists yet (a run cannot be created
 * without one). Shared by {@link createRun} (imperative) and {@link resolveOrCreateRun}
 * (resolve-or-reuse) so the spec is resolved exactly once on each path.
 */
async function resolveSpec(specStore: SpecStore, opts: CreateRunOptions): Promise<SpecManifest> {
    // The selector is a discriminated union — these two arms are exhaustive (no
    // neither/both case can reach here, so no defensive fallback is needed). Narrow
    // on the VALUE (`specId !== undefined`): the `?: never` padding keeps the unused
    // key structurally present, so `"specId" in opts` would not discriminate cleanly.
    const request =
        opts.specId !== undefined
            ? await specStore.read(opts.repo, opts.specId)
            : await specStore.resolveByIssue(opts.repo, opts.issue)
    if (request === null) {
        throw new Error(`run create: no spec for issue #${opts.issue} in ${opts.repo} — generate one first`)
    }
    // S9 preflight: the traceability stage reads the durable PRD snapshot at the
    // END of the run — refuse NOW rather than fail a fully-paid run. Every spec
    // written by `spec resolve` carries the snapshot; one without it predates the
    // current factory version.
    if (!(await specStore.hasPrd(request.repo, request.spec_id))) {
        throw new Error(
            `run create: spec ${request.spec_id} has no PRD snapshot (created by an older ` +
                `factory version) — re-run with \`--supersede\` to regenerate the spec`
        )
    }
    return request
}

/**
 * Create the run from an already-resolved request and seed its tasks — the
 * imperative core. Creates the run (status `running`), then records in the seeded
 * task rows via the one sanctioned write path; returns the seeded {@link RunState}.
 *
 * When `stagingDeps` is supplied (always from `runCreate`; absent on the bare
 * `createRun` direct-API path), cuts `staging-<run-id>` from `develop` and
 * provisions GitHub branch protection on it (Decision 33). The cut + protect runs
 * BEFORE the run row is persisted (rollback-safe): the branch name derives from
 * `opts.runId`, not the row, so a provision failure leaves NO phantom `running` row
 * and the next `run create` retries cleanly instead of returning a stranded `exists`.
 */
async function createRunFromManifest(
    state: StateManager,
    specStore: SpecStore,
    request: SpecManifest,
    opts: CreateRunOptions,
    stagingDeps?: RunStagingDeps
): Promise<RunState> {
    const seeded = seedTasksFromSpec(request)
    // Decision 33 hardening: compute the per-run staging branch ONCE and PIN it on the
    // row, so every later base-ref resolution reads this exact name (never a recompute
    // that a mid-run naming-scheme change could desync). Reused below for the actual cut.
    const branch = runStagingBranch(opts.runId)

    // Fast-fail a run-id collision BEFORE any branch mutation. The `fresh` path
    // (explicit --run-id) skips the active-run scan, so without this an id colliding
    // with a live run would fast-forward/push + re-provision THAT run's staging branch
    // via ensureStaging/provisionProtection below, only to be rejected afterward by
    // state.create. Match create()'s throw string exactly so the "clobbers loudly if
    // runId exists" contract is preserved — the throw just moves earlier.
    // ponytail: closes the deterministic --run-id reuse case; create()'s under-lock
    // re-check stays the backstop for the (unrealistic) concurrent same-id race.
    if (state.exists(opts.runId)) {
        throw new Error(`state: run '${opts.runId}' already exists`)
    }

    // Decision 33: cut + protect the per-run staging branch BEFORE persisting the run row.
    // Both helpers are state-free (they key off `branch`, derived from opts.runId) and
    // idempotent. Persisting LAST (mirrors supersedeRun's resume-safe ordering) makes
    // creation rollback-safe: if the cut/protect throws (401/403/5xx/network), no run row
    // is written, so the next `run create` sees no active run and does a clean fresh create
    // + re-provision — rather than stranding a `running` row over missing/unprotected
    // staging that neither resume nor the task loop ever re-provisions.
    if (stagingDeps !== undefined) {
        const staging = await ensureStaging({
            gitClient: stagingDeps.gitClient,
            stagingBranch: branch,
            baseBranch: stagingDeps.config.git.baseBranch,
            cwd: stagingDeps.targetRoot,
            orchestratorWorktreePath: stagingDeps.orchestratorWorktreePath,
        })
        // Decision 70 — ledger-aware seeding: a task whose latest ledger entry's SHAs are
        // ALL ancestors of the fresh staging tip already shipped (a prior run's merged
        // rollup or a verified ALREADY_SATISFIED claim) — seed it `done` so producers are
        // never re-spawned onto work the base already contains. Staging-gated: the bare
        // `createRun` direct-API path has no git client and seeds everything pending.
        await seedFromLedger(specStore, request, seeded, stagingDeps, staging.stagingTip)
        await provisionProtection({
            ghClient: stagingDeps.ghClient,
            owner: stagingDeps.owner,
            repo: stagingDeps.repo,
            branch,
            requiredChecks: stagingDeps.config.git.stagingRequiredStatusChecks,
            provision: true,
        })
        // D74 (run-scoped, default): escalate develop from its baseline to the strict
        // run profile BEFORE the run row persists — same rollback contract as the
        // staging cut above (a throw leaves no phantom run; the retry re-escalates
        // idempotently). A failure AFTER this PUT but before create leaves develop
        // strict with no run — over-protected only, self-healed by the next run's
        // terminal de-escalation.
        if (stagingDeps.config.git.developProtection === 'run-scoped') {
            const base = stagingDeps.config.git.baseBranch
            // Per-repo extras from the committed gate contract (requiredChecks).
            const checks = effectiveProfiles(
                stagingDeps.config.git,
                await loadRequiredCheckExtras(stagingDeps.targetRoot)
            ).run
            const developState = await provisionProtection({
                ghClient: stagingDeps.ghClient,
                owner: stagingDeps.owner,
                repo: stagingDeps.repo,
                branch: base,
                requiredChecks: checks,
                provision: true,
            })
            requireProtectionOrRefuse(developState, checks, base)
        }
    }

    // D57: seed tasks + the launch touch IN the create payload — one write births a
    // complete run. A throw inside create() (pointer clobber guard) can then never
    // strand a `running` run with zero tasks the way the 2026-07-07 incident did.
    return state.create({
        run_id: opts.runId,
        spec: specStore.toPointer(request),
        staging_branch: branch,
        // v1 orchestrator seam drives tasks strictly one at a time — the execution-mode dial is fixed.
        execution_mode: 'sequential',
        tasks: seeded,
        // S11: the launch touch — every run costs at least one human action, so a
        // clean lights-out run scores exactly 1.0 on the derived touch metric.
        // `at` omitted → create() stamps it with the birth timestamp (=== started_at).
        human_touches: [{kind: 'launch' as const}],
        ...(opts.shipMode !== undefined ? {ship_mode: opts.shipMode} : {}),
        ...(opts.ownerSession !== undefined ? {owner_session: opts.ownerSession} : {}),
        ...(opts.ignoreQuota === true ? {ignore_quota: true} : {}),
        ...(opts.e2e === true ? {e2e: true} : {}),
        ...(opts.debug === true ? {debug: true} : {}),
    })
}

/**
 * Resolve the durable spec, create the run, and seed its tasks — the testable
 * IMPERATIVE core of `run create` (always creates; clobbers loudly via
 * {@link StateManager.create} if `runId` already exists). Reuse semantics live in
 * {@link resolveOrCreateRun}; this stays unconditional so callers that name a run
 * id (determinism/tests) get a predictable create.
 *
 * INTENTIONALLY omits `stagingDeps` — this bare direct-API export creates the run
 * row WITHOUT cutting/protecting a `staging-<run-id>` branch. Every production run
 * goes through `runCreate`, which supplies `stagingDeps`. Do NOT route a real run
 * through here expecting a staging branch (Decision 33).
 */
export async function createRun(state: StateManager, specStore: SpecStore, opts: CreateRunOptions): Promise<RunState> {
    return createRunFromManifest(state, specStore, await resolveSpec(specStore, opts), opts)
}

/**
 * Outcome of {@link resolveOrCreateRun} — a discriminated union (Decision 35).
 *
 * - `"created"`: no active run existed (or `--supersede` cleared it) and a fresh run
 *   was minted. `.run` is the new {@link RunState}.
 * - `"exists"`: an active run exists and no `--supersede`/`--resume` flag was given.
 *   The CALLER decides what to do; `runCreate` fails loud with an actionable message.
 *   `.existing` is the live {@link RunState}.
 * - `"superseded"`: `--supersede` was given; the old run was marked `superseded` and
 *   its branch deleted, then a fresh run was created. `.run` is the new run;
 *   `.supersededId` is the old run's id.
 */
export type ResolveOrCreateResult =
    | {readonly kind: 'created'; readonly run: RunState}
    | {readonly kind: 'exists'; readonly existing: RunState}
    | {readonly kind: 'superseded'; readonly run: RunState; readonly supersededId: string}
    /**
     * A weekly-quota (7d) park is active and `--ignore-quota` was not passed. Creating
     * or superseding is blocked until the window resets or `--ignore-quota` overrides.
     * The `--resume` intent is never blocked here (it falls through to the live-gated
     * `/factory:resume` path, which re-checks the window on the fresh session).
     */
    | {readonly kind: 'pause'; readonly existing: RunState}

/**
 * Supersede an active run (Decision 35): tear down its protection (GitHub blocks
 * deleting a protected ref) + `staging-<run-id>` branch (auto-closing its task PRs),
 * THEN mark it `superseded`. Terminal write is LAST — the resume-safe convention
 * {@link finalizeRun} uses: a teardown throw (401/403/5xx; already-gone 404/422 is
 * tolerated by the gh client) leaves the old run NON-terminal, so `findActiveByIssue`
 * still resolves it and re-running `run --supersede` retries the whole step idempotently,
 * leaving NO orphaned protected branch. (Finalizing FIRST would strand it: a terminal
 * `superseded` run is excluded from the active scan, so nothing ever re-tears its branch
 * down — rescue scopes out branch GC.) This is the DELIBERATE inverse of {@link runCancel},
 * which finalizes FIRST because its priority is releasing the Stop gate even if teardown
 * fails; supersede has no gate, so a clean, recoverable replacement wins.
 */
async function supersedeRun(state: StateManager, existing: RunState, stagingDeps: RunStagingDeps): Promise<void> {
    // Resolve the PINNED branch: superseding must tear down the branch the run actually
    // cut, not a recompute that a mid-run naming change could have desynced (Decision 33).
    const branch = existing.staging_branch
    await stagingDeps.ghClient.deleteProtection(stagingDeps.owner, stagingDeps.repo, branch)
    await stagingDeps.ghClient.deleteRemoteBranch(stagingDeps.owner, stagingDeps.repo, branch)
    // D74: drop develop back to baseline AFTER the branch delete (deleting the head
    // branch auto-closes its PRs, disarming any stray auto-merge first) and before
    // the terminal write. Skipped while a sibling run (another issue, same repo)
    // still relies on the strict profile. The follow-up create re-escalates — two
    // extra PUTs, but correct in every partial-failure interleaving (a supersede
    // whose create then fails must not strand strict protection).
    if (
        stagingDeps.config.git.developProtection === 'run-scoped' &&
        !(await state.hasOtherActiveForRepo(existing.spec.repo, existing.run_id))
    ) {
        await putBaselineProtection({
            ghClient: stagingDeps.ghClient,
            owner: stagingDeps.owner,
            repo: stagingDeps.repo,
            branch: stagingDeps.config.git.baseBranch,
            contexts: effectiveProfiles(stagingDeps.config.git, await loadRequiredCheckExtras(stagingDeps.targetRoot))
                .baseline,
        })
    }
    // terminal LAST (resume-safe)
    await state.finalize(
        existing.run_id,
        'superseded',
        'superseded by operator --supersede relaunch for the same PRD issue'
    )
}

/**
 * Resolve the spec, then (unless `opts.intent === "fresh"`) inspect the active run for
 * this `(repo, issue)` — issue-matched so a slug-drifted regen still finds the run it
 * must supersede/park/report — and return a discriminated result (Decision 35):
 *
 * - `{ kind: "created" }` — no active run; a fresh run was created.
 * - `{ kind: "exists" }` — an active run exists and no flag was given; the CALLER
 *   decides. `runCreate` fails loud with an actionable message here.
 * - `{ kind: "superseded" }` — `--supersede` given; the old run was finalized +
 *   its branch deleted, then a fresh run was created.
 *
 * The scan→create is serialized under a per-(repo, spec_id) lock so two concurrent
 * same-spec creates can't both observe "no active run" and mint two orphan runs —
 * the per-run clobber guard in {@link StateManager.create} only catches a same
 * run_id collision, not a same-spec one. (The lock stays spec_id-keyed — its parent
 * must be an existing spec dir, and the store holds ONE spec per issue, so two
 * concurrent same-issue creates resolve the same spec_id and still serialize; an
 * explicit `--spec-id` racing an `--issue` create is a pre-existing unlocked edge.)
 *
 * `stagingDeps` is forwarded to {@link createRunFromManifest} on the fresh-create
 * path to cut + protect the per-run staging branch (Decision 33), and is required
 * by the `--supersede` path to delete the old run's branch.
 */
export async function resolveOrCreateRun(
    state: StateManager,
    specStore: SpecStore,
    opts: CreateRunOptions,
    stagingDeps?: RunStagingDeps
): Promise<ResolveOrCreateResult> {
    // Resolve first (LOUD if no spec) — also yields the (repo, spec_id) scan key.
    const request = await resolveSpec(specStore, opts)
    if (opts.intent === 'fresh') {
        return {
            kind: 'created',
            run: await createRunFromManifest(state, specStore, request, opts, stagingDeps),
        }
    }
    const pointer = specStore.toPointer(request)
    return state.withSpecLock(pointer.repo, pointer.spec_id, async () => {
        // Match by the STABLE issue number, not exact spec_id: a --supersede
        // regeneration can drift the agent-named slug, and the old run must still
        // be found (superseded / parked / reported) under its original spec_id.
        const existing = await state.findActiveByIssue(pointer.repo, pointer.issue_number)
        if (existing !== null) {
            // Weekly quota is a hard wall: a 7d-parked run can't be created-fresh or
            // superseded without --ignore-quota. The `binding_window === "7d"` guard
            // targets only the weekly park — NOT the `unavailable-halt` suspend (quota:
            // undefined) or a 5h pause. The `--resume` intent falls through to the
            // `kind:"exists"` caller path, which hands off to `factory resume` (that
            // re-checks the LIVE window on the fresh session).
            const weeklyParked = existing.status === 'suspended' && existing.quota?.binding_window === '7d'
            if (weeklyParked && opts.ignoreQuota !== true && opts.intent !== 'resume') {
                return {kind: 'pause', existing}
            }

            if (opts.intent === 'supersede') {
                if (stagingDeps === undefined) {
                    throw new UsageError('run create --supersede requires the CLI gh deps')
                }
                const supersededId = existing.run_id
                await supersedeRun(state, existing, stagingDeps)
                const created = await createRunFromManifest(state, specStore, request, opts, stagingDeps)
                // S11: a supersede is a conflict-resolution touch ON TOP of the launch.
                const run = await state.update(created.run_id, (s) => ({
                    ...s,
                    human_touches: [...s.human_touches, {kind: 'conflict' as const, at: s.started_at}],
                }))
                return {kind: 'superseded', run, supersededId}
            }
            // --resume currently reports the live run (kind:"exists"); the full continue-the-run
            // hand-off is the caller's job (Task 4.2). No flag-compatibility assert here — that
            // belongs with the resume implementation, not a premature gate (review #3).
            return {kind: 'exists', existing}
        }
        return {
            kind: 'created',
            run: await createRunFromManifest(state, specStore, request, opts, stagingDeps),
        }
    })
}

// ---------------------------------------------------------------------------
// resume
// ---------------------------------------------------------------------------

/** The single JSON document `factory resume` emits — the runner's contract. */
export type ResumeResult =
    /**
     * `cleared` (S11): true iff this resume actually cleared a park (a state write
     * happened — the human_touches "resume" entry was appended); absent on the
     * idempotent already-running re-entry. The CLI mirrors the touch to
     * metrics.jsonl only when set.
     */
    | {readonly kind: 'resumed'; readonly run: RunState; readonly cleared?: true}
    | {
          readonly kind: 'pause'
          readonly run_id: string
          readonly status: RunStatus
          readonly reason: string
          readonly resets_at_epoch?: number
      }
    | {
          /**
           * A `debug:true` run resolved through the plain `resume` action. The plain
           * runner loop's `planResume`/quota-recheck path is NOT for a debug run — it
           * loops multiple review⇄fix passes on ONE run instead of finalizing as soon as
           * tasks go terminal (Decision 39, deferred to the debug driver). Returning this
           * distinct kind, before any quota/planResume logic runs, signals the caller (a
           * human or `/factory:debug`) to re-enter the debug SKILL rather than drive the
           * run through the ordinary resume path. Minimal by design: only the CALLER-facing
           * envelope, not the debug-resume UX itself (that lands with the debug driver).
           */
          readonly kind: 'debug-resume'
          readonly run_id: string
          readonly run: RunState
      }

/**
 * The testable core of `run resume`. Reads the run (LOUD if terminal — nothing to
 * resume), then routes through the pure {@link planResume} seam against a FRESH
 * usage reading:
 *   - a non-paused/suspended (i.e. already `running`) run is an idempotent re-entry
 *     → `resumed` with the unchanged state;
 *   - a recovered window clears the checkpoint (status→running, quota→undefined) and
 *     returns the updated state;
 *   - an over-curve / unobservable window is `pause` (fail-closed) and
 *     leaves state exactly as persisted.
 */
export async function applyResume(
    state: StateManager,
    runId: string,
    reading: UsageReading,
    config: Config,
    nowEpochSec: number,
    // S11: `touch:false` suppresses the human_touches "resume" append — the
    // rescue-apply park-clear tail (apply already appended "recover" for the SAME
    // human action).
    opts: {touch?: boolean} = {}
): Promise<ResumeResult> {
    const run = await state.read(runId)
    if (isTerminalRunStatus(run.status)) {
        throw new Error(`run resume: run '${runId}' is terminal (${run.status}); nothing to resume`)
    }
    // Decision 39: a debug run is not a plain resume — it loops multiple review⇄fix
    // passes on this run instead of finalizing once tasks go terminal, so the debug
    // driver (not planResume/the quota recheck) must drive it. Return early, LOUD and
    // distinct, before any quota/planResume logic runs or touches state.
    if (run.debug) {
        return {kind: 'debug-resume', run_id: runId, run}
    }

    const plan = planResume(run, reading, config, nowEpochSec)
    switch (plan.kind) {
        case 'not-resumable':
            // Non-terminal but not paused/suspended ⇒ already running: idempotent re-entry.
            return {kind: 'resumed', run}
        case 'resume': {
            const at = epochToIso(nowEpochSec)
            const updated = await state.update(runId, (s) => ({
                ...s,
                status: plan.clear.status,
                quota: plan.clear.quota,
                ...(opts.touch === false ? {} : {human_touches: [...s.human_touches, {kind: 'resume' as const, at}]}),
            }))
            return {kind: 'resumed', run: updated, cleared: true}
        }
        case 'pause': {
            const d = plan.decision
            // NB: two distinct `.kind` unions are in play here — the OUTER `plan.kind`
            // (ResumePlan: not-resumable | resume | pause, switched above) and this
            // INNER `d.kind` (QuotaDecision: proceed | pause-5h | suspend-7d | unavailable-halt).
            // planResume only ever pairs `pause` with a NON-proceed QuotaDecision, so
            // `proceed` is not expected here — but this is a DEFENSIVE TYPE NARROW, not dead
            // code: without it the compiler cannot prove `d.reason` (below) exists, since the
            // `proceed` arm of QuotaDecision carries no `reason`. The guard discharges that.
            if (d.kind === 'proceed') {
                return {kind: 'resumed', run}
            }
            const base = {
                kind: 'pause',
                run_id: runId,
                status: run.status,
                reason: d.reason,
            } as const
            // pause-5h / suspend-7d carry a reset horizon; unavailable-halt does not.
            return 'resetsAtEpoch' in d ? {...base, resets_at_epoch: d.resetsAtEpoch} : base
        }
    }
}
