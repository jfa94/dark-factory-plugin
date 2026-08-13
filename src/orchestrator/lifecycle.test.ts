/**
 * Run lifecycle (./lifecycle.ts), tested DIRECTLY — no CLI wrapper:
 *   1. the pure {@link seedTasksFromSpec} mapping (spec task → pending TaskState),
 *      including the LOUD integrity checks (dangling / self / cyclic / duplicate dep);
 *   2. {@link createRun} (resolve a durable spec → create → seed);
 *   3. {@link resolveOrCreateRun} (discriminated created/exists/superseded/pause
 *      result, Decision 35) incl. staging provision/teardown ordering + the 7d
 *      quota gate;
 *   4. {@link applyResume} (re-check quota → clear checkpoint or stay blocked),
 * all against a real StateManager + SpecStore temp dir with injected fakes.
 * The `factory run <action>` CLI boundary OVER these (exit codes, stdout
 * envelopes, flag guards, preconditions) lives in src/cli/subcommands/run.test.ts.
 */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'

import {
    seedTasksFromSpec,
    createRun,
    resolveOrCreateRun,
    applyResume,
    type ResumeResult,
    type SpecSelector,
    type CreateRunOptions,
} from './lifecycle.js'
import {nonNull} from '../shared/index.js'
import {StateManager} from '../core/state/manager.js'
import {SpecStore} from '../spec/index.js'
import {makeSpec, makePrd} from './orchestrator-fixtures.js'
import {specDir, runsRoot, runStatePath} from '../core/state/paths.js'
import {atomicWriteFile} from '../shared/atomic-write.js'
import {FakeGitClient, FakeGhClient} from '../git/index.js'
import {defaultConfig} from '../config/schema.js'
import {FIVE_HOUR_WINDOW_SECONDS, SEVEN_DAY_WINDOW_SECONDS, type UsageReading} from '../quota/index.js'
import {makeTempDataDir, seedRun} from '../cli/test-fixtures.js'
import {appendLedgerEntries} from '../spec/ledger.js'

const REPO = 'acme/widgets'

// ---------------------------------------------------------------------------
// SpecSelector — type-level XOR (compile-time, validated by `npm run typecheck`)
// ---------------------------------------------------------------------------
// These assertions FAIL THE BUILD if the XOR regresses to two bare optionals:
// the @ts-expect-error lines would stop erroring (TS6133 "unused") and tsc fails.
const _selIssue: SpecSelector = {issue: 1}
const _selSpec: SpecSelector = {specId: 'x'}
// @ts-expect-error — BOTH keys is an illegal state, must not type-check
const _selBoth: SpecSelector = {issue: 1, specId: 'x'}
// @ts-expect-error — NEITHER key is an illegal state, must not type-check
const _selNeither: SpecSelector = {}
void _selIssue
void _selSpec
void _selBoth
void _selNeither

// ---------------------------------------------------------------------------
// RunIntent — type-level XOR (compile-time, validated by `npm run typecheck`)
// ---------------------------------------------------------------------------
// Illegal flag combinations (force+supersede, supersede+resume, …) are now
// UN-REPRESENTABLE: each is exactly one `intent`. The @ts-expect-error guards the
// closed literal set — a typo'd intent must not type-check.
const _intentDefault: CreateRunOptions = {repo: REPO, runId: 'r', issue: 1} // intent omitted = default
const _intentFresh: CreateRunOptions = {repo: REPO, runId: 'r', issue: 1, intent: 'fresh'}
const _intentSupersede: CreateRunOptions = {
    repo: REPO,
    runId: 'r',
    issue: 1,
    intent: 'supersede',
}
const _intentResume: CreateRunOptions = {repo: REPO, runId: 'r', issue: 1, intent: 'resume'}
// @ts-expect-error — an unknown intent is an illegal state, must not type-check
const _intentBogus: CreateRunOptions = {repo: REPO, runId: 'r', issue: 1, intent: 'nope'}
void _intentDefault
void _intentFresh
void _intentSupersede
void _intentResume
void _intentBogus

// ---------------------------------------------------------------------------
// seedTasksFromSpec (pure)
// ---------------------------------------------------------------------------

describe('seedTasksFromSpec', () => {
    it('maps each spec task to a pending TaskState carrying only the dial + deps', () => {
        const seeded = seedTasksFromSpec(
            makeSpec([
                {task_id: 't1', risk_tier: 'low'},
                {task_id: 't2', depends_on: ['t1'], risk_tier: 'medium', tdd_exempt: true},
                {task_id: 't3', depends_on: ['t1', 't2'], risk_tier: 'high'},
            ])
        )

        expect(Object.keys(seeded).sort()).toEqual(['t1', 't2', 't3'])
        expect(seeded.t1).toEqual({
            task_id: 't1',
            status: 'pending',
            depends_on: [],
            escalation_rung: 0,
            reviewers: [],
            merge_resyncs: 0,
        })
        expect(nonNull(seeded.t2).depends_on).toEqual(['t1'])
        expect(nonNull(seeded.t3).depends_on).toEqual(['t1', 't2'])
    })

    it('does NOT carry tdd_exempt into run state (it is read from the spec at runtime)', () => {
        const seeded = seedTasksFromSpec(makeSpec([{task_id: 't1', tdd_exempt: true}]))
        expect('tdd_exempt' in nonNull(seeded.t1)).toBe(false)
    })

    it('is LOUD on a dangling dependency', () => {
        expect(() => seedTasksFromSpec(makeSpec([{task_id: 't1', depends_on: ['ghost']}]))).toThrow(
            /unknown task 'ghost'/
        )
    })

    it('is LOUD on a self dependency', () => {
        expect(() => seedTasksFromSpec(makeSpec([{task_id: 't1', depends_on: ['t1']}]))).toThrow(/depends on itself/)
    })

    it('is LOUD on a dependency cycle', () => {
        expect(() =>
            seedTasksFromSpec(
                makeSpec([
                    {task_id: 't1', depends_on: ['t2']},
                    {task_id: 't2', depends_on: ['t1']},
                ])
            )
        ).toThrow(/dependency cycle/)
    })

    it('is LOUD on a duplicate task id', () => {
        expect(() => seedTasksFromSpec(makeSpec([{task_id: 't1'}, {task_id: 't1'}]))).toThrow(/duplicate task id 't1'/)
    })
})

