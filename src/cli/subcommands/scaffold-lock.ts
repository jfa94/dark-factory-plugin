/**
 * The SCAFFOLD LOCK — `.factory/scaffold.lock` (Decision 15, pristine-refresh).
 *
 * Records the sha256 of each SEED file's content AS SCAFFOLD WROTE IT, so a
 * re-scaffold can prove a seed is PRISTINE (byte-identical to what scaffold last
 * wrote) and safely auto-replace it when the shipped template moves. A seed whose
 * on-disk bytes no longer match its recorded hash — or that has no entry at all
 * (customized, or scaffolded before the lock existed) — stays PROJECT-OWNED and
 * is never touched. Entries are written ONLY when scaffold itself writes the
 * file; a stale entry is kept (harmless — the hash simply never matches again,
 * and reverting the file to the exact scaffold-written bytes re-adopts it).
 *
 * The file is COMMITTED (alongside `.factory/gates.json`) so pristine tracking
 * travels with the repo. It is TCB-protected (`scaffold-lock` rule): a producer
 * that could forge an entry hashing the repo's CUSTOMIZED gate config would
 * schedule it for silent reversion to the weaker plugin baseline on the
 * operator's next scaffold.
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths, never external input */
import {createHash} from 'node:crypto'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {dirname, join} from 'node:path'

export const SCAFFOLD_LOCK_REL = '.factory/scaffold.lock'

export interface ScaffoldLock {
    readonly version: 1
    /** template rel path → sha256 hex of the content scaffold wrote. */
    readonly seeds: Record<string, string>
    /**
     * MANAGED files (the CI net): rel path → sha256 of the content scaffold last
     * RENDERED and either wrote or safely adopted byte-for-byte (S10) — the hash
     * identifies content scaffold vouches for, not proof scaffold performed the
     * write. Lets a re-scaffold prove a managed file is pristine before
     * auto-updating it; a mismatch (or a legacy lock with no entry) is a
     * files_conflict — never a silent clobber. Additive to lock version 1: old
     * engines ignore the key and degrade safely.
     */
    readonly managed: Record<string, string>
}

export function sha256Hex(text: string): string {
    return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Load the target repo's scaffold lock. A missing, unparsable, or wrong-shape V1
 * lock degrades to an EMPTY one (every seed then reads as "customized" — fail
 * safe: nothing gets overwritten on bad data); `invalid` flags an
 * existing-but-garbage lock so the caller rewrites it valid. The ONE throw: a
 * well-formed lock declaring a version this engine does not support (written by
 * a newer plugin) refuses loudly — silently reading it as v1, or rewriting it,
 * would destroy data whose shape this engine cannot know.
 */
export async function loadScaffoldLock(
    targetRoot: string
): Promise<{lock: ScaffoldLock; existed: boolean; invalid: boolean}> {
    const path = join(targetRoot, SCAFFOLD_LOCK_REL)
    const empty: ScaffoldLock = {version: 1, seeds: {}, managed: {}}
    if (!existsSync(path)) {
        return {lock: empty, existed: false, invalid: false}
    }
    try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        const version = typeof parsed === 'object' && parsed !== null ? (parsed as {version?: unknown}).version : null
        if (version !== null && version !== undefined && version !== 1) {
            throw new UnsupportedLockVersionError(version)
        }
        const seeds = typeof parsed === 'object' && parsed !== null ? (parsed as {seeds?: unknown}).seeds : null
        if (typeof seeds !== 'object' || seeds === null) {
            return {lock: empty, existed: true, invalid: true}
        }
        const readMap = (value: unknown): Record<string, string> => {
            const valid: Record<string, string> = {}
            if (typeof value === 'object' && value !== null) {
                for (const [rel, hash] of Object.entries(value)) {
                    if (typeof hash === 'string') {
                        valid[rel] = hash
                    }
                }
            }
            return valid
        }
        const managed = (parsed as {managed?: unknown}).managed
        return {lock: {version: 1, seeds: readMap(seeds), managed: readMap(managed)}, existed: true, invalid: false}
    } catch (err) {
        if (err instanceof UnsupportedLockVersionError) {
            throw err
        }
        return {lock: empty, existed: true, invalid: true}
    }
}

/** A well-formed lock declaring an unsupported version — refuse rather than relabel/rewrite it. */
export class UnsupportedLockVersionError extends Error {
    constructor(version: unknown) {
        super(
            `scaffold: ${SCAFFOLD_LOCK_REL} declares version ${JSON.stringify(version)}, but this engine ` +
                `supports only version 1 — upgrade the factory plugin (or delete the lock to re-adopt seeds). ` +
                `Nothing was written.`
        )
        this.name = 'UnsupportedLockVersionError'
    }
}

/** Write the lock (stable key order + trailing newline for a quiet git diff). */
export async function saveScaffoldLock(targetRoot: string, lock: ScaffoldLock): Promise<void> {
    const path = join(targetRoot, SCAFFOLD_LOCK_REL)
    const sorted = (map: Record<string, string>): Record<string, string> => {
        const out: Record<string, string> = {}
        for (const [rel, hash] of Object.entries(map).sort(([a], [b]) => a.localeCompare(b))) {
            out[rel] = hash
        }
        return out
    }
    await mkdir(dirname(path), {recursive: true})
    await writeFile(
        path,
        JSON.stringify({version: 1, seeds: sorted(lock.seeds), managed: sorted(lock.managed)}, null, 2) + '\n',
        'utf8'
    )
}
