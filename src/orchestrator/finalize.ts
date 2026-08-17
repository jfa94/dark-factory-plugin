/**
 * WS12 — the run FINALIZE coordinator (§④ rollup + §⑤ outcome; Δ S, Decision 22).
 *
 * "Never ship silently." Once every task is terminal, finalize turns the run into
 * its outcome artifacts and ships them, in a RESUME-SAFE order:
 *
 *   1. derive the terminal status (decideFinalize — THROWS if any task is in-flight)
 *   2. build the deterministic run report (status overridden to the terminal,
 *      since state.status is still `running`/`paused` until step 7)
 *   3. persist report.md (atomic) under the run store
 *   4. emit run.finalized + per-failure telemetry (thin jsonl; never fatal)
 *   5. on a `failed` run, post ONE comment on the originating PRD issue listing every
 *      failed task (class + reason + unmet criteria) — GitHub issues are PRDs, not
 *      tasks; the per-task status already lives in the run state. Idempotent: a hidden
 *      run-id marker lets a resumed finalize detect its own prior comment and skip
 *      (Δ S; "without repeating dead ends"). The PRD is left OPEN.
 *   6. rollup fires only on `completed` (Decision 34 — develop receives whole PRDs
 *      only): open + CI-gate + squash-merge the per-run staging→develop rollup. A
 *      merged rollup then closes/comments the PRD issue and deletes the per-run
 *      staging branch (Decision 35: protection first, then branch — GitHub blocks
 *      deleting a protected ref). A `failed` run leaves develop untouched and keeps
 *      the branch + protection, banked for rescue / inspection.
 *   6.5. (D74, run-scoped mode) de-escalate develop back to the BASELINE protection
 *      profile — but never while a rollup PR is still pending (auto-armed/CI-blocked:
 *      dropping the policy would let an armed auto-merge land WITHOUT CI) and never
 *      while a sibling run on the same repo is still active.
 *   7. ONLY THEN flip the run terminal (state.finalize)
 *
 * state.finalize is LAST on purpose: a crash anywhere in 2–6 leaves the run
 * non-terminal, so a re-drive re-enters finalize — and every step is idempotent
 * (report rewrite, telemetry append, issue dedup, rollup resume-guard, PRD comment
 * gated on the first finalize, 404-tolerant branch GC). The run is flipped terminal
 * only once its outcome is fully shipped.
 *
 * no-merge cutover (ShipMode): the rollup PR is opened but never merged; the failure
 * comment is still posted (the failures are real regardless of merge).
 */
import {
    decideFinalize,
    rollup,
    DEFAULT_POLL_INTERVAL_MS,
    loadGateContract,
    enumerateGatesInForce,
    buildPartialReport,
    renderPartialReportMarkdown,
    renderFailureComment,
    failureCommentMarker,
    recordRunFinalized,
    putBaselineProtection,
    effectiveProfiles,
    scanRun,
    effectiveAutoResets,
    SELF_HEAL_MAX_ATTEMPTS,
    type Config,
    type GhClient,
    type GitClient,
    type RunState,
    type SpecManifest,
    type StateManager,
    type PartialRunReport,
    type RollupArgs,
    type RollupResult,
} from './deps.js'
import type {ShipMode} from './types.js'
import {atomicWriteFile, createLogger, nowIso} from '../shared/index.js'
import {loadRequiredCheckExtras, requiredCheckExtras} from '../verifier/deterministic/gate-contract.js'
import {runReportPath} from '../core/state/paths.js'
import {appendLedgerEntries} from '../spec/ledger.js'

const log = createLogger('finalize')

/** Comment body posted to the PRD issue when the rollup merges (Decision 34). */
export function prdDoneComment(report: PartialRunReport, rollupResult: RollupResult): string {
    const prRef = rollupResult.url ? `[#${rollupResult.number}](${rollupResult.url})` : `#${rollupResult.number}`
    return (
        `PRD delivered — all ${report.totals.shipped} task(s) shipped via rollup PR ${prRef}.\n\n` +
        `Spec: \`${report.spec_id}\` · Run: \`${report.run_id}\``
    )
}