// ---------------------------------------------------------------------------
// createRun + applyResume (real StateManager + SpecStore temp dir)
// ---------------------------------------------------------------------------

describe('createRun', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-run-create-')
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(makeSpec([{task_id: 't1'}, {task_id: 't2', depends_on: ['t1']}]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('resolves the spec by issue, creates the run, and seeds its tasks', async () => {
        const run = await createRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-a',
        })

        expect(run.run_id).toBe('run-a')
        expect(run.status).toBe('running')
        // No --orchestrator flag exists: v1 hardcodes the sequential execution_mode.
        expect(run.execution_mode).toBe('sequential')
        expect(run.spec).toEqual({repo: REPO, spec_id: '42-checkout', issue_number: 42})
        expect(Object.keys(run.tasks).sort()).toEqual(['t1', 't2'])
        expect(nonNull(run.tasks.t1).status).toBe('pending')
        expect(nonNull(run.tasks.t2).depends_on).toEqual(['t1'])

        // The seeded run is the current run and round-trips through a fresh read.
        expect(nonNull((await state.read('run-a')).tasks.t2).depends_on).toEqual(['t1'])
        expect(nonNull(await state.readCurrentForRepo(REPO)).run_id).toBe('run-a')
    })

    it('pins the per-run staging branch on the run row (Decision 33 hardening)', async () => {
        const run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-pin'})
        // Stored ONCE at create so every later base-ref resolution reads the branch the
        // run actually cut — never a value recomputed by runStagingBranch(run_id).
        expect(run.staging_branch).toBe('staging-run-pin')
        expect((await state.read('run-pin')).staging_branch).toBe('staging-run-pin')
    })

    it('resolves the spec by explicit spec-id and hardcodes the sequential execution_mode', async () => {
        const run = await createRun(state, store, {
            repo: REPO,
            specId: '42-checkout',
            runId: 'run-b',
        })
        expect(run.execution_mode).toBe('sequential')
        expect(Object.keys(run.tasks).sort()).toEqual(['t1', 't2'])
    })

    it('is LOUD when no spec exists for the issue', async () => {
        await expect(createRun(state, store, {repo: REPO, issue: 999, runId: 'run-c'})).rejects.toThrow(
            /no spec for issue #999/
        )
    })

    it('stamps owner_session when given (session-ownership) and leaves it undefined otherwise', async () => {
        const owned = await createRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-own',
            ownerSession: 'sess-owner-1',
        })
        expect(owned.owner_session).toBe('sess-owner-1')
        // Persisted (resume-safe): round-trips through a fresh read.
        expect((await state.read('run-own')).owner_session).toBe('sess-owner-1')

        const anon = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-anon'})
        expect(anon.owner_session).toBeUndefined()
        expect((await state.read('run-anon')).owner_session).toBeUndefined()
    })

    it('persists ship_mode (default live; explicit no-merge round-trips) so the runner reads it back', async () => {
        const dflt = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-sm0'})
        expect(dflt.ship_mode).toBe('live')
        expect((await state.read('run-sm0')).ship_mode).toBe('live')

        const noMerge = await createRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-sm1',
            shipMode: 'no-merge',
        })
        expect(noMerge.ship_mode).toBe('no-merge')
        // Resume-safe: the persisted value survives a fresh read (the runner's source of truth).
        expect((await state.read('run-sm1')).ship_mode).toBe('no-merge')
    })

    it('createRun({debug:true}) → fresh run is born with debug:true (Task 6 persistence guard — no CLI flag; only the debug driver passes this)', async () => {
        const run = await createRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-debug',
            debug: true,
        })
        expect(run.debug).toBe(true)
        expect((await state.read('run-debug')).debug).toBe(true)
    })

    it('createRun() with no debug option → run defaults to debug:false', async () => {
        const run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-nodebug'})
        expect(run.debug).toBe(false)
    })

    it('stamps the launch human touch at create (S11 — every run costs one touch)', async () => {
        const run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-touch'})
        expect(run.human_touches).toEqual([{kind: 'launch', at: run.started_at}])
        // Persisted: round-trips through a fresh read.
        expect((await state.read('run-touch')).human_touches).toEqual([{kind: 'launch', at: run.started_at}])
    })

    it('INCIDENT 2026-07-07 (D57): v2 state behind the per-repo pointer → create succeeds whole', async () => {
        // Plant the exact wreckage: an old-schema run dir named by current/<repo-key>.
        await mkdir(join(runsRoot(dataDir), 'run-old'), {recursive: true})
        await atomicWriteFile(runStatePath(dataDir, 'run-old'), JSON.stringify({schema_version: 2, run_id: 'run-old'}))
        await mkdir(join(dataDir, 'current'), {recursive: true})
        await symlink(join('..', 'runs', 'run-old'), join(dataDir, 'current', 'acme-widgets'))

        const warns: string[] = []
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            warns.push(String(chunk))
            return true
        })
        let run
        try {
            run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        } finally {
            spy.mockRestore()
        }
        expect(warns.some((w) => w.includes('unparseable'))).toBe(true)
        // Born whole: tasks + launch touch present, pointer repointed.
        expect(Object.keys(run.tasks).sort()).toEqual(['t1', 't2'])
        expect(run.human_touches).toEqual([{kind: 'launch', at: run.started_at}])
        expect(nonNull(await state.readCurrentForRepo(REPO)).run_id).toBe('run-new')
    })

    it('is provably single-write: zero state.update() calls during creation (D57)', async () => {
        const update = state.update.bind(state)
        let updates = 0
        state.update = (...args: Parameters<typeof update>) => {
            updates++
            return update(...args)
        }

        const run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-1w'})
        expect(updates).toBe(0)
        // Everything the retired follow-up update() used to seed is already there.
        expect(Object.keys(run.tasks).sort()).toEqual(['t1', 't2'])
        expect(run.human_touches).toEqual([{kind: 'launch', at: run.started_at}])
    })

    it('Δ S9 preflight: refuses to create a run on a spec with no durable PRD snapshot', async () => {
        // Fabricate a pre-S9 spec dir: written normally, snapshot removed.
        await rm(join(specDir(dataDir, REPO, '42-checkout'), 'prd.json'))
        await expect(createRun(state, store, {repo: REPO, specId: '42-checkout', runId: 'run-pre-s9'})).rejects.toThrow(
            /has no PRD snapshot.*--supersede/s
        )
        // Nothing was created — the refusal is pre-run (no paid-run-then-fail).
        await expect(state.read('run-pre-s9')).rejects.toThrow()
    })
})

