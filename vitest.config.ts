import {defineConfig} from 'vitest/config'

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
        environment: 'node',
        coverage: {
            provider: 'v8',
            // Ratchet thresholds: current full-suite results rounded DOWN to one
            // decimal (S12) — a floor against regression, not an aspiration.
            thresholds: {
                statements: 94.5,
                branches: 91.3,
                functions: 94.8,
                lines: 94.5,
            },
        },
    },
})
