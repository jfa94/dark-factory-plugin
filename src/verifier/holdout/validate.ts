/**
 * WS10 (holdout, Δ Y / Decision 5) — holdout VALIDATION: agent judgment + a
 * DETERMINISTIC score.
 *
 * After the implementer commits (having seen only the visible criteria), a
 * holdout-validator agent independently checks the impl against the WITHHELD
 * criteria, one by one, returning a {@link HoldoutVerdict} per criterion. That
 * agent step is judgment (loop-owned — handlers cannot spawn); everything in this
 * module that turns its answer into a gate verdict is PURE + deterministic:
 *
 *   - {@link buildHoldoutPrompt} renders the criterion-by-criterion review prompt.
 *   - {@link parseHoldoutVerdicts} tolerantly extracts the `{criteria:[…]}` object
 *     from the agent's (often prose/fence-wrapped) output.
 *   - {@link checkHoldout} scores it against `quality.holdoutPassRate` with the
 *     anti-spoof guard (the verdict's `criterion` text must match the withheld
 *     criterion at that position; a missing/blank-evidence entry counts as a FAIL),
 *     mirroring the bash `pipeline-holdout-validate check` intent.
 *   - {@link holdoutEvidence} maps the result to a {@link GateEvidence} the loop
 *     appends to the deterministic gate evidence, so the holdout result is recorded
 *     into the risk-invariant merge gate via the existing `deriveMergeGateVerdict`.
 */
import type {GateEvidence} from '../../types/index.js'
import type {HoldoutRecord} from './store.js'

/** One reviewer verdict on a single withheld criterion. */
export interface HoldoutVerdict {
    /** The criterion text the verdict is FOR (must match the withheld text). */
    readonly criterion: string
    /** Whether the implementation satisfies it. */
    readonly satisfied: boolean
    /** Cited evidence (file:line / rationale). Blank ⇒ the verdict does not count. */
    readonly evidence: string
}

/** Per-criterion scored outcome (audit trail for the report). */
export interface HoldoutCriterionResult {
    readonly criterion: string
    /** Credited only when matched 1:1 with non-blank evidence and satisfied=true. */
    readonly satisfied: boolean
    readonly evidence: string | null
}

/** The deterministic holdout-gate result. */
export interface HoldoutCheckResult {
    readonly status: 'pass' | 'fail'
    /** Count of credited (satisfied) withheld criteria. */
    readonly satisfied: number
    /** Total withheld criteria. */
    readonly withheld: number
    /** Integer pass percentage (`floor(satisfied×100/withheld)`). */
    readonly passPct: number
    /** The effective threshold applied (clamped ≥ 1). */
    readonly threshold: number
    readonly criteria: readonly HoldoutCriterionResult[]
}

/** Inputs to one holdout-validator spawn (the loop-owned agent boundary). */
export interface HoldoutValidateInput {
    readonly taskId: string
    /** The worktree the validator inspects. */
    readonly worktree: string
    /** The withheld criteria to verify, in answer-key order. */
    readonly withheldCriteria: readonly string[]
    /** Fixed review model (risk-invariant, like the panel — D26). */
    readonly model: string
    /** Turn budget. */
    readonly maxTurns: number
}

/**
 * The injectable holdout-validator boundary (the runner spawns this agent as
 * the verify-phase holdout). The real v1 impl builds {@link buildHoldoutPrompt},
 * spawns the agent, and parses via {@link parseHoldoutVerdicts}; units inject a
 * fake. A parse/validation failure surfaces through {@link classifyHoldoutOutput}
 * as an `evaluator-failure` (bounded same-rung retry) — never a silent pass, and
 * never coerced into producer verdicts.
 */
export interface HoldoutValidatorRunner {
    validate(input: HoldoutValidateInput): Promise<readonly HoldoutVerdict[]>
}

/** Clamp the configured pass-rate to a sane, non-vacuous threshold (≥ 1). */
function clampThreshold(raw: number): number {
    if (!Number.isFinite(raw)) {
        return 80
    }
    const t = Math.floor(raw)
    return t < 1 ? 1 : t
}

