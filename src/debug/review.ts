/**
 * Whole-scope review harness (Decision 39's `/factory:debug` rebuild) — two
 * halves, one file: adjudication (Task 1, below) and the committed e2e
 * fold-in (Task 2, at the bottom). Both feed the SAME confirmed-blockers
 * gate so `/factory:debug`'s stop condition is a single check
 * (`confirmedBlockers.length === 0`) across review findings AND e2e
 * failures.
 *
 * `/factory:debug` reuses the SAME risk-invariant judgment layer the per-task
 * merge gate uses — citation-verify (Δ K) → independent finding-verifier (D27) →
 * per-reviewer adjudication — but applied to a WHOLE-SCOPE diff instead of one
 * task's diff. This module composes the EXISTING judgment/record exports
 * UNCHANGED (`buildPanelManifest`, `runPanel`, `parseRawReview`,
 * `buildWorktreeSource`, `makeReplayRunnerFactory`); it reimplements none of
 * citation-verify, confirmation, or panel construction. It also reuses
 * `runE2e` (`src/verifier/e2e/index.ts`) UNCHANGED for the e2e half — see
 * that section's header, further down, for its own notes.
 *
 * Deliberately narrow surface: debug consumes ONLY `runPanel`'s
 * `result.adjudicated`. `result.mergeGate` and `result.result` are per-task-phase
 * -shaped (they assume a single task's deterministic gate + phase-advance
 * semantics) and are not meaningful for a whole-scope review, so this module
 * never reads or re-exports them. `gateEvidence: []` is passed to `runPanel`
 * because whole-scope review has no per-task deterministic gate evidence to
 * combine — note this makes `deriveAllGatesVerdict`'s deterministic half (and so
 * `mergeGate.passed`/`result.result`) UNCONDITIONALLY fail-closed (an empty
 * evidence set never passes, by `deriveAllGatesVerdict`'s "nothing ran is never a
 * pass" rule in `src/core/state/derive.ts`) — harmless here because this module
 * never reads either field, but a real trap for any future caller that decides to
 * start reading `result.mergeGate`/`result.result` off of this call.
 */
import {buildPanelManifest} from '../verifier/judgment/panel.js'
import {E2E_TEST_DIR} from '../config/schema.js'
import {composeCrossVendorPrompt} from '../verifier/judgment/cross-vendor-prompt.js'
import type {CrossVendorResolution} from '../verifier/judgment/vendor.js'
import {resolvePluginRoot} from '../config/index.js'
import {parseRawReview, type Finding, type RawReview} from '../verifier/judgment/finding.js'
import {runPanel, type AdjudicatedReviewer} from '../verifier/judgment/panel-run.js'
import {buildWorktreeSource, makeReplayRunnerFactory, type ReviewerVerifications} from '../orchestrator/record.js'
import {scrubbedE2eEnv} from '../orchestrator/e2e-paths.js'
import type {SpawnRequest} from '../types/index.js'
import {runE2e, DefaultPlaywrightTool, type E2eResults, type PlaywrightTool} from '../verifier/e2e/index.js'
import type {Config} from '../config/index.js'
import {nonNull} from '../shared/assert.js'

/** The panel spawn manifest bundled with the whole-scope review's diff scope. */
export interface DebugReviewManifest {
    /** The panel {@link SpawnRequest} built by {@link buildPanelManifest}. */
    readonly manifest: SpawnRequest
    /** The diff base (a git ref or the empty-tree SHA). */
    readonly base: string
    /** The debug staging checkout path the reviewers run against. */
    readonly worktree: string
    /** Cross-vendor availability, derived from the caller's REAL resolution (Δ U/S5). */
    readonly codexAvailable: boolean
    /** The exact absence reason when unavailable — the runner echoes it verbatim. */
    readonly codexAbsentReason?: string
}

