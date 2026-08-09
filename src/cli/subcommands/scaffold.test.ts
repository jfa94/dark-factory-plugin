/**
 * Unit tests for `factory scaffold`. Drives the injectable {@link runScaffold} core
 * with fake git/gh clients + a temp target repo + the REAL templates dir, so the
 * template copy, staging-ensure, and protection probe/refuse/provision are all
 * exercised without touching the host repo or the network.
 */
import {describe, it, expect, beforeEach, afterEach} from 'vitest'
import {mkdtemp, rm, readFile, writeFile, mkdir, cp} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

import {runScaffold, resolveTemplatesDir, scaffoldCommand, resolveScaffoldRepo} from './scaffold.js'
import {sha256Hex} from './scaffold-lock.js'
import {parseArgs} from '../args.js'
import {EXIT} from '../../shared/exit-codes.js'
import {defaultConfig} from '../../config/index.js'
import {buildTargetDataDirRules} from './target-settings.js'
import {FakeGitClient, FakeGhClient} from '../../git/index.js'
import type {ProtectionApiResult} from '../../git/index.js'

const cfg = defaultConfig()
const BASE = cfg.git.baseBranch // "develop"
/** cfg pinned to the pre-D74 permanent strict profile. */
const PERMANENT_CFG = {...cfg, git: {...cfg.git, developProtection: 'permanent' as const}}
const execFileAsync = promisify(execFile)

/** Baked data-dir permission rules injected into runScaffold (E1, F-perm). */
const DATA_DIR_RULES = buildTargetDataDirRules({
    dataDir: '/Users/jo/.claude/plugins/data/factory-jfa94',
    home: '/Users/jo',
})

/** Protection state that satisfies requireProtectionOrRefuse (the default develop contexts, Decision 53). */
const PROTECTED: ProtectionApiResult = {
    enabled: true,
    requiredStatusChecks: ['Quality', 'Mutation Testing', 'Security Scan'],
    strictUpToDate: true,
    hasMergeQueue: false,
}

/** Pragmatic read-back shape for a written gates.json fixture (not the full discriminated union). */
interface GateEntryFixture {
    contracted: boolean
    command?: string
    reason?: string
}
interface GateContractFixture {
    // The scaffolder always emits an entry per known gate, so these are required
    // (not `Record<string, …>` — that would make every `.contracted` read `| undefined`).
    gates: Record<'test' | 'type' | 'build' | 'tdd' | 'mutation' | 'coverage' | 'sast' | 'lint', GateEntryFixture>
}

let root: string
let templatesDir: string

/**
 * A minimal npm fixture that satisfies the gate-contract FLOOR (S7, Decision 46):
 * vitest (test), tsconfig.json (type), scripts.build (build) + stryker (mutation).
 * Without it every runScaffold call would refuse on the 'custom'/below-floor stack.
 */
async function seedNpmFixture(dir: string): Promise<void> {
    await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({
            name: 'fixture',
            engines: {node: '>=22'},
            scripts: {build: 'tsc -p .'},
            devDependencies: {
                vitest: '^2.0.0',
                '@stryker-mutator/core': '^8.0.0',
                '@vitest/coverage-v8': '^2.0.0',
            },
        }) + '\n',
        'utf8'
    )
    await writeFile(join(dir, 'tsconfig.json'), '{}\n', 'utf8')
    // Mutation roots detection (A4): a mutable src/ file so contracting mutation
    // doesn't trip the no-roots loud refusal.
    await mkdir(join(dir, 'src'), {recursive: true})
    await writeFile(join(dir, 'src', 'main.ts'), 'export const one = 1\n', 'utf8')
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'factory-scaffold-'))
    templatesDir = resolveTemplatesDir()
    await seedNpmFixture(root)
})

afterEach(async () => {
    await rm(root, {recursive: true, force: true})
})

