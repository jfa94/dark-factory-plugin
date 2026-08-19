/**
 * P1b — GitHub ADOPTION (forward-only autonomous repair; Decision 60, Session 5).
 *
 * Session 4's {@link reconcileRun} gave the engine read-only GitHub truth but every
 * remedy stayed a manual sentence. This module is the write side: it turns the
 * forward-only, non-destructive drift classes into applied repairs —
 *   - merged-unrecorded → flip the task to `done` (adopt the merged PR as its ship),
 *   - stale-pr-number   → rebind to the head's sole OPEN PR, or clear the pointer,
 *   - branch-missing     → re-push the local branch (plain push, never `--force`),
 *   - rollup-landed / all-tasks-merged → reopen a terminal run so finalize completes.
 * Destructive divergence (closed-unmerged, staging-missing, an ambiguous head, a
 * base mismatch) is NEVER touched — it flows out as `surfaced` for a human to decide.
 *
 * The hazard this closes: a merged-unrecorded task classifies as `resettable`, so a
 * default `rescue apply`/`auto` would reset it to `pending` and clobber merged work.
 * Adopting it to `done` FIRST — on the same locked snapshot the reset selection reads —
 * makes it un-resettable. Adoptions are FREE: they never spend `self_heal.attempts`
 * and never append a `human_touches` entry (D49) — only real task resets do.
 *
 * Split so `reconcile --adopt` can reuse an already-computed report without a second
 * probe: {@link planAdoptions} is pure (RunState + ReconcileReport → plan),
 * {@link applyAdoptions} is the single-lock executor, {@link adoptFromReport} chains
 * them, and {@link adoptRun} adds the reconcile probe (throws on any gh failure —
 * all-or-nothing, so each call site applies its own outage policy).
 */
import {reconcileRun, type Drift, type DriftClass, type ReconcileReport} from './reconcile.js'
import {doneTaskRow, reopenFields} from './apply.js'
import {isTerminalRunStatus} from '../types/index.js'
import {nonNull} from '../shared/index.js'
import type {StateManager} from '../core/state/index.js'
import type {GhClient, GitClient} from '../git/index.js'
import type {RunState, TaskState} from '../types/index.js'

/** What an adoption pass will do, computed purely from the reconcile report. */
export interface AdoptionPlan {
    /** merged-unrecorded (base == staging): flip to `done`, adopting the merged PR. */
    done: {task_id: string; pr_number: number; merge_sha?: string}[]
    /** stale-pr-number with exactly one OPEN PR on the head: rebind the pointer. */
    rebind: {task_id: string; pr_number: number}[]
    /** stale-pr-number with no/ambiguous OPEN PR: drop the pointer (ship re-derives). */
    clear: string[]
    /** branch-missing: re-push the local branch (existence re-checked at execution). */
    repush: {task_id: string; branch: string}[]
    /** Reopen a terminal run: a landed rollup, or every task now merged. */
    reopen: 'rollup' | 'all-done' | false
    /** Divergence left for a human: closed-unmerged, staging-missing, pr-unrecorded, base-mismatch. */
    surfaced: Drift[]
}

/** One applied repair, mirrored to metrics (`emitMetric(..., 'adoption', ...)`). */
export interface AdoptionAction {
    class: DriftClass | 'all-done'
    action: 'done' | 'rebind' | 'clear' | 'repush' | 'reopen'
    task_id?: string
    pr_number?: number
}

/** What an adoption pass DID (post-execution, race-checked against the locked snapshot). */
export interface AdoptionReport {
    actions: AdoptionAction[]
    /** Task ids flipped to `done`. */
    adopted: string[]
    /** Branches actually re-pushed (local existed). */
    repushed: string[]
    /** How the run was reopened, if at all. */
    reopened: 'rollup' | 'all-done' | false
    /** Divergence + skipped re-pushes (local branch gone) left for a human. */
    surfaced: Drift[]
    /** True iff anything at all was applied (drives "did we heal / recompute" gates). */
    changed: boolean
}

/**
 * Pure planner: {@link RunState} + {@link ReconcileReport} → {@link AdoptionPlan}.
 * Takes the FULL report (not just the drift lines) because the merged-unrecorded
 * base-branch check and the stale-pr-number OPEN-PR count both need `facts.tasks[].prs`.
 */
