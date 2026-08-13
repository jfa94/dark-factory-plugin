/**
 * Tests for E2 — `factory autonomy ensure`: the full-autonomy port of the old
 * `pipeline-ensure-autonomy`. It materializes `${CLAUDE_PLUGIN_DATA}/merged-settings.json`
 * from `templates/settings.autonomous.json` merged with the user's settings,
 * with placeholder substitution + env-baking + statusLine wiring, and prints the
 * `claude --worktree --settings <path>` relaunch command. That command carries NO
 * permission-mode override — the permissive merged settings are the point, and no
 * agent-side write lands under `~/.claude/` outside the `.claude/worktrees/`
 * exemption any more (Decision 67), so there is
 * nothing left for one to suppress. The relaunch-command assertions below use
 * EXACT equality so re-appending any flag fails them. The deny list is
 * deliberately short (accident-prevention, not containment) — see Decision 65.
 *
 * The materialize core is pure + injectable (template string, user settings,
 * dataDir, pluginRoot) so units never touch the real ~/.claude or a real plugin
 * install.
 */
import {mkdtemp, rm, readFile, writeFile, mkdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
    materializeMergedSettings,
    mergedSettingsPath,
    runAutonomyEnsure,
    runAutonomyPreflight,
    runAutonomyStatus,
    type AutonomyStatus,
} from './autonomy.js'
import {EXIT} from '../../shared/exit-codes.js'
import {at} from '../../shared/index.js'

const PLUGIN_ROOT = '/opt/plugins/factory'
const DATA_DIR = '/home/u/.claude/plugins/data/factory-mkt'
const HOME = '/home/u'

/** A minimal but representative autonomous template (mirrors the real one's shape). */
const TEMPLATE = JSON.stringify({
    env: {FACTORY_AUTONOMOUS_MODE: '1'},
    permissions: {allow: ['Bash(*)', 'Read(${CLAUDE_PLUGIN_DATA}/**)'], deny: ['Bash(rm -rf /)']},
    statusLine: {type: 'command', command: '${CLAUDE_PLUGIN_ROOT}/bin/factory statusline'},
    hooks: {
        PreToolUse: [
            {
                matcher: 'Read',
                hooks: [
                    {
                        type: 'command',
                        command: "PD='${CLAUDE_PLUGIN_DATA}'; PDT='${CLAUDE_PLUGIN_DATA_TILDE}'; echo ok",
                    },
                ],
            },
        ],
    },
})

