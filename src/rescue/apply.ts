/**
 * WS12 — rescue APPLY (the writer the SCAN feeds; Decision 22, Δ S).
 *
 * `scanRun` (scan.ts) classifies a stalled run; `applyRescue` is the only mutation
 * that acts on that classification. It resets the resettable tasks back to `pending`
 * (clearing the stale producer/reviewer/failure state) and, if the run had already
 * finalized to a terminal status, REOPENS it to `running` so the orchestrator picks the
 * reset work back up. After apply, a plain `factory resume` (quota gate) +
 * re-drive carries the run forward — rescue is the missing seam between them.
 *
 * THE "without repeating dead ends" CONTRACT (WS12 acceptance), enforced here:
 *   - DEFAULT apply resets `scan.resettable` = stuck (crashed in-flight) ∪
 *     recoverable (`failed` + `blocked-environmental`, blocker may have cleared).
 *   - DEAD-END failures (`spec-defect` / `capability-budget`) are LEFT failed — a
 *     re-attempt just repeats a determined failure. They reset ONLY when a human
 *     asserts the root cause is fixed, via `includeDeadEnds` (the CLI
 *     `--include-dead-ends` flag).
 *   - A `done` task is NEVER reset — that would un-ship merged work; an explicit
 *     `--task <done-id>` is a LOUD error, not a silent skip.
 *
 * Pure-ish: the only side effect is one locked `StateManager.update`. All
 * classification logic is delegated to the pure {@link scanRun}; the actual reset
 * is computed INSIDE the update mutator (on the locked snapshot) so a concurrent
 * writer cannot race the scan against the write.
 */
import {scanRun} from './scan.js'
import {effectiveAutoResets, SELF_HEAL_MAX_ATTEMPTS} from './auto.js'
import type {StateManager} from '../core/state/index.js'
import {isTerminalRunStatus} from '../types/index.js'
import {nowIso} from '../shared/time.js'
import {nonNull} from '../shared/assert.js'
import type {E2ePhase, RunState, RunStatus, TaskState} from '../types/index.js'

/**
 * Clear a `failed` e2e_phase verdict so `wantsE2e` (orchestrator/next.ts) re-enters
 * the phase and the verdict re-derives on the next pass — the Decision 39 rescue
 * repair path for W4.
 *
 * A failure with an EMPTY manifest is unambiguously a PRE-authoring failure (the
 * author crashed/timed out, emitted an unparseable status, or listed an unsafe
 * `spec_path` — every one of `runE2eRecord`'s `markFailed` calls before a manifest
 * is persisted). `runSuiteAndDecide` (the only other `markFailed` caller) always
 * reads a persisted, non-empty manifest first (its own empty-manifest branch is a
 * `markDone`, never a failure) — so no POST-authoring failure ever has an empty
 * manifest. That makes `manifest.length === 0` a reliable signal here: return
 * `undefined` (phase absent) so `runE2eEmit`'s `run.e2e_phase === undefined` gate
 * re-fires and the author actually re-spawns, instead of leaving a defined,
 * empty-manifest phase that `runSuiteAndDecide` would silently `markDone`
 * (Decision 39's "re-enters and re-derives" contract falsified for exactly this case).
 *
 * Otherwise (a manifest was authored), the triage rule is: DROP live cursors and
 * concluded verdicts (`status`/`reason`/`advisory`/`ended_at`/`adjudication` — a
 * rescued run's adjudication worktree is dead, and a stale cursor would re-spawn
 * against it); PRESERVE history and caps (`manifest`/`reopen_counts`/`attempts`/
 * `adjudication_counts` — the authored suite + per-task/per-spec cap spend a fresh
 * pass still needs). The author is not re-invoked once it has produced a manifest;
 * a dropped adjudication cursor is re-derived by the next suite pass.
 *
 * Lives here (not in orchestrator/e2e.ts, its only other natural home) to avoid a
 * circular import: e2e.ts already imports `resetTaskRow` from this module via
 * orchestrator/deps.ts → rescue/index.ts → rescue/apply.ts.
 */
