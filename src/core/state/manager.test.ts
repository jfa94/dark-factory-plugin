import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {mkdtemp, mkdir, rm, readFile, symlink, lstat} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {StateManager} from './manager.js'
import {runStatePath, runsRoot, specDir} from './paths.js'
import {parseRunState, type SpecPointer} from './schema.js'
import {atomicWriteFile} from '../../shared/atomic-write.js'
import {deriveMergeGateVerdict} from './derive.js'
import {nonNull, at} from '../../shared/index.js'

let dataDir: string
const spec: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}

function mgr(): StateManager {
    // Tight lock window so the concurrency test runs fast.
    return new StateManager({
        dataDir,
        lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
    })
}

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'factory-state-'))
})
afterEach(async () => {
    await rm(dataDir, {recursive: true, force: true})
})

describe('lifecycle: create / read / update / finalize', () => {
    it('creates a run, writes state + logs + current symlink', async () => {
        const m = mgr()
        const run = await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        expect(run.status).toBe('running')
        expect(existsSync(runStatePath(dataDir, 'run-1'))).toBe(true)
        expect(existsSync(join(dataDir, 'runs', 'run-1', 'audit.jsonl'))).toBe(true)
        expect(existsSync(join(dataDir, 'runs', 'run-1', 'holdouts'))).toBe(true)

        const onDisk = parseRunState(JSON.parse(await readFile(runStatePath(dataDir, 'run-1'), 'utf8')))
        expect(onDisk.run_id).toBe('run-1')
        expect(onDisk.spec).toEqual(spec)
    })

    it('refuses to clobber an existing run', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await expect(m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})).rejects.toThrow(
            /already exists/
        )
    })

    it('two concurrent same-id create() calls: exactly one wins, no silent clobber (TOCTOU)', async () => {
        const m = mgr()
        const specA: SpecPointer = {repo: 'acme/a', spec_id: '1-a', issue_number: 1}
        const specB: SpecPointer = {repo: 'acme/b', spec_id: '2-b', issue_number: 2}
        const settled = await Promise.allSettled([
            m.create({run_id: 'dup', staging_branch: 'staging-dup', spec: specA}),
            m.create({run_id: 'dup', staging_branch: 'staging-dup', spec: specB}),
        ])
        const fulfilled = settled.filter((s) => s.status === 'fulfilled')
        const rejected = settled.filter((s) => s.status === 'rejected')
        expect(fulfilled).toHaveLength(1)
        expect(rejected).toHaveLength(1)
        expect(at(rejected, 0).reason).toBeInstanceOf(Error)
        expect((at(rejected, 0).reason as Error).message).toMatch(/already exists/)

        // The on-disk state is the winner's, intact — not a last-writer-wins blend.
        const onDisk = await m.read('dup')
        const winner = at(fulfilled, 0).value
        expect(onDisk.spec).toEqual(winner.spec)
        expect([specA, specB]).toContainEqual(onDisk.spec)
    })

    it('create({debug:true}) persists debug:true on the run (Task 6 round-trip)', async () => {
        const m = mgr()
        const run = await m.create({run_id: 'run-debug', staging_branch: 'staging-run-debug', spec, debug: true})
        expect(run.debug).toBe(true)
        expect((await m.read('run-debug')).debug).toBe(true)
    })

    it('create() with no debug arg defaults to debug:false', async () => {
        const m = mgr()
        const run = await m.create({run_id: 'run-nodebug', staging_branch: 'staging-run-nodebug', spec})
        expect(run.debug).toBe(false)
    })

    it('readCurrentForRepo resolves the active run', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        const cur = await m.readCurrentForRepo(spec.repo)
        expect(cur?.run_id).toBe('run-1')
    })

    it('exists() is true after create() and false for a run id never created', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        expect(m.exists('run-1')).toBe(true)
        expect(m.exists('never-created')).toBe(false)
    })

    it('update mutates under lock and re-stamps updated_at + re-validates', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        const after = await m.update('run-1', (s) => ({
            ...s,
            tasks: {
                t1: {
                    task_id: 't1',
                    status: 'pending',
                    risk_tier: 'low',
                    escalation_rung: 0,
                    depends_on: [],
                    reviewers: [],
                    merge_resyncs: 0,
                },
            },
        }))
        expect(after.tasks.t1?.task_id).toBe('t1')
    })

    it('a mutator that produces an out-of-enum value is rejected at write time', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await expect(m.update('run-1', (s) => ({...s, status: 'interrupted' as never}))).rejects.toThrow()
    })

    it('updateTask throws on an unknown task id (no silent create)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await expect(m.updateTask('run-1', 'ghost', (t) => t)).rejects.toThrow(/no task/)
    })

    it('update refuses a mutator that changes run identity (run_id / spec pointer)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        // run_id is immutable.
        await expect(m.update('run-1', (s) => ({...s, run_id: 'run-2'}))).rejects.toThrow(/run_id/)
        // The spec pointer (repo / spec_id / issue_number) is immutable too.
        await expect(m.update('run-1', (s) => ({...s, spec: {...s.spec, repo: 'evil/other'}}))).rejects.toThrow(/spec/)
        await expect(m.update('run-1', (s) => ({...s, spec: {...s.spec, issue_number: 999}}))).rejects.toThrow(/spec/)
        // The original on-disk identity is untouched.
        const onDisk = await m.read('run-1')
        expect(onDisk.run_id).toBe('run-1')
        expect(onDisk.spec).toEqual(spec)
    })
})