export function planAdoptions(run: RunState, report: ReconcileReport): AdoptionPlan {
    const done: AdoptionPlan['done'] = []
    const rebind: AdoptionPlan['rebind'] = []
    const clear: string[] = []
    const repush: AdoptionPlan['repush'] = []
    const surfaced: Drift[] = []

    const factsFor = (taskId: string | undefined) => report.facts.tasks.find((t) => t.task_id === taskId)

    for (const d of report.drifts) {
        switch (d.class) {
            case 'merged-unrecorded': {
                // Adopt ONLY a PR merged into THIS run's staging branch; a merge into
                // some other base is not this task's ship — surface it for a human.
                const tf = factsFor(d.task_id)
                const pr = tf?.prs.find((p) => p.number === d.pr_number)
                if (tf !== undefined && pr?.baseRefName === run.staging_branch) {
                    done.push({
                        task_id: tf.task_id,
                        pr_number: pr.number,
                        ...(pr.merge_sha !== undefined ? {merge_sha: pr.merge_sha} : {}),
                    })
                } else {
                    surfaced.push(d)
                }
                break
            }
            case 'stale-pr-number': {
                // Rebind iff the head carries exactly ONE open PR; anything else is
                // ambiguous → clear the stale pointer and let the next ship re-derive.
                const tf = factsFor(d.task_id)
                if (tf === undefined) {
                    surfaced.push(d)
                    break
                }
                const opens = tf.prs.filter((p) => p.state === 'OPEN')
                if (opens.length === 1) {
                    rebind.push({task_id: tf.task_id, pr_number: nonNull(opens[0]).number})
                } else {
                    clear.push(tf.task_id)
                }
                break
            }
            case 'branch-missing': {
                const tf = factsFor(d.task_id)
                if (tf === undefined) {
                    surfaced.push(d)
                } else {
                    repush.push({task_id: tf.task_id, branch: tf.branch})
                }
                break
            }
            case 'rollup-landed':
                // Run-level: handled by the reopen decision below (non-terminal runs need
                // nothing — finalize re-enters and rollup()'s already-MERGED short-circuit
                // completes the PRD-close + GC on its own).
                break
            case 'closed-unmerged':
            case 'pr-unrecorded':
            case 'staging-missing':
                // Not forward-only-safe (destructive or informational) → leave for a human.
                surfaced.push(d)
                break
        }
    }

    // Reopen a terminal run: a landed auto-armed rollup (finalize re-enters, rollup's
    // MERGED short-circuit completes close+GC), else a run whose every task is now
    // merged (a "failed" run whose drop actually landed) so finalize recomputes honestly.
    // Never when failed residue remains — that would loop re-finalize. all-done is the
    // most gate-adjacent choice (D60): forward-only, finalize recomputes from truth,
    // PRD comments are marker-deduped.
    let reopen: AdoptionPlan['reopen'] = false
    if (isTerminalRunStatus(run.status)) {
        const doneIds = new Set(done.map((d) => d.task_id))
        const allMergedAfter = Object.values(run.tasks).every((t) => t.status === 'done' || doneIds.has(t.task_id))
        if (report.rollup_landed && run.rollup?.merged === false) {
            reopen = 'rollup'
        } else if (done.length > 0 && allMergedAfter) {
            reopen = 'all-done'
        }
    }

    return {done, rebind, clear, repush, reopen, surfaced}
}

/**
 * Single-lock executor. State repairs (done-flips + rebind/clear + reopen) run in ONE
 * `state.update`; the sync mutator RE-CHECKS every intent against the locked snapshot
 * and silently skips a raced one (status moved, pointer moved, already applied). No
 * `human_touches`, no `self_heal` spend. Re-pushes run OUTSIDE the lock (they touch git,
 * not state), validating local existence first and surfacing a skip when the branch is gone.
 */
