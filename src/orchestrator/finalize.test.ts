/**
 * WS12 — the run FINALIZE coordinator (§④ rollup + §⑤ outcome; Δ S).
 *
 * Exercises the resume-safe ordering + idempotency contract end-to-end against the
 * real {@link StateManager} (temp dir) + the exported {@link FakeGhClient}:
 *   - completed  → rollup merges (live) / opens-only (no-merge), PRD closed +
 *                  per-run branch GC'd on a merged rollup, no failure comment;
 *   - failed     → no rollup (develop untouched, branch retained for rescue), ONE
 *                  PRD-issue comment listing the fails (Decision 36; Decision 34 —
 *                  develop receives whole PRDs);
 *   - resume     → a second finalize posts no duplicate comment + short-circuits the rollup;
 *   - anti-spin  → a non-terminal task makes finalize THROW (never advances).
 *
 * The report.md + metrics.jsonl side effects are asserted from disk (derive-don't-
 * store: the report is recomputed, never read back).
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtemp, rm, readFile, mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {finalizeRun, prdDoneComment, deriveTerminalReason, type FinalizeRunDeps} from './finalize.js'
import {StateManager} from '../core/state/manager.js'
import {FakeGhClient, FakeGitClient} from '../git/fakes.js'
import {parseSpecManifest, type SpecManifest} from '../spec/index.js'
import {readLedger} from '../spec/ledger.js'
import {readMetrics} from '../scoring/index.js'
import {runReportPath} from '../core/state/paths.js'
import {scanRun} from '../rescue/scan.js'
import {defaultConfig} from '../config/schema.js'
import {GATE_CONTRACT_REL} from '../verifier/deterministic/gate-contract.js'
import {validContract} from '../verifier/deterministic/gate-contract.test.js'
import type {ShipMode} from './types.js'
import type {FailureClass, TaskState} from '../types/index.js'
import type {RunState} from '../core/state/schema.js'
import {nonNull, at, getOrThrow} from '../shared/index.js'

const RUN_ID = 'run-final-1'
const REPO = 'acme/widgets'
const SPEC_ID = '42-checkout'
const ISSUE = 42
const NOW = '2026-06-08T12:00:00.000Z'

/** A task partial for both the spec and the run-state seeding. */
interface TaskSeed {
    task_id: string
    status: 'done' | 'failed'
    failure_class?: FailureClass
    failure_reason?: string
    branch?: string
    pr_number?: number
    acceptance_criteria?: readonly string[]
}

/** Build a SpecManifest whose task ids/criteria match the run seeds. */
function makeSpec(tasks: readonly TaskSeed[]): SpecManifest {
    return parseSpecManifest({
        spec_id: SPEC_ID,
        issue_number: ISSUE,
        slug: 'checkout',
        repo: REPO,
        generated_at: '2026-06-01T00:00:00.000Z',
        tasks: tasks.map((t) => ({
            task_id: t.task_id,
            title: `task ${t.task_id}`,
            description: `does ${t.task_id}`,
            files: [`src/${t.task_id}.ts`],
            acceptance_criteria: t.acceptance_criteria ?? ['a', 'b', 'c'],
            tests_to_write: ['covers it'],
            depends_on: [],
            risk_tier: 'medium',
            risk_rationale: 'moderate',
        })),
    })
}

/** Map a seed to a terminal TaskState row (carries the fail cross-fields). */
function taskRow(t: TaskSeed): TaskState {
    const base: TaskState = {
        task_id: t.task_id,
        status: t.status,
        depends_on: [],
        escalation_rung: 0,
        reviewers: [],
        merge_resyncs: 0,
        ...(t.branch !== undefined ? {branch: t.branch} : {}),
        ...(t.pr_number !== undefined ? {pr_number: t.pr_number} : {}),
    }
    if (t.status === 'failed') {
        return {
            ...base,
            failure_class: t.failure_class ?? 'capability-budget',
            failure_reason: t.failure_reason ?? 'ran out of retries',
        }
    }
    return base
}

