/**
 * WS1 — StateManager: the only sanctioned way to read/mutate run state.
 *
 * Contract (plan §"Mechanics"):
 *   - WRITES are atomic + durable (temp + fsync + rename + fsync-parent) via
 *     src/shared/atomicWriteFile, and serialized by a ROBUST lock
 *     (proper-lockfile) held for the whole read-modify-write cycle. This replaces
 *     the bash flock-10s-with-mkdir-fallback that could fail under contention.
 *   - READS are lock-free (a consistent snapshot is guaranteed by the atomic
 *     rename on the writer side — a reader sees either the old or the new file,
 *     never a torn write).
 *   - Lifecycle: create → read → update → finalize.
 *   - Gate verdicts are DERIVED, never stored (derive.ts); this class exposes no
 *     setter for a gate boolean.
 *
 * Lock design notes:
 *   - We lock a per-run lockfile under the run dir, using `realpath: false` so the
 *     lock can be acquired even while `state.json` is mid-rename and around
 *     `create` (the run dir is mkdir'd first). The lockfile is a dedicated path,
 *     not state.json itself, so the atomic rename never disturbs the lock.
 *   - `stale` + `retries` make the lock self-heal from a crashed holder and wait
 *     out a live holder instead of failing fast (the bash 10s hard-fail was the
 *     weak point WS1 is told to harden).
 *   - `onCompromised` THROWS (the proper-lockfile default) — a compromised lock is
 *     loud, never silently ignored.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {mkdir, readFile, readdir, readlink, rename, rm, symlink, unlink} from 'node:fs/promises'
import {isEnoent} from '../../shared/fs-errors.js'
import {existsSync} from 'node:fs'
import {basename, dirname, join} from 'node:path'
import {withFileLock, DEFAULT_FILE_LOCK_TUNING, type FileLockTuning} from '../../shared/file-lock.js'
import {atomicWriteFile} from '../../shared/atomic-write.js'
import {parseJson, stringifyJson, JsonParseError} from '../../shared/json.js'
import {ZodError} from 'zod'
import {nowIso} from '../../shared/time.js'
import {createLogger} from '../../shared/logging.js'
import {resolveDataDir, type DataDirOptions} from '../../config/load.js'
import {
    CURRENT_LINK,
    currentRepoLinkPath,
    currentRepoRoot,
    runDir,
    runsRoot,
    runStatePath,
    specDir,
    RUNS_DIR,
} from './paths.js'
import {parseRunState, type RunState, type SpecPointer, type TaskState, isTerminalRunStatus} from './schema.js'
import {UsageError, isUsageError} from '../../shared/usage-error.js'
import {at} from '../../shared/index.js'

const log = createLogger('state')

/**
 * Tunables for the robust lock. Now the shared {@link FileLockTuning}; kept as a
 * local alias so the re-export from `./index.ts` stays stable.
 */
export type LockTuning = FileLockTuning

const DEFAULT_LOCK_TUNING: LockTuning = DEFAULT_FILE_LOCK_TUNING

export interface StateManagerOptions extends DataDirOptions {
    /** Override lock tuning (tests use a tighter window). */
    lock?: Partial<LockTuning>
}

/** Arguments to {@link StateManager.create}. */
export interface CreateRunArgs {
    run_id: string
    spec: SpecPointer
    execution_mode?: RunState['execution_mode']
    ship_mode?: RunState['ship_mode']
    /** The owning Claude Code session id (Prompt J — session-scoped Stop gate). */
    owner_session?: RunState['owner_session']
    /** The per-run staging branch to PIN on the row (Decision 33). */
    staging_branch: RunState['staging_branch']
    /** Quota-gate bypass from `--ignore-quota`; persisted so both orchestrators skip the gate. */
    ignore_quota?: RunState['ignore_quota']
    /** e2e-phase opt-in from `--e2e` (Decision 39); persisted so `wantsE2e` reads it live. */
    e2e?: RunState['e2e']
    /** `/factory:debug` session marker (Decision 39, Task 4/6); mirrors `e2e`/`ignore_quota`. */
    debug?: RunState['debug']
    /**
     * Seeded task map (D57): passing it here makes creation ATOMIC — one write
     * births a complete run, so a crash mid-create can never leave a `running`
     * run with zero tasks. Validated by parseRunState (incl. F2 key===task_id).
     */
    tasks?: RunState['tasks']
    /**
     * Birth-time touches (the S11 launch touch), written in the same single write.
     * An omitted `at` is stamped with the birth timestamp, so `at === started_at`
     * holds exactly (callers cannot know `now` before create() mints it).
     */
    human_touches?: {kind: RunState['human_touches'][number]['kind']; at?: string}[]
}

