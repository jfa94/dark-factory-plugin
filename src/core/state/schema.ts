/**
 * WS1 — Typed `RunState` / `TaskState` schema (Zod). THE FROZEN STATE SEAM.
 *
 * Downstream workstreams (WS2 phase-machine, WS3 git, WS4 quota, WS5 spec,
 * WS6/7 verifier, WS8 producer, WS9 hooks, WS10 orchestrators, WS12 scoring) import
 * these types and enums and MUST NOT redefine them. Every enum here is a CLOSED
 * set: a value outside the set is a LOUD parse error, never a silent pass — this
 * is the structural property the bash `_validate_task_field_value` guard tried to
 * approximate by hand at each write site.
 *
 * Design source: plan §"State storage model" + Decisions 7/22/24/25/26/27 and the
 * delta-ledger rows E (run-status semantics), V (derive-don't-store), X (spec
 * keyed by (repo, spec-id), not run-id), D (closed failure-class enum).
 *
 * GREENFIELD: the bash `state.json` shape (bin/pipeline-init, bin/pipeline-state
 * field lists) is consulted for *what data a run needs*, never copied verbatim.
 * Retired-by-decision concepts are deliberately ABSENT and must not be ported:
 *   - run status `interrupted`, task status `needs_human_review`, the `ci_fixing`
 *     ad-hoc status, `humanReviewLevel` / `NEEDS_DISCUSSION` — human gates are
 *     retired (locked decision 5).
 *   - run status `partial` — incremental delivery is retired (Decision 34): a run
 *     either delivers the whole PRD (`completed`) or leaves `develop` untouched
 *     (`failed`). `paused` / `suspended` remain DISTINCT quota states (Δ E).
 *   - the two-classifier model (`classify` + `risk` + `risk_tier`) — collapsed to
 *     ONE `risk_tier` producer dial (Decision 25, Δ "review-depth axis deleted").
 *   - stored gate-verdict booleans (`quality_gate.ok`, `mutation_gate`, …) —
 *     verdicts are DERIVED, never stored (Δ V); see derive.ts. This schema
 *     deliberately has NO field that holds a gate pass/fail boolean.
 */
import {z} from 'zod'
import {TASK_PHASES, SPAWN_PHASES} from '../../types/phases-vocab.js'

// ---------------------------------------------------------------------------
// Closed enums (the seam's vocabulary)
// ---------------------------------------------------------------------------

/**
 * Run-level status. The non-`running` states are the crux of Δ E — they must
 * stay distinct:
 *
 *   - `running`    — actively executing (non-terminal).
 *   - `completed`  — every task done, rollup CI green. TERMINAL, success.
 *                    `develop` receives the rollup only on this status.
 *   - `superseded` — a fresh `run` superseded this run; its `staging-<run-id>`
 *                    branch + PRs were deleted. TERMINAL.
 *   - `paused`     — QUOTA 5h-window breach (Decision 24): waiting out the rising
 *                    threshold curve in-session. NON-terminal, self-heals.
 *   - `suspended`  — QUOTA 7d-window breach (Decision 24): state persisted and the
 *                    process exited cleanly. NON-terminal; a (human-relaunched in
 *                    v1) `factory resume` continues from checkpoint. No work
 *                    was failed, nothing failed quality.
 *   - `failed`     — the run could not deliver the whole PRD — couldn't start, or
 *                    gave up after partial work; `develop` is untouched, the PRD
 *                    left open. TERMINAL.
 *
 * Terminal = {completed, superseded, failed}. Non-terminal = {running, paused,
 * suspended}. {@link isTerminalRunStatus} is the single source of that split.
 */
export const RunStatusEnum = z.enum(['running', 'completed', 'superseded', 'paused', 'suspended', 'failed'])
export type RunStatus = z.infer<typeof RunStatusEnum>

/** Run statuses that are TERMINAL (no further work will run without a new run). */
export const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'superseded'] as const

/** True iff the run status is terminal. The one authority for the split. */
export function isTerminalRunStatus(s: RunStatus): s is (typeof TERMINAL_RUN_STATUSES)[number] {
    return (TERMINAL_RUN_STATUSES as readonly string[]).includes(s)
}

/**
 * Task-level status. Closed set; human-gate statuses are gone.
 *   - `pending`    — not yet started (or blocked on an unsatisfied dependency).
 *   - `executing`  — a producer (test-writer / implementer) phase is in flight.
 *   - `reviewing`  — the merge gate (gates + panel) is in flight.
 *   - `shipping`   — verified; PR open / merging into staging.
 *   - `done`       — merged into staging (TERMINAL, success).
 *   - `failed`    — the producer escalation ladder was exhausted; this task is a
 *                    classified loud fail (Decision 22). TERMINAL, failure. Pairs
 *                    with a {@link FailureClassEnum} value in `failure_class`.
 */
export const TaskStatusEnum = z.enum(['pending', 'executing', 'reviewing', 'shipping', 'done', 'failed'])
export type TaskStatus = z.infer<typeof TaskStatusEnum>

/** Task statuses that are TERMINAL. */
export const TERMINAL_TASK_STATUSES = ['done', 'failed'] as const
/** True iff the task status is terminal. */
export function isTerminalTaskStatus(s: TaskStatus): boolean {
    return (TERMINAL_TASK_STATUSES as readonly string[]).includes(s)
}

/**
 * CLOSED failure-class enum (Decision 22, Δ D). When a task is `failed` the
 * fail is *classified* so the partial-run report tells the human what to do.
 * This is a small, deliberately-final set — adding a class is a design change,
 * not a config tweak.
 *   - `capability-budget`     — the producer could not meet the bar within the
 *                               escalation ladder's retry/model budget.
 *   - `spec-defect`           — the failure is in the spec/target itself (e.g. an
 *                               untestable criterion, a contradiction). Classify-
 *                               before-retry (Δ D) sends these straight to fail.
 *   - `blocked-environmental` — an external blocker (CI infra, network, a missing
 *                               dependency the task cannot itself provision).
 *   - `needs-context`         — the producer asked a question the pipeline cannot
 *                               answer (twice, unresolved — Decision 69). The question
 *                               rides `needs_context.question`; rescue surfaces it and
 *                               `rescue apply --answer` feeds the reply back in.
 *   - `blocked-dependency`    — dependency cascade: an upstream task in the DAG
 *                               failed, so this one never ran (Decision 72). Distinct
 *                               from `blocked-environmental` so postmortem stats do
 *                               not read a cascade as an infra outage.
 */
export const FailureClassEnum = z.enum([
    'capability-budget',
    'spec-defect',
    'blocked-environmental',
    'needs-context',
    'blocked-dependency',
])
export type FailureClass = z.infer<typeof FailureClassEnum>

/**
 * Risk tier — the SINGLE producer dial (Decision 25). It records difficulty ×
 * stakes into one spec-time judgment and sets the STARTING rung of the producer
 * escalation ladder. It does NOT size the verifier (the merge gate is risk-invariant,
 * Decision 26) and there is no separate review-depth axis.
 */
export const RiskTierEnum = z.enum(['low', 'medium', 'high'])
export type RiskTier = z.infer<typeof RiskTierEnum>

/**
 * Escalation rung — where on the producer ladder the task currently sits
 * (Decision 25). Rung 0 = the starting rung implied by the risk tier; each
 * nuke-and-retry bumps it. The ladder cap (`ESCALATION_CAP` = 4 extra attempts) is
 * enforced by the orchestrator (`src/orchestrator/transitions.ts` escalateOrFail), not the
 * schema; the schema only records the rung reached so a resume continues from the
 * right place. Non-negative integer.
 */
export const EscalationRungSchema = z.number().int().min(0)