describe('finalize is terminal, never spins (Decision 22/24)', () => {
    it('finalizes to a terminal status and stamps ended_at', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        const done = await m.finalize('run-1', 'completed')
        expect(done.status).toBe('completed')
        expect(done.ended_at).not.toBeNull()
    })

    it('refuses a non-terminal status for finalize', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await expect(m.finalize('run-1', 'paused' as 'completed')).rejects.toThrow(/terminal/)
        await expect(m.finalize('run-1', 'running' as 'completed')).rejects.toThrow(/terminal/)
    })

    it('refuses to re-finalize to a DIFFERENT terminal status', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await m.finalize('run-1', 'completed')
        await expect(m.finalize('run-1', 'failed', 'boom')).rejects.toThrow(/already terminal/)
    })

    it('is idempotent for the same terminal status + reason', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        const a = await m.finalize('run-1', 'failed', 'evaluator exhausted')
        const b = await m.finalize('run-1', 'failed', 'evaluator exhausted')
        expect(b.status).toBe('failed')
        expect(b.terminal_reason).toBe('evaluator exhausted')
        expect(b.ended_at).toBe(a.ended_at) // ended_at preserved, not bumped
    })

    it('requires a non-empty reason for failed/superseded and forbids one for completed', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await expect(m.finalize('run-1', 'failed', '' as string)).rejects.toThrow(/requires a non-empty reason/)
        await expect(m.finalize('run-1', 'failed', '   ')).rejects.toThrow(/requires a non-empty reason/)
        await expect(
            (m.finalize as (r: string, s: string, x?: string) => Promise<unknown>)('run-1', 'failed')
        ).rejects.toThrow(/requires a non-empty reason/)
        await expect(
            (m.finalize as (r: string, s: string, x?: string) => Promise<unknown>)('run-1', 'completed', 'nope')
        ).rejects.toThrow(/takes no reason/)
    })

    it('refuses to REPLACE a stored reason, but backfills a legacy missing one exactly once', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await m.finalize('run-1', 'failed', 'original cause')
        await expect(m.finalize('run-1', 'failed', 'rewritten cause')).rejects.toThrow(/refusing to replace/)

        // Legacy shape: terminal with no stored reason (simulated by stripping the field).
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec})
        await m.update('run-2', (s) => ({
            ...s,
            status: 'failed' as const,
            ended_at: s.ended_at ?? new Date(0).toISOString(),
        }))
        const backfilled = await m.finalize('run-2', 'failed', 'late-discovered cause')
        expect(backfilled.terminal_reason).toBe('late-discovered cause')
        await expect(m.finalize('run-2', 'failed', 'a different cause')).rejects.toThrow(/refusing to replace/)
    })

    it('reads a legacy terminal state without terminal_reason (schema-v3 compat)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await m.update('run-1', (s) => ({
            ...s,
            status: 'failed' as const,
            ended_at: new Date(0).toISOString(),
        }))
        const read = await m.read('run-1')
        expect(read.status).toBe('failed')
        expect(read.terminal_reason).toBeUndefined()
    })
})

