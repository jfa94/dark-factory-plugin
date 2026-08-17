/**
 * Record cores — the per-task orchestrator's deterministic kernels.  These are the
 * DETERMINISTIC, state-mutating functions that record out-of-band agent results into
 * run state; they live here (orchestrator/) so the orchestrator imports them directly without a
 * cli→orchestrator dependency inversion.
 *
 * Moved verbatim from the (since-deleted) CLI single-step subcommands:
 *   - src/cli/transition.ts      → TransitionEnvelope, persistStepCursor, readJsonInput
 *   - src/cli/subcommands/record-producer.ts → producerPhaseInfo, applyRecordProducer
 *   - src/cli/subcommands/record-holdout.ts  → RecordHoldoutEnvelope, applyRecordHoldout
 *   - src/cli/subcommands/record-reviews.ts  → VerifierVerdictInput, ReviewerVerifications,
 *                                               RecordReviewsInput, RecordReviewsEnvelope,
 *                                               buildWorktreeSource, makeReplayRunnerFactory,
 *                                               applyRecordReviews
 *
 * Signature adjustments from the move (only):
 *   - applyRecordReviews: was (deps: CliDeps, verdictStore, taskId, input);
 *     now (deps: RecordDeps, runId, taskId, verdictStore, input).  The body reads the
 *     task via deps.state.read(runId) instead of deps.run.
 *   - applyRecordHoldout: was (deps: CliDeps, verdictStore, taskId, raw);
 *     now (deps: RecordDeps, runId, taskId, verdictStore, raw).  The body reads runId
 *     from the explicit parameter instead of deps.run.run_id.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {readFile} from 'node:fs/promises'
import {isEnoent} from '../shared/fs-errors.js'
import {sep} from 'node:path'
import {parseJson} from '../shared/json.js'
import {markInFlight, escalateOrFail, applyProducerOutcome, completeTask, type TaskStep} from './transitions.js'
import {specTaskOf} from './handlers.js'
import {appendLedgerEntries} from '../spec/ledger.js'
import {taskWorktreePath} from './paths.js'
import {canonicalizePath} from '../shared/index.js'
import {buildGateContext, appendHoldoutEvidence} from './gate-context.js'
import {classifyFailure, ESCALATION_CAP, parseProducerStatus, type ProducerOutcome} from '../producer/index.js'
import {nextPhase, phaseToInFlightStatus} from '../types/index.js'
import {GateRunner} from '../verifier/deterministic/index.js'
import {
    runPanel,
    parseRawReview,
    composeDispositions,
    appendDispositions,
    PANEL_ROLES,
    panelRolesFor,
    touchesDatabase,
    type RawReview,
    type SourceReader,
    type FindingVerifierRunner,
    type AdjudicatedReviewer,
} from '../verifier/judgment/index.js'
import {
    checkHoldout,
    classifyHoldoutOutput,
    holdoutEvidence,
    type HoldoutVerdictStore,
    type HoldoutCheckResult,
} from '../verifier/holdout/index.js'
import {createLogger, nowIso, UsageError} from '../shared/index.js'
import {emitMetric} from '../scoring/telemetry.js'
import type {GateEvidence, GateVerdict, ReviewerResult, ProducerRole, TaskPhase, FixFinding} from '../types/index.js'
import type {HandlerDeps} from './types.js'
import type {StateManager, RunState} from './deps.js'

const log = createLogger('record')

// ---------------------------------------------------------------------------
// RecordDeps
// ---------------------------------------------------------------------------

/**
 * What a record needs: the reporter bundle ({@link HandlerDeps}) + the sanctioned
 * state write path.  A strict subset of {@link import("./orchestrator.js").OrchestratorDeps}.
 */
export interface RecordDeps extends HandlerDeps {
    readonly state: StateManager
}

// ---------------------------------------------------------------------------
// TransitionEnvelope + persistStepCursor + readJsonInput  (from transition.ts)
// ---------------------------------------------------------------------------

/** The envelope a record core emits — the next loop step for run/task. */
export interface TransitionEnvelope {
    readonly run_id: string
    readonly task_id: string
    /** Keep going at `step.phase`, or stop with `step.outcome` (done/failed). */
    readonly step: TaskStep
}

/**
 * Persist the in-flight phase cursor for a non-terminal step so the persisted task
 * status tracks the resume point. A terminal step (`done`/`failed`) already wrote
 * its own status — nothing to mark. Used by the record paths in this module.
 */