describe('runScaffold', () => {
    it('copies the CI template + manages .gitignore, and reports protection on develop', async () => {
        const report = await runScaffold({
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        })

        expect(existsSync(join(root, '.github', 'workflows', 'quality-gate.yml'))).toBe(true)
        expect(existsSync(join(root, '.gitignore'))).toBe(true)
        expect(report.files_created).toContain('.github/workflows/quality-gate.yml')
        // The cost-aware shard helper is a plugin-MANAGED file shipped with the CI net.
        expect(report.files_created).toContain('.github/scripts/shard-mutation-scope.mjs')
        expect(existsSync(join(root, '.github', 'scripts', 'shard-mutation-scope.mjs'))).toBe(true)
        expect(report.files_created).toContain('.github/scripts/shard-mutation-scope.test.mjs')
        expect(existsSync(join(root, '.github', 'scripts', 'shard-mutation-scope.test.mjs'))).toBe(true)
        expect(report.files_updated).toEqual([])
        // The advisory `files_outdated` bucket was retired with the project-owned SEED
        // model (Decision 15) — a SEED file is either created or present, never "outdated".
        expect(report).not.toHaveProperty('files_outdated')
        // Per-run staging is no longer scaffold's concern — report carries no staging field.
        expect(report).not.toHaveProperty('staging')
        expect(report.protection.enabled).toBe(true)
        expect(report.protection.provisioned).toBe(false)

        const gitignore = await readFile(join(root, '.gitignore'), 'utf8')
        expect(gitignore).toMatch(/\.claude-plugin-data\//)

        // The shard script is an esbuild bundle in the plugin's own style — the target
        // must .prettierignore it too, or `prettier --check .` flags it (bug #1).
        expect(report.files_created).toContain('.prettierignore')
        expect(existsSync(join(root, '.prettierignore'))).toBe(true)
        const prettierignore = await readFile(join(root, '.prettierignore'), 'utf8')
        expect(prettierignore).toMatch(/\.github\/scripts\//)

        // The seeded e2e spec must not disable a rule for a plugin scaffold never
        // installs/configures (bug #1, `playwright/no-skipped-test`).
        const e2eSpec = await readFile(join(root, 'e2e', 'example.spec.ts'), 'utf8')
        expect(e2eSpec).not.toContain('playwright/no-skipped-test')
        await expect(
            execFileAsync(join(process.cwd(), 'node_modules', '.bin', 'eslint'), ['e2e/example.spec.ts'], {cwd: root})
        ).resolves.toMatchObject({stderr: ''})

        // Decision 40 D11: no e2e job in CI — it would gate CI merges on infra CI
        // can't boot (seed DB, auth, services). The run-level e2e phase is the gate.
        // Decision 53: no auto-merge job either — the engine owns both merge points.
        const gate = await readFile(join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
        expect(gate).not.toContain('E2E Tests')
        expect(gate).not.toContain('auto-merge')
        expect(gate).toContain('name: Mutation Testing')

        // E1: a target-repo .claude/settings.json is emitted with the factory
        // allow-list + the BAKED data-dir rules + worktree.baseRef:"head", and NO
        // statusLine — and crucially NO literal ${CLAUDE_PLUGIN_DATA} placeholder,
        // and NO additionalDirectories (Decision 17, corrected: that entry is
        // always absolute and lives ONLY in the gitignored settings.local.json,
        // never in this committed file).
        expect(report.settings.created).toBe(true)
        const settingsRaw = await readFile(join(root, '.claude', 'settings.json'), 'utf8')
        expect(settingsRaw).not.toContain('${CLAUDE_PLUGIN_DATA}') // the bug we fixed
        const settings = JSON.parse(settingsRaw) as Record<string, unknown>
        expect((settings.worktree as {baseRef: string}).baseRef).toBe('head')
        const allow = (settings.permissions as {allow: string[]}).allow
        expect(allow).toContain('Bash(factory:*)')
        expect(allow).toContain(`Read(${DATA_DIR_RULES.allowGlobBase}/**)`) // baked, resolved dir
        expect(settings.permissions).not.toHaveProperty('additionalDirectories')
        expect(settings).not.toHaveProperty('statusLine')
        expect(report.files_created).toContain('.claude/settings.json')
        // settings.local.json is gitignored — never listed as a committable file.
        expect(report.files_created).not.toContain('.claude/settings.local.json')

        // The sibling GITIGNORED .claude/settings.local.json carries the ABSOLUTE
        // additionalDirectories entry instead.
        expect(report.settings.local.created).toBe(true)
        const localRaw = await readFile(join(root, '.claude', 'settings.local.json'), 'utf8')
        const local = JSON.parse(localRaw) as Record<string, unknown>
        const dirs = (local.permissions as {additionalDirectories: string[]}).additionalDirectories
        expect(dirs).toContain(DATA_DIR_RULES.additionalDir)
    })

    it('E1: merges non-destructively into an existing target .claude/settings.json', async () => {
        await mkdir(join(root, '.claude'), {recursive: true})
        await writeFile(
            join(root, '.claude', 'settings.json'),
            JSON.stringify({statusLine: {command: 'mine'}, permissions: {allow: ['Bash(make:*)']}}),
            'utf8'
        )
        const report = await runScaffold({
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        })
        expect(report.settings.created).toBe(false)
        expect(report.settings.changed).toBe(true)
        const settings = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8')) as Record<
            string,
            unknown
        >
        expect(settings.statusLine).toEqual({command: 'mine'}) // user's own kept
        const allow = (settings.permissions as {allow: string[]}).allow
        expect(allow).toContain('Bash(make:*)')
        expect(allow).toContain('Bash(factory:*)')
        expect(report.files_present).toContain('.claude/settings.json')
    })

    it('copies the Node gate configs ONLY when package.json exists', async () => {
        // No package.json → stryker/depcruise are skipped; the run then REFUSES on the
        // 'custom' stack (gate-contract floor, S7) — but the nodeOnly skip already
        // happened (templates run before the contract step) and is observable on disk.
        const bare = await mkdtemp(join(tmpdir(), 'factory-scaffold-bare-'))
        try {
            await expect(
                runScaffold({
                    targetRoot: bare,
                    templatesDir,
                    owner: 'acme',
                    repo: 'widgets',
                    config: cfg,
                    dataDirRules: DATA_DIR_RULES,
                    ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
                    provision: false,
                })
            ).rejects.toThrow(/custom/)
            expect(existsSync(join(bare, '.stryker.config.json'))).toBe(false)
            expect(existsSync(join(bare, 'eslint.config.mjs'))).toBe(false)
            expect(existsSync(join(bare, 'playwright.config.ts'))).toBe(false)
        } finally {
            await rm(bare, {recursive: true, force: true})
        }

        // With package.json (the fixture) → the gate configs are copied.
        const withPkg = await runScaffold({
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        })
        expect(withPkg.files_created).toContain('.stryker.config.json')
        expect(withPkg.files_created).toContain('.dependency-cruiser.cjs')
        expect(withPkg.files_created).toContain('eslint.config.mjs')
        expect(withPkg.files_created).toContain('playwright.config.ts')
        expect(withPkg.files_created).toContain('e2e/example.spec.ts')
    })

    it('is idempotent: a second run reports the files as present, not created', async () => {
        const args = {
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        }
        await runScaffold(args)
        const second = await runScaffold(args)
        expect(second.files_created).toEqual([])
        expect(second.files_present).toContain('.github/workflows/quality-gate.yml')
        // An UNCHANGED managed file is `present`, not `updated`.
        expect(second.files_updated).toEqual([])
    })

    it('auto-updates a drifted plugin-MANAGED file (the CI workflow) — propagation path', async () => {
        const args = {
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        }
        // Simulate an already-scaffolded repo carrying an OLD/customized workflow.
        const wf = join(root, '.github', 'workflows', 'quality-gate.yml')
        await mkdir(dirname(wf), {recursive: true})
        await writeFile(wf, 'name: stale round-robin workflow\n', 'utf8')

        const report = await runScaffold(args)

        expect(report.files_updated).toContain('.github/workflows/quality-gate.yml')
        expect(report.files_created).not.toContain('.github/workflows/quality-gate.yml')
        // Content was refreshed to the RENDERED template (Decision 53) — the fix
        // reaches the repo in its stack-adaptive form, not the raw pnpm skeleton.
        const refreshed = await readFile(wf, 'utf8')
        expect(refreshed).toContain('name: Quality Gate')
        expect(refreshed).not.toContain('# factory:setup')
        expect(refreshed).toContain('npm')
    })

    it('treats an existing SEED config as project-owned: present, never overwritten, never re-flagged', async () => {
        const args = {
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        }
        await runScaffold(args) // seeds .stryker.config.json (root is the npm fixture)

        // The project grows its own (user-owned) gate config — exactly the outsidey
        // case where the repo's config has diverged into a richer superset.
        const stryker = join(root, '.stryker.config.json')
        const customized = '{ "thresholds": { "break": 95 } }\n'
        await writeFile(stryker, customized, 'utf8')

        const second = await runScaffold(args)
        // A present SEED file is project-owned: reported `present`, NOT created/updated,
        // and there is no advisory "outdated" bucket to land in.
        expect(second.files_present).toContain('.stryker.config.json')
        expect(second.files_created).not.toContain('.stryker.config.json')
        expect(second.files_updated).not.toContain('.stryker.config.json')
        expect(second).not.toHaveProperty('files_outdated')
        // Customization is preserved — SEED files are never overwritten.
        expect(await readFile(stryker, 'utf8')).toBe(customized)
    })

    it('guarantees the explicit TRACKED/IGNORED .gitignore split', async () => {
        const args = {
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        }
        await runScaffold(args)
        const gitignore = await readFile(join(root, '.gitignore'), 'utf8')
        const lines = gitignore.split('\n')

        // IGNORED: per-machine local state + factory/worktree state are guaranteed.
        for (const entry of [
            '.claude/settings.local.json',
            '.claude/worktrees/',
            '.claude/projects/',
            '.claude/tool-audit.jsonl',
            '.claude-plugin-data/',
            '*.worktree',
        ]) {
            expect(lines).toContain(entry)
        }
        // TRACKED: `.claude/settings.json` must NOT be ignored — neither by an exact
        // line nor by a wholesale `.claude/` rule. The split is explicit, never reliant
        // on enumerating siblings or a global excludes file.
        expect(lines).not.toContain('.claude/settings.json')
        expect(lines).not.toContain('.claude/')
        expect(lines).not.toContain('.claude/*')

        // Idempotent + non-duplicating: a second run appends nothing.
        await runScaffold(args)
        expect(await readFile(join(root, '.gitignore'), 'utf8')).toBe(gitignore)
    })

    it('appends the shard-script exclusion to an existing .prettierignore, and is idempotent', async () => {
        await writeFile(join(root, '.prettierignore'), 'dist/\n', 'utf8')
        const args = {
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
            provision: false,
        }
        const report = await runScaffold(args)
        expect(report.files_created).not.toContain('.prettierignore') // appended, not (re)created
        const prettierignore = await readFile(join(root, '.prettierignore'), 'utf8')
        expect(prettierignore).toMatch(/^dist\/$/m) // user's existing entry preserved
        expect(prettierignore).toMatch(/^\.github\/scripts\/$/m)

        await runScaffold(args)
        expect(await readFile(join(root, '.prettierignore'), 'utf8')).toBe(prettierignore)
    })

    it('REFUSES loudly when develop protection is missing and --provision is off', async () => {
        await expect(
            runScaffold({
                targetRoot: root,
                templatesDir,
                owner: 'acme',
                repo: 'widgets',
                config: cfg,
                dataDirRules: DATA_DIR_RULES,
                ghClient: new FakeGhClient(), // no protection seeded → disabled
                provision: false,
            })
        ).rejects.toThrow(/refuses to start|protection/i)
    })

    it('--provision (permanent mode) writes the strict profile then passes the gate', async () => {
        const gh = new FakeGhClient() // starts unprotected
        const report = await runScaffold({
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: PERMANENT_CFG,
            dataDirRules: DATA_DIR_RULES,
            ghClient: gh,
            provision: true,
        })
        expect(report.protection.provisioned).toBe(true)
        expect(report.protection.strict_up_to_date).toBe(true)
        // The PUT was issued against develop (the integration base), not a shared staging branch.
        expect(gh.calls).toContain(`api PUT protection ${BASE}`)
    })

    describe('D74 — run-scoped develop protection (the default mode)', () => {
        const scaffoldArgs = (gh: FakeGhClient, extra: Partial<Parameters<typeof runScaffold>[0]> = {}) => ({
            targetRoot: root,
            templatesDir,
            owner: 'acme',
            repo: 'widgets',
            config: cfg,
            dataDirRules: DATA_DIR_RULES,
            ghClient: gh,
            provision: false,
            ...extra,
        })

        it('--provision writes the BASELINE profile (baseline contexts, strict off, admins bypass)', async () => {
            const gh = new FakeGhClient() // starts unprotected
            const report = await runScaffold(scaffoldArgs(gh, {provision: true}))
            expect(gh.protectionPuts).toEqual([
                {
                    branch: BASE,
                    body: {requiredStatusChecks: ['Quality', 'Security Scan'], strict: false, enforceAdmins: false},
                },
            ])
            expect(report.protection.provisioned).toBe(true)
            expect(report.protection.strict_up_to_date).toBe(false)
            expect(report.protection.required_status_checks).toEqual(['Quality', 'Security Scan'])
        })

        it('--provision DOWNGRADES a pre-existing permanent strict profile (the one-shot migration)', async () => {
            const gh = new FakeGhClient({protection: {[BASE]: PROTECTED}})
            const report = await runScaffold(scaffoldArgs(gh, {provision: true}))
            expect(gh.protectionPuts.at(-1)?.body).toEqual({
                requiredStatusChecks: ['Quality', 'Security Scan'],
                strict: false,
                enforceAdmins: false,
            })
            expect(report.protection.strict_up_to_date).toBe(false)
        })

        it('baseline-shaped protection passes the RELAXED gate without --provision', async () => {
            const gh = new FakeGhClient({
                protection: {
                    [BASE]: {
                        enabled: true,
                        requiredStatusChecks: ['Quality', 'Security Scan'],
                        strictUpToDate: false, // would REFUSE under the permanent gate
                        hasMergeQueue: false,
                    },
                },
            })
            const report = await runScaffold(scaffoldArgs(gh))
            expect(report.protection.enabled).toBe(true)
            expect(gh.protectionPuts).toEqual([]) // probe-only, nothing written
        })

        it('refuses when a baseline context is missing (enablement alone is not enough)', async () => {
            const gh = new FakeGhClient({
                protection: {
                    [BASE]: {
                        enabled: true,
                        requiredStatusChecks: ['Quality'],
                        strictUpToDate: false,
                        hasMergeQueue: false,
                    },
                },
            })
            await expect(runScaffold(scaffoldArgs(gh))).rejects.toThrow(/Security Scan/)
        })

        it('still refuses an unprotected develop without --provision', async () => {
            await expect(runScaffold(scaffoldArgs(new FakeGhClient()))).rejects.toThrow(/protection/i)
        })

        it('--provision REFUSES while a run is active for the repo (would downgrade the escalated profile)', async () => {
            const gh = new FakeGhClient({protection: {[BASE]: PROTECTED}})
            await expect(
                runScaffold(scaffoldArgs(gh, {provision: true, hasActiveRun: () => Promise.resolve(true)}))
            ).rejects.toThrow(/active run/)
            expect(gh.protectionPuts).toEqual([]) // refused BEFORE the PUT
        })

        it('permanent mode REFUSES a baseline-shaped (strict-off) protection', async () => {
            const gh = new FakeGhClient({
                protection: {
                    [BASE]: {...PROTECTED, strictUpToDate: false},
                },
            })
            await expect(runScaffold(scaffoldArgs(gh, {config: PERMANENT_CFG}))).rejects.toThrow(/strict/i)
        })
    })

    const baseArgs = (config = cfg) => ({
        targetRoot: root,
        templatesDir,
        owner: 'acme',
        repo: 'widgets',
        config,
        dataDirRules: DATA_DIR_RULES,
        ghClient: new FakeGhClient({protection: {[BASE]: PROTECTED}}),
        provision: false,
    })

    /** cfg with a configured gateEnv (manual-only: `factory configure --set quality.gateEnv.*`). */
    const GATEENV_CFG = {
        ...cfg,
        quality: {...cfg.quality, gateEnv: {NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321'}},
    }

    it('renders the configured gateEnv into the WRITTEN managed quality-gate.yml (CI parity)', async () => {
        await runScaffold(baseArgs(GATEENV_CFG))

        const written = await readFile(join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
        // The marker became a real env: block carrying the configured value (quoted).
        expect(written).not.toContain('# factory:gate-env')
        expect(written).toContain('          NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321"')
    })

    it('leaves the gate-env marker in place when no gateEnv is configured', async () => {
        await runScaffold(baseArgs())
        const written = await readFile(join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
        // No injection happened — the marker survives for a future scaffold to fill.
        expect(written).toContain('# factory:gate-env')
    })

    it('re-scaffold re-renders a byte-identical file (idempotent round-trip, no spurious update)', async () => {
        await runScaffold(baseArgs(GATEENV_CFG))
        const wf = join(root, '.github', 'workflows', 'quality-gate.yml')
        const first = await readFile(wf, 'utf8')

        const second = await runScaffold(baseArgs(GATEENV_CFG))
        expect(await readFile(wf, 'utf8')).toBe(first)
        expect(second.files_updated).not.toContain('.github/workflows/quality-gate.yml')
    })

    it('contract setup_steps render into the workflow and stay drift-stable across re-scaffolds (Decision 73)', async () => {
        await runScaffold(baseArgs())
        const gatesPath = join(root, '.factory', 'gates.json')
        const contract = JSON.parse(await readFile(gatesPath, 'utf8')) as Record<string, unknown>
        contract.setup_steps = [{uses: 'supabase/setup-cli@v1'}, {run: 'supabase start'}]
        await writeFile(gatesPath, JSON.stringify(contract, null, 2) + '\n', 'utf8')

        const second = await runScaffold(baseArgs())
        expect(second.files_updated).toContain('.github/workflows/quality-gate.yml')
        const wf = join(root, '.github', 'workflows', 'quality-gate.yml')
        const written = await readFile(wf, 'utf8')
        expect(written.match(/supabase\/setup-cli@v1/g)).toHaveLength(2) // quality + mutation jobs
        expect(written.match(/supabase start/g)).toHaveLength(2)

        // The whole point: the render is now contract-sourced, so a third scaffold
        // sees zero drift (no more auto-update arms race against hand edits).
        const third = await runScaffold(baseArgs())
        expect(await readFile(wf, 'utf8')).toBe(written)
        expect(third.files_updated).not.toContain('.github/workflows/quality-gate.yml')
    })

    describe('stack-adaptive CI render (Decision 53)', () => {
        const wfPath = () => join(root, '.github', 'workflows', 'quality-gate.yml')

        it('renders the npm-fixture workflow with npm steps (no pnpm, no auto-merge, staging-* triggers)', async () => {
            await runScaffold(baseArgs())
            const wf = await readFile(wfPath(), 'utf8')
            // The fixture has no lockfile → plain npm install; no scripts beyond build.
            expect(wf).toContain('- run: npm install --no-audit --no-fund')
            expect(wf).toContain('- run: npx tsc --noEmit')
            expect(wf).toContain('- run: npx vitest run')
            expect(wf).toContain('- run: npm run build')
            expect(wf).not.toContain('pnpm')
            expect(wf).not.toContain('next typegen')
            // eslint is not installed in the fixture → lint gate uncontracted → audit comment.
            expect(wf).toContain('# lint gate uncontracted:')
            // Engine owns merges; per-run staging branches match the trigger glob.
            expect(wf).not.toContain('gh pr merge')
            expect(wf).toMatch(/branches: \[["']staging-\*["'], develop\]/)
            // Mutation contracted (stryker devDep) → real mutation jobs, npm-ified.
            expect(wf).toContain('npx stryker run \\')
            expect(wf.match(/node-version-file: 'package\.json'/g)).toHaveLength(2)
        })

        it('uses the declared runtime with stable precedence and idempotent re-rendering', async () => {
            await writeFile(join(root, '.nvmrc'), '24\n', 'utf8')
            await runScaffold(baseArgs())
            expect((await readFile(wfPath(), 'utf8')).match(/node-version-file: '\.nvmrc'/g)).toHaveLength(2)

            await writeFile(join(root, '.node-version'), '24\n', 'utf8')
            const promoted = await runScaffold(baseArgs())
            expect(promoted.files_updated).toContain('.github/workflows/quality-gate.yml')
            expect((await readFile(wfPath(), 'utf8')).match(/node-version-file: '\.node-version'/g)).toHaveLength(2)

            const stable = await runScaffold(baseArgs())
            expect(stable.files_updated).not.toContain('.github/workflows/quality-gate.yml')
        })

        it('rejects missing, malformed, and conflicting runtime declarations', async () => {
            const packagePath = join(root, 'package.json')
            const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
            delete pkg.engines
            await writeFile(packagePath, JSON.stringify(pkg), 'utf8')
            await expect(runScaffold(baseArgs())).rejects.toThrow(/Node runtime is undeclared/)

            await writeFile(join(root, '.nvmrc'), '22\n24\n', 'utf8')
            await expect(runScaffold(baseArgs())).rejects.toThrow(/exactly one Node version line/)

            await writeFile(join(root, '.nvmrc'), '22\n', 'utf8')
            await writeFile(join(root, '.node-version'), '24\n', 'utf8')
            await expect(runScaffold(baseArgs())).rejects.toThrow(/\.node-version.*\.nvmrc.*disagree/)
        })

        it('rejects package fields that setup-node would prefer over engines.node', async () => {
            const packagePath = join(root, 'package.json')
            const pkg = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>
            pkg.volta = {node: '20'}
            await writeFile(packagePath, JSON.stringify(pkg), 'utf8')

            await expect(runScaffold(baseArgs())).rejects.toThrow(/engines\.node is shadowed by volta\.node/)

            await writeFile(join(root, '.nvmrc'), '24\n', 'utf8')
            await expect(runScaffold(baseArgs())).resolves.toMatchObject({stack: 'npm'})
        })

        it('renders the vacuous-green Mutation Testing aggregator when mutation is waived', async () => {
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'x',
                    engines: {node: '>=22'},
                    scripts: {build: 'b'},
                    devDependencies: {vitest: '^2.0.0', '@vitest/coverage-v8': '^2.0.0'},
                }),
                'utf8'
            )
            await runScaffold({...baseArgs(), waiveMutation: true})
            const wf = await readFile(wfPath(), 'utf8')
            expect(wf).toContain('name: Mutation Testing') // context survives for protection
            expect(wf).toContain('waived via --waive mutation')
            expect(wf).not.toContain('stryker')
            expect(wf).not.toContain('mutation-scope:')
        })

        it('skips the CI net for a deno target (npm-stack render only), loud in the log', async () => {
            const deno = await mkdtemp(join(tmpdir(), 'factory-scaffold-deno-ci-'))
            try {
                await writeFile(join(deno, 'deno.json'), JSON.stringify({tasks: {}}) + '\n', 'utf8')
                const report = await runScaffold({...baseArgs(), targetRoot: deno})
                expect(existsSync(join(deno, '.github', 'workflows', 'quality-gate.yml'))).toBe(false)
                expect(existsSync(join(deno, '.github', 'scripts', 'shard-mutation-scope.mjs'))).toBe(false)
                expect(existsSync(join(deno, '.github', 'scripts', 'shard-mutation-scope.test.mjs'))).toBe(false)
                expect(report.files_created).not.toContain('.github/workflows/quality-gate.yml')
            } finally {
                await rm(deno, {recursive: true, force: true})
            }
        })
    })

    describe('scaffold lock — pristine seed auto-refresh (Decision 15)', () => {
        const lockPath = () => join(root, '.factory', 'scaffold.lock')
        const readLock = async () =>
            JSON.parse(await readFile(lockPath(), 'utf8')) as {version: number; seeds: Record<string, string>}

        /** A private mutable copy of the real templates dir, for "the plugin shipped a newer template" cases. */
        async function copyTemplates(): Promise<string> {
            const dir = await mkdtemp(join(tmpdir(), 'factory-templates-'))
            await cp(templatesDir, dir, {recursive: true})
            return dir
        }

        it('first scaffold records a hash per applied seed, matching the on-disk bytes', async () => {
            const report = await runScaffold(baseArgs())
            expect(report.files_created).toContain('.factory/scaffold.lock')
            const lock = await readLock()
            expect(Object.keys(lock.seeds).sort()).toEqual([
                '.dependency-cruiser.cjs',
                '.stryker.config.json',
                'e2e/example.spec.ts',
                'eslint.config.mjs',
                'playwright.config.ts',
            ])
            for (const [rel, hash] of Object.entries(lock.seeds)) {
                const onDisk = await readFile(join(root, ...rel.split('/')), 'utf8')
                expect(sha256Hex(onDisk)).toBe(hash)
            }
        })

        it('auto-replaces a PRISTINE seed when the shipped template moves — propagation path', async () => {
            await runScaffold(baseArgs())
            const mutated = await copyTemplates()
            try {
                const newTemplate = '{ "mutate": ["src/**/*.ts"], "thresholds": { "break": 80 } }\n'
                await writeFile(join(mutated, '.stryker.config.json'), newTemplate, 'utf8')

                const report = await runScaffold({...baseArgs(), templatesDir: mutated})
                expect(report.files_updated).toContain('.stryker.config.json')
                expect(await readFile(join(root, '.stryker.config.json'), 'utf8')).toBe(newTemplate)
                // The lock now records the NEW content — a third run is quiet.
                expect((await readLock()).seeds['.stryker.config.json']).toBe(sha256Hex(newTemplate))
                const third = await runScaffold({...baseArgs(), templatesDir: mutated})
                expect(third.files_updated).toEqual([])
            } finally {
                await rm(mutated, {recursive: true, force: true})
            }
        })

        it('never touches a CUSTOMIZED seed even when the template moves; stale entry retained', async () => {
            await runScaffold(baseArgs())
            const customized = '{ "thresholds": { "break": 95 } }\n'
            await writeFile(join(root, '.stryker.config.json'), customized, 'utf8')
            const staleHash = (await readLock()).seeds['.stryker.config.json']

            const mutated = await copyTemplates()
            try {
                await writeFile(join(mutated, '.stryker.config.json'), '{ "new": true }\n', 'utf8')
                const report = await runScaffold({...baseArgs(), templatesDir: mutated})
                expect(report.files_updated).not.toContain('.stryker.config.json')
                expect(report.files_present).toContain('.stryker.config.json')
                expect(await readFile(join(root, '.stryker.config.json'), 'utf8')).toBe(customized)
                // The stale entry is KEPT: reverting the file to the exact
                // scaffold-written bytes re-adopts it into pristine tracking.
                expect((await readLock()).seeds['.stryker.config.json']).toBe(staleHash)
            } finally {
                await rm(mutated, {recursive: true, force: true})
            }
        })

        it('cold start: a pre-lock seed is project-owned — untouched, no entry recorded', async () => {
            // The repo was scaffolded before the lock existed: seed present, no lock.
            const preExisting = '{ "thresholds": { "break": 90 } }\n'
            await writeFile(join(root, '.stryker.config.json'), preExisting, 'utf8')

            const report = await runScaffold(baseArgs())
            expect(report.files_present).toContain('.stryker.config.json')
            expect(await readFile(join(root, '.stryker.config.json'), 'utf8')).toBe(preExisting)
            // Other seeds were freshly created and ARE recorded; this one is not.
            expect((await readLock()).seeds).not.toHaveProperty('.stryker.config.json')
            expect((await readLock()).seeds).toHaveProperty('eslint.config.mjs')
        })

        it.each(['e2e-example-v1.10.txt', 'e2e-example-v1.19.txt'])(
            'migrates the exact legacy e2e template %s once',
            async (fixture) => {
                const legacy = await readFile(join(import.meta.dirname, 'fixtures', fixture), 'utf8')
                await mkdir(join(root, 'e2e'), {recursive: true})
                await writeFile(join(root, 'e2e', 'example.spec.ts'), legacy, 'utf8')

                const report = await runScaffold(baseArgs())
                expect(report.files_updated).toContain('e2e/example.spec.ts')
                const migrated = await readFile(join(root, 'e2e', 'example.spec.ts'), 'utf8')
                expect(migrated).not.toContain('playwright/no-skipped-test')
                expect((await readLock()).seeds['e2e/example.spec.ts']).toBe(sha256Hex(migrated))

                const stable = await runScaffold(baseArgs())
                expect(stable.files_updated).not.toContain('e2e/example.spec.ts')
            }
        )

        it('does not migrate a customized legacy e2e template', async () => {
            const legacy = await readFile(join(import.meta.dirname, 'fixtures', 'e2e-example-v1.10.txt'), 'utf8')
            await mkdir(join(root, 'e2e'), {recursive: true})
            await writeFile(join(root, 'e2e', 'example.spec.ts'), `${legacy}// project-owned\n`, 'utf8')

            const report = await runScaffold(baseArgs())
            expect(report.files_present).toContain('e2e/example.spec.ts')
            expect(report.files_updated).not.toContain('e2e/example.spec.ts')
            expect((await readLock()).seeds).not.toHaveProperty('e2e/example.spec.ts')
        })

        it('a GARBAGE lock fails safe (seeds read as customized) and is rewritten valid', async () => {
            await runScaffold(baseArgs())
            await writeFile(lockPath(), 'not json{{{', 'utf8')

            const mutated = await copyTemplates()
            try {
                await writeFile(join(mutated, '.stryker.config.json'), '{ "new": true }\n', 'utf8')
                const report = await runScaffold({...baseArgs(), templatesDir: mutated})
                // No hashes → nothing is provably pristine → nothing overwritten.
                expect(report.files_updated).toEqual([])
                // The garbage was repaired to a valid (empty) lock.
                const lock = await readLock()
                expect(lock.version).toBe(1)
                expect(lock.seeds).toEqual({})
            } finally {
                await rm(mutated, {recursive: true, force: true})
            }
        })

        it('delete-and-rescaffold re-adopts a seed into pristine tracking', async () => {
            await runScaffold(baseArgs())
            await rm(join(root, '.stryker.config.json'))
            const report = await runScaffold(baseArgs())
            expect(report.files_created).toContain('.stryker.config.json')
            const onDisk = await readFile(join(root, '.stryker.config.json'), 'utf8')
            expect((await readLock()).seeds['.stryker.config.json']).toBe(sha256Hex(onDisk))
        })

        it('non-node target: no seeds apply → no lock file is written', async () => {
            const deno = await mkdtemp(join(tmpdir(), 'factory-scaffold-deno-lock-'))
            try {
                await writeFile(join(deno, 'deno.json'), JSON.stringify({tasks: {}}) + '\n', 'utf8')
                await runScaffold({...baseArgs(), targetRoot: deno})
                expect(existsSync(join(deno, '.factory', 'scaffold.lock'))).toBe(false)
            } finally {
                await rm(deno, {recursive: true, force: true})
            }
        })

        it('the lock survives a gate-contract refusal (saved before the contract step)', async () => {
            // npm fixture WITHOUT stryker → seeds land, then the contract refuses.
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'x',
                    engines: {node: '>=22'},
                    scripts: {build: 'b'},
                    devDependencies: {vitest: '^2.0.0', '@vitest/coverage-v8': '^2.0.0'},
                }),
                'utf8'
            )
            await expect(runScaffold(baseArgs())).rejects.toThrow(/--waive mutation/)
            const lock = await readLock()
            // The stryker seed renders AFTER the contract (A4 roots) so it is NOT
            // here — a pass-1 seed proves the early save.
            expect(Object.keys(lock.seeds)).toContain('eslint.config.mjs')
            expect(Object.keys(lock.seeds)).not.toContain('.stryker.config.json')
        })

        it('is idempotent: a second unchanged run leaves the lock byte-identical', async () => {
            await runScaffold(baseArgs())
            const first = await readFile(lockPath(), 'utf8')
            const second = await runScaffold(baseArgs())
            expect(second.files_updated).toEqual([])
            expect(second.files_present).toContain('.factory/scaffold.lock')
            expect(await readFile(lockPath(), 'utf8')).toBe(first)
        })
    })

    describe('gate contract (S7, Decision 46)', () => {
        const gatesPath = () => join(root, '.factory', 'gates.json')

        it('writes the npm contract: floor gates contracted, waivers carry reasons', async () => {
            const report = await runScaffold(baseArgs())
            expect(report.stack).toBe('npm')
            expect(report.gates_contract).toBe('created')
            expect(report.files_created).toContain('.factory/gates.json')
            const contract = JSON.parse(await readFile(gatesPath(), 'utf8')) as GateContractFixture
            expect(contract.gates.test).toEqual({contracted: true})
            expect(contract.gates.type).toEqual({contracted: true})
            expect(contract.gates.build).toEqual({contracted: true})
            expect(contract.gates.tdd).toEqual({contracted: true})
            expect(contract.gates.mutation).toEqual({contracted: true}) // stryker devDep in fixture
            expect(contract.gates.coverage).toEqual({contracted: true}) // coverage-v8 devDep (S8)
            expect(contract.gates.sast.contracted).toBe(false) // no securityCommand configured
            // eslint.config.mjs was seeded this run but eslint itself is not a dep.
            expect(contract.gates.lint.contracted).toBe(false)
            expect(contract.gates.lint.reason).toMatch(/eslint not installed/)
        })

        it('contracts sast when quality.securityCommand is configured', async () => {
            const secured = {
                ...cfg,
                quality: {...cfg.quality, securityCommand: 'semgrep --config auto --error'},
            }
            const report = await runScaffold({...baseArgs(), config: secured})
            expect(report.gates_contract).toBe('created')
            const contract = JSON.parse(await readFile(gatesPath(), 'utf8')) as GateContractFixture
            expect(contract.gates.sast).toEqual({contracted: true})
        })

        it('REFUSES below the npm floor, naming every shortfall; writes nothing', async () => {
            await writeFile(join(root, 'package.json'), JSON.stringify({name: 'x'}), 'utf8')
            await rm(join(root, 'tsconfig.json'))
            await expect(runScaffold(baseArgs())).rejects.toThrow(/vitest[\s\S]*tsconfig\.json[\s\S]*scripts\.build/)
            expect(existsSync(gatesPath())).toBe(false)
        })

        it('npm without stryker REFUSES naming install-or-waive; --waive mutation records the waiver', async () => {
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'x',
                    engines: {node: '>=22'},
                    scripts: {build: 'b'},
                    devDependencies: {vitest: '^2.0.0', '@vitest/coverage-v8': '^2.0.0'},
                }),
                'utf8'
            )
            await expect(runScaffold(baseArgs())).rejects.toThrow(/--waive mutation/)
            expect(existsSync(gatesPath())).toBe(false)

            const report = await runScaffold({...baseArgs(), waiveMutation: true})
            expect(report.gates_contract).toBe('created')
            const contract = JSON.parse(await readFile(gatesPath(), 'utf8')) as GateContractFixture
            expect(contract.gates.mutation).toEqual({
                contracted: false,
                reason: 'waived via --waive mutation',
            })
        })

        it('npm without a coverage provider REFUSES; --waive coverage records the waiver (S8)', async () => {
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'x',
                    engines: {node: '>=22'},
                    scripts: {build: 'b'},
                    devDependencies: {vitest: '^2.0.0', '@stryker-mutator/core': '^8.0.0'},
                }),
                'utf8'
            )
            await expect(runScaffold(baseArgs())).rejects.toThrow(/@vitest\/coverage-v8.*--waive coverage/s)
            expect(existsSync(gatesPath())).toBe(false)

            const report = await runScaffold({...baseArgs(), waiveCoverage: true})
            expect(report.gates_contract).toBe('created')
            const contract = JSON.parse(await readFile(gatesPath(), 'utf8')) as GateContractFixture
            expect(contract.gates.coverage).toEqual({
                contracted: false,
                reason: 'waived via --waive coverage',
            })
        })

        it('advises fast-check on npm when not a dep; silent when present (S8 PBT)', async () => {
            const err: string[] = []
            const spy = (c: unknown): boolean => (err.push(String(c)), true)
            const orig = process.stderr.write.bind(process.stderr)
            ;(process.stderr as unknown as {write: typeof spy}).write = spy
            try {
                await runScaffold(baseArgs()) // fixture has no fast-check
            } finally {
                process.stderr.write = orig
            }
            expect(err.join('')).toMatch(/fast-check not installed/)

            const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
                devDependencies: Record<string, string>
            }
            pkg.devDependencies['fast-check'] = '^3.0.0'
            await writeFile(join(root, 'package.json'), JSON.stringify(pkg), 'utf8')
            const err2: string[] = []
            const spy2 = (c: unknown): boolean => (err2.push(String(c)), true)
            ;(process.stderr as unknown as {write: typeof spy2}).write = spy2
            try {
                await runScaffold(baseArgs())
            } finally {
                process.stderr.write = orig
            }
            expect(err2.join('')).not.toMatch(/fast-check/)
        })

        it('deno target: command overrides, build waived-by-stack, nodeOnly seeds skipped', async () => {
            const deno = await mkdtemp(join(tmpdir(), 'factory-scaffold-deno-'))
            try {
                await writeFile(join(deno, 'deno.json'), JSON.stringify({tasks: {}}) + '\n', 'utf8')
                const report = await runScaffold({...baseArgs(), targetRoot: deno})
                expect(report.stack).toBe('deno')
                expect(report.gates_contract).toBe('created')
                const contract = JSON.parse(
                    await readFile(join(deno, '.factory', 'gates.json'), 'utf8')
                ) as GateContractFixture
                expect(contract.gates.test).toEqual({contracted: true, command: 'deno test'})
                expect(contract.gates.type).toEqual({contracted: true, command: 'deno check .'})
                expect(contract.gates.lint).toEqual({contracted: true, command: 'deno lint'})
                expect(contract.gates.build.contracted).toBe(false)
                expect(contract.gates.build.reason).toMatch(/waived-by-stack/)
                expect(contract.gates.mutation.reason).toMatch(/waived-by-stack/)
                expect(contract.gates.coverage.reason).toMatch(/waived-by-stack/)
                // A deno target is not a Node package — nodeOnly seeds are skipped.
                expect(existsSync(join(deno, '.stryker.config.json'))).toBe(false)
                expect(existsSync(join(deno, 'eslint.config.mjs'))).toBe(false)
            } finally {
                await rm(deno, {recursive: true, force: true})
            }
        })

        it("is idempotent: an existing VALID contract is project-owned — untouched, 'present'", async () => {
            await runScaffold(baseArgs())
            const first = await readFile(gatesPath(), 'utf8')
            const second = await runScaffold(baseArgs())
            expect(second.gates_contract).toBe('present')
            expect(second.files_created).not.toContain('.factory/gates.json')
            expect(second.files_present).toContain('.factory/gates.json')
            expect(await readFile(gatesPath(), 'utf8')).toBe(first)
        })

        it('REFUSES on a present-but-INVALID contract (fix or delete, never regenerate)', async () => {
            await mkdir(join(root, '.factory'), {recursive: true})
            await writeFile(gatesPath(), '{"version": 1}', 'utf8')
            await expect(runScaffold(baseArgs())).rejects.toThrow(/INVALID/)
            // The corrupt file is left for the user — scaffold never clobbers it.
            expect(await readFile(gatesPath(), 'utf8')).toBe('{"version": 1}')
        })
    })

    describe('mutation roots + nightly + shadow guard (A2/A4/A5)', () => {
        it('writes the managed mutation-nightly.yml when mutation is contracted', async () => {
            const report = await runScaffold(baseArgs())
            expect(report.files_created).toContain('.github/workflows/mutation-nightly.yml')
            const nightly = await readFile(join(root, '.github', 'workflows', 'mutation-nightly.yml'), 'utf8')
            expect(nightly).toContain('workflow_dispatch')
            expect(nightly).not.toContain('schedule:')
            expect(nightly).not.toContain('cron:')
            expect(nightly).not.toContain('# factory:mutation-setup')
        })

        it('skips mutation-nightly.yml when mutation is waived', async () => {
            // Remove stryker from the fixture → --waive mutation path.
            await writeFile(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'x',
                    engines: {node: '>=22'},
                    scripts: {build: 'b'},
                    devDependencies: {vitest: '^2.0.0', '@vitest/coverage-v8': '^2.0.0'},
                }),
                'utf8'
            )
            const report = await runScaffold({...baseArgs(), waiveMutation: true})
            expect(report.files_created).not.toContain('.github/workflows/mutation-nightly.yml')
            expect(existsSync(join(root, '.github', 'workflows', 'mutation-nightly.yml'))).toBe(false)
        })

        it('non-src roots flow into the stryker seed mutate globs, the workflow pathspec, and the nightly', async () => {
            await rm(join(root, 'src'), {recursive: true, force: true})
            await mkdir(join(root, 'app'), {recursive: true})
            await writeFile(join(root, 'app', 'page.ts'), 'export const p = 1\n', 'utf8')
            await mkdir(join(root, 'db'), {recursive: true})
            await writeFile(join(root, 'db', 'schema.ts'), 'export const s = 1\n', 'utf8')
            await runScaffold(baseArgs())

            const contract = JSON.parse(await readFile(join(root, '.factory', 'gates.json'), 'utf8')) as {
                gates: {mutation: {roots?: string[]}}
            }
            expect(contract.gates.mutation.roots).toEqual(['app', 'db'])

            const stryker = JSON.parse(await readFile(join(root, '.stryker.config.json'), 'utf8')) as {
                mutate: string[]
            }
            expect(stryker.mutate).toContain('app/**/*.ts')
            expect(stryker.mutate).toContain('db/**/*.ts')
            expect(stryker.mutate).not.toContain('src/**/*.ts')

            const wf = await readFile(join(root, '.github', 'workflows', 'quality-gate.yml'), 'utf8')
            expect(wf).toContain("diff \"origin/$BASE_REF\" 'app' 'db'")
            const nightly = await readFile(join(root, '.github', 'workflows', 'mutation-nightly.yml'), 'utf8')
            expect(nightly).toContain("shard-mutation-scope.mjs full 'app' 'db'")
        })

        it('shadow guard: an existing sibling stryker config blocks seeding (A5)', async () => {
            await writeFile(join(root, '.stryker.config.mjs'), 'export default {}\n', 'utf8')
            const report = await runScaffold(baseArgs())
            expect(existsSync(join(root, '.stryker.config.json'))).toBe(false)
            expect(report.files_created).not.toContain('.stryker.config.json')
        })

        it('re-scaffold with roots is idempotent (seed stays pristine-tracked, no spurious update)', async () => {
            await rm(join(root, 'src'), {recursive: true, force: true})
            await mkdir(join(root, 'app'), {recursive: true})
            await writeFile(join(root, 'app', 'page.ts'), 'export const p = 1\n', 'utf8')
            await runScaffold(baseArgs())
            const second = await runScaffold(baseArgs())
            expect(second.files_updated).toEqual([])
            expect(second.files_present).toContain('.stryker.config.json')
            expect(second.files_present).toContain('.github/workflows/mutation-nightly.yml')
        })
    })
})