describe("derive-don't-store survives a forged on-disk verdict (Δ V, end-to-end)", () => {
    it('a forged gate boolean injected into state.json is stripped on read AND ignored by derivation', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await m.update('run-1', (s) => ({
            ...s,
            tasks: {
                t1: {
                    task_id: 't1',
                    status: 'reviewing',
                    phase: 'verify',
                    risk_tier: 'high',
                    escalation_rung: 0,
                    depends_on: [],
                    merge_resyncs: 0,
                    // Panel did NOT unanimously approve — security blocked.
                    reviewers: [
                        {reviewer: 'impl', verdict: 'approve', confirmed_blockers: 0},
                        {reviewer: 'security', verdict: 'blocked', confirmed_blockers: 1},
                    ],
                },
            },
        }))

        // Attacker bypasses the StateManager and forges a stored PASS directly on disk:
        // a `quality_gate: true` / `merge_gate_passed: true` boolean meant to wave the task
        // through. This is exactly the TCB-write-gap the bash code was vulnerable to.
        const path = runStatePath(dataDir, 'run-1')
        const onDisk = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
        const tasks = onDisk.tasks as Record<string, Record<string, unknown>>
        const forged = nonNull(tasks.t1)
        forged.quality_gate = true
        forged.merge_gate_passed = true
        forged.mutation_gate = true
        await atomicWriteFile(path, JSON.stringify(onDisk))

        // 1) The schema strips the forged fields on read — they are structurally absent.
        const reread = await m.read('run-1')
        const t = reread.tasks.t1 as unknown as Record<string, unknown>
        expect(t.quality_gate).toBeUndefined()
        expect(t.merge_gate_passed).toBeUndefined()
        expect(t.mutation_gate).toBeUndefined()

        // 2) The merge gate verdict is re-derived from ground truth (the blocked panel +
        //    real gate evidence) and IGNORES the forgery — it FAILS, as it must.
        const verdict = deriveMergeGateVerdict(nonNull(reread.tasks.t1), [{gate: 'test', observed: true}])
        expect(verdict.passed).toBe(false)
        expect(verdict.__derived).toBe(true)
    })
})

describe('concurrency: ≥3 writers do not corrupt state', () => {
    // Correctness-critical (no lost updates) and load-sensitive (100 contended lock
    // acquisitions); 30s is harness headroom, not a behavior change.
    it('100 concurrent increments across 4 writers all land (no lost updates)', async () => {
        // Seed a numeric counter encoded in a task's escalation_rung.
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        await m.update('run-1', (s) => ({
            ...s,
            tasks: {
                c: {
                    task_id: 'c',
                    status: 'pending',
                    risk_tier: 'low',
                    escalation_rung: 0,
                    depends_on: [],
                    reviewers: [],
                    merge_resyncs: 0,
                },
            },
        }))

        const WRITERS = 4
        const PER_WRITER = 25

        await Promise.all(
            Array.from({length: WRITERS}, () =>
                // sequentialize each writer's own bumps; writers race each other.
                (async () => {
                    for (let i = 0; i < PER_WRITER; i++) {
                        const wm = new StateManager({
                            dataDir,
                            lock: {stale: 5000, retries: 500, retryMinTimeout: 2, retryMaxTimeout: 40},
                        })
                        await wm.updateTask('run-1', 'c', (t) => ({
                            ...t,
                            escalation_rung: t.escalation_rung + 1,
                        }))
                    }
                })()
            )
        )

        const final = await m.read('run-1')
        expect(final.tasks.c?.escalation_rung).toBe(WRITERS * PER_WRITER)

        // And the file is still valid JSON parseable as a RunState (no torn write).
        const raw = await readFile(runStatePath(dataDir, 'run-1'), 'utf8')
        expect(() => parseRunState(JSON.parse(raw))).not.toThrow()
    }, 30_000)
})

