/**
 * Record-core semantics — moved verbatim from:
 *   - src/cli/subcommands/record-holdout.test.ts  (applyRecordHoldout describe block)
 *   - src/cli/subcommands/record-reviews.test.ts  (applyRecordReviews describe block)
 *   - src/cli/subcommands/record-producer.test.ts (applyRecordProducer describe blocks)
 *
 * Imports now point to ./record.js; fixtures + assertions are IDENTICAL — only the
 * call sites carry the new runId argument (RecordDeps signature adjustment).
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

import {
    applyRecordHoldout,
    HOLDOUT_EVALUATOR_RETRY_CAP,
    applyRecordReviews,
    applyRecordProducer,
    buildWorktreeSource,
    type RecordReviewsInput,
    type RecordDeps,
} from './record.js'
import {PANEL_ROLES, type RawReview} from '../verifier/judgment/index.js'
import {taskWorktreePath} from './paths.js'
import {defaultConfig} from '../config/schema.js'
import {parseSpecManifest} from '../spec/index.js'
import {readLedger} from '../spec/ledger.js'
import {StateManager} from '../core/state/manager.js'
import {FakeGitClient, FakeGhClient} from '../git/fakes.js'
import {
    contractedLoader,
    makeFakeTools,
    FakeGitProbe,
    FakeVitest,
    commit,
    proc,
} from '../verifier/deterministic/fakes.js'
import {InMemoryHoldoutStore, InMemoryHoldoutVerdictStore, makeHoldoutRecord} from '../verifier/holdout/index.js'
import {ESCALATION_CAP} from '../producer/index.js'
import {captureStream} from '../cli/test-helpers.js'
import {readMetrics} from '../scoring/telemetry.js'
import type {TaskState} from '../types/index.js'
import {nonNull} from '../shared/index.js'

const RUN_ID = 'run-1'
const TASK_ID = 't1'

// ---------------------------------------------------------------------------
// applyRecordHoldout record
// ---------------------------------------------------------------------------

function holdoutSpec() {
    return parseSpecManifest({
        spec_id: '42-checkout',
        issue_number: 42,
        slug: 'checkout',
        repo: 'acme/widgets',
        generated_at: '2026-06-01T00:00:00.000Z',
        tasks: [
            {
                task_id: 't1',
                title: 'task t1',
                description: 'does t1',
                files: ['src/t1.ts'],
                acceptance_criteria: ['a', 'b', 'c', 'd', 'e'],
                tests_to_write: ['covers it'],
                depends_on: [],
                risk_tier: 'medium',
                risk_rationale: 'moderate',
            },
        ],
    })
}

/** Build the verdicts JSON the validator would emit for the withheld criteria. */
function validatorJson(entries: readonly [string, boolean, string][]): string {
    return JSON.stringify({
        criteria: entries.map(([criterion, satisfied, evidence]) => ({
            criterion,
            satisfied,
            evidence,
        })),
    })
}

describe('applyRecordHoldout record', () => {
    let dataDir: string
    let workDir: string
    let state: StateManager
    let holdout: InMemoryHoldoutStore
    let verdictStore: InMemoryHoldoutVerdictStore
    let deps: RecordDeps

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-record-holdout-'))
        workDir = await mkdtemp(join(tmpdir(), 'factory-record-holdout-workdir-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        holdout = new InMemoryHoldoutStore()
        verdictStore = new InMemoryHoldoutVerdictStore()
        await state.create({
            run_id: RUN_ID,
            staging_branch: `staging-${RUN_ID}`,
            spec: {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42},
        })
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                t1: {
                    task_id: 't1',
                    status: 'reviewing',
                    phase: 'verify',
                    depends_on: [],
                    risk_tier: 'medium',
                    escalation_rung: 0,
                    reviewers: [],
                    merge_resyncs: 0,
                },
            },
        }))
        deps = {
            config: defaultConfig(),
            spec: holdoutSpec(),
            git: new FakeGitClient({remoteHeads: {staging: 'sha-staging'}}),
            gh: new FakeGhClient(),
            tools: makeFakeTools(),
            loadContract: contractedLoader({
                coverage: {contracted: false, reason: 'fixture: coverage not exercised'},
                sast: {contracted: false, reason: 'fixture: no security command'},
            }),
            holdout,
            dataDir,
            workDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode: 'no-merge',
            designSystemDocs: () => Promise.resolve([]),
            state,
        }
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(workDir, {recursive: true, force: true})
    })

    it('persists the parsed verdicts and emits a PASS gate evidence when all satisfied', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d', 'e'], 5))
        const raw = validatorJson([
            ['d', true, 'src/x.ts:10'],
            ['e', true, 'src/y.ts:3'],
        ])

        const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, raw)

        expect(result.kind).toBe('recorded')
        if (result.kind !== 'recorded') {
            throw new Error('unreachable')
        }
        const env = result.envelope
        expect(env.evidence.gate).toBe('holdout')
        expect(env.evidence.observed).toBe(true)
        expect(env.check.status).toBe('pass')
        expect(env.check.satisfied).toBe(2)
        expect(env.check.withheld).toBe(2)
        // The verdicts were persisted for the later record-reviews re-derivation.
        expect(await verdictStore.get(RUN_ID, 't1', 0)).toEqual([
            {criterion: 'd', satisfied: true, evidence: 'src/x.ts:10'},
            {criterion: 'e', satisfied: true, evidence: 'src/y.ts:3'},
        ])
    })

    it('scores a well-formed partial miss below the pass rate as a blocking FAIL (not an evaluator failure)', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d', 'e'], 5))
        const raw = validatorJson([
            ['d', true, 'src/x.ts:10'],
            ['e', false, ''],
        ])

        const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, raw)

        expect(result.kind).toBe('recorded')
        if (result.kind !== 'recorded') {
            throw new Error('unreachable')
        }
        expect(result.envelope.check.status).toBe('fail') // 1/2 = 50% < 80%
        expect(result.envelope.evidence.observed).toBe(false)
    })

    it('a well-formed 0/N miss still records as blocking (producer pays, no retry)', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d'], 5))
        const raw = validatorJson([['d', false, 'not implemented anywhere']])

        const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, raw)

        expect(result.kind).toBe('recorded')
        if (result.kind !== 'recorded') {
            throw new Error('unreachable')
        }
        expect(result.envelope.check.satisfied).toBe(0)
        expect(result.envelope.evidence.observed).toBe(false)
        const task = (await state.read(RUN_ID)).tasks.t1
        expect(task?.holdout_evaluator_retries).toBeUndefined()
    })

    it.each([[true], [false]])(
        'a well-formed result (satisfied: %s) clears a prior evaluator-fault streak (consecutive-fault counter)',
        async (sat) => {
            await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d'], 5))
            await state.updateTask(RUN_ID, 't1', (t) => ({...t, holdout_evaluator_retries: 1}))
            const raw = validatorJson([['d', sat, sat ? 'src/x.ts:1' : '']])

            const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, raw)

            expect(result.kind).toBe('recorded')
            expect((await state.read(RUN_ID)).tasks.t1?.holdout_evaluator_retries).toBeUndefined()
        }
    )

    const evaluatorFailures: readonly [string, (record: string) => string][] = [
        ['unparseable output', () => 'not json at all'],
        ['wrong cardinality', () => validatorJson([['d', true, 'src/x.ts:1']])],
        [
            'criterion text mismatch',
            () =>
                validatorJson([
                    ['SPOOFED', true, 'src/x.ts:1'],
                    ['e', true, 'src/y.ts:2'],
                ]),
        ],
        [
            'satisfied with blank evidence',
            () =>
                validatorJson([
                    ['d', true, '   '],
                    ['e', true, 'src/y.ts:2'],
                ]),
        ],
    ]

    it.each(evaluatorFailures)(
        'evaluator failure (%s) retries the same-rung verify wave without persisting verdicts or bumping the rung',
        async (_name, mk) => {
            await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d', 'e'], 5))
            // A live spawn checkpoint at the SAME (verify, rung): the retry write must
            // clear it, or the re-entry would be charged to the spawn re-drive budget.
            await state.updateTask(RUN_ID, 't1', (t) => ({
                ...t,
                spawn_in_flight: {phase: 'verify', rung: 0, tip_sha: 'sha-tip', spawned_at: 123, redrives: 1},
            }))

            const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, mk('t1'))

            expect(result.kind).toBe('evaluator-failure')
            if (result.kind !== 'evaluator-failure') {
                throw new Error('unreachable')
            }
            expect(result.step).toEqual({done: false, phase: 'verify'})
            expect(await verdictStore.has(RUN_ID, 't1', 0)).toBe(false)
            const task = (await state.read(RUN_ID)).tasks.t1
            expect(task?.escalation_rung).toBe(0) // producer rung untouched
            expect(task?.holdout_evaluator_retries).toBe(1)
            expect(task?.spawn_in_flight).toBeUndefined() // cleared atomically with the increment
            expect(task?.status).not.toBe('failed')
        }
    )

    it('fails blocked-environmental once the evaluator retry cap is exhausted', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord('t1', ['d', 'e'], 5))
        await state.updateTask(RUN_ID, 't1', (t) => ({
            ...t,
            holdout_evaluator_retries: HOLDOUT_EVALUATOR_RETRY_CAP,
        }))

        const result = await applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, 'garbage')

        expect(result.kind).toBe('evaluator-failure')
        if (result.kind !== 'evaluator-failure') {
            throw new Error('unreachable')
        }
        expect(result.step.done).toBe(true)
        const task = (await state.read(RUN_ID)).tasks.t1
        expect(task?.status).toBe('failed')
        expect(task?.failure_class).toBe('blocked-environmental')
        expect(task?.failure_reason).toMatch(/holdout evaluator/)
        expect(task?.escalation_rung).toBe(0) // still never charged to the producer
    })

    it('is a LOUD error when the task has no withheld answer key', async () => {
        await expect(applyRecordHoldout(deps, RUN_ID, 't1', 0, verdictStore, validatorJson([]))).rejects.toThrow(
            /no withheld answer key/
        )
    })
})