describe('materializeMergedSettings', () => {
    it('substitutes ROOT, DATA and DATA_TILDE placeholders everywhere', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const json = JSON.stringify(out)
        expect(json).not.toContain('${CLAUDE_PLUGIN_ROOT}')
        expect(json).not.toContain('${CLAUDE_PLUGIN_DATA}')
        expect(json).not.toContain('${CLAUDE_PLUGIN_DATA_TILDE}')
        // ROOT resolved in statusLine; DATA resolved in the allow-list entry.
        const sl = out.statusLine as {command: string}
        expect(sl.command).toBe(`${PLUGIN_ROOT}/bin/factory statusline`)
        const allow = (out.permissions as {allow: string[]}).allow
        expect(allow).toContain(`Read(${DATA_DIR}/**)`)
        // DATA_TILDE resolves to the ~-shortened form of the data dir.
        const hooksShape = out.hooks as {PreToolUse: {hooks: {command: string}[]}[]}
        const hookCmd = at(at(hooksShape.PreToolUse, 0).hooks, 0).command
        expect(hookCmd).toContain(`PD='${DATA_DIR}'`)
        expect(hookCmd).toContain("PDT='~/.claude/plugins/data/factory-mkt'")
    })

    it('bakes CLAUDE_PLUGIN_DATA into the env block', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.CLAUDE_PLUGIN_DATA).toBe(DATA_DIR)
        expect(env.FACTORY_AUTONOMOUS_MODE).toBe('1') // template env preserved
    })

    it('wires statusLine to factory statusline (NOT a copied wrapper script)', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const sl = out.statusLine as {type: string; command: string}
        expect(sl.command).toBe(`${PLUGIN_ROOT}/bin/factory statusline`)
        // No data-dir wrapper copy: the command points at the bundle, not a .sh copy.
        expect(sl.command).not.toMatch(/statusline-wrapper\.sh/)
    })

    it("chains the user's existing statusLine via FACTORY_ORIGINAL_STATUSLINE", () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {statusLine: {type: 'command', command: '~/my/statusline.sh'}},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        // Template statusLine wins (factory must capture rate_limits)...
        const sl = out.statusLine as {command: string}
        expect(sl.command).toBe(`${PLUGIN_ROOT}/bin/factory statusline`)
        // ...but the user's own is preserved as the chained original, ~ expanded.
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBe(`${HOME}/my/statusline.sh`)
    })

    it('does NOT set FACTORY_ORIGINAL_STATUSLINE when the user already points at factory statusline', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {statusLine: {command: `${PLUGIN_ROOT}/bin/factory statusline`}},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })

    it('CHAINS a user statusLine that points at a NON-statusline factory subcommand', () => {
        // Tightened ownership check: only the `bin/factory statusline` WRITER is
        // treated as ours; any other factory subcommand the user wired is preserved.
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {statusLine: {command: `${PLUGIN_ROOT}/bin/factory some-other-cmd`}},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBe(`${PLUGIN_ROOT}/bin/factory some-other-cmd`)
    })

    it('DROPS a stale FACTORY_ORIGINAL_STATUSLINE when the user statusLine is now ours', () => {
        // A prior autonomous relaunch baked FACTORY_ORIGINAL_STATUSLINE into the user's
        // env; now the user points at the factory writer, so there is nothing to chain —
        // the stale value must not survive (else the writer would chain to itself).
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {
                statusLine: {command: `${PLUGIN_ROOT}/bin/factory statusline`},
                env: {FACTORY_ORIGINAL_STATUSLINE: '/old/stale.sh'},
            },
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })

    it('DROPS a stale FACTORY_ORIGINAL_STATUSLINE when the user has no statusLine at all', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {env: {FACTORY_ORIGINAL_STATUSLINE: '/old/stale.sh'}},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })

    it('uses the user settings as the base, overlaying template permissions/env/hooks', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {
                model: 'opus',
                env: {MY_KEY: 'v'},
                permissions: {allow: ['Bash(mine:*)']},
            },
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        // User-only keys survive.
        expect(out.model).toBe('opus')
        // env is a union: user keys + template keys + baked DATA.
        const env = out.env as Record<string, string>
        expect(env.MY_KEY).toBe('v')
        expect(env.FACTORY_AUTONOMOUS_MODE).toBe('1')
        expect(env.CLAUDE_PLUGIN_DATA).toBe(DATA_DIR)
        // permissions.allow unions user + template (template entries substituted).
        const allow = (out.permissions as {allow: string[]}).allow
        expect(allow).toContain('Bash(mine:*)')
        expect(allow).toContain('Bash(*)')
        expect(allow).toContain(`Read(${DATA_DIR}/**)`)
    })

    it('throws LOUD when the template is not valid JSON', () => {
        expect(() =>
            materializeMergedSettings({
                template: 'not json at all {{{',
                userSettings: {},
                dataDir: DATA_DIR,
                pluginRoot: PLUGIN_ROOT,
                home: HOME,
            })
        ).toThrow(/JSON/)
    })

    it('throws LOUD when the template parses to a non-object (e.g. an array)', () => {
        expect(() =>
            materializeMergedSettings({
                template: JSON.stringify([1, 2, 3]),
                userSettings: {},
                dataDir: DATA_DIR,
                pluginRoot: PLUGIN_ROOT,
                home: HOME,
            })
        ).toThrow(/not a JSON object/)
    })

    it('stamps env.FACTORY_SETTINGS_HASH and the hash is stable under template key order', () => {
        const base = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const hash = (base.env as Record<string, string>).FACTORY_SETTINGS_HASH
        expect(hash).toMatch(/^[0-9a-f]{64}$/)
        // Same content, different top-level key order → same hash (canonical JSON).
        const reordered = JSON.stringify(
            Object.fromEntries(Object.entries(JSON.parse(TEMPLATE) as Record<string, unknown>).reverse())
        )
        const out = materializeMergedSettings({
            template: reordered,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        expect((out.env as Record<string, string>).FACTORY_SETTINGS_HASH).toBe(hash)
    })

    it('normalizes plugin-root paths before hashing: a moved install alone does not churn the hash', () => {
        const a = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: '/opt/plugins/factory@1.0.0',
            home: HOME,
        })
        const b = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: '/opt/plugins/factory@2.0.0',
            home: HOME,
        })
        expect((a.env as Record<string, string>).FACTORY_SETTINGS_HASH).toBe(
            (b.env as Record<string, string>).FACTORY_SETTINGS_HASH
        )
    })

    it('a semantic template change AND a status-line change each change the hash', () => {
        const hashOf = (template: string, userSettings: Record<string, unknown>): string => {
            const out = materializeMergedSettings({
                template,
                userSettings,
                dataDir: DATA_DIR,
                pluginRoot: PLUGIN_ROOT,
                home: HOME,
            })
            return (out.env as {FACTORY_SETTINGS_HASH: string}).FACTORY_SETTINGS_HASH
        }
        const base = hashOf(TEMPLATE, {})
        const tweaked = JSON.parse(TEMPLATE) as {env: Record<string, string>}
        tweaked.env.NEW_KEY = 'v'
        expect(hashOf(JSON.stringify(tweaked), {})).not.toBe(base)
        // A user statusLine changes the chained FACTORY_ORIGINAL_STATUSLINE → new hash.
        expect(hashOf(TEMPLATE, {statusLine: {type: 'command', command: '~/mine.sh'}})).not.toBe(base)
    })

    it('a stale inherited FACTORY_SETTINGS_HASH in the user env never leaks into the hash', () => {
        const clean = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const withStale = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {env: {FACTORY_SETTINGS_HASH: 'stale-from-a-prior-relaunch'}},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        expect((withStale.env as Record<string, string>).FACTORY_SETTINGS_HASH).toBe(
            (clean.env as Record<string, string>).FACTORY_SETTINGS_HASH
        )
    })

    it('emits valid JSON (round-trips through stringify/parse)', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        expect(() => {
            JSON.parse(JSON.stringify(out))
        }).not.toThrow()
    })
})

