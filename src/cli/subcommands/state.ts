/**
 * `factory state` — read-only inspection of run state (never writes).
 *
 *   factory state                 → the current run's state.json (JSON)
 *   factory state <run-id>        → that run's state.json (JSON)
 *   factory state [--summary]     → a compact human summary instead of raw JSON
 *
 * Absence of a current run is NOT an error: it prints `{"current": null}` (JSON)
 * or "no current run" (summary) and returns OK. Corruption IS loud (StateManager
 * throws). All run-state MUTATION lives in the orchestrator (`factory next-action`/`next`);
 * this one only reads.
 */
import {EXIT, type ExitCode} from '../../shared/exit-codes.js'
import {parseArgs} from '../args.js'
import {emitJson, emitLine, emitHelp} from '../io.js'
import {StateManager} from '../../core/state/index.js'
import {readCurrentForCwd, type CurrentRunOverrides} from '../current.js'
import type {RunState} from '../../types/index.js'
import {withUsageGuard, type Subcommand} from '../registry-types.js'

const HELP = `factory state — read run state (read-only)

Usage:
  factory state                 Print the current run's state as JSON
  factory state <run-id>        Print a specific run's state as JSON
  factory state --summary       Print a compact human summary instead

Exit OK with {"current": null} when there is no current run.`

/** One compact human line per task: "<id> <status> [phase] [rung] [pr]". */
function summarize(run: RunState): string {
    const lines: string[] = [
        `run ${run.run_id}  status=${run.status}  execution_mode=${run.execution_mode}` +
            (run.status === 'failed' || run.status === 'superseded'
                ? `  reason=${run.terminal_reason ?? 'reason unavailable'}`
                : ''),
        `spec ${run.spec.repo}#${run.spec.issue_number} (${run.spec.spec_id})`,
        `tasks (${Object.keys(run.tasks).length}):`,
    ]
    for (const t of Object.values(run.tasks)) {
        const bits = [`  ${t.task_id}`, t.status]
        if (t.escalation_rung > 0) {
            bits.push(`rung=${t.escalation_rung}`)
        }
        if (t.pr_number !== undefined) {
            bits.push(`pr=#${t.pr_number}`)
        }
        if (t.failure_class !== undefined) {
            bits.push(`class=${t.failure_class}`)
        }
        lines.push(bits.join('  '))
    }
    return lines.join('\n')
}

export async function runState(argv: string[], overrides: CurrentRunOverrides = {}): Promise<ExitCode> {
    const args = parseArgs(argv, {booleans: ['summary']})
    if (args.flag('help') === true) {
        return emitHelp(HELP)
    }

    const state = new StateManager()
    const runId = args.positionals[0]

    const runState = runId !== undefined ? await state.read(runId) : await readCurrentForCwd(state, overrides)

    if (runState === null) {
        if (args.flag('summary') === true) {
            emitLine('no current run')
        } else {
            emitJson({current: null})
        }
        return EXIT.OK
    }

    if (args.flag('summary') === true) {
        emitLine(summarize(runState))
    } else {
        emitJson(runState)
    }
    return EXIT.OK
}

export const stateCommand: Subcommand = {
    describe: 'Print run state (current or by run-id); read-only',
    run: withUsageGuard('state', runState),
}