describe('finalizeRun', () => {
    let dataDir: string
    let state: StateManager
    let gh: FakeGhClient
    let git: FakeGitClient

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-finalize-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        gh = new FakeGhClient()
        git = new FakeGitClient()
        await state.create({
            run_id: RUN_ID,
            staging_branch: `staging-${RUN_ID}`,
            spec: {repo: REPO, spec_id: SPEC_ID, issue_number: ISSUE},
        })
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    /** Seed the run's terminal task rows in one write. */
    async function seed(tasks: readonly TaskSeed[]): Promise<void> {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: Object.fromEntries(tasks.map((t) => [t.task_id, taskRow(t)])),
        }))
    }

    /** Assemble the finalize deps (no-op sleep, tiny CI budget). */
    function makeDeps(spec: SpecManifest, shipMode: ShipMode): FinalizeRunDeps {
        return {
            state,
            gh,
            git,
            config: defaultConfig(),
            spec,
            dataDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode,
            nowIso: NOW,
            rollup: {
                sleep: async () => {
                    /* no-op */
                },
                pollIntervalMs: 0,
                maxPolls: 3,
            },
        }
    }

    it('completed + live: merges the rollup with a plain subject, posts no failure comment', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', branch: 'factory/run/t1', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        const result = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)

        expect(result.run.status).toBe('completed')
        expect(result.report.run_status).toBe('completed')
        expect(result.failureCommentPosted).toBe(false)
        // rollup merged with the plain title as subject (Decision 34: develop gets only complete runs).
        expect(result.rollup?.merged).toBe(true)
        expect(result.rollup?.subject).not.toMatch(/^PARTIAL:/)
        expect(gh.merges).toHaveLength(1)

        // persisted run is terminal.
        expect((await state.read(RUN_ID)).status).toBe('completed')

        // Branch GC (Decision 35): protection deleted BEFORE branch; both deleted.
        expect(gh.protectionDeletes).toContain(`staging-${RUN_ID}`)
        expect(gh.deletedBranches).toContain(`staging-${RUN_ID}`)
        expect(gh.protectionDeletes.indexOf(`staging-${RUN_ID}`)).toBeLessThanOrEqual(
            gh.deletedBranches.indexOf(`staging-${RUN_ID}`)
        )
    })

    it('e2e-failed override (Decision 39): every task shipped but e2e vetoes → failed, no rollup, PRD comment posted', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e: true,
            e2e_phase: {
                status: 'failed',
                reason: 'checkout: cap-exhausted critical',
                manifest: [],
                reopen_counts: {},
                ended_at: NOW,
            },
        }))

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        // decideFinalize alone would say "completed" (every task done) — the e2e phase
        // overrides it to "failed" even though `report.failures` is empty.
        expect(result.run.status).toBe('failed')
        expect(result.report.run_status).toBe('failed')
        expect(result.report.failures).toEqual([])
        expect(result.report.e2e_failure).toBe('checkout: cap-exhausted critical')
        // No rollup: develop must never receive an e2e-vetoed run.
        expect(result.rollup).toBeUndefined()
        expect(gh.merges).toHaveLength(0)
        // The PRD comment fires even with zero task failures (an e2e-only veto).
        expect(result.failureCommentPosted).toBe(true)
        const persisted = await state.read(RUN_ID)
        expect(persisted.status).toBe('failed')
        // The WHY names the actual condemner (deriveTerminalReason, persisted step 7).
        expect(persisted.terminal_reason).toBe('e2e phase failed: checkout: cap-exhausted critical')
    })

    it('assessment-failed override (Decision 40): all tasks done on resume but a failed assessment vetoes → failed, no rollup', async () => {
        // The resumed edge: every task terminal-done (finished BEFORE the assessment
        // gate landed), so the sweep found nothing to fail — only the override pins it.
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({
            ...s,
            e2e: true,
            e2e_assessment: {
                status: 'failed' as const,
                reason: 'the app cannot be booted here — it needs a live payment gateway',
                affected_specs: [],
                ended_at: NOW,
            },
        }))

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.run.status).toBe('failed')
        expect(result.report.run_status).toBe('failed')
        // No rollup: develop must never receive a run whose e2e setup was condemned.
        expect(result.rollup).toBeUndefined()
        expect(gh.merges).toHaveLength(0)
        expect((await state.read(RUN_ID)).status).toBe('failed')
    })

    it('traceability-failed override (S9, Decision 47): every task shipped but the PRD audit found unmet → failed, no rollup, PRD comment posted', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({
            ...s,
            traceability: {
                status: 'failed' as const,
                reason: 'PRD requirements unmet: "returns 201"',
                verdicts: [
                    {
                        requirement: 'checkout must work',
                        verdict: 'met' as const,
                        evidence: 'checkout.ts:1 + its test',
                    },
                    {
                        requirement: 'returns 201',
                        verdict: 'unmet' as const,
                        evidence: 'no 201 anywhere in the diff',
                    },
                ],
                ended_at: NOW,
            },
        }))

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        // decideFinalize alone would say "completed" (every task done) — the failed
        // PRD audit overrides it, exactly like the e2e veto.
        expect(result.run.status).toBe('failed')
        expect(result.report.run_status).toBe('failed')
        expect(result.report.failures).toEqual([])
        expect(result.report.traceability_failure).toContain('returns 201')
        // Only the non-met rows surface as gaps.
        expect(result.report.traceability_gaps).toEqual([
            {requirement: 'returns 201', verdict: 'unmet', evidence: 'no 201 anywhere in the diff'},
        ])
        // No rollup: develop must never receive a run that does not deliver its PRD.
        expect(result.rollup).toBeUndefined()
        expect(gh.merges).toHaveLength(0)
        // The PRD comment fires even with zero task failures (a traceability-only veto).
        expect(result.failureCommentPosted).toBe(true)
        expect(gh.issueComments.some((c) => c.body.includes('Unmet PRD requirements'))).toBe(true)
        expect((await state.read(RUN_ID)).status).toBe('failed')
    })

    it("completed + live merged rollup appends one 'shipped' ledger entry per done task (Decision 70)", async () => {
        const developTip = 'c'.repeat(40)
        git.setRemoteHead('develop', developTip)
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.rollup?.merged).toBe(true)
        const ledger = await readLedger(dataDir, REPO, SPEC_ID)
        expect(ledger.entries).toHaveLength(2)
        expect(ledger.entries.map((e) => e.task_id).sort()).toEqual(['t1', 't2'])
        for (const e of ledger.entries) {
            expect(e.source).toBe('shipped')
            expect(e.run_id).toBe(RUN_ID)
            expect(e.shas).toEqual([developTip])
            expect(e.verified_at).toBe(NOW)
        }
        expect(ledger.entries.find((e) => e.task_id === 't1')?.pr_number).toBe(11)
        expect(ledger.entries.find((e) => e.task_id === 't2')?.pr_number).toBe(12)
    })

    it('ledger write failure (unresolvable develop tip) logs loud but never fails finalize (Decision 70)', async () => {
        // No origin/develop remote head seeded → the post-rollup tip rev-parse rejects.
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.run.status).toBe('completed')
        expect(result.rollup?.merged).toBe(true)
        expect((await readLedger(dataDir, REPO, SPEC_ID)).entries).toHaveLength(0)
    })

    it('completed + no-merge writes NO ledger entries (only a MERGED rollup is durable evidence)', async () => {
        git.setRemoteHead('develop', 'd'.repeat(40))
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        await finalizeRun(makeDeps(makeSpec(tasks), 'no-merge'), RUN_ID)

        expect((await readLedger(dataDir, REPO, SPEC_ID)).entries).toHaveLength(0)
    })

    it('debug run merged rollup writes NO ledger entries (a debug session is not a PRD delivery)', async () => {
        git.setRemoteHead('develop', 'e'.repeat(40))
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({...s, debug: true}))

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.rollup?.merged).toBe(true)
        expect((await readLedger(dataDir, REPO, SPEC_ID)).entries).toHaveLength(0)
    })

    it('completed + no-merge: opens the rollup PR but never merges it', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'no-merge'), RUN_ID)

        expect(result.run.status).toBe('completed')
        expect(result.rollup?.merged).toBe(false)
        expect(result.rollup?.reason).toBe('no-merge')
        expect(gh.merges).toHaveLength(0)
        expect(gh.created).toHaveLength(1) // PR opened for inspection
        // Branch GC: no-merge → NOT merged → branch retained.
        expect(gh.deletedBranches).not.toContain(`staging-${RUN_ID}`)
    })

    it('completed + branch-policy block (D3): rollup arms --auto, reason surfaces, PRD/branch untouched', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        gh.failMergeSquashUnlessAuto = new Error(
            'GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)'
        )

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        // status is decided before rollup even runs — a "completed" run whose develop
        // merge is only ARMED, not landed (the accepted, surfaced-not-silent gap, D3).
        expect(result.run.status).toBe('completed')
        expect(result.rollup?.merged).toBe(false)
        expect(result.rollup?.reason).toBe('auto-armed')
        // the auto-armed retry IS a recorded merge call (armed via --auto), just not a
        // landed one — same "merged: false" contract as no-merge/ci-failing/etc.
        expect(gh.merges).toHaveLength(1)
        expect(gh.merges[0]).toMatchObject({auto: true})
        // not merged → the merged-only PRD comment/close + branch GC block is skipped.
        expect(gh.created).toHaveLength(1) // PR still opened
        expect(gh.issueComments).toHaveLength(0) // no PRD-delivered comment
        expect(gh.issueCloses).toHaveLength(0) // PRD left open
        expect(gh.deletedBranches).not.toContain(`staging-${RUN_ID}`)
        expect(gh.protectionDeletes).not.toContain(`staging-${RUN_ID}`)
        // finding #5 (minimal surface): the armed-not-landed outcome is persisted onto
        // RunState so `rescue scan` can flag it without a live GitHub call.
        expect((await state.read(RUN_ID)).rollup).toEqual({
            number: nonNull(result.rollup).number,
            merged: false,
            reason: 'auto-armed',
        })
    })

    it('finding #5 recovery: rescue apply --recheck-rollup reopens an auto-armed run, and a re-drive finalize picks up the now-merged PR and clears the pointer', async () => {
        const {applyRescue} = await import('../rescue/apply.js')
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        const spec = makeSpec(tasks)
        gh.failMergeSquashUnlessAuto = new Error(
            'GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)'
        )

        const first = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(first.rollup?.merged).toBe(false)
        expect(first.rollup?.reason).toBe('auto-armed')
        expect((await state.read(RUN_ID)).status).toBe('completed')
        expect((await state.read(RUN_ID)).rollup?.merged).toBe(false)

        // Simulate GitHub's queued --auto merge landing externally (out-of-band, no
        // rescue/finalize involvement) — the PR is now MERGED.
        const stagingBranch = `staging-${RUN_ID}`
        const pr = getOrThrow(gh.prs, stagingBranch)
        gh.setPr({...pr, state: 'MERGED'})

        // Human confirms it landed → reopen for a re-drive.
        const rescued = await applyRescue(state, RUN_ID, {recheckRollup: true})
        expect(rescued.reopened).toBe(true)
        expect((await state.read(RUN_ID)).status).toBe('running')

        const second = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(second.rollup?.merged).toBe(true)
        expect(second.rollup?.resumed).toBe(true) // hit the already-merged short-circuit
        expect(second.run.status).toBe('completed')
        // The pointer is cleared — nothing left for rescue to flag.
        expect((await state.read(RUN_ID)).rollup).toBeUndefined()
        // Now-merged → the merged-only PRD comment/close + branch GC fire.
        expect(gh.issueCloses).toHaveLength(1)
        expect(gh.deletedBranches).toContain(stagingBranch)
    })

    it('failed (some failed): no rollup, one PRD comment, PRD left open (Decision 34)', async () => {
        // Decision 34: develop receives only complete PRDs. A mixed done+failed run is
        // 'failed', gets no rollup, and the PRD issue is left open.
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {
                task_id: 't2',
                status: 'failed',
                failure_class: 'spec-defect',
                failure_reason: 'criterion unattainable',
            },
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        const result = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)

        expect(result.run.status).toBe('failed')
        expect(result.failureCommentPosted).toBe(true)
        // ONE comment on the PRD issue (not a per-task GitHub issue), naming the fail + class.
        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).number).toBe(ISSUE)
        expect(at(gh.issueComments, 0).body).toContain('t2')
        expect(at(gh.issueComments, 0).body).toContain('spec-defect')
        // Decision 34: no rollup on failed — develop is untouched.
        expect(result.rollup).toBeUndefined()
        expect(gh.merges).toHaveLength(0)
        // PRD issue NOT closed.
        expect(gh.issueCloses).toHaveLength(0)
        // Branch GC: failed → branch retained for rescue.
        expect(gh.deletedBranches).not.toContain(`staging-${RUN_ID}`)
    })

    it('failed (all failed): no rollup, one consolidated PRD comment, run flips to failed', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'failed', failure_class: 'capability-budget'},
            {task_id: 't2', status: 'failed', failure_class: 'blocked-environmental'},
        ]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.run.status).toBe('failed')
        expect(result.rollup).toBeUndefined() // nothing shipped → no rollup attempted
        expect(gh.created).toHaveLength(0)
        // ONE comment listing every fail — not one GitHub issue per task.
        expect(result.failureCommentPosted).toBe(true)
        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).body).toContain('t1')
        expect(at(gh.issueComments, 0).body).toContain('t2')
    })

    it('failed + self-heal ELIGIBLE (S10, Decision 48): recoverable task, attempts=0 → PRD comment carries the self-heal sentence', async () => {
        // blocked-environmental → recoverable → resettable; no deps → clean closure;
        // self_heal unset (attempts defaults 0): the bounded `rescue auto` fires next.
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'blocked-environmental'}]
        await seed(tasks)

        await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).body).toContain('Self-heal:')
    })

    it('failed + self-heal ELIGIBLE at the budget boundary (attempts=2 < 3, Decision 60): self-heal sentence still present', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'blocked-environmental'}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({...s, self_heal: {attempts: 2, last_at: NOW}}))

        await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).body).toContain('Self-heal:')
    })

    it('failed + self-heal INELIGIBLE — budget spent (attempts=3): recoverable task, no self-heal sentence', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'blocked-environmental'}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({...s, self_heal: {attempts: 3, last_at: NOW}}))

        await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).body).not.toContain('Self-heal:')
    })

    it('failed + self-heal INELIGIBLE — nothing auto-resettable (dead-end only): no self-heal sentence', async () => {
        // spec-defect → dead-end → effectiveAutoResets empty even at attempts=0.
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'spec-defect'}]
        await seed(tasks)

        await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).body).not.toContain('Self-heal:')
    })

    it('persists report.md and run.finalized + per-fail telemetry', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'failed', failure_class: 'spec-defect'},
        ]
        await seed(tasks)

        await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        const md = await readFile(runReportPath(dataDir, RUN_ID), 'utf8')
        expect(md).toContain('# Factory run report')
        // Decision 34: mixed done+failed is 'failed', not 'partial'.
        expect(md).toContain('Status:** FAILED')
        expect(md).toContain(NOW)

        const metrics = await readMetrics(dataDir, RUN_ID)
        const finalized = metrics.find((m) => m.event === 'run.finalized')
        expect(finalized?.data?.status).toBe('failed')
        expect(metrics.filter((m) => m.event === 'task.dropped')).toHaveLength(1)
    })

    it('resume-safe (failed): a second finalize on a failed run posts no new comment and stays failed', async () => {
        // Decision 34: a failed run has no rollup to resume; idempotency means the
        // second finalize posts no second PRD comment and leaves the run status as failed.
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'failed', failure_class: 'spec-defect'},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        const first = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(first.failureCommentPosted).toBe(true)
        expect(first.rollup).toBeUndefined() // no rollup on failed

        // Re-enter finalize: idempotent across the board.
        const second = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(second.failureCommentPosted).toBe(false) // deduped against the marker
        expect(gh.issueComments).toHaveLength(1) // no duplicate comment
        expect(second.rollup).toBeUndefined() // still no rollup
        expect(gh.merges).toHaveLength(0) // never merged
        expect((await state.read(RUN_ID)).status).toBe('failed')
    })

    it('resume-safe (completed+merged): a second finalize re-enters the merged rollup, posts the PRD comment exactly once, and stays completed', async () => {
        // Idempotency contract (finalize.ts header): a finalize that died after the rollup
        // merged but before flipping terminal re-enters here. rollup() short-circuits on the
        // already-merged PR (resumed:true), so the NON-idempotent issueComment must not
        // double-post. issueClose is naturally idempotent; branch GC is 404-tolerant.
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', branch: 'factory/run/t1', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        const first = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(first.rollup?.merged).toBe(true)
        expect(gh.issueComments).toHaveLength(1)
        expect(gh.merges).toHaveLength(1)

        const second = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(second.rollup?.resumed).toBe(true) // hit the already-merged short-circuit
        expect(gh.issueComments).toHaveLength(1) // NOT 2 — the fix
        expect(gh.merges).toHaveLength(1) // never re-merged
        expect((await state.read(RUN_ID)).status).toBe('completed')
    })

    it('completed: a forward-reconcile conflict persists a rollup_pending marker (scan flags it) and leaves the run non-terminal', async () => {
        // finalize.ts step 6: the forward-reconcile (tryMergeNoForce) can hit a
        // non-auto-recoverable conflict. It must abort-clean, persist a durable
        // `rollup {merged:false}` marker so `rescue scan` flags the run instead of
        // reporting it healthy, THEN throw BEFORE the rollup — and step 7 (flip
        // terminal) must NOT run, so the run stays resumable.
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)
        git.failMergeNoForce = true

        await expect(finalizeRun(makeDeps(spec, 'live'), RUN_ID)).rejects.toThrow(/forward-reconcile conflict/)

        expect(gh.merges).toHaveLength(0) // surfaced before the rollup
        expect(gh.issueComments).toHaveLength(0)
        const run = await state.read(RUN_ID)
        expect(run.status).toBe('running') // step 7 never reached
        expect(run.rollup).toMatchObject({
            merged: false,
            reason: expect.stringMatching(/forward-reconcile conflict/) as string,
        })
        const scan = scanRun(run)
        expect(scan.rollup_pending).toBe(true)
        expect(scan.needs_rescue).toBe(true) // previously: healthy — the invisible wedge
    })

    it('completed: after the conflict is resolved, a re-entered finalize overwrites the conflict marker with the real rollup result', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)
        git.failMergeNoForce = true
        await expect(finalizeRun(makeDeps(spec, 'live'), RUN_ID)).rejects.toThrow(/forward-reconcile conflict/)

        git.failMergeNoForce = false // human resolved the conflict → `factory resume` re-enters
        const result = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
        expect(result.rollup?.merged).toBe(true)
        const run = await state.read(RUN_ID)
        expect(run.status).toBe('completed')
        expect(run.rollup).toBeUndefined() // merged rollup → marker cleared, scan no longer flags
    })

    it('anti-spin: a non-terminal task makes finalize THROW (never advances)', async () => {
        // One done, one still executing → decideFinalize refuses (would otherwise spin).
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: {
                t1: taskRow({task_id: 't1', status: 'done', pr_number: 11}),
                t2: {
                    task_id: 't2',
                    status: 'executing',
                    phase: 'exec',
                    depends_on: [],
                    risk_tier: 'medium',
                    escalation_rung: 0,
                    reviewers: [],
                    merge_resyncs: 0,
                },
            },
        }))
        const spec = makeSpec([
            {task_id: 't1', status: 'done'},
            {task_id: 't2', status: 'done'},
        ])

        await expect(finalizeRun(makeDeps(spec, 'live'), RUN_ID)).rejects.toThrow()
        // state untouched — still running, resumable.
        expect((await state.read(RUN_ID)).status).toBe('running')
    })

    it('completed: rolls up, comments + closes the PRD issue (Decision 34)', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', branch: 'factory/run/t1', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        await finalizeRun(makeDeps(spec, 'live'), RUN_ID)

        // rollup merged
        expect(gh.merges).toHaveLength(1)
        // PRD comment filed with the issue number
        expect(gh.issueComments.map((c) => c.number)).toContain(ISSUE)
        // PRD closed
        expect(gh.issueCloses.map((c) => c.number)).toContain(ISSUE)
    })

    it('completed + no-merge: no merge, no PRD close (rollup opened only)', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        await finalizeRun(makeDeps(makeSpec(tasks), 'no-merge'), RUN_ID)

        expect(gh.merges).toHaveLength(0)
        // PR opened but not merged → no PRD close/comment
        expect(gh.issueCloses).toHaveLength(0)
        expect(gh.issueComments).toHaveLength(0)
    })

    it('failed (some failed): no rollup, PRD NOT closed (Decision 34)', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'failed', failure_class: 'capability-budget'},
        ]
        await seed(tasks)

        const res = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(res.run.status).toBe('failed')
        expect(gh.merges).toHaveLength(0)
        // PRD NOT closed — but the failure comment IS posted (fails surfaced on the PRD).
        expect(gh.issueCloses).toHaveLength(0)
        expect(gh.issueComments).toHaveLength(1)
        expect(at(gh.issueComments, 0).number).toBe(ISSUE)
    })

    it('reconciles develop into staging/<run-id> then rolls up that branch', async () => {
        const tasks: TaskSeed[] = [
            {task_id: 't1', status: 'done', pr_number: 11},
            {task_id: 't2', status: 'done', pr_number: 12},
        ]
        await seed(tasks)
        const spec = makeSpec(tasks)

        const res = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)

        // (a) git merged origin/develop into staging/<run-id> before the rollup PR.
        expect(git.mergesInto[`staging-${RUN_ID}`]).toContain('origin/develop')
        // (b) the rollup PR head is staging/<run-id>.
        expect(gh.created.at(-1)?.head).toBe(`staging-${RUN_ID}`)
        // (c) run reached completed.
        expect(res.run.status).toBe('completed')
    })

    describe('D74 — run-scoped develop de-escalation (step 6.5)', () => {
        const BASELINE = {requiredStatusChecks: ['Quality', 'Security Scan'], strict: false, enforceAdmins: false}
        const DONE: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        const developPuts = () => gh.protectionPuts.filter((p) => p.branch === 'develop').map((p) => p.body)

        it('completed + merged rollup → develop drops to baseline, after the staging branch GC', async () => {
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'live'), RUN_ID)

            expect(result.rollup?.merged).toBe(true)
            expect(developPuts()).toEqual([BASELINE])
            expect(gh.calls.indexOf(`api DELETE refs/heads/staging-${RUN_ID}`)).toBeLessThan(
                gh.calls.indexOf('api PUT protection develop')
            )
        })

        it('completed + no-merge → baseline PUT (open PR is manual-merge; no armed auto-merge to protect)', async () => {
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'no-merge'), RUN_ID)

            expect(result.rollup?.reason).toBe('no-merge')
            expect(developPuts()).toEqual([BASELINE])
        })

        it('failed run (no rollup) → baseline PUT', async () => {
            const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'capability-budget'}]
            await seed(tasks)
            const result = await finalizeRun(makeDeps(makeSpec(tasks), 'live'), RUN_ID)

            expect(result.rollup).toBeUndefined()
            expect(developPuts()).toEqual([BASELINE])
        })

        it('auto-armed rollup → NO baseline PUT (de-escalating would land the armed auto-merge WITHOUT CI); the --recheck-rollup re-drive de-escalates once merged', async () => {
            const {applyRescue} = await import('../rescue/apply.js')
            await seed(DONE)
            const spec = makeSpec(DONE)
            gh.failMergeSquashUnlessAuto = new Error(
                'GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)'
            )

            const first = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)
            expect(first.rollup?.reason).toBe('auto-armed')
            expect(developPuts()).toEqual([]) // strict profile stays — the PR is still gated

            // The queued --auto merge lands externally; human reopens for a re-drive.
            gh.setPr({...getOrThrow(gh.prs, `staging-${RUN_ID}`), state: 'MERGED'})
            await applyRescue(state, RUN_ID, {recheckRollup: true})
            const second = await finalizeRun(makeDeps(spec, 'live'), RUN_ID)

            expect(second.rollup?.merged).toBe(true)
            expect(developPuts()).toEqual([BASELINE]) // now it de-escalates
        })

        it('ci-failing rollup → NO baseline PUT (PR pending; rescue re-drives it later)', async () => {
            gh = new FakeGhClient({checks: 'failing'})
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'live'), RUN_ID)

            expect(result.rollup?.reason).toBe('ci-failing')
            expect(developPuts()).toEqual([])
        })

        it('ci-timeout rollup → NO baseline PUT', async () => {
            gh = new FakeGhClient({checks: 'pending'})
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'live'), RUN_ID)

            expect(result.rollup?.reason).toBe('ci-timeout')
            expect(developPuts()).toEqual([])
        })

        it('sibling active run on the same repo → NO baseline PUT (would strip its enforcement)', async () => {
            await state.create({
                run_id: 'run-sibling',
                staging_branch: 'staging-run-sibling',
                spec: {repo: REPO, spec_id: '7-search', issue_number: 7},
            })
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'live'), RUN_ID)

            expect(result.rollup?.merged).toBe(true)
            expect(developPuts()).toEqual([])
        })

        it('debug run → NO baseline PUT (debug never escalates at create — symmetric exemption)', async () => {
            await state.update(RUN_ID, (s) => ({...s, debug: true}))
            await seed(DONE)
            const result = await finalizeRun(makeDeps(makeSpec(DONE), 'live'), RUN_ID)

            expect(result.rollup?.merged).toBe(true)
            expect(developPuts()).toEqual([])
        })

        it('permanent mode → develop protection never touched', async () => {
            await seed(DONE)
            const config = defaultConfig()
            const deps = {
                ...makeDeps(makeSpec(DONE), 'live'),
                config: {...config, git: {...config.git, developProtection: 'permanent' as const}},
            }
            const result = await finalizeRun(deps, RUN_ID)

            expect(result.rollup?.merged).toBe(true)
            expect(developPuts()).toEqual([])
        })
    })
})