/** The deps the finalize coordinator needs — a subset of {@link import("./orchestrator.js").OrchestratorDeps} + CLI deps. */
export interface FinalizeRunDeps {
    /** The only sanctioned state read/write path. */
    readonly state: StateManager
    /** gh client for the rollup PR + the deduped PRD failure comment. */
    readonly gh: GhClient
    /**
     * git client for the forward-reconcile (fetch + merge + push) before the rollup.
     * Operates on the target repo working tree (process.cwd() by default).
     */
    readonly git: GitClient
    /** The run's durable spec (source of the unmet acceptance criteria). */
    readonly spec: SpecManifest
    /**
     * Resolved plugin config (provides `git.baseBranch` for the forward-reconcile +
     * rollup `baseBranch` arg).
     */
    readonly config: Config
    /** Plugin data dir (roots the run store — report.md, metrics.jsonl). */
    readonly dataDir: string
    /** Repo owner — used for the per-run staging-branch GC (deleteProtection / deleteRemoteBranch). */
    readonly owner: string
    /** Repo name. */
    readonly repo: string
    /** `live` merges the rollup; `no-merge` opens it but never auto-merges. */
    readonly shipMode: ShipMode
    /**
     * ISO stamp for the report + telemetry (tests pin this). Defaults to nowIso().
     * Named `nowIso` (not `now`) so {@link import("./orchestrator.js").OrchestratorDeps} — whose
     * `now: () => number` is the quota epoch-seconds clock — assigns structurally to
     * this deps subset.
     */
    readonly nowIso?: string
    /** Rollup CI-poll tuning (tests inject a no-op sleep + a tiny budget). */
    readonly rollup?: Pick<RollupArgs, 'pollIntervalMs' | 'maxPolls' | 'sleep'>
    /**
     * Target repo main-worktree root — the gate-contract read for per-repo
     * required-check extras (`requiredChecks`/`requireMutationAtRest`) at the
     * baseline de-escalation. Optional: absent (bare test deps) → no extras.
     */
    readonly targetRoot?: string
}

/** The outcome of {@link finalizeRun}. */
export interface FinalizeRunResult {
    /** The run AFTER it was flipped to its terminal status. */
    readonly run: RunState
    /** The deterministic report (also persisted to report.md + used as the rollup body). */
    readonly report: PartialRunReport
    /** The rollup outcome, or undefined when nothing shipped (no rollup attempted). */
    readonly rollup?: RollupResult
    /** Whether a NEW failure comment was posted to the PRD (deduped — a resume posts none). */
    readonly failureCommentPosted: boolean
}

/** The rollup PR title — names the spec + originating PRD issue. */
function rollupTitle(report: PartialRunReport): string {
    return `factory: ${report.spec_id} → develop (PRD #${report.issue_number})`
}

/**
 * On a `failed` run, post ONE comment on the originating PRD issue summarizing every
 * failed task. GitHub issues are PRDs, not tasks — the authoritative per-task status
 * lives in the run state; this is the human-facing "loud fail" surface (Δ S), PRD-scoped
 * and symmetric with the completed path's PRD-delivered comment. The PRD is left OPEN.
 *
 * Idempotent: the comment body carries a hidden run-id marker, so a resumed finalize
 * scans the PRD's existing comments and skips if its own comment is already there
 * (mirrors the old issue-title dedup). Returns whether a NEW comment was posted (a
 * resume posts none). A `completed` run has no failures → no comment here (its PRD
 * comment + close happens in the rollup step).
 */
