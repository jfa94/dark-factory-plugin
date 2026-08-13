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
     * wrote (S10). Lets a re-scaffold prove a managed file is pristine before
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
 * Load the target repo's scaffold lock. NEVER throws: a missing, unparsable, or
 * wrong-shape lock degrades to an EMPTY one (every seed then reads as
 * "customized" — fail safe: nothing gets overwritten on bad data). `invalid`
 * flags an existing-but-garbage lock so the caller rewrites it valid.
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
    } catch {
        return {lock: empty, existed: true, invalid: true}
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
