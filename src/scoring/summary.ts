/**
 * WS12 — the run SUMMARY (Decision 22, Δ S; spine §5).
 *
 * A compact, deterministic roll-up of a run's outcome, derived PURELY from the
 * persisted {@link RunState} + the {@link PartialRunReport} already built from it.
 * The runner surfaces this (alongside the partial report) so a finished run —
 * `completed` or `failed` — is legible at a glance: what shipped, what failed and
 * under which failure class, how long it took, and how much producer + reviewer
 * effort it consumed.
 *
 * DERIVE-DON'T-STORE: every field is recomputed from ground truth. v1 deliberately
 * does NOT fabricate a numeric "quality score": the runtime never measures one
 * (gate verdicts are derived per-task, not aggregated into a stored number), and a
 * made-up score would be exactly the kind of un-grounded value Δ V forbids. The
 * summary reports COUNTS the runtime actually has. A measured score is a deferred
 * enhancement, not a silent omission.
 */
import type {RunState, RunStatus, ExecutionMode, FailureClass} from '../types/index.js'
import type {PartialRunReport} from './partial-report.js'
import {FailureClassEnum} from '../types/index.js'
import {nowIso} from '../shared/index.js'

/** Producer + reviewer effort tallies, summed across the run's tasks. */
export interface RunEffort {
    /** Total recorded reviewer results across all tasks (panel rounds expended). */
    reviewer_results: number
    /** The highest escalation rung any task reached (0 = no escalation). */
    max_escalation_rung: number
}

/** A shipped task's PR pointer (for the at-a-glance PR list). */
export interface ShippedPr {
    task_id: string
    pr_number?: number
    branch?: string
}

/** The compact run summary. Deterministic given (run, report, now). */
export interface RunSummary {
    run_id: string
    run_status: RunStatus
    /** WHY the run is terminal failed/superseded; absent on completed/live/legacy states. */
    terminal_reason?: string
    execution_mode: ExecutionMode
    spec_id: string
    issue_number: number
    repo: string
    generated_at: string
    /** Lifecycle timestamps + elapsed wall-clock (null until the run ended). */
    timing: {
        started_at: string
        ended_at: string | null
        duration_seconds: number | null
    }
    /** Task tallies (mirrors the partial report's totals). */
    totals: PartialRunReport['totals']
    /** Failure tally per closed failure class — every class present (0 when none). */
    failures_by_class: Record<FailureClass, number>
    /** Producer + reviewer effort. */
    effort: RunEffort
    /** The shipped tasks' PRs, in spec order. */
    shipped_prs: ShippedPr[]
    /** Δ U/S5 — tasks reviewed WITHOUT an independent second-vendor reviewer. */
    tasks_without_cross_vendor: number
    /** S11 — the human-touch ledger count (`run.human_touches`). */
    touches: number
    /**
     * S11 — the DERIVED objective metric: `(completed ? 1 : 0) / touches`. A clean
     * lights-out run (launch only) scores exactly 1.0. Null when touches is 0.
     */
    touch_metric: number | null
    /** 7a — the review-miss ledger count (`run.misses`). */
    misses: number
    /** 7a — misses bucketed by the lens that should have caught them (`'none'` = un-lensed). */
    misses_by_lens: Record<string, number>
}

/** Options for {@link buildRunSummary}. */
export interface BuildRunSummaryOptions {
    /** Override the `generated_at` stamp (tests pin this). Defaults to `nowIso()`. */
    now?: string
}

/**
 * Elapsed whole seconds between two ISO-8601 stamps, or null if either is missing
 * or unparseable (a negative or non-finite delta is treated as unknown, never a
 * misleading number).
 */
function durationSeconds(startedAt: string, endedAt: string | null): number | null {
    if (endedAt === null) {
        return null
    }
    const start = Date.parse(startedAt)
    const end = Date.parse(endedAt)
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return null
    }
    const delta = Math.floor((end - start) / 1000)
    return delta >= 0 ? delta : null
}

/**
 * Build the run summary from the run state + the report already derived from it.
 * Pure — no I/O, no clock except the injectable `now`. The report is passed in
 * (not re-derived) so the summary and the partial report agree by construction.
 */
/** S11 — `(completed ? 1 : 0) / touches`, or null on an empty ledger (0-division guard). Derived, never stored. */
export function touchMetricOf(run: {status: string; human_touches: readonly unknown[]}): number | null {
    const touches = run.human_touches.length
    if (touches === 0) {
        return null
    }
    return (run.status === 'completed' ? 1 : 0) / touches
}

/** 7a — bucket a run's misses by the lens that should have caught them (`'none'` = un-lensed). Derived, never stored. */
export function missesByLensOf(run: {misses: readonly {lens?: string | undefined}[]}): Record<string, number> {
    const byLens: Record<string, number> = {}
    for (const e of run.misses) {
        const key = e.lens ?? 'none'
        byLens[key] = (byLens[key] ?? 0) + 1
    }
    return byLens
}

