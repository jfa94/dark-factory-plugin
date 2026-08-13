/**
 * Factory hook dispatcher — importable `dispatchHook()` + a name-keyed registry.
 *
 * Invoked (via the built `dist/factory-hook.js`) from `hooks/hooks.json` as
 * `factory-hook <name>`. The registry is a FROZEN seam: WS9 registers each guard
 * by adding `{ name: { describe, run } }` whose `run` delegates to an importable
 * `src/hooks/<name>.ts` function — so every guard is unit-testable in isolation.
 *
 * Conventions mirror the CLI:
 *   - `--help` / `-h` / no args → list hooks, return EXIT.OK.
 *   - unknown hook             → stderr, return EXIT.USAGE.
 *
 * The thin entry `src/bin/factory-hook.ts` is the only `process.exit` site.
 */
import {EXIT, type ExitCode} from '../shared/exit-codes.js'
import {nonNull} from '../shared/index.js'
import type {Hook} from './registry-types.js'
import {runBranchProtection} from './branch-protection.js'
import {runWriteProtection} from './write-protection.js'
import {runHoldoutGuard} from './holdout-guard.js'
import {runSecretGuard} from './secret-guard.js'
import {runPipelineGuards} from './pipeline-guards.js'
import {runSubagentStop} from './subagent-stop.js'
import {runStopGate} from './stop-gate.js'
import {runSessionStart} from './session-start.js'

/** The mutable hook registry. WS9 registers the real guards here. */
export const hookRegistry: Record<string, Hook> = {
    'branch-protection': {
        describe: 'PreToolUse Bash: block destructive git ops on protected branches',
        run: (argv) => runBranchProtection(argv),
    },
    'write-protection': {
        describe: 'PreToolUse Edit|Write|MultiEdit: deny writes to hardcoded TCB paths (Δ W)',
        run: (argv) => runWriteProtection(argv),
    },
    'holdout-guard': {
        describe: 'PreToolUse Read|Grep|Glob|Bash: deny reads of the holdout answer-key store (Δ Y)',
        run: (argv) => runHoldoutGuard(argv),
    },
    'secret-guard': {
        describe: 'PreToolUse Bash: block git commit/push staging a known secret shape (Δ B)',
        run: (argv) => runSecretGuard(argv),
    },
    'pipeline-guards': {
        describe: "PreToolUse: test-writer scope + nested-shell + derive-don't-store ship gating (Δ V)",
        run: (argv) => runPipelineGuards(argv),
    },
    'subagent-stop': {
        describe:
            "SubagentStop: log a stopping reviewer's parsed verdict (observational — the orchestrator record is the single writer of task.reviewers[])",
        run: (argv) => runSubagentStop(argv),
    },
    'stop-gate': {
        describe:
            'Stop: one-shot block telling the session to `factory resume` an owned all-terminal unfinalized run (never mutates state); one-shot block on state corruption; stop_hook_active re-entries always allow',
        run: (argv) => runStopGate(argv),
    },
    'session-start': {
        describe:
            'SessionStart (compact): re-inject the runner Iron Laws + a pointer to reload the pipeline-runner skill',
        run: (argv) => runSessionStart(argv),
    },
}

function printHelp(): void {
    const names = Object.keys(hookRegistry).sort()
    const width = names.reduce((m, n) => Math.max(m, n.length), 0)
    const lines: string[] = [
        'factory-hook — factory plugin hook dispatcher',
        '',
        'Usage: factory-hook <hook-name> [args]',
        '',
        'Hooks:',
        ...names.map((n) => `  ${n.padEnd(width)}  ${nonNull(hookRegistry[n]).describe}`),
    ]
    process.stdout.write(lines.join('\n') + '\n')
}

/**
 * Dispatch a factory-hook invocation. `argv` is `process.argv.slice(2)`.
 * Returns the exit code; never calls `process.exit` itself.
 */
export async function dispatchHook(argv: string[]): Promise<ExitCode> {
    const [name, ...rest] = argv

    if (name === undefined || name === '--help' || name === '-h') {
        printHelp()
        return EXIT.OK
    }

    const hook = hookRegistry[name]
    if (!hook) {
        process.stderr.write(`factory-hook: unknown hook '${name}'. Run \`factory-hook --help\` for the list.\n`)
        return EXIT.USAGE
    }

    return hook.run(rest)
}