async function persistStepCursor(
    deps: {readonly state: StateManager},
    runId: string,
    taskId: string,
    step: TaskStep
): Promise<void> {
    if (!step.done) {
        await markInFlight(deps, runId, taskId, step.phase)
    }
}

/**
 * Read + parse a JSON input file (the runner's collected agent output). The `<T>`
 * is a caller-asserted shape for OUR OWN serialized envelopes; the actual JSON is
 * re-validated downstream (Zod) before any field is trusted — this cast only names
 * the expected shape at the read boundary.
 */
export async function readJsonInput<T>(path: string): Promise<T> {
    const raw = await readFile(path, 'utf8')
    return parseJson(raw, path) as T
}

// ---------------------------------------------------------------------------
// applyRecordProducer  (from record-producer.ts)
// ---------------------------------------------------------------------------

/** The producer role + resume target for a producer phase (LOUD on a non-producer phase). */
function producerPhaseInfo(phase: string): {
    role: ProducerRole
    phase: TaskPhase
    after: TaskPhase
} {
    if (phase === 'tests') {
        return {role: 'test-writer', phase: 'tests', after: 'exec'}
    }
    if (phase === 'exec') {
        return {role: 'implementer', phase: 'exec', after: 'verify'}
    }
    throw new UsageError(`phase must be a producer phase (tests | exec), got '${phase}'`)
}

/** Record the producer status into state and return the next-step envelope. */
export async function applyRecordProducer(
    deps: RecordDeps,
    runId: string,
    taskId: string,
    phase: string,
    statusLine: string
): Promise<TransitionEnvelope> {
    const {state} = deps
    const info = producerPhaseInfo(phase)
    // Defensive: nextPhase(phase) must equal the hardcoded resume target — keeps the
    // mapping honest if the phase order ever changes (LOUD on drift, never silent).
    if (nextPhase(info.phase) !== info.after) {
        throw new Error(`record-producer: phase order drift — nextPhase('${info.phase}') !== '${info.after}'`)
    }
    const run = await state.read(runId)
    if (run.tasks[taskId] === undefined) {
        throw new Error(`record-producer: run '${runId}' has no task '${taskId}'`)
    }
    const outcome = parseProducerStatus(statusLine)
    // Decision 70: an ALREADY_SATISFIED claim is engine-VERIFIED here, before the
    // shared transition seam (applyProducerOutcome throws on it by design).
    if (outcome.status === 'already-satisfied') {
        const step = await verifyAlreadySatisfied(deps, run, taskId, info.phase, outcome)
        await persistStepCursor({state}, runId, taskId, step)
        return {run_id: runId, task_id: taskId, step}
    }
    const step = await applyProducerOutcome(
        {state},
        runId,
        taskId,
        {role: info.role, phase: info.phase, resumePhase: info.after},
        outcome
    )
    await persistStepCursor({state}, runId, taskId, step)
    return {run_id: runId, task_id: taskId, step}
}

/**
 * Engine verification of a producer's ALREADY_SATISFIED claim (Decision 70).
 * All checks run at the spawn checkpoint's `tip_sha` — the PRE-producer tip — so a
 * producer can never launder its own fresh commits into the claim:
 *   1. a matching (phase, rung) spawn checkpoint must exist (it holds the tip);
 *   2. at least one commit SHA must be cited;
 *   3. the worktree is hard-reset to the checkpoint tip (claimant edits discarded);
 *   4. every cited SHA must resolve AND be an ancestor of that tip;
 *   5. the `test` gate must be GREEN at the untouched tip (the acceptance arbiter).
 * Pass → append a durable spec-ledger entry + complete the task. Any reject →
 * persist a fix_findings note and burn a rung via the normal ladder, resuming at
 * the SAME producer phase (an unverified claim is a producer miss, not infra).
 */