/**
 * Panel verdict — one independent reviewer's outcome (Decision 26/27). The panel
 * verdict is conjunctive: the task clears only on unanimous `approve`. `blocked`
 * carries findings that — after the verify-then-fix confirmation (Decision 27) —
 * return the task to the producer. `error` is a reviewer that failed to produce a
 * usable verdict (LOUD, never silently treated as approve).
 */
export const PanelVerdictEnum = z.enum(['approve', 'blocked', 'error'])
export type PanelVerdict = z.infer<typeof PanelVerdictEnum>

/** Producer sub-phase a task may be in (test-writer first, then implementer). */
export const ProducerRoleEnum = z.enum(['test-writer', 'implementer'])
export type ProducerRole = z.infer<typeof ProducerRoleEnum>

// ---------------------------------------------------------------------------
// Spec pointer (Δ X — a run points at a spec; it does NOT embed one)
// ---------------------------------------------------------------------------

/**
 * A run's pointer to its spec. The spec itself lives in the DURABLE per-spec
 * store `specs/<repo>/<spec-id>/` (WS5 owns its content); a run records only this
 * pointer (Δ X). `spec_id = "<issue>-<slug>"` where the issue number is the
 * stable lookup key (reruns resolve the same spec) and the slug is human-readable
 * (named by the spec generator). Both `repo` and `spec_id` are required — a run
 * without a resolvable spec is invalid.
 *
 * NOTE: `repo` here is the addressing key for the spec store path (e.g.
 * "owner/name"); it is sanitized to a path segment by the store, not stored as a
 * filesystem path.
 */
export const SpecPointerSchema = z.object({
    /** Repo identity, e.g. "owner/name". The first key of (repo, spec-id). */
    repo: z.string().min(1),
    /** `<issue>-<slug>`. The second key of (repo, spec-id). */
    spec_id: z.string().min(1),
    /** The PRD issue number — the STABLE lookup key embedded in spec_id. */
    issue_number: z.number().int().positive(),
})
export type SpecPointer = z.infer<typeof SpecPointerSchema>

// ---------------------------------------------------------------------------
// TaskState
// ---------------------------------------------------------------------------

/**
 * One reviewer's recorded panel result. Holds the artifact pointer + the
 * post-verify-then-fix verdict, NOT a trusted "this gate passed" boolean for any
 * DETERMINISTIC gate (those are derived, Δ V). A panel verdict is itself the
 * ground truth of a judgment reviewer's opinion, so it is stored; the DERIVED
 * thing is the *merge-gate* verdict (unanimity), computed in derive.ts.
 */
export const ReviewerResultSchema = z.object({
    /** Reviewer identity (e.g. "implementation", "security", "silent-failure"). */
    reviewer: z.string().min(1),
    /** This reviewer's verdict after verify-then-fix adjudication. */
    verdict: PanelVerdictEnum,
    /** Pointer to the review artifact (relative to the run's reviews/ dir). */
    artifact: z.string().optional(),
    /** Number of confirmed (verified) blocking findings this reviewer raised. */
    confirmed_blockers: z.number().int().min(0).default(0),
})
export type ReviewerResult = z.infer<typeof ReviewerResultSchema>

/**
 * One fix-forward instruction carried into the NEXT producer rung after a
 * merge-gate block (D5 fix-forward channel). A lean LOCAL shape — deliberately
 * NOT the verifier's `Finding` type: this module is the frozen state seam other
 * layers import FROM (never the reverse), so importing a verifier type here would
 * invert that dependency. `record.ts` maps confirmed reviewer blockers and
 * non-holdout failing gate evidence into this shape before persisting.
 */
export const FixFindingSchema = z
    .object({
        /** Origin of the finding: a reviewer name (e.g. "security") or a gate id (e.g. "lint"). */
        reviewer: z.string().min(1),
        file: z.string().optional(),
        line: z.number().int().positive().optional(),
        description: z.string().min(1),
    })
    .superRefine((finding, ctx) => {
        // Mirrors the T4 both-or-neither rule on the verifier's FindingSchema
        // (src/verifier/judgment/finding.ts): a half-citation would reach the next
        // producer rung as an unlocatable instruction.
        const hasFile = finding.file !== undefined
        const hasLine = finding.line !== undefined
        if (hasFile && !hasLine) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['line'],
                message: `finding has 'file' but no 'line' — provide both or neither for a citable finding`,
            })
        }
        if (hasLine && !hasFile) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['file'],
                message: `finding has 'line' but no 'file' — provide both or neither for a citable finding`,
            })
        }
    })
export type FixFinding = z.infer<typeof FixFindingSchema>

/**
 * One adjudicated-and-dismissed review claim carried into the NEXT verify round's
 * panel reviewers (Decision 68 anti-ratcheting ledger). Two sources: a blocking
 * finding the independent finding-verifier REFUTED, or a non-blocking finding
 * (advisory — raised, not gating). A lean LOCAL shape like {@link FixFindingSchema}
 * (same frozen-seam rule: never import verifier types here). Injected VERBATIM into
 * panel reviewer prompts as a challengeable input document — reviewers may re-raise
 * only with NEW evidence, prefixing the finding description with
 * "CHALLENGES PRIOR DISPOSITION:". Never shown to a finding-verifier
 * (anti-anchoring). Cleared when the task ships (doneTaskRow).
 */
export const ReviewDispositionSchema = z.object({
    /** Which reviewer raised the original finding. */
    reviewer: z.string().min(1),
    /** Why it does not gate: verifier-refuted, or raised non-blocking. */
    disposition: z.enum(['refuted', 'non-blocking']),
    file: z.string().optional(),
    line: z.number().int().positive().optional(),
    /** The verbatim quote from the original finding (fingerprint half 1). */
    quote: z.string().min(1),
    /** The one-sentence claim from the original finding (fingerprint half 2). */
    claim: z.string().min(1),
    /** The refutation reason (refuted entries only). */
    note: z.string().optional(),
    /** The verify round (attempt) that adjudicated it. */
    round: z.number().int().positive(),
})
export type ReviewDisposition = z.infer<typeof ReviewDispositionSchema>

/**
 * Per-task state. Carries the producer ladder position, the panel results, the
 * git/PR pointers, and the failure classification — but NO stored gate-verdict
 * booleans, and NO producer dial: the `risk_tier` dial is read live from the spec
 * via `specTaskOf`, never copied here (derive-don't-store, Decision 25). A gate's
 * pass/fail is always re-derived (derive.ts) from ground truth, so there is
 * structurally nothing here to forge (Δ V).
 */
