/**
 * `factory run <action>` CLI boundary (C6).
 *
 * Three surfaces:
 *   1. arg/usage edges via {@link runCommand}/{@link resumeCommand} (short-circuit
 *      before any wiring) + the mandatory autonomous-mode gate;
 *   2. the {@link runCreate} boundary over resolveOrCreateRun — exit codes, stdout
 *      envelopes, flag guards, and the create preconditions (S7 gate contract,
 *      S9 --approve-spec, D40 --e2e prerequisites) — plus repo auto-derive,
 *      session resolution, staging cut/protect, and {@link runCancel};
 *   3. CLI-level runDocs integration.
 * The lifecycle cores (seedTasksFromSpec / createRun / resolveOrCreateRun /
 * applyResume) are tested DIRECTLY in src/orchestrator/lifecycle.test.ts.
 */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {
    runCommand,
    resumeCommand,
    runCreate,
    runResume,
    runCancel,
    runStop,
    resolveOwnerSession,
    type RunCancelOverrides,
} from './run.js'
import {createRun, resolveOrCreateRun} from '../../orchestrator/lifecycle.js'
import {EXIT} from '../../shared/exit-codes.js'
import {nonNull} from '../../shared/index.js'
import {NotAutonomousError} from '../../autonomy/mode.js'
import {StateManager} from '../../core/state/manager.js'
import {SpecStore, parseSpecManifest, type SpecManifest} from '../../spec/index.js'
import {makePrd} from '../../orchestrator/orchestrator-fixtures.js'
import {FakeGitClient, FakeGhClient} from '../../git/index.js'
import {defaultConfig} from '../../config/schema.js'
import {runDocsEmit, runDocsRecord, type DocsRunDeps} from '../../orchestrator/docs.js'
import {makeTempDataDir, seedScaffoldRepo} from '../test-fixtures.js'
import {readMetrics} from '../../scoring/index.js'

const REPO = 'acme/widgets'

// `run create`/`run resume` now HALT unless the session is autonomous. Every
// existing create/resume test exercises the happy path, so make the whole file
// run as if launched autonomously; the dedicated suite below covers the negative.
// Also stamp a session id: session-mode run create now requires one (so the Stop
// hook can scope its run resolution via findActiveByOwner); the dedicated test
// below covers the no-session-id rejection.
let priorAutonomous: string | undefined
let priorSessionId: string | undefined
beforeEach(() => {
    priorAutonomous = process.env.FACTORY_AUTONOMOUS_MODE
    process.env.FACTORY_AUTONOMOUS_MODE = '1'
    priorSessionId = process.env.CLAUDE_CODE_SESSION_ID
    process.env.CLAUDE_CODE_SESSION_ID = 'test-session'
})
afterEach(async () => {
    if (priorAutonomous === undefined) {
        delete process.env.FACTORY_AUTONOMOUS_MODE
    } else {
        process.env.FACTORY_AUTONOMOUS_MODE = priorAutonomous
    }
    if (priorSessionId === undefined) {
        delete process.env.CLAUDE_CODE_SESSION_ID
    } else {
        process.env.CLAUDE_CODE_SESSION_ID = priorSessionId
    }
    await Promise.all(contractCwds.splice(0).map((d) => rm(d, {recursive: true, force: true})))
})

/**
 * Temp cwd carrying a valid `.factory/gates.json`, marked git-tracked on the
 * fake — satisfies the S7 create precondition (present + valid + tracked).
 * Dirs are cleaned in the file-level afterEach.
 */
const contractCwds: string[] = []
async function contractReadyCwd(git: FakeGitClient): Promise<string> {
    const cwd = await mkdtemp(join(tmpdir(), 'factory-contract-cwd-'))
    contractCwds.push(cwd)
    await seedScaffoldRepo(cwd)
    git.trackedPaths.add('.factory/gates.json')
    return cwd
}

/** Temp cwd carrying the three static `--e2e` prerequisites (Decision 40 D2) + the gate contract. */
async function playwrightReadyCwd(git: FakeGitClient): Promise<string> {
    const cwd = await contractReadyCwd(git)
    await seedScaffoldRepo(cwd, {gates: false, playwright: true})
    return cwd
}

/** Build one durable spec task with overridable fields. */
function task(id: string, deps: string[] = [], opts: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        task_id: id,
        title: `task ${id}`,
        description: `does ${id}`,
        files: [`src/${id}.ts`],
        acceptance_criteria: ['a'],
        tests_to_write: ['covers it'],
        depends_on: deps,
        risk_tier: 'medium',
        risk_rationale: 'moderate',
        ...opts,
    }
}

/** A durable spec request (issue 42 → spec_id "42-checkout") over the given tasks. */
function request(tasks: readonly Record<string, unknown>[]): SpecManifest {
    return parseSpecManifest({
        spec_id: '42-checkout',
        issue_number: 42,
        slug: 'checkout',
        repo: REPO,
        generated_at: '2026-06-01T00:00:00.000Z',
        tasks,
    })
}

// ---------------------------------------------------------------------------
// arg/usage edges
// ---------------------------------------------------------------------------

describe('mandatory autonomous-mode gate', () => {
    // Override the file-level seam: the inner beforeEach runs AFTER the outer one,
    // so deleting the var here reverts each test to a non-autonomous session.
    beforeEach(() => {
        delete process.env.FACTORY_AUTONOMOUS_MODE
    })

    it('runCreate refuses to start a run outside autonomous mode', async () => {
        await expect(runCreate(['--issue', '42'])).rejects.toBeInstanceOf(NotAutonomousError)
    })

    it('runResume refuses to resume a run outside autonomous mode', async () => {
        // The gate fires before any run resolution, so no --run / fixtures are needed;
        // NotAutonomousError bubbles uncaught through resumeCommand (not a UsageError).
        await expect(resumeCommand.run([])).rejects.toBeInstanceOf(NotAutonomousError)
    })

    it("the gate is exactly FACTORY_AUTONOMOUS_MODE === '1' (no bypass value)", async () => {
        process.env.FACTORY_AUTONOMOUS_MODE = 'true'
        await expect(runCreate(['--issue', '42'])).rejects.toBeInstanceOf(NotAutonomousError)
    })

    it('--help short-circuits BEFORE the gate (help works in any session)', async () => {
        await expect(runCreate(['--help'])).resolves.toBe(EXIT.OK)
    })
})

describe('run arg/usage edges', () => {
    it('no action prints help and exits OK', async () => {
        expect(await runCommand.run([])).toBe(EXIT.OK)
    })
    it('--help prints help and exits OK', async () => {
        expect(await runCommand.run(['--help'])).toBe(EXIT.OK)
    })
    it('an unknown action is a usage error', async () => {
        expect(await runCommand.run(['frobnicate'])).toBe(EXIT.USAGE)
    })
    it('e2e-assess: --help prints help and exits OK (dispatcher wired, Decision 40)', async () => {
        expect(await runCommand.run(['e2e-assess', '--help'])).toBe(EXIT.OK)
    })

    it('create: neither --issue nor --spec-id is a usage error', async () => {
        expect(await runCommand.run(['create', '--repo', REPO])).toBe(EXIT.USAGE)
    })
    it('create: both --issue and --spec-id is a usage error', async () => {
        expect(await runCommand.run(['create', '--repo', REPO, '--issue', '1', '--spec-id', '1-x'])).toBe(EXIT.USAGE)
    })
    it('create: a non-numeric --issue is a usage error', async () => {
        expect(await runCommand.run(['create', '--repo', REPO, '--issue', 'abc'])).toBe(EXIT.USAGE)
    })
    it('create: --help prints help and exits OK', async () => {
        expect(await runCommand.run(['create', '--help'])).toBe(EXIT.OK)
    })
    it('create: --resume + --no-ship is a usage error (ship flag on a resume path)', async () => {
        expect(await runCommand.run(['create', '--repo', REPO, '--issue', '1', '--resume', '--no-ship'])).toBe(
            EXIT.USAGE
        )
    })
    it('resume: --no-ship is a usage error (ship_mode is persisted, never re-passed)', async () => {
        expect(await resumeCommand.run(['--no-ship'])).toBe(EXIT.USAGE)
    })
    it('resume: --help prints help and exits OK', async () => {
        expect(await resumeCommand.run(['--help'])).toBe(EXIT.OK)
    })
    it("'run resume' is no longer an action — unknown-action usage error", async () => {
        expect(await runCommand.run(['resume'])).toBe(EXIT.USAGE)
    })
    it('finalize: --help prints help and exits OK', async () => {
        expect(await runCommand.run(['finalize', '--help'])).toBe(EXIT.OK)
    })
    it('docs: --help prints help and exits OK', async () => {
        expect(await runCommand.run(['docs', '--help'])).toBe(EXIT.OK)
    })
    it('traceability: --help prints help and exits OK (S9, Decision 47)', async () => {
        expect(await runCommand.run(['traceability', '--help'])).toBe(EXIT.OK)
    })
    it('e2e: --help prints help and exits OK', async () => {
        expect(await runCommand.run(['e2e', '--help'])).toBe(EXIT.OK)
    })
})