// ---------------------------------------------------------------------------
// applyRecordReviews record
// ---------------------------------------------------------------------------

/** A git probe whose full default gate sweep is GREEN (TDD test→impl history). */
function greenProbe(): FakeGitProbe {
    return new FakeGitProbe({
        // Seed origin/staging-run-1 (the per-run branch for RUN_ID="run-1") so the
        // TDD strategy resolves origin/${runStagingBranch("run-1")} after the fix.
        refs: {'origin/staging-run-1': 'sha-base', HEAD: 'sha-head'},
        changedFiles: [],
        commits: [
            commit({sha: 'c1', files: ['src/x.test.ts'], tagged: true}),
            commit({sha: 'c2', files: ['src/x.ts'], tagged: true}),
        ],
    })
}

function reviewsSpec(tddExempt = false) {
    return parseSpecManifest({
        spec_id: '42-checkout',
        issue_number: 42,
        slug: 'checkout',
        repo: 'acme/widgets',
        generated_at: '2026-06-01T00:00:00.000Z',
        tasks: [
            {
                task_id: TASK_ID,
                title: 'task t1',
                description: 'does t1',
                files: ['src/t1.ts'],
                acceptance_criteria: ['a', 'b', 'c', 'd', 'e'],
                tests_to_write: ['covers it'],
                depends_on: [],
                risk_tier: 'medium',
                risk_rationale: 'moderate',
                ...(tddExempt ? {tdd_exempt: true} : {}),
            },
        ],
    })
}

/** An approving review with no findings. */
function approve(reviewer: string) {
    return {reviewer, verdict: 'approve' as const, findings: []}
}

/**
 * A FULL all-approve panel over PANEL_ROLES (the record seam enforces roster
 * completeness — any missing role is synthesized as an `error` and fails the
 * gate). `overrides` replace the review for their role.
 */
function fullPanel(...overrides: RawReview[]): unknown[] {
    const byRole = new Map(overrides.map((o) => [o.reviewer, o]))
    return PANEL_ROLES.map((role) => byRole.get(role) ?? approve(role))
}