describe('enumeration: listRuns / findActiveByIssue (resolve-or-reuse)', () => {
    const specA: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}
    const specB: SpecPointer = {repo: 'acme/widgets', spec_id: '7-search', issue_number: 7}

    it('returns [] when the run store does not exist yet', async () => {
        expect(await mgr().listRuns()).toEqual([])
    })

    it('lists every run newest-first (run-id descending) and excludes the current symlink', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specB})
        // create() points runs/current at run-2 (a symlink, not a run dir).
        const runs = await m.listRuns()
        expect(runs.map((r) => r.run_id)).toEqual(['run-2', 'run-1'])
    })

    it('skips a run dir that has no state.json yet (mid-creation / cleaned)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        await mkdir(join(runsRoot(dataDir), 'run-empty'), {recursive: true})
        const runs = await m.listRuns()
        expect(runs.map((r) => r.run_id)).toEqual(['run-1'])
    })

    it('warn-skips a corrupt state.json but still returns the healthy runs', async () => {
        const m = mgr()
        await m.create({run_id: 'run-good', staging_branch: 'staging-run-good', spec: specA})
        await m.create({run_id: 'run-bad', staging_branch: 'staging-run-bad', spec: specB})
        await atomicWriteFile(runStatePath(dataDir, 'run-bad'), 'not json {')

        const warns: string[] = []
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            warns.push(String(chunk))
            return true
        })
        try {
            const runs = await m.listRuns()
            expect(runs.map((r) => r.run_id)).toEqual(['run-good'])
        } finally {
            spy.mockRestore()
        }
        expect(warns.some((w) => w.includes("skipping unreadable run 'run-bad'"))).toBe(true)
        // The targeted read() keeps its LOUD contract (only listRuns warn-skips).
        await expect(m.read('run-bad')).rejects.toThrow()
    })

    it('findActiveByIssue returns the non-terminal run matching (repo, issue)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        const found = await m.findActiveByIssue(specA.repo, specA.issue_number)
        expect(found?.run_id).toBe('run-1')
    })

    it('findActiveByIssue matches on BOTH repo and issue', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        expect(await m.findActiveByIssue('other/repo', specA.issue_number)).toBeNull()
        expect(await m.findActiveByIssue(specA.repo, 999)).toBeNull()
    })

    it('findActiveByIssue matches a run whose slug drifted from a regenerated spec', async () => {
        // The run was created under spec `42-checkout`; a --supersede regeneration
        // minted `42-checkout-rework`. The issue number — not the slug — is the key.
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        const found = await m.findActiveByIssue(specA.repo, 42)
        expect(found?.run_id).toBe('run-1')
        expect(found?.spec.spec_id).toBe('42-checkout') // original id, not the drifted one
    })

    it('findActiveByIssue ignores terminal runs (a finalized run is not reusable)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        await m.finalize('run-1', 'completed')
        expect(await m.findActiveByIssue(specA.repo, specA.issue_number)).toBeNull()
    })

    it('findActiveByIssue fails LOUD when several non-terminal runs match (state defect)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specA})
        await expect(m.findActiveByIssue(specA.repo, specA.issue_number)).rejects.toThrow(
            /2 active runs for issue #42.*factory:resume/s
        )
    })

    it('hasOtherActiveForRepo: sibling-issue run counts, self and terminal runs do not (D74)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        // Only itself is active → false.
        expect(await m.hasOtherActiveForRepo(specA.repo, 'run-1')).toBe(false)
        // A different-issue run on the SAME repo → true.
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specB})
        expect(await m.hasOtherActiveForRepo(specA.repo, 'run-1')).toBe(true)
        // Terminal sibling → false again.
        await m.finalize('run-2', 'completed')
        expect(await m.hasOtherActiveForRepo(specA.repo, 'run-1')).toBe(false)
        // A run on another repo never counts.
        expect(await m.hasOtherActiveForRepo('other/repo', 'run-1')).toBe(false)
        // No exclusion (scaffold's probe): the active run itself counts.
        expect(await m.hasOtherActiveForRepo(specA.repo)).toBe(true)
    })
})