describe('mergedSettingsPath', () => {
    it('is <dataDir>/merged-settings.json', () => {
        expect(mergedSettingsPath(DATA_DIR)).toBe(join(DATA_DIR, 'merged-settings.json'))
    })
})

describe('runAutonomyEnsure', () => {
    let dataDir: string
    let pluginRoot: string
    const out: string[] = []

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-autonomy-data-'))
        pluginRoot = await mkdtemp(join(tmpdir(), 'factory-autonomy-root-'))
        // Phase a minimal template under the fake plugin root.
        await mkdir(join(pluginRoot, 'templates'), {recursive: true})
        await writeFile(join(pluginRoot, 'templates', 'settings.autonomous.json'), TEMPLATE, 'utf8')
        out.length = 0
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(pluginRoot, {recursive: true, force: true})
    })

    it('writes a valid merged-settings.json and prints the relaunch command', async () => {
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath: join(pluginRoot, 'no-such-user-settings.json'), // missing → {}
            home: HOME,
            writeStdout: (t) => out.push(t),
        })

        const path = join(dataDir, 'merged-settings.json')
        expect(existsSync(path)).toBe(true)
        const written = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
        // Fully substituted + env baked + statusLine wired.
        expect(JSON.stringify(written)).not.toContain('${CLAUDE_PLUGIN')
        expect((written.env as Record<string, string>).CLAUDE_PLUGIN_DATA).toBe(dataDir)
        expect((written.statusLine as {command: string}).command).toBe(`${pluginRoot}/bin/factory statusline`)
        expect(result.path).toBe(path)
        // Prints the relaunch command. Asserted by EXACT equality, not substring:
        // the command must carry no permission-mode flag of any kind (Decision 67 —
        // the permissive merged settings are the whole point), and an exact match
        // is what fails if one is ever re-appended.
        const printed = out.join('')
        expect(printed).toContain(`claude --worktree --settings ${path}\n`)
        expect(result.relaunchCommand).toBe(`claude --worktree --settings ${path}`)
    })

    it("reads the user's settings.json when present and chains its statusLine", async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, JSON.stringify({statusLine: {command: '~/mine.sh'}, model: 'opus'}), 'utf8')
        await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath,
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        const written = JSON.parse(await readFile(join(dataDir, 'merged-settings.json'), 'utf8')) as Record<
            string,
            unknown
        >
        expect(written.model).toBe('opus')
        expect((written.env as Record<string, string>).FACTORY_ORIGINAL_STATUSLINE).toBe(`${HOME}/mine.sh`)
    })

    it("degrades to an empty base (no throw) when the user's settings.json is unparseable", async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, '{ this is : not json', 'utf8')
        // Must NOT throw — a corrupt user settings file falls back to {} base.
        await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath,
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        const written = JSON.parse(await readFile(join(dataDir, 'merged-settings.json'), 'utf8')) as Record<
            string,
            unknown
        >
        // Template defaults still applied; no user statusLine chained (base was empty).
        expect((written.env as Record<string, string>).CLAUDE_PLUGIN_DATA).toBe(dataDir)
        expect((written.env as Record<string, string>).FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })
})