function reopenE2ePhase(phase: E2ePhase): E2ePhase | undefined {
    if (phase.manifest.length === 0) {
        return undefined
    }
    const {
        status: _status,
        reason: _reason,
        advisory: _advisory,
        ended_at: _endedAt,
        adjudication: _adjudication,
        ...rest
    } = phase
    return rest
}

/** Options narrowing what a `rescue apply` resets. */
export interface RescueApplyOptions {
    /**
     * Explicit task ids to reset. When provided (non-empty) it OVERRIDES the
     * default resettable set: each named task is reset unless it is `done` (a LOUD
     * error — would un-ship) or already `pending` (a no-op, recorded in `skipped`).
     * A missing id is a LOUD error. Naming a task is itself the human assertion, so
     * an explicit dead-end IS reset (no `--include-dead-ends` needed).
     */
    tasks?: readonly string[]
    /**
     * Also reset dead-end failures (`spec-defect`/`capability-budget`). Ignored when
     * explicit `tasks` are given (those are reset regardless). The human is
     * asserting the root cause is fixed; default is `false` (don't repeat dead ends).
     */
    includeDeadEnds?: boolean
    /**
     * Clear a `failed` e2e_phase verdict (Decision 39) so the phase re-enters and
     * re-derives on the next pass. Ignored when `run.e2e_phase?.status !== "failed"`.
     * The human is asserting the underlying cause (flaky infra, a since-fixed app bug,
     * a reopen-cap exhaustion worth retrying) no longer applies — default `false`
     * (don't silently auto-retry a failed verdict). Alone sufficient to reopen a
     * terminal run even when no task itself is resettable.
     *
     * ALSO drops a `failed` e2e_assessment (Decision 40) — the WHOLE object, so
     * `wantsE2eAssessment` re-fires a fresh assessor on the next drive (unlike the
     * phase, there is no authored manifest worth preserving; the swept tasks are the
     * scan's `recoverable` set and reset via the normal default path).
     */
    resetE2e?: boolean
    /**
     * Reopen a `completed` run whose rollup ARMED but never landed
     * (`run.rollup?.merged === false` — e.g. the "auto-armed" branch-policy
     * fallback, finding #5) so a re-drive re-enters `finalizeRun`. Its rollup()
     * resume-guard then finds the (by-then, hopefully) merged PR and completes the
     * PRD-close + branch-GC. Ignored when `run.rollup` is absent or already merged.
     * No task/e2e state is touched — this is purely a reopen; finalize re-derives
     * and re-persists (or clears) `rollup` itself. Default `false` — a human is
     * asserting the queued merge landed (or is worth re-checking), not silently
     * auto-polled. Alone sufficient to reopen a terminal run.
     */
    recheckRollup?: boolean
    /**
     * Clear a `failed` PRD-traceability verdict (S9, Decision 47) so `wantsTraceability`
     * (orchestrator/next.ts) re-enters the audit and it re-derives on the next drive.
     * Drops the WHOLE marker → `undefined` (like the assessment, no manifest worth
     * preserving; the auditor re-reads the staging diff from scratch). Ignored when
     * `run.traceability?.status !== "failed"`. The human is asserting the unmet PRD intent
     * is now addressed (or the auditor crash was transient) — default `false` (never
     * silently re-audit a condemned run). Alone sufficient to reopen a terminal run.
     */
    resetTraceability?: boolean
    /**
     * The human's answer to a task's recorded NEEDS_CONTEXT question (Decision 69,
     * the CLI `--answer` flag). Requires exactly ONE explicit `tasks` entry, and that
     * task must carry a recorded `needs_context.question` (both LOUD errors
     * otherwise). Mutually exclusive with `auto` (self-heal has no answer). The reset
     * row keeps the question and gains the answer; the next spawn's prompt injects
     * both (handlers' needsContextNote).
     */
    answer?: string
    /**
     * The bounded self-heal path (`factory rescue auto`, S10 / Decision 48).
     * Mutually exclusive with every manual option above (a LOUD error, not a
     * merge): the auto-safe target set is computed INSIDE the locked mutator via
     * {@link effectiveAutoResets} — stuck ∪ recoverable, filtered to tasks that
     * are actionable post-reset. Requires `(run.self_heal?.attempts ?? 0) === 0`
     * and a non-empty effective set; otherwise the apply is a no-op and the
     * result carries `auto_blocked` so the CLI pages instead of resetting.
     * On success, `self_heal: {attempts: +1, last_at: at}` is stamped in the SAME
     * mutation as the resets (the sanctioned stored-event exception).
     */
    auto?: {at: string}
    /**
     * ISO stamp for the human_touches `recover` entry a manual (non-auto) apply
     * that actually does work appends (S11). Defaults to {@link nowIso}; tests pin it.
     */
    at?: string
    /**
     * Task ids the SAME invocation's adoption pass just flipped to `done` (Decision 60).
     * An explicit `--task <id>` naming one of these is a no-op `skipped` instead of the
     * LOUD "would un-ship" throw — the task WAS just shipped (its merged PR adopted), so
     * "un-ship" is the wrong framing. Any OTHER `done` id still throws (a genuine
     * un-ship). The default (no `--task`) path needs nothing: `selectTargets` runs on the
     * locked snapshot, which already sees the adopted rows as `done` → not resettable.
     */
    adoptedDone?: readonly string[]
}

