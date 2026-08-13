/**
 * The run-level E2E COROUTINE (Decision 39) — mirrors `docs.ts`'s emit/record split,
 * ordered BEFORE it (`src/orchestrator/next.ts`'s `wantsE2e`).
 *
 * Unlike docs (one LLM pass, never re-entered), e2e has TWO very different kinds of
 * work:
 *   - AUTHORING a suite (needs an LLM + live-app exploration) — happens EXACTLY ONCE
 *     per run, on the first e2e entry (`run.e2e_phase === undefined`).
 *   - RUNNING the suite + deciding what to do with the result (fully mechanical —
 *     shells Playwright via `runE2e`, no LLM) — happens on EVERY entry, including
 *     every re-entry after a reopened task settles back to terminal.
 *
 * Spawns exist in three places (all `kind: "spawn"`, discriminated by `expects`):
 * the first-entry AUTHOR spawn, its crash-retry re-spawn (D5), and the ADJUDICATOR
 * spawn (D7 — a pre-existing committed spec failed unmappably and needs a
 * regression-vs-intentional-change ruling). Every other call drives
 * `runSuiteAndDecide` and returns a CONCLUSIVE action (`done` | `failed` |
 * `reopen` | `suspend`). The runner therefore loops while `kind === "spawn"`,
 * picking the results shape off `expects`; every other kind means "state already
 * updated, no agent needed, continue the next-task loop."
 *
 * Ordering vs. commit (a deliberate refinement over the plan's literal worked
 * example): the fail-first proof runs BEFORE the critical specs are merged into
 * staging, using the author's own (not-yet-merged) worktree as the proof's
 * "staging-side" run and a scratch worktree off the base branch as the "base-side"
 * run. A spec that fails the proof (vacuous / base-unusable) therefore NEVER lands
 * in the target repo's committed `e2e/` — only a PROVEN spec is merged. The plan's
 * literal ordering ("commit; then prove") would otherwise permanently pollute the
 * committed suite with a rejected spec on the fail path.
 *
 * Reopen mechanics reuse `resetTaskRow` (Decision 39) — the SAME primitive rescue
 * uses — with a fresh `e2eFeedback` override; `e2e_feedback` then reaches both
 * producer roles via the existing `PriorFailureNote` channel (handlers.ts).
 *
 * This file is the FACADE of the split coroutine: the emit/record dispatch plus the
 * public re-export surface. The legs live in `e2e-author.ts` (authoring + its record
 * gates), `e2e-suite.ts` (mechanical suite run + the D7 adjudication sub-machine),
 * `e2e-proof.ts` (the fail-first proof), and `e2e-shared.ts` (types + phase writers).
 */
import {createLogger} from '../shared/index.js'
import {E2E_TEST_DIR} from '../config/schema.js'
import {CONTROL_TITLE_PREFIX, E2eResultsSchema, type E2eAuthorResults} from './e2e-schemas.js'
import {
    e2eWorktreePath,
    e2eRunWorktreePath,
    e2eBaseProofWorktreePath,
    e2eThrowawayDir,
    resolveBootConfig,
} from './e2e-paths.js'
import type {E2eAction, E2eRunDeps} from './e2e-shared.js'
import {prepareAuthorSpawn, recordAuthorResults} from './e2e-author.js'
import {prepareAdjudicatorSpawn, recordAdjudication, runSuiteAndDecide} from './e2e-suite.js'

// The public e2e surface now owned by the leaf modules, re-exported so
// `orchestrator/index.ts` and `e2e.test.ts` keep importing it from `./e2e.js`
// (behavior-preserving motion — Decision 39/40 split).
export {CONTROL_TITLE_PREFIX, E2eResultsSchema, type E2eAuthorResults}
export {e2eWorktreePath, e2eRunWorktreePath, e2eBaseProofWorktreePath, e2eThrowawayDir}
export type {E2eAction, E2eRunDeps, E2eFileOps} from './e2e-shared.js'

const log = createLogger('e2e')

/** Emit the e2e phase's next step: spawn the author (first entry) or run the suite directly (re-entry). */
export async function runE2eEmit(deps: E2eRunDeps, runId: string): Promise<E2eAction> {
    const run = await deps.state.read(runId)
    const cfg = deps.config.e2e

    // Backstop only (R14, Decision 40): the run-start assessment normally resolves the
    // boot pair; a legacy/assessment-skipped run with no config override lands here.
    const boot = resolveBootConfig(cfg, run)
    if (boot === null) {
        const reason =
            'e2e phase has no boot config — the run-start assessment resolved none and no ' +
            'override is set; run `factory configure --set e2e.startCommand=<cmd> ' +
            '--set e2e.baseURL=<url>` then resume'
        await deps.state.update(runId, (s) => ({...s, status: 'suspended'}))
        log.warn(`run '${runId}': ${reason}`)
        return {kind: 'suspend', run_id: runId, reason}
    }

    if (run.e2e_phase === undefined) {
        return prepareAuthorSpawn(deps, run, runId, boot, E2E_TEST_DIR)
    }

    // Author-crash re-entry (D5): author_attempts persisted with no manifest and no
    // verdict means the previous author spawn died mid-flight — re-spawn it (the
    // record leg's retryAuthorOrFail caps total attempts).
    if (
        run.e2e_phase.status === undefined &&
        run.e2e_phase.manifest.length === 0 &&
        (run.e2e_phase.author_attempts ?? 0) >= 1
    ) {
        return prepareAuthorSpawn(deps, run, runId, boot, E2E_TEST_DIR)
    }

    // In-flight adjudication (D7): the cursor survived a crash/resume — idempotently
    // re-emit the adjudicator spawn (its record leg concludes or retries it).
    if (run.e2e_phase.status === undefined && run.e2e_phase.adjudication !== undefined) {
        return prepareAdjudicatorSpawn(deps, run, runId, boot)
    }

    // Re-entry after a reopened task settled: the manifest is already authored
    // (throwaway specs are RE-RUN, not re-authored) — go straight to the mechanical
    // suite run. The fail-first proof already ran once, at authoring time.
    return runSuiteAndDecide(deps, runId)
}

/** Record the e2e-author's result: on failure, fail the run (crash → one re-spawn,
 * D5); on success, prove + run the suite. Widened to the FULL {@link E2eAction} —
 * the crash-retry path returns a fresh `spawn`, so runners loop while `spawn`. */
export async function runE2eRecord(deps: E2eRunDeps, runId: string, results: E2eAuthorResults): Promise<E2eAction> {
    // A persisted adjudication cursor — not anything in the results shape — is what
    // says which spawn these results answer (D7): the cursor only exists while an
    // adjudicator is in flight.
    const run0 = await deps.state.read(runId)
    if (run0.e2e_phase?.adjudication !== undefined) {
        return recordAdjudication(deps, runId, run0, results, runE2eEmit)
    }
    return recordAuthorResults(deps, runId, results, runE2eEmit)
}