// ---------------------------------------------------------------------------
// P4 (quick-code-review 2026-07-07): resolveGatesInForce + its three states
// (ok/absent/invalid) were wired into finalize but never exercised through
// finalizeRun end-to-end — only buildPartialReport's rendering was unit-tested
// against hand-built inputs. Drive the real absent/invalid/ok contract states
// via a FakeGitClient pointed at a real temp repo root.
// ---------------------------------------------------------------------------

describe('finalizeRun — gates-in-force (S3, resolveGatesInForce)', () => {
    let dataDir: string
    let repoRoot: string
    let state: StateManager
    let gh: FakeGhClient
    let git: FakeGitClient

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-finalize-gates-'))
        repoRoot = await mkdtemp(join(tmpdir(), 'factory-finalize-gates-repo-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        gh = new FakeGhClient()
        git = new FakeGitClient({repoRoot})
        await state.create({
            run_id: RUN_ID,
            staging_branch: `staging-${RUN_ID}`,
            spec: {repo: REPO, spec_id: SPEC_ID, issue_number: ISSUE},
        })
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(repoRoot, {recursive: true, force: true})
    })

    async function seed(tasks: readonly TaskSeed[]): Promise<void> {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: Object.fromEntries(tasks.map((t) => [t.task_id, taskRow(t)])),
        }))
    }

    function makeDeps(spec: SpecManifest): FinalizeRunDeps {
        return {
            state,
            gh,
            git,
            config: defaultConfig(),
            spec,
            dataDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode: 'live',
            nowIso: NOW,
            rollup: {
                sleep: async () => {
                    /* no-op */
                },
                pollIntervalMs: 0,
                maxPolls: 3,
            },
        }
    }

    it('ok contract → report.gates enumerated, markdown renders "Enforced:"', async () => {
        await mkdir(join(repoRoot, '.factory'), {recursive: true})
        await writeFile(join(repoRoot, GATE_CONTRACT_REL), JSON.stringify(validContract()), 'utf8')
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks)), RUN_ID)

        expect(result.report.gates).toBeDefined()
        expect(result.report.gates?.contracted).toEqual(expect.arrayContaining(['test', 'tdd', 'type', 'build']))
        expect(result.report.gates_unavailable).toBeUndefined()
        const markdown = await readFile(runReportPath(dataDir, RUN_ID), 'utf8')
        expect(markdown).toMatch(/## Gates in force\nEnforced: `test`/)
    })

    it('absent contract (no .factory/gates.json) → report.gates_unavailable, markdown renders the warning', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks)), RUN_ID)

        expect(result.report.gates).toBeUndefined()
        expect(result.report.gates_unavailable).toMatch(/contract absent/)
        const markdown = await readFile(runReportPath(dataDir, RUN_ID), 'utf8')
        expect(markdown).toMatch(/## Gates in force\n⚠️ gate contract unavailable at finalize: contract absent/)
    })

    it('invalid contract (malformed JSON) → report.gates_unavailable names the parse failure', async () => {
        await mkdir(join(repoRoot, '.factory'), {recursive: true})
        await writeFile(join(repoRoot, GATE_CONTRACT_REL), '{not json', 'utf8')
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun(makeDeps(makeSpec(tasks)), RUN_ID)

        expect(result.report.gates).toBeUndefined()
        expect(result.report.gates_unavailable).toMatch(/contract invalid/)
        const markdown = await readFile(runReportPath(dataDir, RUN_ID), 'utf8')
        expect(markdown).toMatch(/## Gates in force\n⚠️ gate contract unavailable at finalize: contract invalid/)
    })

    it('showToplevel() throw (repo root unresolved) → report.gates_unavailable, finalize still completes', async () => {
        class ThrowingToplevelGit extends FakeGitClient {
            override showToplevel(): Promise<string> {
                throw new Error('fatal: not a git repository')
            }
        }
        const throwingGit = new ThrowingToplevelGit({repoRoot})
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)

        const result = await finalizeRun({...makeDeps(makeSpec(tasks)), git: throwingGit}, RUN_ID)

        expect(result.run.status).toBe('completed')
        expect(result.report.gates).toBeUndefined()
        expect(result.report.gates_unavailable).toMatch(/repo root unresolved/)
    })
})

