import {describe, it, expect, vi, afterEach} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {dispatchHook, hookRegistry} from './main.js'
import {EXIT} from '../shared/exit-codes.js'

describe('hook dispatch', () => {
    afterEach(() => vi.restoreAllMocks())

    it('--help returns OK', async () => {
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
        expect(await dispatchHook(['--help'])).toBe(EXIT.OK)
        expect(await dispatchHook([])).toBe(EXIT.OK)
    })

    it('unknown hook returns USAGE (2) — fail-loud dispatch', async () => {
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        expect(await dispatchHook(['nope'])).toBe(EXIT.USAGE)
    })

    it('registry is an extensible seam (each guard registered by name → module)', async () => {
        // WS9 registers the real guards; the seam stays extensible.
        expect(Object.keys(hookRegistry).sort()).toEqual([
            'branch-protection',
            'holdout-guard',
            'pipeline-guards',
            'secret-guard',
            'session-start',
            'stop-gate',
            'subagent-stop',
            'write-protection',
        ])
        hookRegistry['__test-hook'] = {describe: 't', run: () => EXIT.OK}
        try {
            expect(await dispatchHook(['__test-hook'])).toBe(EXIT.OK)
        } finally {
            delete hookRegistry['__test-hook']
        }
    })
})

describe('hooks/hooks.json wiring', () => {
    // The SessionStart(compact) block was the "known gap": the handler was implemented,
    // bundled, and registered, but hooks.json (TCB-protected, hand-edited) never wired
    // it. This locks the wiring so it cannot silently regress.
    it('wires the session-start handler under SessionStart with the compact matcher', () => {
        const raw = readFileSync(join(process.cwd(), 'hooks', 'hooks.json'), 'utf8')
        const config = JSON.parse(raw) as {
            hooks: Record<string, {matcher?: string; hooks: {command: string}[]}[]>
        }
        const sessionStart = config.hooks.SessionStart
        expect(sessionStart).toBeDefined()
        const compact = sessionStart?.find((b) => b.matcher === 'compact')
        expect(compact?.hooks.some((h) => h.command.endsWith('factory-hook.js session-start'))).toBe(true)
    })

    it('every hooks.json command targets a registered hook name', () => {
        const raw = readFileSync(join(process.cwd(), 'hooks', 'hooks.json'), 'utf8')
        const config = JSON.parse(raw) as {
            hooks: Record<string, {hooks: {command: string}[]}[]>
        }
        const names = Object.values(config.hooks)
            .flat()
            .flatMap((b) => b.hooks)
            .map((h) => h.command.split('factory-hook.js ')[1])
        expect(names.length).toBeGreaterThan(0)
        for (const name of names) {
            expect(hookRegistry[name ?? '']).toBeDefined()
        }
    })
})
