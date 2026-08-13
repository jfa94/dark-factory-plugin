import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {mkdtempSync, rmSync, writeFileSync, mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {loadConfig, resolveDataDir, configPath, __resetDataDirWarnings} from './load.js'

let home: string
beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'factory-home-'))
    // Reset the once-per-process redirect-warn guard so each test starts clean
    // (vitest runs the whole file in ONE process — without this the Set leaks).
    __resetDataDirWarnings()
})
afterEach(() => {
    rmSync(home, {recursive: true, force: true})
})

describe('resolveDataDir', () => {
    it('honors an explicit dataDir override verbatim (resolved)', () => {
        expect(resolveDataDir({dataDir: '/tmp/explicit'})).toBe('/tmp/explicit')
    })

    it('uses CLAUDE_PLUGIN_DATA when set and not a foreign-plugin leak', () => {
        const dd = join(home, '.claude', 'plugins', 'data', 'factory-mymarket')
        const out = resolveDataDir({env: {CLAUDE_PLUGIN_DATA: dd}, home})
        expect(out).toBe(dd)
    })

    it('throws loudly when CLAUDE_PLUGIN_DATA is unset and no override', () => {
        expect(() => resolveDataDir({env: {}, home})).toThrow(/CLAUDE_PLUGIN_DATA must be set/)
    })

    it('leaves a non-data-root custom path untouched', () => {
        const custom = '/some/custom/path'
        expect(resolveDataDir({env: {CLAUDE_PLUGIN_DATA: custom}, home})).toBe(custom)
    })

    it('canonicalizes a foreign-plugin leak via the cache layout', () => {
        // Simulate: pluginRoot is the cache <version> dir, current points at a
        // FOREIGN data dir under ~/.claude/plugins/data/.
        const pluginRoot = join(home, '.claude', 'plugins', 'cache', 'jfa94', 'factory', '0.10.5')
        mkdirSync(pluginRoot, {recursive: true})
        const foreign = join(home, '.claude', 'plugins', 'data', 'codex-openai-codex')
        const out = resolveDataDir({
            env: {CLAUDE_PLUGIN_DATA: foreign},
            home,
            pluginRoot,
        })
        // Expected: <data>/<plugin>-<marketplace> = factory-jfa94
        expect(out).toBe(join(home, '.claude', 'plugins', 'data', 'factory-jfa94'))
    })

    it('does NOT rewrite a path already under our own basename', () => {
        const pluginRoot = join(home, '.claude', 'plugins', 'cache', 'jfa94', 'factory', '0.10.5')
        mkdirSync(pluginRoot, {recursive: true})
        const ours = join(home, '.claude', 'plugins', 'data', 'factory-jfa94')
        expect(resolveDataDir({env: {CLAUDE_PLUGIN_DATA: ours}, home, pluginRoot})).toBe(ours)
    })

    describe('foreign-plugin redirect warn (once-per-process)', () => {
        function cacheRoot() {
            const pluginRoot = join(home, '.claude', 'plugins', 'cache', 'jfa94', 'factory', '0.10.5')
            mkdirSync(pluginRoot, {recursive: true})
            return pluginRoot
        }
        const foreign = (h: string) => join(h, '.claude', 'plugins', 'data', 'codex-openai-codex')
        const corrected = (h: string) => join(h, '.claude', 'plugins', 'data', 'factory-jfa94')

        it('warns EXACTLY ONCE across repeated calls with the same foreign env', () => {
            const pluginRoot = cacheRoot()
            const warn = vi.fn()
            const env = {CLAUDE_PLUGIN_DATA: foreign(home)}
            for (let i = 0; i < 5; i++) {
                const out = resolveDataDir({env, home, pluginRoot, warn})
                // Behavior preserved: corrected path returned on EVERY call.
                expect(out).toBe(corrected(home))
            }
            expect(warn).toHaveBeenCalledTimes(1)
        })

        it('warns again for a genuinely DIFFERENT foreign→corrected pair (keyed, not blanket one-shot)', () => {
            const pluginRoot = cacheRoot()
            const warn = vi.fn()
            // First leak (codex).
            resolveDataDir({env: {CLAUDE_PLUGIN_DATA: foreign(home)}, home, pluginRoot, warn})
            // A DIFFERENT foreign source dir → distinct (current → corrected) key.
            const otherForeign = join(home, '.claude', 'plugins', 'data', 'supabase-supabase')
            resolveDataDir({env: {CLAUDE_PLUGIN_DATA: otherForeign}, home, pluginRoot, warn})
            expect(warn).toHaveBeenCalledTimes(2)
        })

        it('default sink: a successful auto-redirect logs at DEBUG, never WARN (self-correcting, Fix 8)', () => {
            const pluginRoot = cacheRoot()
            const writes: string[] = []
            const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
                writes.push(String(chunk))
                return true
            })
            const prev = process.env.FACTORY_LOG_LEVEL
            process.env.FACTORY_LOG_LEVEL = 'debug'
            try {
                // No injected warn → the module's default logger sink decides the level.
                resolveDataDir({env: {CLAUDE_PLUGIN_DATA: foreign(home)}, home, pluginRoot})
                const line = writes.find((w) => w.includes('auto-redirected'))
                expect(line).toBeDefined()
                expect(line).toContain('[DEBUG]')
                expect(line).not.toContain('[WARN]')
            } finally {
                spy.mockRestore()
                if (prev === undefined) {
                    Reflect.deleteProperty(process.env, 'FACTORY_LOG_LEVEL')
                } else {
                    process.env.FACTORY_LOG_LEVEL = prev
                }
            }
        })

        it('emits an ACTIONABLE message naming the corrected dir + the permanent fix', () => {
            const pluginRoot = cacheRoot()
            const warn = vi.fn()
            resolveDataDir({env: {CLAUDE_PLUGIN_DATA: foreign(home)}, home, pluginRoot, warn})
            const msg = warn.mock.calls[0]?.[0] as string
            expect(msg).toContain(foreign(home)) // the offending dir
            expect(msg).toContain(corrected(home)) // the canonical dir it redirected to
            expect(msg).toContain('CLAUDE_PLUGIN_DATA')
            expect(msg).toMatch(/another plugin/i) // explains the cause
            expect(msg).toMatch(/no action/i) // reassures it's benign
            expect(msg).toMatch(/factory-<your-marketplace-id>|factory-jfa94/) // permanent-fix pointer
        })

        it('never warns when the dir is already canonical (no redirect)', () => {
            const pluginRoot = cacheRoot()
            const warn = vi.fn()
            const ours = corrected(home)
            resolveDataDir({env: {CLAUDE_PLUGIN_DATA: ours}, home, pluginRoot, warn})
            expect(warn).not.toHaveBeenCalled()
        })

        it('never warns (and throws) when CLAUDE_PLUGIN_DATA is unset', () => {
            const warn = vi.fn()
            expect(() => resolveDataDir({env: {}, home, warn})).toThrow(/CLAUDE_PLUGIN_DATA must be set/)
            expect(warn).not.toHaveBeenCalled()
        })

        it('WARNS (not swallows) when the dev-checkout marketplace.json is unparseable', () => {
            // Dev-checkout layout (pluginRoot NOT under the cache root) with a foreign
            // CLAUDE_PLUGIN_DATA leak: canonicalization must read marketplace.json. An
            // unparseable one previously swallowed the error silently, masking the leak.
            const pluginRoot = mkdtempSync(join(tmpdir(), 'factory-devroot-'))
            try {
                mkdirSync(join(pluginRoot, '.claude-plugin'), {recursive: true})
                writeFileSync(join(pluginRoot, '.claude-plugin', 'marketplace.json'), '{ not json')
                const foreignDir = join(home, '.claude', 'plugins', 'data', 'codex-openai-codex')
                const warn = vi.fn()
                resolveDataDir({env: {CLAUDE_PLUGIN_DATA: foreignDir}, home, pluginRoot, warn})
                expect(warn).toHaveBeenCalledTimes(1)
                const msg = warn.mock.calls[0]?.[0] as string
                expect(msg).toContain('marketplace.json')
                expect(msg).toContain('CLAUDE_PLUGIN_DATA')
            } finally {
                rmSync(pluginRoot, {recursive: true, force: true})
            }
        })
    })
})