async function commentFailuresOnPrd(deps: FinalizeRunDeps, run: RunState, report: PartialRunReport): Promise<boolean> {
    // Decision 39: a `failed` run with zero task failures (an e2e-only veto — every
    // task shipped) still needs the PRD comment, or "never ship silently" is broken.
    // S9 (Decision 47): same for a traceability-only veto.
    if (report.failures.length === 0 && report.e2e_failure === undefined && report.traceability_failure === undefined) {
        return false
    }

    const marker = failureCommentMarker(report.run_id)
    const existing = await deps.gh.listIssueComments({
        repo: report.repo,
        number: report.issue_number,
    })
    if (existing.some((body) => body.includes(marker))) {
        log.info(`failure comment already posted for run '${report.run_id}' — skipping duplicate`)
        return false
    }

    // S10 (Decision 48): tell the PRD reader whether the runner's bounded self-heal
    // (`factory rescue auto`) fires next — eligible iff the ≤3-cycle budget still has
    // room and the auto-safe reset set is non-empty.
    const selfHealEligible =
        (run.self_heal?.attempts ?? 0) < SELF_HEAL_MAX_ATTEMPTS && effectiveAutoResets(run, scanRun(run)).length > 0

    await deps.gh.issueComment({
        repo: report.repo,
        number: report.issue_number,
        body: renderFailureComment(report, selfHealEligible),
    })
    return true
}

/**
 * One-line WHY for a run that finalizes `failed` (undefined on completed): the
 * phase override that condemned it (e2e / assessment / traceability, with that
 * phase's own reason), else the task tally. Mirrors the status-override ordering
 * in {@link finalizeRun} step 1 so the reason always names the actual condemner.
 */
export function deriveTerminalReason(run: RunState, taskTerminal: string): string | undefined {
    if (run.e2e_phase?.status === 'failed') {
        return `e2e phase failed: ${run.e2e_phase.reason ?? 'no reason recorded'}`
    }
    if (run.e2e_assessment?.status === 'failed') {
        return `e2e assessment failed: ${run.e2e_assessment.reason ?? 'no reason recorded'}`
    }
    if (run.traceability?.status === 'failed') {
        return `traceability audit failed: ${run.traceability.reason ?? 'no reason recorded'}`
    }
    if (taskTerminal !== 'failed') {
        return undefined
    }
    const tasks = Object.values(run.tasks)
    if (tasks.length === 0) {
        return 'no tasks (nothing was shippable)'
    }
    const failed = tasks.filter((t) => t.status !== 'done')
    const named = failed
        .slice(0, 3)
        .map((t) => `${t.task_id}${t.failure_class ? ` (${t.failure_class})` : ''}`)
        .join(', ')
    return `${failed.length} of ${tasks.length} task(s) failed: ${named}${failed.length > 3 ? ', …' : ''}`
}

/**
 * Finalize a run whose tasks are ALL terminal: build + persist the report, emit
 * telemetry, post the deduped PRD failure comment, ship the rollup, then flip the run terminal.
 * See the module header for the resume-safe ordering + idempotency contract.
 */