/**
 * Render the holdout-validator prompt: the implementer was NOT shown these
 * criteria; verify each against the diff and answer in a strict per-criterion JSON
 * shape (one entry per criterion, same order — a missing entry is a FAIL).
 */
export function buildHoldoutPrompt(record: HoldoutRecord, worktree?: string, baseRef?: string): string {
    const lines: string[] = []
    if (worktree !== undefined && worktree.length > 0) {
        // The worktree forks from the per-run staging base (origin/staging-<run-id>);
        // diffing a hardcoded `origin/staging` resolves to an unrelated/colliding ref
        // after a repo branch rename. Fail loud rather than silently emit the wrong ref.
        if (baseRef === undefined || baseRef.length === 0) {
            throw new Error(
                'buildHoldoutPrompt: baseRef is required when a worktree is provided ' +
                    '(the per-run staging base ref the worktree forked from)'
            )
        }
        lines.push(
            `The implementation lives in the task worktree at: ${worktree}`,
            `Inspect it with: git -C ${worktree} diff ${baseRef}`,
            `Do NOT rely on your own working directory — it is a fresh checkout with no diff.`,
            ''
        )
    }
    lines.push(
        `Holdout validation for task ${record.task_id}.`,
        '',
        'The implementer was NOT shown the following acceptance criteria during execution.',
        'Independently verify whether the current diff satisfies each one.',
        '',
        `Withheld criteria (${record.withheld_count} of ${record.total_criteria} total):`,
        ...record.withheld_criteria.map((c, i) => `  ${i + 1}. ${c}`),
        '',
        'Respond with a single JSON object, no prose, exactly this shape:',
        '{ "criteria": [ { "criterion": "<exact text from above>", "satisfied": true|false, "evidence": "<file:line or short rationale>" }, ... ] }',
        '',
        'One entry per withheld criterion, in the same order. A missing entry is treated as a failure.'
    )
    return lines.join('\n')
}

/** Extract the `{criteria:[…]}` object from possibly prose/fence-wrapped output. */
function extractCriteria(raw: string): unknown[] {
    const candidates: string[] = [raw]
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
    if (fenced?.[1] != null && fenced[1].length > 0) {
        candidates.push(fenced[1])
    }
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first !== -1 && last > first) {
        candidates.push(raw.slice(first, last + 1))
    }
    for (const candidate of candidates) {
        try {
            const parsed: unknown = JSON.parse(candidate)
            if (
                parsed != null &&
                typeof parsed === 'object' &&
                Array.isArray((parsed as {criteria?: unknown}).criteria)
            ) {
                return (parsed as {criteria: unknown[]}).criteria
            }
        } catch {
            // try the next candidate
        }
    }
    throw new Error('holdout validator output has no parseable JSON object with .criteria')
}

/**
 * Parse a holdout-validator agent's raw output into {@link HoldoutVerdict}s.
 * Extraction stays tolerant (prose/fences), but every extracted ENTRY is validated
 * before a domain verdict is constructed: `criterion` must be a string, `satisfied`
 * a boolean, `evidence` a string. LOUD (throws) on a malformed entry or when no
 * `.criteria` object can be recovered — {@link classifyHoldoutOutput} catches the
 * throw and classifies it `evaluator-failure` (the single retry-vs-verdict
 * boundary). Coercing a malformed field (e.g. `satisfied: "yes"` → false) would
 * erase the distinction between broken evaluator output and a well-formed
 * producer miss, silently charging the producer for an evaluator fault.
 */
export function parseHoldoutVerdicts(raw: string): readonly HoldoutVerdict[] {
    return extractCriteria(raw).map((entry, i) => {
        const e = (entry ?? {}) as Record<string, unknown>
        if (typeof e.criterion !== 'string' || typeof e.satisfied !== 'boolean' || typeof e.evidence !== 'string') {
            throw new Error(
                `holdout verdict entry ${i + 1} is malformed — ` +
                    `criterion/satisfied/evidence must be string/boolean/string`
            )
        }
        return {criterion: e.criterion, satisfied: e.satisfied, evidence: e.evidence}
    })
}

