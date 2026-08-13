import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {StateManager} from '../core/state/manager.js'
import {defaultConfig} from '../config/schema.js'
import {FakeGitClient} from '../git/fakes.js'
import {parseSpecManifest, type SpecManifest} from '../spec/index.js'
import type {TaskState} from '../types/index.js'
import type {ProvisionWorktreeFn} from './deps.js'
import {
    runAssessmentEmit,
    runAssessmentRecord,
    assessmentWorktreePath,
    MAX_ASSESS_ATTEMPTS,
    AssessmentResultsSchema,
    type AssessmentRunDeps,
} from './assessment.js'

const RUN_ID = 'run-1'
const REPO = 'acme/widgets'
const BRANCH = `e2e-assess-${RUN_ID}`
const STAGING = `staging-${RUN_ID}`

let dataDir: string
let workDir: string
let state: StateManager
let git: FakeGitClient

const SPEC: SpecManifest = parseSpecManifest({
    spec_id: '42-checkout',
    issue_number: 42,
    slug: 'checkout',
    repo: REPO,
    generated_at: '2026-06-01T00:00:00.000Z',
    tasks: [
        {
            task_id: 'task-a',
            title: 'Checkout button',
            description: 'adds a checkout flow',
            files: ['src/checkout.ts'],
            acceptance_criteria: ['a user can complete checkout'],
            tests_to_write: ['covers checkout'],
            depends_on: [],
            risk_tier: 'medium',
            risk_rationale: 'money path',
        },
    ],
})

function taskRow(taskId: string, status: TaskState['status']): TaskState {
    return {
        task_id: taskId,
        status,
        depends_on: [],
        escalation_rung: 0,
        reviewers: [],
        merge_resyncs: 0,
    }
}

function deps(overrides: Partial<AssessmentRunDeps> = {}): AssessmentRunDeps {
    const noopProvision: ProvisionWorktreeFn = async () => {
        /* no-op */
    }
    return {
        state,
        git,
        config: defaultConfig(),
        workDir,
        spec: SPEC,
        provision: noopProvision,
        ...overrides,
    }
}

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'e2e-assess-'))
    workDir = await mkdtemp(join(tmpdir(), 'e2e-assess-workdir-'))
    state = new StateManager({dataDir})
    git = new FakeGitClient({remoteHeads: {[STAGING]: 'sha-staging'}})
    await state.create({
        run_id: RUN_ID,
        staging_branch: `staging-${RUN_ID}`,
        spec: {repo: REPO, spec_id: SPEC.spec_id, issue_number: SPEC.issue_number},
    })
    await state.update(RUN_ID, (s) => ({
        ...s,
        e2e: true,
        tasks: {'task-a': taskRow('task-a', 'pending')},
    }))
})

afterEach(async () => {
    await rm(dataDir, {recursive: true, force: true})
    await rm(workDir, {recursive: true, force: true})
})

describe('runAssessmentEmit', () => {
    it('creates the assess worktree off the staging tip, provisions it, and returns the spawn', async () => {
        const provisioned: string[] = []
        const env = await runAssessmentEmit(
            deps({
                provision: (a) => {
                    provisioned.push(a.path)
                    return Promise.resolve()
                },
            }),
            RUN_ID
        )
        expect(env.kind).toBe('spawn')
        if (env.kind !== 'spawn') {
            throw new Error('expected spawn')
        }
        expect(env.worktree).toBe(assessmentWorktreePath(workDir, RUN_ID))
        // TCB-safe location: under workDir/<runId>/, dot-prefixed (never runs/<runId>/;
        // workDir is git-derived `<repoRoot>/.claude/worktrees` in production, Decision 67).
        expect(env.worktree).toContain(join(workDir, RUN_ID, '.e2e-assess'))
        expect(env.assess_branch).toBe(BRANCH)
        expect(env.staging_branch).toBe(STAGING)
        expect(env.model).toBe('sonnet') // trimmed from the prior apex pin (Decision 40)
        expect(git.calls.some((c) => c.startsWith('worktree add') && c.includes(BRANCH))).toBe(true)
        expect(provisioned).toEqual([env.worktree])
        // The prompt carries the forecast inputs: worktree, task list, testDir, verdict contract.
        expect(env.prompt).toContain(env.worktree)
        expect(env.prompt).toContain('task-a')
        expect(env.prompt).toContain('a user can complete checkout')
        expect(env.prompt).toContain('e2e/')
        expect(env.prompt).toContain('boot-impossible')
    })

    it('is idempotent on resume: existing worktree → no second add, identical spawn', async () => {
        const first = await runAssessmentEmit(deps(), RUN_ID)
        const callsAfterFirst = git.calls.length
        const second = await runAssessmentEmit(deps(), RUN_ID)
        const adds = git.calls.slice(callsAfterFirst).filter((c) => c.startsWith('worktree add'))
        expect(adds).toHaveLength(0)
        if (first.kind !== 'spawn' || second.kind !== 'spawn') {
            throw new Error('expected spawn')
        }
        expect(second.worktree).toBe(first.worktree)
        expect(second.prompt).toBe(first.prompt)
    })

    it('on a retry (attempts >= 1) hard-resets the dirty worktree to the staging tip', async () => {
        await runAssessmentEmit(deps(), RUN_ID) // create
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e_assessment: {attempts: 1, affected_specs: []},
        }))
        const env = await runAssessmentEmit(deps(), RUN_ID)
        expect(env.kind).toBe('spawn')
        expect(git.calls.some((c) => c === `reset --hard origin/${STAGING}`)).toBe(true)
    })

    it('echoes a concluded done verdict (with its warning) instead of re-spawning', async () => {
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e_assessment: {status: 'done' as const, warning: 'no login coverage', affected_specs: []},
        }))
        const env = await runAssessmentEmit(deps(), RUN_ID)
        expect(env).toEqual({kind: 'done', run_id: RUN_ID, warning: 'no login coverage'})
        expect(git.calls.some((c) => c.startsWith('worktree add'))).toBe(false)
    })

    it('echoes a concluded failed verdict instead of re-spawning', async () => {
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e_assessment: {
                status: 'failed' as const,
                reason: 'the app needs a production database',
                affected_specs: [],
            },
        }))
        const env = await runAssessmentEmit(deps(), RUN_ID)
        expect(env).toEqual({
            kind: 'failed',
            run_id: RUN_ID,
            reason: 'the app needs a production database',
        })
    })
})