export async function finalizeRun(deps: FinalizeRunDeps, runId: string): Promise<FinalizeRunResult> {
    const now = deps.nowIso ?? nowIso()
    const run = await deps.state.read(runId)

    // 1. terminal status (throws loud if any task is non-terminal — anti-spin).
    // Decision 39: a `failed` e2e phase overrides the task-based verdict to `failed`
    // even when every task individually shipped — decideFinalize (WS2, pure
    // task-status) has no visibility into the e2e phase (residual critical red, an
    // unmappable critical regression, or a cap-exhausted critical), so the override
    // lives here, the run's finalize coordinator.
    // Decision 40: a `failed` ASSESSMENT likewise condemns the run — normally the
    // record leg's task sweep already makes taskTerminal `failed`, but a resumed run
    // whose tasks were ALL done before the assessment fired has nothing to sweep.
    // S9 (Decision 47): a `failed` PRD-traceability audit condemns the run the same
    // way — unmet PRD intent (or an auditor crash at cap) blocks the rollup.
    const taskTerminal = decideFinalize(run).run_status
    const terminal =
        run.e2e_phase?.status === 'failed' ||
        run.e2e_assessment?.status === 'failed' ||
        run.traceability?.status === 'failed'
            ? 'failed'
            : taskTerminal
    // The WHY, derived at the same point as the status (persisted at step 7 as
    // terminal_reason): the phase override that condemned the run, else the task tally.
    const terminalReason = deriveTerminalReason(run, taskTerminal)

    // 2. report — status overridden to the DECIDED terminal (state flips in step 7).
    // Gates-in-force (S3): re-derive from the repo's committed contract (derive-don't-store;
    // the contract is TCB-write-denied to agents, so any mid-run drift is operator-only). If
    // it can't be loaded at finalize, render that state loudly rather than omitting the section.
    const gates = await resolveGatesInForce(deps.git)
    const report = buildPartialReport(
        {...run, status: terminal, ...(terminal === 'failed' ? {terminal_reason: terminalReason} : {})},
        deps.spec,
        {now, ...gates}
    )
    const markdown = renderPartialReportMarkdown(report)

    // 3. persist report.md (atomic full-file replace).
    await atomicWriteFile(runReportPath(deps.dataDir, runId), markdown)

    // 4. telemetry (swallows its own IO errors — never fatal).
    await recordRunFinalized(deps.dataDir, report, {now})

    // 5. on a failed run, one PRD comment summarizing the failures (deduped by run-id marker).
    // Decision 39 (debug driver, forward decl): a debug run isn't a whole-PRD delivery —
    // it loops review⇄fix passes on the debug session's OWN staging branch/PR, so the PRD
    // issue is never touched from finalize (the debug driver owns any PRD-facing comms).
    const failureCommentPosted = run.debug ? false : await commentFailuresOnPrd(deps, run, report)

    // 6. rollup — only on completed (Decision 34: develop receives whole PRDs only).
    //    On failed, develop is untouched (the PRD failure comment is already posted above).
    let rollupResult: RollupResult | undefined
    if (terminal === 'completed') {
        const stagingBranch = run.staging_branch
        // Forward-reconcile (Decision 33): bring develop's new commits into the run branch
        // (no force-push) so the rollup PR is up-to-date. A conflict is non-auto-recoverable:
        // abort-clean (tryMergeNoForce — never leave the tree mid-merge), persist a durable
        // `rollup {merged:false}` marker so `rescue scan` flags the run (`rollup_pending`)
        // instead of reporting it healthy, THEN throw. The run stays non-terminal; recovery
        // is a human resolving the staging↔develop conflict + plain `factory resume`, whose
        // re-entered finalize re-merges and overwrites this marker with the real rollup result.
        await deps.git.fetch('origin', deps.config.git.baseBranch)
        const reconcile = await deps.git.tryMergeNoForce(stagingBranch, `origin/${deps.config.git.baseBranch}`)
        if (!reconcile.merged) {
            const reason = `forward-reconcile conflict merging origin/${deps.config.git.baseBranch} into ${stagingBranch}: ${reconcile.conflict}`
            await deps.state.update(runId, (s) => ({...s, rollup: {merged: false, reason}}))
            throw new Error(
                `finalize: ${reason} — resolve the conflict on '${stagingBranch}', push, then \`factory resume\``
            )
        }
        await deps.git.push('origin', stagingBranch)

        rollupResult = await rollup({
            ghClient: deps.gh,
            stagingBranch,
            baseBranch: deps.config.git.baseBranch,
            title: rollupTitle(report),
            body: markdown,
            merge: deps.shipMode === 'live',
            // A6: CI wait budget from config (minutes → polls); deps.rollup (tests)
            // still overrides.
            maxPolls: Math.ceil((deps.config.git.rollupCiWaitMinutes * 60_000) / DEFAULT_POLL_INTERVAL_MS),
            ...(deps.rollup ?? {}),
        })
        // Capture in a const so the state.update mutator closure below sees the
        // definitely-assigned RollupResult without a non-null assertion (a `let`
        // widens back to `| undefined` when captured in a closure).
        const rr = rollupResult

        if (rollupResult.merged) {
            // PRD-delivered comment + close. issueComment is NOT idempotent (a re-posted
            // comment is a visible duplicate), so fire it ONLY on the first finalize — a
            // resumed finalize hits rollup()'s already-merged short-circuit (resumed === true)
            // and must not double-post. issueClose is naturally idempotent (closing a closed
            // issue is a no-op), so it stays unconditional. issue_number is a required field
            // (always ≥1), so there is no presence guard to make.
            // Decision 39 (debug driver, forward decl): a debug run's rollup targets the
            // debug session's own staging branch/PR, not a PRD delivery — the PRD comment +
            // close are skipped, but the branch GC below stays unconditional (it operates on
            // the debug run's real branch/PR regardless of PRD linkage).
            if (!run.debug) {
                if (!rollupResult.resumed) {
                    await deps.gh.issueComment({
                        repo: report.repo,
                        number: report.issue_number,
                        body: prdDoneComment(report, rollupResult),
                    })
                }
                await deps.gh.issueClose({
                    repo: report.repo,
                    number: report.issue_number,
                })
            }
            // Branch GC (Decision 35): a completed+merged run is fully contained in develop, so
            // tear down its per-run staging branch. Protection FIRST — GitHub blocks deleting a
            // protected ref. Both ops are idempotent (404-tolerant), so a resumed finalize safely
            // repeats them. A `failed` run (or a `no-merge` open PR) keeps its branch + protection,
            // banked for rescue / inspection.
            await deps.gh.deleteProtection(deps.owner, deps.repo, stagingBranch)
            await deps.gh.deleteRemoteBranch(deps.owner, deps.repo, stagingBranch)

            // Decision 70 — durable shipped-ledger: one `source: 'shipped'` entry per done
            // task, keyed to the POST-rollup develop tip (task squash SHAs are never
            // ancestors of future bases; the rollup tip is). Debug runs skipped — a debug
            // session is not a PRD delivery. Ledger IO failure logs LOUD but never fails
            // finalize (the ALREADY_SATISFIED verdict covers the gap on the next run).
            if (!run.debug) {
                try {
                    await deps.git.fetch('origin', deps.config.git.baseBranch)
                    const developTip = await deps.git.revParse(`origin/${deps.config.git.baseBranch}`)
                    const done = Object.values(run.tasks).filter((t) => t.status === 'done')
                    await appendLedgerEntries(
                        deps.dataDir,
                        run.spec.repo,
                        run.spec.spec_id,
                        done.map((t) => ({
                            task_id: t.task_id,
                            run_id: runId,
                            ...(t.pr_number !== undefined ? {pr_number: t.pr_number} : {}),
                            shas: [developTip],
                            verified_at: now,
                            source: 'shipped' as const,
                        }))
                    )
                } catch (err) {
                    log.error(
                        `shipped-ledger append failed for '${run.spec.spec_id}' (finalize continues; ` +
                            `the next run falls back to the ALREADY_SATISFIED verdict): ${String(err)}`
                    )
                }
            }
        }

        // Persist the rollup outcome (finding #5, minimal surface): a not-yet-landed
        // rollup (e.g. the "auto-armed" branch-policy fallback) needs a durable pointer
        // so `rescue scan` can flag it (`rollup_pending`) without a live GitHub call, and
        // `rescue apply --recheck-rollup` can reopen the run for a re-drive to re-check
        // it. Written BEFORE the terminal flip (step 7) so a crash in between still
        // leaves the pointer durable. Cleared (set undefined, dropped on persistence)
        // once merged — a resumed finalize that now finds the PR merged has nothing
        // left to recover.
        await deps.state.update(runId, (s) => ({
            ...s,
            rollup: rr.merged
                ? undefined
                : {
                      number: rr.number,
                      merged: false,
                      ...(rr.reason ? {reason: rr.reason} : {}),
                  },
        }))
    } else {
        log.warn(`run '${runId}': ${terminal} — develop untouched (no rollup, PRD left open)`)
    }

    // 6.5. D74 — run-scoped develop protection: outcome shipped, drop develop back to
    // the baseline profile. NEVER while a rollup PR is still pending (auto-armed /
    // ci-failing / ci-timeout / not-mergeable — de-escalating would let an armed
    // auto-merge land WITHOUT CI; the `run.rollup` pointer keeps the run recoverable
    // and a --recheck-rollup re-drive lands here again once it merges), and never
    // while a sibling run on the same repo is active. Debug runs are symmetric-exempt:
    // they never escalate at create (debugSeed's createRun carries no stagingDeps), so
    // they never de-escalate here. Idempotent PUT, placed before the terminal flip so
    // a throw leaves the run resumable.
    const rollupPending = rollupResult !== undefined && !rollupResult.merged && rollupResult.reason !== 'no-merge'
    if (
        !run.debug &&
        deps.config.git.developProtection === 'run-scoped' &&
        !rollupPending &&
        !(await deps.state.hasOtherActiveForRepo(run.spec.repo, runId))
    ) {
        await putBaselineProtection({
            ghClient: deps.gh,
            owner: deps.owner,
            repo: deps.repo,
            branch: deps.config.git.baseBranch,
            contexts: effectiveProfiles(
                deps.config.git,
                deps.targetRoot !== undefined
                    ? await loadRequiredCheckExtras(deps.targetRoot)
                    : requiredCheckExtras(undefined)
            ).baseline,
        })
    }

    // 7. flip terminal LAST (so a crash in 2–6 leaves the run resumable).
    const finalized =
        terminal === 'completed'
            ? await deps.state.finalize(runId, 'completed')
            : await deps.state.finalize(runId, 'failed', terminalReason ?? 'run failed (no cause recorded)')
    // D3: a not-merged rollup (incl. the new "auto-armed" branch-policy fallback) names
    // its reason here — "visible, not silent" for the completed-but-not-yet-landed gap
    // (the `completed` verdict is DECIDED at step 1, before the rollup runs; it is only
    // persisted here at step 7).
    const rollupNote = rollupResult
        ? `, rollup #${rollupResult.number} merged=${rollupResult.merged}` +
          (rollupResult.merged ? '' : ` (${rollupResult.reason})`)
        : ', no rollup'
    log.info(
        `run '${runId}' finalized: ${terminal} ` +
            `(${report.totals.shipped} shipped, ${report.totals.failed} failed` +
            (failureCommentPosted ? ', PRD failure comment posted' : '') +
            rollupNote +
            `)`
    )

    return {
        run: finalized,
        report,
        ...(rollupResult ? {rollup: rollupResult} : {}),
        failureCommentPosted,
    }
}

/**
 * Re-derive the gates-in-force from the repo's committed contract at finalize (S3).
 * Returns the shape {@link buildPartialReport} consumes: `{gates}` when the contract
 * loads, `{gatesUnavailable}` (loud) when it is absent/invalid/unreachable.
 */
async function resolveGatesInForce(
    git: GitClient
): Promise<{gates: ReturnType<typeof enumerateGatesInForce>} | {gatesUnavailable: string}> {
    let root: string
    try {
        root = await git.showToplevel()
    } catch (err) {
        return {gatesUnavailable: `repo root unresolved: ${(err as Error).message}`}
    }
    const load = await loadGateContract(root)
    switch (load.state) {
        case 'ok':
            return {gates: enumerateGatesInForce(load.contract)}
        case 'absent':
            return {gatesUnavailable: `contract absent at ${root}`}
        case 'invalid':
            return {gatesUnavailable: `contract invalid: ${load.error}`}
    }
}
