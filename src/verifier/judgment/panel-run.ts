/**
 * WS7 — orchestrates ONE verify pass end-to-end (Decision 26/27, Δ K/T/U).
 *
 * The pipeline, in order:
 *   1. Parse each raw reviewer output → {@link RawReview} (LOUD on malformed).
 *   2. DETERMINISTIC citation-verify (Δ K): drop any blocking finding whose quote
 *      does not substring-match real source at file:line ±2.
 *   3. For every surviving BLOCKING finding, run the INDEPENDENT finding-verifier
 *      (D27) exactly once; only CONFIRMED blockers count. A verifier `error` is
 *      LOUD and UNRESOLVED — it fails the merge gate, never an auto-approve.
 *   4. Assemble the per-reviewer WS1 {@link ReviewerResult}[] with coherent
 *      counts (approve ⇒ 0 confirmed blockers; blocked ⇒ ≥1), and DERIVE the merge gate
 *      verdict via the frozen {@link deriveMergeGateVerdict} — NEVER stored.
 *   5. Map the derived outcome onto a {@link PhaseResult}: the panel SPAWN request
 *      when reviewers must still run; otherwise `advance` (merge gate passed) or
 *      `wait-retry` (merge gate blocked — bounded re-review/re-fix). State writes are
 *      the orchestrator's job; this module never touches the StateManager.
 *
 * The record ends at the independent finding-verifier (D27 verify-then-fix): a
 * confirmed blocker fails the merge gate. There is no producer-rebuttal phase — runPanel
 * exposes the confirmed blockers and the orchestrator routes a bounded fix-forward
 * re-spawn; runPanel does not loop a debate.
 */
import {
    advance,
    deriveMergeGateVerdict,
    mergeGateBlockReason,
    waitRetry,
    type GateEvidence,
    type GateVerdict,
    type ReviewerResult,
    type PhaseResult,
    type TaskPhase,
} from '../../types/index.js'
import {isCitable, type Finding, type RawReview} from './finding.js'
import {verifyCitations, type SourceReader} from './citation-verify.js'
import {confirmBlocker, type FindingVerifierRunner} from './finding-verifier.js'
import type {CrossVendorResolution} from './vendor.js'

/** A reviewer's findings after citation-verify + independent confirmation. */
export interface AdjudicatedReviewer {
    /** Reviewer identity (role string). */
    readonly reviewer: string
    /** The reviewer's raw self-reported verdict (before the merge gate is derived). */
    readonly rawVerdict: RawReview['verdict']
    /** Blocking findings that survived citation-verify AND were CONFIRMED. */
    readonly confirmedBlockers: readonly Finding[]
    /**
     * Blocking findings the independent verifier REFUTED (with its reason) —
     * previously dropped silently; surfaced for the Decision 68 disposition
     * ledger. Never forwarded to fix_findings; never gates.
     */
    readonly refuted: readonly {readonly finding: Finding; readonly reason: string}[]
    /** True iff any confirmation was UNRESOLVED (verifier error) — fails LOUDLY. */
    readonly hadVerifierError: boolean
    /**
     * Funnel stage 1 (7b/2): blocking findings this lens RAISED, post-cap. Surfaced
     * for `review.round` telemetry so `score --reviewers` can separate the two
     * attrition steps — `raised → cited` is "did it cite real code?",
     * `cited → confirmed` is "did the claim survive refutation?". A single
     * confirmed/raised rate would conflate quoting badly with claiming badly.
     */
    readonly raisedBlockers: number
    /** Funnel stage 2: those that survived citation-verify and reached a verifier. */
    readonly citedBlockers: number
}

/** The full result of one verify pass. */
export interface PanelRunResult {
    /** Per-reviewer adjudicated detail (audit). */
    readonly adjudicated: readonly AdjudicatedReviewer[]
    /** The WS1 ReviewerResult[] to persist (coherent counts). */
    readonly reviewerResults: readonly ReviewerResult[]
    /** The DERIVED merge gate verdict (never stored; recomputed here). */
    readonly mergeGate: GateVerdict
    /** The PhaseResult the orchestrator acts on. */
    readonly result: PhaseResult
    /**
     * Δ U — the LOUD record of a SECOND-VENDOR ABSENCE. Present (with a reason)
     * IFF the caller supplied a {@link RunPanelInput.crossVendor} resolution whose
     * status is `absent`. Left `undefined` when a second vendor IS present or when
     * no resolution was supplied — so a consumer that wants to surface "review ran
     * without an independent vendor" has a non-silent, machine-checkable signal
     * rather than having to re-probe. resolveCrossVendor (vendor.ts) is the source
     * of this resolution; runPanel never papers the absence over.
     */
    readonly crossVendorAbsence?: {readonly reason: string}
}