describe('run create — ledger-aware seeding (Decision 70)', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore
    const TIP = 'f'.repeat(40)
    const STRAY = 'b'.repeat(40)

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-ledger-seed-')
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(makeSpec([{task_id: 't1'}, {task_id: 't2', depends_on: ['t1']}]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    function stagingDepsWith(git: FakeGitClient) {
        return {
            gitClient: git,
            ghClient: new FakeGhClient(),
            config: defaultConfig(),
            targetRoot: '/target',
            orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-led',
            owner: 'acme',
            repo: 'widgets',
        }
    }

    it('seeds a task done when every ledger SHA is an ancestor of the fresh staging tip', async () => {
        await appendLedgerEntries(dataDir, REPO, '42-checkout', [
            {
                task_id: 't1',
                run_id: 'run-prev',
                pr_number: 11,
                shas: [TIP],
                verified_at: '2026-07-01T00:00:00.000Z',
                source: 'shipped',
            },
        ])
        // The ledger SHA IS the staging tip → trivially an ancestor (fake merge-base convention).
        const git = new FakeGitClient({remoteHeads: {develop: TIP}, localBranches: {[TIP]: {sha: TIP}}})

        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-led', intent: 'fresh'},
            stagingDepsWith(git)
        )

        if (!('run' in r)) {
            throw new Error('expected a created run')
        }
        expect(nonNull(r.run.tasks.t1).status).toBe('done')
        expect(nonNull(r.run.tasks.t1).ended_at).toBeDefined()
        // t2 has no ledger entry — untouched, and its dep edge on t1 is now satisfied.
        expect(nonNull(r.run.tasks.t2).status).toBe('pending')
    })

    it('leaves the task pending when a ledger SHA is NOT an ancestor of the staging tip', async () => {
        await appendLedgerEntries(dataDir, REPO, '42-checkout', [
            {
                task_id: 't1',
                run_id: 'run-prev',
                shas: [STRAY],
                verified_at: '2026-07-01T00:00:00.000Z',
                source: 'already-satisfied',
            },
        ])
        // STRAY is unknown to the fake → rev-parse rejects → not an ancestor.
        const git = new FakeGitClient({remoteHeads: {develop: TIP}, localBranches: {[TIP]: {sha: TIP}}})

        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-led2', intent: 'fresh'},
            stagingDepsWith(git)
        )

        if (!('run' in r)) {
            throw new Error('expected a created run')
        }
        expect(nonNull(r.run.tasks.t1).status).toBe('pending')
    })

    it('bare createRun (no staging deps) ignores the ledger — seeding is staging-gated', async () => {
        await appendLedgerEntries(dataDir, REPO, '42-checkout', [
            {
                task_id: 't1',
                run_id: 'run-prev',
                shas: [TIP],
                verified_at: '2026-07-01T00:00:00.000Z',
                source: 'shipped',
            },
        ])

        const run = await createRun(state, store, {repo: REPO, issue: 42, runId: 'run-led3'})

        expect(nonNull(run.tasks.t1).status).toBe('pending')
    })
})