export function buildRunSummary(
    run: RunState,
    report: PartialRunReport,
    opts: BuildRunSummaryOptions = {}
): RunSummary {
    // Seed every failure class to 0 so the shape is stable regardless of outcome.
    const failuresByClass = Object.fromEntries(FailureClassEnum.options.map((c) => [c, 0])) as Record<
        FailureClass,
        number
    >
    for (const f of report.failures) {
        failuresByClass[f.failure_class] += 1
    }

    const tasks = Object.values(run.tasks)
    const effort: RunEffort = {
        reviewer_results: tasks.reduce((n, t) => n + t.reviewers.length, 0),
        max_escalation_rung: tasks.reduce((m, t) => Math.max(m, t.escalation_rung), 0),
    }

    const shipped_prs: ShippedPr[] = report.shipped.map((s) => ({
        task_id: s.task_id,
        ...(s.pr_number !== undefined ? {pr_number: s.pr_number} : {}),
        ...(s.branch !== undefined ? {branch: s.branch} : {}),
    }))

    // S11 touch metric — derived, never stored (see touchMetricOf).
    const touches = run.human_touches.length
    const touchMetric = touchMetricOf(run)

    return {
        run_id: run.run_id,
        run_status: run.status,
        ...(run.terminal_reason !== undefined ? {terminal_reason: run.terminal_reason} : {}),
        execution_mode: run.execution_mode,
        spec_id: run.spec.spec_id,
        issue_number: run.spec.issue_number,
        repo: run.spec.repo,
        generated_at: opts.now ?? nowIso(),
        timing: {
            started_at: run.started_at,
            ended_at: run.ended_at,
            duration_seconds: durationSeconds(run.started_at, run.ended_at),
        },
        totals: report.totals,
        failures_by_class: failuresByClass,
        effort,
        shipped_prs,
        tasks_without_cross_vendor: report.cross_vendor_absences?.length ?? 0,
        touches,
        touch_metric: touchMetric,
        misses: run.misses.length,
        misses_by_lens: missesByLensOf(run),
    }
}

/** Render the elapsed duration as a compact `Hh Mm Ss` (or `—` when unknown). */
function renderDuration(seconds: number | null): string {
    if (seconds === null) {
        return '—'
    }
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    const parts: string[] = []
    if (h > 0) {
        parts.push(`${h}h`)
    }
    if (h > 0 || m > 0) {
        parts.push(`${m}m`)
    }
    parts.push(`${s}s`)
    return parts.join(' ')
}

/**
 * Render the summary as a compact one-screen markdown block. Complements the
 * fuller {@link renderPartialReportMarkdown}: the summary is the headline, the
 * report is the detail.
 */
export function renderRunSummaryMarkdown(summary: RunSummary): string {
    const out: string[] = []
    out.push(`## Run summary — \`${summary.run_id}\``)
    out.push('')
    out.push(
        `**${summary.run_status.toUpperCase()}** · execution-mode \`${summary.execution_mode}\` · ` +
            `spec \`${summary.spec_id}\` (PRD #${summary.issue_number}) · ${summary.repo}`
    )
    if (summary.run_status === 'failed' || summary.run_status === 'superseded') {
        out.push(`**Reason:** ${summary.terminal_reason ?? 'reason unavailable'}`)
    }
    out.push(`**Duration:** ${renderDuration(summary.timing.duration_seconds)}`)
    out.push(
        `**Tasks:** ${summary.totals.total} total · ${summary.totals.shipped} shipped · ` +
            `${summary.totals.failed} failed · ${summary.totals.incomplete} incomplete`
    )

    const classLine = FailureClassEnum.options
        .filter((c) => summary.failures_by_class[c] > 0)
        .map((c) => `${summary.failures_by_class[c]} ${c}`)
        .join(' · ')
    if (classLine.length > 0) {
        out.push(`**Failures:** ${classLine}`)
    }

    out.push(
        `**Effort:** ${summary.effort.reviewer_results} reviewer result(s) · ` +
            `max escalation rung ${summary.effort.max_escalation_rung}`
    )
    const metric = summary.touch_metric === null ? 'n/a' : summary.touch_metric.toFixed(2)
    out.push(`**Human touches:** ${summary.touches} · touch metric ${metric}`)
    // 7a — misses line, omitted when 0 (matches the failures line above).
    if (summary.misses > 0) {
        const byLens = Object.entries(summary.misses_by_lens)
            .map(([lens, n]) => `${lens} ×${n}`)
            .join(' · ')
        out.push(`**Misses:** ${summary.misses} (${byLens})`)
    }
    if (summary.tasks_without_cross_vendor > 0) {
        out.push(
            `**Review independence:** ${summary.tasks_without_cross_vendor} task(s) reviewed ` +
                `without a second-vendor reviewer`
        )
    }
    return out.join('\n')
}