describe('loadConfig', () => {
    it('returns all defaults when config.json is absent', () => {
        const dd = join(home, 'data')
        const cfg = loadConfig({dataDir: dd})
        expect(cfg.quota.hourlyThresholds).toEqual([20, 40, 60, 80, 90])
    })

    it('merges a present config.json over defaults', () => {
        const dd = join(home, 'data')
        mkdirSync(dd, {recursive: true})
        writeFileSync(configPath(dd), JSON.stringify({stallTtlMinutes: 45}))
        const cfg = loadConfig({dataDir: dd})
        expect(cfg.stallTtlMinutes).toBe(45)
        expect(cfg.quality.holdoutPercent).toBe(20) // untouched default
    })

    it('throws LOUDLY on a corrupt config.json (no silent default)', () => {
        const dd = join(home, 'data')
        mkdirSync(dd, {recursive: true})
        writeFileSync(configPath(dd), '{ this is not json')
        expect(() => loadConfig({dataDir: dd})).toThrow()
    })

    it('throws on a schema-invalid config.json', () => {
        const dd = join(home, 'data')
        mkdirSync(dd, {recursive: true})
        writeFileSync(configPath(dd), JSON.stringify({stallTtlMinutes: -5}))
        expect(() => loadConfig({dataDir: dd})).toThrow()
    })

    it('warns ONCE per retired key present in the raw overlay, still loads (Zod strips them)', () => {
        __resetDataDirWarnings()
        const dd = join(home, 'data')
        mkdirSync(dd, {recursive: true})
        writeFileSync(
            configPath(dd),
            JSON.stringify({git: {stagingBranch: 'custom'}, e2e: {testDir: 'tests'}, stallTtlMinutes: 45})
        )
        const warned: string[] = []
        const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
            warned.push(String(chunk))
            return true
        })
        try {
            const cfg = loadConfig({dataDir: dd})
            expect(cfg.stallTtlMinutes).toBe(45)
            expect('stagingBranch' in cfg.git).toBe(false)
            expect('testDir' in cfg.e2e).toBe(false)
            loadConfig({dataDir: dd}) // second load: no duplicate warnings
            const text = warned.join('')
            // One warn line per retired key (each line names the key twice: message + --unset hint).
            expect(text.match(/is retired and ignored/g)?.length).toBe(2)
            expect(text).toContain('git.stagingBranch')
            expect(text).toContain('e2e.testDir')
        } finally {
            spy.mockRestore()
        }
    })
})
