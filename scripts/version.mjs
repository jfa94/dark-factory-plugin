#!/usr/bin/env node
/**
 * version:check / version:sync — package.json is the CANONICAL version; the two
 * plugin manifests (.claude-plugin/plugin.json + the marketplace.json plugin
 * entry) must mirror it. `check` exits 1 naming any drift; `sync` rewrites the
 * two manifests from package.json. Scoped to exactly these files — nothing else.
 *
 * Pure helpers below (exported for scripts/version.test.mjs); the CLI runs only
 * when this file is the entrypoint.
 */
import {readFileSync, writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'

/** The official semver.org suggested regex (SemVer 2.0.0), copied verbatim. */
const SEMVER =
    // eslint-disable-next-line security/detect-unsafe-regex -- safe-regex false positive: alternation branches are disjoint by first char/digit-vs-letter, no nested unbounded quantifier over the same span; ReDoS-audited linear (<1ms on 50k-char pathological input)
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

/** Canonical SemVer 2.0.0 (semver.org), incl. prerelease + build metadata. */
function isCanonicalSemVer(v) {
    return SEMVER.test(v)
}

/** Parse package.json text and return its version, or throw naming what's wrong. */
export function readCanonicalVersion(pkgText) {
    const version = JSON.parse(pkgText).version
    if (typeof version !== 'string' || !isCanonicalSemVer(version)) {
        throw new Error(`version: package.json "version" is not a canonical SemVer string: ${JSON.stringify(version)}`)
    }
    return version
}

/** Compare both manifests against the canonical version → [{file, label, current}]. */
export function manifestDrift(canonical, pluginText, marketplaceText) {
    const plugin = JSON.parse(pluginText)
    const entry = JSON.parse(marketplaceText).plugins?.[0]
    if (entry === undefined) {
        throw new Error('version: .claude-plugin/marketplace.json has no plugins[0] entry')
    }
    const drift = []
    if (plugin.version !== canonical) {
        drift.push({file: '.claude-plugin/plugin.json', label: '.claude-plugin/plugin.json', current: plugin.version})
    }
    if (entry.version !== canonical) {
        drift.push({
            file: '.claude-plugin/marketplace.json',
            label: '.claude-plugin/marketplace.json plugins[0]',
            current: entry.version,
        })
    }
    return drift
}

/**
 * Targeted string replace of the "version" value only — a full re-serialize
 * would reformat unrelated parts of the manifests (cosmetic churn per sync).
 * Replacement is a FUNCTION so `to` is inert (no `$&`-pattern hazards); throws
 * naming the file when the expected literal is absent (nothing changed).
 */
export function bumpVersionLiteral(text, from, to, file) {
    const needle = `"version": "${from}"`
    if (!text.includes(needle)) {
        throw new Error(`version:sync — ${file} does not contain the literal ${needle}; repair the manifest by hand`)
    }
    return text.replace(needle, () => `"version": "${to}"`)
}

function main() {
    const mode = process.argv[2]
    if (mode !== 'check' && mode !== 'sync') {
        console.error('usage: node scripts/version.mjs <check|sync>')
        process.exit(2)
    }

    const canonical = readCanonicalVersion(readFileSync('package.json', 'utf8'))
    const drift = manifestDrift(
        canonical,
        readFileSync('.claude-plugin/plugin.json', 'utf8'),
        readFileSync('.claude-plugin/marketplace.json', 'utf8')
    )

    if (mode === 'check') {
        if (drift.length > 0) {
            const lines = drift.map((d) => `${d.label}: ${d.current}`)
            console.error(`version:check FAILED — package.json is ${canonical} but:\n  ${lines.join('\n  ')}`)
            console.error('Run `pnpm run version:sync` to repair.')
            process.exit(1)
        }
        console.log(`version:check OK (${canonical})`)
    } else {
        if (drift.length === 0) {
            console.log(`version:sync — already in sync (${canonical})`)
            return
        }
        for (const d of drift) {
            // d.file comes from the fixed two-manifest set in manifestDrift, never user input.
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            writeFileSync(d.file, bumpVersionLiteral(readFileSync(d.file, 'utf8'), d.current, canonical, d.file))
        }
        console.log(`version:sync — wrote ${canonical} to ${drift.length} manifest(s)`)
    }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
}