async function verifyAlreadySatisfied(
    deps: RecordDeps,
    run: RunState,
    taskId: string,
    phase: TaskPhase,
    outcome: Extract<ProducerOutcome, {status: 'already-satisfied'}>
): Promise<TaskStep> {
    const runId = run.run_id
    const task = run.tasks[taskId]
    if (task === undefined) {
        throw new Error(`record-producer: run '${runId}' has no task '${taskId}'`)
    }
    const worktree = taskWorktreePath(deps.workDir, runId, taskId)

    const reject = async (why: string): Promise<TaskStep> => {
        const reason = `ALREADY_SATISFIED claim rejected: ${why}`
        log.warn(`task '${taskId}': ${reason}`)
        await deps.state.updateTask(runId, taskId, (t) => ({
            ...t,
            fix_findings: [{reviewer: 'already-satisfied-verifier', description: reason}],
        }))
        return escalateOrFail(deps, runId, taskId, {action: 'retry', reason}, phase)
    }

    const checkpoint = task.spawn_in_flight
    if (checkpoint?.phase !== phase || checkpoint.rung !== task.escalation_rung) {
        return reject('no matching spawn checkpoint — the pre-producer tip cannot be established')
    }
    if (outcome.shas.length === 0) {
        return reject('no commit SHAs cited as evidence')
    }
    // Verify at the checkpoint tip, discarding any claimant edits.
    await deps.git.resetHardClean(checkpoint.tip_sha, {cwd: worktree})
    for (const sha of outcome.shas) {
        let resolved: string
        try {
            resolved = await deps.git.revParse(sha, {cwd: worktree})
        } catch {
            return reject(`cited SHA '${sha}' does not exist in the repository`)
        }
        let base: string
        try {
            base = await deps.git.mergeBase(resolved, checkpoint.tip_sha, {cwd: worktree})
        } catch {
            return reject(`cited SHA '${sha}' shares no history with the task base`)
        }
        if (base !== resolved) {
            return reject(`cited SHA '${sha}' is not an ancestor of the task base — new work is not evidence`)
        }
    }
    // The acceptance arbiter: the repo's test gate must already be green at the tip.
    const gate = await new GateRunner().run({
        ...buildGateContext(deps, runId, taskId, run.staging_branch),
        gates: ['test'],
    })
    const red = gate.evidence.filter((e) => !e.observed)
    if (red.length > 0) {
        return reject(
            `test gate is RED at the base tip (${red.map((e) => e.detail ?? e.gate).join('; ')}) — ` +
                'the base does not satisfy the task'
        )
    }
    await appendLedgerEntries(deps.dataDir, run.spec.repo, run.spec.spec_id, [
        {
            task_id: taskId,
            run_id: runId,
            shas: [...outcome.shas],
            verified_at: nowIso(),
            source: 'already-satisfied',
        },
    ])
    log.info(
        `task '${taskId}' verified ALREADY_SATISFIED (${outcome.shas.join(', ')}) — completing without producer work`
    )
    return completeTask(deps, runId, taskId)
}

// ---------------------------------------------------------------------------
// applyRecordHoldout  (from record-holdout.ts)
// ---------------------------------------------------------------------------

/** The holdout-validation evidence document `applyRecordHoldout` records. */
export interface RecordHoldoutEnvelope {
    readonly run_id: string
    readonly task_id: string
    /** The DERIVED holdout gate evidence (recorded into the merge gate by record-reviews). */
    readonly evidence: GateEvidence
    /** The scored detail (audit). */
    readonly check: HoldoutCheckResult
}

/**
 * CONSECUTIVE same-rung verify re-runs allowed for holdout EVALUATOR failures
 * (malformed validator output). Distinct from SPAWN_REDRIVE_CAP (hung-spawn
 * respawn, Decision 66) — this bounds delivered-but-broken output, and the retry
 * write clears `spawn_in_flight` so a retry is never charged to that budget.
 * The counter (`holdout_evaluator_retries`) resets after ANY well-formed holdout
 * result (pass or producer miss) and on rescue reset. Exhaustion fails the task
 * `blocked-environmental`: the evaluator, not the producer, is broken.
 */
export const HOLDOUT_EVALUATOR_RETRY_CAP = 2

/** Discriminated result of {@link applyRecordHoldout}. */
export type RecordHoldoutResult =
    | {readonly kind: 'recorded'; readonly envelope: RecordHoldoutEnvelope}
    /** Evaluator failure: nothing persisted to the verdict store; `step` is the
     * already-persisted next step (same-rung verify retry, or terminal fail at cap). */
    | {readonly kind: 'evaluator-failure'; readonly step: TaskStep}

/**
 * Record the holdout-validator output: persist verdicts + emit derived evidence.
 * Malformed output is an EVALUATOR failure, not a producer miss — it re-runs the
 * verify wave at the SAME rung (bounded by {@link HOLDOUT_EVALUATOR_RETRY_CAP})
 * without persisting verdicts or touching the escalation rung; a well-formed miss
 * (including 0/N) records normally and stays blocking via the merge gate.
 */