describe('applyRecordReviews record', () => {
    let dataDir: string
    let workDir: string
    let state: StateManager
    let holdout: InMemoryHoldoutStore
    let verdictStore: InMemoryHoldoutVerdictStore

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-record-reviews-'))
        workDir = await mkdtemp(join(tmpdir(), 'factory-record-reviews-workdir-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        holdout = new InMemoryHoldoutStore()
        verdictStore = new InMemoryHoldoutVerdictStore()
        await state.create({
            run_id: RUN_ID,
            staging_branch: `staging-${RUN_ID}`,
            spec: {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42},
        })
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                [TASK_ID]: {
                    task_id: TASK_ID,
                    status: 'reviewing',
                    phase: 'verify',
                    depends_on: [],
                    risk_tier: 'medium',
                    escalation_rung: 0,
                    reviewers: [],
                    merge_resyncs: 0,
                },
            },
        }))
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(workDir, {recursive: true, force: true})
    })

    /** Build a RecordDeps over the seeded run with a GREEN gate sweep. */
    function makeDeps(
        probe: FakeGitProbe = greenProbe(),
        opts: {redTests?: boolean; tddExempt?: boolean} = {}
    ): RecordDeps {
        return {
            config: defaultConfig(),
            spec: reviewsSpec(opts.tddExempt ?? false),
            git: new FakeGitClient({remoteHeads: {staging: 'sha-staging'}}),
            gh: new FakeGhClient(),
            tools: makeFakeTools({
                git: probe,
                ...(opts.redTests === true ? {vitest: new FakeVitest(proc(1, '', '2 tests failed'))} : {}),
            }),
            loadContract: contractedLoader({
                coverage: {contracted: false, reason: 'fixture: coverage not exercised'},
                sast: {contracted: false, reason: 'fixture: no security command'},
            }),
            holdout,
            dataDir,
            workDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode: 'no-merge',
            designSystemDocs: () => Promise.resolve([]),
            state,
        }
    }

    /** Write a source file into the task worktree so a citation can verify against it. */
    async function writeWorktreeFile(relPath: string, contents: string): Promise<void> {
        const abs = join(taskWorktreePath(workDir, RUN_ID, TASK_ID), relPath)
        await mkdir(dirname(abs), {recursive: true})
        await writeFile(abs, contents)
    }

    /**
     * Run `fn` while capturing stderr with warn-level logging forced ON, so the
     * "is it LOUD?" assertions are independent of any ambient FACTORY_QUIET /
     * FACTORY_LOG_LEVEL in the caller's shell. Restores both on exit.
     */
    async function captureWarnings<T>(fn: () => Promise<T>): Promise<{result: T; stderr: string}> {
        const savedLevel = process.env.FACTORY_LOG_LEVEL
        const savedQuiet = process.env.FACTORY_QUIET
        process.env.FACTORY_LOG_LEVEL = 'info'
        delete process.env.FACTORY_QUIET
        const cap = captureStream(process.stderr)
        try {
            const result = await fn()
            return {result, stderr: cap.read()}
        } finally {
            cap.restore()
            if (savedLevel === undefined) {
                delete process.env.FACTORY_LOG_LEVEL
            } else {
                process.env.FACTORY_LOG_LEVEL = savedLevel
            }
            if (savedQuiet === undefined) {
                delete process.env.FACTORY_QUIET
            } else {
                process.env.FACTORY_QUIET = savedQuiet
            }
        }
    }

    it('a unanimous-approve FULL panel + green gates advances to ship', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(true)
        expect(env.step).toEqual({done: false, phase: 'ship'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.reviewers.map((r) => r.verdict)).toEqual(PANEL_ROLES.map(() => 'approve'))
        expect(task.status).toBe('shipping') // markInFlight(ship)
    })

    // 7b — one review.round telemetry line per verify round.
    it('emits ONE review.round metric (outcome advance) with the panel roster + rung', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {reviews: fullPanel(), verifications: []}

        await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        const rounds = (await readMetrics(dataDir, RUN_ID)).filter((m) => m.event === 'review.round')
        expect(rounds).toHaveLength(1)
        expect(rounds[0]?.data).toMatchObject({task_id: TASK_ID, rung: 0, outcome: 'advance'})
        const reviewers = rounds[0]?.data?.reviewers as {reviewer: string; verdict: string}[]
        expect(reviewers.map((r) => r.reviewer)).toEqual([...PANEL_ROLES])
        expect(reviewers.every((r) => r.verdict === 'approve')).toBe(true)
        expect(rounds[0]?.data?.cross_vendor_absent).toBeUndefined()
    })

    // 7b/2 — the funnel counters reach metrics.jsonl from a REAL record pass, so
    // `score --reviewers` can separate "cited fake code" from "claimed wrongly".
    it('emits raised/cited/confirmed blockers per lens: a fabricated quote drops, a refuted claim does not confirm', async () => {
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nconst y = 2\n')
        const deps = makeDeps()
        const finding = (line: number, quote: string, claim: string) => ({
            reviewer: 'quality-reviewer',
            severity: 'critical' as const,
            blocking: true,
            file: 'src/x.ts',
            line,
            quote,
            claim,
            description: claim,
        })
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    finding(2, 'const x = 1', 'x is a magic number'), // cited + confirmed
                    finding(3, 'const y = 2', 'y is a magic number'), // cited + refuted
                    finding(2, 'const z = 3', 'z is a magic number'), // quote is nowhere → DROPPED
                ],
            }),
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [
                        {file: 'src/x.ts', line: 2, holds: true, note: 'confirmed'},
                        {file: 'src/x.ts', line: 3, holds: false, note: 'y is a loop bound, not magic'},
                    ],
                },
            ],
        }

        await captureWarnings(() => applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input))

        const rounds = (await readMetrics(dataDir, RUN_ID)).filter((m) => m.event === 'review.round')
        const reviewers = rounds[0]?.data?.reviewers as {
            reviewer: string
            raised_blockers: number
            cited_blockers: number
            confirmed_blockers: number
        }[]
        const quality = nonNull(reviewers.find((r) => r.reviewer === 'quality-reviewer'))
        expect(quality.raised_blockers).toBe(3) // what the lens asserted
        expect(quality.cited_blockers).toBe(2) // what citation-verify kept (z was fabricated)
        expect(quality.confirmed_blockers).toBe(1) // what survived the verifier (y was refuted)
        // An approving lens raised nothing: a real 0, never an absent field.
        const impl = nonNull(reviewers.find((r) => r.reviewer === 'implementation-reviewer'))
        expect(impl).toMatchObject({raised_blockers: 0, cited_blockers: 0, confirmed_blockers: 0})
    })

    it('emits a review.round metric with outcome send-back when the merge gate blocks', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: [approve('implementation-reviewer'), approve('silent-failure-hunter')],
            verifications: [],
        }

        await captureWarnings(() => applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input))

        const rounds = (await readMetrics(dataDir, RUN_ID)).filter((m) => m.event === 'review.round')
        expect(rounds).toHaveLength(1)
        expect(rounds[0]?.data).toMatchObject({outcome: 'send-back', rung: 0})
    })

    it('roster enforcement: an all-approve SUBSET of the panel FAILS the merge gate', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: [approve('implementation-reviewer'), approve('silent-failure-hunter')],
            verifications: [],
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        // Every missing role is synthesized as an ERROR reviewer (LOUD, never a pass).
        const errored = env.reviewers.filter((r) => r.verdict === 'error').map((r) => r.reviewer)
        expect(errored).toContain('quality-reviewer')
        expect(errored).toHaveLength(PANEL_ROLES.length - 2)
        expect(stderr).toMatch(/missing from results/)
    })

    // D43 self-heal pin. Deliberate grep-gate exception (like schema.test.ts's
    // stale-overlay test): the retired role names appear here BECAUSE the test
    // asserts they get demoted, simulating an in-flight pre-D43 7-role run.
    it('roster enforcement: a stale 7-role in-flight review set self-heals via demotion (D43)', async () => {
        const deps = makeDeps()
        const retired = ['architecture-reviewer', 'security-reviewer', 'type-design-reviewer']
        const input: RecordReviewsInput = {
            reviews: [...fullPanel(), ...retired.map(approve)],
            verifications: [],
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        // The 4 current roles approve, but every retired-role review is demoted to
        // error → the gate fails LOUD (one burned rung), never a silent approve.
        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        for (const role of retired) {
            expect(nonNull(env.reviewers.find((r) => r.reviewer === role)).verdict).toBe('error')
        }
        for (const role of PANEL_ROLES) {
            expect(nonNull(env.reviewers.find((r) => r.reviewer === role)).verdict).toBe('approve')
        }
        expect(stderr).toMatch(/unknown reviewer 'architecture-reviewer'/)
    })

    it('roster enforcement: an unknown reviewer name is demoted to error (never counts as approve)', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: [...fullPanel(), approve('quality')],
            verifications: [],
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.mergeGate.passed).toBe(false)
        expect(nonNull(env.reviewers.find((r) => r.reviewer === 'quality')).verdict).toBe('error')
        expect(stderr).toMatch(/unknown reviewer 'quality'/)
    })

    // Decision 51 — the content-conditional roster: a probe whose diff touches a
    // migration file makes the database-design-reviewer an EXPECTED roster member.
    function dbProbe(): FakeGitProbe {
        return new FakeGitProbe({
            refs: {'origin/staging-run-1': 'sha-base', HEAD: 'sha-head'},
            changedFiles: ['supabase/migrations/0001_orders.sql'],
            commits: [
                commit({sha: 'c1', files: ['src/x.test.ts'], tagged: true}),
                commit({sha: 'c2', files: ['src/x.ts'], tagged: true}),
            ],
        })
    }

    it('D51: a DB-touching diff makes the floor-only panel a SUBSET — specialist synthesized as error', async () => {
        const deps = makeDeps(dbProbe())
        const input: RecordReviewsInput = {reviews: fullPanel(), verifications: []}

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.mergeGate.passed).toBe(false)
        expect(nonNull(env.reviewers.find((r) => r.reviewer === 'database-design-reviewer')).verdict).toBe('error')
        expect(stderr).toMatch(/reviewer 'database-design-reviewer' missing/)
    })

    it('D51: a DB-touching diff with the FULL floor+specialist all-approve panel passes the gate', async () => {
        const deps = makeDeps(dbProbe())
        const input: RecordReviewsInput = {
            reviews: [...fullPanel(), approve('database-design-reviewer')],
            verifications: [],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(true)
        expect(env.step).toEqual({done: false, phase: 'ship'})
    })

    it('D51: an UNEXPECTED specialist on a non-DB diff is demoted to error (fail-closed)', async () => {
        const deps = makeDeps() // greenProbe: no DB files in the diff
        const input: RecordReviewsInput = {
            reviews: [...fullPanel(), approve('database-design-reviewer')],
            verifications: [],
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.mergeGate.passed).toBe(false)
        expect(nonNull(env.reviewers.find((r) => r.reviewer === 'database-design-reviewer')).verdict).toBe('error')
        expect(stderr).toMatch(/unknown reviewer 'database-design-reviewer'/)
    })

    it('advancing past a prior blocked rung clears the stale fix_findings record (D5) and the disposition ledger (D68)', async () => {
        const deps = makeDeps()
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                ...s.tasks,
                [TASK_ID]: {
                    ...nonNull(s.tasks[TASK_ID]),
                    fix_findings: [{reviewer: 'lint', description: 'eslint exit=1: stale'}],
                    review_dispositions: [
                        {
                            reviewer: 'quality-reviewer',
                            disposition: 'refuted' as const,
                            quote: 'q',
                            claim: 'c',
                            round: 1,
                        },
                    ],
                },
            },
        }))
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(true)
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.fix_findings).toBeUndefined()
        expect(task.review_dispositions).toBeUndefined()
    })

    it('D68: a blocked round appends verifier-refuted + non-blocking claims to the disposition ledger', async () => {
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nconst y = 2\nline4\n')
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 2,
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 3,
                        quote: 'const y = 2',
                        claim: 'y is unused',
                        description: 'unused variable',
                    },
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'warning',
                        blocking: false,
                        file: 'src/x.ts',
                        line: 3,
                        quote: 'const y = 2',
                        claim: 'y could be inlined',
                        description: 'style',
                    },
                ],
            }),
            // One blocker confirmed (drives the block), one refuted.
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [
                        {file: 'src/x.ts', line: 2, holds: true, note: 'confirmed'},
                        {file: 'src/x.ts', line: 3, holds: false, note: 'y is exported and used'},
                    ],
                },
            ],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(false)
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        // The ledger carries the refuted claim (with the verifier's reason) and the
        // non-blocking advisory — never the confirmed blocker (that's fix_findings').
        const ledger = nonNull(task.review_dispositions)
        expect(ledger.map((d) => ({disposition: d.disposition, claim: d.claim}))).toEqual(
            expect.arrayContaining([
                {disposition: 'refuted', claim: 'y is unused'},
                {disposition: 'non-blocking', claim: 'y could be inlined'},
            ])
        )
        expect(ledger.some((d) => d.claim === 'a magic number is hardcoded')).toBe(false)
        expect(nonNull(ledger.find((d) => d.disposition === 'refuted')).note).toBe('y is exported and used')
        expect(ledger.every((d) => d.round === 1)).toBe(true)
        // …and it survives escalateOrFail's reviewers clear (the {...t} spread).
        expect(task.escalation_rung).toBe(1)
        expect(task.reviewers).toEqual([])
    })

    it('a confirmed blocker blocks the merge gate → escalate (clear reviewers, resume at exec)', async () => {
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nline3\n')
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 2,
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                ],
            }),
            // The runner's independent verifier CONFIRMED the blocker.
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [{file: 'src/x.ts', line: 2, holds: true, note: 'confirmed'}],
                },
            ],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        // The round's reviewers are reported on the envelope (audit)…
        const quality = nonNull(env.reviewers.find((r) => r.reviewer === 'quality-reviewer'))
        expect(quality.verdict).toBe('blocked')
        expect(quality.confirmed_blockers).toBe(1)
        // …but state CLEARS them on escalation and bumps the rung.
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.escalation_rung).toBe(1)
        expect(task.reviewers).toEqual([])
        expect(task.status).toBe('executing') // cursor re-stamped at exec
        // D5 fix-forward: the confirmed blocker survives escalateOrFail's reviewers
        // clear, in the lean fix_findings shape (not the full judgment Finding).
        expect(task.fix_findings).toEqual([
            {reviewer: 'quality-reviewer', file: 'src/x.ts', line: 2, description: 'magic number'},
        ])
    })

    // S5/A2 replay-keying pin: the runner's verifier agents (and thus the recorded
    // verdicts) are keyed on the reviewer's CITED file:line — a grep-rescued finding
    // must still find its verdict at the CITED line, while fix_findings carries the
    // RELOCATED line. A naive relocate-before-replay orphans the verdict → LOUD error.
    it('a grep-RESCUED blocker replays its verdict at the CITED line and fixes forward at the RELOCATED line', async () => {
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nline3\n')
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 9, // out of range; quote is unique on line 2 → rescued
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                ],
            }),
            // Verdict recorded at the CITED line 9 — what the verifier agent saw.
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [{file: 'src/x.ts', line: 9, holds: true, note: 'confirmed'}],
                },
            ],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(false)
        // Confirmed (verdict FOUND at the cited key — not a verifier error)…
        const quality = nonNull(env.reviewers.find((r) => r.reviewer === 'quality-reviewer'))
        expect(quality.verdict).toBe('blocked')
        expect(quality.confirmed_blockers).toBe(1)
        // …and the producer-facing record carries the corrected line.
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.fix_findings).toEqual([
            {reviewer: 'quality-reviewer', file: 'src/x.ts', line: 2, description: 'magic number'},
        ])
    })

    it('a kept blocker with NO recorded verdict FAILS CLOSED (verifier error, never a pass)', async () => {
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nline3\n')
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 2,
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                ],
            }),
            verifications: [], // no pre-recorded verdict for the kept blocker
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        // The missing verdict surfaces as a LOUD verifier error, not an auto-confirm/refute.
        expect(nonNull(env.reviewers.find((r) => r.reviewer === 'quality-reviewer')).verdict).toBe('error')
    })

    it('a failing holdout blocks the merge gate even with an approving panel + green gates', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord(TASK_ID, ['d', 'e'], 5))
        // Persisted verdicts that DO NOT satisfy the withheld criteria → holdout fails.
        await verdictStore.put(RUN_ID, TASK_ID, 0, [
            {criterion: 'd', satisfied: false, evidence: ''},
            {criterion: 'e', satisfied: false, evidence: ''},
        ])
        const deps = makeDeps()
        const input: RecordReviewsInput = {reviews: fullPanel(), verifications: []}

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        // The holdout gate evidence is part of the derived merge gate.
        expect(env.mergeGate.from.some((e) => e.gate === 'holdout' && !e.observed)).toBe(true)
        // LEAK GUARD (D5): the holdout is a deliberate quality mechanism, not a bug —
        // its failing evidence must NEVER surface as a fix-forward instruction.
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.fix_findings?.some((f) => f.reviewer === 'holdout')).toBe(false)
    })

    it('a satisfied holdout + approving panel + green gates advances to ship', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord(TASK_ID, ['d', 'e'], 5))
        await verdictStore.put(RUN_ID, TASK_ID, 0, [
            {criterion: 'd', satisfied: true, evidence: 'src/x.ts:1'},
            {criterion: 'e', satisfied: true, evidence: 'src/y.ts:2'},
        ])
        const deps = makeDeps()
        const input: RecordReviewsInput = {reviews: fullPanel(), verifications: []}

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.mergeGate.passed).toBe(true)
        expect(env.step).toEqual({done: false, phase: 'ship'})
        expect(env.mergeGate.from.some((e) => e.gate === 'holdout' && e.observed)).toBe(true)
    })

    // Decision 71 — a repeated IDENTICAL failing-gate set suspects the RED test as
    // the broken arbiter: route the escalation to `tests` (regenerate) instead of
    // re-rolling the implementer against a wrong test forever.
    /** Seed transient D71 fields onto the task row. */
    async function seedTask(fields: Partial<TaskState>): Promise<void> {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {...s.tasks, [TASK_ID]: {...nonNull(s.tasks[TASK_ID]), ...fields}},
        }))
    }

    it('D71: a first blocked verify persists the failing gate set and routes exec', async () => {
        const deps = makeDeps(greenProbe(), {redTests: true})

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.mergeGate.passed).toBe(false)
        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.last_failing_gates).toEqual(['test'])
        expect(task.test_revision_feedback).toBeUndefined()
    })

    it('D71: a second blocked verify with the IDENTICAL failing set routes to tests with revision feedback', async () => {
        await seedTask({
            last_failing_gates: ['test'],
            fix_findings: [{reviewer: 'test', description: 'stale fix-forward'}],
        })
        const deps = makeDeps(greenProbe(), {redTests: true})

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.step).toEqual({done: false, phase: 'tests'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.test_revision_feedback).toMatch(/identical failing gate set \(test\)/)
        expect(task.last_failing_gates).toBeUndefined()
        expect(task.fix_findings).toBeUndefined()
        expect(task.escalation_rung).toBe(1)
        expect(task.status).toBe('executing') // cursor re-stamped at tests
    })

    it('D71: a repeat with a DIFFERENT failing set stays on the exec route and overwrites the record', async () => {
        await seedTask({last_failing_gates: ['lint']})
        const deps = makeDeps(greenProbe(), {redTests: true})

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.last_failing_gates).toEqual(['test'])
        expect(task.test_revision_feedback).toBeUndefined()
    })

    it('D71: tdd_exempt keeps the exec route even on an identical repeat (no test-writer to rederive)', async () => {
        await seedTask({last_failing_gates: ['test']})
        const deps = makeDeps(greenProbe(), {redTests: true, tddExempt: true})

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.test_revision_feedback).toBeUndefined()
        expect(task.last_failing_gates).toEqual(['test'])
    })

    it('D71: a reviewer-only block (green gates) CLEARS a stale failing-gate record', async () => {
        await seedTask({last_failing_gates: ['test']})
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nline3\n')
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 2,
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                ],
            }),
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [{file: 'src/x.ts', line: 2, holds: true, note: 'confirmed'}],
                },
            ],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.last_failing_gates).toBeUndefined()
        expect(task.test_revision_feedback).toBeUndefined()
    })

    it('D71: a failing holdout is EXCLUDED from the failing-gate set (leak guard)', async () => {
        await holdout.put(RUN_ID, makeHoldoutRecord(TASK_ID, ['d', 'e'], 5))
        await verdictStore.put(RUN_ID, TASK_ID, 0, [
            {criterion: 'd', satisfied: false, evidence: ''},
            {criterion: 'e', satisfied: false, evidence: ''},
        ])
        const deps = makeDeps()

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.last_failing_gates).toBeUndefined()
    })

    it('D71: an advancing verify clears last_failing_gates', async () => {
        await seedTask({last_failing_gates: ['test']})
        const deps = makeDeps()

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, {
            reviews: fullPanel(),
            verifications: [],
        })

        expect(env.mergeGate.passed).toBe(true)
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.last_failing_gates).toBeUndefined()
    })

    it('is LOUD on a missing task', async () => {
        const deps = makeDeps()
        await expect(
            applyRecordReviews(deps, RUN_ID, 'ghost', verdictStore, {reviews: [], verifications: []})
        ).rejects.toThrow(/no task 'ghost'/)
    })

    it('fail-closed: escalate path does NOT persist reviewers; approve path persists reviewers+phase atomically', async () => {
        // ESCALATE branch: confirmed blocker → merge gate fails → escalateOrFail path.
        // Simulating the crash window: if reviewers were written before the panel result
        // was acted on, a no-results re-invoke at verify could derive a merge gate pass without
        // holdout evidence.  With the fix, reviewers must be EMPTY after the escalate record.
        await writeWorktreeFile('src/x.ts', 'line1\nconst x = 1\nline3\n')
        const depsEscalate = makeDeps()
        const escalateInput: RecordReviewsInput = {
            reviews: fullPanel({
                reviewer: 'quality-reviewer',
                verdict: 'blocked',
                findings: [
                    {
                        reviewer: 'quality-reviewer',
                        severity: 'critical',
                        blocking: true,
                        file: 'src/x.ts',
                        line: 2,
                        quote: 'const x = 1',
                        claim: 'a magic number is hardcoded',
                        description: 'magic number',
                    },
                ],
            }),
            verifications: [
                {
                    reviewer: 'quality-reviewer',
                    verdicts: [{file: 'src/x.ts', line: 2, holds: true, note: 'confirmed'}],
                },
            ],
        }
        const escalateEnv = await applyRecordReviews(depsEscalate, RUN_ID, TASK_ID, verdictStore, escalateInput)
        expect(escalateEnv.mergeGate.passed).toBe(false)
        // After escalate record: task.reviewers must be empty (fail-closed — no phantom persist).
        const taskAfterEscalate = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(taskAfterEscalate.reviewers).toEqual([])

        // ADVANCE branch: unanimous approve → reviewers + phase cursor land in one write.
        // Reset rung so we can run the approve case on the same seeded run.
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                [TASK_ID]: {
                    ...nonNull(s.tasks[TASK_ID]),
                    status: 'reviewing' as const,
                    phase: 'verify' as const,
                    escalation_rung: 0,
                    reviewers: [],
                },
            },
        }))
        const depsApprove = makeDeps()
        const approveInput: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
        }
        const approveEnv = await applyRecordReviews(depsApprove, RUN_ID, TASK_ID, verdictStore, approveInput)
        expect(approveEnv.mergeGate.passed).toBe(true)
        expect(approveEnv.step).toEqual({done: false, phase: 'ship'})
        // After advance record: reviewers persisted + phase advanced atomically.
        const taskAfterApprove = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(taskAfterApprove.reviewers.map((r) => r.verdict)).toEqual(PANEL_ROLES.map(() => 'approve'))
        expect(taskAfterApprove.phase).toBe('ship')
        expect(taskAfterApprove.status).toBe('shipping')
    })

    it('rejects LOUD on a malformed review[0] before any gate re-run executes', async () => {
        // Wrap the git probe so we can detect if GateRunner.run() was entered
        // (it calls tools.git.treeSha as its very first operation).
        let gateRan = false
        const baseProbe = greenProbe()
        const proto = Object.getPrototypeOf(baseProbe) as object
        const spyProbe: FakeGitProbe = Object.assign(Object.create(proto) as FakeGitProbe, {
            // eslint-disable-next-line @typescript-eslint/no-misused-spread -- prototype is preserved via Object.create above; spread copies own data fields only
            ...baseProbe,
            treeSha: async (...args: Parameters<typeof baseProbe.treeSha>) => {
                gateRan = true
                return baseProbe.treeSha(...args)
            },
            refExists: baseProbe.refExists.bind(baseProbe),
            revParse: baseProbe.revParse.bind(baseProbe),
            changedFiles: baseProbe.changedFiles.bind(baseProbe),
            commits: baseProbe.commits.bind(baseProbe),
        })

        const deps: RecordDeps = {
            config: defaultConfig(),
            spec: reviewsSpec(),
            git: new FakeGitClient({remoteHeads: {staging: 'sha-staging'}}),
            gh: new FakeGhClient(),
            tools: makeFakeTools({git: spyProbe}),
            loadContract: contractedLoader({
                coverage: {contracted: false, reason: 'fixture: coverage not exercised'},
                sast: {contracted: false, reason: 'fixture: no security command'},
            }),
            holdout,
            dataDir,
            workDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode: 'no-merge',
            designSystemDocs: () => Promise.resolve([]),
            state,
        }

        // A malformed review: missing required `reviewer` field so parseRawReview throws.
        const malformedReview = {verdict: 'approve', findings: []}
        const input: RecordReviewsInput = {
            reviews: [malformedReview],
            verifications: [],
        }

        await expect(applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)).rejects.toThrow()
        expect(gateRan).toBe(false)
    })

    it('surfaces a cross-vendor ABSENCE on the envelope and LOUDLY warns (Δ U — never silently dropped)', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
            crossVendorAbsent: {reason: 'single-vendor v1 (no second vendor configured)'},
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        // Machine-checkable: the absence rides the envelope (audit), surfaced from runPanel.
        expect(env.crossVendorAbsence).toEqual({
            reason: 'single-vendor v1 (no second vendor configured)',
        })
        // The merge gate is unaffected — a second vendor is a STRENGTH signal, never a gate.
        expect(env.mergeGate.passed).toBe(true)
        expect(env.step).toEqual({done: false, phase: 'ship'})
        // LOUD: a warn line names the absence so it can never be silently swallowed.
        expect(stderr).toMatch(/cross-vendor/i)
        expect(stderr).toContain('single-vendor v1 (no second vendor configured)')
    })

    it('records NO cross-vendor absence (and emits no warn) when a second vendor was present', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
        }

        const {result: env, stderr} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.crossVendorAbsence).toBeUndefined()
        expect(stderr).not.toMatch(/cross-vendor/i)
    })

    it('S5/C4 warn: an advancing verify PERSISTS cross_vendor_absent in the same write as reviewers', async () => {
        const deps = makeDeps()
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
            crossVendorAbsent: {reason: "cross-vendor executor 'codex' is not available"},
        }

        const {result: env} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.step).toEqual({done: false, phase: 'ship'})
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.cross_vendor_absent).toEqual({
            reason: "cross-vendor executor 'codex' is not available",
        })
        expect(task.reviewers.length).toBeGreaterThan(0)
    })

    it('S5/C4: a later advancing pass WITH a second vendor clears the stale persisted absence', async () => {
        await state.updateTask(RUN_ID, TASK_ID, (t) => ({
            ...t,
            cross_vendor_absent: {reason: 'stale absence from a prior pass'},
        }))
        const deps = makeDeps()
        const input: RecordReviewsInput = {reviews: fullPanel(), verifications: []}

        await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.cross_vendor_absent).toBeUndefined()
    })

    it('S5/C block mode: requireCrossVendor=block + absent → terminal blocked-environmental, no rung burned', async () => {
        const cfg = defaultConfig()
        const deps: RecordDeps = {
            ...makeDeps(),
            config: {...cfg, review: {...cfg.review, requireCrossVendor: 'block'}},
        }
        const input: RecordReviewsInput = {
            reviews: fullPanel(), // all approve — ONLY the absence blocks
            verifications: [],
            crossVendorAbsent: {reason: 'codex execution failed: exit 1'},
        }

        const {result: env} = await captureWarnings(() =>
            applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)
        )

        expect(env.mergeGate.passed).toBe(false)
        // Environmental, not a producer defect: fail fast instead of burning the ladder
        // against a process-sticky vendor absence no implementer re-run can repair.
        expect(env.step.done).toBe(true)
        if (!env.step.done) {
            throw new Error('unreachable')
        }
        expect(env.step.outcome).toMatchObject({
            outcome: 'failed',
            failure_class: 'blocked-environmental',
        })
        const quality = nonNull(env.reviewers.find((r) => r.reviewer === 'quality-reviewer'))
        expect(quality.verdict).toBe('error')
        const task = nonNull((await state.read(RUN_ID)).tasks[TASK_ID])
        expect(task.status).toBe('failed')
        expect(task.failure_class).toBe('blocked-environmental')
        expect(task.escalation_rung).toBe(0)
    })

    it('gate baseRef is per-run staging/<run-id>, not shared staging (Decision 33)', async () => {
        // Probe seeded with ONLY origin/staging/<run-id>. If the record still passes
        // deps.config.git.stagingBranch ("staging") as baseRef, the TDD strategy will
        // look up origin/staging (missing) → gate fails → merge gate blocks → step !== ship.
        // After the fix (runStagingBranch(runId)), the probe resolves origin/staging-run-1
        // and the green gate + approve panel advance to ship.
        const perRunProbe = new FakeGitProbe({
            refs: {'origin/staging-run-1': 'sha-base', HEAD: 'sha-head'},
            changedFiles: [],
            commits: [
                commit({sha: 'c1', files: ['src/x.test.ts'], tagged: true}),
                commit({sha: 'c2', files: ['src/x.ts'], tagged: true}),
            ],
        })
        const deps: RecordDeps = {
            config: defaultConfig(),
            spec: reviewsSpec(),
            git: new FakeGitClient({remoteHeads: {'staging-run-1': 'sha-staging'}}),
            gh: new FakeGhClient(),
            tools: makeFakeTools({git: perRunProbe}),
            loadContract: contractedLoader({
                coverage: {contracted: false, reason: 'fixture: coverage not exercised'},
                sast: {contracted: false, reason: 'fixture: no security command'},
            }),
            holdout,
            dataDir,
            workDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode: 'no-merge',
            designSystemDocs: () => Promise.resolve([]),
            state,
        }
        const input: RecordReviewsInput = {
            reviews: fullPanel(),
            verifications: [],
        }

        const env = await applyRecordReviews(deps, RUN_ID, TASK_ID, verdictStore, input)

        // Gate must be GREEN (per-run ref resolved) and merge gate must pass → advance to ship.
        expect(env.mergeGate.passed).toBe(true)
        expect(env.step).toEqual({done: false, phase: 'ship'})
    })
})