export async function applyAdoptions(
    deps: {state: StateManager; git: GitClient},
    runId: string,
    plan: AdoptionPlan,
    opts: {at: string}
): Promise<AdoptionReport> {
    const actions: AdoptionAction[] = []
    const adopted: string[] = []
    let reopened: AdoptionPlan['reopen'] = false

    const hasStateWork =
        plan.done.length > 0 || plan.rebind.length > 0 || plan.clear.length > 0 || plan.reopen !== false
    if (hasStateWork) {
        await deps.state.update(runId, (run) => {
            const tasks: Record<string, TaskState> = {...run.tasks}

            for (const d of plan.done) {
                const t = tasks[d.task_id]
                // Skip if the task vanished, already shipped, or its pointer moved off the
                // PR we were adopting (a concurrent writer re-bound it).
                if (t === undefined || t.status === 'done' || t.pr_number !== d.pr_number) {
                    continue
                }
                tasks[d.task_id] = doneTaskRow(t, opts.at)
                adopted.push(d.task_id)
                actions.push({class: 'merged-unrecorded', action: 'done', task_id: d.task_id, pr_number: d.pr_number})
            }

            for (const r of plan.rebind) {
                const t = tasks[r.task_id]
                if (t === undefined || t.status === 'done' || t.pr_number === r.pr_number) {
                    continue
                }
                tasks[r.task_id] = {...t, pr_number: r.pr_number}
                actions.push({
                    class: 'stale-pr-number',
                    action: 'rebind',
                    task_id: r.task_id,
                    pr_number: r.pr_number,
                })
            }

            for (const id of plan.clear) {
                const t = tasks[id]
                if (t === undefined || t.status === 'done' || t.pr_number === undefined) {
                    continue
                }
                const {pr_number: _drop, ...rest} = t
                tasks[id] = rest
                actions.push({class: 'stale-pr-number', action: 'clear', task_id: id})
            }

            // Reopen re-verified on the LOCKED snapshot: a landed rollup still armed, or
            // (after this pass's flips) EVERY task now `done`. A raced-away condition just
            // leaves the run terminal — forward-only, finalize recomputes either way.
            let reopenPatch: Partial<RunState> = {}
            if (plan.reopen !== false && isTerminalRunStatus(run.status)) {
                if (plan.reopen === 'rollup' && run.rollup?.merged === false) {
                    reopened = 'rollup'
                } else if (plan.reopen === 'all-done' && Object.values(tasks).every((t) => t.status === 'done')) {
                    reopened = 'all-done'
                }
                if (reopened !== false) {
                    reopenPatch = reopenFields(true)
                    actions.push({
                        class: reopened === 'rollup' ? 'rollup-landed' : 'all-done',
                        action: 'reopen',
                    })
                }
            }

            return {...run, tasks, ...reopenPatch}
        })
    }

    // Re-pushes: OUTSIDE the lock. Plain push (never --force — no such method exists on
    // the seam). A local branch that is gone can't be re-pushed here → surface the skip.
    const repushed: string[] = []
    const surfaced = [...plan.surfaced]
    for (const p of plan.repush) {
        if (await deps.git.branchExists(p.branch)) {
            await deps.git.push('origin', p.branch)
            repushed.push(p.branch)
            actions.push({class: 'branch-missing', action: 'repush', task_id: p.task_id})
        } else {
            surfaced.push({
                class: 'branch-missing',
                task_id: p.task_id,
                branch: p.branch,
                detail:
                    `PR head branch '${p.branch}' is gone on GitHub and no local branch exists to re-push — ` +
                    `re-create it from a clone before resuming`,
            })
        }
    }

    return {actions, adopted, repushed, reopened, surfaced, changed: actions.length > 0}
}

/** Plan + apply against an already-computed report (reused by `reconcile --adopt`). */
export function adoptFromReport(
    deps: {state: StateManager; git: GitClient},
    run: RunState,
    report: ReconcileReport,
    opts: {at: string}
): Promise<AdoptionReport> {
    return applyAdoptions(deps, run.run_id, planAdoptions(run, report), opts)
}

/**
 * Reconcile + plan + apply. Throws on ANY gh failure (all-or-nothing, inherited from
 * {@link reconcileRun}) so each call site applies its own outage policy — proceed,
 * contain, or page.
 */
export async function adoptRun(
    deps: {state: StateManager; git: GitClient; gh: GhClient},
    run: RunState,
    opts: {at: string}
): Promise<AdoptionReport> {
    const report = await reconcileRun(run, deps.gh)
    return adoptFromReport(deps, run, report, opts)
}

/** Compact one-line summary for logs / envelopes ("2 adopted done, 1 branch re-pushed"). */
export function summarizeAdoption(report: AdoptionReport): string {
    const parts: string[] = []
    if (report.adopted.length > 0) {
        parts.push(`${report.adopted.length} adopted done`)
    }
    const rebinds = report.actions.filter((a) => a.action === 'rebind').length
    const clears = report.actions.filter((a) => a.action === 'clear').length
    if (rebinds > 0) {
        parts.push(`${rebinds} pr rebound`)
    }
    if (clears > 0) {
        parts.push(`${clears} pr cleared`)
    }
    if (report.repushed.length > 0) {
        parts.push(`${report.repushed.length} branch re-pushed`)
    }
    if (report.reopened !== false) {
        parts.push(`reopened (${report.reopened})`)
    }
    if (report.surfaced.length > 0) {
        parts.push(`${report.surfaced.length} surfaced`)
    }
    return parts.length > 0 ? parts.join(', ') : 'no adoptions'
}