/**
 * Build the whole-scope review's panel manifest. A thin wrapper: delegates ALL
 * validation to {@link buildPanelManifest} (via `parseSpawnRequest`) and bundles
 * the result with the debug-specific diff-scope fields. No new validation logic.
 *
 * 3b(ii): when the cross-vendor slot is present, composes the SAME codex prompt
 * the per-task verify phase does ({@link composeCrossVendorPrompt}) — async only
 * for that reason (a real fs read of the two plugin docs).
 */
export async function buildReviewManifest(opts: {
    readonly resumePhase: SpawnRequest['resume_phase']
    readonly base: string
    readonly worktree: string
    /** The resolved cross-vendor slot (resolveCodexCrossVendor — a real probe, not a config-presence check). */
    readonly crossVendor: CrossVendorResolution
    /** D68 — the rendered disposition ledger; threaded into the codex prompt (a panel reviewer). */
    readonly priorDispositions?: string
}): Promise<DebugReviewManifest> {
    const crossVendorPrompt =
        opts.crossVendor.status === 'present'
            ? await composeCrossVendorPrompt({
                  pluginRoot: resolvePluginRoot(),
                  baseRef: opts.base,
                  worktree: opts.worktree,
                  ...(opts.priorDispositions !== undefined ? {priorDispositions: opts.priorDispositions} : {}),
              })
            : undefined
    const manifest = buildPanelManifest(opts.resumePhase, opts.crossVendor, false, crossVendorPrompt)
    return {
        manifest,
        base: opts.base,
        worktree: opts.worktree,
        codexAvailable: opts.crossVendor.status === 'present',
        ...(opts.crossVendor.status === 'absent' ? {codexAbsentReason: opts.crossVendor.reason} : {}),
    }
}

/** Input to {@link adjudicateWholeScope}. */
export interface AdjudicateWholeScopeInput {
    /** Raw, untrusted reviewer JSON output — one entry per panel reviewer. */
    readonly reviews: readonly unknown[]
    /** Already-recorded independent finding-verifier verdicts, per reviewer. */
    readonly verifications: readonly ReviewerVerifications[]
    /** The worktree citation-verify reads cited files from. */
    readonly worktree: string
    /** Δ U — a recorded second-vendor absence, threaded to the replay runner factory. */
    readonly crossVendorAbsent?: {readonly reason: string}
}

/** The result of adjudicating a whole-scope review. */
export interface AdjudicateWholeScopeResult {
    /** Per-reviewer adjudicated detail, passed through from `runPanel`. */
    readonly adjudicated: readonly AdjudicatedReviewer[]
    /** The parsed raw reviews (D68 — composeDispositions reads non-blocking findings off these). */
    readonly reviews: readonly RawReview[]
    /** Every CONFIRMED blocking finding, flattened across all reviewers. */
    readonly confirmedBlockers: readonly Finding[]
    /** True iff no reviewer has a confirmed blocker. */
    readonly clean: boolean
}

/**
 * Turn raw whole-scope reviewer output into a stop/continue decision.
 *
 * 1. `parseRawReview` each raw entry — LOUD (throws) on an unparseable review;
 *    never silently skipped.
 * 2. Build a {@link SourceReader} over `input.worktree` via `buildWorktreeSource`.
 * 3. Build the replay {@link FindingVerifierRunner} factory over the already-
 *    recorded verifier verdicts via `makeReplayRunnerFactory`.
 * 4. Run the judgment panel via `runPanel`, with `gateEvidence: []` (see module
 *    header) and `redact: true`.
 * 5. Flatten every reviewer's confirmed blockers into one array.
 *
 * Deliberately does NOT read or return `result.mergeGate`/`result.result` — see
 * module header.
 */
