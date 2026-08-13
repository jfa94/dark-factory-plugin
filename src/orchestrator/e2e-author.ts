/**
 * The e2e AUTHOR leg (Decision 39/40): prompt + spawn prep for the once-per-run
 * authoring pass, and the record side that gates its output — the trust-boundary
 * checks (safe spec paths, diff scope, declared-manifest converse), the fail-first
 * proof, the merge, and the D5 crash-retry. The re-entry dispatch lives in the
 * facade (`e2e.ts`); the crash-retry re-enters it via the threaded {@link EmitFn}.
 */
import {isAbsolute} from 'node:path'
import {E2E_TEST_DIR} from '../config/schema.js'
import {ensureStageWorktree, publishToStaging, specTaskLines} from './stage-helpers.js'
import {
    parseProducerStatus,
    provisionWorktree,
    removeWorktreeBestEffort,
    E2E_AUTHOR_AGENT_TYPE,
    type RunState,
    type SpecManifest,
} from './deps.js'
import {createLogger} from '../shared/index.js'
import {CONTROL_TITLE_PREFIX, type E2eAuthorResults} from './e2e-schemas.js'
import {e2eWorktreePath, e2eThrowawayDir, e2eBranchName, resolveBootConfig, type BootConfig} from './e2e-paths.js'
import {
    defaultE2ePhase,
    errText,
    markFailed,
    E2E_AUTHOR_MODEL,
    MAX_AUTHOR_ATTEMPTS,
    type E2eAction,
    type E2eRunDeps,
    type EmitFn,
} from './e2e-shared.js'
import {proveCriticals} from './e2e-proof.js'
import {runSuiteAndDecide} from './e2e-suite.js'

const log = createLogger('e2e')

/** Build the e2e-author prompt: the task list + config + the two spec destinations. */
function buildAuthorPrompt(args: {
    worktree: string
    baseRef: string
    throwawayDir: string
    testDir: string
    startCommand: string
    baseURL: string
    spec: SpecManifest
}): string {
    const taskLines = specTaskLines(args.spec)
    return [
        "You are the factory e2e-author running the pipeline's end-to-end test-authoring phase.",
        `1. cd into your worktree: ${args.worktree} (checked out on the e2e branch off the staging tip).`,
        `2. Boot the app: \`${args.startCommand}\` → ${args.baseURL} (reuse if already running).`,
        '3. Review every task this PRD delivered:',
        taskLines,
        `4. For each USER-FACING task, explore the live app via the Playwright MCP tools and author a ` +
            `THROWAWAY spec into ${args.throwawayDir} (OUTSIDE this worktree — never commit it).`,
        `5. Author a small number of CRITICAL, money-path JOURNEY specs (thin — the load-bearing net, ` +
            `not per-task coverage) into ${args.worktree}/${args.testDir}/ and COMMIT them in this worktree. ` +
            `Each critical spec MUST include one assertion titled with the "${CONTROL_TITLE_PREFIX}" prefix ` +
            'that passes on ANY boot of the app (e.g. the page loads) — the fail-first proof uses it to tell ' +
            "'the app didn't boot' apart from 'the feature doesn't exist yet.'",
        '6. Self-validate: every spec you authored must be green against the live (staging) app before you finish.',
        '7. Do NOT push (the engine merges the critical specs on record). Do NOT edit non-e2e files.',
        'Finish with your terminal STATUS line and return {"status": "<line>", "manifest": [...]} — the ' +
            'manifest is an array of {task_ids, spec_path, kind, title} rows, one per spec you authored ' +
            '(critical `spec_path` is worktree-relative; throwaway `spec_path` is throwaway-dir-relative; ' +
            '`title` is a plain-language journey name a non-technical reader understands, e.g. "Sign up and ' +
            'reach the dashboard"). EVERY file you commit under the test dir must appear as a critical ' +
            'manifest row (support helpers under support/ and auth.setup.ts excepted) — an undeclared ' +
            'committed spec is rejected at record. ' +
            'Per agents/e2e-author.md + skills/e2e-authoring/SKILL.md for the full authoring discipline.',
    ].join('\n')
}