export const TaskStateSchema = z.object({
    task_id: z.string().min(1),
    status: TaskStatusEnum.default('pending'),
    /**
     * Task ids this task depends on (the vertical-slice DAG, Decision 23). A
     * deliberate denormalization: copied from the {@link SpecTask} at seed time and
     * then frozen (never mutated), so the hot DAG-traversal readers — `next.ts`
     * (ready-task selection) and `rescue/scan.ts` (drift scan, which has NO spec in
     * scope) — read edges straight off run state without coupling to the spec store.
     * Integrity is pinned at seed time by `seedTasksFromSpec`, where dangling, self,
     * cyclic, and duplicate edges all fail LOUD.
     */
    depends_on: z.array(z.string()).default([]),

    // --- Producer ladder (Decision 25; the risk_tier dial lives on the SpecTask, not here) ---
    /** Current rung on the producer escalation ladder (0 = starting rung). */
    escalation_rung: EscalationRungSchema.default(0),
    /** Which producer role is/last ran. */
    producer_role: ProducerRoleEnum.optional(),
    /**
     * Defect feedback carried from the implementer's `test-defective` escalation into
     * the NEXT test-writer re-run (the test-revision recovery, Δ D). Set when the
     * implementer reports the RED test is wrong; injected into the regenerated
     * test-writer's prior-failure context (handlers.tests) so it does not re-pin the
     * same wrong literal; cleared once the test-writer returns `done`. Absent
     * otherwise. Transient — not a failure field (allowed on any status).
     */
    test_revision_feedback: z.string().optional(),

    /**
     * The producer's open NEEDS_CONTEXT question (Decision 69). Written on the
     * first NEEDS_CONTEXT at a phase (the task re-spawns ONCE at the same rung with
     * the question injected); a second consecutive NEEDS_CONTEXT fails the task
     * `needs-context` with the question refreshed. `answer` is written only by
     * `rescue apply --answer` and is injected alongside the question on the
     * post-reset re-spawn. Cleared when a producer returns `done` (any role — a
     * completed attempt resolves the question by construction). Deliberately
     * PRESERVED by rescue's resetTaskRow (unlike most transients): the open
     * question is the whole point of the reset. Transient — allowed on any status.
     */
    needs_context: z
        .object({
            question: z.string().min(1),
            answer: z.string().min(1).optional(),
        })
        .optional(),

    /**
     * The failing gate-id set of the LAST blocked merge-gate verify (sorted,
     * holdout excluded — Decision 71). An event record like `fix_findings`
     * (the reviewers it derives from are cleared by escalateOrFail). When the next
     * blocked verify fails the IDENTICAL set, the escalation is routed to the
     * `tests` phase (the RED test is suspected as the broken arbiter) instead of
     * re-rolling the implementer. Cleared on the advancing verify write, on
     * doneTaskRow, and by rescue's resetTaskRow. Transient — allowed on any status.
     */
    last_failing_gates: z.array(z.string().min(1)).optional(),

    /**
     * Feedback carried from a failing e2e journey spec into this task's NEXT
     * implementation pass (the e2e reopen loop, Decision 39). Set by the e2e coroutine
     * when it maps a failing spec to this task via the author manifest and resets the
     * task to `pending`; injected into the regenerated producer's prior-failure context
     * (mirrors `test_revision_feedback`, but originates from a RUN-LEVEL phase, not a
     * per-task producer outcome). Cleared once the task ships again. Absent otherwise.
     * Transient — not a failure field (allowed on any status).
     */
    e2e_feedback: z.string().optional(),

    /**
     * Fix-forward instructions carried from a blocked merge-gate verify into the
     * NEXT producer (`exec`) rung (D5 fix-forward channel). Composed at the
     * wait-retry branch (`record.ts`) from confirmed reviewer blockers ∪ non-holdout
     * failing gate evidence, persisted BEFORE `escalateOrFail` clears `reviewers`
     * (mirrors the `test_revision_feedback` precedent: a separate write ahead of the
     * ladder transition). `handlers.ts`'s `exec` reads it into `buildProducerContext`
     * as `confirmedBlockers`. Cleared on the next advance/complete. Absent otherwise.
     * Transient — not a failure field (allowed on any status).
     */
    fix_findings: z.array(FixFindingSchema).optional(),

    /**
     * Anti-ratcheting disposition ledger (Decision 68): claims a prior verify round
     * refuted or raised non-blocking, appended at the wait-retry branch (record.ts,
     * same separate-write pattern as `fix_findings`) and injected into the NEXT
     * round's panel reviewer prompts so a fresh-context reviewer cannot blindly
     * re-raise an already-dismissed claim. Survives `escalateOrFail`'s `{...t}`
     * spread across rung bumps; cleared when the task ships (doneTaskRow) and on
     * the advancing verify write. Transient — allowed on any status.
     */
    review_dispositions: z.array(ReviewDispositionSchema).optional(),

    // --- Merge gate (Decision 26/27) ---
    /** Per-reviewer panel results (derive.ts computes the merge-gate verdict from these). */
    reviewers: z.array(ReviewerResultSchema).default([]),

    /**
     * Δ U/S5 — set IFF the ADVANCING verify pass ran WITHOUT an independent
     * cross-vendor reviewer (runPanel's crossVendorAbsence). An EVENT RECORD like
     * `reviewers[]` (derive-don't-store exception: which executor actually reviewed
     * is not derivable after the fact). Written/cleared in the SAME advance write
     * as `reviewers`; surfaced by the partial report + run summary.
     */
    cross_vendor_absent: z.object({reason: z.string().min(1)}).optional(),

    // --- Git / PR pointers (WS3 populates; schema reserves the shape) ---
    /** Run-scoped branch `factory/<run_id>/<task_id>` (Δ M). */
    branch: z.string().optional(),
    /** PR number once created (idempotent-create keyed off branch, Δ P). */
    pr_number: z.number().int().positive().optional(),

    // --- Failure classification (Decision 22, Δ D) ---
    /** Set IFF status === "failed": the closed-enum cause. */
    failure_class: FailureClassEnum.optional(),
    /** Human-facing reason string accompanying a fail. */
    failure_reason: z.string().optional(),

    /**
     * The precise resume cursor for the drive orchestrator — which TaskPhase the task is
     * at/resuming at. Written by markInFlight. Lossy `status` stays the human-facing
     * summary; `phase` is the machine cursor. Absent = not started (preflight).
     * NOTE: on terminal rows (done/failed), `phase` is the last in-flight phase,
     * not a resume point — terminal writers do not clear it.
     * NOTE: both this enum and phase-machine's TASK_PHASE_ORDER import the SAME
     * literal tuple from `types/phases-vocab.ts` (the dependency-free vocabulary
     * leaf), so they cannot drift; the cross-check test in
     * src/orchestrator/orchestrator.test.ts is belt-and-braces, not load-bearing.
     */
    phase: z.enum(TASK_PHASES).optional(),
    /** Ship live-merge re-sync count (cap enforced by the orchestrator; persisted so the cap survives process boundaries). */
    merge_resyncs: z.number().int().min(0).default(0),

    /**
     * Same-rung verify re-runs consumed for holdout EVALUATOR failures (malformed
     * validator output — unparseable/wrong-cardinality/mismatched/blank-evidence-pass).
     * Distinct from `spawn_in_flight.redrives` (hung-spawn respawn, Decision 66): this
     * counts delivered-but-broken evaluator output. Cap enforced in record.ts
     * (HOLDOUT_EVALUATOR_RETRY_CAP); exhaustion fails the task `blocked-environmental`.
     * Absent = 0.
     */
    holdout_evaluator_retries: z.number().int().min(0).optional(),

    /**
     * Spawn-in-flight checkpoint (idempotent re-spawn). Set by the orchestrator when it
     * EMITS a spawn for `phase` at `rung`, recording the task-branch `tip_sha` at emit
     * time. Producers commit to the SHARED task worktree, so a stop in the post-spawn /
     * pre-record window leaves the abandoned producer's partial commits on the branch. On
     * the resume that re-enters the SAME (phase, rung) before any results were recorded,
     * the orchestrator resets the worktree to `tip_sha` — discarding ONLY the interrupted
     * phase's work (prior completed phases live below it) — then re-spawns. A fresh
     * spawn overwrites it; terminal writers (complete/fail) clear it. Absent = no spawn
     * in flight (the steady state between phases).
     *
     * `phase` is the spawn-phase subset (tests|exec|verify) — preflight/ship never spawn.
     * Both this enum and orchestrator/results' SPAWN_PHASES import the same tuple from
     * `types/phases-vocab.ts`, so they cannot drift (the orchestrator.test.ts cross-check
     * is belt-and-braces, mirroring the `phase` field's pin).
     */
    spawn_in_flight: z
        .object({
            phase: z.enum(SPAWN_PHASES),
            rung: z.number().int().min(0),
            tip_sha: z.string().min(1),
            /** Epoch SECONDS (the shared quota clock, `OrchestratorDeps.now()`) at
             * spawn emit; refreshed on a matching re-entry. Stall-TTL detection
             * (`next.ts` `work.stale`/`work.hung`) reads this — advisory only, no
             * status change. Defaults to 0 (epoch) so a pre-S? checkpoint persisted
             * before this field existed parses as maximally aged — it lands in `hung`
             * (kill + re-drive) — correct: an untimed in-flight spawn should be
             * flagged for re-drive, not silently trusted. */
            spawned_at: z.number().default(0),
            /**
             * Matching (phase, rung) re-entries already consumed — the bound on the
             * kill→respawn→hang loop (Decision 66). Incremented by the orchestrator's
             * re-entry branch; a fresh checkpoint (any phase/rung advance) is written
             * with 0, so the budget is per-(phase, rung) by construction. Defaults to
             * 0 so a checkpoint persisted before this field existed parses with a
             * FULL budget — safe: the cap bounds FUTURE re-entries only (the opposite
             * gotcha from spawned_at, whose default-0 must read as maximally aged).
             */
            redrives: z.number().int().min(0).default(0),
        })
        .optional(),

    // --- Lifecycle timestamps (ISO-8601) ---
    started_at: z.string().optional(),
    ended_at: z.string().optional(),
})
export type TaskState = z.infer<typeof TaskStateSchema>

