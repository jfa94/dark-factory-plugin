import {describe, it, expect} from 'vitest'
import {ConfigSchema, defaultConfig} from './schema.js'

describe('ConfigSchema', () => {
    it('an empty object parses to a fully-defaulted config', () => {
        const cfg = ConfigSchema.parse({})
        // Quality defaults (from the bash gate scripts).
        expect(cfg.quality.holdoutPercent).toBe(20)
        expect(cfg.quality.holdoutPassRate).toBe(80)
        expect(cfg.quality.mutationScoreTarget).toBe(80)
        expect(cfg.quality.coverageRegressionTolerancePct).toBe(0.5)
        expect(cfg.quality.securityRedactFindings).toBe(true)
        // Quota defaults.
        expect(cfg.quota.hourlyThresholds).toEqual([20, 40, 60, 80, 90])
        expect(cfg.quota.dailyThresholds).toEqual([20, 40, 60, 80, 95, 95, 95])
        // Top-level.
        expect(cfg.maxConsecutiveFailures).toBe(3)
        expect(cfg.maxParallelTasks).toBe(3)
        // A6: rollup CI wait budget (minutes) — sized above a cold-cache mutation run.
        expect(cfg.git.rollupCiWaitMinutes).toBe(30)
    })

    it('git.rollupCiWaitMinutes accepts a positive int, rejects zero/negative/fractional', () => {
        expect(ConfigSchema.parse({git: {rollupCiWaitMinutes: 45}}).git.rollupCiWaitMinutes).toBe(45)
        expect(() => ConfigSchema.parse({git: {rollupCiWaitMinutes: 0}})).toThrow()
        expect(() => ConfigSchema.parse({git: {rollupCiWaitMinutes: -5}})).toThrow()
        expect(() => ConfigSchema.parse({git: {rollupCiWaitMinutes: 1.5}})).toThrow()
    })

    it('stale overlay keys (pruned config fields) are stripped, not fatal', () => {
        // Regression guard: an on-disk config written by an older plugin version may
        // still carry pruned keys; ConfigSchema must strip them and keep loading.
        const cfg = ConfigSchema.parse({
            maxRuntimeMinutes: 480,
            quota: {maxStaleCycles: 6},
            e2e: {enabled: true},
            spec: {specModel: 'opus', specEffort: 'max'},
            quality: {redTestCommand: 'go test ./...'},
        })
        expect(cfg).toEqual(defaultConfig())
    })

    it('defaultConfig() equals parsing {}', () => {
        expect(defaultConfig()).toEqual(ConfigSchema.parse({}))
    })

    it('review.requireCrossVendor defaults to warn, accepts block, rejects anything else (S5/C)', () => {
        expect(ConfigSchema.parse({}).review.requireCrossVendor).toBe('warn')
        expect(ConfigSchema.parse({review: {requireCrossVendor: 'block'}}).review.requireCrossVendor).toBe('block')
        expect(() => ConfigSchema.parse({review: {requireCrossVendor: 'off'}})).toThrow()
    })

    it('git.developProtection defaults to run-scoped, accepts permanent, rejects anything else (D74)', () => {
        expect(ConfigSchema.parse({}).git.developProtection).toBe('run-scoped')
        expect(ConfigSchema.parse({git: {developProtection: 'permanent'}}).git.developProtection).toBe('permanent')
        expect(() => ConfigSchema.parse({git: {developProtection: 'off'}})).toThrow()
    })

    it('git.developBaselineStatusChecks derives from developRequiredStatusChecks minus Mutation Testing (D74)', () => {
        // Default run profile → derived baseline Quality + Security Scan.
        expect(ConfigSchema.parse({}).git.developBaselineStatusChecks).toEqual(['Quality', 'Security Scan'])
        // A custom run-profile context (e.g. a repo's pgTAP check) carries into the baseline.
        const custom = ConfigSchema.parse({
            git: {developRequiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan', 'Database Tests']},
        })
        expect(custom.git.developBaselineStatusChecks).toEqual(['Quality', 'Security Scan', 'Database Tests'])
        // An explicit value (including []) overrides the derivation.
        expect(ConfigSchema.parse({git: {developBaselineStatusChecks: []}}).git.developBaselineStatusChecks).toEqual([])
        const explicit = ConfigSchema.parse({
            git: {
                developRequiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan', 'Database Tests'],
                developBaselineStatusChecks: ['Quality'],
            },
        })
        expect(explicit.git.developBaselineStatusChecks).toEqual(['Quality'])
    })

    it('quality.setupCommand is optional and round-trips when set', () => {
        expect(ConfigSchema.parse({}).quality.setupCommand).toBeUndefined()
        const cfg = ConfigSchema.parse({quality: {setupCommand: 'pnpm install --frozen-lockfile'}})
        expect(cfg.quality.setupCommand).toBe('pnpm install --frozen-lockfile')
    })

    it('quality.gateEnv defaults to {} and round-trips a string map', () => {
        expect(ConfigSchema.parse({}).quality.gateEnv).toEqual({})
        const cfg = ConfigSchema.parse({
            quality: {
                gateEnv: {
                    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
                    NEXT_PUBLIC_SUPABASE_KEY: 'ci-placeholder',
                },
            },
        })
        expect(cfg.quality.gateEnv).toEqual({
            NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
            NEXT_PUBLIC_SUPABASE_KEY: 'ci-placeholder',
        })
    })

    it('quality.gateEnv rejects a non-string value (loud, not silently coerced)', () => {
        expect(() => ConfigSchema.parse({quality: {gateEnv: {PORT: 54321}}})).toThrow()
    })

    it('quality.gateEnv rejects a non-POSIX key name (the --set boundary guard)', () => {
        expect(() => ConfigSchema.parse({quality: {gateEnv: {'bad-key': 'x'}}})).toThrow()
        expect(() => ConfigSchema.parse({quality: {gateEnv: {'foo.bar': 'x'}}})).toThrow()
        // A valid POSIX name still round-trips.
        expect(ConfigSchema.parse({quality: {gateEnv: {OK_NAME: 'x'}}}).quality.gateEnv).toEqual({
            OK_NAME: 'x',
        })
    })

    it('merges partial overrides while defaulting the rest', () => {
        const cfg = ConfigSchema.parse({quality: {holdoutPercent: 35}})
        expect(cfg.quality.holdoutPercent).toBe(35)
        // sibling keys still default
        expect(cfg.quality.holdoutPassRate).toBe(80)
        // other blocks still default
        expect(cfg.quota.hourlyThresholds).toEqual([20, 40, 60, 80, 90])
    })

    it('rejects out-of-range values (loud, not silent)', () => {
        expect(() => ConfigSchema.parse({quality: {holdoutPercent: 150}})).toThrow()
        expect(() => ConfigSchema.parse({stallTtlMinutes: -1})).toThrow()
        expect(() => ConfigSchema.parse({hungSpawnMinutes: 0})).toThrow()
        expect(() => ConfigSchema.parse({hungSpawnMinutes: -1})).toThrow()
        // maxParallelTasks: min 1 (N4) — 0 and negatives reject.
        expect(() => ConfigSchema.parse({maxParallelTasks: 0})).toThrow()
        expect(() => ConfigSchema.parse({maxParallelTasks: -1})).toThrow()
    })

    it('defaults the two-band stall clocks (Decision 66)', () => {
        const cfg = ConfigSchema.parse({})
        expect(cfg.stallTtlMinutes).toBe(15)
        expect(cfg.hungSpawnMinutes).toBe(120)
    })

    it('rejects hungSpawnMinutes ≤ stallTtlMinutes (the hard tier must sit above the advisory band)', () => {
        expect(() => ConfigSchema.parse({hungSpawnMinutes: 10})).toThrow() // under the 15 default
        expect(() => ConfigSchema.parse({stallTtlMinutes: 200})).toThrow() // over the 120 default
        expect(() => ConfigSchema.parse({stallTtlMinutes: 60, hungSpawnMinutes: 60})).toThrow() // equal
        const cfg = ConfigSchema.parse({stallTtlMinutes: 30, hungSpawnMinutes: 60})
        expect(cfg.stallTtlMinutes).toBe(30)
        expect(cfg.hungSpawnMinutes).toBe(60)
    })

    it('rejects a wrong-length threshold curve', () => {
        expect(() => ConfigSchema.parse({quota: {hourlyThresholds: [1, 2, 3]}})).toThrow()
    })

    it('rejects out-of-range threshold elements (percent caps: 0..100)', () => {
        expect(() => ConfigSchema.parse({quota: {hourlyThresholds: [20, 40, 60, 80, 101]}})).toThrow()
        expect(() => ConfigSchema.parse({quota: {dailyThresholds: [-1, 40, 60, 80, 95, 95, 95]}})).toThrow()
    })

    it('rejects a decreasing threshold curve (utilization caps never step down)', () => {
        expect(() => ConfigSchema.parse({quota: {hourlyThresholds: [20, 40, 30, 80, 90]}})).toThrow(/non-decreasing/)
        expect(() => ConfigSchema.parse({quota: {dailyThresholds: [20, 40, 60, 80, 95, 95, 90]}})).toThrow(
            /non-decreasing/
        )
        // A plateau (equal neighbours) is fine — the default daily curve has one.
        expect(ConfigSchema.parse({quota: {hourlyThresholds: [20, 20, 60, 80, 90]}}).quota.hourlyThresholds).toEqual([
            20, 20, 60, 80, 90,
        ])
    })

    it('does NOT carry forward retired human-gate keys', () => {
        const cfg = ConfigSchema.parse({})
        expect('humanReviewLevel' in cfg).toBe(false)
        // Zod strips unknown keys by default, so an injected retired key is dropped.
        const injected = ConfigSchema.parse({humanReviewLevel: 2})
        expect('humanReviewLevel' in injected).toBe(false)
    })

    describe('e2e (Decision 39 — Playwright config)', () => {
        it('defaults readyTimeoutMs, reopenCap; leaves startCommand/baseURL unset', () => {
            const cfg = ConfigSchema.parse({})
            expect(cfg.e2e.readyTimeoutMs).toBe(30_000)
            expect(cfg.e2e.reopenCap).toBe(2)
            expect(cfg.e2e.startCommand).toBeUndefined()
            expect(cfg.e2e.baseURL).toBeUndefined()
        })

        it('round-trips a fully-configured e2e block', () => {
            const cfg = ConfigSchema.parse({
                e2e: {
                    startCommand: 'npm run dev',
                    baseURL: 'http://localhost:3000',
                    readyTimeoutMs: 60_000,
                    reopenCap: 1,
                },
            })
            expect(cfg.e2e).toEqual({
                startCommand: 'npm run dev',
                baseURL: 'http://localhost:3000',
                readyTimeoutMs: 60_000,
                reopenCap: 1,
            })
        })

        it('merges a partial e2e override while defaulting siblings', () => {
            const cfg = ConfigSchema.parse({e2e: {startCommand: 'npm start'}})
            expect(cfg.e2e.startCommand).toBe('npm start')
            expect(cfg.e2e.reopenCap).toBe(2)
        })

        it('rejects a negative reopenCap (loud, not silent); a retired testDir key is stripped', () => {
            expect(() => ConfigSchema.parse({e2e: {reopenCap: -1}})).toThrow()
            expect('testDir' in ConfigSchema.parse({e2e: {testDir: 'other'}}).e2e).toBe(false)
        })

        it('rejects a non-URL baseURL (loud, not silent)', () => {
            expect(() => ConfigSchema.parse({e2e: {baseURL: 'not-a-url'}})).toThrow()
        })

        it('reopenCap accepts 0 (no reopen budget, still schema-valid)', () => {
            expect(ConfigSchema.parse({e2e: {reopenCap: 0}}).e2e.reopenCap).toBe(0)
        })
    })
})