export async function applyRecordHoldout(
    deps: RecordDeps,
    runId: string,
    taskId: string,
    rung: number,
    verdictStore: HoldoutVerdictStore,
    raw: string
): Promise<RecordHoldoutResult> {
    if (!(await deps.holdout.has(runId, taskId))) {
        throw new Error(
            `record-holdout: task '${taskId}' has no withheld answer key — nothing to validate ` +
                `(applyRecordHoldout must only record when the orchestrator surfaced a holdout holdout)`
        )
    }
    const record = await deps.holdout.get(runId, taskId)
    const classified = classifyHoldoutOutput(record, raw)
    const run = await deps.state.read(runId)
    const used = run.tasks[taskId]?.holdout_evaluator_retries ?? 0
    if (classified.kind === 'evaluator-failure') {
        if (used >= HOLDOUT_EVALUATOR_RETRY_CAP) {
            const step = await escalateOrFail(
                deps,
                runId,
                taskId,
                classifyFailure({
                    kind: 'environmental',
                    reason: `holdout evaluator produced malformed output ${used + 1} times (cap ${HOLDOUT_EVALUATOR_RETRY_CAP}): ${classified.reason}`,
                }),
                'verify'
            )
            await persistStepCursor(deps, runId, taskId, step)
            return {kind: 'evaluator-failure', step}
        }
        // Clear the spawn checkpoint ATOMICALLY with the retry increment: this retry
        // returns to the SAME (verify, rung), so a surviving checkpoint would make the
        // next orchestration step mistake the evaluator retry for a hung spawn and
        // spend the independent spawn re-drive budget (Decision 66).
        await deps.state.updateTask(runId, taskId, (t) => ({
            ...t,
            holdout_evaluator_retries: used + 1,
            spawn_in_flight: undefined,
        }))
        log.warn(
            `holdout evaluator failure (retry ${used + 1}/${HOLDOUT_EVALUATOR_RETRY_CAP}): ${classified.reason} — re-running the verify wave at the same rung`
        )
        const step: TaskStep = {done: false, phase: 'verify'}
        await persistStepCursor(deps, runId, taskId, step)
        return {kind: 'evaluator-failure', step}
    }
    const verdicts = classified.verdicts
    await verdictStore.put(runId, taskId, rung, verdicts)
    // The counter tracks CONSECUTIVE evaluator faults: any well-formed result —
    // pass or producer miss alike — proves the evaluator works, so the streak ends.
    if (used > 0) {
        await deps.state.updateTask(runId, taskId, (t) => ({...t, holdout_evaluator_retries: undefined}))
    }

    const check = checkHoldout(record, verdicts, deps.config.quality.holdoutPassRate)
    return {kind: 'recorded', envelope: {run_id: runId, task_id: taskId, evidence: holdoutEvidence(check), check}}
}

// ---------------------------------------------------------------------------
// applyRecordReviews  (from record-reviews.ts)
// ---------------------------------------------------------------------------

/** A fixed, reviewer-independent identity for the replay verifier (D27 independence). */
const REPLAY_IDENTITY = 'runner-replay'

/** One pre-recorded finding-verifier verdict (runner-collected, out-of-band). */
export interface VerifierVerdictInput {
    readonly file: string
    readonly line: number
    /** True iff the finding holds against the code (confirmed). */
    readonly holds: boolean
    readonly note: string
}

/** A reviewer's pre-recorded finding-verifier verdicts. */
export interface ReviewerVerifications {
    readonly reviewer: string
    readonly verdicts: readonly VerifierVerdictInput[]
}

/** The input file shape (runner-collected panel + verify-then-fix output). */
export interface RecordReviewsInput {
    /** The raw reviewer payloads (one per panel reviewer) — parsed LOUD. */
    readonly reviews: readonly unknown[]
    /** Per-reviewer pre-recorded finding-verifier verdicts (the replay source). */
    readonly verifications: readonly ReviewerVerifications[]
    /** Δ U — a recorded second-vendor absence (surfaced loudly by runPanel). */
    readonly crossVendorAbsent?: {readonly reason: string} | undefined
}

/** The verify-record envelope `applyRecordReviews` produces. */
export interface RecordReviewsEnvelope extends TransitionEnvelope {
    /** The per-reviewer results this round derived (audit; state may clear them on retry). */
    readonly reviewers: readonly ReviewerResult[]
    /** The DERIVED merge gate verdict (never stored; recomputed here). */
    readonly mergeGate: GateVerdict
    /**
     * Δ U — a SECOND-VENDOR ABSENCE surfaced from {@link runPanel}. Present (with a
     * reason) IFF this verify pass ran WITHOUT an independent cross-vendor reviewer;
     * the record also emits a LOUD `log.warn` so the absence is never silently swallowed
     * (runPanel records it on the panel result, but the record is the last hop that can
     * drop it). An audit/strength signal only — it NEVER gates the merge gate. Left absent
     * when a second vendor was present.
     */
    readonly crossVendorAbsence?: {readonly reason: string}
}