/**
 * Cross-field invariant (Decision 22, Δ D): a fail MUST be classified, and a
 * failure_class is meaningless on any non-failed status — "set IFF failed".
 * Applied at parse time (see {@link parseTaskState} / {@link parseRunState}) so
 * the exported {@link TaskStateSchema} stays a plain object — keeps `.shape` /
 * `.extend` for downstream — while every sanctioned parse still rejects the
 * invalid shapes. Lets WS2/WS12 non-null-assert failure_class on a failed task
 * and never encounter it on a done one.
 */
function refineTaskCrossFields(task: TaskState, ctx: z.RefinementCtx): void {
    const isFailed = task.status === 'failed'
    if (isFailed && task.failure_class == null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['failure_class'],
            message: `task '${task.task_id}' is 'failed' but has no failure_class (a fail must be classified)`,
        })
    }
    if (!isFailed && task.failure_class != null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['failure_class'],
            message: `task '${task.task_id}' has failure_class '${task.failure_class}' but status is '${task.status}' (failure_class is set IFF failed)`,
        })
    }

    // `failure_reason` is set IFF failed, mirroring failure_class — TaskTerminalResult's
    // failed variant makes `reason: string` MANDATORY, so the persisted twin must too
    // (Decision 22: a fail carries the human-facing reason for the partial-run report).
    const hasReason = task.failure_reason != null && task.failure_reason.length > 0
    if (isFailed && !hasReason) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['failure_reason'],
            message: `task '${task.task_id}' is 'failed' but has no failure_reason (a fail must carry a human-facing reason)`,
        })
    }
    if (!isFailed && task.failure_reason != null) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['failure_reason'],
            message: `task '${task.task_id}' has a failure_reason but status is '${task.status}' (failure_reason is set IFF failed)`,
        })
    }

    // Panel-verdict / blocker-count coherence (Decision 26/27): a stored reviewer
    // result is post-verify-then-fix, so an `approve` must record 0 confirmed
    // blockers and a `blocked` must record ≥1 — otherwise the audit trail
    // derivePanelVerdict surfaces is self-contradictory. `error` is unconstrained.
    task.reviewers.forEach((r, i) => {
        if (r.verdict === 'approve' && r.confirmed_blockers !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reviewers', i, 'confirmed_blockers'],
                message: `reviewer '${r.reviewer}' approves but records ${r.confirmed_blockers} confirmed blocker(s) (approve ⇒ 0)`,
            })
        }
        if (r.verdict === 'blocked' && r.confirmed_blockers === 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['reviewers', i, 'confirmed_blockers'],
                message: `reviewer '${r.reviewer}' is blocked but records 0 confirmed blockers (blocked ⇒ ≥1)`,
            })
        }
    })

    // In-flight status ⇒ phase cursor present: the orchestrator writes `phase` in
    // lockstep with status on every record (markInFlight + record's advance), so an
    // in-flight row without a cursor is stale state from an older factory version.
    const inFlight = task.status === 'executing' || task.status === 'reviewing' || task.status === 'shipping'
    if (inFlight && task.phase === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['phase'],
            message: `task '${task.task_id}' has in-flight status '${task.status}' but no phase cursor — phase is written in lockstep with status (state from an older factory version); start a fresh run`,
        })
    }

    // T3 defense-in-depth: spawn_in_flight.rung must never EXCEED escalation_rung.
    // A forward gap (spawn_in_flight.rung < escalation_rung) is a valid transient
    // state — the escalation bumped the rung and the next spawn will overwrite the
    // checkpoint. A backward gap (spawn_in_flight.rung > escalation_rung) is
    // impossible in the normal state machine (rung only increases) and indicates an
    // improper backward reset like the G2 bug (resetTaskRow resetting escalation_rung
    // to 0 without clearing spawn_in_flight). The primary fix is rescue/apply.ts
    // clearing the field; this invariant catches any future regression at parse time.
    if (task.spawn_in_flight !== undefined && task.spawn_in_flight.rung > task.escalation_rung) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['spawn_in_flight', 'rung'],
            message: `task '${task.task_id}' spawn_in_flight.rung (${task.spawn_in_flight.rung}) > escalation_rung (${task.escalation_rung}) — rung went backward, stale checkpoint from before a rescue reset`,
        })
    }
}

/** {@link TaskStateSchema} + cross-field checks — the validating form the seam parses. */
const TaskStateChecked = TaskStateSchema.superRefine(refineTaskCrossFields)

// ---------------------------------------------------------------------------
// Quota checkpoint (WS4 owns the policy; schema reserves the persisted shape so
// a suspended run resumes from the right place — Decision 24)
// ---------------------------------------------------------------------------

/**
 * The minimal quota state a resumable run must persist. WS4 extends/owns the
 * pacing logic; the schema only freezes what `suspended`/`paused` resume needs.
 */
/**
 * Discriminated on `binding_window` so illegal field combos are UNrepresentable: a
 * windowed (`5h`/`7d`) pause/suspend ALWAYS carries its reset horizon (the resume
 * signal); `unavailable` (the usage signal could not be read — fail-closed suspend)
 * NEVER has one (resume rechecks the live signal). INVARIANT: `run.quota` is present
 * ⇔ the stop was quota-caused — non-quota suspends (docs/e2e phase parks) never write
 * a checkpoint, which is how planResume tells them apart.
 */
export const QuotaCheckpointSchema = z.discriminatedUnion('binding_window', [
    z.object({binding_window: z.literal('5h'), resets_at_epoch: z.number().int().nonnegative()}),
    z.object({binding_window: z.literal('7d'), resets_at_epoch: z.number().int().nonnegative()}),
    z.object({binding_window: z.literal('unavailable')}),
])
export type QuotaCheckpoint = z.infer<typeof QuotaCheckpointSchema>

// ---------------------------------------------------------------------------
// Phase-marker factories (module-private)
// ---------------------------------------------------------------------------
// The four run-level phase markers share one spine — status / reason? /
// attempts? / ended_at — with per-marker extras spliced in at TWO fixed slots
// (after `reason`, after `attempts`) so declaration order — and therefore the
// PERSISTED key order (StateManager.update re-serializes in Zod shape order) —
// stays byte-stable with the previous hand-written schemas. Per-marker
// `attempts` semantics are documented on each marker's doc comment.