/** What a `rescue apply` did. */
export interface RescueApplyResult {
    run_id: string
    /** The run status AFTER apply (`running` if it was reopened). */
    run_status: RunStatus
    /** Task ids reset to `pending` (in run.tasks order, or `tasks` order if explicit). */
    reset: string[]
    /** True iff a terminal run was reopened to `running` (had work to reset). */
    reopened: boolean
    /** Explicitly-named ids that were no-ops because already `pending`. */
    skipped: string[]
    /**
     * Why an `auto` apply refused to reset: the self-heal budget is spent
     * (`attempts` ≥ {@link SELF_HEAL_MAX_ATTEMPTS}) or nothing is effectively
     * resettable (`empty`). Absent on a successful auto and on every non-auto apply.
     */
    auto_blocked?: 'attempts' | 'empty'
    /** `self_heal.attempts` AFTER a successful auto apply; absent otherwise. */
    self_heal_attempts?: number
    /**
     * True iff a manual apply actually did work and appended a human_touches
     * `recover` entry (S11) — the CLI mirrors the touch to metrics.jsonl on this.
     * Always false on `auto` (self-heal is not a human) and on pure no-ops.
     */
    touched: boolean
}

/** Optional overrides applied on top of a plain {@link resetTaskRow} reset. */
export interface ResetTaskRowOpts {
    /**
     * Fresh e2e-reopen feedback to stamp onto the reset row (Decision 39). When
     * omitted, whatever `e2e_feedback` the task already carries flows through
     * UNCHANGED — see the field's own note below.
     */
    e2eFeedback?: string
    /**
     * The human's answer to the row's recorded NEEDS_CONTEXT question (Decision 69).
     * Written as `needs_context.answer` alongside the preserved question; ignored
     * when the row carries no question (applyRescue validates before calling).
     */
    answer?: string
    /**
     * Drop `pr_number` as part of the reset (default: keep it). e2e-reopen re-runs a
     * `done` task with NEW commits on the SAME deterministic branch, so its old PR is
     * already MERGED; forgetting the number makes `createTaskPrIdempotent` open a FRESH
     * PR instead of rebinding the merged one (which the serializer would no-op away).
     * Rescue resets leave it unset → `pr_number` preserved (idempotent-create, Δ P).
     */
    clearShippedPr?: boolean
}

/**
 * Reset one task row to a clean `pending` state. Drops the stale producer dial
 * position, panel results, failure classification, lifecycle timestamps, phase cursor,
 * and merge re-sync budget; PRESERVES identity, the dependency edges, the spec-time
 * risk dial, and the git/PR pointers (so an existing branch/PR is reused on the next
 * attempt — idempotent-create, Δ P).
 * `failure_class`/`failure_reason` MUST be dropped: the schema forbids them on any
 * non-failed status (refineTaskCrossFields), so a reset that kept them would fail
 * re-validation.
 *
 * `e2e_feedback` is DELIBERATELY NOT in the destructure-and-drop list below (unlike
 * `test_revision_feedback`): a plain rescue reset carries forward whatever e2e
 * feedback the task already had — the task's still-open e2e complaint is unrelated
 * to why THIS reset fired, so it isn't stale. The run-level e2e coroutine's reopen
 * loop (src/orchestrator/e2e.ts, Decision 39) reuses this SAME function, passing a
 * fresh `e2eFeedback` string via `opts` to overwrite it — one source of truth for
 * "what a reset clears/keeps", shared by both call sites. Exported for that reuse.
 */
