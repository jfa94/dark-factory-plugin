/**
 * Tests for `factory autonomy` — inline-settings form (v1.47, Slice 6).
 *
 * The settings are built IN MEMORY from `templates/settings.autonomous.json`
 * ONLY (placeholder substitution + env-baking + the user's own statusLine
 * chained) and passed to `claude` as exactly ONE `--settings <json>`
 * argument via a typed {@link RelaunchSpec} + the single audited POSIX renderer.
 * The user's own `~/.claude/settings.json` is never re-serialized into that
 * argument (it would land in argv/transcript/shell-history) — it still applies
 * as an underlying layer beneath `--settings`.
 * Nothing is written to disk; the FACTORY_SETTINGS_HASH staleness machinery is
 * gone. The relaunch command carries NO permission-mode override — the
 * permissive merged settings are the point (Decision 67 amendment; the 2026-08-17
 * spike chose the inline-settings fallback over native auto mode). The deny list
 * is deliberately short (accident-prevention, not containment) — see Decision 65.
 */
import {execFileSync} from 'node:child_process'
import {mkdtemp, readdir, rm, readFile, writeFile, mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
    buildRelaunchSpec,
    evaluateAutonomyPreflight,
    materializeMergedSettings,
    renderPosixCommand,
    runAutonomyEnsure,
    runAutonomyPreflight,
    runAutonomyStatus,
    type AutonomyStatus,
    type RelaunchSpec,
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
            userStatusLine: '~/my/statusline.sh',
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
            userStatusLine: `${PLUGIN_ROOT}/bin/factory statusline`,
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
            userStatusLine: `${PLUGIN_ROOT}/bin/factory some-other-cmd`,
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBe(`${PLUGIN_ROOT}/bin/factory some-other-cmd`)
    })

    it('does not set FACTORY_ORIGINAL_STATUSLINE when the user has no statusLine at all', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        const env = out.env as Record<string, string>
        expect(env.FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })

    it('the inline payload carries NOTHING from the user settings beyond the statusLine command (security regression)', () => {
        // Even if a caller mistakenly passed user secrets through some other
        // channel, materializeMergedSettings has no field to receive them — the
        // template is the only source for everything but userStatusLine.
        const out = materializeMergedSettings({
            template: TEMPLATE,
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        expect(out.model).toBeUndefined()
        const env = out.env as Record<string, string>
        expect(Object.keys(env).sort()).toEqual(['CLAUDE_PLUGIN_DATA', 'FACTORY_AUTONOMOUS_MODE'])
        const allow = (out.permissions as {allow: string[]}).allow
        expect(allow).toEqual(['Bash(*)', `Read(${DATA_DIR}/**)`])
    })

    it('throws LOUD when the template is not valid JSON', () => {
        expect(() =>
            materializeMergedSettings({
                template: 'not json at all {{{',
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
                dataDir: DATA_DIR,
                pluginRoot: PLUGIN_ROOT,
                home: HOME,
            })
        ).toThrow(/not a JSON object/)
    })

    it('emits valid JSON (round-trips through stringify/parse)', () => {
        const out = materializeMergedSettings({
            template: TEMPLATE,
            dataDir: DATA_DIR,
            pluginRoot: PLUGIN_ROOT,
            home: HOME,
        })
        expect(() => {
            JSON.parse(JSON.stringify(out))
        }).not.toThrow()
    })
})

describe('renderPosixCommand', () => {
    it('single-quotes every token and escapes embedded single quotes', () => {
        const spec: RelaunchSpec = {executable: 'claude', argv: ['--settings', `{"a":"it's"}`]}
        expect(renderPosixCommand(spec)).toBe(`'claude' '--settings' '{"a":"it'\\''s"}'`)
    })

    it('round-trips argv with spaces, apostrophes, semicolons, dollar signs and newlines through a real shell', () => {
        const tricky = [
            'plain',
            'two words',
            "it's got 'quotes'",
            'a;b && c',
            '$HOME `whoami` $(id)',
            'line1\nline2',
            '{"env":{"K":"v"},"deny":["Bash(rm -rf /)"]}',
        ]
        const spec: RelaunchSpec = {
            executable: process.execPath,
            argv: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...tricky],
        }
        const stdout = execFileSync('sh', ['-c', renderPosixCommand(spec)], {encoding: 'utf8'})
        // node consumes its own `--` end-of-options marker: slice(1) is exactly the payload
        expect(JSON.parse(stdout)).toEqual(tricky)
    })
})

