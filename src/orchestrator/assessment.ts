/**
 * The run-start E2E ASSESSMENT COROUTINE (Decision 40 D3) — the emit/record split
 * `docs.ts` pioneered, gated BEFORE any task executes (`src/orchestrator/next.ts`'s
 * `wantsE2eAssessment`), once per `--e2e` run.
 *
 * The assessor does three jobs in one spawn:
 *   (a) COVERAGE FORECAST — map each EXISTING committed spec this run's tasks touch
 *       to `{spec_path, task_ids, expectation}` rows, pre-routing later suite
 *       failures (needs-update = intentional change, should-still-pass = regression).
 *   (b) MACHINERY — resolve the real boot config (start command + base URL), write
 *       it into the repo's `playwright.config.ts` (D10 single source of truth), and
 *       author seed/auth support (`e2e/support/`, `e2e/auth.setup.ts`) when the app
 *       needs it; VALIDATE by booting + logging in. Steady state (machinery already
 *       present) = read-only, no boot.
 *   (c) VERDICT — `ok` | `degraded` (auth-only gap → named warning, D3c) |
 *       `boot-impossible` | `machinery-impossible` (both fail the run LOUD in plain
 *       language: every non-terminal task is swept `blocked-environmental` and the
 *       run heads straight to finalize → `failed`).
 *
 * Retry contract (mirrors D5's author split): a deliberate `-impossible` verdict is
 * FINAL — no retry (re-asking doesn't change what the repo can boot). Only a CRASH
 * (`status:"error"`, synthesized by the runner for a dead agent) or a guard
 * violation (stray files / bogus forecast rows) earns the one retry
 * ({@link MAX_ASSESS_ATTEMPTS}); the cap converts it to the same loud fail.
 */
import {join} from 'node:path'
import {E2E_TEST_DIR} from './e2e-paths.js'
import {ensureStageWorktree, publishToStaging, specTaskLines} from './stage-helpers.js'
import type {StageDone, StageFailed, StageSpawnBase} from './stage-helpers.js'
import {z} from 'zod'
import {
    provisionWorktree,
    removeWorktreeBestEffort,
    isTerminalTaskStatus,
    E2eAffectedSpecSchema,
    type Config,
    type GitClient,
    type StateManager,
    type SpecManifest,
    type E2eAssessment,
    type ProvisionWorktreeFn,
    E2E_ASSESSOR_AGENT_TYPE,
} from './deps.js'
import {failTask} from './transitions.js'
import {nowIso, createLogger} from '../shared/index.js'

const log = createLogger('e2e-assess')

export interface AssessmentRunDeps {
    readonly state: StateManager
    readonly git: GitClient
    readonly config: Config
    readonly workDir: string
    /** The run's durable spec — task list for the coverage forecast. */
    readonly spec: SpecManifest
    /** Injectable worktree provisioner (tests fake this; production runs `npm ci`-equivalent). */
    readonly provision?: ProvisionWorktreeFn
}

export type AssessmentAction =
    | (StageSpawnBase & {
          readonly kind: 'spawn'
          readonly assess_branch: string
      })
    | (StageDone & {readonly warning?: string})
    | StageFailed

// Apex-pinned (Decision 40): the assessor's verdict can fail the whole run and its
// machinery merges unreviewed — same rationale as the author/spec-generator pins.
const ASSESSOR_MODEL = 'sonnet'

/** Spawn attempts before a crashing/misbehaving assessor fails the run loud. */
// ponytail: 2 mirrors MAX_DOCS_ATTEMPTS — one retry covers a flake, more just delays the verdict
export const MAX_ASSESS_ATTEMPTS = 2

/** The assessment worktree — dot-prefixed under `<workDir>/<runId>/` (see e2e.ts's
 * path-relocation note: agent-writable, collision-proof vs task worktrees). */
export function assessmentWorktreePath(workDir: string, runId: string): string {
    return join(workDir, runId, '.e2e-assess')
}

function assessBranchName(runId: string): string {
    return `e2e-assess-${runId}`
}