/**
 * Flip one task row to a clean `done` state (the mirror of {@link resetTaskRow} for
 * the adoption path, Decision 60). Stamps `ended_at` once and drops the same
 * transient in-flight cruft {@link completeTask} clears — `spawn_in_flight` (no spawn
 * outlives a terminal task), `e2e_feedback` (a shipped task's reopen complaint is
 * resolved), and `fix_findings` (a stale fix-forward record must not outlive its task).
 * Also drops `failure_class`/`failure_reason`: adoption reaches this for a `failed`
 * task whose recorded PR merged (reconcile classifies it `merged-unrecorded` — only
 * `done` is exempt), and the schema forbids those fields on any non-failed status
 * ("set IFF failed", schema.ts refineTaskCrossFields) — keeping them would throw at
 * `parseRunState` and abort the whole adoption write, reopening the clobber hazard.
 * A no-op for the `completeTask` caller (a shipping task never carries them).
 * PRESERVES identity, dependency edges, the risk dial, and the git/PR pointers (the
 * adopted PR IS this task's shipped PR).
 *
 * Extracted so {@link completeTask} (orchestrator/transitions.ts) and rescue adoption
 * share ONE source of truth for "what shipping a task clears"; import direction is
 * orchestrator→rescue (via orchestrator/deps.ts), never the reverse (would cycle).
 */
export function doneTaskRow(task: TaskState, at: string): TaskState {
    return {
        ...task,
        status: 'done',
        ended_at: task.ended_at ?? at,
        spawn_in_flight: undefined,
        e2e_feedback: undefined,
        fix_findings: undefined,
        review_dispositions: undefined,
        last_failing_gates: undefined, // D71: a shipped task carries no gate-failure streak
        failure_class: undefined,
        failure_reason: undefined,
    }
}

export function resetTaskRow(task: TaskState, opts: ResetTaskRowOpts = {}): TaskState {
    // Destructure OUT the fields a reset must clear; keep the rest verbatim.
    const {
        failure_class: _failureClass,
        failure_reason: _failureReason,
        producer_role: _producerRole,
        test_revision_feedback: _testRevisionFeedback,
        // D71: the failing-gate streak is per-attempt evidence — never spans a rescue.
        last_failing_gates: _lastFailingGates,
        // The holdout evaluator-fault streak is per-attempt too (consecutive faults);
        // a rescued task starts with a fresh evaluator budget.
        holdout_evaluator_retries: _holdoutEvaluatorRetries,
        started_at: _startedAt,
        ended_at: _endedAt,
        phase: _phase,
        // WS2 hygiene: mirror completeTask/failTask (transitions.ts:88,112). A stale
        // checkpoint with escalation_rung reset to 0 would re-match the orchestrator's
        // idempotent re-spawn guard (orchestrator.ts:358-373) and hard-reset the freshly
        // recreated worktree to the pre-rescue tip_sha.
        spawn_in_flight: _spawnInFlight,
        // Kept by default (branch/PR pointers reused on retry — idempotent-create, Δ P);
        // only e2e-reopen opts in to dropping it, so the merged PR isn't rebound below.
        pr_number: _prNumber,
        ...rest
    } = task
    return {
        ...rest,
        status: 'pending',
        escalation_rung: 0,
        reviewers: [],
        merge_resyncs: 0,
        ...(opts.clearShippedPr !== true && _prNumber !== undefined ? {pr_number: _prNumber} : {}),
        ...(opts.e2eFeedback !== undefined ? {e2e_feedback: opts.e2eFeedback} : {}),
        // Decision 69: needs_context is NOT dropped above (the question survives the
        // reset); an answer, when given, is stamped alongside it.
        ...(opts.answer !== undefined && rest.needs_context !== undefined
            ? {needs_context: {question: rest.needs_context.question, answer: opts.answer}}
            : {}),
    }
}