describe('scaffoldCommand.run', () => {
    it('--help returns OK', async () => {
        const out: string[] = []
        const spy = (c: unknown): boolean => (out.push(String(c)), true)
        const orig = process.stdout.write.bind(process.stdout)
        ;(process.stdout as unknown as {write: typeof spy}).write = spy
        try {
            expect(await scaffoldCommand.run(['--help'])).toBe(EXIT.OK)
        } finally {
            process.stdout.write = orig
        }
        expect(out.join('')).toMatch(/factory scaffold/)
    })

    it("--waive with anything but 'mutation'/'coverage' is a USAGE error", async () => {
        const err: string[] = []
        const spy = (c: unknown): boolean => (err.push(String(c)), true)
        const orig = process.stderr.write.bind(process.stderr)
        ;(process.stderr as unknown as {write: typeof spy}).write = spy
        try {
            expect(await scaffoldCommand.run(['--waive', 'lint'])).toBe(EXIT.USAGE)
        } finally {
            process.stderr.write = orig
        }
        expect(err.join('')).toMatch(/--waive accepts only 'mutation' or 'coverage'/)
    })

    it('--waive coverage passes the allowlist (fails later on the malformed --repo, not on --waive)', async () => {
        const err: string[] = []
        const spy = (c: unknown): boolean => (err.push(String(c)), true)
        const orig = process.stderr.write.bind(process.stderr)
        ;(process.stderr as unknown as {write: typeof spy}).write = spy
        try {
            expect(await scaffoldCommand.run(['--waive', 'coverage', '--repo', 'no-slash'])).toBe(EXIT.USAGE)
        } finally {
            process.stderr.write = orig
        }
        expect(err.join('')).not.toMatch(/--waive accepts only/)
    })

    it('a malformed --repo is a USAGE error', async () => {
        const err: string[] = []
        const spy = (c: unknown): boolean => (err.push(String(c)), true)
        const orig = process.stderr.write.bind(process.stderr)
        ;(process.stderr as unknown as {write: typeof spy}).write = spy
        try {
            expect(await scaffoldCommand.run(['--repo', 'no-slash'])).toBe(EXIT.USAGE)
        } finally {
            process.stderr.write = orig
        }
        expect(err.join('')).toMatch(/owner.*name/i)
    })
})