// ---------------------------------------------------------------------------
// Decision 39 (debug driver, forward decl): `run.debug` defers the PRD-facing
// finalize guards — commentFailuresOnPrd + the completed-rollup issueComment/
// issueClose pair — to the debug driver instead of the plain finalize coordinator.
// ---------------------------------------------------------------------------

/**
 * A gh fake that throws on the three PRD-facing calls (issueComment, issueClose,
 * listIssueComments) so a test can prove finalize never reaches them — while every
 * other gh op (rollup PR create/merge/checks, branch GC) behaves exactly like the
 * plain {@link FakeGhClient}.
 */
class ThrowingCommentGh extends FakeGhClient {
    override issueComment(): Promise<void> {
        throw new Error('issueComment called — should be unreachable under run.debug')
    }
    override issueClose(): Promise<void> {
        throw new Error('issueClose called — should be unreachable under run.debug')
    }
    override listIssueComments(): Promise<string[]> {
        throw new Error('listIssueComments called — should be unreachable under run.debug')
    }
}

describe('finalizeRun — run.debug defers PRD-facing calls to the debug driver', () => {
    let dataDir: string
    let state: StateManager
    let gh: ThrowingCommentGh
    let git: FakeGitClient

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-finalize-debug-'))
        state = new StateManager({
            dataDir,
            lock: {stale: 5000, retries: 200, retryMinTimeout: 5, retryMaxTimeout: 50},
        })
        gh = new ThrowingCommentGh()
        git = new FakeGitClient()
        await state.create({
            run_id: RUN_ID,
            staging_branch: `staging-${RUN_ID}`,
            spec: {repo: REPO, spec_id: SPEC_ID, issue_number: ISSUE},
        })
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    async function seed(tasks: readonly TaskSeed[]): Promise<void> {
        await state.update(RUN_ID, (s) => ({
            ...s,
            tasks: Object.fromEntries(tasks.map((t) => [t.task_id, taskRow(t)])),
        }))
    }

    function makeDebugDeps(spec: SpecManifest, shipMode: ShipMode): FinalizeRunDeps {
        return {
            state,
            gh,
            git,
            config: defaultConfig(),
            spec,
            dataDir,
            owner: 'acme',
            repo: 'widgets',
            shipMode,
            nowIso: NOW,
            rollup: {
                sleep: async () => {
                    /* no-op */
                },
                pollIntervalMs: 0,
                maxPolls: 3,
            },
        }
    }

    it('debug:true completed run finalizes successfully despite a throwing gh (issueComment/issueClose never reached)', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({...s, debug: true}))

        const result = await finalizeRun(makeDebugDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.run.status).toBe('completed')
        expect(result.rollup?.merged).toBe(true) // rollup itself stays unconditional
        expect(result.failureCommentPosted).toBe(false)
    })

    it('debug:true failed run finalizes successfully despite a throwing gh (commentFailuresOnPrd never reached)', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'capability-budget'}]
        await seed(tasks)
        await state.update(RUN_ID, (s) => ({...s, debug: true}))

        const result = await finalizeRun(makeDebugDeps(makeSpec(tasks), 'live'), RUN_ID)

        expect(result.run.status).toBe('failed')
        expect(result.failureCommentPosted).toBe(false)
    })

    it('debug:false (regression guard) completed run still calls issueComment/issueClose — throwing gh propagates', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'done', pr_number: 11}]
        await seed(tasks)
        // run.debug defaults to false — no update needed.

        await expect(finalizeRun(makeDebugDeps(makeSpec(tasks), 'live'), RUN_ID)).rejects.toThrow(/issueComment/)
    })

    it('debug:false (regression guard) failed run still calls commentFailuresOnPrd — throwing gh propagates', async () => {
        const tasks: TaskSeed[] = [{task_id: 't1', status: 'failed', failure_class: 'capability-budget'}]
        await seed(tasks)

        await expect(finalizeRun(makeDebugDeps(makeSpec(tasks), 'live'), RUN_ID)).rejects.toThrow(/listIssueComments/)
    })
})