describe('runAutonomyStatus', () => {
    let dataDir: string
    const out: string[] = []

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-autonomy-status-'))
        out.length = 0
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
    })

    it('exits OK and reports autonomous when FACTORY_AUTONOMOUS_MODE=1', async () => {
        const code = await runAutonomyStatus({
            dataDir,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        expect(out.join('')).toContain('autonomous: yes')
    })

    it('exits ERROR and reports NOT autonomous when the var is unset', async () => {
        const code = await runAutonomyStatus({
            dataDir,
            env: {},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        expect(out.join('')).toContain('autonomous: NO')
    })

    it("exits ERROR for any non-'1' value (no bypass)", async () => {
        const code = await runAutonomyStatus({
            dataDir,
            env: {FACTORY_AUTONOMOUS_MODE: 'true'},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
    })

    it('--json emits the full status shape with envSet distinguishing unset from wrong-value', async () => {
        await runAutonomyStatus({
            dataDir,
            env: {FACTORY_AUTONOMOUS_MODE: '0'},
            json: true,
            writeStdout: (t) => out.push(t),
        })
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed.autonomous).toBe(false)
        expect(parsed.envSet).toBe(true) // present but "0"
        expect(parsed.mergedSettingsPresent).toBe(false)
        expect(parsed.mergedSettingsPath).toBe(mergedSettingsPath(dataDir))
    })

    it('--json reports envSet:false when the var is entirely absent', async () => {
        await runAutonomyStatus({dataDir, env: {}, json: true, writeStdout: (t) => out.push(t)})
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed.envSet).toBe(false)
    })

    it('detects an existing merged-settings.json', async () => {
        await writeFile(mergedSettingsPath(dataDir), '{}', 'utf8')
        await runAutonomyStatus({
            dataDir,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            json: true,
            writeStdout: (t) => out.push(t),
        })
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed.mergedSettingsPresent).toBe(true)
    })

    it('never throws even when the data dir cannot be resolved (degrades to env-only)', async () => {
        // No dataDir + an env with no resolution hints: must still answer from the env
        // signal rather than throw (this is the diagnostic the halted user runs).
        const code = await runAutonomyStatus({
            env: {FACTORY_AUTONOMOUS_MODE: '1', CLAUDE_PLUGIN_DATA: dataDir},
            json: true,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed.autonomous).toBe(true)
    })
})

describe('runAutonomyPreflight', () => {
    let dataDir: string
    let pluginRoot: string
    const out: string[] = []

    /** Path of the merged settings under the current temp data dir. */
    const settingsPath = (): string => mergedSettingsPath(dataDir)

    /** The hash a regenerate would stamp NOW for this temp dataDir/pluginRoot. */
    const expectedHash = (): string => {
        const merged = materializeMergedSettings({
            template: TEMPLATE,
            userSettings: {},
            dataDir,
            pluginRoot,
            home: HOME,
        })
        return (merged.env as {FACTORY_SETTINGS_HASH: string}).FACTORY_SETTINGS_HASH
    }

    /** Write a merged-settings.json carrying a sentinel key (and optional hash stamp). */
    async function stageMergedSettings(hash?: string): Promise<void> {
        const obj: Record<string, unknown> =
            hash !== undefined ? {__sentinel: 'keep', env: {FACTORY_SETTINGS_HASH: hash}} : {__sentinel: 'keep'}
        await writeFile(settingsPath(), JSON.stringify(obj), 'utf8')
    }

    /** Read back the written merged-settings.json as an object. */
    async function readMerged(): Promise<Record<string, unknown>> {
        return JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>
    }

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-preflight-data-'))
        pluginRoot = await mkdtemp(join(tmpdir(), 'factory-preflight-root-'))
        await mkdir(join(pluginRoot, 'templates'), {recursive: true})
        await writeFile(join(pluginRoot, 'templates', 'settings.autonomous.json'), TEMPLATE, 'utf8')
        out.length = 0
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(pluginRoot, {recursive: true, force: true})
    })

    it('exits OK and does NOT regenerate when autonomous + fresh (stored hash matches)', async () => {
        await stageMergedSettings(expectedHash())
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        // No regenerate ⇒ the sentinel survives untouched.
        expect((await readMerged()).__sentinel).toBe('keep')
        // Human-facing result: an unmistakable OK: pass line + a one-sentence verdict.
        const printed = out.join('')
        expect(printed).toContain('OK:')
        expect(printed).toMatch(/ready/i)
    })

    it('regenerates + exits ERROR with the relaunch command when the stored hash is stale', async () => {
        await stageMergedSettings('deadbeef-not-the-real-hash')
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        const written = await readMerged()
        // Regenerated: sentinel gone, hash re-stamped to the expected content hash.
        expect(written.__sentinel).toBeUndefined()
        expect((written.env as Record<string, string>).FACTORY_SETTINGS_HASH).toBe(expectedHash())
        const printed = out.join('')
        expect(printed).toContain(`claude --worktree --settings ${settingsPath()}\n`)
        expect(printed).toContain('stale')
        // Human-facing result: an unmistakable HALT: line on the relaunch-required path.
        expect(printed).toContain('HALT:')
    })

    it('regenerates + exits ERROR when the existing file lacks a FACTORY_SETTINGS_HASH stamp', async () => {
        await stageMergedSettings() // unstamped
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        const written = await readMerged()
        expect(written.__sentinel).toBeUndefined()
        expect((written.env as Record<string, string>).FACTORY_SETTINGS_HASH).toBe(expectedHash())
    })

    it('generates + exits ERROR when not autonomous + the file is missing (first run)', async () => {
        expect(existsSync(settingsPath())).toBe(false)
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {}, // not autonomous
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        expect(existsSync(settingsPath())).toBe(true)
        expect(out.join('')).toContain(`claude --worktree --settings ${settingsPath()}\n`)
    })

    it('exits OK without writing when autonomous via raw env + no file (CI path)', async () => {
        expect(existsSync(settingsPath())).toBe(false)
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        // No file existed and none was written — the env alone is sanctioned (CI).
        expect(existsSync(settingsPath())).toBe(false)
    })

    it("exits OK without writing when the expected hash can't be computed (no churn)", async () => {
        await rm(join(pluginRoot, 'templates'), {recursive: true, force: true})
        await stageMergedSettings('deadbeef') // would look stale IF we could compare
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        // Can't prove staleness ⇒ leave the file untouched (sentinel survives).
        expect((await readMerged()).__sentinel).toBe('keep')
    })

    it('passes --user-settings through to the regenerate (chains the statusLine)', async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, JSON.stringify({statusLine: {command: '~/mine.sh'}}), 'utf8')
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            userSettingsPath,
            env: {}, // not autonomous + missing file ⇒ regenerate
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        const written = await readMerged()
        expect((written.env as Record<string, string>).FACTORY_ORIGINAL_STATUSLINE).toBe(`${HOME}/mine.sh`)
    })

    it('the printed relaunch command points at the merged-settings path on every halt', async () => {
        await stageMergedSettings('deadbeef') // stale ⇒ halt
        await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(out.join('')).toContain(`claude --worktree --settings ${settingsPath()}\n`)
    })
})