describe('runAssessmentRecord — ok / degraded', () => {
    it('ok with changes → merges the assess branch into staging, pushes, persists the forecast', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        git.branchFiles.set(BRANCH, ['e2e/support/seed.ts', 'playwright.config.ts'])
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'ok',
            resolved: {start_command: 'npm start', base_url: 'http://localhost:3000'},
            affected_specs: [{spec_path: 'e2e/checkout.spec.ts', task_ids: ['task-a'], expectation: 'needs-update'}],
        })
        expect(env).toEqual({kind: 'done', run_id: RUN_ID})
        expect(git.mergesInto[STAGING]).toContain(BRANCH)
        expect(git.calls.some((c) => c === `push origin ${STAGING}`)).toBe(true)
        expect(git.calls.some((c) => c.startsWith('worktree remove'))).toBe(true)
        const run = await state.read(RUN_ID)
        expect(run.e2e_assessment?.status).toBe('done')
        expect(run.e2e_assessment?.resolved).toEqual({
            start_command: 'npm start',
            base_url: 'http://localhost:3000',
        })
        expect(run.e2e_assessment?.affected_specs).toHaveLength(1)
        expect(run.e2e_assessment?.attempts).toBe(1)
        expect(run.e2e_assessment?.ended_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('ok with NO changes (steady state) → skips merge and push entirely', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {status: 'ok', affected_specs: []})
        expect(env.kind).toBe('done')
        expect(git.mergesInto[STAGING]).toBeUndefined()
        expect(git.calls.some((c) => c.startsWith('push'))).toBe(false)
        expect((await state.read(RUN_ID)).e2e_assessment?.status).toBe('done')
    })

    it('degraded → persists the warning and carries it on the done envelope', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'degraded',
            warning: "journeys behind login can't be tested — no way to create a test account",
            affected_specs: [],
        })
        expect(env.kind).toBe('done')
        if (env.kind !== 'done') {
            throw new Error('expected done')
        }
        expect(env.warning).toContain('behind login')
        expect((await state.read(RUN_ID)).e2e_assessment?.warning).toContain('behind login')
    })

    it('degraded falls back to `reason` when the assessor set no warning', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'degraded',
            reason: 'seed endpoint returns 500',
            affected_specs: [],
        })
        if (env.kind !== 'done') {
            throw new Error('expected done')
        }
        expect(env.warning).toBe('seed endpoint returns 500')
    })

    it('degraded with NO warning AND NO reason still persists a non-empty warning (never launders to clean done)', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'degraded',
            affected_specs: [],
        })
        if (env.kind !== 'done') {
            throw new Error('expected done')
        }
        expect(env.warning).toBeTruthy()
        expect((await state.read(RUN_ID)).e2e_assessment?.warning).toBeTruthy()
    })
})