describe('findActiveByOwner — resolve the live run a session owns (run-isolation L1.3)', () => {
    const specA: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}
    const specB: SpecPointer = {repo: 'acme/other', spec_id: '7-search', issue_number: 7}

    it('returns the non-terminal run whose owner_session matches', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        const found = await m.findActiveByOwner('sess-A')
        expect(found?.run_id).toBe('run-1')
    })

    it('ignores runs owned by a DIFFERENT session (cross-session isolation)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        expect(await m.findActiveByOwner('sess-B')).toBeNull()
    })

    it("ignores terminal runs (a finalized run is not the session's live run)", async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        await m.finalize('run-1', 'completed')
        expect(await m.findActiveByOwner('sess-A')).toBeNull()
    })

    it('never matches a run that carries no owner_session', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA}) // no owner stamped
        expect(await m.findActiveByOwner('sess-A')).toBeNull()
    })

    it('returns null when the SAME session owns ≥2 live runs (ambiguous → fail-safe)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specB, owner_session: 'sess-A'})
        expect(await m.findActiveByOwner('sess-A')).toBeNull()
    })

    it('an empty session id never matches (defensive)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        expect(await m.findActiveByOwner('')).toBeNull()
    })
})

describe('findAllActiveByOwner — the raw owned-runs list that distinguishes none from ≥2', () => {
    const specA: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}
    const specB: SpecPointer = {repo: 'acme/other', spec_id: '7-search', issue_number: 7}

    it('an empty session id yields no runs', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        expect(await m.findAllActiveByOwner('')).toEqual([])
    })

    it("a session owning nothing yields [] (the 0-owned case findActiveByOwner can't distinguish)", async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        expect(await m.findAllActiveByOwner('sess-B')).toEqual([])
    })

    it('returns exactly the single owned run', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        const owned = await m.findAllActiveByOwner('sess-A')
        expect(owned.map((r) => r.run_id)).toEqual(['run-1'])
    })

    it('returns BOTH runs when one session owns ≥2 (the ambiguity the loud caller acts on)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specB, owner_session: 'sess-A'})
        const owned = await m.findAllActiveByOwner('sess-A')
        expect(owned.map((r) => r.run_id).sort()).toEqual(['run-1', 'run-2'])
    })

    it('excludes terminal and other-session runs', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA, owner_session: 'sess-A'})
        await m.create({run_id: 'run-2', staging_branch: 'staging-run-2', spec: specB, owner_session: 'sess-A'})
        await m.finalize('run-2', 'completed')
        await m.create({
            run_id: 'run-3',
            staging_branch: 'staging-run-3',
            spec: {repo: 'acme/z', spec_id: '9-z', issue_number: 9},
            owner_session: 'sess-Z',
        })
        expect((await m.findAllActiveByOwner('sess-A')).map((r) => r.run_id)).toEqual(['run-1'])
    })
})

