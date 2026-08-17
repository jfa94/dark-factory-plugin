/**
 * Mandatory autonomous-mode gate — the single source of truth for the
 * autonomous signal.
 *
 * The factory pipeline is designed to run unattended: there is no opt-in and no
 * opt-out. A run may only START or RESUME from a session launched with the
 * autonomous settings (which set `FACTORY_AUTONOMOUS_MODE=1` via
 * `templates/settings.autonomous.json`, built in memory and passed inline by
 * `factory autonomy ensure`). `run create` / `run resume` call {@link requireAutonomousMode},
 * which throws {@link NotAutonomousError} — a typed error that bubbles uncaught
 * through the `runCommand` wrapper to `src/bin/factory.ts` (stderr + EXIT.ERROR),
 * mirroring `ProtectionMissingError`.
 *
 * The predicate is exactly `FACTORY_AUTONOMOUS_MODE === "1"` with no bypass flag,
 * so a CI that exports the var satisfies the same gate and nothing can opt out.
 */

/** The single autonomous-mode predicate: exactly `FACTORY_AUTONOMOUS_MODE === "1"`. */
export function isAutonomous(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.FACTORY_AUTONOMOUS_MODE === '1'
}

/**
 * Thrown when the pipeline is asked to start or resume a run outside autonomous
 * mode. Mirrors `ProtectionMissingError` (src/git/protection.ts): a typed
 * `Error` subclass whose message names the exact recovery path; it bubbles
 * uncaught to the bin entrypoint, which prints it and exits non-zero.
 */
export class NotAutonomousError extends Error {
    constructor() {
        super(
            'Pipeline halted: not running in autonomous mode (FACTORY_AUTONOMOUS_MODE is unset).\n' +
                'The factory runs unattended and refuses to start or resume a run otherwise.\n' +
                'Run `factory autonomy ensure`, then relaunch the session with the printed\n' +
                'inline-settings command. Check the current state any time with `factory autonomy status`.'
        )
        this.name = 'NotAutonomousError'
    }
}

/** Refuse to proceed unless autonomous mode is active. */
export function requireAutonomousMode(env: NodeJS.ProcessEnv = process.env): void {
    if (!isAutonomous(env)) {
        throw new NotAutonomousError()
    }
}