// ---------------------------------------------------------------------------
// runCreate boundary over resolveOrCreateRun: exit codes, stdout envelopes,
// flag guards, and the create preconditions (Decision 35, S9, S7, D40)
// ---------------------------------------------------------------------------

describe('runCreate boundary (Decision 35)', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-run-boundary-')
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', []), task('t2', ['t1'])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    // -------------------------------------------------------------------------
    // runCreate boundary: kind:"exists" → EXIT.CONFLICT + structured envelope
    // -------------------------------------------------------------------------

    it("runCreate: active run + no flag → EXIT.CONFLICT (3) + kind:'exists' envelope on stdout (Task 4.2)", async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)
        // run-a is created with the defaults (session + live).
        await runCreate(['--issue', '42', '--run-id', 'run-a'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        // Capture stdout to assert the structured envelope.
        const stdoutChunks: string[] = []
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            stdoutChunks.push(String(chunk))
            return true
        })
        // Suppress stderr noise from emitError.
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

        let exitCode: number | undefined
        try {
            exitCode = await runCreate(['--issue', '42'], {
                gitClient: git,
                ghClient: gh,
                cwd,
                dataDir,
            })
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
        }

        // Must return EXIT.CONFLICT (3), not throw.
        expect(exitCode).toBe(EXIT.CONFLICT)

        // Stdout must carry a kind:"exists" envelope with the active run id.
        const emitted = JSON.parse(stdoutChunks.join('')) as Record<string, unknown>
        expect(emitted.kind).toBe('exists')
        expect((emitted.existing as Record<string, unknown>).run_id).toBe('run-a')
    })

    it("runCreate: 7d-parked run → EXIT.CONFLICT + kind:'pause' envelope (quota-block branch)", async () => {
        // Seed run-old as suspended with a 7d quota checkpoint (future resets_at_epoch).
        await resolveOrCreateRun(state, store, {repo: REPO, issue: 42, runId: 'run-old'})
        await state.update('run-old', (s) => ({
            ...s,
            status: 'suspended',
            quota: {binding_window: '7d' as const, resets_at_epoch: 9_999_999_999},
        }))

        const stdoutChunks: string[] = []
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            stdoutChunks.push(String(chunk))
            return true
        })
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)

        let exitCode: number | undefined
        try {
            exitCode = await runCreate(['--issue', '42'], {
                gitClient: git,
                ghClient: gh,
                cwd,
                dataDir,
            })
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
        }

        expect(exitCode).toBe(EXIT.CONFLICT)
        const env = JSON.parse(stdoutChunks.join('')) as Record<string, unknown>
        expect(env.kind).toBe('pause')
        expect(env.scope).toBe('7d')
        expect(env.run_id).toBe('run-old')
    })

    // -------------------------------------------------------------------------
    // runCreate --approve-spec (S9, Decision 47): opt-in human sign-off park
    // -------------------------------------------------------------------------

    async function captureCreate(argv: string[], overrides: Record<string, unknown>) {
        const stdoutChunks: string[] = []
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
            stdoutChunks.push(String(chunk))
            return true
        })
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        try {
            const exitCode = await runCreate(argv, overrides)
            return {exitCode, env: JSON.parse(stdoutChunks.join('')) as Record<string, unknown>}
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
        }
    }

    it('--approve-spec parks the fully-created run: suspended, NO quota (A2), spec_approval envelope, EXIT.OK', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)

        const {exitCode, env} = await captureCreate(['--issue', '42', '--run-id', 'run-park', '--approve-spec'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        expect(exitCode).toBe(EXIT.OK) // a park is success, not an error
        expect(env.kind).toBe('created')
        const approval = env.spec_approval as Record<string, unknown>
        expect(String(approval.spec_path)).toMatch(/42-checkout[/\\]spec\.md$/)
        expect(String(approval.note)).toContain('factory resume')

        const parked = await state.read('run-park')
        expect(parked.status).toBe('suspended')
        expect(parked.quota).toBeUndefined() // A2: non-quota park NEVER writes a checkpoint
        // Full creation happened BEFORE the park — staging cut + tasks seeded.
        expect(Object.keys(parked.tasks).length).toBeGreaterThan(0)
    })

    it('--approve-spec is default OFF: plain create stays running with no spec_approval', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)

        const {exitCode, env} = await captureCreate(['--issue', '42', '--run-id', 'run-plain'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        expect(exitCode).toBe(EXIT.OK)
        expect(env.spec_approval).toBeUndefined()
        expect((await state.read('run-plain')).status).toBe('running')
    })

    it('created envelope carries the enumerated gates-in-force (S3)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)

        const {env} = await captureCreate(['--issue', '42', '--run-id', 'run-gates'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        const gates = env.gates as {contracted: string[]; skipped: {id: string}[]; warnings: string[]}
        expect(gates.contracted).toEqual(['test', 'tdd', 'type', 'build'])
        expect(gates.skipped.map((s) => s.id)).toEqual(['coverage', 'mutation', 'sast', 'lint'])
        expect(gates.warnings).toEqual([]) // full floor → no misconfig warning
    })

    it('warns (stderr + envelope) when a floor gate is dropped from the contract (S3)', async () => {
        const droppedFloor = JSON.stringify({
            version: 1,
            stack: 'npm',
            gates: {
                test: {contracted: true},
                tdd: {contracted: false, reason: 'operator dropped it'},
                coverage: {contracted: false, reason: 'x'},
                mutation: {contracted: false, reason: 'x'},
                sast: {contracted: false, reason: 'x'},
                type: {contracted: true},
                lint: {contracted: false, reason: 'x'},
                build: {contracted: true},
            },
        })
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await mkdtemp(join(tmpdir(), 'factory-contract-cwd-'))
        contractCwds.push(cwd)
        await seedScaffoldRepo(cwd, {gates: droppedFloor})
        git.trackedPaths.add('.factory/gates.json')

        const stderrChunks: string[] = []
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
            stderrChunks.push(String(c))
            return true
        })
        const stdoutChunks: string[] = []
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            stdoutChunks.push(String(c))
            return true
        })
        try {
            await runCreate(['--issue', '42', '--run-id', 'run-dropped'], {gitClient: git, ghClient: gh, cwd, dataDir})
        } finally {
            stderrSpy.mockRestore()
            stdoutSpy.mockRestore()
        }

        expect(stderrChunks.join('')).toMatch(/run create: default-set gate 'tdd' is not contracted/)
        const env = JSON.parse(stdoutChunks.join('')) as Record<string, unknown>
        const gates = env.gates as {warnings: string[]}
        expect(gates.warnings).toHaveLength(1)
    })

    it('--approve-spec --resume → UsageError (approval is create-only; resume IS the sign-off)', async () => {
        const create = runCreate(['--issue', '42', '--approve-spec', '--resume'])
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/approve-spec/)
    })

    it('--approve-spec composes with --supersede: the FRESH run is parked', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)
        await runCreate(['--issue', '42', '--run-id', 'run-old-a'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        // No --run-id: an explicit id selects the `fresh` intent, which excludes --supersede.
        const {exitCode, env} = await captureCreate(['--issue', '42', '--supersede', '--approve-spec'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })

        expect(exitCode).toBe(EXIT.OK)
        expect(env.kind).toBe('superseded')
        expect((env.spec_approval as Record<string, unknown>).spec_path).toBeDefined()
        const freshId = (env.run as Record<string, unknown>).run_id as string
        expect((await state.read(freshId)).status).toBe('suspended')
        expect((await state.read('run-old-a')).status).toBe('superseded')
    })

    it('runCreate: without session id → UsageError (Stop hook needs an owner; no exemptions)', async () => {
        // The file-level beforeEach sets CLAUDE_CODE_SESSION_ID; delete it to simulate a
        // bare invocation with no owner available.
        delete process.env.CLAUDE_CODE_SESSION_ID
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const create = runCreate(['--issue', '42'], {gitClient: git, ghClient: gh, cwd: '/x', dataDir})
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/runs require an owning session id/)
    })

    it('runCreate: --supersede + --resume together → UsageError (at most one)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        await expect(
            runCreate(['--issue', '42', '--supersede', '--resume'], {
                gitClient: git,
                ghClient: gh,
                cwd: '/x',
                dataDir,
            })
        ).rejects.toMatchObject({isUsageError: true})
    })

    it('runCreate: --resume + --e2e → UsageError naming the create-only flags (root-cause guard)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const create = runCreate(['--issue', '42', '--resume', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd: '/x',
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/create-only and cannot combine with --resume/)
    })

    it('runCreate: --supersede replaces the active run (guard is scoped to --resume)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)
        await runCreate(['--issue', '42', '--run-id', 'run-old'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        // No --run-id on the supersede call: an explicit id means "fresh" and would
        // collide with --supersede (picked.length > 1). The superseding run gets a
        // generated id, which we resolve back out of the run list.
        const code = await runCreate(['--issue', '42', '--supersede'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-old')).status).toBe('superseded')
        const fresh = (await state.listRuns()).find((r) => r.run_id !== 'run-old')
        expect(fresh?.status).toBe('running')
    })

    it('runCreate: --ignore-quota → fresh run is born with ignore_quota:true (persistence guard)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const code = await runCreate(['--issue', '42', '--run-id', 'run-iq', '--ignore-quota'], {
            gitClient: git,
            ghClient: gh,
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-iq')).ignore_quota).toBe(true)
    })

    it('runCreate: --e2e → fresh run is born with e2e:true (persistence guard)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        const code = await runCreate(['--issue', '42', '--run-id', 'run-e2e', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-e2e')).e2e).toBe(true)
    })

    it('runCreate: --e2e in a repo WITHOUT the Playwright prerequisites → UsageError naming factory scaffold (Decision 40 D2 eager check)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const bare = await mkdtemp(join(tmpdir(), 'factory-e2e-bare-'))
        try {
            const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-bare', '--e2e'], {
                gitClient: git,
                ghClient: gh,
                cwd: bare,
                dataDir,
            })
            await expect(create).rejects.toMatchObject({isUsageError: true})
            await expect(create).rejects.toThrow(/factory scaffold/)
        } finally {
            await rm(bare, {recursive: true, force: true})
        }
    })

    it('runCreate: --e2e with playwright.config.ts but no @playwright/test dependency → UsageError naming the missing dep', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await mkdtemp(join(tmpdir(), 'factory-e2e-nodep-'))
        try {
            await writeFile(join(cwd, 'package.json'), JSON.stringify({name: 't'}))
            await writeFile(join(cwd, 'playwright.config.ts'), 'export default {};\n')
            const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-nodep', '--e2e'], {
                gitClient: git,
                ghClient: gh,
                cwd,
                dataDir,
            })
            await expect(create).rejects.toMatchObject({isUsageError: true})
            await expect(create).rejects.toThrow(/@playwright\/test/)
        } finally {
            await rm(cwd, {recursive: true, force: true})
        }
    })

    it('runCreate: --e2e with a MALFORMED package.json → UsageError names the parse failure, not a missing dep (report L128)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await mkdtemp(join(tmpdir(), 'factory-e2e-badpkg-'))
        try {
            // Trailing comma → won't parse, yet @playwright/test IS declared: the honest
            // error must name the parse failure, never diagnose a missing dependency.
            await writeFile(join(cwd, 'package.json'), '{"devDependencies": {"@playwright/test": "^1.0.0"},}')
            await writeFile(join(cwd, 'playwright.config.ts'), 'export default {};\n')
            const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-badpkg', '--e2e'], {
                gitClient: git,
                ghClient: gh,
                cwd,
                dataDir,
            })
            await expect(create).rejects.toMatchObject({isUsageError: true})
            await expect(create).rejects.toThrow(/not valid JSON/)
            await expect(create).rejects.not.toThrow(/@playwright\/test \(dependencies/)
        } finally {
            await rm(cwd, {recursive: true, force: true})
        }
    })

    it('S4: --e2e with a NONSTANDARD playwright testDir → UsageError naming the TCB-covered path', async () => {
        // A suite outside the literal e2e/ dir would be write-open to the implementer
        // (TCB rule 3b protects the literal path only) — refuse before the run is born.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        await writeFile(join(cwd, 'playwright.config.ts'), "export default {testDir: 'tests/e2e'};\n")
        const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-dir', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/testDir 'tests\/e2e'/)
    })

    it('S4: --e2e with NO testDir declaration → UsageError (fail-closed: Playwright defaults to tests/)', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        await writeFile(join(cwd, 'playwright.config.ts'), 'export default {};\n')
        const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-nodir', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/no testDir declaration/)
    })

    it("S4: --e2e accepts the bare 'e2e' testDir spelling", async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        await writeFile(join(cwd, 'playwright.config.ts'), "export default {testDir: 'e2e'};\n")
        const code = await runCreate(['--issue', '42', '--run-id', 'run-e2e-bare-dir', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
    })

    it('S4: --e2e with a multi-project testDir config → UsageError (ambiguous, no first-match false-accept)', async () => {
        // Before the hardening, .exec's first-match semantics would ACCEPT this config
        // (the first testDir is 'e2e') even though the second project's real suite
        // ('tests') lives outside the TCB-covered e2e/ path.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        await writeFile(
            join(cwd, 'playwright.config.ts'),
            "export default {projects: [{testDir: 'e2e'}, {testDir: 'tests'}]};\n"
        )
        const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-multi', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/declare testDir exactly once/)
    })

    it('S4: --e2e with a decoy testDir comment ahead of the real declaration → UsageError (ambiguous)', async () => {
        // A leading `// testDir: 'e2e'` comment would otherwise satisfy .exec's
        // first-match check while the REAL testDir ('tests') governs at runtime.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const cwd = await playwrightReadyCwd(git)
        await writeFile(join(cwd, 'playwright.config.ts'), "// testDir: 'e2e'\nexport default {testDir: 'tests'};\n")
        const create = runCreate(['--issue', '42', '--run-id', 'run-e2e-decoy', '--e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/declare testDir exactly once/)
    })

    it('runCreate: no --e2e → run defaults to e2e:false', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        const code = await runCreate(['--issue', '42', '--run-id', 'run-no-e2e'], {
            gitClient: git,
            ghClient: gh,
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-no-e2e')).e2e).toBe(false)
    })

    // -------------------------------------------------------------------------
    // gate-contract precondition (S7, Decision 46) — present + valid + tracked
    // -------------------------------------------------------------------------

    it('runCreate: ABSENT .factory/gates.json → UsageError naming factory scaffold', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const bare = await mkdtemp(join(tmpdir(), 'factory-nocontract-'))
        contractCwds.push(bare)
        const create = runCreate(['--issue', '42', '--run-id', 'run-nc'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: bare,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/missing \.factory\/gates\.json.*factory scaffold/s)
    })

    it('runCreate: INVALID contract → UsageError surfacing the parse error', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const cwd = await contractReadyCwd(git)
        await writeFile(join(cwd, '.factory', 'gates.json'), '{ nope')
        const create = runCreate(['--issue', '42', '--run-id', 'run-ic'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/invalid \.factory\/gates\.json.*not JSON/s)
    })

    it('runCreate: present + valid but NOT git-tracked → UsageError naming commit', async () => {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const cwd = await contractReadyCwd(git)
        git.trackedPaths.delete('.factory/gates.json')
        const create = runCreate(['--issue', '42', '--run-id', 'run-ut'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd,
            dataDir,
        })
        await expect(create).rejects.toMatchObject({isUsageError: true})
        await expect(create).rejects.toThrow(/not git-tracked.*commit it/s)
    })

    it('runCreate: --resume DEMANDS the contract precondition (checked on every intent)', async () => {
        // Born WITH a contract, resumed from a cwd WITHOUT one — the resume path
        // fails loud too: a resumed run's sweeps need the contract just the same.
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        const gh = new FakeGhClient()
        await runCreate(['--issue', '42', '--run-id', 'run-pre'], {
            gitClient: git,
            ghClient: gh,
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        const bare = await mkdtemp(join(tmpdir(), 'factory-resume-bare-'))
        contractCwds.push(bare)
        const resume = runCreate(['--issue', '42', '--resume'], {
            gitClient: git,
            ghClient: gh,
            cwd: bare,
            dataDir,
        })
        await expect(resume).rejects.toMatchObject({isUsageError: true})
        await expect(resume).rejects.toThrow(/missing .*gates\.json.*factory scaffold/s)
    })
})

// ---------------------------------------------------------------------------
// runCreate — auto-derive --repo from the origin remote (Prompt G / F-repo)
// ---------------------------------------------------------------------------

describe('runCreate auto-derives --repo from the origin remote', () => {
    let dataDir: string

    /**
     * A FakeGitClient whose origin remote-url resolves to the given slug AND whose
     * origin has a `develop` branch seeded — required because `runCreate` now cuts
     * `staging/<run-id>` from `origin/develop` (Decision 33).
     */
    function gitWithOrigin(slug: string): FakeGitClient {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${slug}.git`)
        return git
    }

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-run-derive-'))
        const store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', [])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('no --repo flag → derives the repo from origin and creates the run', async () => {
        const git = gitWithOrigin(REPO)
        const code = await runCreate(['--issue', '42', '--run-id', 'run-derive'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        const state = new StateManager({dataDir})
        expect((await state.read('run-derive')).spec.repo).toBe(REPO)
    })

    it("an EMPTY --repo '' is treated as absent → derives from origin", async () => {
        // End-to-end: `--repo ""` must not be taken as a literal slug. Two guards make it
        // absent — optionalString coerces ""→undefined (unit-tested in args.test.ts) AND
        // resolveRepo treats an empty explicit as not-derivable — so either way resolution
        // falls through to the origin-derive path. This pins the user-visible outcome.
        const git = gitWithOrigin(REPO)
        const code = await runCreate(['--repo', '', '--issue', '42', '--run-id', 'run-empty'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        const state = new StateManager({dataDir})
        expect((await state.read('run-empty')).spec.repo).toBe(REPO)
    })

    it('an explicit --repo that MATCHES the origin (case-insensitively) creates the run', async () => {
        // REPO is "acme/widgets"; the origin canonical casing wins, so the spec stored
        // under REPO is found and the run is keyed to the canonical repo id.
        const git = gitWithOrigin(REPO)
        const code = await runCreate(['--repo', 'Acme/Widgets', '--issue', '42', '--run-id', 'run-m'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        const state = new StateManager({dataDir})
        expect((await state.read('run-m')).spec.repo).toBe(REPO)
    })

    it('an explicit --repo that MISMATCHES the origin remote throws LOUD naming both', async () => {
        await expect(
            runCreate(['--repo', 'acme/other', '--issue', '42', '--run-id', 'run-x'], {
                gitClient: gitWithOrigin(REPO),
                ghClient: new FakeGhClient(),
                cwd: '/wherever',
                dataDir,
            })
        ).rejects.toThrow(/acme\/other.*acme\/widgets|acme\/widgets.*acme\/other/s)
    })

    it('the mismatch is surfaced as EXIT.USAGE through the command wrapper', async () => {
        // runCommand.run maps the UsageError to EXIT.USAGE; we assert the exit-code path
        // here while driving the resolution via the injected fake (no real git).
        await expect(
            runCreate(['--repo', 'acme/other', '--issue', '42'], {
                gitClient: gitWithOrigin(REPO),
                ghClient: new FakeGhClient(),
                cwd: '/wherever',
                dataDir,
            })
        ).rejects.toMatchObject({isUsageError: true})
    })

    it('no ship flag → persists the no-flag default: live', async () => {
        const git = gitWithOrigin(REPO)
        const code = await runCreate(['--issue', '42', '--run-id', 'run-def'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)
        const run = await new StateManager({dataDir}).read('run-def')
        expect(run.ship_mode).toBe('live')
    })

    it('--no-ship flips ship_mode to no-merge', async () => {
        const git = gitWithOrigin(REPO)
        await runCreate(['--issue', '42', '--run-id', 'run-ns', '--no-ship'], {
            gitClient: git,
            ghClient: new FakeGhClient(),
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        const run = await new StateManager({dataDir}).read('run-ns')
        expect(run.ship_mode).toBe('no-merge')
    })
})

// ---------------------------------------------------------------------------
// resolveOwnerSession — flag-over-env precedence (Prompt J, session-scoped gate)
// ---------------------------------------------------------------------------

describe('resolveOwnerSession', () => {
    it('prefers the explicit --session-id flag over the env var', () => {
        expect(resolveOwnerSession('sess-flag', {CLAUDE_CODE_SESSION_ID: 'sess-env'})).toBe('sess-flag')
    })

    it('falls back to CLAUDE_CODE_SESSION_ID when the flag is absent', () => {
        expect(resolveOwnerSession(undefined, {CLAUDE_CODE_SESSION_ID: 'sess-env'})).toBe('sess-env')
    })

    it('returns undefined when neither flag nor env is set (resolver is lenient; runCreate guards session-mode)', () => {
        expect(resolveOwnerSession(undefined, {})).toBeUndefined()
    })

    it('treats a bare boolean flag as absent and falls back to env', () => {
        expect(resolveOwnerSession(true, {CLAUDE_CODE_SESSION_ID: 'sess-env'})).toBe('sess-env')
    })

    it('treats an empty-string flag/env as absent (degrades to owner-unknown)', () => {
        expect(resolveOwnerSession('', {CLAUDE_CODE_SESSION_ID: ''})).toBeUndefined()
        expect(resolveOwnerSession('', {CLAUDE_CODE_SESSION_ID: 'sess-env'})).toBe('sess-env')
    })
})

// ---------------------------------------------------------------------------
// runCancel — abandon a live run so the Stop gate releases the owning session
// ---------------------------------------------------------------------------
// The "stuck Stop-gate" trap: a live run (a task still executing) left the owning
// session unable to end, with no in-session escape. `cancel` marks the run terminal
// (reuses `failed`) via the one sanctioned writer — works WITH a task executing (the
// exact mechanism `--supersede` uses), so the gate stops blocking. See Decision 35.
describe('runCancel (abandon a live run, Decision 35)', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-run-cancel-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', []), task('t2', ['t1'])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    /** Seed a run (status `running`) for the durable spec; optionally stamp an owner. */
    async function seed(runId: string, owner?: string): Promise<void> {
        await createRun(state, store, {
            repo: REPO,
            issue: 42,
            runId,
            ...(owner !== undefined ? {ownerSession: owner} : {}),
        })
    }

    /** Force a seeded task into `executing` — the exact in-flight state that traps finalize. */
    async function setExecuting(runId: string, taskId: string): Promise<void> {
        await state.update(runId, (s) => ({
            ...s,
            tasks: {
                ...s.tasks,
                [taskId]: {...nonNull(s.tasks[taskId]), status: 'executing' as const, phase: 'exec' as const},
            },
        }))
    }

    /** Run cancel; capture stdout (the JSON envelope) + stderr (the loud line) + exit code. */
    async function cancel(
        argv: string[],
        overrides: RunCancelOverrides
    ): Promise<{env: Record<string, unknown>; code: number; stderr: string}> {
        const chunks: string[] = []
        const errChunks: string[] = []
        const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            chunks.push(String(c))
            return true
        })
        const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
            errChunks.push(String(c))
            return true
        })
        let code: number
        try {
            code = await runCancel(argv, overrides)
        } finally {
            out.mockRestore()
            err.mockRestore()
        }
        return {
            env: JSON.parse(chunks.join('')) as Record<string, unknown>,
            code,
            stderr: errChunks.join(''),
        }
    }

    it('cancels a run with a task still executing → status failed (the headline trap)', async () => {
        await seed('run-live')
        await setExecuting('run-live', 't1')

        const {env, code} = await cancel(['--run', 'run-live'], {dataDir})

        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('cancelled')
        expect((env.run as Record<string, unknown>).status).toBe('failed')
        // The decoupling the fix relies on: finalize(…, "failed") does NOT inspect tasks,
        // so an executing T1 is no barrier (the same path --supersede already takes).
        expect((await state.read('run-live')).status).toBe('failed')
    })

    it('is idempotent — re-cancelling a failed run stays failed and exits OK', async () => {
        await seed('run-i')
        await cancel(['--run', 'run-i'], {dataDir}) // first
        const {code} = await cancel(['--run', 'run-i'], {dataDir}) // re-cancel
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-i')).status).toBe('failed')
    })

    it('is LOUD when the run is already terminal as completed (cannot re-finalize as failed)', async () => {
        await seed('run-done')
        await state.finalize('run-done', 'completed')
        // Not a UsageError — the manager's "already terminal as X" guard bubbles uncaught.
        await expect(runCancel(['--run', 'run-done'], {dataDir})).rejects.toThrow(/already terminal/)
    })

    it('resolves the run THIS session owns (owner-scan) over a repointed runs/current', async () => {
        // run-A (repo acme/widgets, owned sess-1) is the one to cancel. run-B lives in a
        // DIFFERENT repo (the engine forbids two live same-repo runs from different sessions)
        // and, created last, becomes the GLOBAL current pointer. So the current fallback would
        // resolve run-B — owner-scan must win and cancel run-A instead (the stuck-session
        // condition: the run is found by owner_session, independent of runs/current).
        const otherRepo = 'other/svc'
        await store.write(
            parseSpecManifest({
                spec_id: '99-other',
                issue_number: 99,
                slug: 'other',
                repo: otherRepo,
                generated_at: '2026-06-01T00:00:00.000Z',
                tasks: [task('t1', [])],
            }),
            '# spec\n',
            makePrd()
        )
        await seed('run-A', 'sess-1')
        await createRun(state, store, {
            repo: otherRepo,
            issue: 99,
            runId: 'run-B',
            ownerSession: 'sess-2',
        })
        await setExecuting('run-A', 't1')

        // No --run; non-repo cwd → the current fallback resolves the global pointer (run-B).
        await cancel(['--session-id', 'sess-1'], {dataDir, cwd: dataDir})

        expect((await state.read('run-A')).status).toBe('failed')
        expect((await state.read('run-B')).status).toBe('running')
    })

    it('is LOUD when the session owns ≥2 live runs — refuses to guess, demands --run', async () => {
        // Two live runs owned by ONE session, in different repos (the engine forbids two
        // live same-repo runs from different sessions). Without --run, cancel must NOT guess
        // which to abandon — a wrong-run finalize is unrecoverable — so it surfaces BOTH
        // candidates and requires --run, never silently falling through to runs/current.
        const otherRepo = 'other/svc'
        await store.write(
            parseSpecManifest({
                spec_id: '99-other',
                issue_number: 99,
                slug: 'other',
                repo: otherRepo,
                generated_at: '2026-06-01T00:00:00.000Z',
                tasks: [task('t1', [])],
            }),
            '# spec\n',
            makePrd()
        )
        await seed('run-m1', 'sess-multi')
        await createRun(state, store, {
            repo: otherRepo,
            issue: 99,
            runId: 'run-m2',
            ownerSession: 'sess-multi',
        })

        let caught: unknown
        try {
            await runCancel(['--session-id', 'sess-multi'], {dataDir, cwd: dataDir})
        } catch (e) {
            caught = e
        }
        expect((caught as {isUsageError?: boolean}).isUsageError).toBe(true)
        // The message names BOTH candidates so the operator can pick one with --run.
        expect((caught as Error).message).toContain('run-m1')
        expect((caught as Error).message).toContain('run-m2')
        // Neither run was finalized — no wrong-run guess slipped through.
        expect((await state.read('run-m1')).status).toBe('running')
        expect((await state.read('run-m2')).status).toBe('running')
    })

    /** A FakeGitClient whose origin resolves to REPO, so readCurrentForCwd hits the per-repo pointer. */
    function gitInRepo(): FakeGitClient {
        const git = new FakeGitClient()
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        return git
    }

    it('falls through to the repo current run when the given session owns nothing (0-owned, not ambiguous)', async () => {
        await seed('run-cur0') // no owner stamped
        await setExecuting('run-cur0', 't1')
        // sess-none owns nothing → owner-scan yields 0 (NOT ambiguous) → the repo's current pointer wins.
        await cancel(['--session-id', 'sess-none'], {dataDir, cwd: dataDir, gitClient: gitInRepo()})
        expect((await state.read('run-cur0')).status).toBe('failed')
    })

    it('falls back to the repo current run when neither --run nor a session id is given', async () => {
        await seed('run-cur')
        await setExecuting('run-cur', 't1')
        await cancel([], {dataDir, cwd: dataDir, gitClient: gitInRepo()})
        expect((await state.read('run-cur')).status).toBe('failed')
    })

    it('is a usage error when no run can be resolved (no --run, no owner, no current)', async () => {
        await expect(runCancel([], {dataDir, cwd: dataDir})).rejects.toMatchObject({
            isUsageError: true,
        })
    })

    it('leaves the staging branch + task PRs untouched by default (no --cleanup)', async () => {
        await seed('run-keep')
        const gh = new FakeGhClient()
        const {env} = await cancel(['--run', 'run-keep'], {dataDir, ghClient: gh})
        expect(env.cleaned_up).toBe(false)
        expect(gh.deletedBranches).toHaveLength(0)
        expect(gh.protectionDeletes).toHaveLength(0)
    })

    it('--cleanup tears down protection then the pinned staging branch (auto-closing task PRs)', async () => {
        await seed('run-clean')
        await setExecuting('run-clean', 't1')
        const gh = new FakeGhClient()
        const {env} = await cancel(['--run', 'run-clean', '--cleanup'], {dataDir, ghClient: gh})

        expect(env.cleaned_up).toBe(true)
        expect(env.cleanup_error).toBeUndefined() // honest envelope: clean run carries no error
        expect(gh.protectionDeletes).toContain('staging-run-clean')
        expect(gh.deletedBranches).toContain('staging-run-clean')
        // Protection BEFORE branch delete (GitHub blocks deleting a protected ref). Assert on
        // the SINGLE ordered `calls` log — comparing indices across two separate arrays would
        // be a tautology (each is 0 in its own array).
        const protIdx = gh.calls.indexOf('api DELETE protection staging-run-clean')
        const branchIdx = gh.calls.indexOf('api DELETE refs/heads/staging-run-clean')
        expect(protIdx).toBeGreaterThanOrEqual(0)
        expect(protIdx).toBeLessThan(branchIdx)
    })

    it('--cleanup throw on deleteProtection: run still failed, exit OK, loud + honest envelope', async () => {
        await seed('run-fp')
        const gh = new FakeGhClient()
        gh.failDeleteProtection = new Error('HTTP 403: Resource not accessible by integration')
        const {env, code, stderr} = await cancel(['--run', 'run-fp', '--cleanup'], {
            dataDir,
            ghClient: gh,
        })

        // PRIMARY contract met despite the teardown failure: the run is terminal, gate released.
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-fp')).status).toBe('failed')
        // Envelope is honest: cleanup did NOT complete, and the real error is surfaced.
        expect(env.cleaned_up).toBe(false)
        expect(env.cleanup_error).toContain('403')
        // Protection threw FIRST → the branch delete was never reached.
        expect(gh.deletedBranches).toHaveLength(0)
        // LOUD on stderr, with the branch and a safe-retry hint (not a silent swallow).
        expect(stderr).toContain('staging-run-fp')
        expect(stderr).toContain('--run run-fp --cleanup')
    })

    it('--cleanup throw on deleteRemoteBranch (after protection succeeded): same honest exit', async () => {
        await seed('run-fb')
        const gh = new FakeGhClient()
        gh.failDeleteRemoteBranch = new Error('HTTP 500: server error')
        const {env, code, stderr} = await cancel(['--run', 'run-fb', '--cleanup'], {
            dataDir,
            ghClient: gh,
        })

        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-fb')).status).toBe('failed')
        expect(env.cleaned_up).toBe(false)
        expect(env.cleanup_error).toContain('500')
        // Protection ran first and SUCCEEDED; only the branch delete failed.
        expect(gh.protectionDeletes).toContain('staging-run-fb')
        expect(gh.deletedBranches).toHaveLength(0)
        expect(stderr).toContain('retry the teardown')
    })

    it('works OUTSIDE autonomous mode — cancel is the escape verb, never gated', async () => {
        // The whole file runs as autonomous; cancel must free a stuck session regardless.
        delete process.env.FACTORY_AUTONOMOUS_MODE
        await seed('run-esc')
        await setExecuting('run-esc', 't1')
        const {code} = await cancel(['--run', 'run-esc'], {dataDir})
        expect(code).toBe(EXIT.OK)
        expect((await state.read('run-esc')).status).toBe('failed')
    })

    it('--help short-circuits and exits OK (wired into the run dispatch)', async () => {
        expect(await runCommand.run(['cancel', '--help'])).toBe(EXIT.OK)
    })

    it('cancel sweeps in-flight tasks to failed/blocked-environmental; pending stays untouched (Decision 72)', async () => {
        await seed('run-sweep')
        await setExecuting('run-sweep', 't1')

        await cancel(['--run', 'run-sweep'], {dataDir})

        const run = await state.read('run-sweep')
        expect(run.tasks.t1?.status).toBe('failed')
        expect(run.tasks.t1?.failure_class).toBe('blocked-environmental')
        expect(run.tasks.t1?.failure_reason).toBe('run cancelled by operator')
        expect(run.tasks.t1?.ended_at).toBeDefined()
        // t2 never started — its row is untouched (a sweep is hygiene, not a purge).
        expect(run.tasks.t2?.status).toBe('pending')
    })

    it('cancel warns about irreversibility and names `run stop` as the resumable alternative (Decision 72)', async () => {
        await seed('run-warn')
        const {stderr} = await cancel(['--run', 'run-warn'], {dataDir})
        expect(stderr).toContain('run stop')
        expect(stderr.toLowerCase()).toContain('not resumable')
    })

    it('--cleanup drops develop to baseline AFTER the staging teardown (D74, run-scoped default)', async () => {
        await seed('run-d74')
        const gh = new FakeGhClient()
        const {env} = await cancel(['--run', 'run-d74', '--cleanup'], {dataDir, ghClient: gh})

        expect(env.cleaned_up).toBe(true)
        expect(gh.protectionPuts).toEqual([
            {
                branch: 'develop',
                body: {requiredStatusChecks: ['Quality', 'Security Scan'], strict: false, enforceAdmins: false},
            },
        ])
        // Staging branch (and its auto-merge-armable PRs) gone FIRST, then the downgrade.
        expect(gh.calls.indexOf('api DELETE refs/heads/staging-run-d74')).toBeLessThan(
            gh.calls.indexOf('api PUT protection develop')
        )
    })

    it('no --cleanup leaves develop on the strict profile (D74) and the stderr hint says so', async () => {
        await seed('run-d74-keep')
        const gh = new FakeGhClient()
        const {stderr} = await cancel(['--run', 'run-d74-keep'], {dataDir, ghClient: gh})
        expect(gh.protectionPuts).toHaveLength(0)
        expect(stderr).toContain('baseline protection')
    })

    it('--cleanup SKIPS the de-escalation while a sibling run on the repo is active (D74)', async () => {
        await seed('run-d74-a')
        await state.create({
            run_id: 'run-d74-b',
            staging_branch: 'staging-run-d74-b',
            spec: {repo: REPO, spec_id: '7-search', issue_number: 7},
        })
        const gh = new FakeGhClient()
        const {env} = await cancel(['--run', 'run-d74-a', '--cleanup'], {dataDir, ghClient: gh})
        expect(env.cleaned_up).toBe(true)
        expect(gh.protectionPuts).toHaveLength(0)
    })

    it('--cleanup in permanent mode never touches develop protection (D74)', async () => {
        await writeFile(join(dataDir, 'config.json'), JSON.stringify({git: {developProtection: 'permanent'}}))
        await seed('run-d74-perm')
        const gh = new FakeGhClient()
        const {env} = await cancel(['--run', 'run-d74-perm', '--cleanup'], {dataDir, ghClient: gh})
        expect(env.cleaned_up).toBe(true)
        expect(gh.protectionPuts).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// runStop — park a live run (suspended, resumable) — Decision 72
// ---------------------------------------------------------------------------
describe('runStop (park a live run, Decision 72)', () => {
    let dataDir: string
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-run-stop-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', []), task('t2', ['t1'])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    async function seed(runId: string): Promise<void> {
        await createRun(state, store, {repo: REPO, issue: 42, runId})
    }

    async function stop(argv: string[]): Promise<{env: Record<string, unknown>; code: number; stderr: string}> {
        const chunks: string[] = []
        const errChunks: string[] = []
        const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            chunks.push(String(c))
            return true
        })
        const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
            errChunks.push(String(c))
            return true
        })
        let code: number
        try {
            code = await runStop(argv, {dataDir})
        } finally {
            out.mockRestore()
            err.mockRestore()
        }
        return {
            env: JSON.parse(chunks.join('')) as Record<string, unknown>,
            code,
            stderr: errChunks.join(''),
        }
    }

    it('parks a running run: suspended, NO quota checkpoint, tasks untouched', async () => {
        await seed('run-park')
        const {env, code, stderr} = await stop(['--run', 'run-park'])

        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('stopped')
        const run = await state.read('run-park')
        expect(run.status).toBe('suspended')
        // A2: a non-quota suspend never writes a checkpoint — plain `factory resume` clears it.
        expect(run.quota).toBeUndefined()
        expect(run.tasks.t1?.status).toBe('pending')
        // Stderr points at the resume verb and names cancel as the destructive alternative.
        expect(stderr).toContain('factory resume')
        expect(stderr).toContain('run cancel')
    })

    it('is idempotent on an already-suspended run', async () => {
        await seed('run-idem')
        await stop(['--run', 'run-idem'])
        const {env, code} = await stop(['--run', 'run-idem'])
        expect(code).toBe(EXIT.OK)
        expect(env.already_parked).toBe(true)
        expect((await state.read('run-idem')).status).toBe('suspended')
    })

    it('is LOUD on a terminal run — nothing to park', async () => {
        await seed('run-term')
        await state.finalize('run-term', 'failed', 'test: forced terminal')
        await expect(runStop(['--run', 'run-term'], {dataDir})).rejects.toThrow(/terminal/)
    })

    it('--help short-circuits and exits OK (wired into the run dispatch)', async () => {
        expect(await runCommand.run(['stop', '--help'])).toBe(EXIT.OK)
    })
})

// ---------------------------------------------------------------------------
// run create: cuts + protects staging/<run-id> from develop (Decision 33)
// ---------------------------------------------------------------------------

describe('run create cuts and protects staging/<run-id> from develop', () => {
    let dataDir: string

    /** Git fake with origin remote URL + develop branch seeded (ensureStaging needs it). */
    function gitWithDevelop(): FakeGitClient {
        const git = new FakeGitClient({remoteHeads: {develop: 'sha-develop-1'}})
        git.setRemoteUrl('origin', `git@github.com:${REPO}.git`)
        return git
    }

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-run-staging-'))
        const store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', [])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('run create cuts staging/<run-id> from origin/develop and provisions protection on it', async () => {
        const git = gitWithDevelop()
        const gh = new FakeGhClient()

        const code = await runCreate(['--issue', '42', '--run-id', 'run-20260618-101500'], {
            gitClient: git,
            ghClient: gh,
            cwd: await contractReadyCwd(git),
            dataDir,
        })
        expect(code).toBe(EXIT.OK)

        const branch = 'staging-run-20260618-101500'
        // Orchestrator worktree the fake's showToplevel (/repo) + runId derive to (D2).
        const orch = '/repo/.claude/worktrees/orchestrator-run-20260618-101500'

        // (a) branch was cut in the ORCHESTRATOR WORKTREE, not the primary checkout: a
        // `worktree add` with the per-run staging branch from origin/develop — never a
        // `checkout -B` that would park the user's main dir on staging (the D2 collision).
        expect(git.calls).toContain(`worktree add -b ${branch} ${orch} origin/develop`)
        expect(git.calls.some((c) => c.startsWith('checkout -B'))).toBe(false)
        expect(git.worktrees.get(orch)).toBe(branch)
        // branch exists in the fake's remote heads (push was called after worktree add)
        expect(git.getRemoteHead(branch)).toBeDefined()

        // (b) protection was provisioned on the per-run branch
        expect(gh.calls).toContain(`api PUT protection ${branch}`)
        const protection = gh.protection.get(branch)
        expect(protection?.enabled).toBe(true)
        expect(protection?.strictUpToDate).toBe(true)
    })

    it('a second create without --new returns EXIT.CONFLICT (active run exists) and does NOT cut a branch', async () => {
        // Decision 35 / Task 4.2: runCreate no longer silently reuses — it returns
        // EXIT.CONFLICT with a structured envelope when an active run exists and no
        // --supersede/--resume/--new flag was given. The staging branch must NOT be cut.
        const git = gitWithDevelop()
        const gh = new FakeGhClient()
        const cwd = await contractReadyCwd(git)

        // First create — cuts the branch.
        await runCreate(['--issue', '42', '--run-id', 'run-first'], {
            gitClient: git,
            ghClient: gh,
            cwd,
            dataDir,
        })
        const callsAfterFirst = [...git.calls]

        // Suppress stdout/stderr output from the conflict response.
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

        let exitCode: number | undefined
        try {
            // Second create (auto-id, no --new) → EXIT.CONFLICT (kind:"exists").
            exitCode = await runCreate(['--issue', '42'], {
                gitClient: git,
                ghClient: gh,
                cwd,
                dataDir,
            })
        } finally {
            stdoutSpy.mockRestore()
            stderrSpy.mockRestore()
        }

        expect(exitCode).toBe(EXIT.CONFLICT)

        // No new checkoutB calls after the first create (branch was not cut for the rejected run).
        const newCalls = git.calls.slice(callsAfterFirst.length)
        expect(newCalls.filter((c) => c.startsWith('checkout -B staging-'))).toHaveLength(0)
    })
})

// ---------------------------------------------------------------------------
// T: CLI-level runDocs cross-check (Group-2-D cap integration)
// ---------------------------------------------------------------------------

describe('runDocs — CLI-level integration (T)', () => {
    // Mirrors the docs.test.ts suite but runs within the run.test.ts harness to
    // confirm the docs plumbing integrates with the run lifecycle infrastructure.
    it('T: DONE result commits + marks docs done without suspending the run', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'run-docs-cli-'))
        const state = new StateManager({dataDir})
        const runId = 'run-docs-cli-1'
        await state.create({
            run_id: runId,
            staging_branch: `staging-${runId}`,
            spec: {repo: REPO, spec_id: '9-x', issue_number: 9},
        })
        const git = new FakeGitClient({remoteHeads: {[`staging-${runId}`]: 'sha-staging'}})
        // FakeGitClient never touches real fs — reusing dataDir avoids a 2nd mkdtemp.
        const deps: DocsRunDeps = {state, git, config: defaultConfig(), workDir: dataDir}

        await runDocsEmit(deps, runId)
        const env = await runDocsRecord(deps, runId, {status: 'STATUS: DONE'})
        expect(env.kind).toBe('done')
        const run = await state.read(runId)
        expect(run.docs?.status).toBe('done')
        expect(run.status).not.toBe('suspended')
        await rm(dataDir, {recursive: true, force: true})
    })

    it('T: repeated failure hits the cap and finalizes done (not suspended) — run continues', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'run-docs-cli-cap-'))
        const state = new StateManager({dataDir})
        const runId = 'run-docs-cli-cap-1'
        await state.create({
            run_id: runId,
            staging_branch: `staging-${runId}`,
            spec: {repo: REPO, spec_id: '9-x', issue_number: 9},
        })
        const git = new FakeGitClient({remoteHeads: {[`staging-${runId}`]: 'sha-staging'}})
        // FakeGitClient never touches real fs — reusing dataDir avoids a 2nd mkdtemp.
        const deps: DocsRunDeps = {state, git, config: defaultConfig(), workDir: dataDir}

        await runDocsEmit(deps, runId)
        // First failure → suspend, attempts: 1
        const first = await runDocsRecord(deps, runId, {status: 'garbage — not done'})
        expect(first.kind).toBe('suspend')
        // Simulate resume re-entering the docs phase
        await state.update(runId, (s) => ({...s, status: 'running' as const}))
        // Second failure → cap → kind "done" (run finalizes, not stuck in suspend loop)
        const second = await runDocsRecord(deps, runId, {status: 'garbage again'})
        expect(second.kind).toBe('done')
        const run = await state.read(runId)
        expect(run.status).not.toBe('suspended')
        expect(run.docs?.attempts).toBe(2)
        await rm(dataDir, {recursive: true, force: true})
    })
})

// ---------------------------------------------------------------------------
// runResume (factory resume) — quota re-check + checkpoint clear via the CLI
// ---------------------------------------------------------------------------
// Driven through `resumeCommand.run` (runResume is not exported). The suite pins
// the CLI-layer behavior applyResume's unit tests cannot see: the --ignore-quota
// persist-before-plan ordering, the pause path leaving state untouched, the S11
// human_touch metric mirror, and the flag-rejection guards.
describe('runResume (factory resume)', () => {
    let dataDir: string
    let prevPluginData: string | undefined
    let state: StateManager
    let store: SpecStore

    beforeEach(async () => {
        dataDir = await makeTempDataDir('factory-resume-')
        prevPluginData = process.env.CLAUDE_PLUGIN_DATA
        process.env.CLAUDE_PLUGIN_DATA = dataDir
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        store = new SpecStore({dataDir, docsRoot: join(dataDir, '_docs')})
        await store.write(request([task('t1', [])]), '# spec\n', makePrd())
    })
    afterEach(async () => {
        if (prevPluginData === undefined) {
            delete process.env.CLAUDE_PLUGIN_DATA
        } else {
            process.env.CLAUDE_PLUGIN_DATA = prevPluginData
        }
        await rm(dataDir, {recursive: true, force: true})
    })

    /** Seed a run, then park it 7d-suspended with a quota checkpoint (a quota-caused stop). */
    async function seedSuspended(runId: string): Promise<void> {
        await createRun(state, store, {repo: REPO, issue: 42, runId, ownerSession: 'sess-resume'})
        await state.update(runId, (s) => ({
            ...s,
            status: 'suspended' as const,
            quota: {binding_window: '7d' as const, resets_at_epoch: Math.floor(Date.now() / 1000) + 3600},
        }))
    }

    /**
     * Run `factory resume <argv>`; capture the JSON envelope + exit code. With
     * `overrides` (fake git/gh), drives `runResume` directly so adoption's GitHub probe
     * hits the fakes; without them (usage-edge tests), goes through `resumeCommand` for
     * the withUsageGuard EXIT.USAGE mapping.
     */
    async function resume(
        argv: string[],
        overrides?: {gitClient: FakeGitClient; ghClient: FakeGhClient}
    ): Promise<{env: Record<string, unknown>; code: number; stderr: string}> {
        const chunks: string[] = []
        const errChunks: string[] = []
        const out = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            chunks.push(String(c))
            return true
        })
        const err = vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
            errChunks.push(String(c))
            return true
        })
        let code: number
        try {
            code = overrides !== undefined ? await runResume(argv, overrides) : await resumeCommand.run(argv)
        } finally {
            out.mockRestore()
            err.mockRestore()
        }
        return {
            env: chunks.length > 0 ? (JSON.parse(chunks.join('')) as Record<string, unknown>) : {},
            code,
            stderr: errChunks.join(''),
        }
    }

    it('--ignore-quota persists ignore_quota AND resumes despite an unavailable (fail-closed) reading', async () => {
        await seedSuspended('run-iq')
        // No usage-cache.json in the temp data dir → the reading is `unavailable`,
        // which without the flag fail-closed pauses (proven by the test below).
        const {env, code} = await resume(['--run', 'run-iq', '--ignore-quota'], {
            gitClient: new FakeGitClient(),
            ghClient: new FakeGhClient(),
        })
        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('resumed')
        const run = await state.read('run-iq')
        expect(run.ignore_quota).toBe(true)
        expect(run.status).toBe('running')
        expect(run.quota).toBeUndefined() // checkpoint cleared
    })

    it('plain resume on the same parked run fail-closed pauses and leaves state untouched', async () => {
        await seedSuspended('run-park')
        const {env, code} = await resume(['--run', 'run-park'], {
            gitClient: new FakeGitClient(),
            ghClient: new FakeGhClient(),
        })
        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('pause')
        const run = await state.read('run-park')
        expect(run.status).toBe('suspended')
        expect(run.ignore_quota).toBe(false)
        expect(run.quota).toBeDefined() // checkpoint intact
    })

    it("a resume that clears the checkpoint mirrors the S11 human_touch 'resume' metric", async () => {
        await seedSuspended('run-touch')
        await resume(['--run', 'run-touch', '--ignore-quota'], {
            gitClient: new FakeGitClient(),
            ghClient: new FakeGhClient(),
        })
        const metrics = await readMetrics(dataDir, 'run-touch')
        const touches = metrics.filter((m) => m.event === 'human_touch')
        expect(touches.map((m) => (m.data as {kind: string}).kind)).toContain('resume')
    })

    it('rejects --e2e (create-only flag) as a usage error', async () => {
        await seedSuspended('run-flags')
        const {code, stderr} = await resume(['--run', 'run-flags', '--e2e'])
        expect(code).toBe(EXIT.USAGE)
        expect(stderr).toMatch(/--no-ship\/--e2e are not valid on resume/)
    })

    it('a GitHub outage degrades: adoption returns {ok:false} but resume still proceeds (Decision 60)', async () => {
        await seedSuspended('run-outage')
        // A task branch forces gatherRunFacts to call prList, which THROWS under truncate.
        await state.update('run-outage', (s) => ({
            ...s,
            tasks: {t1: {...nonNull(s.tasks.t1), branch: 'factory/run-outage/t1', pr_number: 9}},
        }))
        const gh = new FakeGhClient({truncate: true}) // gh down — prList rejects
        const {env, code} = await resume(['--run', 'run-outage', '--ignore-quota'], {
            gitClient: new FakeGitClient(),
            ghClient: gh,
        })
        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('resumed') // the outage never blocks resume
        expect((env.adoption as {ok: boolean; error: string}).ok).toBe(false)
        expect((env.adoption as {error: string}).error).toMatch(/TRUNCATED/)
        expect((await state.read('run-outage')).status).toBe('running')
    })

    it('a landed auto-armed rollup reopens the completed run so resume proceeds (Decision 60)', async () => {
        const runId = 'run-rollup'
        await createRun(state, store, {repo: REPO, issue: 42, runId, ownerSession: 'sess-rollup'})
        const staging = (await state.read(runId)).staging_branch
        // A completed run whose rollup ARMED (--auto) but state still records merged:false.
        await state.update(runId, (s) => ({
            ...s,
            status: 'completed' as const,
            ended_at: '2026-07-04T00:00:00.000Z',
            tasks: {t1: {...nonNull(s.tasks.t1), status: 'done' as const, ended_at: '2026-07-04T00:00:00.000Z'}},
            rollup: {number: 55, merged: false, reason: 'branch policy: merge queued (--auto)'},
        }))
        // GitHub truth: the rollup PR landed.
        const gh = new FakeGhClient()
        gh.setPr({number: 55, headRefName: staging, baseRefName: 'main', state: 'MERGED', mergeCommit: {oid: 'rsha'}})
        const {env, code} = await resume(['--run', runId], {gitClient: new FakeGitClient(), ghClient: gh})
        expect(code).toBe(EXIT.OK)
        expect(env.kind).toBe('resumed') // adoption reopened it BEFORE applyResume's terminal guard
        expect((env.adoption as {ok: boolean; reopened: unknown}).reopened).toBe('rollup')
        expect((await state.read(runId)).status).toBe('running')
    })

    it('resume idempotently RE-ESCALATES develop to the strict run profile (D74, run-scoped default)', async () => {
        await seedSuspended('run-d74-esc')
        const gh = new FakeGhClient()
        const {env} = await resume(['--run', 'run-d74-esc', '--ignore-quota'], {
            gitClient: new FakeGitClient(),
            ghClient: gh,
        })
        expect(env.kind).toBe('resumed')
        expect(gh.protectionPuts).toEqual([
            {
                branch: 'develop',
                body: {requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan'], strict: true},
            },
        ])
    })

    it('a fail-closed pause does NOT re-escalate develop (D74)', async () => {
        await seedSuspended('run-d74-pause')
        const gh = new FakeGhClient()
        const {env} = await resume(['--run', 'run-d74-pause'], {gitClient: new FakeGitClient(), ghClient: gh})
        expect(env.kind).toBe('pause')
        expect(gh.protectionPuts).toHaveLength(0)
    })

    it('permanent mode: resume never touches develop protection (D74)', async () => {
        await writeFile(join(dataDir, 'config.json'), JSON.stringify({git: {developProtection: 'permanent'}}))
        await seedSuspended('run-d74-perm')
        const gh = new FakeGhClient()
        const {env} = await resume(['--run', 'run-d74-perm', '--ignore-quota'], {
            gitClient: new FakeGitClient(),
            ghClient: gh,
        })
        expect(env.kind).toBe('resumed')
        expect(gh.protectionPuts).toHaveLength(0)
    })
})