describe('per-repo current pointer + clobber guard (run-isolation L2.6/L2.7)', () => {
    const specA: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}
    const specB: SpecPointer = {repo: 'acme/other', spec_id: '7-search', issue_number: 7}
    const specA2: SpecPointer = {repo: 'acme/widgets', spec_id: '99-extra', issue_number: 99}

    it('create writes a per-repo pointer under <dataDir>/current (sibling of runs/)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        expect(existsSync(join(dataDir, 'current', 'acme-widgets'))).toBe(true)
        expect(await m.readCurrentForRepo('acme/widgets')).toMatchObject({run_id: 'run-1'})
    })

    it("resolves each repo's OWN current run concurrently (cross-repo isolation)", async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA})
        await m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specB})
        expect(await m.readCurrentForRepo('acme/widgets')).toMatchObject({run_id: 'run-A'})
        expect(await m.readCurrentForRepo('acme/other')).toMatchObject({run_id: 'run-B'})
    })

    it("never leaks another repo's run via the global read-through", async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA}) // global runs/current → run-A
        // A repo with no pointer of its own must NOT inherit run-A through the global.
        expect(await m.readCurrentForRepo('acme/unrelated')).toBeNull()
    })

    it('a per-repo miss is null — NO fallthrough to the global pointer (older-factory state fails closed)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA})
        // Only the global runs/current exists (per-repo tree removed) → per-repo read misses.
        await rm(join(dataDir, 'current'), {recursive: true, force: true})
        expect(await m.readCurrentForRepo('acme/widgets')).toBeNull()
    })

    it('CLOBBER: a 2nd same-repo run by a DIFFERENT session is refused loud (run stays addressable)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA, owner_session: 'sess-A'})
        await expect(
            m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specA2, owner_session: 'sess-B'})
        ).rejects.toThrow(/refusing to repoint current for repo 'acme\/widgets'/)
        // The refused run's state.json was written before the throw → addressable via --run.
        expect(await m.read('run-B')).toMatchObject({run_id: 'run-B'})
        // The incumbent repo pointer was NOT moved.
        expect(await m.readCurrentForRepo('acme/widgets')).toMatchObject({run_id: 'run-A'})
    })

    it('CLOBBER does NOT fire cross-repo (different repos run concurrently)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA, owner_session: 'sess-A'})
        await expect(
            m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specB, owner_session: 'sess-B'})
        ).resolves.toMatchObject({
            run_id: 'run-B',
            staging_branch: 'staging-run-B',
        })
    })

    it('CLOBBER degrades safe (last-wins) when either owner is unknown', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA, owner_session: 'sess-A'})
        // New run carries no owner → cannot prove a different session → allowed.
        await expect(m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specA2})).resolves.toMatchObject(
            {
                run_id: 'run-B',
                staging_branch: 'staging-run-B',
            }
        )
        expect(await m.readCurrentForRepo('acme/widgets')).toMatchObject({run_id: 'run-B'})
    })

    it('CLOBBER ignores a TERMINAL incumbent (a finalized run does not block the repo)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA, owner_session: 'sess-A'})
        await m.finalize('run-A', 'completed')
        await expect(
            m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specA2, owner_session: 'sess-B'})
        ).resolves.toMatchObject({
            run_id: 'run-B',
            staging_branch: 'staging-run-B',
        })
    })

    it('CLOBBER allows the SAME session to repoint its repo (serial re-create)', async () => {
        const m = mgr()
        await m.create({run_id: 'run-A', staging_branch: 'staging-run-A', spec: specA, owner_session: 'sess-A'})
        await expect(
            m.create({run_id: 'run-B', staging_branch: 'staging-run-B', spec: specA2, owner_session: 'sess-A'})
        ).resolves.toMatchObject({
            run_id: 'run-B',
            staging_branch: 'staging-run-B',
        })
    })
})