/**
 * Build a {@link SourceReader} over the task worktree for citation-verify: async-load
 * every cited file ONCE into a map, then serve `readLines` synchronously.
 *
 * Only ENOENT — the cited file is genuinely ABSENT from the worktree — maps to
 * `null` (its citations are then unverifiable and dropped). Any OTHER read error
 * (EACCES, EISDIR, an I/O fault) is a REAL failure and RETHROWS: demoting it to
 * "missing" would silently drop a citation that may back a real blocker, turning a
 * read fault into a false merge-gate-pass. Fail loud instead.
 */
export async function buildWorktreeSource(worktree: string, reviews: readonly RawReview[]): Promise<SourceReader> {
    const files = new Set<string>()
    for (const review of reviews) {
        for (const finding of review.findings) {
            if (finding.file !== undefined) {
                files.add(finding.file)
            }
        }
    }
    const lines = new Map<string, readonly string[] | null>()
    const root = canonicalizePath(worktree)
    for (const file of files) {
        // `finding.file` is untrusted reviewer JSON. Canonicalize it against the
        // worktree (normalizes `..`, realpaths symlink escapes) and refuse anything
        // that resolves outside the root — a traversal-escape is unverifiable, so it
        // maps to `null` exactly like an absent file, never an out-of-tree read.
        const resolved = canonicalizePath(file, worktree)
        if (resolved !== root && !resolved.startsWith(root.endsWith(sep) ? root : root + sep)) {
            lines.set(file, null)
            continue
        }
        try {
            const text = await readFile(resolved, 'utf8')
            lines.set(file, text.split('\n'))
        } catch (err) {
            if (!isEnoent(err)) {
                throw err
            }
            lines.set(file, null) // genuinely absent → unverifiable → dropped
        }
    }
    return {readLines: (file) => lines.get(file) ?? null}
}

/**
 * Build the REPLAY {@link FindingVerifierRunner} factory: for each reviewer, a runner
 * whose `confirm` returns the runner's pre-recorded verdict for that finding
 * (matched by `file:line`, FIFO among duplicates) instead of spawning. A kept finding
 * with NO recorded verdict REJECTS — `confirmBlocker` turns that into a LOUD `error`
 * (fail-closed: the merge gate blocks, never a silent pass).
 */
export function makeReplayRunnerFactory(input: RecordReviewsInput): (review: RawReview) => FindingVerifierRunner {
    const byReviewer = new Map<string, readonly VerifierVerdictInput[]>()
    for (const v of input.verifications) {
        byReviewer.set(v.reviewer, v.verdicts)
    }

    return (review) => {
        // Fresh shiftable queues per call so repeated factory calls never share state.
        const queues = new Map<string, VerifierVerdictInput[]>()
        for (const v of byReviewer.get(review.reviewer) ?? []) {
            const key = `${v.file}:${v.line}`
            const arr = queues.get(key) ?? []
            arr.push(v)
            queues.set(key, arr)
        }
        return {
            identity: REPLAY_IDENTITY,
            confirm(finding) {
                const key = `${finding.file}:${finding.line}`
                const next = queues.get(key)?.shift()
                if (next === undefined) {
                    return Promise.reject(
                        new Error(
                            `record-reviews: no pre-recorded finding-verifier verdict for reviewer ` +
                                `'${review.reviewer}' finding at ${key} — every citation-verified blocking ` +
                                `finding must carry an runner-collected verdict`
                        )
                    )
                }
                return Promise.resolve({holds: next.holds, note: next.note})
            },
        }
    }
}

/**
 * Compose the D5 fix-forward record from a blocked verify pass: confirmed
 * reviewer blockers ∪ non-holdout FAILING gate evidence, mapped to the lean
 * {@link FixFinding} shape `record.ts` persists (never the full judgment
 * `Finding` — that would invert the core/state↔verifier layering).
 *
 * LEAK GUARD: a `gate === "holdout"` entry is deliberately excluded — the
 * holdout mechanism is a quality mechanism, not a bug, and its detail must
 * never reach the producer's fix-forward prompt.
 */