/**
 * Choose which tasks to reset from a scanned run. Returns the target ids plus the
 * explicitly-named ids skipped for already being `pending`. THROWS on an explicit
 * id that is missing or `done`. See {@link RescueApplyOptions}.
 */
/** The run's task map with every `targets` row reset (pure — shared by both apply branches). */
function resetTasks(run: RunState, targets: readonly string[], answer?: string): Record<string, TaskState> {
    const nextTasks: Record<string, TaskState> = {...run.tasks}
    for (const id of targets) {
        nextTasks[id] = resetTaskRow(nonNull(run.tasks[id]), answer !== undefined ? {answer} : {})
    }
    return nextTasks
}

/**
 * The status fields a reopened terminal run gets (pure — shared by both apply
 * branches). A terminal run carries no quota checkpoint (finalize cleared it), and
 * `terminal_reason` must be dropped: the schema forbids a `running` run that still
 * carries one, so a reopen that kept it would fail re-validation.
 */
function reopenFields(reopen: boolean): Partial<RunState> {
    return reopen ? {status: 'running' as const, ended_at: null, terminal_reason: undefined} : {}
}

function selectTargets(run: RunState, opts: RescueApplyOptions): {targets: string[]; skipped: string[]} {
    const explicit = opts.tasks ?? []
    if (explicit.length > 0) {
        const targets: string[] = []
        const skipped: string[] = []
        for (const id of explicit) {
            const task = run.tasks[id]
            if (task === undefined) {
                throw new Error(`rescue: run '${run.run_id}' has no task '${id}'`)
            }
            if (task.status === 'done') {
                if (opts.adoptedDone?.includes(id) === true) {
                    skipped.push(id) // just adopted this invocation — not an un-ship
                    continue
                }
                throw new Error(
                    `rescue: refusing to reset shipped task '${id}' (status 'done') — would un-ship merged work`
                )
            }
            if (task.status === 'pending') {
                skipped.push(id) // already runnable — nothing to reset
                continue
            }
            targets.push(id)
        }
        return {targets, skipped}
    }

    // Default: the scan's resettable set, plus dead-ends only when asserted-fixed.
    const scan = scanRun(run)
    const targets = opts.includeDeadEnds === true ? [...scan.resettable, ...scan.dead_ends] : [...scan.resettable]
    return {targets, skipped: []}
}

/**
 * Reset a stalled run's resettable tasks to `pending` and (if it was terminal)
 * reopen it to `running`. The single mutation runs under the StateManager lock on
 * the freshly-read snapshot, so the classification can never race the write.
 * Idempotent: a second apply finds nothing resettable (the tasks are now `pending`)
 * and is a no-op with `reopened:false`.
 */