describe('resolveOrCreateRun (discriminated result, Decision 35)', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-run-reuse-')
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(makeSpec([{task_id: 't1'}, {task_id: 't2', depends_on: ['t1']}]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    // -------------------------------------------------------------------------
    // kind: "created" — no active run exists
    // -------------------------------------------------------------------------

    it("no active run → kind:'created' (fresh run)", async () => {
        const first = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'})
        expect(first.kind).toBe('created')
        if (first.kind !== 'created') {
            throw new Error('narrowing')
        }
        expect(first.run.run_id).toBe('run-a')
    })

    it("force creates a fresh run even when one is active (kind:'created')", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'})
        const forced = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
            intent: 'fresh',
        })
        expect(forced.kind).toBe('created')
        if (forced.kind !== 'created') {
            throw new Error('narrowing')
        }
        expect(forced.run.run_id).toBe('run-b')
        expect((await state.listRuns()).map((r) => r.run_id).sort()).toEqual(['run-a', 'run-b'])
    })

    it("creates a new run when the only matching run is terminal (kind:'created')", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'})
        await state.finalize('run-a', 'completed')
        const next = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-b'})
        expect(next.kind).toBe('created')
        if (next.kind !== 'created') {
            throw new Error('narrowing')
        }
        expect(next.run.run_id).toBe('run-b')
    })

    // -------------------------------------------------------------------------
    // kind: "exists" — active run exists, no flag given (Decision 35: fail loud
    // at the runCreate boundary; resolveOrCreateRun itself just reports the fact)
    // -------------------------------------------------------------------------

    it("active run + no flag → kind:'exists' (no silent reuse, no orphan)", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'})

        // A second create (different generated id) returns the SAME live run as "exists".
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
        })
        expect(second.kind).toBe('exists')
        if (second.kind !== 'exists') {
            throw new Error('narrowing')
        }
        expect(second.existing.run_id).toBe('run-a')

        // No orphan: only the original run exists in the store.
        expect((await state.listRuns()).map((r) => r.run_id)).toEqual(['run-a'])
    })

    it("active run + no flag → kind:'exists' resolves by explicit spec-id too", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, specId: '42-checkout', runId: 'run-a'})
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            specId: '42-checkout',
            runId: 'run-b',
        })
        expect(second.kind).toBe('exists')
        if (second.kind !== 'exists') {
            throw new Error('narrowing')
        }
        expect(second.existing.run_id).toBe('run-a')
    })

    it("active run + no flag → kind:'exists' even when intent fields are omitted (direct-API path)", async () => {
        await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-a',
            shipMode: 'live',
        })
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
        })
        expect(second.kind).toBe('exists')
        if (second.kind !== 'exists') {
            throw new Error('narrowing')
        }
        expect(second.existing.run_id).toBe('run-a')
        expect(second.existing.ship_mode).toBe('live')
    })

    it("active run + no flag → kind:'exists' even when re-passed ship MATCHES", async () => {
        await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-a',
            shipMode: 'live',
        })
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
            shipMode: 'live',
        })
        expect(second.kind).toBe('exists')
        if (second.kind !== 'exists') {
            throw new Error('narrowing')
        }
        expect(second.existing.run_id).toBe('run-a')
    })

    it("active run + no flag → kind:'exists' even when re-passed ship intent diverges (no guard without --resume)", async () => {
        // Decision 35: resolveOrCreateRun no longer asserts flag compatibility on the
        // plain "no flag" path — it just reports kind:"exists". The assertReusableFlags
        // guard only fires on the --resume path (Task 4.2).
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'})
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
            shipMode: 'no-merge',
        })
        expect(second.kind).toBe('exists')
        // No orphan minted.
        expect((await state.listRuns()).map((r) => r.run_id)).toEqual(['run-a'])
    })

    it("--resume with divergent ship intent → kind:'exists' (no premature guard; resume continues the live run)", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'}) // ship_mode=live
        const second = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-b',
            intent: 'resume',
            shipMode: 'no-merge',
        })
        expect(second.kind).toBe('exists')
        // No orphan: the live run is reported, not replaced.
        expect((await state.listRuns()).map((r) => r.run_id)).toEqual(['run-a'])
    })

    // -------------------------------------------------------------------------
    // kind: "superseded" — --supersede clears the old run and creates fresh
    // -------------------------------------------------------------------------

    it("--supersede → kind:'superseded'; old run marked superseded; its branch deleted", async () => {
        // Seed an active run first (bare state — no staging deps needed for the seed).
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const stagingDeps = {
            gitClient: git,
            ghClient: gh,
            config: defaultConfig(),
            targetRoot: '/target',
            orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
            owner: 'acme',
            repo: 'widgets',
        }

        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
            stagingDeps
        )

        expect(r.kind).toBe('superseded')
        if (r.kind !== 'superseded') {
            throw new Error('narrowing')
        }
        expect(r.supersededId).toBe('run-old')
        expect(r.run.run_id).toBe('run-new')

        // Old run is finalized as superseded.
        expect((await state.read('run-old')).status).toBe('superseded')
        // Branch was deleted via gh fake (field: deletedBranches).
        expect(gh.deletedBranches).toContain('staging-run-old')
        // Protection was torn down too — load-bearing: GitHub blocks deleting a protected
        // ref, so deleteProtection MUST run before the branch delete. Assert on the SINGLE
        // ordered `calls` log (cross-array indexOf would be a 0<=0 tautology).
        expect(gh.protectionDeletes).toContain('staging-run-old')
        expect(gh.calls.indexOf('api DELETE protection staging-run-old')).toBeLessThan(
            gh.calls.indexOf('api DELETE refs/heads/staging-run-old')
        )
    })

    it('D2: fresh create materialises staging ONLY in the orchestrator worktree (primary HEAD untouched)', async () => {
        // The user's primary checkout sits on develop; a run create must NEVER check the
        // per-run staging branch out here (that parked the main dir on staging and later
        // phase-merge checkouts collided: `already used by worktree`). Staging goes in the
        // orchestrator worktree instead.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}, currentBranch: 'develop'})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const orchestratorWorktreePath = '/target/.claude/worktrees/orchestrator-run-new'
        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new'},
            {
                gitClient: git,
                ghClient: new FakeGhClient(),
                config: defaultConfig(),
                targetRoot: '/target',
                orchestratorWorktreePath,
                owner: 'acme',
                repo: 'widgets',
            }
        )
        expect(r.kind).toBe('created')
        // staging-run-new is checked out in the orchestrator worktree...
        expect(git.worktrees.get(orchestratorWorktreePath)).toBe('staging-run-new')
        // ...and the primary checkout's HEAD never moved off develop (no `checkout -B` on it).
        expect(await git.currentBranch()).toBe('develop')
        expect(git.calls.some((c) => c.startsWith('checkout -B'))).toBe(false)
    })

    it('fresh intent with a colliding run-id throws BEFORE mutating staging (no ensureStaging/provisionProtection)', async () => {
        // Regression (Codex): the fresh path (explicit --run-id) skips the active-run scan,
        // so a run-id colliding with a live run used to fast-forward/push + re-provision THAT
        // run's staging branch via ensureStaging/provisionProtection, only to be rejected
        // afterward by state.create. The early state.exists guard fast-fails before any git/gh.
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-dup'})

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        await expect(
            resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-dup', intent: 'fresh'},
                {
                    gitClient: git,
                    ghClient: gh,
                    config: defaultConfig(),
                    targetRoot: '/target',
                    orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-dup',
                    owner: 'acme',
                    repo: 'widgets',
                }
            )
        ).rejects.toThrow(/already exists/)

        // Guard threw before ensureStaging/provisionProtection touched the colliding branch.
        expect(git.calls).toHaveLength(0)
        expect(gh.calls).toHaveLength(0)
    })

    it('A3: a staging-provision failure persists NO run row — the retry creates fresh, not `exists`', async () => {
        // Regression: createRunFromManifest used to persist the run row (state.create +
        // update) BEFORE cutting+protecting staging. A provision throw (401/403/5xx/network)
        // then stranded a `running` row over missing staging — and neither resume nor the
        // task loop re-provisions — so the next `run create` returned `exists` and never
        // retried setup. The reorder provisions FIRST, persists LAST: a provision failure
        // writes nothing, so the retry is a clean fresh create.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        // Fail the first git op inside ensureStaging (fetch base) → provisioning throws.
        git.fetch = () => Promise.reject(new Error('boom: HTTP 500 fetching origin/develop'))

        await expect(
            resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-a'},
                {
                    gitClient: git,
                    ghClient: new FakeGhClient(),
                    config: defaultConfig(),
                    targetRoot: '/target',
                    orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-a',
                    owner: 'acme',
                    repo: 'widgets',
                }
            )
        ).rejects.toThrow(/boom/)

        // No stranded active run — the row was never persisted.
        expect(await state.findActiveByIssue(REPO, 42)).toBeNull()

        // The retry (healthy deps) creates fresh — NOT `exists` (which the strand would force).
        const healthy = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        healthy.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const retry = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-a'},
            {
                gitClient: healthy,
                ghClient: new FakeGhClient(),
                config: defaultConfig(),
                targetRoot: '/target',
                orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-a',
                owner: 'acme',
                repo: 'widgets',
            }
        )
        expect(retry.kind).toBe('created')
    })

    describe('D74 — run-scoped develop protection lifecycle', () => {
        const makeStagingDeps = (gh: FakeGhClient, config = defaultConfig()) => {
            const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
            git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
            return {
                gitClient: git,
                ghClient: gh,
                config,
                targetRoot: '/target',
                orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-a',
                owner: 'acme',
                repo: 'widgets',
            }
        }

        it('create ESCALATES develop to the strict run profile, after the staging provision', async () => {
            const gh = new FakeGhClient()
            const r = await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-a'},
                makeStagingDeps(gh)
            )
            expect(r.kind).toBe('created')
            const develop = gh.protectionPuts.filter((p) => p.branch === 'develop')
            expect(develop).toEqual([
                {
                    branch: 'develop',
                    body: {requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan'], strict: true},
                },
            ])
            // Ordering: the staging cut+protect lands first, then the develop escalation.
            expect(gh.calls.indexOf('api PUT protection staging-run-a')).toBeLessThan(
                gh.calls.indexOf('api PUT protection develop')
            )
        })

        it('create merges the gate contract extras (requiredChecks + requireMutationAtRest) into the profiles', async () => {
            // A real target root with a committed gates.json carrying extras.
            const root = await mkdtemp(join(tmpdir(), 'lifecycle-extras-'))
            await mkdir(join(root, '.factory'), {recursive: true})
            await writeFile(
                join(root, '.factory/gates.json'),
                JSON.stringify({
                    version: 1,
                    stack: 'npm',
                    requiredChecks: ['pgTAP'],
                    requireMutationAtRest: true,
                    gates: {
                        test: {contracted: true},
                        tdd: {contracted: true},
                        coverage: {contracted: false, reason: 'x'},
                        mutation: {contracted: true},
                        sast: {contracted: false, reason: 'x'},
                        type: {contracted: true},
                        lint: {contracted: true},
                        build: {contracted: true},
                    },
                }),
                'utf8'
            )
            const gh = new FakeGhClient()
            const deps = {...makeStagingDeps(gh), targetRoot: root}
            // Escalate (create) → run profile ∪ extras.
            const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-x'}, deps)
            expect(r.kind).toBe('created')
            expect(gh.protectionPuts.filter((p) => p.branch === 'develop').map((p) => p.body)).toEqual([
                {requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan', 'pgTAP'], strict: true},
            ])
            // Supersede teardown → baseline ∪ extras (+ mutation at rest).
            const gh2 = new FakeGhClient()
            const r2 = await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-y', intent: 'supersede'},
                {...makeStagingDeps(gh2), targetRoot: root}
            )
            expect(r2.kind).toBe('superseded')
            expect(gh2.protectionPuts.filter((p) => p.branch === 'develop').map((p) => p.body)[0]).toEqual({
                requiredStatusChecks: ['Quality', 'Security Scan', 'pgTAP', 'Mutation Testing'],
                strict: false,
                enforceAdmins: false,
            })
        })

        it('permanent mode: create never touches develop protection', async () => {
            const gh = new FakeGhClient()
            const config = defaultConfig()
            const r = await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-a'},
                makeStagingDeps(gh, {...config, git: {...config.git, developProtection: 'permanent'}})
            )
            expect(r.kind).toBe('created')
            expect(gh.protectionPuts.some((p) => p.branch === 'develop')).toBe(false)
        })

        it('a develop-escalation failure persists NO run row — the retry creates fresh (A3 contract)', async () => {
            const gh = new FakeGhClient()
            gh.failPutProtectionFor = 'develop' // staging PUT succeeds, develop PUT throws
            await expect(
                resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-a'}, makeStagingDeps(gh))
            ).rejects.toThrow(/simulated putProtection failure/)
            expect(await state.findActiveByIssue(REPO, 42)).toBeNull()

            const retry = await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-a'},
                makeStagingDeps(new FakeGhClient())
            )
            expect(retry.kind).toBe('created')
        })

        it('--supersede DE-ESCALATES develop to baseline after the branch delete, then the create re-escalates', async () => {
            await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
            const gh = new FakeGhClient()
            const r = await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
                makeStagingDeps(gh)
            )
            expect(r.kind).toBe('superseded')
            const develop = gh.protectionPuts.filter((p) => p.branch === 'develop')
            // Baseline first (the supersede teardown), then the fresh run's escalation.
            expect(develop.map((p) => p.body)).toEqual([
                {requiredStatusChecks: ['Quality', 'Security Scan'], strict: false, enforceAdmins: false},
                {requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan'], strict: true},
            ])
            // The baseline PUT lands only after the old branch is gone (auto-merge disarm order).
            expect(gh.calls.indexOf('api DELETE refs/heads/staging-run-old')).toBeLessThan(
                gh.calls.indexOf('api PUT protection develop')
            )
            // The final state is the escalated run profile (run-new is live).
            expect(gh.protection.get('develop')?.strictUpToDate).toBe(true)
        })

        it('--supersede SKIPS the de-escalation while a sibling run (same repo, other issue) is active', async () => {
            await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
            await state.create({
                run_id: 'run-sibling',
                staging_branch: 'staging-run-sibling',
                spec: {repo: REPO, spec_id: '7-search', issue_number: 7},
            })
            const gh = new FakeGhClient()
            await resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
                makeStagingDeps(gh)
            )
            const develop = gh.protectionPuts.filter((p) => p.branch === 'develop')
            // ONLY the fresh run's escalation — no baseline dip that would strip the sibling.
            expect(develop.map((p) => p.body)).toEqual([
                {requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan'], strict: true},
            ])
        })
    })

    it('--supersede stamps launch + conflict touches on the FRESH run (S11)', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
            {
                gitClient: git,
                ghClient: new FakeGhClient(),
                config: defaultConfig(),
                targetRoot: '/target',
                orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
                owner: 'acme',
                repo: 'widgets',
            }
        )
        if (r.kind !== 'superseded') {
            throw new Error('narrowing')
        }
        expect(r.run.human_touches.map((t) => t.kind)).toEqual(['launch', 'conflict'])
        // The OLD run's ledger is untouched (launch only).
        expect((await state.read('run-old')).human_touches.map((t) => t.kind)).toEqual(['launch'])
    })

    it("--supersede tears down the OLD run's PINNED branch, not a recompute (revert guard)", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        // Desync the pin from runStagingBranch("run-old") (= "staging-run-old") — exactly the
        // mid-run rename Decision 33 defends against. A revert of supersedeRun to the recompute
        // would delete "staging-run-old" and orphan the branch the run actually cut.
        const legacyBranch = 'staging-LEGACY-run-old'
        await state.update('run-old', (s) => ({...s, staging_branch: legacyBranch}))

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const stagingDeps = {
            gitClient: git,
            ghClient: gh,
            config: defaultConfig(),
            targetRoot: '/target',
            orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
            owner: 'acme',
            repo: 'widgets',
        }

        await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
            stagingDeps
        )

        // Teardown targeted the PINNED legacy branch, NOT the "staging-run-old" recompute.
        expect(gh.protectionDeletes).toContain(legacyBranch)
        expect(gh.deletedBranches).toContain(legacyBranch)
        expect(gh.deletedBranches).not.toContain('staging-run-old')
        // Protection first, then branch (GitHub blocks deleting a protected ref) — assert on
        // the single ordered `calls` log, not a cross-array tautology.
        expect(gh.calls.indexOf(`api DELETE protection ${legacyBranch}`)).toBeLessThan(
            gh.calls.indexOf(`api DELETE refs/heads/${legacyBranch}`)
        )
    })

    it('--supersede teardown failure leaves the old run ACTIVE (terminal write is LAST) — no fresh run', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        gh.failDeleteProtection = new Error('HTTP 403: Resource not accessible by integration')
        const stagingDeps = {
            gitClient: git,
            ghClient: gh,
            config: defaultConfig(),
            targetRoot: '/target',
            orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
            owner: 'acme',
            repo: 'widgets',
        }

        await expect(
            resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
                stagingDeps
            )
        ).rejects.toThrow(/403/)

        // finalize runs LAST, so a teardown throw never reached it → the old run is still
        // non-terminal and fully recoverable (a re-run resolves it and retries the teardown).
        expect((await state.read('run-old')).status).toBe('running')
        // The fresh run was never created (the abort happened before createRunFromManifest).
        expect((await state.listRuns()).map((r) => r.run_id)).not.toContain('run-new')
        // Protection threw FIRST → the branch delete never ran (no half-torn-down state).
        expect(gh.deletedBranches).not.toContain('staging-run-old')
    })

    it('--supersede retries idempotently after a transient teardown failure — no orphaned branch', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        gh.failDeleteProtection = new Error('HTTP 500: server error')
        const stagingDeps = {
            gitClient: git,
            ghClient: gh,
            config: defaultConfig(),
            targetRoot: '/target',
            orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
            owner: 'acme',
            repo: 'widgets',
        }

        // First attempt fails mid-teardown; the old run stays active (the recoverable state).
        await expect(
            resolveOrCreateRun(
                state,
                store,
                {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
                stagingDeps
            )
        ).rejects.toThrow(/500/)
        expect((await state.read('run-old')).status).toBe('running')

        // GitHub recovers; the retry re-resolves the STILL-ACTIVE old run and completes.
        gh.failDeleteProtection = undefined
        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
            stagingDeps
        )

        expect(r.kind).toBe('superseded')
        expect((await state.read('run-old')).status).toBe('superseded')
        // Branch + protection were GC'd on the successful retry → no orphan left behind.
        expect(gh.protectionDeletes).toContain('staging-run-old')
        expect(gh.deletedBranches).toContain('staging-run-old')
    })

    it('--supersede without stagingDeps → UsageError', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await expect(
            resolveOrCreateRun(state, store, {
                repo: REPO,
                issue: 42,
                runId: 'run-new',
                intent: 'supersede',
                // no stagingDeps passed
            })
        ).rejects.toMatchObject({isUsageError: true})
    })

    it('is LOUD when no spec exists for the issue (the reuse path resolves the spec first)', async () => {
        await expect(resolveOrCreateRun(state, store, {repo: REPO, issue: 999, runId: 'run-x'})).rejects.toThrow(
            /no spec for issue #999/
        )
    })

    // -------------------------------------------------------------------------
    // kind: "pause" — 7d-parked run blocks create/supersede, not resume
    // -------------------------------------------------------------------------

    /** Seed run-old as suspended with a 7d quota checkpoint. */
    async function seedWeeklyParked(): Promise<void> {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await state.update('run-old', (s) => ({
            ...s,
            status: 'suspended',
            quota: {binding_window: '7d' as const, resets_at_epoch: 9_999_999_999},
        }))
    }

    it('7d-parked run + default intent → quota-blocked', async () => {
        await seedWeeklyParked()
        const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        expect(r.kind).toBe('pause')
    })

    it('7d-parked run + supersede intent (no --ignore-quota) → quota-blocked', async () => {
        await seedWeeklyParked()
        const r = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-new',
            intent: 'supersede',
        })
        expect(r.kind).toBe('pause')
    })

    it('7d-parked run + ignoreQuota=true → falls through (supersede or exists)', async () => {
        await seedWeeklyParked()
        const r = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-new',
            ignoreQuota: true,
        })
        // Not quota-blocked — falls through to exists (no stagingDeps to supersede).
        expect(r.kind).toBe('exists')
    })

    it('7d-parked run + resume intent → falls through to exists (resume re-checks the live window)', async () => {
        await seedWeeklyParked()
        const r = await resolveOrCreateRun(state, store, {
            repo: REPO,
            issue: 42,
            runId: 'run-new',
            intent: 'resume',
        })
        expect(r.kind).toBe('exists')
    })

    it("5h-paused run (quota.binding_window:'5h') → NOT quota-blocked", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await state.update('run-old', (s) => ({
            ...s,
            status: 'paused',
            quota: {binding_window: '5h' as const, resets_at_epoch: 9_999_999_999},
        }))
        const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        expect(r.kind).toBe('exists')
    })

    it('unavailable-halt suspend (quota: undefined) → NOT quota-blocked', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await state.update('run-old', (s) => ({
            ...s,
            status: 'suspended',
            quota: undefined,
        }))
        const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        expect(r.kind).toBe('exists')
    })

    // -------------------------------------------------------------------------
    // Slug drift — the active run's pointer says '42-checkout' but a regenerated
    // spec came back '42-payments'. The lookup is issue-keyed (findActiveByIssue),
    // so every non-fresh intent must still SEE the drifted run.
    // -------------------------------------------------------------------------

    /** Replace the stored spec with a regenerated one whose slug drifted. */
    async function driftStoredSpec(): Promise<void> {
        await store.deleteByIssue(REPO, 42)
        await store.write(
            {...makeSpec([{task_id: 't1'}]), spec_id: '42-payments', slug: 'payments'},
            '# v2\n',
            makePrd()
        )
    }

    it("drifted-slug active run + default intent → kind:'exists' (no silent duplicate create)", async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await driftStoredSpec()
        const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        expect(r.kind).toBe('exists')
        if (r.kind !== 'exists') {
            throw new Error('narrowing')
        }
        expect(r.existing.run_id).toBe('run-old')
    })

    it('drifted-slug active run + supersede intent → old run found and torn down', async () => {
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await driftStoredSpec()

        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const r = await resolveOrCreateRun(
            state,
            store,
            {repo: REPO, issue: 42, runId: 'run-new', intent: 'supersede'},
            {
                gitClient: git,
                ghClient: new FakeGhClient(),
                config: defaultConfig(),
                targetRoot: '/target',
                orchestratorWorktreePath: '/target/.claude/worktrees/orchestrator-run-new',
                owner: 'acme',
                repo: 'widgets',
            }
        )
        expect(r.kind).toBe('superseded')
        if (r.kind !== 'superseded') {
            throw new Error('narrowing')
        }
        expect(r.supersededId).toBe('run-old')
        expect((await state.read('run-old')).status).toBe('superseded')
    })

    it('drifted-slug weekly-parked run + default intent → still quota-blocked', async () => {
        await seedWeeklyParked()
        await driftStoredSpec()
        const r = await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-new'})
        expect(r.kind).toBe('pause')
    })
})