function composeFixFindings(
    adjudicated: readonly AdjudicatedReviewer[],
    gateEvidence: readonly GateEvidence[]
): FixFinding[] {
    const fromReviewers: FixFinding[] = adjudicated.flatMap((a) =>
        a.confirmedBlockers.map((f) => ({
            reviewer: f.reviewer,
            ...(f.file !== undefined ? {file: f.file} : {}),
            ...(f.line !== undefined ? {line: f.line} : {}),
            description: f.description,
        }))
    )
    const fromGates: FixFinding[] = gateEvidence
        .filter((g) => g.gate !== 'holdout' && !g.observed)
        .map((g) => ({reviewer: g.gate, description: g.detail ?? `${g.gate} gate failed`}))
    return [...fromReviewers, ...fromGates]
}

/**
 * Roster enforcement (D26): `derivePanelVerdict` is unanimity over WHATEVER
 * reviews arrived, so any all-approve SUBSET of the panel would clear the merge
 * gate. At this record seam — the last hop before the verdict is derived — every
 * `expectedRoles` entry must be present: a missing role becomes a synthesized
 * `error` review and an unknown reviewer name is demoted to `error` (never counted
 * as an approve). Both fail the gate LOUDLY. `expectedRoles` is the Decision 51
 * content-conditional roster (`panelRolesFor` — the four-lens floor, plus the
 * `database-design-reviewer` when the task diff touches DB files); it defaults to
 * the floor so pre-existing callers/tests keep their contract. An UNEXPECTED
 * specialist (present but not in the expected roster) is demoted like any unknown
 * name — fail-closed. The cross-vendor slot is an EXECUTOR of a roster role
 * (quality-reviewer via Codex), never an extra reviewer name, so no extra name is
 * legitimate. /factory:debug calls runPanel directly and is deliberately outside
 * this check (whole-scope review, not the task merge gate).
 */
export function enforcePanelRoster(
    reviews: readonly RawReview[],
    expectedRoles: readonly string[] = PANEL_ROLES
): RawReview[] {
    const expected: ReadonlySet<string> = new Set(expectedRoles)
    const out: RawReview[] = reviews.map((r) => {
        if (expected.has(r.reviewer)) {
            return r
        }
        log.warn(
            `panel roster: unknown reviewer '${r.reviewer}' — verdict demoted to error ` +
                `(only the ${expectedRoles.length} expected panel roles may gate)`
        )
        return {...r, verdict: 'error'}
    })
    const present = new Set(reviews.map((r) => r.reviewer))
    for (const role of expectedRoles) {
        if (!present.has(role)) {
            log.warn(`panel roster: reviewer '${role}' missing from results — synthesized error verdict`)
            out.push({reviewer: role, verdict: 'error', findings: []})
        }
    }
    return out
}

/**
 * Record the panel + verify-then-fix verdicts into the merge gate and return the next-step
 * envelope. `verdictStore` is the holdout-verdict source `applyRecordHoldout` persisted.
 */