// ---------------------------------------------------------------------------
// applyRecordProducer record  (moved from src/cli/subcommands/record-producer.test.ts)
// ---------------------------------------------------------------------------

/** The pre-producer checkpoint tip for the ALREADY_SATISFIED fixtures (hex — SHA-shaped). */
const AS_TIP = 'a'.repeat(40)
/** An existing commit that is NOT an ancestor of AS_TIP. */
const AS_STRAY = 'b'.repeat(40)

async function seededProducerState(
    task: Partial<TaskState> = {},
    opts: {redTests?: boolean} = {}
): Promise<{dataDir: string; state: StateManager; pdeps: RecordDeps; git: FakeGitClient}> {
    const dataDir = await mkdtemp(join(tmpdir(), 'factory-record-producer-'))
    const state = new StateManager({
        dataDir,
        lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
    })
    await state.create({
        run_id: RUN_ID,
        staging_branch: `staging-${RUN_ID}`,
        spec: {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42},
    })
    await state.update(RUN_ID, (s) => ({
        ...s,
        tasks: {
            t1: {
                task_id: 't1',
                status: task.status ?? 'executing',
                phase: task.phase ?? 'exec',
                depends_on: [],
                risk_tier: 'medium',
                escalation_rung: task.escalation_rung ?? 0,
                reviewers: task.reviewers ?? [],
                merge_resyncs: 0,
                ...(task.spawn_in_flight !== undefined ? {spawn_in_flight: task.spawn_in_flight} : {}),
            },
        },
    }))
    // Seed the checkpoint tip and a stray commit as resolvable refs (the fake's
    // revParse convention); mergeBase(x, x) === x models "x is an ancestor of x".
    const git = new FakeGitClient({
        remoteHeads: {[`staging-${RUN_ID}`]: 'sha-staging'},
        localBranches: {[AS_TIP]: {sha: AS_TIP}, [AS_STRAY]: {sha: AS_STRAY}},
    })
    const pdeps: RecordDeps = {
        config: defaultConfig(),
        spec: reviewsSpec(),
        git,
        gh: new FakeGhClient(),
        tools: makeFakeTools({
            git: greenProbe(),
            ...(opts.redTests === true ? {vitest: new FakeVitest(proc(1, '', '2 tests failed'))} : {}),
        }),
        loadContract: contractedLoader({
            coverage: {contracted: false, reason: 'fixture: coverage not exercised'},
            sast: {contracted: false, reason: 'fixture: no security command'},
        }),
        holdout: new InMemoryHoldoutStore(),
        dataDir,
        workDir: dataDir,
        owner: 'acme',
        repo: 'widgets',
        shipMode: 'no-merge',
        designSystemDocs: () => Promise.resolve([]),
        state,
    }
    return {dataDir, state, pdeps, git}
}

