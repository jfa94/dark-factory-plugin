/**
 * Config WRITER — the counterpart to `load.ts`'s reader, used by
 * `factory configure --set/--unset`.
 *
 * Design rules (mirror the reader's loud-fail contract):
 *   - Every write round-trips through {@link ConfigSchema} BEFORE it touches disk,
 *     so a bad `--set` is a LOUD ZodError, never a persisted invalid config (the
 *     reader would then loud-fail on the next load — fail early at the write).
 *   - The on-disk file stays a SPARSE overlay: we read the raw stored object
 *     (only the keys the user previously set), apply the dotted-path edit, parse
 *     the result for validation, and write the EDITED RAW object back — not the
 *     fully-defaulted {@link Config}. Persisting all defaults would freeze them,
 *     defeating Zod's `.default()` and making a future default change invisible to
 *     anyone who ever ran `configure`.
 *   - Atomic write (temp + fsync + rename) via the shared helper, same as state.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {existsSync, readFileSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {atomicWriteFile} from '../shared/atomic-write.js'
import {parseJson, stringifyJson} from '../shared/json.js'
import {at} from '../shared/index.js'
import {configPath, resolveDataDir, type DataDirOptions} from './load.js'
import {ConfigSchema, type Config} from './schema.js'

/** A JSON-ish value a config leaf may hold. */
export type ConfigValue = string | number | boolean | null | ConfigValue[] | {[k: string]: ConfigValue}

/** Read the RAW stored config overlay (the sparse object on disk), or `{}`. */
export function readRawConfig(opts: DataDirOptions = {}): Record<string, unknown> {
    const file = configPath(resolveDataDir(opts))
    if (!existsSync(file)) {
        return {}
    }
    const parsed = parseJson(readFileSync(file, 'utf8'), file)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(`config: ${file} is not a JSON object`)
    }
    return parsed as Record<string, unknown>
}

/**
 * Validate + atomically persist a raw config overlay to `<dataDir>/config.json`.
 * Throws (ZodError) if the overlay does not satisfy {@link ConfigSchema} — the
 * caller's edit never reaches disk in an invalid state. Returns the fully-resolved
 * {@link Config} (defaults applied) for the caller to echo.
 */
export async function saveRawConfig(raw: Record<string, unknown>, opts: DataDirOptions = {}): Promise<Config> {
    // Validate the OVERLAY by parsing it (defaults fill the gaps). A failure here
    // is loud and pre-disk.
    const resolved = ConfigSchema.parse(raw)
    const dataDir = resolveDataDir(opts)
    await mkdir(dataDir, {recursive: true})
    await atomicWriteFile(configPath(dataDir), stringifyJson(raw))
    return resolved
}

/**
 * Parse a `--set` token (`a.b.c=value`) into a dotted path + a typed value. The
 * value is parsed as JSON when it parses (so `--set quality.holdoutPercent=20`,
 * `--set git.autoProvision=true`, `--set spec.tags='["x","y"]'` all type
 * correctly); otherwise it is kept as a bare string (`--set git.baseBranch=develop`).
 */
export function parseSetToken(token: string): {path: string[]; value: ConfigValue} {
    const eq = token.indexOf('=')
    if (eq <= 0) {
        throw new Error(`configure: --set expects 'key.path=value', got '${token}'`)
    }
    const path = splitPath(token.slice(0, eq))
    const rawValue = token.slice(eq + 1)
    return {path, value: coerceValue(rawValue)}
}

/** JSON-parse a scalar token, falling back to the bare string. */
function coerceValue(raw: string): ConfigValue {
    try {
        // ConfigValue is definitionally the set of all JSON values, so any successful
        // parse IS a ConfigValue — the cast off `unknown` is sound by construction.
        return parseJson(raw) as ConfigValue
    } catch {
        return raw
    }
}

/** Split + validate a dotted key path (no empty segments). */
export function splitPath(dotted: string): string[] {
    const path = dotted.split('.')
    if (path.length === 0 || path.some((s) => s.length === 0)) {
        throw new Error(`configure: invalid key path '${dotted}'`)
    }
    return path
}

/**
 * Return a deep clone of `obj` with `path` set to `value` (creating intermediate
 * objects). Pure — never mutates the input (the caller validates the result before
 * persisting).
 */
export function setAtPath(obj: Record<string, unknown>, path: string[], value: ConfigValue): Record<string, unknown> {
    const next = structuredClone(obj)
    let cursor: Record<string, unknown> = next
    for (let i = 0; i < path.length - 1; i++) {
        const key = at(path, i)
        const existing = cursor[key]
        if (existing === undefined || existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
            cursor[key] = {}
        }
        cursor = cursor[key] as Record<string, unknown>
    }
    cursor[at(path, path.length - 1)] = value
    return next
}

/**
 * Return a deep clone of `obj` with `path` removed (so the key reverts to its
 * schema default on the next load). Pruning a now-empty parent object keeps the
 * overlay sparse. A no-op if the path is absent.
 */
export function unsetAtPath(obj: Record<string, unknown>, path: string[]): Record<string, unknown> {
    const next = structuredClone(obj)
    const parents: {container: Record<string, unknown>; key: string}[] = []
    let cursor: Record<string, unknown> = next
    for (let i = 0; i < path.length - 1; i++) {
        const key = at(path, i)
        const child = cursor[key]
        if (child === undefined || child === null || typeof child !== 'object' || Array.isArray(child)) {
            return next // path absent — nothing to unset
        }
        parents.push({container: cursor, key})
        cursor = child as Record<string, unknown>
    }
    Reflect.deleteProperty(cursor, at(path, path.length - 1))
    // Prune now-empty ancestors (deepest first) to keep the overlay minimal.
    for (let i = parents.length - 1; i >= 0; i--) {
        const {container, key} = at(parents, i)
        const child = container[key] as Record<string, unknown>
        if (Object.keys(child).length === 0) {
            Reflect.deleteProperty(container, key)
        } else {
            break
        }
    }
    return next
}

/** Read a dotted-path value out of the fully-resolved {@link Config}, or throw. */
export function getAtPath(config: Config, path: string[]): unknown {
    let cursor: unknown = config
    for (const key of path) {
        if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
            throw new Error(`configure: '${path.join('.')}' has no value (not an object at '${key}')`)
        }
        if (!(key in (cursor as Record<string, unknown>))) {
            throw new Error(`configure: unknown config key '${path.join('.')}'`)
        }
        cursor = (cursor as Record<string, unknown>)[key]
    }
    return cursor
}
