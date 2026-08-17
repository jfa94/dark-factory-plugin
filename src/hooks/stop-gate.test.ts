/**
 * WS9/WS10 — Stop hook tests.
 *
 * decideStop is pure and only ever ALLOWS — the hook never blocks a stop and never
 * mutates state (the old state-only finalize-on-stop arm is removed: it bypassed the
 * real finalizeRun delivery and stranded runs in a healthy-looking but undelivered
 * terminal state). null/terminal/paused/suspended pass through; debug runs and a
 * non-owner session pass through; a live run with pending work passes
 * through (it stays resumable); an owned run whose tasks are ALL terminal is
 * left `running` with the `allow-unfinalized` hint — `/factory:resume` routes it
 * through the real finalizeRun. runStopGate wires that to the StateManager; the only
 * `{decision:"block"}` output left is the data-dir corruption case.
 */
import {describe, it, expect} from 'vitest'
import {decideStop, runStopGate} from './stop-gate.js'
import {EXIT} from '../shared/exit-codes.js'
import {at} from '../shared/index.js'
import type {RunState, TaskState} from '../types/index.js'

const SPEC = {repo: 'o/n', spec_id: '1-x', issue_number: 1} as const

function task(over: Partial<TaskState> = {}): TaskState {
    return {
        task_id: 't1',
        status: 'executing',
        depends_on: [],
        risk_tier: 'low',
        escalation_rung: 0,
        reviewers: [],
        ...over,
    } as TaskState
}

function run(over: Partial<RunState> = {}, tasks: Record<string, TaskState> = {}): RunState {
    return {
        schema_version: 2,
        run_id: 'run-x',
        status: 'running',
        execution_mode: 'balanced',
        spec: SPEC,
        tasks,
        started_at: 't',
        updated_at: 't',
        ended_at: null,
        ...over,
    } as RunState
}

describe('decideStop — pass-through statuses', () => {
    it('no active run → allow', () => {
        expect(decideStop(null)).toEqual({kind: 'allow'})
    })

    it.each(['completed', 'superseded', 'failed', 'paused', 'suspended'] as const)(
        "non-running status '%s' → allow (intentional)",
        (status) => {
            expect(decideStop(run({status}))).toEqual({kind: 'allow'})
        }
    )
})

describe('decideStop — debug mode → plain allow (the debug driver owns finalize between passes)', () => {
    it('session-owned, running, all-terminal, debug:true → plain allow (no hint)', () => {
        const action = decideStop(run({debug: true}, {a: task({task_id: 'a', status: 'done'})}))
        expect(action).toEqual({kind: 'allow'})
    })

    it('debug:true with pending work → allow', () => {
        const action = decideStop(run({debug: true}, {t1: task({status: 'executing'})}))
        expect(action).toEqual({kind: 'allow'})
    })

    it('debug:false (explicit), all-terminal → block-finalize as for a plain run', () => {
        const action = decideStop(run({debug: false}, {a: task({task_id: 'a', status: 'done'})}))
        expect(action).toEqual({kind: 'block-finalize', run_id: 'run-x'})
    })
})

describe('decideStop — session-ownership', () => {
    const OWNER = 'session-owner-abc'

    it("owner known + stopping session != owner → plain allow, even all-terminal (another session's run)", () => {
        const action = decideStop(
            run({owner_session: OWNER}, {a: task({task_id: 'a', status: 'done'})}),
            'some-other-session'
        )
        expect(action).toEqual({kind: 'allow'})
    })

    it('owner known + stopping session == owner + all-terminal → block-finalize (one-shot resume instruction)', () => {
        const action = decideStop(run({owner_session: OWNER}, {a: task({task_id: 'a', status: 'done'})}), OWNER)
        expect(action).toEqual({kind: 'block-finalize', run_id: 'run-x'})
    })

    it('owner known + stopping session == owner + pending work → allow (NO hostage; resumable)', () => {
        const action = decideStop(run({owner_session: OWNER}, {t1: task({status: 'executing'})}), OWNER)
        expect(action).toEqual({kind: 'allow'})
    })

    it('owner known + stopping session UNKNOWN (no stdin) + all-terminal → block-finalize (degraded path still one-shots)', () => {
        const action = decideStop(run({owner_session: OWNER}, {a: task({task_id: 'a', status: 'done'})}), undefined)
        expect(action).toEqual({kind: 'block-finalize', run_id: 'run-x'})
    })
})

