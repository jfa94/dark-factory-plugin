/**
 * P1b — GitHub ADOPTION (forward-only autonomous repair; Decision 60).
 *
 * Two halves, mirroring reconcile.test.ts's split:
 *   - {@link planAdoptions} is PURE over (RunState, ReconcileReport) — hand-built
 *     reports, no fakes, cover every class + the two reopen shapes.
 *   - {@link applyAdoptions}/{@link adoptRun} run against the real {@link StateManager}
 *     (temp dir) + {@link FakeGitClient}/{@link FakeGhClient}: race-skips, local-gone
 *     push skip, no-force assertion, and the invariant that adoption never writes
 *     `human_touches` or `self_heal`.
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {planAdoptions, applyAdoptions, adoptFromReport, adoptRun, summarizeAdoption} from './adopt.js'
import type {Drift, ReconcileReport, TaskFacts} from './reconcile.js'
import {StateManager} from '../core/state/manager.js'
import {FakeGitClient, FakeGhClient} from '../git/fakes.js'
import {parseRunState, isTerminalRunStatus} from '../core/state/index.js'
import type {RunState, RunStatus, TaskState} from '../types/index.js'
import {nonNull} from '../shared/index.js'

const RUN_ID = 'run-ad-1'
const STAGING = `staging-${RUN_ID}`
const SPEC = {repo: 'acme/widgets', spec_id: '7-x', issue_number: 7} as const
const BRANCH = `factory/${RUN_ID}/t1`

type TaskSeed = Partial<TaskState> & {task_id: string; status: TaskState['status']}

const IN_FLIGHT_DEFAULT_PHASE = {executing: 'exec', reviewing: 'verify', shipping: 'ship'} as const

function task(seed: TaskSeed): TaskState {
    const base = {
        depends_on: [],
        risk_tier: 'medium' as const,
        escalation_rung: 0,
        reviewers: [],
        merge_resyncs: 0,
        ...(seed.status === 'executing' || seed.status === 'reviewing' || seed.status === 'shipping'
            ? {phase: IN_FLIGHT_DEFAULT_PHASE[seed.status]}
            : {}),
        ...seed,
    }
    if (seed.status === 'failed') {
        return {failure_class: 'capability-budget' as const, failure_reason: 'ran out of retries', ...base}
    }
    return base
}

function mkRun(seeds: readonly TaskSeed[], status: RunStatus = 'running', rollup?: RunState['rollup']): RunState {
    return parseRunState({
        run_id: RUN_ID,
        staging_branch: STAGING,
        status,
        spec: SPEC,
        tasks: Object.fromEntries(seeds.map((s) => [s.task_id, task(s)])),
        started_at: '2026-07-08T00:00:00.000Z',
        updated_at: '2026-07-08T00:00:00.000Z',
        ...(isTerminalRunStatus(status) ? {ended_at: '2026-07-08T01:00:00.000Z'} : {}),
        ...(rollup !== undefined ? {rollup} : {}),
    })
}

function mkReport(over: {tasks?: TaskFacts[]; drifts?: Drift[]; rollup_landed?: boolean}): ReconcileReport {
    return {
        facts: {repo: 'acme/widgets', staging: {branch: STAGING, tip: 'stagsha'}, tasks: over.tasks ?? []},
        drifts: over.drifts ?? [],
        rollup_landed: over.rollup_landed ?? false,
    }
}

// ---------------------------------------------------------------------------
// planAdoptions (pure)
// ---------------------------------------------------------------------------

describe('planAdoptions — per class', () => {
    it('merged-unrecorded (base == staging): flip to done, carrying merge_sha', () => {
        const run = mkRun([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 101,
                        prs: [{number: 101, state: 'MERGED', baseRefName: STAGING, merge_sha: 'abc123'}],
                    },
                ],
                drifts: [{class: 'merged-unrecorded', task_id: 't1', pr_number: 101, detail: 'x'}],
            })
        )
        expect(plan.done).toEqual([{task_id: 't1', pr_number: 101, merge_sha: 'abc123'}])
        expect(plan.surfaced).toEqual([])
    })

    it('merged-unrecorded (base != staging): surface, never adopt (not this run’s ship)', () => {
        const run = mkRun([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const drift: Drift = {class: 'merged-unrecorded', task_id: 't1', pr_number: 101, detail: 'x'}
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 101,
                        prs: [{number: 101, state: 'MERGED', baseRefName: 'develop', merge_sha: 'abc123'}],
                    },
                ],
                drifts: [drift],
            })
        )
        expect(plan.done).toEqual([])
        expect(plan.surfaced).toEqual([drift])
    })

    it('stale-pr-number with exactly one OPEN PR: rebind the pointer', () => {
        const run = mkRun([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 999}])
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 999,
                        prs: [{number: 101, state: 'OPEN', baseRefName: STAGING}],
                    },
                ],
                drifts: [{class: 'stale-pr-number', task_id: 't1', recorded_pr_number: 999, detail: 'x'}],
            })
        )
        expect(plan.rebind).toEqual([{task_id: 't1', pr_number: 101}])
        expect(plan.clear).toEqual([])
    })

    it('stale-pr-number with no/ambiguous OPEN PR: clear the pointer', () => {
        const run = mkRun([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 999}])
        const drift: Drift = {class: 'stale-pr-number', task_id: 't1', recorded_pr_number: 999, detail: 'x'}
        // No OPEN PR (only a MERGED, unpointed — the e2e-reopen shape → never guess done).
        const noneOpen = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 999,
                        prs: [{number: 101, state: 'MERGED', baseRefName: STAGING}],
                    },
                ],
                drifts: [drift],
            })
        )
        expect(noneOpen.clear).toEqual(['t1'])
        expect(noneOpen.rebind).toEqual([])

        // Two OPEN PRs on the head → ambiguous → clear (let the ship re-derive).
        const twoOpen = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 999,
                        prs: [
                            {number: 101, state: 'OPEN', baseRefName: STAGING},
                            {number: 102, state: 'OPEN', baseRefName: STAGING},
                        ],
                    },
                ],
                drifts: [drift],
            })
        )
        expect(twoOpen.clear).toEqual(['t1'])
        expect(twoOpen.rebind).toEqual([])
    })

    it('branch-missing: plan a plain re-push', () => {
        const run = mkRun([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't1',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 101,
                        prs: [{number: 101, state: 'OPEN', baseRefName: STAGING}],
                        branch_tip: null,
                    },
                ],
                drifts: [{class: 'branch-missing', task_id: 't1', pr_number: 101, detail: 'x'}],
            })
        )
        expect(plan.repush).toEqual([{task_id: 't1', branch: BRANCH}])
    })

    it('destructive/informational classes are surfaced, never acted on', () => {
        const run = mkRun([{task_id: 't1', status: 'reviewing', branch: BRANCH, pr_number: 101}], 'paused')
        const drifts: Drift[] = [
            {class: 'closed-unmerged', task_id: 't1', detail: 'x'},
            {class: 'pr-unrecorded', task_id: 't1', detail: 'x'},
            {class: 'staging-missing', detail: 'x'},
        ]
        const plan = planAdoptions(run, mkReport({drifts}))
        expect(plan.surfaced).toEqual(drifts)
        expect(plan.done).toEqual([])
        expect(plan.rebind).toEqual([])
        expect(plan.repush).toEqual([])
    })
})

describe('planAdoptions — reopen decision', () => {
    it('rollup-landed on a terminal merged:false run → reopen "rollup"', () => {
        const run = mkRun([{task_id: 't1', status: 'done'}], 'completed', {
            number: 900,
            merged: false,
            reason: 'auto-armed',
        })
        const plan = planAdoptions(
            run,
            mkReport({drifts: [{class: 'rollup-landed', pr_number: 900, detail: 'x'}], rollup_landed: true})
        )
        expect(plan.reopen).toBe('rollup')
    })

    it('rollup-landed on a NON-terminal run → no reopen (finalize re-enters anyway)', () => {
        const run = mkRun([{task_id: 't1', status: 'done'}], 'running', {merged: false, reason: 'no-merge'})
        const plan = planAdoptions(
            run,
            mkReport({drifts: [{class: 'rollup-landed', pr_number: 901, detail: 'x'}], rollup_landed: true})
        )
        expect(plan.reopen).toBe(false)
    })

    it('all-done: a terminal run whose done-flips leave EVERY task merged → reopen "all-done"', () => {
        const run = mkRun(
            [
                {task_id: 't1', status: 'done'},
                {task_id: 't2', status: 'shipping', branch: BRANCH, pr_number: 101},
            ],
            'failed'
        )
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't2',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 101,
                        prs: [{number: 101, state: 'MERGED', baseRefName: STAGING}],
                    },
                ],
                drifts: [{class: 'merged-unrecorded', task_id: 't2', pr_number: 101, detail: 'x'}],
            })
        )
        expect(plan.done).toEqual([{task_id: 't2', pr_number: 101}])
        expect(plan.reopen).toBe('all-done')
    })

    it('all-done withheld when failed residue remains (would loop re-finalize)', () => {
        const run = mkRun(
            [
                {task_id: 't1', status: 'done'},
                {task_id: 't2', status: 'shipping', branch: BRANCH, pr_number: 101},
                {task_id: 't3', status: 'failed'},
            ],
            'failed'
        )
        const plan = planAdoptions(
            run,
            mkReport({
                tasks: [
                    {
                        task_id: 't2',
                        branch: BRANCH,
                        recorded_status: 'shipping',
                        recorded_pr_number: 101,
                        prs: [{number: 101, state: 'MERGED', baseRefName: STAGING}],
                    },
                ],
                drifts: [{class: 'merged-unrecorded', task_id: 't2', pr_number: 101, detail: 'x'}],
            })
        )
        expect(plan.done).toEqual([{task_id: 't2', pr_number: 101}])
        expect(plan.reopen).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// applyAdoptions / adoptFromReport / adoptRun (real StateManager)
// ---------------------------------------------------------------------------

describe('applyAdoptions — executor', () => {
    let dataDir: string
    let state: StateManager

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-adopt-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        await state.create({run_id: RUN_ID, staging_branch: STAGING, spec: SPEC})
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    async function seed(seeds: readonly TaskSeed[], status?: RunStatus): Promise<void> {
        await state.update(RUN_ID, (s) => ({
            ...s,
            ...(status !== undefined
                ? {status, ...(isTerminalRunStatus(status) ? {ended_at: '2026-07-08T01:00:00.000Z'} : {})}
                : {}),
            tasks: Object.fromEntries(seeds.map((t) => [t.task_id, task(t)])),
        }))
    }

    const git = () => new FakeGitClient({localBranches: {[BRANCH]: {sha: 'localsha'}}})

    it('HEADLINE: flips a shipping task with a merged PR to done — no touch, no self_heal', async () => {
        await seed([
            {task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101, started_at: '2026-07-08T00:00:00.000Z'},
        ])
        const report = await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {done: [{task_id: 't1', pr_number: 101}], rebind: [], clear: [], repush: [], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.adopted).toEqual(['t1'])
        expect(report.changed).toBe(true)
        // toMatchObject (not toEqual): pin the load-bearing keys, tolerate additive telemetry fields.
        expect(report.actions).toMatchObject([
            {class: 'merged-unrecorded', action: 'done', task_id: 't1', pr_number: 101},
        ])

        const after = await state.read(RUN_ID)
        expect(nonNull(after.tasks.t1).status).toBe('done')
        expect(nonNull(after.tasks.t1).ended_at).toBe('2026-07-08T02:00:00.000Z')
        expect(nonNull(after.tasks.t1).pr_number).toBe(101) // PR pointer preserved
        expect(after.human_touches).toEqual([]) // adoption is not a human touch (D49)
        expect(after.self_heal).toBeUndefined() // adoptions are FREE
    })

    it('adopts a FAILED task whose PR merged — clears failure_class/failure_reason so the write validates', async () => {
        // Regression: a task that failed in ship (pr_number kept, failure_class set) whose
        // PR later merges classifies `merged-unrecorded` too. doneTaskRow MUST drop the
        // failure fields — a `done` row carrying them is rejected by the schema
        // (failure_class IFF failed), which would throw and abort the whole adoption pass.
        await seed([{task_id: 't1', status: 'failed', branch: BRANCH, pr_number: 101}])
        const before = await state.read(RUN_ID)
        expect(nonNull(before.tasks.t1).failure_class).toBeDefined() // the seed really is a failed row

        const report = await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {done: [{task_id: 't1', pr_number: 101}], rebind: [], clear: [], repush: [], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.adopted).toEqual(['t1']) // the write succeeded (did not throw)

        const after = await state.read(RUN_ID)
        expect(nonNull(after.tasks.t1).status).toBe('done')
        expect(nonNull(after.tasks.t1).failure_class).toBeUndefined()
        expect(nonNull(after.tasks.t1).failure_reason).toBeUndefined()
    })

    it('race-skips a done-flip whose recorded pointer moved off the adopted PR', async () => {
        await seed([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 202}])
        const report = await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {done: [{task_id: 't1', pr_number: 101}], rebind: [], clear: [], repush: [], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.adopted).toEqual([])
        expect(report.changed).toBe(false)
        expect(nonNull((await state.read(RUN_ID)).tasks.t1).status).toBe('shipping')
    })

    it('rebind sets the pointer; clear drops it', async () => {
        await seed([
            {task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 999},
            {task_id: 't2', status: 'shipping', branch: `${BRANCH}b`, pr_number: 888},
        ])
        await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {
                done: [],
                rebind: [{task_id: 't1', pr_number: 101}],
                clear: ['t2'],
                repush: [],
                reopen: false,
                surfaced: [],
            },
            {at: '2026-07-08T02:00:00.000Z'}
        )
        const after = await state.read(RUN_ID)
        expect(nonNull(after.tasks.t1).pr_number).toBe(101)
        expect(nonNull(after.tasks.t2).pr_number).toBeUndefined()
    })

    it('re-pushes an existing local branch with a plain push (never --force)', async () => {
        await seed([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const g = git()
        const report = await applyAdoptions(
            {state, git: g},
            RUN_ID,
            {done: [], rebind: [], clear: [], repush: [{task_id: 't1', branch: BRANCH}], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.repushed).toEqual([BRANCH])
        expect(g.calls).toContain(`push origin ${BRANCH}`)
        expect(g.calls.every((c) => !/force|(^|\s)-f(\s|$)/.test(c))).toBe(true)
    })

    it('skips + surfaces a re-push whose local branch is gone', async () => {
        await seed([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const g = new FakeGitClient() // no local branch
        const report = await applyAdoptions(
            {state, git: g},
            RUN_ID,
            {done: [], rebind: [], clear: [], repush: [{task_id: 't1', branch: BRANCH}], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.repushed).toEqual([])
        expect(g.calls.some((c) => c.startsWith('push'))).toBe(false)
        expect(report.surfaced).toHaveLength(1)
        expect(report.surfaced[0]?.class).toBe('branch-missing')
    })

    it('reopen "all-done" flips a terminal run back to running when every task lands done', async () => {
        await seed(
            [
                {task_id: 't1', status: 'done'},
                {task_id: 't2', status: 'shipping', branch: BRANCH, pr_number: 101},
            ],
            'failed'
        )
        const report = await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {
                done: [{task_id: 't2', pr_number: 101}],
                rebind: [],
                clear: [],
                repush: [],
                reopen: 'all-done',
                surfaced: [],
            },
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.reopened).toBe('all-done')
        const after = await state.read(RUN_ID)
        expect(after.status).toBe('running')
        expect(after.ended_at).toBeNull()
        expect(after.human_touches).toEqual([])
    })

    it('clears terminal_reason when reopening a REAL finalized-failed run (schema forbids running+reason)', async () => {
        await seed([
            {task_id: 't1', status: 'done'},
            {task_id: 't2', status: 'shipping', branch: BRANCH, pr_number: 101},
        ])
        await state.finalize(RUN_ID, 'failed', 'drop condemned the run')

        const report = await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {
                done: [{task_id: 't2', pr_number: 101}],
                rebind: [],
                clear: [],
                repush: [],
                reopen: 'all-done',
                surfaced: [],
            },
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect(report.reopened).toBe('all-done')

        const after = await state.read(RUN_ID)
        expect(after.status).toBe('running')
        expect(after.ended_at).toBeNull()
        expect(after).not.toHaveProperty('terminal_reason')
    })

    it('adoptFromReport plans + applies from an already-computed report (no re-probe)', async () => {
        await seed([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const run = await state.read(RUN_ID)
        const report = mkReport({
            tasks: [
                {
                    task_id: 't1',
                    branch: BRANCH,
                    recorded_status: 'shipping',
                    recorded_pr_number: 101,
                    prs: [{number: 101, state: 'MERGED', baseRefName: STAGING}],
                },
            ],
            drifts: [{class: 'merged-unrecorded', task_id: 't1', pr_number: 101, detail: 'x'}],
        })
        const out = await adoptFromReport({state, git: git()}, run, report, {at: '2026-07-08T02:00:00.000Z'})
        expect(out.adopted).toEqual(['t1'])
        expect(nonNull((await state.read(RUN_ID)).tasks.t1).status).toBe('done')
    })

    it('does not touch state (or updated_at) when the plan is repush-only', async () => {
        await seed([{task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101}])
        const before = (await state.read(RUN_ID)).updated_at
        await applyAdoptions(
            {state, git: git()},
            RUN_ID,
            {done: [], rebind: [], clear: [], repush: [{task_id: 't1', branch: BRANCH}], reopen: false, surfaced: []},
            {at: '2026-07-08T02:00:00.000Z'}
        )
        expect((await state.read(RUN_ID)).updated_at).toBe(before)
    })
})

describe('adoptRun — reconcile + plan + apply', () => {
    let dataDir: string
    let state: StateManager

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-adopt-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        await state.create({run_id: RUN_ID, staging_branch: STAGING, spec: SPEC})
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('adopts a merged-unrecorded shipping task end-to-end', async () => {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {t1: task({task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101})},
        }))
        const run = await state.read(RUN_ID)
        const gh = new FakeGhClient()
        gh.remoteBranches.add(STAGING)
        gh.setPr({number: 101, headRefName: BRANCH, baseRefName: STAGING, state: 'MERGED'})

        const report = await adoptRun({state, git: new FakeGitClient(), gh}, run, {at: '2026-07-08T02:00:00.000Z'})
        expect(report.adopted).toEqual(['t1'])
        expect(nonNull((await state.read(RUN_ID)).tasks.t1).status).toBe('done')
    })

    it('is all-or-nothing: a gh outage rejects (each caller owns its outage policy)', async () => {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {t1: task({task_id: 't1', status: 'shipping', branch: BRANCH, pr_number: 101})},
        }))
        const run = await state.read(RUN_ID)
        const gh = new FakeGhClient({truncate: true})
        gh.remoteBranches.add(STAGING)
        await expect(
            adoptRun({state, git: new FakeGitClient(), gh}, run, {at: '2026-07-08T02:00:00.000Z'})
        ).rejects.toThrow(/TRUNCATED/)
    })
})

describe('adoptFromReport / summarizeAdoption', () => {
    it('summarizeAdoption renders a compact one-liner', () => {
        expect(
            summarizeAdoption({
                actions: [
                    {class: 'merged-unrecorded', action: 'done', task_id: 't1'},
                    {class: 'stale-pr-number', action: 'rebind', task_id: 't2'},
                    {class: 'branch-missing', action: 'repush', task_id: 't3'},
                ],
                adopted: ['t1'],
                repushed: [BRANCH],
                reopened: 'rollup',
                surfaced: [{class: 'closed-unmerged', detail: 'x'}],
                changed: true,
            })
        ).toBe('1 adopted done, 1 pr rebound, 1 branch re-pushed, reopened (rollup), 1 surfaced')
        expect(
            summarizeAdoption({actions: [], adopted: [], repushed: [], reopened: false, surfaced: [], changed: false})
        ).toBe('no adoptions')
    })
})