/**
 * True iff `err` is a recognized "this state is unparseable/old-schema" failure —
 * the class D57's pointer-liveness tolerance ({@link StateManager.pointCurrentAt})
 * exists to sweep. Deliberately narrow: a raw fs error (EACCES, EIO, ENOENT-that-
 * somehow-reached-here) or any other unexpected exception is NOT stale-shaped and
 * must rethrow rather than be treated as an abandoned run.
 */
function isStaleStateError(err: unknown): boolean {
    return err instanceof JsonParseError || err instanceof ZodError || isUsageError(err)
}

/**
 * A run dir this engine cannot parse — a `rescue gc` sweep candidate (D57).
 * `staging_branch`/`repo` are best-effort raw extractions (old schemas may
 * predate the pinned branch, Decision 33) enabling GitHub-side teardown.
 */
export interface StaleRunDir {
    run_id: string
    /** `schema-v<N>` (incl. `schema-vundefined` for an unstamped file) or `corrupt-json`. */
    reason: string
    staging_branch?: string
    repo?: string
}

export class StateManager {
    readonly dataDir: string
    private readonly lockTuning: LockTuning

    constructor(opts: StateManagerOptions = {}) {
        this.dataDir = resolveDataDir(opts)
        this.lockTuning = {...DEFAULT_LOCK_TUNING, ...(opts.lock ?? {})}
    }

    // ---- paths -------------------------------------------------------------

    private statePath(runId: string): string {
        return runStatePath(this.dataDir, runId)
    }

    private lockfilePath(runId: string): string {
        // Dedicated lockfile under the run dir; NOT state.json (so the atomic
        // rename of state.json never collides with the lock).
        return join(runDir(this.dataDir, runId), 'state.lock')
    }

    /**
     * Reject any state file not stamped with the CURRENT schema version, with a clear
     * UsageError instead of a raw ZodError. ABSENT rejects too — every writer stamps
     * the version, so an unstamped file predates the current schema. Ephemeral runs
     * can't be migrated; the remedy is always a fresh run.
     */
    private static guardedParse(raw: unknown, context: string): RunState {
        const v = (raw as Record<string, unknown> | null)?.schema_version
        if (v !== 3) {
            throw new UsageError(
                `run state at '${context}' uses schema v${JSON.stringify(v)}; only v3 is supported — this state was created by an older factory version; start a fresh run`
            )
        }
        return parseRunState(raw)
    }

    private specLockfilePath(repo: string, specId: string): string {
        // Dedicated lockfile under the durable spec dir, NOT the spec request, so a
        // scan→create critical section serializes per (repo, spec_id) without
        // colliding with spec writes.
        return join(specDir(this.dataDir, repo, specId), 'create.lock')
    }

    // ---- lock --------------------------------------------------------------

    /**
     * Acquire `lockfilePath` (whose parent `dir` must already exist), run `fn`, and
     * always release. `realpath:false` lets us lock a path whose target may be
     * mid-rename or not yet exist (proper-lockfile creates `<path>.lock`).
     * `label` names the resource in the loud not-found + compromised errors.
     */
    private async runWithLock<T>(dir: string, lockfilePath: string, label: string, fn: () => Promise<T>): Promise<T> {
        // The caller owns `dir`'s lifecycle (run/spec dir mkdir'd before first lock),
        // so assert it exists rather than create it.
        return withFileLock({dir, lockfile: lockfilePath, label, dirPolicy: 'assert', tuning: this.lockTuning}, fn)
    }

