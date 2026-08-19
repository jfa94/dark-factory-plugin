/**
 * Fixture tests for the version:check/version:sync pure helpers — the manifest
 * parity guard tests.yml runs before verify.
 */
import {describe, it, expect} from 'vitest'
import {readCanonicalVersion, manifestDrift, bumpVersionLiteral} from './version.mjs'

const pkg = (version) => JSON.stringify({name: 'x', version})
const plugin = (version) => JSON.stringify({name: 'factory', version}, null, 4)
const marketplace = (version) => JSON.stringify({plugins: [{name: 'factory', version}]}, null, 4)

describe('readCanonicalVersion', () => {
    it('accepts plain, prerelease, and build-metadata SemVer', () => {
        expect(readCanonicalVersion(pkg('1.46.1'))).toBe('1.46.1')
        expect(readCanonicalVersion(pkg('2.0.0-rc.1'))).toBe('2.0.0-rc.1')
        expect(readCanonicalVersion(pkg('1.2.3-alpha.7+build.11'))).toBe('1.2.3-alpha.7+build.11')
    })

    it.each([
        ['missing', JSON.stringify({name: 'x'})],
        ['numeric', JSON.stringify({version: 1.46})],
        ['null', JSON.stringify({version: null})],
        ['non-semver string', pkg('v1.46.1')],
        ['leading zero', pkg('01.2.3')],
        ['two segments', pkg('1.46')],
        ['leading-zero prerelease identifier', pkg('1.2.3-01')],
        ['empty prerelease', pkg('1.2.3-')],
        ['empty build', pkg('1.2.3+')],
    ])('rejects a %s version', (_label, text) => {
        expect(() => readCanonicalVersion(text)).toThrow(/not a canonical SemVer/)
    })
})

describe('manifestDrift', () => {
    it('reports both manifests when both drift', () => {
        const drift = manifestDrift('1.46.1', plugin('1.46.0'), marketplace('1.45.2'))
        expect(drift).toHaveLength(2)
        expect(drift.map((d) => d.file)).toEqual(['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json'])
        expect(drift.map((d) => d.current)).toEqual(['1.46.0', '1.45.2'])
    })

    it('reports nothing when in sync', () => {
        expect(manifestDrift('1.46.1', plugin('1.46.1'), marketplace('1.46.1'))).toEqual([])
    })

    it('throws when marketplace.json has no plugins[0]', () => {
        expect(() => manifestDrift('1.46.1', plugin('1.46.1'), JSON.stringify({plugins: []}))).toThrow(/plugins\[0]/)
    })
})

describe('bumpVersionLiteral', () => {
    it('repairs a drifted manifest without touching anything else', () => {
        const before = plugin('1.46.0')
        const after = bumpVersionLiteral(before, '1.46.0', '1.46.1', '.claude-plugin/plugin.json')
        expect(JSON.parse(after).version).toBe('1.46.1')
        expect(after.replace('1.46.1', '1.46.0')).toBe(before)
    })

    it('is inert to replacement-pattern metacharacters in the target version', () => {
        const out = bumpVersionLiteral(plugin('1.0.0'), '1.0.0', "2.0.0-x$&$'", 'f')
        expect(out).toContain(`"version": "2.0.0-x$&$'"`)
    })

    it('throws naming the file when the expected literal is absent', () => {
        expect(() => bumpVersionLiteral(plugin('1.46.1'), '1.46.0', '1.46.1', '.claude-plugin/plugin.json')).toThrow(
            /\.claude-plugin\/plugin\.json .*"version": "1\.46\.0"/
        )
    })
})
