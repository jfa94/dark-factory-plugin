import {defineConfig, devices} from '@playwright/test'

/**
 * Seeded by `factory scaffold` (Decision 39) — then PROJECT-OWNED (never
 * auto-overwritten; delete + re-scaffold to pick up a template update).
 *
 * `testDir` MUST stay "e2e" — the engine's fixed e2e directory —
 * persistence in that directory IS the criticality signal for the run-level
 * e2e phase: nothing is tagged, so this directory boundary is load-bearing.
 *
 * The `webServer.command`/`url` fallbacks below are scaffold placeholders: the
 * run-start e2e ASSESSMENT (Decision 40) resolves this repo's real dev/start
 * command + base URL and writes them in on the first `--e2e` run. You can also
 * set them yourself, or override per-repo via `factory configure --set
 * e2e.startCommand=<cmd> --set e2e.baseURL=<url>` (config overrides win). The
 * run-level e2e phase passes `FACTORY_E2E_*` env vars into every Playwright
 * invocation, and `webServer` below reads them, so both the factory's
 * mechanical runs AND a plain local/CI `playwright test` boot the app the
 * same way.
 */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    // Retries classify a fail-then-pass-on-retry spec as FLAKY, distinct from a
    // real failure — the factory's e2e phase never reopens a task on a flaky
    // spec (Decision 39), only on one that fails every attempt.
    retries: process.env.CI ? 2 : 0,
    reporter: [['html', {open: 'never'}], ['list']],
    use: {
        baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
        trace: 'retain-on-failure',
    },
    projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
    webServer: {
        command: process.env.FACTORY_E2E_START_COMMAND ?? 'npm run dev', // placeholder — the e2e assessment writes the real command
        url: process.env.BASE_URL ?? 'http://localhost:3000',
        // FACTORY_E2E=1 marks a factory-driven run (fail-first proof, mechanical
        // suite) — always boot fresh there; a plain local/CI run may reuse.
        reuseExistingServer: process.env.FACTORY_E2E ? false : !process.env.CI,
        timeout: Number(process.env.FACTORY_E2E_READY_TIMEOUT_MS) || 30_000,
    },
})