export async function prepareAuthorSpawn(
    deps: E2eRunDeps,
    run: RunState,
    runId: string,
    boot: BootConfig,
    testDir: string
): Promise<E2eAction> {
    const staging = run.staging_branch
    const base = deps.config.git.baseBranch
    const branch = e2eBranchName(runId)
    const worktree = e2eWorktreePath(deps.workDir, runId)
    const baseRef = `origin/${base}`

    await deps.git.fetch('origin', staging)
    // Retry-reset (D5): a crashed author's partial, unmerged work is discarded so
    // attempt 2 starts from a clean staging tip, not a half-written suite.
    await ensureStageWorktree(deps.git, {
        worktree,
        ref: `origin/${staging}`,
        branch,
        resetIfExists: (run.e2e_phase?.author_attempts ?? 0) >= 1,
        provision: () =>
            (deps.provision ?? provisionWorktree)({
                path: worktree,
                setupCommand: deps.config.quality.setupCommand,
            }),
    })

    const throwawayDir = e2eThrowawayDir(deps.workDir, runId)
    return {
        kind: 'spawn',
        expects: 'author-results',
        run_id: runId,
        agent_type: E2E_AUTHOR_AGENT_TYPE,
        worktree,
        base_ref: baseRef,
        staging_branch: staging,
        e2e_branch: branch,
        throwaway_dir: throwawayDir,
        model: E2E_AUTHOR_MODEL,
        prompt: buildAuthorPrompt({
            worktree,
            baseRef,
            throwawayDir,
            testDir,
            startCommand: boot.startCommand,
            baseURL: boot.baseURL,
            spec: deps.spec,
        }),
    }
}

/**
 * Guard a manifest `spec_path` before ANY filesystem `join`/`copySpec`/`testDir` use.
 * The author is an autonomous LLM — nothing here is human-reviewed before this runs
 * — so a traversal/absolute-path trick must be caught HERE, the single choke point
 * every downstream use (`proveCriticals`'s joins, `runSuiteAndDecide`'s `testDir`)
 * routes through via the persisted manifest. Throws (never silently sanitizes).
 */
function assertSafeSpecPath(specPath: string): void {
    if (isAbsolute(specPath)) {
        throw new Error(`e2e manifest spec_path '${specPath}' must be relative, not absolute`)
    }
    if (specPath.split(/[\\/]+/).includes('..')) {
        throw new Error(`e2e manifest spec_path '${specPath}' must not contain '..' segments`)
    }
}

/**
 * Fail the phase AND discard the author worktree — every {@link recordAuthorResults}
 * failure exit routes through here so no early exit leaks the worktree (the
 * `worktree remove` wrapper tolerates an already-absent path: nonzero exit code,
 * not a throw).
 */
async function failWithCleanup(
    deps: E2eRunDeps,
    runId: string,
    worktree: string,
    reason: string
): Promise<Extract<E2eAction, {kind: 'failed'}>> {
    await removeWorktreeBestEffort(deps.git, worktree)
    await markFailed(deps, runId, reason)
    return {kind: 'failed', run_id: runId, reason}
}

/**
 * D5 (Decision 40): an `error` verdict means the author CRASHED or returned no
 * parseable STATUS — not a deliberate refusal — so it earns one automatic re-spawn
 * (the returned action is the fresh `spawn`). At the cap the phase fails like any
 * other author failure. Deliberate verdicts never route here.
 */
async function retryAuthorOrFail(
    deps: E2eRunDeps,
    runId: string,
    worktree: string,
    reason: string,
    emit: EmitFn
): Promise<E2eAction> {
    const run = await deps.state.read(runId)
    const attempts = (run.e2e_phase?.author_attempts ?? 0) + 1
    if (attempts >= MAX_AUTHOR_ATTEMPTS) {
        return failWithCleanup(deps, runId, worktree, `${reason} (after ${attempts} attempts)`)
    }
    await deps.state.update(runId, (s) => ({
        ...s,
        e2e_phase: {
            ...(s.e2e_phase ?? defaultE2ePhase()),
            author_attempts: attempts,
        },
    }))
    log.warn(`run '${runId}': e2e-author attempt ${attempts}/${MAX_AUTHOR_ATTEMPTS} crashed — re-spawning (${reason})`)
    return emit(deps, runId)
}

/** Record the e2e-author's result: on failure, fail the run (crash → one re-spawn,
 * D5); on success, prove + run the suite. Returns the FULL {@link E2eAction} —
 * the crash-retry path returns a fresh `spawn`, so runners loop while `spawn`. */