/**
 * The assessor's `--results` envelope. `error` is never a deliberate verdict — the
 * runner synthesizes it for a dead/skipped agent so the record leg routes it to the
 * retry path (never parsed as a fail-fast verdict; the R2 lesson from the author's
 * dead-agent wording).
 */
export const AssessmentResultsSchema = z
    .object({
        status: z.enum(['ok', 'degraded', 'boot-impossible', 'machinery-impossible', 'error']),
        /** Plain-language explanation — REQUIRED in practice for every non-`ok` status. */
        reason: z.string().optional(),
        /** Degraded-coverage note (auth-only gap) — surfaces in the author prompt + report. */
        warning: z.string().optional(),
        /** Boot config the assessor resolved + wrote into `playwright.config.ts`. */
        resolved: z
            .object({
                start_command: z.string().min(1).optional(),
                base_url: z.string().min(1).optional(),
            })
            .optional(),
        affected_specs: z.array(E2eAffectedSpecSchema).default([]),
    })
    .strict()
export type AssessmentResults = z.infer<typeof AssessmentResultsSchema>

/** Build the e2e-assessor prompt: machinery check + coverage forecast + verdict contract. */
function buildAssessorPrompt(args: {
    worktree: string
    testDir: string
    spec: SpecManifest
    cfg: Config['e2e']
}): string {
    const taskLines = specTaskLines(args.spec)
    const hasOverride =
        (args.cfg.startCommand != null && args.cfg.startCommand.length > 0) ||
        (args.cfg.baseURL != null && args.cfg.baseURL.length > 0)
    const overrides = hasOverride
        ? `Operator config overrides exist — treat them as authoritative: ` +
          `startCommand=${args.cfg.startCommand ?? '(unset)'}, baseURL=${args.cfg.baseURL ?? '(unset)'}.`
        : 'No operator overrides — resolve the boot config yourself.'
    return [
        "You are the factory e2e-assessor running the pipeline's run-start assessment phase (Decision 40).",
        `1. cd into your worktree: ${args.worktree} (checked out on the assessment branch off the staging tip).`,
        `2. MACHINERY CHECK — inspect playwright.config.ts and ${args.testDir}/ (support/, auth.setup.ts).`,
        `   ${overrides}`,
        "   - If playwright.config.ts still carries scaffold TODO/fallback values, determine the app's REAL " +
            'start command + base URL (package.json scripts, framework defaults) and write them in.',
        `   - If exercising the app needs seed data or a login, author the machinery: ` +
            `${args.testDir}/support/seed.ts and/or ${args.testDir}/auth.setup.ts.`,
        '   - VALIDATE: boot the app with the resolved start command and, if auth machinery exists or was ' +
            'authored, prove a login works via the Playwright MCP tools.',
        '   - STEADY STATE: if config + machinery are already real (no TODOs) from a prior run, change ' +
            'NOTHING and skip the boot — this pass is read-only.',
        '3. COVERAGE FORECAST — this run will deliver these tasks:',
        taskLines,
        `   For each COMMITTED spec under ${args.testDir}/ whose asserted behavior a task above will touch, ` +
            'emit an affected_specs row {"spec_path", "task_ids", "expectation"}: "needs-update" when the task ' +
            'INTENTIONALLY changes what the spec asserts, "should-still-pass" when the spec must survive the ' +
            'change. Leave untouched specs out.',
        `4. COMMIT anything you changed IN this worktree. Only files under ${args.testDir}/ plus ` +
            'playwright.config.ts are accepted — anything else is rejected at record. Do NOT push.',
        '5. Return your verdict as structured output {status, reason?, warning?, resolved?, affected_specs}:',
        '   - "ok" — machinery ready (validated or steady-state).',
        '   - "degraded" — the app boots but auth/seed coverage cannot be made to work; set `warning` naming ' +
            'exactly what coverage is lost, in plain language.',
        '   - "boot-impossible" — the app cannot be booted here (missing services, no seedable DB, ...); set ' +
            '`reason` in plain language a non-technical reader understands: what you tried, why it cannot ' +
            'work, and what the user could do about it.',
        '   - "machinery-impossible" — the app boots but no meaningful e2e coverage is achievable; ' +
            'plain-language `reason` as above.',
        '   ALWAYS set resolved {start_command, base_url} on ok/degraded — even steady-state, where you ' +
            "read the values out of playwright.config.ts instead of booting. The engine's e2e phase boots " +
            'the app from `resolved`; omitting it strands the run without a boot config.',
        'Per agents/e2e-assessor.md for the full discipline.',
    ].join('\n')
}

