/**
 * Build-staleness guard: the checked-in scaffold template
 * `templates/.github/scripts/shard-mutation-scope.mjs` is GENERATED from
 * `src/bin/shard-mutation-scope.ts` by scripts/build.mjs. This test re-bundles in
 * memory and asserts byte-equality with the committed artifact, so any drift
 * between the tested TS source and the shipped template fails CI (you forgot to
 * re-run `npm run build`).
 */
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

import {build, type BuildOptions} from 'esbuild'
import {describe, expect, it} from 'vitest'

import {diffScope, fullScope, isMutablePath, parseDiffToRanges} from './shard-mutation-scope.js'

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..')

// build.mjs is plain JS (run by node directly, never compiled) — import it
// dynamically with an explicit shape rather than a static untyped import.
async function loadBuildModule(): Promise<{
    SHARD_TEMPLATE: {entry: string; out: string}
    shardTemplateBuildOptions: () => BuildOptions
}> {
    // @ts-expect-error build.mjs is plain JS run by node directly — no .d.ts exists.
    return (await import('../../scripts/build.mjs')) as never
}

describe('shard-mutation-scope template', () => {
    it('checked-in template matches a fresh esbuild of the source', async () => {
        const {SHARD_TEMPLATE, shardTemplateBuildOptions} = await loadBuildModule()
        const result = await build({...shardTemplateBuildOptions(), write: false})
        const generated = result.outputFiles[0]?.text ?? ''
        const committed = readFileSync(resolve(repoRoot, SHARD_TEMPLATE.out), 'utf8')
        expect(generated).toBe(committed)
    })
})

const modified = (path: string, hunks: readonly string[]): string =>
    [
        `diff --git a/${path} b/${path}`,
        'index 1111111..2222222 100644',
        `--- a/${path}`,
        `+++ b/${path}`,
        ...hunks,
    ].join('\n')

const added = (path: string): string =>
    [
        `diff --git a/${path} b/${path}`,
        'new file mode 100644',
        'index 0000000..2222222',
        '--- /dev/null',
        `+++ b/${path}`,
        '@@ -0,0 +1,10 @@',
    ].join('\n')

describe('mutation scope computation', () => {
    it('covers empty diffs, added files, padded hunks, deletion seams, and merged ranges', () => {
        expect(parseDiffToRanges('')).toEqual([])
        expect(parseDiffToRanges(added('src/new.ts'))).toEqual(['src/new.ts'])
        expect(parseDiffToRanges(modified('src/a.ts', ['@@ -10,2 +10,3 @@']))).toEqual(['src/a.ts:8-14'])
        expect(parseDiffToRanges(modified('src/a.ts', ['@@ -20,4 +19,0 @@']))).toEqual(['src/a.ts:17-21'])
        expect(
            parseDiffToRanges(modified('src/a.ts', ['@@ -10,2 +10,2 @@', '@@ -14,1 +14,1 @@', '@@ -18,1 +19,1 @@']))
        ).toEqual(['src/a.ts:8-21'])
    })

    it.each([
        'src/a.test.ts',
        'src/a.spec.ts',
        'src/a.d.ts',
        'src/types/a.ts',
        'src/data/a.ts',
        'src/a/index.ts',
        'src/types.ts',
        'src/event-types.ts',
        'src/app/robots.ts',
        'src/app/sitemap.ts',
    ])('excludes zero-mutant surface %s', (path) => {
        expect(isMutablePath(path)).toBe(false)
        expect(parseDiffToRanges(added(path))).toEqual([])
    })

    it('shares roots, exclusions, and quarantine handling across diff/full modes', () => {
        const read = (path: string): string =>
            path === 'app/quarantined.ts' ? '// Stryker disable all: debt\n' : 'export const ok = true\n'
        const diffGit = (args: readonly string[]): string => {
            expect(args).toEqual([
                'diff',
                '-U0',
                '--diff-filter=AM',
                'origin/develop...HEAD',
                '--',
                'app/**/*.ts',
                'utils/**/*.ts',
            ])
            return [added('app/quarantined.ts'), added('utils/ok.ts')].join('\n')
        }
        expect(diffScope('origin/develop', ['app', 'utils'], diffGit, read)).toEqual(['utils/ok.ts'])

        const fullGit = (args: readonly string[]): string => {
            expect(args).toEqual(['ls-files', '--', 'app/**/*.ts', 'utils/**/*.ts'])
            return 'app/quarantined.ts\napp/types.ts\nutils/ok.ts\n'
        }
        expect(fullScope(['app', 'utils'], fullGit, read)).toEqual(['utils/ok.ts'])
    })
})
