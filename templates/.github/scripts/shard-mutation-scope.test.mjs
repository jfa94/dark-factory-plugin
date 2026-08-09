import assert from 'node:assert/strict'
import {describe, test} from 'node:test'

import {
  diffScope,
  fullScope,
  isMutablePath,
  parseDiffToRanges,
  parseFullFileList,
} from './shard-mutation-scope.mjs'

const modified = (path, hunks) =>
  [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, ...hunks].join('\n')

const added = (path) =>
  [`diff --git a/${path} b/${path}`, 'new file mode 100644', 'index 0000000..2222222', '--- /dev/null', `+++ b/${path}`, '@@ -0,0 +1,10 @@'].join('\n')

describe('managed mutation scope helper', () => {
  test('empty diff has no scope', () => {
    assert.deepEqual(parseDiffToRanges(''), [])
  })

  test('added files mutate in full', () => {
    assert.deepEqual(parseDiffToRanges(added('src/new.ts')), ['src/new.ts'])
  })

  test('modified hunks are padded by two lines', () => {
    assert.deepEqual(parseDiffToRanges(modified('src/a.ts', ['@@ -10,2 +10,3 @@'])), ['src/a.ts:8-14'])
  })

  test('pure deletions cover the current-tree seam', () => {
    assert.deepEqual(parseDiffToRanges(modified('src/a.ts', ['@@ -20,4 +19,0 @@'])), ['src/a.ts:17-21'])
  })

  test('overlapping and adjacent padded ranges merge', () => {
    const diff = modified('src/a.ts', [
      '@@ -10,2 +10,2 @@',
      '@@ -14,1 +14,1 @@',
      '@@ -18,1 +19,1 @@',
      '@@ -50,1 +52,1 @@',
    ])
    assert.deepEqual(parseDiffToRanges(diff), ['src/a.ts:8-21', 'src/a.ts:50-54'])
  })

  for (const path of [
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
  ]) {
    test(`shared exclusions drop ${path}`, () => {
      assert.equal(isMutablePath(path), false)
      assert.deepEqual(parseDiffToRanges(added(path)), [])
    })
  }

  test('quarantine markers are shared by diff and full modes', () => {
    const read = (path) => (path === 'src/quarantined.ts' ? '// Stryker disable all: debt\n' : 'export const ok = true\n')
    const diff = [added('src/quarantined.ts'), added('src/ok.ts')].join('\n')
    assert.deepEqual(diffScope('origin/develop', ['src'], () => diff, read), ['src/ok.ts'])
    assert.deepEqual(parseFullFileList('src/quarantined.ts\nsrc/ok.ts\n', read), ['src/ok.ts'])
  })

  test('full mode uses configured roots and the shared filter', () => {
    let args
    const git = (value) => {
      args = value
      return 'app/page.ts\nutils/a.test.ts\nutils/ok.ts\n'
    }
    assert.deepEqual(fullScope(['app', 'utils'], git, () => 'export const ok = true\n'), ['app/page.ts', 'utils/ok.ts'])
    assert.deepEqual(args, ['ls-files', '--', 'app/**/*.ts', 'utils/**/*.ts'])
  })

  test('diff mode uses configured roots', () => {
    let args
    const git = (value) => {
      args = value
      return added('app/page.ts')
    }
    assert.deepEqual(diffScope('origin/develop', ['app', 'utils'], git, () => 'export const ok = true\n'), ['app/page.ts'])
    assert.deepEqual(args, [
      'diff',
      '-U0',
      '--diff-filter=AM',
      'origin/develop...HEAD',
      '--',
      'app/**/*.ts',
      'utils/**/*.ts',
    ])
  })
})