describe('applyRecordProducer — DONE advances', () => {
    let dataDir: string
    let state: StateManager
    let pdeps: RecordDeps

    beforeEach(async () => {
        ;({dataDir, state, pdeps} = await seededProducerState())
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('tests/DONE records test-writer and advances to exec', async () => {
        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'tests', 'STATUS: DONE')

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.producer_role).toBe('test-writer')
        expect(task.status).toBe('executing') // markInFlight(exec)
    })

    it('exec/DONE records implementer and advances to verify', async () => {
        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', 'STATUS: DONE')

        expect(env.step).toEqual({done: false, phase: 'verify'})
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.producer_role).toBe('implementer')
        expect(task.status).toBe('reviewing') // markInFlight(verify)
    })
})

describe('applyRecordProducer — classify-before-retry (Δ D)', () => {
    let dataDir: string
    let state: StateManager
    let pdeps: RecordDeps

    beforeEach(async () => {
        ;({dataDir, state, pdeps} = await seededProducerState())
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('BLOCKED—escalate fails spec-defect immediately (no rung burned)', async () => {
        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', 'STATUS: BLOCKED — escalate')

        expect(env.step.done).toBe(true)
        if (!env.step.done) {
            throw new Error('unreachable')
        }
        expect(env.step.outcome).toEqual(expect.objectContaining({outcome: 'failed', failure_class: 'spec-defect'}))
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.status).toBe('failed')
        expect(task.escalation_rung).toBe(0) // a failure never burns a rung
    })

    it('NEEDS_CONTEXT (first ask) persists the question, burns NO rung, re-spawns the same phase (Decision 69)', async () => {
        const env = await applyRecordProducer(
            pdeps,
            RUN_ID,
            't1',
            'exec',
            'STATUS: NEEDS_CONTEXT — which auth provider?'
        )

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.escalation_rung).toBe(0) // a question is not a capability failure
        expect(task.needs_context?.question).toContain('which auth provider?')
        expect(task.status).toBe('executing') // cursor re-stamped at exec
    })

    it('NEEDS_CONTEXT (second consecutive ask) fails LOUD with class needs-context (Decision 69)', async () => {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                ...s.tasks,
                t1: {...nonNull(s.tasks.t1), needs_context: {question: 'which auth provider?'}},
            },
        }))
        const env = await applyRecordProducer(
            pdeps,
            RUN_ID,
            't1',
            'exec',
            'STATUS: NEEDS_CONTEXT — still: which auth provider?'
        )

        expect(env.step.done).toBe(true)
        if (!env.step.done) {
            throw new Error('unreachable')
        }
        expect(env.step.outcome).toEqual(expect.objectContaining({outcome: 'failed', failure_class: 'needs-context'}))
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.status).toBe('failed')
        expect(task.needs_context?.question).toContain('which auth provider?') // survives for rescue --answer
    })

    it('a defective-RED-test escalation resumes at tests (test-writer regenerates) and carries the feedback', async () => {
        const env = await applyRecordProducer(
            pdeps,
            RUN_ID,
            't1',
            'exec',
            'STATUS: BLOCKED — escalate: test requires revision — pins user_id = auth.uid()'
        )

        // Bounded retry, NOT a terminal spec-defect — and it re-enters the `tests` phase
        // so the test-writer (not the implementer) rewrites the RED test.
        expect(env.step).toEqual({done: false, phase: 'tests'})
        const task = nonNull((await state.read(RUN_ID)).tasks.t1)
        expect(task.escalation_rung).toBe(1)
        expect(task.test_revision_feedback).toContain('test requires revision')
    })

    it('an unparseable status re-spawns the same (phase, rung) — the spawn re-drive budget, NOT a rung bump (Decision 71)', async () => {
        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', 'garbled nonsense')

        expect(env.step).toEqual({done: false, phase: 'exec'})
        expect(nonNull((await state.read(RUN_ID)).tasks.t1).escalation_rung).toBe(0)
    })

    it('an exhausted ladder fails capability-budget', async () => {
        // Advance the escalation rung to the cap so the next failure fails the task.
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                ...s.tasks,
                t1: {...nonNull(s.tasks.t1), escalation_rung: ESCALATION_CAP},
            },
        }))
        const env = await applyRecordProducer(
            pdeps,
            RUN_ID,
            't1',
            'exec',
            'STATUS: BLOCKED — escalate: test requires revision — pins a wrong literal'
        )

        expect(env.step.done).toBe(true)
        if (!env.step.done) {
            throw new Error('unreachable')
        }
        expect(env.step.outcome).toEqual(
            expect.objectContaining({outcome: 'failed', failure_class: 'capability-budget'})
        )
        expect(nonNull((await state.read(RUN_ID)).tasks.t1).status).toBe('failed')
    })

    it('is LOUD on a missing task', async () => {
        await expect(applyRecordProducer(pdeps, RUN_ID, 'ghost', 'exec', 'STATUS: DONE')).rejects.toThrow(
            /no task 'ghost'/
        )
    })

    // Relocated from src/cli/subcommands/record-producer.test.ts (CLI shell deleted):
    // a non-producer phase must be rejected LOUD before any state read.
    it('rejects a non-producer phase (verify) LOUD', async () => {
        await expect(applyRecordProducer(pdeps, RUN_ID, 't1', 'verify', 'STATUS: DONE')).rejects.toThrow(
            /producer phase \(tests \| exec\)/
        )
    })
})

