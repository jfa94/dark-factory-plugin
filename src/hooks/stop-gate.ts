/**
 * WS9/WS10 — Stop hook: the stop pass-through + resumability hint.
 *
 * The hook NO LONGER blocks a premature stop. A live run with pending work used to
 * emit `{decision:"block"}` to force the in-session runner to keep driving —
 * the "session-hostage" behaviour that trapped a session which could not progress.
 * That arm (and its `FACTORY_ALLOW_STOP` escape hatch) is removed: a session may
 * always stop, and a run left `running` with pending work stays cleanly resumable via
 * `/factory:resume` (the runner frontend; the bare `factory resume` CLI only
 * updates/emits engine state — it drives no runner loop and so can never reach
 * `finalizeRun`). Re-entry is idempotent even when the stop landed mid-spawn: the
 * orchestrator records a `spawn_in_flight` checkpoint at every spawn emit, so a resume that
 * re-enters the same (phase, rung) before results were recorded resets the task worktree to
 * the captured pre-spawn tip — discarding the abandoned producer's partial work — before
 * re-spawning (see `orchestrator.ts` spawn-agents case + `applyResume`).
 *
 * The hook also NO LONGER finalizes on stop. The old arm called `manager.finalize` —
 * a pure status flip — bypassing the real `finalizeRun` delivery pipeline (rollup PR,
 * PRD close/failure comment, report.md, the e2e-failed→failed override). Once flipped,
 * every recovery surface read the violated state as healthy: `nextTask` returns `done`
 * for a terminal run so resume never re-enters finalize, and rescue's rollup detector
 * requires a `run.rollup` that finalizeRun never wrote. Now an owned, session-mode run
 * whose tasks are ALL terminal is simply LEFT `running` (with a log hint): the next
 * `/factory:resume` re-derives all-terminal and routes through the real `finalizeRun`.
 * The hook performs NO state mutation at all.
 *
 * SESSION-SCOPED (Prompt J — so the hint names the RIGHT run, and only this
 * session's own): debug runs pass through silently (the debug driver owns
 * finalize between review⇄fix passes), as do runs owned by a DIFFERENT session.
 *
 * Two blocks remain, both ONE-SHOT (guarded by `stop_hook_active` so a re-entry
 * never blocks twice): an inaccessible data directory (M9 — surface the
 * inconsistency, never silently accept a corrupt-state stop; a foreign run's
 * unreadable state.json never surfaces here — listRuns skips unreadable runs
 * silently), and an owned all-terminal unfinalized run — the block's reason tells
 * the session to run `/factory:resume` (the runner loop that reaches the REAL
 * finalize), never flipping status here.
 *
 * Output contract (Stop hook): a block (corruption only) is `{decision:"block",reason}`
 * on STDOUT with exit 0 (the JSON is the block signal). Allow = no output, exit 0.
 */
import {EXIT, type ExitCode} from '../shared/exit-codes.js'
import {createLogger} from '../shared/logging.js'
import {StateManager, isTerminalTaskStatus, type RunState} from '../core/state/index.js'
import type {DataDirOptions} from '../config/load.js'
import {deny, emitBlockDecision, parseHookInput, readStdin, sessionIdOf} from './hook-io.js'

const log = createLogger('hook:stop-gate')

/**
 * The pure stop decision (separated from I/O so it is trivially unit-testable). The
 * hook NEVER mutates state. An owned run left `running` with every task terminal
 * blocks ONCE (`block-finalize`) so the session itself runs `/factory:resume` — the
 * runner loop that executes the REAL `finalizeRun`, never a state-only status flip;
 * the `stop_hook_active`
 * re-entry is `allow-unfinalized` (log hint only). The corruption block
 * (inaccessible data directory) is emitted directly by {@link runStopGate},
 * not modelled here.
 */