describe('runAssessmentRecord — impossible verdicts (FINAL, no retry)', () => {
    it.each(['boot-impossible', 'machinery-impossible'] as const)(
        '%s → sweeps non-terminal tasks blocked-environmental and persists failed',
        async (status) => {
            await state.update(RUN_ID, (s) => ({
                ...s,
                tasks: {
                    'task-a': taskRow('task-a', 'pending'),
                    'task-b': {...taskRow('task-b', 'done'), ended_at: '2026-01-01T00:00:00.000Z'},
                },
            }))
            await runAssessmentEmit(deps(), RUN_ID)
            const env = await runAssessmentRecord(deps(), RUN_ID, {
                status,
                reason: 'the app needs a live payment gateway that does not exist here',
                affected_specs: [],
            })
            expect(env.kind).toBe('failed')
            if (env.kind !== 'failed') {
                throw new Error('expected failed')
            }
            expect(env.reason).toContain('live payment gateway')
            const run = await state.read(RUN_ID)
            expect(run.e2e_assessment?.status).toBe('failed')
            expect(run.e2e_assessment?.reason).toContain('live payment gateway')
            // Sweep: pending task failed as rescue-RECOVERABLE, quoting the verdict…
            expect(run.tasks['task-a']?.status).toBe('failed')
            expect(run.tasks['task-a']?.failure_class).toBe('blocked-environmental')
            expect(run.tasks['task-a']?.failure_reason).toContain('live payment gateway')
            // …while terminal tasks are never touched.
            expect(run.tasks['task-b']?.status).toBe('done')
            expect(git.calls.some((c) => c.startsWith('worktree remove'))).toBe(true)
            // Nothing merges on a fail.
            expect(git.mergesInto[STAGING]).toBeUndefined()
        }
    )

    it('an impossible verdict is final even on the FIRST attempt (no retry spent)', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'boot-impossible',
            reason: 'needs secrets',
            affected_specs: [],
        })
        expect(env.kind).toBe('failed')
        expect((await state.read(RUN_ID)).e2e_assessment?.attempts).toBe(1)
    })
})

describe('runAssessmentRecord — retryable failures', () => {
    it('status "error" (dead assessor) below the cap → persists attempts, re-emits the spawn', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'error',
            reason: 'e2e-assessor agent skipped or died',
            affected_specs: [],
        })
        expect(env.kind).toBe('spawn') // the retry
        const run = await state.read(RUN_ID)
        expect(run.e2e_assessment?.attempts).toBe(1)
        // status stays ABSENT so wantsE2eAssessment keeps gating the run here.
        expect(run.e2e_assessment?.status).toBeUndefined()
        // The re-emit hard-reset the dirty worktree.
        expect(git.calls.some((c) => c.startsWith('reset --hard'))).toBe(true)
    })

    it(`at the cap (${MAX_ASSESS_ATTEMPTS}) an error converts to the terminal fail`, async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e_assessment: {attempts: 1, affected_specs: []},
        }))
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'error',
            affected_specs: [],
        })
        expect(env.kind).toBe('failed')
        if (env.kind !== 'failed') {
            throw new Error('expected failed')
        }
        expect(env.reason).toContain(`after ${MAX_ASSESS_ATTEMPTS} attempts`)
        const run = await state.read(RUN_ID)
        expect(run.e2e_assessment?.status).toBe('failed')
        expect(run.tasks['task-a']?.status).toBe('failed')
    })

    it('a forecast naming an unknown task_id is rejected → retry, nothing merged', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        git.branchFiles.set(BRANCH, ['playwright.config.ts'])
        const env = await runAssessmentRecord(deps(), RUN_ID, {
            status: 'ok',
            affected_specs: [{spec_path: 'e2e/x.spec.ts', task_ids: ['task-GHOST'], expectation: 'needs-update'}],
        })
        expect(env.kind).toBe('spawn')
        expect(git.mergesInto[STAGING]).toBeUndefined()
        expect((await state.read(RUN_ID)).e2e_assessment?.status).toBeUndefined()
    })

    it('a branch touching files OUTSIDE testDir/ + playwright.config.ts is rejected → retry', async () => {
        await runAssessmentEmit(deps(), RUN_ID)
        git.branchFiles.set(BRANCH, ['e2e/support/seed.ts', 'src/app.ts'])
        const env = await runAssessmentRecord(deps(), RUN_ID, {status: 'ok', affected_specs: []})
        expect(env.kind).toBe('spawn')
        expect(git.mergesInto[STAGING]).toBeUndefined()
    })
})

describe('AssessmentResultsSchema', () => {
    it('defaults affected_specs and rejects unknown keys (strict)', () => {
        expect(AssessmentResultsSchema.parse({status: 'ok'}).affected_specs).toEqual([])
        expect(() => AssessmentResultsSchema.parse({status: 'ok', manifest: []})).toThrow()
    })

    it('rejects an unknown status', () => {
        expect(() => AssessmentResultsSchema.parse({status: 'done'})).toThrow()
    })
})