export async function recordAuthorResults(
    deps: E2eRunDeps,
    runId: string,
    results: E2eAuthorResults,
    emit: EmitFn
): Promise<E2eAction> {
    const worktree = e2eWorktreePath(deps.workDir, runId)

    const outcome = parseProducerStatus(results.status)
    if (outcome.status === 'error') {
        return retryAuthorOrFail(deps, runId, worktree, `e2e-author: ${outcome.reason}`, emit)
    }
    if (outcome.status !== 'done') {
        const reason = `e2e-author: ${'reason' in outcome ? outcome.reason : 'no parseable status'}`
        return failWithCleanup(deps, runId, worktree, reason)
    }

    if (results.manifest.length === 0 && results.no_ui_surface !== true) {
        const reason =
            'e2e-author: STATUS: DONE with an empty manifest but no_ui_surface was not ' +
            'explicitly true — ambiguous (genuine no-op vs. a malformed/incomplete ' +
            'response); refusing to silently pass'
        return failWithCleanup(deps, runId, worktree, reason)
    }

    for (const entry of results.manifest) {
        try {
            assertSafeSpecPath(entry.spec_path)
        } catch (err) {
            return failWithCleanup(deps, runId, worktree, `e2e-author: ${errText(err)}`)
        }
    }

    const cfg = deps.config.e2e
    const run = await deps.state.read(runId)
    const staging = run.staging_branch
    const critical = results.manifest.filter((e) => e.kind === 'critical')

    // The author picks task_ids off the spec it was handed, but nothing upstream
    // constrains it to that set — an unknown id would otherwise silently vanish at
    // reopen time (`taskIds.includes(id)` in runSuiteAndDecide just skips it).
    const unknownTaskIds = [...new Set(results.manifest.flatMap((e) => e.task_ids))].filter((id) => !(id in run.tasks))
    if (unknownTaskIds.length > 0) {
        const reason =
            `e2e-author: manifest references unknown task_id(s) not in this run: ` + unknownTaskIds.join(', ')
        return failWithCleanup(deps, runId, worktree, reason)
    }

    if (critical.length > 0) {
        // Trust boundary (Decision 39 W5): the author's ENTIRE branch is about to be
        // merged unreviewed. Every `critical` spec_path must itself live under the
        // committed testDir — a critical entry declared OUTSIDE it (e.g. repo root)
        // would otherwise merge an unreviewed file just by being self-declared as
        // "critical" (nothing else checks a critical entry's location).
        const testDirPrefix = `${E2E_TEST_DIR}/`
        const outsideTestDir = critical.filter((e) => !e.spec_path.startsWith(testDirPrefix))
        if (outsideTestDir.length > 0) {
            const reason =
                `e2e-author: critical spec_path(s) not under '${testDirPrefix}' — refusing to merge: ` +
                outsideTestDir.map((e) => e.spec_path).join(', ')
            return failWithCleanup(deps, runId, worktree, reason)
        }

        // Reject up front — before spending the fail-first proof — if the branch
        // touches anything outside testDir at all. Throwaway specs live OUTSIDE this
        // worktree (never committed, so never in this diff) — the only files a
        // legitimate author branch touches are critical specs under testDir/, so no
        // additional per-file allowlist is needed once THAT is enforced above.
        const branch = e2eBranchName(runId)
        const changed = await deps.git.diffNames(staging, branch, {cwd: worktree})
        const stray = changed.filter((f) => !f.startsWith(testDirPrefix))
        if (stray.length > 0) {
            const reason =
                `e2e-author: branch touches path(s) outside '${testDirPrefix}' — refusing to merge ` +
                `unreviewed changes: ${stray.join(', ')}`
            return failWithCleanup(deps, runId, worktree, reason)
        }

        // Converse check (D6, Decision 40): every changed file under testDir/ must be a
        // DECLARED critical manifest entry — an undeclared spec would merge with no
        // spec→task join, so its later failure could never reopen anything (a permanent
        // unmappable failure). Carve-out: shared machinery (support helpers, auth setup)
        // is legitimately not a spec and never joins to a task.
        const declared = new Set(critical.map((e) => e.spec_path))
        const undeclared = changed.filter(
            (f) =>
                !declared.has(f) && !f.startsWith(`${testDirPrefix}support/`) && f !== `${testDirPrefix}auth.setup.ts`
        )
        if (undeclared.length > 0) {
            const reason =
                `e2e-author: committed file(s) under '${testDirPrefix}' missing from the manifest — ` +
                `an undeclared spec can never be joined back to a task, refusing to merge: ` +
                undeclared.join(', ')
            return failWithCleanup(deps, runId, worktree, reason)
        }

        // Boot config can only vanish between spawn and record if config/assessment
        // state was mutated mid-run — fail loud rather than proving with a bogus boot.
        const boot = resolveBootConfig(cfg, run)
        if (boot === null) {
            return failWithCleanup(
                deps,
                runId,
                worktree,
                'e2e-author: boot config vanished between spawn and record (config or assessment state changed mid-run)'
            )
        }

        const proof = await proveCriticals(deps, runId, critical, worktree, boot)
        if (!proof.ok) {
            // Never merge an unproven spec — the worktree (and its unmerged commits) is
            // discarded rather than landed in the target repo.
            return failWithCleanup(deps, runId, worktree, proof.reason)
        }

        // Proven — merge the critical specs into staging (mirrors docs' ff-merge).
        await publishToStaging(deps.git, staging, e2eBranchName(runId))
    }
    await removeWorktreeBestEffort(deps.git, worktree)

    await deps.state.update(runId, (s) => ({
        ...s,
        e2e_phase: {
            ...(s.e2e_phase ?? defaultE2ePhase()),
            manifest: results.manifest,
        },
    }))

    return runSuiteAndDecide(deps, runId)
}