export async function adjudicateWholeScope(input: AdjudicateWholeScopeInput): Promise<AdjudicateWholeScopeResult> {
    const reviews = input.reviews.map(parseRawReview)
    const source = await buildWorktreeSource(input.worktree, reviews)
    const makeRunner = makeReplayRunnerFactory({
        reviews: input.reviews,
        verifications: input.verifications,
        ...(input.crossVendorAbsent !== undefined ? {crossVendorAbsent: input.crossVendorAbsent} : {}),
    })

    const result = await runPanel({
        reviews,
        source,
        makeRunner,
        gateEvidence: [],
        phase: 'verify',
        redact: true,
    })

    // Fail CLOSED on a verifier error (D27), mirroring reviewerResultOf's
    // identical `hadVerifierError` handling for the per-task merge gate
    // (`panel-run.ts`): an unresolved confirmation means this pass's true
    // clean/dirty status is UNKNOWN, not merely "not clean" — never silently
    // coerce it into `clean: false` and keep looping.
    const erroredReviewers = result.adjudicated.filter((a) => a.hadVerifierError).map((a) => a.reviewer)
    if (erroredReviewers.length > 0) {
        throw new Error(
            `adjudicateWholeScope: finding-verifier error for reviewer(s) ${erroredReviewers.join(', ')} — ` +
                "a blocking finding's confirmation status could not be determined for this pass. " +
                'Retry the verify spawn for the affected reviewer(s) and re-record before this pass can be judged clean or findings.'
        )
    }

    const confirmedBlockers = result.adjudicated.flatMap((a) => a.confirmedBlockers)
    return {
        adjudicated: result.adjudicated,
        reviews,
        confirmedBlockers,
        clean: confirmedBlockers.length === 0,
    }
}

/* -------------------------------------------------------------------------
 * E2E fold-in (Task 2) — same confirmed-blockers gate, same file.
 *
 * `/factory:debug`'s stop condition is ONE check
 * (`confirmedBlockers.length === 0`) across BOTH whole-scope review findings
 * ({@link adjudicateWholeScope}, above) AND the repo's COMMITTED Playwright
 * e2e suite. This section reuses {@link runE2e}
 * (`src/verifier/e2e/index.ts`) UNCHANGED — it reimplements none of
 * Playwright invocation, JSON-reporter parsing, or pass/fail
 * classification — and folds its per-spec failures into synthetic
 * {@link Finding}s.
 *
 * Env-builder note: the Playwright env comes from `scrubbedE2eEnv`
 * (`src/orchestrator/e2e-paths.ts`) — the same allowlisted builder the run
 * coroutine uses. The missing-config behavior DIFFERS from that coroutine
 * on purpose: the run coroutine SUSPENDS the whole run when
 * `e2e.startCommand`/`e2e.baseURL` are unset (`runE2eEmit`); debug's rule
 * is softer — {@link runCommittedE2e} returns `{kind: "skipped", ...}` and
 * the caller keeps looping on review findings alone, never suspending.
 *
 * Citation-verify note: e2e findings are constructed directly here, not
 * parsed via `parseRawReview` / run through `adjudicateWholeScope`'s
 * citation-verify — they are not reviewer prose citing source, they are a
 * mechanical Playwright report. {@link foldE2eIntoBlockers} merges them
 * into `confirmedBlockers` POST-adjudication, un-citation-verified, by
 * design. They are still constructed schema-valid against
 * {@link Finding} (both `file`+`line` present or both absent; `quote`
 * always non-empty) for consistency, in case anything ever re-parses them.
 * ------------------------------------------------------------------------- */

/** Input to {@link runCommittedE2e}. */
export interface RunCommittedE2eInput {
    /** The debug staging checkout the committed e2e suite runs against. */
    readonly cwd: string
    /** `testDir`/`startCommand`/`baseURL`/`readyTimeoutMs` — the resolved e2e config block. */
    readonly config: Config['e2e']
}

/** The result of {@link runCommittedE2e}: either the suite never ran, or it ran and produced findings. */
export type E2eFoldResult =
    | {readonly kind: 'skipped'; readonly reason: string}
    | {
          readonly kind: 'ran'
          readonly results: E2eResults
          readonly findings: readonly Finding[]
      }

