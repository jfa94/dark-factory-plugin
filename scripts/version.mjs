#!/usr/bin/env node
/**
 * version:check / version:sync — package.json is the CANONICAL version; the two
 * plugin manifests (.claude-plugin/plugin.json + the marketplace.json plugin
 * entry) must mirror it. `check` exits 1 naming any drift; `sync` rewrites the
 * two manifests from package.json. Scoped to exactly these files — nothing else.
 */
import {readFileSync, writeFileSync} from 'node:fs'

const mode = process.argv[2]
if (mode !== 'check' && mode !== 'sync') {
    console.error('usage: node scripts/version.mjs <check|sync>')
    process.exit(2)
}

const canonical = JSON.parse(readFileSync('package.json', 'utf8')).version
const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'))
const marketplace = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const entry = marketplace.plugins?.[0]
if (entry === undefined) {
    console.error('version: .claude-plugin/marketplace.json has no plugins[0] entry')
    process.exit(1)
}

const drift = []
if (plugin.version !== canonical) drift.push(`.claude-plugin/plugin.json: ${plugin.version}`)
if (entry.version !== canonical) drift.push(`.claude-plugin/marketplace.json plugins[0]: ${entry.version}`)

if (mode === 'check') {
    if (drift.length > 0) {
        console.error(`version:check FAILED — package.json is ${canonical} but:\n  ${drift.join('\n  ')}`)
        console.error('Run `npm run version:sync` to repair.')
        process.exit(1)
    }
    console.log(`version:check OK (${canonical})`)
} else {
    if (drift.length === 0) {
        console.log(`version:sync — already in sync (${canonical})`)
        process.exit(0)
    }
    // Targeted string replace of the "version" value only — a full re-serialize
    // would reformat unrelated parts of the manifests (cosmetic churn per sync).
    const bump = (text, from) => text.replace(`"version": "${from}"`, `"version": "${canonical}"`)
    if (plugin.version !== canonical) {
        writeFileSync(
            '.claude-plugin/plugin.json',
            bump(readFileSync('.claude-plugin/plugin.json', 'utf8'), plugin.version)
        )
    }
    if (entry.version !== canonical) {
        writeFileSync(
            '.claude-plugin/marketplace.json',
            bump(readFileSync('.claude-plugin/marketplace.json', 'utf8'), entry.version)
        )
    }
    console.log(`version:sync — wrote ${canonical} to ${drift.length} manifest(s)`)
}