describe('applyResume', () => {
    const NOW = 1_000_000
    let dataDir: string
    let state: StateManager

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-run-resume-')
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    /** A reading both windows of which are well under curve → pacer proceeds. */
    function underCurve(): UsageReading {
        return {
            kind: 'available',
            fiveHour: {utilizationPct: 0, resetsAtEpoch: NOW + FIVE_HOUR_WINDOW_SECONDS - 1},
            sevenDay: {utilizationPct: 0, resetsAtEpoch: NOW + SEVEN_DAY_WINDOW_SECONDS - 1},
            capturedAt: NOW,
        }
    }
    /** A reading whose 7d window is over curve at window-day 1 → suspend-7d. */
    function overCurve(): UsageReading {
        return {
            kind: 'available',
            fiveHour: {utilizationPct: 0, resetsAtEpoch: NOW + FIVE_HOUR_WINDOW_SECONDS - 1},
            sevenDay: {utilizationPct: 99, resetsAtEpoch: NOW + SEVEN_DAY_WINDOW_SECONDS - 1},
            capturedAt: NOW,
        }
    }
    const UNAVAILABLE: UsageReading = {kind: 'unavailable', reason: 'usage-cache-missing'}

    async function createBareRun(runId: string): Promise<void> {
        await seedRun(state, {runId, repo: REPO})
    }
    async function setStatus(runId: string, status: 'paused' | 'suspended', bindingWindow: '5h' | '7d'): Promise<void> {
        await state.update(runId, (s) => ({
            ...s,
            status,
            quota: {binding_window: bindingWindow, resets_at_epoch: NOW + 10},
        }))
    }

    function asResumed(env: ResumeResult): Extract<ResumeResult, {kind: 'resumed'}> {
        if (env.kind !== 'resumed') {
            throw new Error(`expected resumed, got ${env.kind}`)
        }
        return env
    }
    function asBlocked(env: ResumeResult): Extract<ResumeResult, {kind: 'pause'}> {
        if (env.kind !== 'pause') {
            throw new Error(`expected pause, got ${env.kind}`)
        }
        return env
    }

    it('clears the checkpoint and returns to running when the window has recovered', async () => {
        await createBareRun('r1')
        await setStatus('r1', 'paused', '5h')

        const env = asResumed(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW))
        expect(env.run.status).toBe('running')
        expect(env.run.quota).toBeUndefined()

        const reread = await state.read('r1')
        expect(reread.status).toBe('running')
        expect(reread.quota).toBeUndefined()
    })

    it('resumes a suspended run when the window has recovered', async () => {
        await createBareRun('r1')
        await setStatus('r1', 'suspended', '7d')
        const env = asResumed(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW))
        expect(env.run.status).toBe('running')
    })

    it('stays blocked (with the reset horizon) and untouched when still over curve', async () => {
        await createBareRun('r1')
        await setStatus('r1', 'paused', '5h')

        const env = asBlocked(await applyResume(state, 'r1', overCurve(), defaultConfig(), NOW))
        expect(env.status).toBe('paused')
        expect(env.reason).toMatch(/7d quota over curve/)
        expect(env.resets_at_epoch).toBe(NOW + SEVEN_DAY_WINDOW_SECONDS - 1)

        // State is left exactly as persisted (still paused, checkpoint intact).
        const reread = await state.read('r1')
        expect(reread.status).toBe('paused')
        expect(reread.quota).toBeDefined()
    })

    it('fails closed (pause, no reset horizon) when usage is unobservable', async () => {
        await createBareRun('r1')
        await setStatus('r1', 'paused', '5h')

        const env = asBlocked(await applyResume(state, 'r1', UNAVAILABLE, defaultConfig(), NOW))
        expect(env.reason).toMatch(/usage unavailable/)
        expect(env.resets_at_epoch).toBeUndefined()
    })

    it('is an idempotent re-entry for an already-running run', async () => {
        await createBareRun('r1') // create → status running
        const env = asResumed(await applyResume(state, 'r1', UNAVAILABLE, defaultConfig(), NOW))
        expect(env.run.status).toBe('running')
        // S11: no park was cleared → no `cleared` flag, no human touch appended.
        expect(env.cleared).toBeUndefined()
        expect((await state.read('r1')).human_touches).toEqual([])
    })

    it("appends the 'resume' human touch on a real clear, flagged cleared:true (S11)", async () => {
        await createBareRun('r1')
        await setStatus('r1', 'paused', '5h')
        const env = asResumed(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW))
        expect(env.cleared).toBe(true)
        expect(env.run.human_touches).toEqual([{kind: 'resume', at: new Date(NOW * 1000).toISOString()}])
    })

    it('opts.touch:false clears the park WITHOUT appending a touch (the rescue-apply park-clear tail)', async () => {
        await createBareRun('r1')
        await setStatus('r1', 'paused', '5h')
        const env = asResumed(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW, {touch: false}))
        expect(env.cleared).toBe(true)
        expect(env.run.status).toBe('running')
        expect(env.run.human_touches).toEqual([])
    })

    it.each(['completed', 'failed', 'superseded'] as const)(
        'is LOUD on a terminal run (%s) — nothing to resume',
        async (status) => {
            await createBareRun('r1')
            if (status === 'completed') {
                await state.finalize('r1', status)
            } else {
                await state.finalize('r1', status, 'test: forced terminal')
            }
            await expect(applyResume(state, 'r1', underCurve(), defaultConfig(), NOW)).rejects.toThrow(/terminal/)
        }
    )

    describe("Decision 39: run.debug routes to a distinct 'debug-resume' envelope", () => {
        function asDebugResume(env: ResumeResult): Extract<ResumeResult, {kind: 'debug-resume'}> {
            if (env.kind !== 'debug-resume') {
                throw new Error(`expected debug-resume, got ${env.kind}`)
            }
            return env
        }

        it('a debug:true run returns debug-resume BEFORE any quota/planResume logic runs', async () => {
            await createBareRun('r1')
            await state.update('r1', (s) => ({...s, debug: true}))

            // UNAVAILABLE would normally fail-closed via planResume/quota; a debug run must
            // never reach that logic, so this must NOT throw or block.
            const env = asDebugResume(await applyResume(state, 'r1', UNAVAILABLE, defaultConfig(), NOW))
            expect(env.run_id).toBe('r1')
            expect(env.run.debug).toBe(true)

            // No quota/planResume side effects: status and quota checkpoint untouched.
            const reread = await state.read('r1')
            expect(reread.status).toBe('running')
            expect(reread.quota).toBeUndefined()
        })

        it('a debug:true PAUSED run also short-circuits to debug-resume (never clears the checkpoint via planResume)', async () => {
            await createBareRun('r1')
            await state.update('r1', (s) => ({...s, debug: true}))
            await setStatus('r1', 'paused', '5h')

            const env = asDebugResume(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW))
            expect(env.run.status).toBe('paused') // untouched — planResume never ran
            expect(env.run.quota).toBeDefined() // checkpoint left intact

            const reread = await state.read('r1')
            expect(reread.status).toBe('paused')
            expect(reread.quota).toBeDefined()
        })

        it('debug:false (regression guard) is unaffected — resumes exactly as before', async () => {
            await createBareRun('r1')
            // debug defaults to false — no update needed.
            const env = asResumed(await applyResume(state, 'r1', underCurve(), defaultConfig(), NOW))
            expect(env.run.status).toBe('running')
        })
    })
})