describe('decideStop — pending work → allow (the session-hostage fix)', () => {
    it('allows the stop when a task is in-flight (no block, run stays resumable)', () => {
        const action = decideStop(run({}, {t1: task({task_id: 't1', status: 'executing'})}))
        expect(action).toEqual({kind: 'allow'})
    })

    it('allows the stop when setup is unfinished (zero tasks)', () => {
        expect(decideStop(run({}, {}))).toEqual({kind: 'allow'})
    })
})

describe('decideStop — all tasks terminal → one-shot block-finalize (NEVER a state-only finalize)', () => {
    it('every task done → block-finalize; the run stays running for the real finalizeRun', () => {
        const action = decideStop(
            run({}, {a: task({task_id: 'a', status: 'done'}), b: task({task_id: 'b', status: 'done'})})
        )
        expect(action).toEqual({kind: 'block-finalize', run_id: 'run-x'})
    })

    it('mix of done + failed → still block-finalize (no derived status, no flip)', () => {
        const action = decideStop(
            run(
                {},
                {
                    a: task({task_id: 'a', status: 'done'}),
                    b: task({task_id: 'b', status: 'failed', failure_class: 'capability-budget'}),
                }
            )
        )
        expect(action).toEqual({kind: 'block-finalize', run_id: 'run-x'})
    })

    it('stop_hook_active re-entry → allow-unfinalized (hint only, never a second block)', () => {
        const allTerminal = run({}, {a: task({task_id: 'a', status: 'done'})})
        expect(decideStop(allTerminal, undefined, true)).toEqual({kind: 'allow-unfinalized', run_id: 'run-x'})
    })
})