/**
 * Map ONE raw reviewer through citation-verify + confirmation. A reviewer's
 * `error` self-verdict is preserved (it fails the merge gate); its blocking findings
 * are still citation-verified + confirmed for the audit trail.
 */
async function adjudicateReviewer(
    review: RawReview,
    source: SourceReader,
    makeRunner: (review: RawReview) => FindingVerifierRunner,
    redact: boolean
): Promise<AdjudicatedReviewer> {
    const blocking = review.findings.filter((f) => f.blocking)
    const {kept} = verifyCitations(blocking, source, {redact})

    const runner = makeRunner(review)
    const confirmed: Finding[] = []
    const refuted: {finding: Finding; reason: string}[] = []
    let hadVerifierError = false

    for (const {finding, citedLine} of kept) {
        // Only citable findings reach here (citation-verify drops uncitable ones),
        // but guard for type-narrowing clarity.
        if (!isCitable(finding)) {
            continue
        }
        // Confirm at the reviewer's CITED coordinates: that's what the independent
        // verifier (and any pre-recorded replay verdict, keyed file:line) saw. The
        // RELOCATED finding is what gets forwarded, so fix_findings/reports carry
        // the corrected line.
        const outcome = await confirmBlocker(finding, runner, review.reviewer, citedLine)
        if (outcome.status === 'confirmed') {
            confirmed.push(finding)
        } else if (outcome.status === 'error') {
            hadVerifierError = true
        } else {
            // refuted ⇒ not forwarded to confirmed; kept for the disposition ledger (D68).
            refuted.push({finding, reason: outcome.reason})
        }
    }

    return {
        reviewer: review.reviewer,
        rawVerdict: review.verdict,
        confirmedBlockers: confirmed,
        refuted,
        hadVerifierError,
        raisedBlockers: blocking.length,
        citedBlockers: kept.length,
    }
}

/**
 * Derive a single reviewer's WS1 verdict from its adjudicated state, coherent
 * with the WS1 superRefine (approve ⇒ 0 confirmed blockers; blocked ⇒ ≥1):
 *   - a verifier error OR the reviewer's own `error` self-verdict ⇒ `error`.
 *   - ≥1 confirmed blocker ⇒ `blocked`.
 *   - otherwise ⇒ `approve`.
 */
function reviewerResultOf(a: AdjudicatedReviewer): ReviewerResult {
    const verdict: ReviewerResult['verdict'] =
        a.hadVerifierError || a.rawVerdict === 'error'
            ? 'error'
            : a.confirmedBlockers.length > 0
              ? 'blocked'
              : 'approve'
    return {reviewer: a.reviewer, verdict, confirmed_blockers: a.confirmedBlockers.length}
}