/** Marker that is written once, CONCLUDED: `status` + `ended_at` required (docs, traceability). */
function concludedPhaseMarker<S1 extends z.ZodRawShape, S2 extends z.ZodRawShape>(afterReason: S1, afterAttempts: S2) {
    return z.object({
        status: z.enum(['done', 'failed']),
        reason: z.string().optional(),
        ...afterReason,
        attempts: z.number().int().nonnegative().optional(),
        ...afterAttempts,
        ended_at: z.string(),
    })
}

/** Marker that can be OPEN/cleared mid-run: `status` + `ended_at` optional (e2e phase, e2e assessment). */
function openPhaseMarker<S1 extends z.ZodRawShape, S2 extends z.ZodRawShape>(afterReason: S1, afterAttempts: S2) {
    return z.object({
        status: z.enum(['done', 'failed']).optional(),
        reason: z.string().optional(),
        ...afterReason,
        attempts: z.number().int().nonnegative().optional(),
        ...afterAttempts,
        ended_at: z.string().optional(),
    })
}

// ---------------------------------------------------------------------------
// Docs phase marker (engine-owned documentation phase)
// ---------------------------------------------------------------------------

/**
 * Run-level documentation phase marker (engine-owned docs phase). `done` once
 * scribe's output is committed onto staging (or a no-op pass). `failed` suspends the
 * run for a retry (resumable via /factory:resume) UNTIL the attempt cap
 * (`MAX_DOCS_ATTEMPTS`); at the cap docs is best-effort, so a `failed` marker coexists
 * with a run that finalizes `completed` (docs never gates the rollup).
 * Absent until the phase runs. Not applicable (no /docs, opted out) leaves it absent —
 * `next` decides applicability read-only, so there is no `skipped` value.
 * `attempts` — cumulative count (1-indexed); written on `failed` markers only.
 */
export const DocsPhaseSchema = concludedPhaseMarker({}, {})
export type DocsPhase = z.infer<typeof DocsPhaseSchema>

// ---------------------------------------------------------------------------
// Traceability phase marker (S9, Decision 47 — PRD-traceability audit)
// ---------------------------------------------------------------------------

/**
 * One recorded auditor verdict for one PRD requirement. `requirement` is the
 * requirement TEXT (never an index) — the row stays meaningful even if the
 * deterministic extractor's numbering drifts across versions.
 */
export const TraceabilityVerdictRowSchema = z.object({
    requirement: z.string().min(1),
    verdict: z.enum(['met', 'partial', 'unmet']),
    evidence: z.string().min(1),
})
export type TraceabilityVerdictRow = z.infer<typeof TraceabilityVerdictRowSchema>

/**
 * Run-level PRD-traceability phase marker (S9). Runs between e2e and docs.
 * `done` — audit concluded with no `unmet` requirement (`partial` passes but
 * surfaces in the report). `failed` — either a concluded audit found `unmet`
 * requirements (verdicts non-empty; blocks rollup, never retried) or the
 * auditor crashed out of its attempt cap (verdicts empty — the anti-docs
 * delta: traceability is a delivery gate, never best-effort-done). Verdicts
 * live IN the marker (recorded agent judgment, like `task.failure_reason`) —
 * a sidecar file would add a parse seam that can desync from `status`.
 * `attempts` — cumulative CRASH attempts (verdicts are judgment, never retried).
 */
export const TraceabilityPhaseSchema = concludedPhaseMarker(
    {},
    {
        /** One row per PRD requirement; empty ⇔ no parseable audit ever landed. */
        verdicts: z.array(TraceabilityVerdictRowSchema).default([]),
    }
)
export type TraceabilityPhase = z.infer<typeof TraceabilityPhaseSchema>

// ---------------------------------------------------------------------------
// E2E phase marker + author manifest (engine-owned e2e phase, Decision 39)
// ---------------------------------------------------------------------------

/**
 * Criticality by PERSISTENCE, not tags (Decision 39). `critical` specs are
 * committed to the target repo's `e2e/` (proven via the fail-first proof, gate
 * the run + CI); `throwaway` specs live only in the run's ephemeral, gitignored
 * dir (advisory, discarded at run end). Nothing is annotated inside the spec file
 * itself — this enum only labels a manifest row, it is never written into the
 * Playwright test source.
 */
export const E2eSpecKindEnum = z.enum(['critical', 'throwaway'])
export type E2eSpecKind = z.infer<typeof E2eSpecKindEnum>

/**
 * One author-emitted manifest row — the spec→task link (Decision 39: a manifest,
 * not Playwright tags/annotations and not git provenance, since squash-merges
 * destroy commit→task history at both task→staging and staging→develop). Fixed at
 * authoring time; the e2e coroutine joins a failing spec back to its task(s)
 * purely through this array, never through source inspection.
 */
export const E2eManifestEntrySchema = z.object({
    /** Task id(s) this spec exercises (a critical journey spec may span >1 task). */
    task_ids: z.array(z.string().min(1)).min(1),
    /** Spec file path — repo-relative for `critical`, run-ephemeral-dir-relative for `throwaway`. */
    spec_path: z.string().min(1),
    kind: E2eSpecKindEnum,
    /**
     * Human-readable journey name (Decision 40 D12) — surfaces in the run report's
     * "journeys covered" section so a zero-e2e-knowledge operator can read what was
     * proven. Optional: pre-D12 manifests lack it (renderer falls back to spec_path).
     */
    title: z.string().min(1).optional(),
})
export type E2eManifestEntry = z.infer<typeof E2eManifestEntrySchema>

/**
 * One spec awaiting ADJUDICATION (Decision 40 D7): a pre-existing committed spec
 * (not in this run's manifest) that failed the suite. `mode` pre-routes the
 * adjudicator's job: `update` — the assessment forecast this task-driven change
 * (`needs-update`), so the spec is rewritten directly, no verdict needed;
 * `adjudicate` — unforecast, the adjudicator must first rule regression (fail the
 * run) vs intentional-change (rewrite, citing the authorizing task/spec language).
 */
export const E2eAdjudicationSpecSchema = z.object({
    /** Repo-relative path of the failing committed spec. */
    spec_path: z.string().min(1),
    /** The failing spec's human-readable title (from the Playwright results). */
    title: z.string(),
    /** The failing assertion/step detail (D8), threaded into the adjudicator prompt. */
    error: z.string().optional(),
    mode: z.enum(['adjudicate', 'update']),
})
export type E2eAdjudicationSpec = z.infer<typeof E2eAdjudicationSpecSchema>

/**
 * The in-flight adjudication CURSOR (Decision 40 D7) — present only between "the
 * suite hit unmappable pre-existing failures" and "the adjudicator's result was
 * recorded". Its presence is what routes `runE2eRecord` to the adjudication leg
 * (the results shape carries no discriminator of its own). Cleared on conclusion
 * (either way); dropped by rescue's `--reset-e2e` (a stale cursor must never
 * re-spawn against a torn-down worktree).
 */
export const E2eAdjudicationSchema = z.object({
    specs: z.array(E2eAdjudicationSpecSchema).min(1),
    /** Adjudicator SPAWN attempts (crash retry, mirrors `author_attempts`). */
    attempts: z.number().int().nonnegative(),
    requested_at: z.string(),
})
export type E2eAdjudication = z.infer<typeof E2eAdjudicationSchema>

