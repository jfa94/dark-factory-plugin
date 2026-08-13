/**
 * Unit tests for `factory configure`. Each test gets an isolated temp data dir via
 * $CLAUDE_PLUGIN_DATA so the config writer/reader round-trips on real disk without
 * touching the host's config.
 */
import {describe, it, expect, beforeEach, afterEach, vi} from 'vitest'
import {mkdtemp, rm, readFile} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {configureCommand} from './configure.js'
import {EXIT} from '../../shared/exit-codes.js'
import type {Config} from '../../config/index.js'

let dataDir: string
let prevEnv: string | undefined
let stdout: string[]
let stderr: string[]

beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'factory-configure-'))
    prevEnv = process.env.CLAUDE_PLUGIN_DATA
    process.env.CLAUDE_PLUGIN_DATA = dataDir
    stdout = []
    stderr = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
        stdout.push(String(c))
        return true
    })
    vi.spyOn(process.stderr, 'write').mockImplementation((c: unknown) => {
        stderr.push(String(c))
        return true
    })
})

afterEach(async () => {
    vi.restoreAllMocks()
    if (prevEnv === undefined) {
        delete process.env.CLAUDE_PLUGIN_DATA
    } else {
        process.env.CLAUDE_PLUGIN_DATA = prevEnv
    }
    await rm(dataDir, {recursive: true, force: true})
})

const out = (): Config => JSON.parse(stdout.join('')) as Config

describe('factory configure', () => {
    it('prints the resolved config (all defaults) when no overlay exists', async () => {
        const code = await configureCommand.run([])
        expect(code).toBe(EXIT.OK)
        const cfg = out()
        expect(cfg).toHaveProperty('quality.holdoutPercent')
        expect(cfg).toHaveProperty('quota.hourlyThresholds')
        expect(existsSync(join(dataDir, 'config.json'))).toBe(false) // read-only path wrote nothing
    })

    it('--set persists a SPARSE overlay (only the edited key) and echoes the resolved config', async () => {
        const code = await configureCommand.run(['--set', 'quality.holdoutPercent=25'])
        expect(code).toBe(EXIT.OK)
        expect(out().quality.holdoutPercent).toBe(25)

        // On-disk overlay is sparse: it contains ONLY the edited path, not all defaults.
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as Record<string, unknown>
        expect(overlay).toEqual({quality: {holdoutPercent: 25}})
    })

    it('--set developRequiredStatusChecks shifts the DERIVED baseline without persisting it (D74)', async () => {
        const code = await configureCommand.run([
            '--set',
            'git.developRequiredStatusChecks=["Quality","Mutation Testing","Security Scan","Database Tests"]',
        ])
        expect(code).toBe(EXIT.OK)
        // Echoed resolved config: baseline derives run profile minus 'Mutation Testing'.
        expect(out().git.developBaselineStatusChecks).toEqual(['Quality', 'Security Scan', 'Database Tests'])
        // The derived value is NOT frozen to disk — only the edited key persists.
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as Record<string, unknown>
        expect(overlay).toEqual({
            git: {developRequiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan', 'Database Tests']},
        })
    })

    it('coerces JSON scalar types (number/boolean) and falls back to string', async () => {
        await configureCommand.run(['--set', 'git.baseBranch=develop'])
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as {
            git: {baseBranch: unknown}
        }
        expect(overlay.git.baseBranch).toBe('develop') // bare string
    })

    it('--set creates a nested gateEnv record leaf and round-trips it', async () => {
        const code = await configureCommand.run([
            '--set',
            'quality.gateEnv.NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321',
            '--set',
            'quality.gateEnv.NEXT_PUBLIC_SUPABASE_KEY=ci-placeholder',
        ])
        expect(code).toBe(EXIT.OK)
        expect(out().quality.gateEnv).toEqual({
            NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
            NEXT_PUBLIC_SUPABASE_KEY: 'ci-placeholder',
        })
        // Sparse overlay holds only the nested leaves.
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as Record<string, unknown>
        expect(overlay).toEqual({
            quality: {
                gateEnv: {
                    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
                    NEXT_PUBLIC_SUPABASE_KEY: 'ci-placeholder',
                },
            },
        })
    })

    it('--get prints a single resolved value', async () => {
        await configureCommand.run(['--set', 'maxConsecutiveFailures=7'])
        stdout.length = 0
        const code = await configureCommand.run(['--get', 'maxConsecutiveFailures'])
        expect(code).toBe(EXIT.OK)
        expect(JSON.parse(stdout.join(''))).toBe(7)
    })

    it('--unset reverts a key to its default and prunes the empty parent', async () => {
        await configureCommand.run(['--set', 'quality.holdoutPercent=25'])
        const defaultPct = (await import('../../config/index.js')).defaultConfig().quality.holdoutPercent

        stdout.length = 0
        const code = await configureCommand.run(['--unset', 'quality.holdoutPercent'])
        expect(code).toBe(EXIT.OK)
        expect(out().quality.holdoutPercent).toBe(defaultPct)
        // The now-empty `quality` overlay object is pruned.
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as Record<string, unknown>
        expect(overlay).toEqual({})
    })

    it('rejects an out-of-schema value LOUDLY without persisting it', async () => {
        // holdoutPercent must be 0..100; 999 is a schema violation → throw (not USAGE).
        await expect(configureCommand.run(['--set', 'quality.holdoutPercent=999'])).rejects.toThrow()
        // Nothing persisted.
        expect(existsSync(join(dataDir, 'config.json'))).toBe(false)
    })

    it('multiple --set tokens apply in one atomic write', async () => {
        const code = await configureCommand.run([
            '--set',
            'quality.holdoutPercent=30',
            '--set',
            'maxConsecutiveFailures=5',
        ])
        expect(code).toBe(EXIT.OK)
        const overlay = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as Record<string, unknown>
        expect(overlay).toEqual({quality: {holdoutPercent: 30}, maxConsecutiveFailures: 5})
    })

    it('--get combined with --set is a USAGE error', async () => {
        const code = await configureCommand.run(['--get', 'quality', '--set', 'x=1'])
        expect(code).toBe(EXIT.USAGE)
        expect(stderr.join('')).toMatch(/cannot be combined/)
    })

    it('--get rejects an unknown config key', async () => {
        await expect(configureCommand.run(['--get', 'bogus.key'])).rejects.toThrow(/unknown config key/)
    })

    it('--get rejects traversing into a non-object leaf', async () => {
        await expect(configureCommand.run(['--get', 'quality.holdoutPercent.foo'])).rejects.toThrow(/not an object/)
    })

    it("--set rejects a malformed token with no '='", async () => {
        await expect(configureCommand.run(['--set', 'keyWithoutEquals'])).rejects.toThrow(/expects 'key.path=value'/)
        expect(existsSync(join(dataDir, 'config.json'))).toBe(false)
    })

    it('--set rejects an invalid key path (empty segment)', async () => {
        await expect(configureCommand.run(['--set', 'a..b=1'])).rejects.toThrow(/invalid key path/)
        expect(existsSync(join(dataDir, 'config.json'))).toBe(false)
    })

    it('--help returns OK', async () => {
        expect(await configureCommand.run(['--help'])).toBe(EXIT.OK)
        expect(stdout.join('')).toMatch(/factory configure/)
    })
})