/** Emit the assessment's next step: spawn the assessor, or echo a concluded verdict. */
export async function runAssessmentEmit(deps: AssessmentRunDeps, runId: string): Promise<AssessmentAction> {
    const run = await deps.state.read(runId)

    // Idempotent re-entry (resume/crash between record and the next-task loop).
    if (run.e2e_assessment?.status === 'done') {
        const warning = run.e2e_assessment.warning
        return {kind: 'done', run_id: runId, ...(warning !== undefined ? {warning} : {})}
    }
    if (run.e2e_assessment?.status === 'failed') {
        return {
            kind: 'failed',
            run_id: runId,
            reason: run.e2e_assessment.reason ?? 'e2e assessment failed',
        }
    }

    const staging = run.staging_branch
    const branch = assessBranchName(runId)
    const worktree = assessmentWorktreePath(deps.workDir, runId)

    await deps.git.fetch('origin', staging)
    // Retry-reset: the crashed attempt's edits must not bleed into the new one.
    await ensureStageWorktree(deps.git, {
        worktree,
        ref: `origin/${staging}`,
        branch,
        resetIfExists: (run.e2e_assessment?.attempts ?? 0) >= 1,
        provision: () =>
            (deps.provision ?? provisionWorktree)({
                path: worktree,
                setupCommand: deps.config.quality.setupCommand,
            }),
    })

    return {
        kind: 'spawn',
        run_id: runId,
        agent_type: E2E_ASSESSOR_AGENT_TYPE,
        worktree,
        staging_branch: staging,
        assess_branch: branch,
        model: ASSESSOR_MODEL,
        prompt: buildAssessorPrompt({
            worktree,
            testDir: E2E_TEST_DIR,
            spec: deps.spec,
            cfg: deps.config.e2e,
        }),
    }
}

/** The zero-value assessment shape (TS requires `affected_specs` — zod defaults it on parse). */
function defaultAssessment(): Pick<E2eAssessment, 'affected_specs'> {
    return {affected_specs: []}
}

/**
 * TERMINAL fail: discard the worktree, sweep every non-terminal task
 * `blocked-environmental` quoting the plain-language verdict (the circuit-breaker
 * precedent — the run falls through all-terminal → finalize → `failed`, no new
 * envelope kind needed), and persist the failed assessment.
 */
async function failAssessment(
    deps: AssessmentRunDeps,
    runId: string,
    reason: string,
    attempts: number
): Promise<Extract<AssessmentAction, {kind: 'failed'}>> {
    const worktree = assessmentWorktreePath(deps.workDir, runId)
    await removeWorktreeBestEffort(deps.git, worktree)

    const run = await deps.state.read(runId)
    const open = Object.values(run.tasks).filter((t) => !isTerminalTaskStatus(t.status))
    for (const t of open) {
        await failTask(
            {state: deps.state},
            runId,
            t.task_id,
            'blocked-environmental',
            `e2e assessment failed: ${reason}`
        )
    }

    await deps.state.update(runId, (s) => ({
        ...s,
        e2e_assessment: {
            ...(s.e2e_assessment ?? defaultAssessment()),
            status: 'failed' as const,
            reason,
            warning: undefined,
            attempts,
            ended_at: nowIso(),
        },
    }))
    log.warn(`run '${runId}': e2e assessment failed — ${reason}`)
    return {kind: 'failed', run_id: runId, reason}
}

/**
 * RETRYABLE fail: below the cap, persist the attempt count (status stays absent so
 * `wantsE2eAssessment` keeps gating) and re-emit the spawn (the emit leg hard-resets
 * the dirty worktree). At the cap, converts to the terminal {@link failAssessment}.
 */