describe('D57: born whole — birth-write seeding + stale-pointer tolerance + stale-dir sweep', () => {
    /** Plant an unparseable (schema-v2) run dir, optionally pointed at by the per-repo pointer. */
    async function plantV2Run(runId: string, opts: {point?: string; body?: Record<string, unknown>} = {}) {
        await mkdir(join(runsRoot(dataDir), runId), {recursive: true})
        await atomicWriteFile(
            runStatePath(dataDir, runId),
            JSON.stringify({schema_version: 2, run_id: runId, ...opts.body})
        )
        if (opts.point !== undefined) {
            await mkdir(join(dataDir, 'current'), {recursive: true})
            await symlink(join('..', 'runs', runId), join(dataDir, 'current', opts.point))
        }
    }

    function spyWarns(): {warns: string[]; restore: () => void} {
        const warns: string[] = []
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            warns.push(String(chunk))
            return true
        })
        return {
            warns,
            restore: () => {
                spy.mockRestore()
            },
        }
    }

    it('create({tasks, human_touches}) persists both in the ONE birth write', async () => {
        const m = mgr()
        const run = await m.create({
            run_id: 'run-1',
            staging_branch: 'staging-run-1',
            spec,
            tasks: {t1: {task_id: 't1'} as never, t2: {task_id: 't2', depends_on: ['t1']} as never},
            human_touches: [{kind: 'launch'}],
        })
        // Straight off disk — no follow-up update() could have filled these in.
        const onDisk = parseRunState(JSON.parse(await readFile(runStatePath(dataDir, 'run-1'), 'utf8')))
        expect(Object.keys(onDisk.tasks).sort()).toEqual(['t1', 't2'])
        expect(onDisk.tasks.t2?.depends_on).toEqual(['t1'])
        // An omitted touch `at` is stamped with the birth timestamp — `at === started_at` exactly.
        expect(onDisk.human_touches).toEqual([{kind: 'launch', at: run.started_at}])
    })

    it('create() without them keeps the empty defaults', async () => {
        const m = mgr()
        const run = await m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec})
        expect(run.tasks).toEqual({})
        expect(run.human_touches).toEqual([])
    })

    it('INCIDENT: unparseable pointer target → create() warns, repoints, succeeds (2026-07-07)', async () => {
        await plantV2Run('run-old', {point: 'acme-widgets'})
        const m = mgr()
        const {warns, restore} = spyWarns()
        try {
            const run = await m.create({run_id: 'run-new', staging_branch: 'staging-run-new', spec})
            expect(run.run_id).toBe('run-new')
        } finally {
            restore()
        }
        expect(warns.some((w) => w.includes('unparseable') && w.includes('acme/widgets'))).toBe(true)
        expect(await m.readCurrentForRepo('acme/widgets')).toMatchObject({run_id: 'run-new'})
    })

    it('readCurrentForRepo keeps its LOUD contract on the same stale pointer', async () => {
        await plantV2Run('run-old', {point: 'acme-widgets'})
        await expect(mgr().readCurrentForRepo('acme/widgets')).rejects.toThrow(/schema v2/)
    })

    it('a non-parse read error (EACCES) on the current pointer makes create() refuse, not repoint (P3)', async () => {
        // The D57 tolerance is scoped to unparseable/old-schema targets. A transient
        // read failure (permissions, I/O) on a genuinely live pointer must NOT be
        // treated as stale — repointing over it would hide a live run.
        const m = mgr()
        const eacces = Object.assign(new Error('EACCES: permission denied'), {code: 'EACCES'})
        vi.spyOn(m, 'readCurrentForRepo').mockRejectedValueOnce(eacces)
        await expect(m.create({run_id: 'run-new', staging_branch: 'staging-run-new', spec})).rejects.toBe(eacces)
    })

    it('listStaleRunDirs: old-schema + corrupt-json reported, v3 + mid-creation dirs skipped', async () => {
        const m = mgr()
        await m.create({run_id: 'run-v3', staging_branch: 'staging-run-v3', spec})
        await plantV2Run('run-v2', {body: {staging_branch: 'staging-run-v2', spec: {repo: 'acme/widgets'}}})
        await plantV2Run('run-v2-bare') // no staging_branch/repo extractable
        await mkdir(join(runsRoot(dataDir), 'run-corrupt'), {recursive: true})
        await atomicWriteFile(runStatePath(dataDir, 'run-corrupt'), 'not json {')
        await mkdir(join(runsRoot(dataDir), 'run-midcreate'), {recursive: true}) // no state.json → skip
        // Valid JSON with NO schema_version at all (not even an old numeric stamp) —
        // the v === undefined path, distinct from the numeric-old-schema branch above.
        await mkdir(join(runsRoot(dataDir), 'run-unstamped'), {recursive: true})
        await atomicWriteFile(runStatePath(dataDir, 'run-unstamped'), JSON.stringify({run_id: 'run-unstamped'}))

        const stale = await m.listStaleRunDirs()
        expect(stale.map((s) => s.run_id)).toEqual(['run-v2-bare', 'run-v2', 'run-unstamped', 'run-corrupt'])
        expect(stale.find((s) => s.run_id === 'run-v2')).toEqual({
            run_id: 'run-v2',
            reason: 'schema-v2',
            staging_branch: 'staging-run-v2',
            repo: 'acme/widgets',
        })
        expect(stale.find((s) => s.run_id === 'run-v2-bare')).toEqual({run_id: 'run-v2-bare', reason: 'schema-v2'})
        expect(stale.find((s) => s.run_id === 'run-unstamped')).toEqual({
            run_id: 'run-unstamped',
            reason: 'schema-vundefined',
        })
        expect(stale.find((s) => s.run_id === 'run-corrupt')).toEqual({run_id: 'run-corrupt', reason: 'corrupt-json'})
    })

    it('deleteRun removes the dir + every pointer naming it, leaves other pointers alone', async () => {
        const m = mgr()
        await plantV2Run('run-old', {point: 'acme-widgets'})
        const other: SpecPointer = {repo: 'acme/other', spec_id: '7-search', issue_number: 7}
        await m.create({run_id: 'run-keep', staging_branch: 'staging-run-keep', spec: other})

        await m.deleteRun('run-old')
        expect(existsSync(join(runsRoot(dataDir), 'run-old'))).toBe(false)
        expect(existsSync(join(dataDir, 'current', 'acme-widgets'))).toBe(false)
        // The unrelated repo's per-repo pointer (naming run-keep) survives.
        expect(await m.readCurrentForRepo('acme/other')).toMatchObject({run_id: 'run-keep'})
    })

    it('create() never writes the retired global runs/current pointer, and sweeps a legacy one (Decision 61)', async () => {
        // The global `runs/current` symlink is RETIRED (Decision 61). create() must not
        // write it, and best-effort-rms any leftover from an older engine.
        const globalLink = join(runsRoot(dataDir), 'current')
        await mkdir(runsRoot(dataDir), {recursive: true})
        await symlink(join(runsRoot(dataDir), 'ghost'), globalLink) // legacy dangling leftover

        const m = mgr()
        await m.create({run_id: 'run-old', staging_branch: 'staging-run-old', spec})
        // The legacy link file was swept and no new global pointer was written (lstat
        // does not follow the link, so it sees the link file itself is gone).
        await expect(lstat(globalLink)).rejects.toMatchObject({code: 'ENOENT'})
    })
})