describe('runStopGate — I/O wiring', () => {
    function emitter() {
        const out: string[] = []
        return {out, emit: (s: string) => out.push(s)}
    }

    // Helper: produce a Stop-hook stdin payload for the given session.
    const stdin =
        (sessionId: string, stopHookActive = false) =>
        () =>
            Promise.resolve(
                JSON.stringify({session_id: sessionId, hook_event_name: 'Stop', stop_hook_active: stopHookActive})
            )

    it('no active run → OK, emits nothing', async () => {
        const {out, emit} = emitter()
        const manager = {findActiveByOwner: () => Promise.resolve(null)}
        const code = await runStopGate([], {manager, emit, readRaw: stdin('sess-a')})
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([])
    })

    it('pending work → allow (emits nothing)', async () => {
        const {out, emit} = emitter()
        const manager = {
            findActiveByOwner: (s: string) =>
                Promise.resolve(s === 'sess-a' ? run({}, {t1: task({status: 'executing'})}) : null),
        }
        const code = await runStopGate([], {manager, emit, readRaw: stdin('sess-a')})
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([])
    })

    it('all-terminal run → one-shot block naming `/factory:resume` (the runner frontend that can finalize), run left untouched', async () => {
        const {out, emit} = emitter()
        const owned = run({}, {a: task({task_id: 'a', status: 'done'})})
        const manager = {
            findActiveByOwner: (s: string) => Promise.resolve(s === 'sess-a' ? owned : null),
        }
        const code = await runStopGate([], {manager, emit, readRaw: stdin('sess-a')})
        expect(code).toBe(EXIT.OK)
        expect(JSON.parse(at(out, 0))).toMatchObject({decision: 'block'})
        expect(at(out, 0)).toContain('/factory:resume')
        expect(owned.status).toBe('running') // no mutation of any kind
    })

    it('all-terminal run + stop_hook_active → OK, emits nothing (never a second block)', async () => {
        const {out, emit} = emitter()
        const owned = run({}, {a: task({task_id: 'a', status: 'done'})})
        const manager = {
            findActiveByOwner: (s: string) => Promise.resolve(s === 'sess-a' ? owned : null),
        }
        const code = await runStopGate([], {manager, emit, readRaw: stdin('sess-a', true)})
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([]) // hint goes to the log, never stdout
        expect(owned.status).toBe('running')
    })

    it("foreign corrupt run → allow (stop-gate never reads another session's run state)", async () => {
        // The cross-contamination scenario: a live run belonging to another session is
        // unreadable (schema mismatch, mid-write). listRuns() skips it with a log.warn,
        // findActiveByOwner returns null, and the gate allows — runs/current never touched.
        const {out, emit} = emitter()
        const code = await runStopGate([], {
            manager: {findActiveByOwner: () => Promise.resolve(null)},
            emit,
            readRaw: stdin('sess-a'),
        })
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([]) // allow — not our run
    })

    it('data-dir unreadable (non-ENOENT readdir failure) → block (local filesystem error)', async () => {
        // findActiveByOwner → listRuns → readdir fails: our OWN data directory is broken.
        // Foreign runs' unreadable state.json never causes a block (listRuns skips them).
        const {out, emit} = emitter()
        const code = await runStopGate([], {
            manager: {
                findActiveByOwner: () => {
                    throw new Error('EACCES: permission denied')
                },
            },
            emit,
            readRaw: stdin('sess-a'),
        })
        expect(code).toBe(EXIT.OK)
        expect(JSON.parse(at(out, 0))).toMatchObject({decision: 'block'})
        expect(at(out, 0)).toContain('run state')
        expect(at(out, 0)).not.toContain('runs/current') // must not blame a foreign pointer
    })

    it('data-dir unreadable + stop_hook_active → allow (the corruption block is also one-shot)', async () => {
        const {out, emit} = emitter()
        const code = await runStopGate([], {
            manager: {
                findActiveByOwner: () => {
                    throw new Error('EACCES: permission denied')
                },
            },
            emit,
            readRaw: stdin('sess-a', true),
        })
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([])
    })

    it('reads the stopping session_id from stdin → an unrelated session resolves nothing (owner-scoped)', async () => {
        const {out, emit} = emitter()
        const owner1 = run({owner_session: 'owner-1'}, {a: task({task_id: 'a', status: 'done'})})
        const manager = {
            // intruder-9 owns nothing; owner-1's run is stamped and not returned → pass through.
            findActiveByOwner: (s: string) => Promise.resolve(s === 'owner-1' ? owner1 : null),
        }
        const code = await runStopGate([], {
            manager,
            emit,
            readRaw: stdin('intruder-9'),
        })
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([]) // allow: a different session must not touch this run
        expect(owner1.status).toBe('running')
    })

    it('known stopper owning no run → allow (no global-pointer adoption)', async () => {
        // A known stopper with no active run passes through — runs/current is never consulted.
        const {out, emit} = emitter()
        const code = await runStopGate([], {
            manager: {findActiveByOwner: () => Promise.resolve(null)},
            emit,
            readRaw: stdin('sess-a'),
        })
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([])
    })

    it('unknown stopper (malformed stdin) → allow', async () => {
        // An unscoped stop (no session id parseable from stdin) resolves null and allows —
        // it no longer falls back to runs/current. The run stays resumable.
        const {out, emit} = emitter()
        const code = await runStopGate([], {
            manager: {findActiveByOwner: () => Promise.resolve(null)},
            emit,
            readRaw: () => Promise.resolve('}{ not json'),
        })
        expect(code).toBe(EXIT.OK)
        expect(out).toEqual([])
    })
})