async function retryOrFail(
    deps: AssessmentRunDeps,
    runId: string,
    reason: string,
    attempts: number
): Promise<AssessmentAction> {
    if (attempts >= MAX_ASSESS_ATTEMPTS) {
        return failAssessment(deps, runId, `${reason} (after ${attempts} attempts)`, attempts)
    }
    await deps.state.update(runId, (s) => ({
        ...s,
        e2e_assessment: {...(s.e2e_assessment ?? defaultAssessment()), attempts},
    }))
    log.warn(`run '${runId}': e2e assessment attempt ${attempts} failed (${reason}) — retrying`)
    return runAssessmentEmit(deps, runId)
}

/** Record an assessor result: merge validated machinery + persist the forecast, or fail. */
export async function runAssessmentRecord(
    deps: AssessmentRunDeps,
    runId: string,
    results: AssessmentResults
): Promise<AssessmentAction> {
    const worktree = assessmentWorktreePath(deps.workDir, runId)
    const run = await deps.state.read(runId)
    const attempts = (run.e2e_assessment?.attempts ?? 0) + 1

    // Deliberate impossible-verdicts are FINAL — re-asking can't change the repo.
    if (results.status === 'boot-impossible' || results.status === 'machinery-impossible') {
        const reason =
            results.reason ??
            (results.status === 'boot-impossible'
                ? 'the app cannot be booted for e2e testing (assessor gave no detail)'
                : 'no meaningful e2e coverage is achievable in this repo (assessor gave no detail)')
        return failAssessment(deps, runId, reason, attempts)
    }

    // A crashed/skipped assessor (runner-synthesized) earns the one retry.
    if (results.status === 'error') {
        return retryOrFail(deps, runId, results.reason ?? 'assessor crashed or was skipped', attempts)
    }

    // ok | degraded — validate the forecast before trusting it for later routing.
    const unknownTaskIds = [...new Set(results.affected_specs.flatMap((e) => e.task_ids))].filter(
        (id) => !(id in run.tasks)
    )
    if (unknownTaskIds.length > 0) {
        return retryOrFail(
            deps,
            runId,
            `assessor forecast references unknown task_id(s): ${unknownTaskIds.join(', ')}`,
            attempts
        )
    }

    // Merge guard: the assessor's branch may only touch e2e machinery — anything else
    // would land unreviewed code in the target repo just by being on this branch.
    const staging = run.staging_branch
    const testDirPrefix = `${E2E_TEST_DIR}/`
    const changed = await deps.git.diffNames(staging, assessBranchName(runId), {cwd: worktree})
    const stray = changed.filter((f) => !f.startsWith(testDirPrefix) && f !== 'playwright.config.ts')
    if (stray.length > 0) {
        return retryOrFail(
            deps,
            runId,
            `assessor branch touches path(s) outside '${testDirPrefix}' + playwright.config.ts — ` +
                `refusing to merge unreviewed changes: ${stray.join(', ')}`,
            attempts
        )
    }

    if (changed.length > 0) {
        await publishToStaging(deps.git, staging, assessBranchName(runId))
    }
    await removeWorktreeBestEffort(deps.git, worktree)

    // A degraded verdict ALWAYS retains a non-empty warning in durable state: neither
    // `warning` nor `reason` is schema-required, so without this default a detail-less
    // degraded verdict would persist as an indistinguishable-from-clean `done`.
    const warning =
        results.status === 'degraded'
            ? (results.warning ?? results.reason ?? 'e2e assessment degraded (assessor gave no detail)')
            : undefined
    await deps.state.update(runId, (s) => ({
        ...s,
        e2e_assessment: {
            status: 'done' as const,
            reason: undefined,
            warning,
            resolved: results.resolved,
            affected_specs: results.affected_specs,
            attempts,
            ended_at: nowIso(),
        },
    }))
    const doneMsg =
        `run '${runId}': e2e assessment done (${results.status}, ${results.affected_specs.length} ` +
        `affected spec(s)${warning !== undefined ? `, warning: ${warning}` : ''})`
    // Surface a degraded completion at warn so it isn't lost in suppressed INFO output.
    if (results.status === 'degraded') {
        log.warn(doneMsg)
    } else {
        log.info(doneMsg)
    }
    return {kind: 'done', run_id: runId, ...(warning !== undefined ? {warning} : {})}
}