// ---------------------------------------------------------------------------
// prdDoneComment — URL-absent branch (number-only fallback)
// ---------------------------------------------------------------------------

describe('prdDoneComment', () => {
    const baseReport = {
        run_id: 'run-final-1',
        run_status: 'completed' as const,
        spec_id: '42-checkout',
        issue_number: 42,
        repo: 'acme/widgets',
        generated_at: '2026-06-29T00:00:00.000Z',
        totals: {total: 1, shipped: 1, failed: 0, incomplete: 0},
        shipped: [],
        failures: [],
        incomplete: [],
    }

    it('uses markdown link when url is present', () => {
        const c = prdDoneComment(baseReport, {
            number: 7,
            url: 'https://github.com/acme/widgets/pull/7',
            resumed: false,
            merged: true,
        })
        expect(c).toContain('[#7](https://github.com/acme/widgets/pull/7)')
    })

    it('falls back to bare number when url is absent (empty string)', () => {
        const c = prdDoneComment(baseReport, {number: 42, url: '', resumed: false, merged: true})
        expect(c).toContain('#42')
        expect(c).not.toContain('[#42](')
    })
})

describe('deriveTerminalReason', () => {
    /** Minimal RunState slice — the function reads only the override phases + tasks. */
    function run(over: Partial<RunState>): RunState {
        return {tasks: {}, ...over} as RunState
    }
    const failedPhase = {status: 'failed' as const, reason: 'boom'}

    it.each([
        ['e2e phase failed with reason', run({e2e_phase: failedPhase as never}), 'completed', 'e2e phase failed: boom'],
        [
            'e2e phase failed without reason',
            run({e2e_phase: {status: 'failed'} as never}),
            'completed',
            'e2e phase failed: no reason recorded',
        ],
        ['assessment failed', run({e2e_assessment: failedPhase as never}), 'completed', 'e2e assessment failed: boom'],
        [
            'traceability failed',
            run({traceability: failedPhase as never}),
            'completed',
            'traceability audit failed: boom',
        ],
        [
            'e2e phase outranks assessment + traceability',
            run({
                e2e_phase: failedPhase as never,
                e2e_assessment: failedPhase as never,
                traceability: failedPhase as never,
            }),
            'failed',
            'e2e phase failed: boom',
        ],
        ['no override + completed tasks', run({}), 'completed', undefined],
        ['failed with zero tasks', run({}), 'failed', 'no tasks (nothing was shippable)'],
    ])('%s', (_label, state, taskTerminal, expected) => {
        expect(deriveTerminalReason(state, taskTerminal)).toBe(expected)
    })

    it('tallies failed tasks, naming failure classes', () => {
        const state = run({
            tasks: {
                t1: taskRow({task_id: 't1', status: 'done'}),
                t2: taskRow({task_id: 't2', status: 'failed', failure_class: 'capability-budget'}),
                t3: taskRow({task_id: 't3', status: 'failed', failure_class: 'blocked-environmental'}),
            },
        })
        expect(deriveTerminalReason(state, 'failed')).toBe(
            '2 of 3 task(s) failed: t2 (capability-budget), t3 (blocked-environmental)'
        )
    })

    it('names at most three failed tasks, then elides', () => {
        const seeds: TaskSeed[] = ['t1', 't2', 't3', 't4', 't5'].map((task_id) => ({
            task_id,
            status: 'failed' as const,
        }))
        const state = run({tasks: Object.fromEntries(seeds.map((t) => [t.task_id, taskRow(t)]))})
        const reason = deriveTerminalReason(state, 'failed')
        expect(reason).toContain('5 of 5 task(s) failed:')
        expect(reason).toContain('t3')
        expect(reason).not.toContain('t4')
        expect(reason).toMatch(/, …$/)
    })
})