describe('withSpecLock serializes the resolve-or-reuse scan→create (TOCTOU close)', () => {
    const specA: SpecPointer = {repo: 'acme/widgets', spec_id: '42-checkout', issue_number: 42}

    it('throws LOUD when the durable spec dir does not exist (no silent no-op)', async () => {
        await expect(mgr().withSpecLock(specA.repo, specA.spec_id, () => Promise.resolve(1))).rejects.toThrow(
            /cannot lock spec .*does not exist/
        )
    })

    it('two concurrent same-spec critical sections run mutually exclusively (no interleave)', async () => {
        // The lock parent is the durable spec dir; resolve-or-reuse guarantees it before
        // locking. Create it directly here (no SpecStore in this unit).
        await mkdir(specDir(dataDir, specA.repo, specA.spec_id), {recursive: true})
        const m = mgr()

        const events: string[] = []
        const critical = (tag: string) =>
            m.withSpecLock(specA.repo, specA.spec_id, async () => {
                events.push(`enter-${tag}`)
                // Yield so an unguarded section WOULD interleave here.
                await new Promise((r) => setImmediate(r))
                events.push(`exit-${tag}`)
            })

        await Promise.all([critical('a'), critical('b')])

        // Whichever entered first must exit before the other enters — never enter,enter,exit,exit.
        expect(events).toHaveLength(4)
        const [first, second, third, fourth] = events
        expect(second).toBe(first?.replace('enter', 'exit'))
        expect(fourth).toBe(third?.replace('enter', 'exit'))
    })

    it('a same-spec create() nested inside withSpecLock does not deadlock (distinct lockfiles)', async () => {
        await mkdir(specDir(dataDir, specA.repo, specA.spec_id), {recursive: true})
        const m = mgr()
        const run = await m.withSpecLock(specA.repo, specA.spec_id, async () =>
            m.create({run_id: 'run-1', staging_branch: 'staging-run-1', spec: specA})
        )
        expect(run.run_id).toBe('run-1')
    })
})
