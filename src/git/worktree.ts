/**
 * WS3 — worktree lifecycle preserving `baseRef:"head"` semantics + the D12
 * idempotent `checkout -B <branch> origin/staging` fallback.
 *
 * Decision 12 says: port BOTH the base-is-staging-tip assertion AND the
 * checkout-B fallback — do NOT rely on the `.claude/settings.json`
 * `worktree.baseRef:"head"` knob alone. The settings knob is read at session
 * start (and only by Claude Code's worktree machinery), so a Node orchestrator MUST
 * independently (a) verify the worktree was born on the staging tip and fail loud
 * on drift (invariant #4), and (b) carry the `checkout -B` safety net for when
 * the knob is absent.
 */
import {existsSync} from 'node:fs'
import {FALLBACK_STAGING_BRANCH} from './run-staging.js'

import {createLogger} from '../shared/index.js'
import {runScopedBranch} from './branch.js'
import type {GitClient, GitOpts, MergeAttempt} from './git-client.js'

const log = createLogger('git')

/** Args to {@link createTaskWorktree}. */
export interface CreateTaskWorktreeArgs {
    gitClient: GitClient
    runId: string
    taskId: string
    /** Absolute path where the worktree is created. */
    path: string
    /** Remote to fetch the base from. */
    remote?: string
    /** Base branch to fork from. Defaults to the configured staging branch. */
    base?: string
}

/** Result of {@link createTaskWorktree}. */
export interface TaskWorktree {
    path: string
    branch: string
    /** The fully-qualified start point the worktree forked from (e.g. origin/staging). */
    startPoint: string
}

/**
 * Create a task worktree forked from `origin/<base>` (default staging), on a
 * run-scoped branch (Δ M). Fetches first so the fork point is the CURRENT staging
 * tip, then `git worktree add -b <branch> <path> origin/<base>`. Asserts the base
 * is the staging tip (invariant #4) before returning.
 *
 * REPLAY-SAFE: the preflight phase persists its cursor BEFORE running, so a crash
 * after the worktree is created but before the phase advances (e.g. dependency
 * provisioning or the base-tip assert throwing) leaves the worktree on disk. A
 * resume re-enters preflight — so if the worktree already exists we REUSE it by
 * re-pointing its branch onto the current staging tip (the D12 idempotent
 * `checkout -B`) rather than a bare `worktree add`, which fatals on the existing
 * path/branch and would wedge the run. The base-tip assertion still guards BOTH
 * paths.
 */
export async function createTaskWorktree(args: CreateTaskWorktreeArgs): Promise<TaskWorktree> {
    const remote = args.remote ?? 'origin'
    const base = args.base ?? FALLBACK_STAGING_BRANCH
    const branch = runScopedBranch(args.runId, args.taskId)
    const startPoint = `${remote}/${base}`

    await args.gitClient.fetch(remote, base)

    if (await args.gitClient.worktreeExists(args.path)) {
        // Resume after a mid-preflight failure: reuse the already-registered worktree,
        // re-pointing its branch onto the freshly-fetched staging tip.
        await ensureOnStaging({gitClient: args.gitClient, path: args.path, branch, remote, base})
    } else {
        await args.gitClient.worktreeAdd(['-b', branch, args.path, startPoint])
    }

    await assertBaseIsStagingTip({
        gitClient: args.gitClient,
        path: args.path,
        remote,
        base,
    })

    return {path: args.path, branch, startPoint}
}

/** Args to {@link assertBaseIsStagingTip}. */
export interface AssertBaseArgs {
    gitClient: GitClient
    path: string
    remote?: string
    base?: string
}

/**
 * D12 invariant #4: a subagent worktree's base MUST be the current staging tip.
 * We assert the merge-base of the worktree HEAD and `origin/<base>` equals the
 * `origin/<base>` tip — i.e. the worktree branched FROM the tip with no drift.
 * FAILS LOUD on divergence (a stale base is the 2026-05-28 bootstrap defect D12
 * was written to prevent).
 */
export async function assertBaseIsStagingTip(args: AssertBaseArgs): Promise<void> {
    const remote = args.remote ?? 'origin'
    const base = args.base ?? FALLBACK_STAGING_BRANCH
    const opts: GitOpts = {cwd: args.path}
    const stagingTip = await args.gitClient.revParse(`${remote}/${base}`, opts)
    const mergeBase = await args.gitClient.mergeBase('HEAD', `${remote}/${base}`, opts)
    if (mergeBase !== stagingTip) {
        throw new Error(
            `worktree base drift: merge-base(HEAD, ${remote}/${base})=${mergeBase} ` +
                `!= ${remote}/${base} tip=${stagingTip} — worktree did not birth on the staging tip (D12 invariant #4)`
        )
    }
}