/** Inputs to {@link runPanel}. */
export interface RunPanelInput {
    /** Raw reviewer outputs (already parsed via parseRawReview). */
    readonly reviews: readonly RawReview[]
    /** Source reader for deterministic citation-verify. */
    readonly source: SourceReader
    /** Build the INDEPENDENT verifier for a given reviewer's findings (D27). */
    readonly makeRunner: (review: RawReview) => FindingVerifierRunner
    /** Deterministic-gate evidence to combine with the panel (WS6 supplies it). */
    readonly gateEvidence: readonly GateEvidence[]
    /** The phase to advance/retry at (the verify phase). */
    readonly phase: TaskPhase
    /** Redact retained finding text (Δ K). Defaults to true. */
    readonly redact?: boolean
    /** Bounded re-review attempt accounting for the wait-retry on a blocked merge gate. */
    readonly attempt?: number
    readonly maxAttempts?: number
    /**
     * Δ U — the resolved cross-vendor slot ({@link resolveCrossVendor}). When its
     * status is `absent`, runPanel records the absence LOUDLY on
     * {@link PanelRunResult.crossVendorAbsence}; when `present` (or omitted) no
     * absence is recorded. The caller resolves it (runPanel stays free of the
     * probe) and hands the resolution in — minimal wiring, no change to merge gate /
     * citation / confirm semantics.
     */
    readonly crossVendor?: CrossVendorResolution
    /**
     * S5/C — `review.requireCrossVendor === "block"`. When true AND the resolution
     * is `absent`, the quality-reviewer's result is DEMOTED to `verdict: "error"`
     * (synthesized, like enforcePanelRoster) before the merge gate derives — an
     * error verdict fails the gate, routing the existing wait-retry/escalate path.
     * Covers the runtime-fallback case too: probe said present, `codex exec` failed
     * at run time, the Claude fallback ran same-vendor.
     */
    readonly blockOnCrossVendorAbsence?: boolean
}

/**
 * Run the full verify pass over already-collected raw reviews and DERIVE the
 * merge gate. Never stores the verdict; recomputes it via {@link deriveMergeGateVerdict}.
 */
export async function runPanel(input: RunPanelInput): Promise<PanelRunResult> {
    const redact = input.redact ?? true

    const adjudicated: AdjudicatedReviewer[] = []
    for (const review of input.reviews) {
        adjudicated.push(await adjudicateReviewer(review, input.source, input.makeRunner, redact))
    }

    let reviewerResults: readonly ReviewerResult[] = adjudicated.map(reviewerResultOf)

    // S5/C block mode: the quality-reviewer slot REQUIRED a second vendor and none
    // ran — demote its result to `error` (synthesize one if the review is missing,
    // fail-closed) so the derived merge gate blocks with an honest reason.
    const demoted = input.blockOnCrossVendorAbsence === true && input.crossVendor?.status === 'absent'
    if (demoted) {
        const hasQuality = reviewerResults.some((r) => r.reviewer === 'quality-reviewer')
        reviewerResults = hasQuality
            ? reviewerResults.map((r) => (r.reviewer === 'quality-reviewer' ? {...r, verdict: 'error' as const} : r))
            : [...reviewerResults, {reviewer: 'quality-reviewer', verdict: 'error' as const, confirmed_blockers: 0}]
    }

    // DERIVE the merge gate (Δ V / D26): both the deterministic gates and the judgment
    // panel must pass; an `error` reviewer fails it LOUDLY. Never read from storage.
    const mergeGate = deriveMergeGateVerdict({reviewers: [...reviewerResults]}, input.gateEvidence)

    const result: PhaseResult = mergeGate.passed
        ? advance(nextOrSelf(input.phase))
        : waitRetry(
              input.phase,
              demoted
                  ? `cross-vendor reviewer required (review.requireCrossVendor=block) but absent: ${input.crossVendor.reason}`
                  : mergeGateBlockReason(reviewerResults, input.gateEvidence),
              input.attempt ?? 1,
              input.maxAttempts ?? 1
          )

    // Δ U: surface a second-vendor ABSENCE loudly on the panel result. We never
    // substitute a same-vendor reviewer into the cross-vendor slot (vendor.ts
    // refuses that); the absence simply becomes a non-silent field the consumer
    // can read. `present` (or an omitted resolution) records nothing.
    const crossVendorAbsence = input.crossVendor?.status === 'absent' ? {reason: input.crossVendor.reason} : undefined

    return crossVendorAbsence === undefined
        ? {adjudicated, reviewerResults, mergeGate, result}
        : {adjudicated, reviewerResults, mergeGate, result, crossVendorAbsence}
}

/**
 * The phase to advance to when the merge gate passes. The verify phase's success
 * advances to the next per-task phase; if `verify` is the configured phase we
 * advance to `ship`. We keep this local rather than importing nextPhase to avoid
 * coupling the orchestration to the phase-order walk — but the seam's order is the
 * source of truth, so we mirror only the verify→ship edge WS7 owns.
 */
function nextOrSelf(phase: TaskPhase): TaskPhase {
    return phase === 'verify' ? 'ship' : phase
}