export async function applyRescue(
    state: StateManager,
    runId: string,
    opts: RescueApplyOptions = {}
): Promise<RescueApplyResult> {
    let result: RescueApplyResult | null = null

    if (
        opts.auto !== undefined &&
        ((opts.tasks?.length ?? 0) > 0 ||
            opts.includeDeadEnds === true ||
            opts.resetE2e === true ||
            opts.recheckRollup === true ||
            opts.resetTraceability === true ||
            opts.answer !== undefined)
    ) {
        throw new Error(
            'rescue: `auto` is mutually exclusive with manual target options ' +
                '(tasks/includeDeadEnds/resetE2e/recheckRollup/resetTraceability/answer)'
        )
    }
    if (opts.answer !== undefined && (opts.tasks?.length ?? 0) !== 1) {
        throw new Error('rescue: `answer` requires exactly one explicit --task (the one that asked the question)')
    }

    const updated = await state.update(runId, (run) => {
        // The bounded self-heal path: targets + gating computed on the LOCKED snapshot,
        // and the self_heal ledger stamped in the same mutation as the resets.
        if (opts.auto !== undefined) {
            const attempts = run.self_heal?.attempts ?? 0
            const noop = (blocked: 'attempts' | 'empty'): RunState => {
                result = {
                    run_id: runId,
                    run_status: run.status,
                    reset: [],
                    reopened: false,
                    skipped: [],
                    auto_blocked: blocked,
                    touched: false,
                }
                return run
            }
            if (attempts >= SELF_HEAL_MAX_ATTEMPTS) {
                return noop('attempts') // budget spent (≤3 cycles) — page for a human
            }
            const targets = effectiveAutoResets(run, scanRun(run))
            if (targets.length === 0) {
                return noop('empty')
            }

            const reopen = isTerminalRunStatus(run.status)
            result = {
                run_id: runId,
                run_status: reopen ? 'running' : run.status,
                reset: targets,
                reopened: reopen,
                skipped: [],
                self_heal_attempts: attempts + 1,
                touched: false, // self-heal is not a human (S11)
            }
            return {
                ...run,
                tasks: resetTasks(run, targets),
                self_heal: {attempts: attempts + 1, last_at: opts.auto.at},
                ...reopenFields(reopen),
            }
        }

        if (opts.answer !== undefined) {
            const id = nonNull(opts.tasks?.[0])
            if (run.tasks[id]?.needs_context === undefined) {
                throw new Error(
                    `rescue: task '${id}' has no recorded NEEDS_CONTEXT question — nothing for --answer to answer`
                )
            }
        }
        const {targets, skipped} = selectTargets(run, opts)
        const wasTerminal = isTerminalRunStatus(run.status)
        // A failed e2e_phase verdict, when the human asserts (via resetE2e) it's worth
        // retrying, is ALSO sufficient reason to reopen — a run can be stuck purely on
        // e2e (every task otherwise `done`, so `targets` is empty) and would otherwise
        // never have anything for a plain rescue apply to reset.
        const e2eReset = opts.resetE2e === true && run.e2e_phase?.status === 'failed'
        const assessReset = opts.resetE2e === true && run.e2e_assessment?.status === 'failed'
        const traceReset = opts.resetTraceability === true && run.traceability?.status === 'failed'
        const rollupRecheck = opts.recheckRollup === true && run.rollup?.merged === false
        // Only reopen a terminal run when there is actually work to pick back up —
        // reopening with nothing to do would just re-finalize to the same status.
        const reopen = wasTerminal && (targets.length > 0 || e2eReset || assessReset || traceReset || rollupRecheck)
        const didWork = targets.length > 0 || reopen || e2eReset || assessReset || traceReset || rollupRecheck

        result = {
            run_id: runId,
            run_status: reopen ? 'running' : run.status,
            reset: targets,
            reopened: reopen,
            skipped,
            touched: didWork,
        }

        // Phase repairs are DECOUPLED from run-status reopening: a crash between e2e's
        // markFailed and finalize leaves the run NON-terminal (`reopen` false), but the
        // asserted --reset-e2e repair must still clear the failed verdict — otherwise the
        // documented recovery silently no-ops and requires the non-obvious two-step of
        // finalizing first, then rescuing again.
        if (!didWork) {
            return run // pure no-op (update still stamps updated_at — harmless)
        }

        return {
            ...run,
            tasks: resetTasks(run, targets, opts.answer),
            // S11: a manual apply that did work IS a human touch.
            human_touches: [...run.human_touches, {kind: 'recover' as const, at: opts.at ?? nowIso()}],
            ...(e2eReset ? {e2e_phase: reopenE2ePhase(nonNull(run.e2e_phase))} : {}),
            // Decision 40: drop the WHOLE failed assessment (no manifest worth preserving)
            // so wantsE2eAssessment re-fires a fresh assessor on the next drive.
            ...(assessReset ? {e2e_assessment: undefined} : {}),
            // S9 (Decision 47): drop the WHOLE failed traceability marker so
            // wantsTraceability re-fires a fresh audit on the next drive.
            ...(traceReset ? {traceability: undefined} : {}),
            ...reopenFields(reopen),
        }
    })

    // `result` is always assigned by the (synchronous) mutator above.
    return {...nonNull<RescueApplyResult>(result), run_status: updated.status}
}
