/**
 * `factory configure` — inspect or edit the persisted config overlay.
 *
 *   factory configure                      → print the resolved config (JSON)
 *   factory configure --get <key.path>     → print one resolved value (JSON)
 *   factory configure --set <key.path=val> → merge + validate + persist; print result
 *   factory configure --unset <key.path>   → revert a key to its default; print result
 *
 * `--set`/`--unset` may repeat. Every edit round-trips through ConfigSchema BEFORE
 * it touches disk (a bad value is a loud EXIT.ERROR, never a persisted-invalid
 * config). Writes are the SPARSE overlay (saveRawConfig), so future default
 * changes stay visible to anyone who ran `configure`.
 */
import {EXIT, type ExitCode} from '../../shared/exit-codes.js'
import {parseArgs, UsageError} from '../args.js'
import {emitJson, emitHelp} from '../io.js'
import {
    loadConfig,
    readRawConfig,
    saveRawConfig,
    parseSetToken,
    splitPath,
    setAtPath,
    unsetAtPath,
    getAtPath,
} from '../../config/index.js'
import {withUsageGuard, type Subcommand} from '../registry-types.js'

const HELP = `factory configure — inspect or edit the config overlay

Usage:
  factory configure                         Print the resolved config as JSON
  factory configure --get <key.path>        Print one resolved value as JSON
  factory configure --set <key.path=value>  Set a value (repeatable), persist, print result
  factory configure --unset <key.path>      Revert a key to its default (repeatable)

Values parse as JSON when possible (numbers, booleans, arrays); otherwise as a
bare string. Examples:
  factory configure --set quality.holdoutPercent=25
  factory configure --set git.baseBranch=develop
  factory configure --set git.autoProvision=true`

async function run(argv: string[]): Promise<ExitCode> {
    const args = parseArgs(argv)
    if (args.flag('help') === true) {
        return emitHelp(HELP)
    }

    const sets = args.all('set')
    const unsets = args.all('unset')
    const getKey = args.flag('get')

    // --get: read one resolved value (defaults applied).
    if (typeof getKey === 'string') {
        if (sets.length > 0 || unsets.length > 0) {
            throw new UsageError('--get cannot be combined with --set/--unset')
        }
        emitJson(getAtPath(loadConfig(), splitPath(getKey)))
        return EXIT.OK
    }

    // No mutations: print the whole resolved config.
    if (sets.length === 0 && unsets.length === 0) {
        emitJson(loadConfig())
        return EXIT.OK
    }

    // Apply every edit to the raw overlay, then validate+persist once.
    let raw = readRawConfig()
    for (const token of sets) {
        const {path, value} = parseSetToken(token)
        raw = setAtPath(raw, path, value)
    }
    for (const token of unsets) {
        raw = unsetAtPath(raw, splitPath(token))
    }
    const resolved = await saveRawConfig(raw)
    emitJson(resolved)
    return EXIT.OK
}

export const configureCommand: Subcommand = {
    describe: 'Inspect or edit the persisted config (--get/--set/--unset)',
    run: withUsageGuard('configure', run),
}