/**
 * Run the repo's COMMITTED Playwright e2e suite (`E2E_TEST_DIR`) against
 * `input.cwd` and fold the result into {@link Finding}s.
 *
 * - Missing `config.startCommand`/`config.baseURL` → `{kind: "skipped", ...}`,
 *   never suspends (see module-section header above).
 * - Each `failed` spec → one blocking `severity: "critical"` finding citing
 *   `file: spec.file, line: 1` (Playwright spec results are file-level, not
 *   line-level — `1` is an honest placeholder, not invented precision) and
 *   `quote: spec.title` (non-empty, satisfies {@link Finding}'s citation shape).
 * - `flaky`/`skipped` specs never produce a finding — advisory-only, per
 *   the risk-invariant panel's "blocking is the only gating currency" rule.
 * - A tooling failure (`!results.ok` with zero individually-failed specs —
 *   e.g. Playwright itself crashed/failed to boot) → one blocking,
 *   deliberately UNCITABLE finding (`file`/`line` both omitted).
 *
 * `tool` mirrors {@link runE2e}'s own optional second parameter — tests fake
 * it rather than shelling out to a real Playwright binary.
 */
export async function runCommittedE2e(
    input: RunCommittedE2eInput,
    tool: PlaywrightTool = new DefaultPlaywrightTool()
): Promise<E2eFoldResult> {
    const {config} = input
    if (
        config.startCommand == null ||
        config.startCommand.length === 0 ||
        config.baseURL == null ||
        config.baseURL.length === 0
    ) {
        return {
            kind: 'skipped',
            reason:
                'e2e.startCommand/e2e.baseURL not configured — run `factory configure ' +
                '--set e2e.startCommand=<cmd> --set e2e.baseURL=<url>`',
        }
    }

    // runE2e THROWS on a tooling-level failure (missing Playwright binary, empty/
    // truncated reporter output) — fold it into the same uncitable blocking-finding
    // shape as an ok:false run instead of crashing the debug loop.
    let results: E2eResults
    try {
        results = await runE2e(
            {
                cwd: input.cwd,
                env: scrubbedE2eEnv(config, {
                    startCommand: nonNull(config.startCommand),
                    baseURL: nonNull(config.baseURL),
                }),
                replaceEnv: true,
                testDir: E2E_TEST_DIR,
            },
            tool
        )
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return {
            kind: 'ran',
            results: {ok: false, specs: [], counts: {passed: 0, failed: 0, flaky: 0, skipped: 0}},
            findings: [
                {
                    reviewer: 'e2e',
                    severity: 'critical',
                    blocking: true,
                    quote: '(uncitable — e2e tooling failure, no per-spec citation available)',
                    claim: 'the Playwright e2e run itself failed (tooling error, not a spec failure)',
                    description: `e2e tooling error — the Playwright run itself failed: ${detail}`,
                },
            ],
        }
    }

    const findings: Finding[] = results.specs
        .filter((spec) => spec.status === 'failed')
        .map((spec) => ({
            reviewer: 'e2e',
            severity: 'critical',
            blocking: true,
            file: spec.file,
            line: 1,
            quote: spec.title,
            // claim is schema-bounded to 300 chars; a Playwright title can exceed it.
            claim: `e2e spec failed: ${spec.title}`.slice(0, 300),
            description: `e2e spec failed: ${spec.title}`,
        }))

    if (!results.ok && results.counts.failed === 0) {
        findings.push({
            reviewer: 'e2e',
            severity: 'critical',
            blocking: true,
            quote: '(uncitable — e2e tooling failure, no per-spec citation available)',
            claim: 'the e2e run failed as a whole with no individually-failed spec',
            description: 'e2e tooling failed with no per-spec failures — investigate the Playwright run',
        })
    }

    return {kind: 'ran', results, findings}
}

/**
 * Fold {@link runCommittedE2e}'s result into an existing confirmed-blockers
 * list — the thin combinator that gives `/factory:debug` its single stop
 * condition (`confirmedBlockers.length === 0`) across review findings AND
 * e2e failures. A no-op (`confirmedBlockers` returned unchanged) when the
 * suite was skipped for missing config.
 */
export function foldE2eIntoBlockers(confirmedBlockers: readonly Finding[], e2e: E2eFoldResult): readonly Finding[] {
    return e2e.kind === 'skipped' ? confirmedBlockers : [...confirmedBlockers, ...e2e.findings]
}