describe('resolveScaffoldRepo (auto-derive --repo from origin)', () => {
    function gitWithOrigin(slug: string | null): FakeGitClient {
        const git = new FakeGitClient()
        if (slug !== null) {
            git.setRemoteUrl('origin', `git@github.com:${slug}.git`)
        }
        return git
    }

    it('no --repo flag → derives owner/name from the origin remote', async () => {
        const {owner, repo} = await resolveScaffoldRepo(parseArgs(['--provision'], {booleans: ['provision']}), {
            gitClient: gitWithOrigin('acme/widgets'),
            cwd: '/wherever',
        })
        expect(owner).toBe('acme')
        expect(repo).toBe('widgets')
    })

    it('an explicit --repo that MISMATCHES the origin fails LOUD naming both', async () => {
        await expect(
            resolveScaffoldRepo(parseArgs(['--repo', 'acme/other']), {
                gitClient: gitWithOrigin('acme/widgets'),
                cwd: '/wherever',
            })
        ).rejects.toThrow(/acme\/other.*acme\/widgets|acme\/widgets.*acme\/other/s)
    })

    it('no --repo and NO origin → fails LOUD telling the user to pass --repo', async () => {
        await expect(
            resolveScaffoldRepo(parseArgs([]), {gitClient: gitWithOrigin(null), cwd: '/wherever'})
        ).rejects.toThrow(/--repo/)
    })
})

describe('dependency-cruiser template content', () => {
    it('seeds the architectural boundary rules, incl. lib-not-to-app + components-no-app', async () => {
        const cjs = await readFile(join(resolveTemplatesDir(), '.dependency-cruiser.cjs'), 'utf8')
        expect(cjs).toContain('lib-not-to-app')
        expect(cjs).toContain('components-no-app')
        // The exemption that keeps Next.js server actions a legal cross-layer boundary.
        expect(cjs).toContain('^src/app/actions')
    })
})