export type StopAction =
    | {kind: 'allow'}
    /** stop_hook_active pass: hint only — never a second block (loop guard). */
    | {kind: 'allow-unfinalized'; run_id: string}
    /** First stop on an owned all-terminal unfinalized run: block ONCE with the
     * `/factory:resume` instruction so the session runs the REAL finalize. */
    | {kind: 'block-finalize'; run_id: string}

const ALLOW: StopAction = {kind: 'allow'}

/**
 * Decide what to log when the session stops, given a run snapshot and the id of the
 * STOPPING session (from the Stop hook stdin; `undefined` when it could not be read).
 * Pure — no I/O, no state writes. Returns plain `allow` in EVERY case except an owned,
 * all-terminal run, which allows WITH the resumability hint.
 *
 * Precedence (each earlier rule short-circuits to plain `allow`):
 *   1. no active run / not `running`            → allow.
 *   2. `debug === true`                          → allow (the debug driver owns finalize
 *      between review⇄fix passes, not the plain Stop gate).
 *   3. owner KNOWN and stopping session ≠ owner  → allow (another session's run is
 *      none of this session's business).
 *   4. pending work (in-flight tasks, or setup unfinished) → allow (NO hostage: the run
 *      stays `running` and resumable via `/factory:resume`).
 *   5. otherwise (≥1 task, all terminal)         → block-finalize ONCE (tell the session
 *      to run `/factory:resume`); on a stop_hook_active re-entry → allow-unfinalized
 *      (hint only, never a second block — the loop guard).
 */
export function decideStop(run: RunState | null, stoppingSession?: string, stopHookActive = false): StopAction {
    if (run === null) {
        return ALLOW
    } // no active run — nothing to gate.
    if (run.status !== 'running') {
        return ALLOW
    } // terminal / paused / suspended: intentional.

    // (a) DEBUG-AWARENESS — a debug run loops through multiple review⇄fix passes
    // before finalizing (unlike a plain run, which finalizes as soon as all tasks go
    // terminal). The debug driver, not the Stop gate, owns finalize between passes.
    if (run.debug) {
        return ALLOW
    } // the debug driver owns finalize between passes

    // (b) SESSION-OWNERSHIP — when the owning session is KNOWN and a DIFFERENT session is
    // stopping, that run is unrelated to this session: pass through.
    // (`run create` now requires an owner, so un-owned runs don't arise in normal
    // operation. The guard is belt-and-suspenders for unusual paths.)
    if (run.owner_session !== undefined && stoppingSession !== undefined && stoppingSession !== run.owner_session) {
        return ALLOW
    }

    const tasks = Object.values(run.tasks)
    const nonTerminal = tasks.filter((t) => !isTerminalTaskStatus(t.status))
    // Pending = in-flight tasks OR setup not finished (spec/tasks not yet populated).
    const pending = tasks.length === 0 || nonTerminal.length > 0

    // Pending work NO LONGER blocks the stop (the session-hostage fix). The session may
    // end; the run stays `running` and is resumed idempotently by `/factory:resume`.
    if (pending) {
        return ALLOW
    }

    // ≥1 task, all terminal, run still `running` → NO status flip ever (only the real
    // finalizeRun may deliver). One-shot: the FIRST stop blocks with the `/factory:resume`
    // instruction; a stop_hook_active re-entry passes through with the log hint only.
    return stopHookActive
        ? {kind: 'allow-unfinalized', run_id: run.run_id}
        : {kind: 'block-finalize', run_id: run.run_id}
}

/** Options for {@link runStopGate} (injectable for tests). */
export interface StopGateDeps extends DataDirOptions {
    /** Override the StateManager (tests). */
    manager?: Pick<StateManager, 'findActiveByOwner'>
    /** stdout writer (tests capture the block JSON). */
    emit?: (s: string) => void
    /** Read the raw Stop-hook stdin (tests inject; prod reads process.stdin). */
    readRaw?: () => Promise<string>
}

