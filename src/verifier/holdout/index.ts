/**
 * `src/verifier/holdout` — the Δ Y holdout gate (Decision 5). The ONE addressable
 * import surface for WS10 (the orchestrator) and any downstream consumer.
 *
 * Split (pure) → answer-key store (confined) → agent validation + deterministic
 * score → a {@link GateEvidence} recorded into the risk-invariant merge gate. Deep-
 * importing `src/verifier/holdout/*` is a smell; import here.
 */
import type {GateEvidence} from '../../types/index.js'
import {checkHoldout, holdoutEvidence} from './validate.js'
import type {HoldoutStore} from './store.js'
import type {HoldoutVerdictStore} from './verdict-store.js'

// The deterministic criteria split.
export {splitHoldout, holdoutCount, type HoldoutSplit} from './split.js'

// The answer-key store (runs/<run>/holdouts/<task>.json — Δ Y confined subtree).
export {
    HoldoutRecordSchema,
    parseHoldoutRecord,
    makeHoldoutRecord,
    InMemoryHoldoutStore,
    FsHoldoutStore,
    type HoldoutRecord,
    type HoldoutStore,
} from './store.js'

// Agent validation + deterministic scoring → gate evidence.
export {
    buildHoldoutPrompt,
    parseHoldoutVerdicts,
    classifyHoldoutOutput,
    checkHoldout,
    holdoutEvidence,
    type HoldoutOutputClassification,
    type HoldoutVerdict,
    type HoldoutCriterionResult,
    type HoldoutCheckResult,
    type HoldoutValidateInput,
    type HoldoutValidatorRunner,
} from './validate.js'

// The holdout-VERDICT store (the orchestrator's holdout → review record hand-off).
export {InMemoryHoldoutVerdictStore, FsHoldoutVerdictStore, type HoldoutVerdictStore} from './verdict-store.js'

// Exported fakes for downstream + own unit tests.

/**
 * Re-derive holdout gate evidence from persisted verdicts. Returns `undefined` if no
 * holdout record exists for this task. Shared by
 * {@link import("../../orchestrator/record.js").applyRecordReviews} (full-path) and the
 * merge-resync verify fast-path ({@link import("../../orchestrator/handlers.js")}) so
 * both always include holdout evidence in the merge gate. Lives here (not in validate.ts)
 * to avoid the validate.ts → verdict-store.ts → validate.ts import cycle.
 */
export async function deriveHoldoutEvidence(
    holdout: HoldoutStore,
    verdictStore: HoldoutVerdictStore,
    runId: string,
    taskId: string,
    rung: number,
    passRate: number
): Promise<GateEvidence | undefined> {
    if (!(await holdout.has(runId, taskId))) {
        return undefined
    }
    const record = await holdout.get(runId, taskId)
    const verdicts = await verdictStore.get(runId, taskId, rung)
    return holdoutEvidence(checkHoldout(record, verdicts, passRate))
}