/** Args to {@link ensureOnStaging}. */
export interface EnsureOnStagingArgs {
    gitClient: GitClient
    path: string
    branch: string
    remote?: string
    base?: string
}

/**
 * D12 idempotent fallback: `git checkout -B <branch> origin/<base>`. A verified
 * no-op when the worktree already births on staging (checkout -B onto the same
 * tip leaves HEAD where it is), and the safety net when it does NOT — ported
 * INDEPENDENTLY of the settings.json knob (both ported, not relying on the
 * setting alone).
 *
 * D8: an interrupted drive (crash / abandoned producer) can leave uncommitted
 * TRACKED changes in the reused worktree; a bare `checkout -B` refuses to
 * clobber them and hard-fails every re-drive. Clean to the target tip FIRST via
 * the engine's own trusted git client (a manual reset/clean is deny-blocked for
 * the user), then re-point. Lands HEAD on origin/<base>, so the caller's
 * base-is-staging-tip assertion still passes.
 */
export async function ensureOnStaging(args: EnsureOnStagingArgs): Promise<void> {
    const remote = args.remote ?? 'origin'
    const base = args.base ?? FALLBACK_STAGING_BRANCH
    const opts: GitOpts = {cwd: args.path}
    log.debug(`ensureOnStaging: reset --hard + checkout -B ${args.branch} ${remote}/${base}`)
    await args.gitClient.resetHardClean(`${remote}/${base}`, opts)
    await args.gitClient.checkoutB(args.branch, `${remote}/${base}`, opts)
}

/** Args to {@link resyncTaskBranchOntoStaging}. */
export interface ResyncTaskBranchArgs {
    git: GitClient
    /** The task worktree the branch is checked out in. */
    cwd: string
    /** The run-scoped task branch to forward-merge staging into. */
    branch: string
    /** Bare staging branch name (the `origin/` ref is built internally). */
    stagingBranch: string
    remote?: string
    /**
     * Commit message for a non-FF merge (e.g. tagged `[task-id]` so the TDD gate
     * attributes the commit, Issue #2). Omitted → git's default `--no-edit` message.
     */
    message?: string
}

/**
 * Bug #1 fix: forward-merge the CURRENT staging tip into a task branch a serial
 * writer refused as BEHIND, then re-push so the REMOTE PR head advances (the
 * serializer reads mergeStateStatus from the remote head — a local-only merge would
 * leave the PR BEHIND and the next ship would refuse it again, burning the re-sync
 * budget for nothing). `git merge`, never rebase/force (honors the no-force rule); a
 * real conflict comes back as `{merged:false}` with the tree already aborted-to-clean,
 * for the caller to classify terminal. Push only on a clean merge (fast-forward of the
 * merge commit — no force).
 */
export async function resyncTaskBranchOntoStaging(args: ResyncTaskBranchArgs): Promise<MergeAttempt> {
    const remote = args.remote ?? 'origin'
    const opts: GitOpts = {cwd: args.cwd}
    await args.git.fetch(remote, args.stagingBranch, opts)
    const attempt = await args.git.tryMergeNoForce(args.branch, `${remote}/${args.stagingBranch}`, {
        ...opts,
        ...(args.message !== undefined ? {message: args.message} : {}),
    })
    if (attempt.merged) {
        await args.git.push(remote, args.branch, opts)
    }
    return attempt
}

/**
 * Remove a worktree: graceful first, then `--force` if the graceful remove
 * reports a non-zero exit (e.g. dirty worktree). The force here is a worktree
 * teardown, NOT a force-push — no history is rewritten.
 */
export async function removeWorktree(gitClient: GitClient, path: string): Promise<void> {
    const code = await gitClient.worktreeRemove([path])
    if (code !== 0) {
        log.warn(`worktree remove ${path} exited ${code ?? 'null'}; retrying with --force`)
        const forceCode = await gitClient.worktreeRemove(['--force', path])
        if (forceCode !== 0) {
            throw new Error(`worktree remove --force ${path} failed (code=${forceCode ?? 'null'})`)
        }
    }
}

/**
 * BEST-EFFORT worktree teardown for cleanup paths that must never mask the
 * original failure: never throws, but never SILENTLY leaks either. A non-zero
 * exit with the path still on disk is a real leak → warn; already-absent is
 * benign (a prior cleanup won the race) → silent.
 */
export async function removeWorktreeBestEffort(gitClient: GitClient, path: string): Promise<void> {
    const code = await gitClient.worktreeRemove(['--force', path])
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- internal derived worktree path, never external input
    if (code !== 0 && existsSync(path)) {
        log.warn(`worktree remove --force ${path} exited ${code ?? 'null'} — worktree may be leaked`)
    }
}