/**
 * Run the Stop hook end-to-end. Reads the Stop event stdin to extract the STOPPING
 * session id (`session_id`) so the gate can session-scope its resumability hint.
 * Resolves only the run the stopping session OWNS via
 * {@link StateManager.findActiveByOwner} — never the global `runs/current` pointer.
 * Always returns {@link EXIT.OK} — the block JSON on stdout (not the exit code) is the
 * signal Claude Code acts on, and a Stop hook must not crash the session with a
 * non-zero exit. The ONLY block is the data-dir corruption case; everything else
 * passes through (an all-terminal unfinalized run gets a log hint, no mutation).
 */
export async function runStopGate(_argv: string[] = [], deps: StopGateDeps = {}): Promise<ExitCode> {
    const emit = deps.emit ?? ((s: string) => process.stdout.write(s))
    const manager = deps.manager ?? new StateManager(deps)

    // Resolve the stopping session id from the Stop event stdin (best-effort: a
    // malformed/empty/absent payload leaves it undefined → the gate stays unscoped).
    let stoppingSession: string | undefined
    let stopHookActive = false
    try {
        const raw = deps.readRaw ? await deps.readRaw() : await readStdin()
        const input = parseHookInput(raw)
        stoppingSession = sessionIdOf(input)
        // Loop guard: CC sets stop_hook_active when this Stop fires because a previous
        // Stop-hook block continued the session — never block twice in a row.
        stopHookActive = input?.stop_hook_active === true
    } catch (err) {
        // A corrupt stdin is non-fatal here — we just lose session-scoping (degraded:
        // unknown stopper → null → allow). Never block the stop on this.
        log.error(`Stop hook stdin unparseable (session-scoping skipped): ${(err as Error).message}`)
        stoppingSession = undefined
    }

    let run: RunState | null
    try {
        run = stoppingSession !== undefined ? await manager.findActiveByOwner(stoppingSession) : null
        if (run === null && stoppingSession !== undefined) {
            // No single owned run found: either no active run, or session owns ≥2 (ambiguous).
            // Either way, nothing to finalize — allow the stop.
            log.warn(`Stop: session '${stoppingSession}' has no single attributed active run; passing through.`)
        }
    } catch (err) {
        // A failure here means our own data directory is inaccessible (listRuns → readdir
        // failed with a non-ENOENT error). Foreign runs' unreadable state.json files are
        // silently skipped by listRuns — they never surface here.
        // eslint-disable-next-line no-control-regex -- intentional: strip control chars from an error message
        const rawMsg = (err as Error).message.replace(/[\x00-\x1f]/g, ' ').slice(0, 200)
        const reason =
            `could not enumerate run state: ${rawMsg}. ` + `Investigate the factory data directory before stopping.`
        log.error(reason)
        if (stopHookActive) {
            // Loop guard: a stop_hook_active re-entry never blocks again — the first
            // block already surfaced the corruption; let the session end.
            return EXIT.OK
        }
        emitBlockDecision(deny(reason), emit)
        return EXIT.OK
    }

    const action = decideStop(run, stoppingSession, stopHookActive)
    if (action.kind === 'block-finalize') {
        const reason =
            `run ${action.run_id}: all tasks are terminal but the run is not finalized. ` +
            `Run \`/factory:resume\` now to execute the real finalize (rollup PR, PRD close, report) — ` +
            `never flip run status by hand.`
        log.info(reason)
        emitBlockDecision(deny(reason), emit)
        return EXIT.OK
    }
    if (action.kind === 'allow-unfinalized') {
        // Deliberately NOT finalized here: a state-only status flip would bypass the real
        // finalizeRun delivery (rollup PR, PRD close, e2e-failed override) and strand the
        // run in a healthy-looking but undelivered terminal state.
        log.info(
            `run ${action.run_id}: all tasks terminal but the run is not finalized — ` +
                `left running; \`/factory:resume\` will run the real finalize`
        )
    }
    return EXIT.OK
}