/** Discriminates well-formed verdicts from an EVALUATOR fault (retry the evaluator). */
export type HoldoutOutputClassification =
    | {readonly kind: 'verdicts'; readonly verdicts: readonly HoldoutVerdict[]}
    | {readonly kind: 'evaluator-failure'; readonly reason: string}

/**
 * Classify the validator's raw output BEFORE scoring: unparseable JSON, a
 * malformed entry field (non-string criterion/evidence, non-boolean satisfied),
 * wrong cardinality, criterion-text mismatch (the positional anti-spoof), or a
 * `satisfied` verdict with blank evidence are EVALUATOR failures — the evaluator
 * broke its contract, so the verify wave retries at the same rung instead of
 * charging the producer. A well-formed miss (`satisfied:false`, any evidence —
 * including 0/N) is NOT an evaluator failure: it stays a blocking verdict.
 */
export function classifyHoldoutOutput(record: HoldoutRecord, raw: string): HoldoutOutputClassification {
    let verdicts: readonly HoldoutVerdict[]
    try {
        verdicts = parseHoldoutVerdicts(raw)
    } catch (err) {
        return {kind: 'evaluator-failure', reason: err instanceof Error ? err.message : String(err)}
    }
    const withheld = record.withheld_criteria
    if (verdicts.length !== withheld.length) {
        return {
            kind: 'evaluator-failure',
            reason: `wrong verdict cardinality (${verdicts.length} verdicts for ${withheld.length} withheld criteria)`,
        }
    }
    for (let i = 0; i < withheld.length; i++) {
        const v = verdicts[i]
        if (v === undefined || v.criterion !== withheld[i]) {
            return {kind: 'evaluator-failure', reason: `criterion text mismatch at position ${i + 1}`}
        }
        if (v.satisfied && v.evidence.trim().length === 0) {
            return {
                kind: 'evaluator-failure',
                reason: `satisfied verdict with blank evidence at position ${i + 1}`,
            }
        }
    }
    return {kind: 'verdicts', verdicts}
}

/**
 * Score the validator's verdicts against the answer key. Deterministic. A withheld
 * criterion is credited ONLY when the verdict at its position matches its exact
 * text, is `satisfied`, and carries non-blank evidence (the anti-spoof guard); a
 * missing or misaligned verdict is a FAIL. Passes when `passPct ≥ threshold`.
 */
export function checkHoldout(
    record: HoldoutRecord,
    verdicts: readonly HoldoutVerdict[],
    rawThreshold: number
): HoldoutCheckResult {
    const threshold = clampThreshold(rawThreshold)
    const criteria: HoldoutCriterionResult[] = record.withheld_criteria.map((criterion, i) => {
        const r = verdicts[i]
        const satisfied = r?.criterion === criterion && r.satisfied && r.evidence.trim().length > 0
        return {criterion, satisfied, evidence: r?.evidence ?? null}
    })
    const satisfied = criteria.filter((c) => c.satisfied).length
    const withheld = record.withheld_count
    const passPct = withheld > 0 ? Math.floor((satisfied * 100) / withheld) : 100
    return {
        status: passPct >= threshold ? 'pass' : 'fail',
        satisfied,
        withheld,
        passPct,
        threshold,
        criteria,
    }
}

/** Map a holdout result to the {@link GateEvidence} the loop records into the merge gate. */
export function holdoutEvidence(result: HoldoutCheckResult): GateEvidence {
    return {
        gate: 'holdout',
        observed: result.status === 'pass',
        detail: `holdout ${result.satisfied}/${result.withheld} (${result.passPct}% ${result.status === 'pass' ? '≥' : '<'} ${result.threshold}%)`,
    }
}