describe('buildRelaunchSpec', () => {
    it('is claude --worktree --settings <json> with the settings as exactly ONE argv element', () => {
        const settings = {env: {FACTORY_AUTONOMOUS_MODE: '1'}, permissions: {allow: ['Bash(*)']}}
        const spec = buildRelaunchSpec(settings)
        expect(spec.executable).toBe('claude')
        expect(spec.argv).toHaveLength(3)
        expect(spec.argv[0]).toBe('--worktree')
        expect(spec.argv[1]).toBe('--settings')
        expect(JSON.parse(at([...spec.argv], 2))).toEqual(settings)
        // No permission-mode flag of any kind (spike gate: inline-settings fallback branch).
        expect(spec.argv.join(' ')).not.toContain('--permission-mode')
    })
})

describe('runAutonomyEnsure', () => {
    let dataDir: string
    let pluginRoot: string
    const out: string[] = []

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'factory-autonomy-data-'))
        pluginRoot = await mkdtemp(join(tmpdir(), 'factory-autonomy-root-'))
        await mkdir(join(pluginRoot, 'templates'), {recursive: true})
        await writeFile(join(pluginRoot, 'templates', 'settings.autonomous.json'), TEMPLATE, 'utf8')
        out.length = 0
    })

    afterEach(async () => {
        await rm(dataDir, {recursive: true, force: true})
        await rm(pluginRoot, {recursive: true, force: true})
    })

    /** The settings JSON carried as the one --settings argv element. */
    const settingsOf = (spec: RelaunchSpec): Record<string, unknown> =>
        JSON.parse(at([...spec.argv], 2)) as Record<string, unknown>

    it('builds the settings in memory, writes NOTHING to disk, and prints the inline relaunch command', async () => {
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath: join(pluginRoot, 'no-such-user-settings.json'), // missing → {}
            home: HOME,
            writeStdout: (t) => out.push(t),
        })

        // Nothing lands in the data dir (the merged-settings.json artifact is gone).
        expect(await readdir(dataDir)).toEqual([])

        // The one --settings argv element is the fully substituted settings object.
        const settings = settingsOf(result.spec)
        expect(JSON.stringify(settings)).not.toContain('${CLAUDE_PLUGIN')
        expect((settings.env as Record<string, string>).CLAUDE_PLUGIN_DATA).toBe(dataDir)
        expect((settings.statusLine as {command: string}).command).toBe(`${pluginRoot}/bin/factory statusline`)

        // The rendered command is the renderer applied to the spec, verbatim, and
        // carries no permission-mode flag of any kind (Decision 67 amendment).
        expect(result.relaunchCommand).toBe(renderPosixCommand(result.spec))
        expect(result.relaunchCommand).not.toContain('--permission-mode')
        expect(out.join('')).toContain(result.relaunchCommand)
    })

    it('the printed command survives a real shell: argv round-trips with the settings intact', async () => {
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath: join(pluginRoot, 'no-such-user-settings.json'),
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        // Re-render with a probe executable so the real shell hands us back the argv.
        const probe: RelaunchSpec = {
            executable: process.execPath,
            argv: ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', '--', ...result.spec.argv],
        }
        const stdout = execFileSync('sh', ['-c', renderPosixCommand(probe)], {encoding: 'utf8'})
        const roundTripped = JSON.parse(stdout) as string[]
        // node consumes its own `--` end-of-options marker: what's left is the spec argv
        expect(roundTripped).toEqual([...result.spec.argv])
        expect(JSON.parse(at(roundTripped, 2))).toEqual(settingsOf(result.spec))
    })

    it("reads the user's settings.json when present and chains its statusLine", async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, JSON.stringify({statusLine: {command: '~/mine.sh'}, model: 'opus'}), 'utf8')
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath,
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        const settings = settingsOf(result.spec)
        expect(settings.model).toBeUndefined() // only the statusLine crosses — not other user keys
        expect((settings.env as Record<string, string>).FACTORY_ORIGINAL_STATUSLINE).toBe(`${HOME}/mine.sh`)
    })

    it("SECURITY: the printed command and spec never carry the user's env/apiKeyHelper/other settings keys", async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        // Non-realistic placeholder values (never a real-shaped secret vector) —
        // the repo's commit-time secret scanner blocks realistic ones.
        await writeFile(
            userSettingsPath,
            JSON.stringify({
                env: {ANTHROPIC_API_KEY: 'user-secret-value-marker', AWS_SECRET_ACCESS_KEY: 'another-secret-marker'},
                apiKeyHelper: 'echo user-secret-value-marker',
                model: 'opus',
            }),
            'utf8'
        )
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath,
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(result.relaunchCommand).not.toContain('user-secret-value-marker')
        expect(result.relaunchCommand).not.toContain('another-secret-marker')
        expect(result.relaunchCommand).not.toContain('apiKeyHelper')
        expect(JSON.stringify(result.spec)).not.toContain('user-secret-value-marker')
        const settings = settingsOf(result.spec)
        expect(settings.model).toBeUndefined()
        expect(settings.apiKeyHelper).toBeUndefined()
        // The legitimate payload still comes through.
        expect(result.relaunchCommand).toContain('FACTORY_AUTONOMOUS_MODE')
        expect((settings.env as Record<string, string>).CLAUDE_PLUGIN_DATA).toBe(dataDir)
    })

    it("degrades to an empty base (no throw) when the user's settings.json is unparseable", async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, '{ this is : not json', 'utf8')
        const result = await runAutonomyEnsure({
            dataDir,
            pluginRoot,
            userSettingsPath,
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        const settings = settingsOf(result.spec)
        expect((settings.env as Record<string, string>).CLAUDE_PLUGIN_DATA).toBe(dataDir)
        expect((settings.env as Record<string, string>).FACTORY_ORIGINAL_STATUSLINE).toBeUndefined()
    })
})