// ---------------------------------------------------------------------------
// Decision 70 — ALREADY_SATISFIED engine verification: the producer's claim is
// checked against git ancestry + the test gate AT THE PRE-PRODUCER TIP; a pass
// completes the task and appends a spec-ledger entry, any reject burns a rung
// with a fix_findings note. Never trusted, never silently advanced.
// ---------------------------------------------------------------------------
describe('applyRecordProducer — ALREADY_SATISFIED verification (Decision 70)', () => {
    let dataDir: string
    let state: StateManager
    let pdeps: RecordDeps
    let git: FakeGitClient

    const CHECKPOINT = {phase: 'exec' as const, rung: 0, tip_sha: AS_TIP, spawned_at: 1, redrives: 0}

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    async function readT1(): Promise<TaskState> {
        return nonNull((await state.read(RUN_ID)).tasks.t1)
    }

    it('a verified claim completes the task and appends an already-satisfied ledger entry', async () => {
        ;({dataDir, state, pdeps, git} = await seededProducerState({spawn_in_flight: CHECKPOINT}))

        const env = await applyRecordProducer(
            pdeps,
            RUN_ID,
            't1',
            'exec',
            `STATUS: ALREADY_SATISFIED — ${AS_TIP}: PR #7 landed it`
        )

        expect(env.step).toEqual({done: true, outcome: {outcome: 'done'}})
        const task = await readT1()
        expect(task.status).toBe('done')
        // Verification ran at the CHECKPOINT tip (claimant edits discarded first).
        expect(git.calls).toContain(`reset --hard ${AS_TIP}`)
        const ledger = await readLedger(dataDir, 'acme/widgets', '42-checkout')
        expect(ledger.entries).toHaveLength(1)
        expect(ledger.entries[0]).toMatchObject({
            task_id: 't1',
            run_id: RUN_ID,
            shas: [AS_TIP],
            source: 'already-satisfied',
        })
    })

    it('a claim with NO cited SHAs is rejected: rung burned + fix_findings note, same-phase resume', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState({spawn_in_flight: CHECKPOINT}))

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', 'STATUS: ALREADY_SATISFIED — trust me')

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = await readT1()
        expect(task.escalation_rung).toBe(1)
        expect(task.fix_findings).toEqual([
            {
                reviewer: 'already-satisfied-verifier',
                description: expect.stringContaining('no commit SHAs') as string,
            },
        ])
        expect((await readLedger(dataDir, 'acme/widgets', '42-checkout')).entries).toEqual([])
    })

    it('a cited SHA that does not exist is rejected (rung burned)', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState({spawn_in_flight: CHECKPOINT}))
        const ghost = 'c'.repeat(40)

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', `STATUS: ALREADY_SATISFIED — ${ghost}`)

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = await readT1()
        expect(task.escalation_rung).toBe(1)
        expect(nonNull(task.fix_findings)[0]?.description).toContain(ghost)
    })

    it('a cited SHA that is NOT an ancestor of the checkpoint tip is rejected (a producer cannot launder fresh commits)', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState({spawn_in_flight: CHECKPOINT}))

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', `STATUS: ALREADY_SATISFIED — ${AS_STRAY}`)

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = await readT1()
        expect(task.escalation_rung).toBe(1)
        expect(nonNull(task.fix_findings)[0]?.description).toContain('ancestor')
    })

    it('a RED test gate at the checkpoint tip rejects the claim (the base does not satisfy the task)', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState({spawn_in_flight: CHECKPOINT}, {redTests: true}))

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', `STATUS: ALREADY_SATISFIED — ${AS_TIP}`)

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = await readT1()
        expect(task.escalation_rung).toBe(1)
        expect(nonNull(task.fix_findings)[0]?.description).toContain('test gate')
        expect((await readLedger(dataDir, 'acme/widgets', '42-checkout')).entries).toEqual([])
    })

    it('a claim with NO matching spawn checkpoint is rejected (no pre-producer tip to verify against)', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState()) // no spawn_in_flight seeded

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'exec', `STATUS: ALREADY_SATISFIED — ${AS_TIP}`)

        expect(env.step).toEqual({done: false, phase: 'exec'})
        const task = await readT1()
        expect(task.escalation_rung).toBe(1)
        expect(nonNull(task.fix_findings)[0]?.description).toContain('checkpoint')
    })

    it('a tests-phase claim resumes at tests on reject (same-phase rung burn)', async () => {
        ;({dataDir, state, pdeps} = await seededProducerState({
            phase: 'tests',
            spawn_in_flight: {...CHECKPOINT, phase: 'tests'},
        }))

        const env = await applyRecordProducer(pdeps, RUN_ID, 't1', 'tests', 'STATUS: ALREADY_SATISFIED — no evidence')

        expect(env.step).toEqual({done: false, phase: 'tests'})
        expect((await readT1()).escalation_rung).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// WS7 — buildWorktreeSource swallows ONLY ENOENT (the cited file is genuinely
// absent → null → citations unverifiable → dropped). Any OTHER read error
// (EACCES, EISDIR, I/O) is a real failure that must RETHROW, never be demoted to
// "missing" — a silent demotion would drop a citation that may back a real blocker.
// ---------------------------------------------------------------------------
describe('buildWorktreeSource — ENOENT-only swallow (citation source loader)', () => {
    let wt: string
    beforeEach(async () => {
        wt = await mkdtemp(join(tmpdir(), 'factory-record-source-'))
    })
    afterEach(async () => {
        await rm(wt, {recursive: true, force: true})
    })

    const citing = (file: string): RawReview => ({
        reviewer: 'quality',
        verdict: 'blocked',
        findings: [
            {
                reviewer: 'quality',
                severity: 'critical',
                blocking: true,
                file,
                line: 1,
                quote: 'x',
                claim: 'c',
                description: 'd',
            },
        ],
    })

    it('a genuinely ABSENT cited file (ENOENT) maps to null — unverifiable, dropped', async () => {
        const src = await buildWorktreeSource(wt, [citing('does/not/exist.ts')])
        expect(src.readLines('does/not/exist.ts')).toBeNull()
    })

    it('a present cited file loads its split lines', async () => {
        await writeFile(join(wt, 'present.ts'), 'a\nb\nc\n')
        const src = await buildWorktreeSource(wt, [citing('present.ts')])
        expect(src.readLines('present.ts')).toEqual(['a', 'b', 'c', ''])
    })

    it("a NON-ENOENT read error (cited path is a directory → EISDIR) RETHROWS — never demoted to 'missing'", async () => {
        // A real blocker citation whose file cannot be read for a reason OTHER than
        // absence must NOT be silently swallowed to null. Make the cited path a
        // directory so readFile raises EISDIR rather than ENOENT.
        await mkdir(join(wt, 'a-directory'), {recursive: true})
        await expect(buildWorktreeSource(wt, [citing('a-directory')])).rejects.toThrow()
    })

    it('a traversal-escaping cited file (../) maps to null and is NEVER read outside the worktree', async () => {
        // Untrusted reviewer JSON: a `../` file that resolves OUTSIDE the worktree
        // must be dropped (null), not read. Plant a secret as a sibling of `wt`; a
        // missing containment guard would leak its contents through readLines.
        const secret = join(dirname(wt), 'factory-record-escape-secret.ts')
        await writeFile(secret, 'TOP\nSECRET\n')
        try {
            const src = await buildWorktreeSource(wt, [citing('../factory-record-escape-secret.ts')])
            expect(src.readLines('../factory-record-escape-secret.ts')).toBeNull()
        } finally {
            await rm(secret, {force: true})
        }
    })
})