/**
 * Run-level e2e phase marker + author manifest (engine-owned e2e phase, ordered
 * BEFORE docs). Unlike {@link DocsPhaseSchema} — written once and never
 * re-entered — this object's `status` is CLEARED (set back to absent) on every
 * reopen so `wantsE2e()` re-fires the phase once the reopened task settles, while
 * `manifest` and `reopen_counts` PERSIST across the clear: the author is not
 * re-invoked on later passes (throwaway specs are re-run, not re-authored) and the
 * per-task reopen cap holds across the whole run, not just one pass.
 *   - `status` absent  — phase not yet run this pass, or cleared for a reopen re-fire.
 *   - `status` "done"  — every critical spec is green; the run proceeds to docs.
 *   - `status` "failed"— run FAILS: residual critical red, an unmappable critical
 *                        regression, or a cap-exhausted critical (Decision 39).
 * `attempts` — cumulative suite-pass count across ALL passes (1-indexed).
 */
export const E2ePhaseSchema = openPhaseMarker(
    {
        /**
         * Non-gating note surfaced on a `done` phase — e.g. residual THROWAWAY red that
         * didn't block completion (Decision 39: only critical red gates). Distinct from
         * `reason`, which the T2 cross-field check reserves for `failed` (set IFF
         * failed) — `advisory` is the `done`-side counterpart, never present on `failed`.
         */
        advisory: z.string().optional(),
    },
    {
        /**
         * Author SPAWN attempts (Decision 40 D5): a crashed/unparseable author earns ONE
         * automatic re-spawn before the phase fails; distinct from `attempts` (suite
         * passes). Deliberate blocked-escalate/needs-context verdicts never retry.
         */
        author_attempts: z.number().int().nonnegative().optional(),
        /** The author's spec→task manifest, fixed once authored and reused across passes. */
        manifest: z.array(E2eManifestEntrySchema).default([]),
        /** Per-task reopen count so far, keyed by task_id — bounds each task by `e2e.reopenCap`. */
        reopen_counts: z.record(z.string(), z.number().int().nonnegative()).default({}),
        /** In-flight adjudication cursor (D7) — see {@link E2eAdjudicationSchema}. */
        adjudication: E2eAdjudicationSchema.optional(),
        /**
         * Per-spec adjudication count, keyed by spec_path (D7 cap: 1 per spec per run).
         * A spec failing AGAIN after its one adjudication is a regression — the run
         * fails rather than adjudicating in a loop. Survives rescue's reset (like
         * `reopen_counts`): the cap holds across the whole run.
         */
        adjudication_counts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    }
)
export type E2ePhase = z.infer<typeof E2ePhaseSchema>

/**
 * One coverage-forecast row from the e2e ASSESSMENT (Decision 40 D3a): an EXISTING
 * committed spec this run's tasks may touch. `expectation` pre-routes a later suite
 * failure: `needs-update` (the tasks intentionally change what the spec asserts —
 * an author-update, not a regression) vs `should-still-pass` (a failure IS a
 * regression, reopen the named task(s)).
 */
export const E2eAffectedSpecSchema = z.object({
    /** Repo-relative path of the existing committed spec. */
    spec_path: z.string().min(1),
    /** Task id(s) in THIS run whose work touches the spec's journey. */
    task_ids: z.array(z.string().min(1)).min(1),
    expectation: z.enum(['needs-update', 'should-still-pass']),
})
export type E2eAffectedSpec = z.infer<typeof E2eAffectedSpecSchema>

/**
 * Run-start e2e ASSESSMENT record (Decision 40 D3) — written once per `--e2e` run
 * BEFORE any task executes. Persists the assessor's coverage forecast
 * (`affected_specs`), the boot config it resolved and wrote into the repo's
 * `playwright.config.ts` (`resolved` — the run-state copy feeds the author prompt
 * + suite env), and any degraded-coverage warning (auth-only gap, D3c).
 *   - `status` absent  — assessment not yet concluded (never spawned, or a crashed
 *                        attempt awaiting its one retry; `attempts` tracks those).
 *   - `status` "done"  — machinery validated (or steady-state) — tasks may proceed.
 *   - `status` "failed"— boot/machinery impossible: the run FAILS LOUD (every
 *                        non-terminal task swept `blocked-environmental`).
 * `reason` — plain-language failure verdict (set IFF failed — T3 below).
 * `attempts` — assessor spawn attempts so far (crash-retry bookkeeping, cap 2).
 */
export const E2eAssessmentSchema = openPhaseMarker(
    {
        /** Degraded-coverage note on a `done` assessment (e.g. logged-out coverage only). */
        warning: z.string().optional(),
        /** Boot config the assessor resolved + wrote into `playwright.config.ts` (D10). */
        resolved: z
            .object({
                start_command: z.string().min(1).optional(),
                base_url: z.string().min(1).optional(),
            })
            .optional(),
        /** Coverage forecast over EXISTING committed specs (empty when none exist). */
        affected_specs: z.array(E2eAffectedSpecSchema).default([]),
    },
    {}
)
export type E2eAssessment = z.infer<typeof E2eAssessmentSchema>

// ---------------------------------------------------------------------------
// RunState
// ---------------------------------------------------------------------------

/** The execution-mode preset that produced this run (Sequential/Balanced). */
export const ExecutionModeEnum = z.enum(['sequential', 'balanced'])
export type ExecutionMode = z.infer<typeof ExecutionModeEnum>

/**
 * Ship mode for the run's rollup. `live` (the DEFAULT) auto-merges each task into
 * staging and serial-merges the staging→develop rollup — the pipeline's purpose,
 * gated by branch protection + the review panel + TDD + the holdout. `no-merge`
 * (the `--no-ship` opt-out) opens the rollup PR but never merges. An immutable run
 * property set once at `run create` (from the absence/presence of `--no-ship`) —
 * persisted so `resume` and `finalize` read it from the run (the source of truth)
 * instead of re-prompting the user. A stored property, never a derived verdict.
 */
export const ShipModeEnum = z.enum(['no-merge', 'live'])
export type ShipMode = z.infer<typeof ShipModeEnum>

/**
 * One MISS (Decision 61): a defect found in shipped factory-produced code
 * POST-MERGE — the outer-loop signal the inner quality loop can't see. Recorded by
 * hand via `factory miss`, so it is the THIRD sanctioned stored-EVENT exception to
 * derive-don't-store (with `self_heal` D48 and `human_touches` D49): "a human found
 * this bug in shipped code" is history nothing in state or git can re-derive. NOT
 * metrics.jsonl (emitMetric swallows IO errors — the wrong tier for irrecoverable
 * human-reported history) and NOT a gh label (net-new write surface for zero
 * derivational value).
 */
export const MissSchema = z.object({
    /** The task whose shipped code the miss traces to (∈ run.tasks — refined below). */
    task_id: z.string().min(1),
    /** ISO-8601 record time, stamped by the CLI. */
    at: z.string(),
    /** REQUIRED human description — a miss without one is noise. */
    note: z.string().min(1),
    /**
     * Human judgment: which reviewer lens SHOULD have caught it (a panel role), or
     * 'none' when no lens could have. Stays a bare string here — a frozen state schema
     * must not import the verifier's panel roster; the `factory miss` CLI validates
     * it against `panelRolesFor(true) ∪ {'none'}`.
     */
    lens: z.string().min(1).optional(),
})
export type Miss = z.infer<typeof MissSchema>

/**
 * The whole run. Owns the per-task state map + the spec POINTER (not the spec).
 * `schema_version` is a state-schema version for forward migration; bump only on a
 * breaking schema change.
 *
 * ⚠️ For persisted-state validation, call {@link parseRunState}, NOT
 * `RunStateSchema.parse` directly. The exported object stays a plain `z.object`
 * (so downstream keeps `.shape` / `.extend`), which means a raw `.parse` runs the
 * per-TASK cross-field check (tasks use `TaskStateChecked`) but SKIPS the run-level
 * quota invariant (a `quota` checkpoint allowed only while paused|suspended).
 * `parseRunState` layers that check on. Use this schema directly only to derive a
 * shape (`.shape`/`.extend`); use `parseRunState` to validate untrusted input.
 */