describe('runAutonomyStatus', () => {
    const out: string[] = []

    beforeEach(() => {
        out.length = 0
    })

    it('exits OK and reports autonomous when FACTORY_AUTONOMOUS_MODE=1', async () => {
        const code = await runAutonomyStatus({
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        expect(out.join('')).toContain('autonomous: yes')
    })

    it('exits ERROR and points at `factory autonomy ensure` when the var is unset', async () => {
        const code = await runAutonomyStatus({
            env: {},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        const printed = out.join('')
        expect(printed).toContain('autonomous: NO')
        expect(printed).toContain('factory autonomy ensure')
    })

    it("exits ERROR for any non-'1' value (no bypass)", async () => {
        const code = await runAutonomyStatus({
            env: {FACTORY_AUTONOMOUS_MODE: 'true'},
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
    })

    it('--json emits exactly {autonomous, envSet} — the merged-settings fields are GONE (v1.47 breaking)', async () => {
        await runAutonomyStatus({
            env: {FACTORY_AUTONOMOUS_MODE: '0'},
            json: true,
            writeStdout: (t) => out.push(t),
        })
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed).toEqual({autonomous: false, envSet: true}) // present but "0"
    })

    it('--json reports envSet:false when the var is entirely absent', async () => {
        await runAutonomyStatus({env: {}, json: true, writeStdout: (t) => out.push(t)})
        const parsed = JSON.parse(out.join('')) as AutonomyStatus
        expect(parsed.envSet).toBe(false)
    })
})

describe('runAutonomyPreflight', () => {
    let dataDir: string
    let pluginRoot: string
    const out: string[] = []

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

    it('exits OK when autonomous — no settings involved, nothing touched (CI raw-env path included)', async () => {
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.OK)
        expect(await readdir(dataDir)).toEqual([])
        expect(out.join('')).toContain('OK:')
    })

    it('prints the inline relaunch command + HALT and exits ERROR when not autonomous', async () => {
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        const printed = out.join('')
        expect(printed).toContain('HALT:')
        expect(printed).toContain(`'claude' '--worktree' '--settings'`)
        // Still nothing on disk — the relaunch is inline.
        expect(await readdir(dataDir)).toEqual([])
    })

    it('passes --user-settings through to the built settings (chains the statusLine)', async () => {
        const userSettingsPath = join(pluginRoot, 'user-settings.json')
        await writeFile(userSettingsPath, JSON.stringify({statusLine: {command: '~/mine.sh'}}), 'utf8')
        const result = await evaluateAutonomyPreflight({
            dataDir,
            pluginRoot,
            userSettingsPath,
            env: {},
            home: HOME,
        })
        expect(result.state).toBe('relaunch')
        if (result.state === 'relaunch') {
            const settings = JSON.parse(at([...result.spec.argv], 2)) as {env: Record<string, string>}
            expect(settings.env.FACTORY_ORIGINAL_STATUSLINE).toBe(`${HOME}/mine.sh`)
        }
    })

    it('evaluateAutonomyPreflight is the two-state contract: ready when autonomous', async () => {
        const result = await evaluateAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {FACTORY_AUTONOMOUS_MODE: '1'},
            home: HOME,
        })
        expect(result).toEqual({state: 'ready'})
    })

    it('degrades to a halt-with-message (never throws) when the relaunch cannot be built', async () => {
        await rm(join(pluginRoot, 'templates'), {recursive: true, force: true})
        const code = await runAutonomyPreflight({
            dataDir,
            pluginRoot,
            env: {},
            home: HOME,
            writeStdout: (t) => out.push(t),
        })
        expect(code).toBe(EXIT.ERROR)
        expect(out.join('')).toContain('HALT:')
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