    /**
     * Run `fn` while holding the per-run lock. The lockfile's parent (the run dir)
     * must already exist — `create` mkdirs it before first lock; mutators lock an
     * existing run.
     */
    private async withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
        return this.runWithLock(runDir(this.dataDir, runId), this.lockfilePath(runId), `run '${runId}'`, fn)
    }

    /**
     * Run `fn` while holding the per-spec lock, keyed by `(repo, specId)`. The
     * durable spec dir is the lock parent — it always exists once the spec is
     * resolved, so this is a stable serialization point for the resolve-or-reuse
     * scan→create critical section (two concurrent same-spec creates can't both
     * observe "no active run" and mint two orphan runs; the per-run clobber guard
     * only protects against a same run_id collision). Distinct lockfile from
     * {@link withLock}, so the nested `create` call inside the body never deadlocks.
     */
    async withSpecLock<T>(repo: string, specId: string, fn: () => Promise<T>): Promise<T> {
        return this.runWithLock(
            specDir(this.dataDir, repo, specId),
            this.specLockfilePath(repo, specId),
            `spec '${repo}/${specId}'`,
            fn
        )
    }

    // ---- create ------------------------------------------------------------

    /**
     * Create a brand-new run. Mkdirs the run store layout, writes the initial
     * state.json atomically under the lock, and (best-effort) points the per-repo
     * `current/<repo-key>` pointer at it. Refuses to clobber an existing run dir.
     */
    async create(args: CreateRunArgs): Promise<RunState> {
        const dir = runDir(this.dataDir, args.run_id)
        // Cheap fast-path guard — NOT authoritative on its own (racy). The binding
        // clobber check is re-run INSIDE the lock below so two concurrent create()
        // calls for the same run_id cannot both pass it (TOCTOU).
        if (existsSync(this.statePath(args.run_id))) {
            throw new Error(`state: run '${args.run_id}' already exists`)
        }
        // The lockfile's parent (the run dir) must exist before we can lock it.
        await mkdir(join(dir, 'holdouts'), {recursive: true})
        await mkdir(join(dir, 'reviews'), {recursive: true})

        const now = nowIso()
        const state = parseRunState({
            run_id: args.run_id,
            status: 'running',
            execution_mode: args.execution_mode ?? 'sequential',
            ship_mode: args.ship_mode ?? 'live',
            // Stamp the owning session only when known (best-effort) — an ownerless run
            // is INVISIBLE to the Stop gate (findActiveByOwner never matches it; there is
            // no unscoped fallback), so that session's loop can stop freely.
            ...(args.owner_session !== undefined ? {owner_session: args.owner_session} : {}),
            staging_branch: args.staging_branch,
            ...(args.ignore_quota !== undefined ? {ignore_quota: args.ignore_quota} : {}),
            ...(args.e2e !== undefined ? {e2e: args.e2e} : {}),
            ...(args.debug !== undefined ? {debug: args.debug} : {}),
            spec: args.spec,
            tasks: args.tasks ?? {},
            ...(args.human_touches !== undefined
                ? {human_touches: args.human_touches.map((t) => ({kind: t.kind, at: t.at ?? now}))}
                : {}),
            started_at: now,
            updated_at: now,
            ended_at: null,
        })

        await this.withLock(args.run_id, async () => {
            // AUTHORITATIVE clobber guard: re-check inside the critical section so the
            // loser of a same-id create() race throws here instead of overwriting the
            // winner's state.json (last-writer-wins). Exactly one create() wins.
            if (existsSync(this.statePath(args.run_id))) {
                throw new Error(`state: run '${args.run_id}' already exists`)
            }
            await atomicWriteFile(this.statePath(args.run_id), stringifyJson(state))
        })

        // Touch the append-only logs so downstream appenders need no existence check.
        await atomicWriteFile(join(dir, 'audit.jsonl'), '')
        await atomicWriteFile(join(dir, 'metrics.jsonl'), '')

        await this.pointCurrentAt(state)
        return state
    }

    // ---- read (lock-free) --------------------------------------------------

    /**
     * Read + validate a run's state. LOCK-FREE: the atomic rename on the writer
     * side guarantees a reader sees a whole file. LOUD on a missing run or a
     * schema/JSON violation (never a silent partial).
     */
    async read(runId: string): Promise<RunState> {
        const path = this.statePath(runId)
        const raw = await readFile(path, 'utf8')
        return StateManager.guardedParse(parseJson(raw, path), path)
    }

    /**
     * True iff a RunState exists on disk for this run id. Synchronous,
     * no read/parse — mirrors the existence check `create()` already uses
     * internally before writing. Lets a caller distinguish "no run was ever
     * created" from a genuine read failure without parsing.
     */
    exists(runId: string): boolean {
        return existsSync(this.statePath(runId))
    }

    /**
     * Read the run the PER-REPO current pointer (`current/<repo-key>`, L2.7) names —
     * the authoritative pointer the human CLI resolves per checkout. A per-repo MISS
     * (no pointer for this repo yet) is simply null — `pointCurrentAt` writes both
     * pointers on every create, so a repo with a run always has its per-repo link.
     * Loud on a corrupt state.json behind the pointer (same contract as readCurrent).
     */
    async readCurrentForRepo(repo: string): Promise<RunState | null> {
        return this.readThroughLink(currentRepoLinkPath(this.dataDir, repo))
    }

    /**
     * Read + validate a run's state THROUGH a `current`-style directory symlink (the
     * OS follows the link during the path walk, so no readlink is needed). Returns
     * null ONLY on genuine ABSENCE (missing/dangling link → ENOENT); a corrupt/invalid
     * state.json propagates LOUDLY (swallowing it would make a corrupt active run
     * indistinguishable from "no current run"). Shared by {@link readCurrent} and
     * {@link readCurrentForRepo}.
     */
    private async readThroughLink(link: string): Promise<RunState | null> {
        if (!existsSync(link)) {
            return null
        }
        const statePath = join(link, 'state.json')
        let raw: string
        try {
            raw = await readFile(statePath, 'utf8')
        } catch (err) {
            if (isEnoent(err)) {
                return null
            }
            throw err
        }
        return StateManager.guardedParse(parseJson(raw, statePath), statePath)
    }

    // ---- enumerate (lock-free) ---------------------------------------------

    /**
     * Enumerate every run in the store, newest-first (run-id descending — the id is
     * lexicographically chronological). Each run dir's state.json is read + validated
     * through {@link read}. Non-directory entries (the `runs/current` symlink and any
     * `*.tmp.<pid>` link create() leaves behind) are excluded. A run dir without a
     * state.json (mid-creation, or cleaned) is skipped silently; one whose state.json
     * is unreadable/corrupt/invalid is skipped with a LOUD warning — a single corrupt
     * historical run must not brick `run create`'s resolve-or-reuse scan. (Targeted
     * {@link read} keeps its loud-on-corruption contract; only this bulk scan tolerates
     * a bad entry, and never silently.)
     */
    /**
     * Readdir the runs root, tolerating a missing root (no runs yet → []) and
     * filtering to directories (excludes the `current` + temp symlinks). The shared
     * prologue of {@link listRuns} and {@link listStaleRunDirs}.
     */
    private async runDirEntries(): Promise<string[]> {
        try {
            const entries = await readdir(runsRoot(this.dataDir), {withFileTypes: true})
            return entries.filter((e) => e.isDirectory()).map((e) => e.name)
        } catch (err) {
            if (isEnoent(err)) {
                return []
            }
            throw err
        }
    }

    async listRuns(): Promise<RunState[]> {
        const runs: RunState[] = []
        for (const name of await this.runDirEntries()) {
            try {
                runs.push(await this.read(name))
            } catch (err) {
                if (isEnoent(err)) {
                    continue
                } // no state.json yet
                log.warn(`state: skipping unreadable run '${name}': ${(err as Error).message}`)
            }
        }
        return runs.sort((a, b) => b.run_id.localeCompare(a.run_id))
    }

    /**
     * Enumerate the run dirs THIS engine cannot parse (D57) — the population
     * {@link listRuns} warn-skips: an old-schema stamp (`schema_version !== 3`) or
     * corrupt JSON. These are `rescue gc` sweep candidates; a stale pointer at one
     * of them is what crashed `run create` in the 2026-07-07 incident. Best-effort
     * raw field extraction (`staging_branch`, `spec.repo`) enables the GitHub-side
     * teardown; a structurally-invalid v3 state is NOT stale (current-engine
     * wreckage — surfaces loudly through targeted reads, never swept here).
     */
    async listStaleRunDirs(): Promise<StaleRunDir[]> {
        const stale: StaleRunDir[] = []
        for (const name of await this.runDirEntries()) {
            let raw: string
            try {
                raw = await readFile(runStatePath(this.dataDir, name), 'utf8')
            } catch (err) {
                if (isEnoent(err)) {
                    continue
                } // no state.json yet (mid-creation) — not stale
                throw err
            }
            let parsed: unknown
            try {
                parsed = JSON.parse(raw)
            } catch {
                stale.push({run_id: name, reason: 'corrupt-json'})
                continue
            }
            const obj = parsed as Record<string, unknown> | null
            const v = obj?.schema_version
            if (v === 3) {
                continue
            } // parseable version stamp — not this sweep's business
            const branch = obj?.staging_branch
            const repo = (obj?.spec as Record<string, unknown> | undefined)?.repo
            stale.push({
                run_id: name,
                reason: `schema-v${JSON.stringify(v)}`,
                ...(typeof branch === 'string' && branch.length > 0 ? {staging_branch: branch} : {}),
                ...(typeof repo === 'string' && repo.length > 0 ? {repo} : {}),
            })
        }
        return stale.sort((a, b) => b.run_id.localeCompare(a.run_id))
    }

    /**
     * Delete a run dir outright and drop any `current` pointer naming it (D57) —
     * `rescue gc --apply`'s stale-run sweep. NOT a lifecycle verb: live runs are
     * cancelled/superseded through state, never deleted; this exists solely for
     * wreckage {@link read} cannot even parse, so it takes no lock (there is no
     * valid state to serialize against).
     */
    async deleteRun(runId: string): Promise<void> {
        await rm(runDir(this.dataDir, runId), {recursive: true, force: true})
        // Sweep the per-repo pointer family (`current/<repo-key>`): dropping a dangling
        // pointer here is what stops the stale target from ever tripping create()'s
        // pointer read again. The retired global `runs/current` link (Decision 61) is no longer
        // written or read, so it needs no sweep — pointCurrentAt best-effort-rms any
        // legacy leftover on the next create.
        const links: string[] = []
        try {
            const repoLinks = await readdir(currentRepoRoot(this.dataDir), {withFileTypes: true})
            links.push(...repoLinks.map((e) => join(currentRepoRoot(this.dataDir), e.name)))
        } catch (err) {
            if (!isEnoent(err)) {
                throw err
            }
        }
        for (const link of links) {
            let target: string
            try {
                target = await readlink(link)
            } catch {
                continue // not a symlink / already gone
            }
            if (basename(target) === runId) {
                await rm(link, {force: true}).catch(() => {
                    /* best-effort — a dangling pointer is tolerated by every reader */
                })
            }
        }
    }

    /**
     * Find the single NON-terminal run for `(repo, issueNumber)`, or null. Powers the
     * resolve-or-reuse path of `run create`: a repeated create returns the live run
     * instead of spawning an orphan. Matches by the STABLE issue number, not the exact
     * `spec_id` — a spec id is `<issue>-<slug>` where the slug is agent-named and can
     * drift across regenerations, and one issue means at most one active run: the
     * supersede teardown, the weekly-quota wall, and the no-silent-reuse prompt must
     * all see a drifted-slug run.
     *
     * @throws when ≥2 active runs match — a state defect (duplicates have occurred in
     *         the wild); silently picking one could tear down or reuse the wrong run.
     *         Fail loud and let `/factory:resume` repair.
     */
    async findActiveByIssue(repo: string, issueNumber: number): Promise<RunState | null> {
        const runs = await this.listRuns() // newest-first
        const matches = runs.filter(
            (r) => r.spec.repo === repo && r.spec.issue_number === issueNumber && !isTerminalRunStatus(r.status)
        )
        if (matches.length > 1) {
            throw new Error(
                `findActiveByIssue: ${matches.length} active runs for issue #${issueNumber} in ${repo} ` +
                    `(${matches.map((r) => r.run_id).join(', ')}) — one issue must have at most one ` +
                    `active run; repair with /factory:resume`
            )
        }
        return matches.length === 1 ? at(matches, 0) : null
    }

    /**
     * TRUE when another NON-terminal run (any issue) exists for `repo` besides
     * `excludeRunId`. Active-run uniqueness is per (repo, issue) — two PRDs can
     * have simultaneously active runs on one repo — so the D74 de-escalation
     * sites (finalize / supersede / cancel `--cleanup`) and scaffold's
     * `--provision` must not drop develop to baseline while a sibling run still
     * relies on the strict profile.
     */
    async hasOtherActiveForRepo(repo: string, excludeRunId?: string): Promise<boolean> {
        const runs = await this.listRuns()
        return runs.some((r) => r.spec.repo === repo && r.run_id !== excludeRunId && !isTerminalRunStatus(r.status))
    }

    /**
     * ALL non-terminal runs owned by `session` (its `owner_session`), newest-first
     * (empty session → `[]`). The raw list behind {@link findActiveByOwner}: callers
     * that must DISTINGUISH "none owned" from "ambiguous (≥2 owned)" — e.g. `run cancel`,
     * which fails LOUD on ambiguity rather than guessing which run to abandon — branch
     * on `.length`.
     */
    async findAllActiveByOwner(session: string): Promise<RunState[]> {
        if (session.length === 0) {
            return []
        }
        const runs = await this.listRuns() // newest-first
        return runs.filter((r) => r.owner_session === session && !isTerminalRunStatus(r.status))
    }

    /**
     * Find the SINGLE non-terminal run owned by `session` (its `owner_session`), or
     * null. Powers the session-scoped Bash guards (run-isolation L1.3): a guard fires
     * only for the run the stopping/acting session actually owns, never a concurrent
     * run in another repo. An empty session, no match, or ≥2 matches (ambiguous — one
     * session minting runs in two repos) all return null, so the caller fails SAFE
     * (passes through) rather than gating the wrong run. Callers that must tell "none"
     * from "ambiguous" apart use {@link findAllActiveByOwner} and branch on its length.
     */
    async findActiveByOwner(session: string): Promise<RunState | null> {
        const owned = await this.findAllActiveByOwner(session)
        return owned.length === 1 ? at(owned, 0) : null
    }

    // ---- update (locked read-modify-write) ---------------------------------

    /**
     * Atomically mutate a run under the lock. `mutator` receives the current state
     * and returns the next state; the result is re-validated through the schema
     * (so a mutator cannot persist an out-of-enum value) and `updated_at` is
     * stamped. This is the ONLY write path for an existing run.
     */
    async update(runId: string, mutator: (state: RunState) => RunState | Promise<RunState>): Promise<RunState> {
        return this.withLock(runId, async () => {
            const current = await this.read(runId)
            const next = await mutator(current)
            // Identity is the storage key: run_id keys the directory and (repo, spec_id)
            // is the durable spec address. A mutator that changes either would persist a
            // state.json whose identity disagrees with its path, silently breaking
            // addressability. Pin both — a mutator must never rewrite identity.
            if (next.run_id !== runId) {
                throw new Error(
                    `state: update mutator changed run_id ('${runId}' → '${next.run_id}') — identity is immutable`
                )
            }
            if (
                next.spec.repo !== current.spec.repo ||
                next.spec.spec_id !== current.spec.spec_id ||
                next.spec.issue_number !== current.spec.issue_number
            ) {
                throw new Error(
                    `state: update mutator changed the spec pointer for run '${runId}' — identity is immutable`
                )
            }
            const validated = parseRunState({
                ...next,
                updated_at: nowIso(),
            })
            await atomicWriteFile(this.statePath(runId), stringifyJson(validated))
            return validated
        })
    }

    /**
     * Convenience: mutate a single task in place. Throws if the task is absent
     * (a typo'd task id is a loud error, not a silent create).
     */
    async updateTask(runId: string, taskId: string, mutator: (task: TaskState) => TaskState): Promise<RunState> {
        return this.update(runId, (state) => {
            const task = state.tasks[taskId]
            if (!task) {
                throw new Error(`state: run '${runId}' has no task '${taskId}'`)
            }
            return {...state, tasks: {...state.tasks, [taskId]: mutator(task)}}
        })
    }

    // ---- finalize ----------------------------------------------------------

    /**
     * Finalize a run to a TERMINAL status (Decision 22/24 — finalize is terminal,
     * never spins). Refuses a non-terminal status. Stamps `ended_at`. Idempotent
     * for the same terminal status.
     *
     * Reason contract (discriminated by overload): `failed`/`superseded` REQUIRE a
     * non-empty reason (persisted as `terminal_reason`); `completed` forbids one.
     * Same-status retries: a legacy run missing its reason is backfilled once; a
     * DIFFERENT reason than the stored one throws loudly (never silently replaced).
     */
    async finalize(runId: string, status: 'completed'): Promise<RunState>
    async finalize(runId: string, status: 'failed' | 'superseded', reason: string): Promise<RunState>
    async finalize(runId: string, status: RunState['status'], reason?: string): Promise<RunState> {
        if (!isTerminalRunStatus(status)) {
            throw new Error(`state: finalize requires a terminal status (completed|failed|superseded); got '${status}'`)
        }
        if (status === 'completed' && reason !== undefined) {
            throw new Error(`state: finalize 'completed' takes no reason; got '${reason}'`)
        }
        if (status !== 'completed' && (reason === undefined || reason.trim().length === 0)) {
            throw new Error(`state: finalize '${status}' requires a non-empty reason`)
        }
        return this.update(runId, (state) => {
            if (isTerminalRunStatus(state.status) && state.status !== status) {
                throw new Error(
                    `state: run '${runId}' already terminal as '${state.status}'; cannot re-finalize as '${status}'`
                )
            }
            // Same-status retry with a conflicting reason: refuse — a reason is a
            // stored terminal EVENT; rewriting it would falsify history. A missing
            // stored reason (legacy state) may be filled exactly once.
            if (
                isTerminalRunStatus(state.status) &&
                state.terminal_reason !== undefined &&
                reason !== undefined &&
                state.terminal_reason !== reason
            ) {
                throw new Error(
                    `state: run '${runId}' already finalized '${status}' with reason '${state.terminal_reason}'; ` +
                        `refusing to replace it with '${reason}'`
                )
            }
            // Clear any quota checkpoint: it is valid ONLY while paused|suspended
            // (refineRunCrossFields), so a paused/suspended run that finalizes to a
            // terminal status must drop it or re-validation throws. Finalize is
            // terminal — there is no resume horizon to preserve.
            return {
                ...state,
                status,
                quota: undefined,
                terminal_reason: state.terminal_reason ?? reason,
                ended_at: state.ended_at ?? nowIso(),
            }
        })
    }

    // ---- current symlink ---------------------------------------------------

    /**
     * Repoint the PER-REPO current pointer `current/<repo-key>` → `../runs/<run-id>`
     * at a freshly-created run (L2.6/L2.7) — the single live pointer, authoritative
     * for the human CLI per checkout. The legacy GLOBAL `runs/current` link is
     * RETIRED (Decision 61): nothing reads it; this method only best-effort rms a
     * leftover from an older engine.
     *
     * CLOBBER GUARD (L2.6) — runs BEFORE any write and throws LOUD (NOT swallowed by the
     * best-effort symlink catch below): if THIS repo's current pointer already names a
     * still-live run owned by a DIFFERENT known session, refuse to hide it. Same-repo
     * concurrent runs by distinct sessions are thus serialized, while cross-repo creates
     * (a different repo's pointer) never trip it. The just-created run's `state.json`
     * already exists, so it stays addressable via `--run <id>` after the throw.
     * Degrades safe (no refusal) when either owner is unknown — today's last-wins behavior.
     *
     * POINTER-LIVENESS TOLERANCE (D57): an UNPARSEABLE pointer target (old-schema,
     * corrupt JSON) classifies as STALE — warn loudly and repoint. A run this engine
     * cannot parse cannot be owned by a live session of this engine, so it can never
     * prove the "still-live, different owner" condition the guard exists for. Mirrors
     * {@link listRuns}' tolerate-loudly precedent; readCurrentForRepo keeps its loud
     * contract for every other caller.
     *
     * The tolerance is SCOPED to recognized parse/schema failures ({@link isStaleStateError}
     * — JSON parse errors, the schema-version UsageError, or a Zod validation error);
     * any other error (EACCES, EIO, or an unexpected bug) rethrows loudly instead of
     * being treated as stale, so a transient read failure on a genuinely live,
     * different-owner run never silently repoints over it.
     */
    private async pointCurrentAt(state: RunState): Promise<void> {
        const repo = state.spec.repo
        let existing: RunState | null
        try {
            existing = await this.readCurrentForRepo(repo)
        } catch (err) {
            if (!isStaleStateError(err)) {
                throw err
            }
            log.warn(
                `state: current pointer for repo '${repo}' names an unparseable run — treating as stale and repointing: ${(err as Error).message}`
            )
            existing = null
        }
        if (
            existing !== null &&
            existing.run_id !== state.run_id &&
            !isTerminalRunStatus(existing.status) &&
            existing.owner_session !== undefined &&
            state.owner_session !== undefined &&
            existing.owner_session !== state.owner_session
        ) {
            throw new Error(
                `state: refusing to repoint current for repo '${repo}' — run '${existing.run_id}' is ` +
                    `still live (owned by a different session '${existing.owner_session}'). Run ` +
                    `'${state.run_id}' was created and is addressable via \`--run ${state.run_id}\`; ` +
                    `finalize or rescue '${existing.run_id}' before starting a concurrent run in this repo.`
            )
        }
        // Per-repo pointer lives one level under <dataDir>/current, so it targets ../runs/<id>.
        await this.repointSymlink(currentRepoLinkPath(this.dataDir, repo), join('..', RUNS_DIR, state.run_id))
        // The global `runs/current` link is RETIRED (Decision 61) — no consumer reads it. Best-effort
        // rm any legacy leftover from an older engine so it can't dangle indefinitely.
        await rm(join(runsRoot(this.dataDir), CURRENT_LINK), {force: true}).catch(() => {
            /* best-effort legacy sweep — nothing reads the global pointer anymore */
        })
    }

    /**
     * Atomically-ish repoint a `current`-style symlink at `target` (write a temp link
     * then rename). Best-effort: a failure is logged, not fatal — `current` is a
     * convenience pointer, not load-bearing state.
     */
    private async repointSymlink(link: string, target: string): Promise<void> {
        const tmp = `${link}.tmp.${process.pid}`
        try {
            await mkdir(dirname(link), {recursive: true})
            await unlink(tmp).catch(() => {
                /* best-effort cleanup */
            })
            await symlink(target, tmp)
            await rm(link, {force: true, recursive: false}).catch(() => {
                /* best-effort cleanup */
            })
            await rename(tmp, link)
        } catch (err) {
            log.warn(`state: could not update current pointer '${link}' → '${target}': ${(err as Error).message}`)
            await unlink(tmp).catch(() => {
                /* best-effort cleanup */
            })
        }
    }
}

/** Re-export the store subdir name for callers that enumerate runs. */
export {RUNS_DIR}