export const RunStateSchema = z.object({
    /** State-schema version (independent of plugin version). */
    schema_version: z.literal(3).default(3),
    /** `run-YYYYMMDD-HHMMSS`. */
    run_id: z.string().min(1),
    status: RunStatusEnum.default('running'),
    execution_mode: ExecutionModeEnum.default('sequential'),
    ship_mode: ShipModeEnum.default('live'),

    /**
     * The Claude Code session id that OWNS this run. MANDATORY at `run create` —
     * resolution (`--session-id` flag, else `CLAUDE_CODE_SESSION_ID`) failing is a
     * UsageError, so every new run is owned. The schema keeps the field optional
     * only for legacy persisted runs created before the requirement. The Stop hook
     * uses it to scope a resumability HINT to the owning session (`findActiveByOwner`
     * never matches an ownerless run) — it never blocks, and there is no unscoped
     * fallback (see hooks/stop-gate.ts). An immutable property, never a derived verdict.
     */
    owner_session: z.string().min(1).optional(),

    /**
     * The per-run staging branch this run cut + pushed (`staging-<run-id>`). PINNED
     * ONCE at `run create` (Decision 33) so every later base-ref resolution — worktree
     * fork point, deterministic-gate diff base, reviewer/holdout inspect ref, ship
     * merge target, rollup source — reads the branch the run ACTUALLY created, not a
     * value recomputed by `runStagingBranch(run_id)`. A mid-run naming-scheme change
     * (e.g. the slashed→flat rename) would otherwise silently desync the recompute from
     * the already-pushed branch. Git provenance / immutable identity — NOT a derived
     * verdict, so derive-don't-store does not apply.
     */
    staging_branch: z.string().min(1),

    /** Pointer to the durable spec (Δ X) — NOT an embedded spec. */
    spec: SpecPointerSchema,

    /** Per-task state, keyed by task_id (cross-field checks applied per task). */
    tasks: z.record(z.string(), TaskStateChecked).default({}),

    /**
     * When true, the quota gate skips pacing and returns null unconditionally. Set once at
     * `run create` from `--ignore-quota`, or toggled true by `factory resume --ignore-quota`.
     * Persisted so both orchestrators skip the gate without per-call flag threading.
     * Default false: legacy runs (no field) are unaffected.
     */
    ignore_quota: z.boolean().default(false),

    /** Quota resume checkpoint (Decision 24); absent until a pause/suspend. */
    quota: QuotaCheckpointSchema.optional(),

    /**
     * Bounded auto-rescue ledger (S10, Decision 48). Stamped INSIDE the same locked
     * `applyRescue` mutation that performs an `--auto` reset. A sanctioned
     * stored-EVENT exception to derive-don't-store (precedent: the retired
     * `paused_minutes`): "how many self-heal cycles already ran" is history no
     * state/git re-derivation can recover. `factory rescue auto` requires
     * `attempts < SELF_HEAL_MAX_ATTEMPTS`, bounding the self-heal loop to ≤3
     * cycles per run (Decision 60; each failed finalize spends one).
     */
    self_heal: z
        .object({
            attempts: z.number().int().nonnegative(),
            last_at: z.string(),
        })
        .optional(),

    /**
     * Human-intervention ledger (S11): one entry per human action on the run —
     * `launch` (run create), `conflict` (a `--supersede` resolution, stamped on the
     * NEW run alongside its launch), `resume` (a human resume clearing a park),
     * `recover` (an approved rescue apply that did work). The second sanctioned
     * stored-EVENT exception (with `self_heal`): which touches happened is history
     * nothing can re-derive. `--auto` self-heal NEVER appends — it is not a human.
     * The touch METRIC stays derived: `(completed ? 1 : 0) / touches.length`,
     * guarded to n/a on an empty ledger — never a fabricated number.
     */
    human_touches: z
        .array(
            z.object({
                kind: z.enum(['launch', 'conflict', 'resume', 'recover']),
                at: z.string(),
            })
        )
        .default([]),

    /**
     * review-miss ledger (Decision 61): one entry per human-reported defect in
     * shipped factory-produced code, post-merge. The THIRD sanctioned stored-EVENT
     * exception to derive-don't-store (with `self_heal` + `human_touches`) — "a human
     * found this in shipped code" is history nothing can re-derive. Appended by
     * `factory miss`; `factory score` derives the miss metrics from it. Default []:
     * legacy runs (no field) carry no misses.
     */
    misses: z.array(MissSchema).default([]),

    /** Documentation phase marker; absent until the docs phase runs (engine docs phase). */
    docs: DocsPhaseSchema.optional(),

    /** PRD-traceability phase marker (S9); absent until the phase runs. */
    traceability: TraceabilityPhaseSchema.optional(),

    /**
     * Whether this run opted into the e2e phase (the `--e2e` flag). Set once at
     * `run create`; immutable for the run's lifetime — mirrors `ignore_quota`.
     * Default false: a run without the flag never gates on `wantsE2e()`.
     */
    e2e: z.boolean().default(false),

    /** E2E phase marker + author manifest; absent until the e2e phase first runs. */
    e2e_phase: E2ePhaseSchema.optional(),

    /** Run-start e2e assessment record (Decision 40 D3); absent until it first spawns. */
    e2e_assessment: E2eAssessmentSchema.optional(),

    /**
     * The `completed` run's staging→develop rollup outcome, persisted at finalize
     * ONLY when it did not land (`merged:false`). Two shapes: (a) an armed-but-not-
     * landed rollup PR (`number` present — e.g. the "auto-armed" branch-policy
     * fallback, D3; the run went terminal at step 7); (b) a forward-reconcile merge
     * CONFLICT before any rollup PR exists (`number` absent; finalize threw, run
     * stays NON-terminal). Absent on a merged rollup (nothing to recover) or a
     * `failed` run (no rollup attempted). Lets `rescue scan` flag either case
     * (`rollup_pending`) without a live GitHub call. Recovery: (a) `rescue apply
     * --recheck-rollup` reopens the run so a re-drive re-enters `finalizeRun`,
     * whose rollup() resume-guard finds the now-merged PR; (b) human resolves the
     * staging↔develop conflict, then plain `factory resume` re-enters finalize,
     * which overwrites/clears this marker with the real rollup result.
     */
    rollup: z
        .object({
            /** Rollup PR number; absent when the block precedes PR creation (reconcile conflict). */
            number: z.number().int().positive().optional(),
            merged: z.boolean(),
            reason: z.string().optional(),
        })
        .optional(),

    /**
     * Whether this run is a `/factory:debug` session. Set once at `run create`;
     * immutable for the run's lifetime — mirrors `e2e`/`ignore_quota`. A `debug:true`
     * run loops through multiple review⇄fix passes before finalizing, so it defers
     * `run finalize` (the PRD comment/close) to the debug driver instead of the plain
     * runner loop, and the Stop gate skips even its resumability hint for it. Default
     * false: a run without the flag finalizes exactly as before.
     */
    debug: z.boolean().default(false),

    /**
     * WHY the run went terminal as `failed`/`superseded` — a one-line human-facing
     * cause (evaluator exhaustion, e2e phase failure, operator cancel, superseding
     * run id, …). Written ONLY by `StateManager.finalize`, which REQUIRES it for
     * failed/superseded and FORBIDS it for completed; the schema keeps it optional
     * so legacy terminal states (written before the field existed) still parse —
     * they display "reason unavailable". A stored terminal EVENT, not a derived
     * verdict: the cause at flip time is history nothing can re-derive.
     */
    terminal_reason: z.string().min(1).optional(),

    /** Lifecycle timestamps (ISO-8601). */
    started_at: z.string(),
    updated_at: z.string(),
    ended_at: z.string().nullable().default(null),
})
export type RunState = z.infer<typeof RunStateSchema>