export async function applyRecordReviews(
    deps: RecordDeps,
    runId: string,
    taskId: string,
    verdictStore: HoldoutVerdictStore,
    input: RecordReviewsInput
): Promise<RecordReviewsEnvelope> {
    const run = await deps.state.read(runId)
    const task = run.tasks[taskId]
    if (task === undefined) {
        throw new Error(`record-reviews: run '${runId}' has no task '${taskId}'`)
    }
    const worktree = taskWorktreePath(deps.workDir, runId, taskId)
    const baseRef = run.staging_branch

    // 1. parse reviews + build the worktree source and the replay verifier factory
    //    (BEFORE the expensive GateRunner re-run — a malformed review item must fail
    //    fast rather than burning a full deterministic gate sweep first).
    //    The expected roster is RE-DERIVED from the same worktree tip the spawn site
    //    derived from (Decision 51, derive-don't-store) — reviewers run in their own
    //    isolated worktrees, so the task tip is unchanged between spawn and record.
    const dbApplicable = await touchesDatabase(deps.tools.git, baseRef, {cwd: worktree})
    const reviews = enforcePanelRoster(input.reviews.map(parseRawReview), panelRolesFor(dbApplicable))
    const source = await buildWorktreeSource(worktree, reviews)
    const makeRunner = makeReplayRunnerFactory(input)

    // 2. deterministic gates (re-run, never read back — Δ V).
    const gate = await new GateRunner().run(buildGateContext(deps, runId, taskId, baseRef))
    const gateEvidence: GateEvidence[] = [...gate.evidence]

    // 3. holdout gate evidence — RE-DERIVED from the verdicts applyRecordHoldout persisted
    //    (derive-don't-store exception). A withheld key with no persisted verdicts is an
    //    orchestration error (applyRecordHoldout must record first) — LOUD, never a silent pass.
    await appendHoldoutEvidence(deps, verdictStore, runId, taskId, task.escalation_rung, gateEvidence)

    // 4. derive the merge gate (citation-verify + replay-confirm + conjunctive merge gate).
    const panel = await runPanel({
        reviews,
        source,
        makeRunner,
        gateEvidence,
        phase: 'verify',
        attempt: task.escalation_rung + 1,
        maxAttempts: ESCALATION_CAP + 1,
        blockOnCrossVendorAbsence: deps.config.review.requireCrossVendor === 'block',
        ...(input.crossVendorAbsent !== undefined
            ? {crossVendor: {status: 'absent', reason: input.crossVendorAbsent.reason} as const}
            : {}),
    })

    // Δ U: a second-vendor absence must be LOUD, never silently dropped. runPanel
    // records it on the result; this record (the last hop) surfaces it as a warn line
    // AND threads it onto the envelope below. It is a strength signal — it does NOT
    // gate the merge gate.
    if (panel.crossVendorAbsence !== undefined) {
        log.warn(
            `task '${taskId}' verify ran WITHOUT an independent cross-vendor reviewer: ` +
                panel.crossVendorAbsence.reason
        )
    }

    // 5+6. Act on the derived result through the SHARED ladder.
    //
    // Crash-safety invariant (fail-closed): reviewers are persisted ONLY on the
    // advance branch, in the SAME updateTask call that stamps the cursor. On the
    // escalate/fail branch we do NOT persist reviewers — escalateOrFail owns its
    // own state write. A crash before the single advance-write means a no-results
    // re-invoke at verify finds no reviewers → fresh panel spawn (fail-closed);
    // holdout evidence cannot be bypassed by replaying without holdout results.
    // (The wait-retry branch's extra fix_findings write, below, is a best-effort
    // ADDITION to that fresh re-spawn, not a substitute for it — a crash before it
    // lands just means the next producer rung gets no fix instructions, same as
    // today's behavior; it can never leak stale reviewer state.)

    let step: TaskStep
    let outcome: 'advance' | 'send-back' | 'environmental'
    if (panel.result.kind === 'advance') {
        // Persist reviewers + stamp the cursor in ONE locked write (advance branch only).
        // phaseToInFlightStatus is the same mapping markInFlight would apply.
        const nextPhaseVal = panel.result.to
        const nextStatus = phaseToInFlightStatus(nextPhaseVal)
        await deps.state.updateTask(runId, taskId, (t) => ({
            ...t,
            reviewers: [...panel.reviewerResults],
            phase: nextPhaseVal,
            status: nextStatus,
            // A passing verify clears any stale fix-forward record from a prior blocked round.
            fix_findings: undefined,
            // D71: ditto the failing-gate-set record — the gate passed, the streak is over.
            last_failing_gates: undefined,
            // D68: the disposition ledger has served its purpose once the gate passes.
            review_dispositions: undefined,
            // Δ U/S5: record (or clear) the absence for the pass that actually shipped.
            cross_vendor_absent: panel.crossVendorAbsence,
        }))
        step = {done: false, phase: nextPhaseVal}
        outcome = 'advance'
    } else if (panel.result.kind === 'wait-retry') {
        // Block-mode cross-vendor absence is ENVIRONMENTAL, not a producer defect:
        // the probe is process-sticky, so no implementer re-run can repair a missing
        // codex binary. Fail fast blocked-environmental (rescue-recoverable,
        // breaker-excluded) instead of burning the escalation ladder. No fix_findings
        // write — there is nothing for the next rung to fix.
        if (deps.config.review.requireCrossVendor === 'block' && panel.crossVendorAbsence !== undefined) {
            step = await escalateOrFail(
                deps,
                runId,
                taskId,
                classifyFailure({kind: 'environmental', reason: panel.crossVendorAbsence.reason}),
                'exec'
            )
            await persistStepCursor(deps, runId, taskId, step)
            outcome = 'environmental'
        } else {
            // D5 fix-forward: persist the confirmed-blocker ∪ gate-stderr record BEFORE
            // escalating — the same "separate write ahead of the ladder transition"
            // pattern applyProducerOutcome uses for test_revision_feedback. escalateOrFail's
            // `{...t}` spread then carries it across the rung bump while it clears reviewers.
            const fixFindings = composeFixFindings(panel.adjudicated, gateEvidence)
            // D68: fold this round's dismissed claims (verifier-refuted + non-blocking)
            // onto the ledger in the SAME write — the next panel spawn injects it so a
            // fresh-context reviewer cannot blindly re-raise an adjudicated claim.
            const round = task.escalation_rung + 1
            // D71: the sorted failing gate-id set of THIS round (holdout excluded —
            // a quality mechanism the test-writer can neither see nor fix). When it is
            // IDENTICAL to the previous blocked round's set, the RED test is the
            // suspect arbiter: route the escalation to `tests` so the test-writer
            // rederives from the acceptance criteria instead of re-rolling the
            // implementer against a possibly-wrong test forever. tdd_exempt tasks
            // have no test-writer to rederive — they stay on the exec route.
            const failingEvidence = gateEvidence.filter((g) => g.gate !== 'holdout' && !g.observed)
            const failingGates = failingEvidence.map((g) => g.gate).sort()
            const prev = task.last_failing_gates
            const sameGateSet = (a: readonly string[], b: readonly string[]): boolean =>
                a.length === b.length && a.every((g, i) => g === b[i])
            const repeatedSet =
                failingGates.length > 0 &&
                prev !== undefined &&
                sameGateSet(failingGates, prev) &&
                specTaskOf(deps.spec, taskId).tdd_exempt !== true
            if (repeatedSet) {
                const detail = failingEvidence.map((g) => g.detail ?? `${g.gate} gate failed`).join('; ')
                await deps.state.updateTask(runId, taskId, (t) => ({
                    ...t,
                    test_revision_feedback:
                        `merge gate failed twice consecutively with the identical failing gate set ` +
                        `(${failingGates.join(', ')}): ${detail}`,
                    // The streak record served its purpose; stale fix-forward instructions
                    // target the OLD tests and must not steer the regenerated round.
                    last_failing_gates: undefined,
                    fix_findings: undefined,
                    review_dispositions: appendDispositions(
                        t.review_dispositions,
                        composeDispositions(reviews, panel.adjudicated, round)
                    ),
                }))
            } else {
                await deps.state.updateTask(runId, taskId, (t) => ({
                    ...t,
                    fix_findings: fixFindings,
                    last_failing_gates: failingGates.length > 0 ? failingGates : undefined,
                    review_dispositions: appendDispositions(
                        t.review_dispositions,
                        composeDispositions(reviews, panel.adjudicated, round)
                    ),
                }))
            }
            step = await escalateOrFail(
                deps,
                runId,
                taskId,
                classifyFailure({kind: 'merge-gate-blocked', reason: panel.result.reason}),
                repeatedSet ? 'tests' : 'exec'
            )
            await persistStepCursor(deps, runId, taskId, step)
            outcome = 'send-back'
        }
    } else {
        throw new Error(`record-reviews: unexpected panel result kind '${panel.result.kind}'`)
    }

    // 7b — ONE telemetry line per verify round (observability, not state; emitMetric
    // swallows IO errors so it can never break the record). `rung` is the rung this
    // round RAN at (pre-escalation). Feeds `factory score --reviewers`.
    // Reviewer names are unique per roster (D26), so this join is total.
    const funnelOf = new Map(panel.adjudicated.map((a) => [a.reviewer, a]))
    await emitMetric(deps.dataDir, runId, 'review.round', {
        task_id: taskId,
        rung: task.escalation_rung,
        outcome,
        // Per-lens {reviewer, verdict, raised/cited/confirmed_blockers} so
        // `score --reviewers` can compute each lens's yield, send-back rate, and BOTH
        // funnel rates (citation_rate, confirm_rate) without re-reading state.
        reviewers: panel.reviewerResults.map((r) => {
            const funnel = funnelOf.get(r.reviewer)
            return {
                reviewer: r.reviewer,
                verdict: r.verdict,
                confirmed_blockers: r.confirmed_blockers,
                ...(funnel !== undefined
                    ? {raised_blockers: funnel.raisedBlockers, cited_blockers: funnel.citedBlockers}
                    : {}),
            }
        }),
        ...(panel.crossVendorAbsence !== undefined ? {cross_vendor_absent: true} : {}),
    })

    return {
        run_id: runId,
        task_id: taskId,
        step,
        reviewers: panel.reviewerResults,
        mergeGate: panel.mergeGate,
        ...(panel.crossVendorAbsence !== undefined ? {crossVendorAbsence: panel.crossVendorAbsence} : {}),
    }
}
