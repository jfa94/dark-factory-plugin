/**
 * WS3 — staging-init / reconcile (ported from `pipeline-branch staging-init`).
 *
 * Ensures `origin/staging` exists (created from the configured BASE branch —
 * `develop`, NEVER `main`) and FF-reconciles staging with base between runs so
 * worktrees birth on a current staging tip (D12). A reconcile that cannot
 * fast-forward FAILS LOUD — there is no silent `main` fallback (the bash code's
 * latent footgun this rewrite removes).
 *
 * Reporter discipline: this performs git side-effects via GitClient but does NOT
 * touch StateManager.
 */
import {createLogger} from '../shared/index.js'
import {FALLBACK_STAGING_BRANCH} from './run-staging.js'
import {GitSchema} from '../config/schema.js'
import {ensureOnStaging} from './worktree.js'
import type {GitClient} from './git-client.js'

const log = createLogger('git')

const GIT_DEFAULTS = GitSchema.parse({})

/** Args to {@link ensureStaging}. */
export interface EnsureStagingArgs {
    gitClient: GitClient
    remote?: string
    /** Integration branch. Defaults to the configured staging branch. */
    stagingBranch?: string
    /** Base branch staging forks from / reconciles with. Defaults to `develop`. */
    baseBranch?: string
    /** Working directory for the HEAD-safe read ops (fetch/rev-parse/merge-base). */
    cwd?: string
    /**
     * Absolute path of the orchestrator worktree (`.claude/worktrees/orchestrator-<run_id>`)
     * where staging is materialised. D2 fix: staging is checked out HERE, never in the
     * user's primary checkout — a `checkout -B` on the main dir parked it on the run's
     * staging branch and later phase-merge checkouts collided (`already used by worktree`).
     */
    orchestratorWorktreePath: string
}

/** Result of {@link ensureStaging}. */
export interface EnsureStagingResult {
    /** True iff staging had to be created from base this call. */
    created: boolean
    /** The staging tip sha after the call. */
    stagingTip: string
}

/**
 * Ensure staging exists and is reconciled with base.
 *
 *  - If `origin/<staging>` is ABSENT: create it from `origin/<base>` and push.
 *  - If present: fetch both and FF staging to base when base is ahead; if base
 *    and staging have DIVERGED (no fast-forward possible) FAIL LOUD.
 *
 * NEVER falls back to `main`. The base is config-controlled and defaults to
 * `develop`.
 */
export async function ensureStaging(args: EnsureStagingArgs): Promise<EnsureStagingResult> {
    const remote = args.remote ?? 'origin'
    const staging = args.stagingBranch ?? FALLBACK_STAGING_BRANCH
    const base = args.baseBranch ?? GIT_DEFAULTS.baseBranch
    if (base === 'main') {
        // Belt-and-braces: even a misconfig must not point staging at main.
        throw new Error("staging: baseBranch must not be 'main' (Decision 16 — the factory never touches main)")
    }

    await args.gitClient.fetch(remote, base)

    const stagingHead = await args.gitClient.lsRemoteHeads(remote, staging)
    if (stagingHead === null) {
        // Create staging from base.
        const baseHead = await args.gitClient.lsRemoteHeads(remote, base)
        if (baseHead === null) {
            throw new Error(`staging: base branch '${remote}/${base}' does not exist — cannot create staging`)
        }
        log.info(`creating ${staging} from ${remote}/${base}`)
        await materializeStagingWorktree(args.gitClient, args.orchestratorWorktreePath, staging, remote, base)
        await args.gitClient.push(remote, staging, {setUpstream: true, cwd: args.orchestratorWorktreePath})
        return {created: true, stagingTip: baseHead}
    }

    // Staging exists. Reconcile: FF to base when base is strictly ahead. If base's
    // tip is NOT an ancestor-or-equal of staging (diverged), fail loud.
    await args.gitClient.fetch(remote, staging)
    const baseTip = await args.gitClient.revParse(`${remote}/${base}`, {cwd: args.cwd})
    const stagingTip = await args.gitClient.revParse(`${remote}/${staging}`, {cwd: args.cwd})

    if (baseTip === stagingTip) {
        return {created: false, stagingTip}
    }

    const mergeBase = await args.gitClient.mergeBase(`${remote}/${base}`, `${remote}/${staging}`, {
        cwd: args.cwd,
    })
    if (mergeBase === stagingTip) {
        // base is strictly ahead of staging → fast-forward staging to base.
        log.info(`fast-forwarding ${staging} to ${remote}/${base}`)
        await materializeStagingWorktree(args.gitClient, args.orchestratorWorktreePath, staging, remote, base)
        await args.gitClient.push(remote, staging, {cwd: args.orchestratorWorktreePath})
        return {created: false, stagingTip: baseTip}
    }
    if (mergeBase === baseTip) {
        // staging is ahead of base (normal mid-cycle state) — nothing to reconcile.
        return {created: false, stagingTip}
    }

    // Diverged: neither is an ancestor of the other. No silent resolution.
    throw new Error(
        `staging: ${remote}/${staging} and ${remote}/${base} have DIVERGED ` +
            `(merge-base=${mergeBase}, staging=${stagingTip}, base=${baseTip}) — refusing to reconcile (no silent main fallback)`
    )
}

/**
 * Materialise `staging` onto `origin/<base>` inside the orchestrator worktree —
 * NEVER the main dir (D2). Idempotent, mirroring {@link createTaskWorktree}: on a
 * resume the worktree already exists, so re-point its branch via `ensureOnStaging`
 * (`checkout -B` in the worktree) rather than a bare `worktree add`, which fatals on
 * the existing path/branch.
 */
async function materializeStagingWorktree(
    gitClient: GitClient,
    path: string,
    branch: string,
    remote: string,
    base: string
): Promise<void> {
    if (await gitClient.worktreeExists(path)) {
        await ensureOnStaging({gitClient, path, branch, remote, base})
    } else {
        await gitClient.worktreeAdd(['-b', branch, path, `${remote}/${base}`])
    }
}