/**
 * Run-level cross-field invariant (Decision 24): a quota checkpoint records the
 * resume horizon for a QUOTA pause/suspend, so it may only be present while the
 * run is `paused` or `suspended`. Resume MUST clear it before returning to
 * `running`; a terminal run never carries one. Applied at parse time.
 */
/** Shared "reason set IFF failed" phase check (T1 docs / T2 e2e below). */
function reasonIffFailed(
    ctx: z.RefinementCtx,
    opts: {
        runId: string
        path: readonly string[]
        label: string
        status: string
        reason: string | null | undefined
    }
): void {
    const isFailed = opts.status === 'failed'
    const hasReason = opts.reason != null && opts.reason.length > 0
    if (isFailed && !hasReason) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...opts.path],
            message: `run '${opts.runId}' ${opts.label} is 'failed' but has no reason`,
        })
    }
    if (!isFailed && hasReason) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [...opts.path],
            message: `run '${opts.runId}' ${opts.label} is '${opts.status}' but carries a reason (reason is set IFF failed)`,
        })
    }
}

function refineRunCrossFields(run: RunState, ctx: z.RefinementCtx): void {
    // Window⇒status pairing: buildCheckpoint (the only writer) pauses on 5h and
    // suspends on 7d/unavailable — a mis-paired row is a hand-edit or a new writer
    // skipping the pairing, so reject it at parse time.
    if (run.quota != null) {
        const wanted: RunStatus = run.quota.binding_window === '5h' ? 'paused' : 'suspended'
        if (run.status !== wanted) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['quota'],
                message:
                    `run '${run.run_id}' carries a '${run.quota.binding_window}' quota checkpoint but status is ` +
                    `'${run.status}' (a '${run.quota.binding_window}' checkpoint pairs with '${wanted}')`,
            })
        }
    }

    // Terminal ⇔ ended: a terminal run must carry ended_at, and a live one must not —
    // every terminal write sets it and rescue's reopen resets it to null, so a mismatch
    // is a serialization bug (e.g. a status flip that skipped the timestamp).
    if (isTerminalRunStatus(run.status) !== (run.ended_at != null)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['ended_at'],
            message: isTerminalRunStatus(run.status)
                ? `run '${run.run_id}' is terminal ('${run.status}') but has no ended_at`
                : `run '${run.run_id}' is '${run.status}' (non-terminal) but carries ended_at`,
        })
    }

    // Run-level terminal_reason direction check: a reason may only accompany a
    // failed|superseded status (never completed, never a live run). The PRESENCE
    // requirement for failed/superseded lives in StateManager.finalize (write
    // path), not here — legacy terminal states predate the field and must re-read.
    if (run.terminal_reason !== undefined && run.status !== 'failed' && run.status !== 'superseded') {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['terminal_reason'],
            message: `run '${run.run_id}' is '${run.status}' but carries terminal_reason (only failed|superseded may)`,
        })
    }

    // T1: DocsPhase "reason set IFF failed" — mirrors the TaskState failure_reason
    // invariant (refineTaskCrossFields above). A failed docs phase must carry a reason
    // (human-facing report); a reason on a done docs phase is a serialization smell.
    if (run.docs !== undefined) {
        reasonIffFailed(ctx, {
            runId: run.run_id,
            path: ['docs', 'reason'],
            label: 'docs phase',
            status: run.docs.status,
            reason: run.docs.reason,
        })
    }

    // T4: TraceabilityPhase "reason set IFF failed" + a `done` marker may never
    // carry an `unmet` verdict — unmet blocks rollup, so recording it `done` is a
    // logic bug upstream; reject at parse time rather than let a condemned run roll up.
    if (run.traceability !== undefined) {
        reasonIffFailed(ctx, {
            runId: run.run_id,
            path: ['traceability', 'reason'],
            label: 'traceability phase',
            status: run.traceability.status,
            reason: run.traceability.reason,
        })
        if (run.traceability.status === 'done' && run.traceability.verdicts.some((v) => v.verdict === 'unmet')) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['traceability', 'verdicts'],
                message: `run '${run.run_id}' traceability phase is 'done' but carries an 'unmet' verdict (unmet must record as failed)`,
            })
        }
    }

    // T2: E2ePhase "reason set IFF failed" — mirrors the DocsPhase check above. Unlike
    // docs, `status` may also be legitimately ABSENT (pending, or cleared for a reopen
    // re-fire) — a reason is meaningless then too, so the check only fires when status
    // is present.
    if (run.e2e_phase?.status !== undefined) {
        const isFailed = run.e2e_phase.status === 'failed'
        reasonIffFailed(ctx, {
            runId: run.run_id,
            path: ['e2e_phase', 'reason'],
            label: 'e2e phase',
            status: run.e2e_phase.status,
            reason: run.e2e_phase.reason,
        })

        // `advisory` is the done-side counterpart of `reason` (see E2ePhaseSchema's own
        // doc comment) — never present on `failed`.
        const hasAdvisory = run.e2e_phase.advisory != null && run.e2e_phase.advisory.length > 0
        if (isFailed && hasAdvisory) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['e2e_phase', 'advisory'],
                message: `run '${run.run_id}' e2e phase is 'failed' but carries an advisory (advisory is the done-side counterpart of reason, never set on failed)`,
            })
        }
    }

    // T3: E2eAssessment "reason set IFF failed" — mirrors T2 (status may be absent
    // while a crashed attempt awaits its retry; the check only fires once concluded).
    if (run.e2e_assessment?.status !== undefined) {
        reasonIffFailed(ctx, {
            runId: run.run_id,
            path: ['e2e_assessment', 'reason'],
            label: 'e2e assessment',
            status: run.e2e_assessment.status,
            reason: run.e2e_assessment.reason,
        })
    }

    // F2: tasks map key must equal the row's task_id so DAG traversal and keyed lookups
    // always agree. A key/id mismatch is a serialization bug — reject at parse time.
    for (const [k, value] of Object.entries(run.tasks)) {
        if (k !== value.task_id) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['tasks', k, 'task_id'],
                message: `tasks map key '${k}' does not match row task_id '${value.task_id}'`,
            })
        }
    }

    // F3: every miss must reference a task that exists in this run (Decision 61) — a dangling
    // miss (typo'd task_id) is a serialization bug; reject at parse time so it never
    // persists (mirrors F2 + the reviewers[] coherence refine).
    run.misses.forEach((e, i) => {
        if (run.tasks[e.task_id] === undefined) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['misses', i, 'task_id'],
                message: `miss-ledger references task '${e.task_id}' which is not in run '${run.run_id}'`,
            })
        }
    })
}

/** {@link RunStateSchema} + run-level cross-field checks — the validating form the seam parses. */
const RunStateChecked = RunStateSchema.superRefine(refineRunCrossFields)

/**
 * Parse + validate an unknown value as a {@link RunState}. LOUD on any closed-enum
 * violation, missing required field, or cross-field invariant breach (ZodError) —
 * this is the structural guard that replaces the hand-written bash enum checks.
 * Prefer this over `RunStateSchema.parse` (this also runs the cross-field checks).
 */
export function parseRunState(raw: unknown): RunState {
    return RunStateChecked.parse(raw)
}

/**
 * Parse + validate an unknown value as a {@link TaskState}, including the
 * "failure_class set IFF failed" cross-field invariant. Prefer this over
 * `TaskStateSchema.parse`.
 */
export function parseTaskState(raw: unknown): TaskState {
    return TaskStateChecked.parse(raw)
}