describe('the real templates/settings.autonomous.json', () => {
    // Drift guard (Decision 65): the deny list is deliberately short —
    // accident-prevention for a non-adversarial agent, not a containment
    // boundary. It must still cover: the worktree's own .git/, home
    // credentials/config (outside any worktree, unreachable by the
    // path-resolving hooks), and the handful of non-file-path-shaped
    // irreversible ops (interpreter eval, publish/remote-delete).
    it('denies the worktree .git/ and home credentials/config paths', async () => {
        const templatePath = fileURLToPath(new URL('../../../templates/settings.autonomous.json', import.meta.url))
        const template = JSON.parse(await readFile(templatePath, 'utf8')) as {
            permissions: {deny: string[]}
        }
        const deny = template.permissions.deny
        for (const pattern of [
            'Edit(**/.git/**)',
            'Edit(~/.ssh/**)',
            'Edit(~/.aws/**)',
            'Edit(~/.gitconfig)',
            'Edit(~/.npmrc)',
            'Edit(~/.claude.json)',
        ]) {
            expect(deny).toContain(pattern)
        }
    })

    it('carries NO path-form Write(...) rules — only Edit(path) is matched by file permission checks', async () => {
        // A Write(path) rule is dead: in allow it is noise (session-start warning),
        // in deny it is silently unenforced. The Edit(...) twins are the real rules.
        const templatePath = fileURLToPath(new URL('../../../templates/settings.autonomous.json', import.meta.url))
        const template = JSON.parse(await readFile(templatePath, 'utf8')) as {
            permissions: {allow: string[]; deny: string[]}
        }
        const deadWrite = (e: string): boolean => /^Write\(.+\)$/.test(e)
        expect(template.permissions.allow.filter(deadWrite)).toEqual([])
        expect(template.permissions.deny.filter(deadWrite)).toEqual([])
    })

    it('still denies node -e / python -c (kept over-broad on purpose — see Decision doc)', async () => {
        const templatePath = fileURLToPath(new URL('../../../templates/settings.autonomous.json', import.meta.url))
        const template = JSON.parse(await readFile(templatePath, 'utf8')) as {
            permissions: {deny: string[]}
        }
        expect(template.permissions.deny).toContain('Bash(node -e *)')
        expect(template.permissions.deny).toContain('Bash(python -c *)')
    })

    it('no longer carries the AWS/SQL/repo-relative-secrets entries retired by the aggressive shrink', async () => {
        const templatePath = fileURLToPath(new URL('../../../templates/settings.autonomous.json', import.meta.url))
        const template = JSON.parse(await readFile(templatePath, 'utf8')) as {
            permissions: {deny: string[]}
        }
        const deny = template.permissions.deny
        for (const pattern of [
            'Bash(aws s3 rb *)',
            'Bash(DROP TABLE*)',
            'Bash(TRUNCATE*)',
            'Write(.env)',
            'Write(**/migrations/**)',
            'Write(**/.npmrc)',
            'Bash(sudo *)',
            'Bash(git rebase *)',
        ]) {
            expect(deny).not.toContain(pattern)
        }
    })
})
