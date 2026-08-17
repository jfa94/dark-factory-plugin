/**
 * Tests for rendering the managed quality-gate.yml from a repo's resolved gate
 * contract (Decision 53). Pure string render over the shipped template: the
 * `# factory:setup` / `# factory:gates` / `# factory:mutation-*` markers become
 * per-stack steps; mutation waived → vacuous-green "Mutation Testing" aggregator;
 * non-npm stacks refuse loud. Runs against the REAL shipped template so a template
 * restructure that breaks the render contract fails here first.
 */
import {describe, it, expect, beforeAll} from 'vitest'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {
    renderQualityGate,
    renderMutationNightly,
    CI_RENDERED_GATES,
    LOCAL_ONLY_GATES,
    type RenderQualityGateOpts,
} from './render-quality-gate.js'
import {injectGateEnvIntoWorkflow} from './inject-gate-env.js'
import {resolveTemplatesDir} from '../cli/subcommands/scaffold.js'
import {GATE_IDS, type GateId} from '../verifier/deterministic/gate-id.js'
import type {GateContract} from '../verifier/deterministic/gate-contract.js'
import {nonNull} from '../shared/assert.js'

let template: string

beforeAll(async () => {
    template = await readFile(join(resolveTemplatesDir(), '.github', 'workflows', 'quality-gate.yml'), 'utf8')
})

/** A full npm contract; override entries per test. */
function npmContract(overrides: Partial<GateContract['gates']> = {}): GateContract {
    return {
        version: 1,
        stack: 'npm',
        gates: {
            test: {contracted: true},
            tdd: {contracted: true},
            coverage: {contracted: true},
            mutation: {contracted: true},
            sast: {contracted: false, reason: 'no quality.securityCommand configured'},
            type: {contracted: true},
            lint: {contracted: true},
            build: {contracted: true},
            ...overrides,
        },
    }
}

const NPM_OPTS: RenderQualityGateOpts = {
    contract: npmContract(),
    packageManager: 'npm',
    hasLockfile: true,
    scripts: {build: 'tsc -p .'},
    hasNextDep: false,
    nodeRuntime: {versionFile: 'package.json'},
}

const PNPM_OPTS: RenderQualityGateOpts = {
    contract: npmContract(),
    packageManager: 'pnpm',
    hasLockfile: true,
    scripts: {
        typecheck: 'tsc --noEmit',
        lint: 'eslint .',
        test: 'vitest run',
        build: 'next build',
        'deps:validate': 'depcruise src',
    },
    hasNextDep: true,
    nodeRuntime: {versionFile: '.nvmrc'},
}

describe('renderQualityGate — npm stack', () => {
    it('renders npm setup: setup-node with npm cache + npm ci; no pnpm anywhere', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).toContain('cache: npm')
        expect(out.match(/node-version-file: 'package\.json'/g)).toHaveLength(2)
        expect(out).not.toContain('node-version: 20')
        expect(out).toContain('- run: npm ci')
        expect(out).not.toContain('pnpm')
    })

    it('renders install without cache + npm install when there is no lockfile', () => {
        const out = renderQualityGate(template, {...NPM_OPTS, hasLockfile: false})
        expect(out).toContain('- run: npm install --no-audit --no-fund')
        expect(out).not.toContain('cache: npm')
        expect(out).not.toContain('npm ci')
        expect(out.match(/node-version-file: 'package\.json'/g)).toHaveLength(2)
    })

    it('renders the GateRunner built-ins (local/CI parity)', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).toContain('- run: npx tsc --noEmit')
        expect(out).toContain('- run: npx eslint .')
        expect(out).toContain('- run: npx vitest run')
        expect(out).toContain('- run: npm run build')
    })

    it('S2: the CI/local-only partition is a total, disjoint cover of GATE_IDS (drift alarm)', () => {
        // The two enforcers (CI render + local GateRunner) must agree on which gate
        // runs where. Adding a 9th GATE_ID without classifying it here fails this test —
        // that is what kills the local-green ≠ CI-green drift class.
        const partition = [...CI_RENDERED_GATES, ...LOCAL_ONLY_GATES]
        expect([...partition].sort()).toEqual([...GATE_IDS].sort())
        // Disjoint: no gate is claimed by both halves.
        const local = new Set<GateId>(LOCAL_ONLY_GATES)
        expect(CI_RENDERED_GATES.filter((id) => local.has(id))).toEqual([])
    })

    it('S2: a fully-contracted contract renders exactly the CI_RENDERED gates and no LOCAL_ONLY gate', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        // Every CI-rendered gate emits its command (mutation via its own region → the job name).
        const rendered: Record<Exclude<GateId, never>, string> = {
            type: '- run: npx tsc --noEmit',
            lint: '- run: npx eslint .',
            test: '- run: npx vitest run',
            build: '- run: npm run build',
            mutation: 'Mutation Testing',
            tdd: '',
            coverage: '',
            sast: '',
        }
        for (const id of CI_RENDERED_GATES) {
            expect(out).toContain(rendered[id])
        }
        // No local-only gate leaks a step into the CI yaml.
        expect(out).not.toContain('# factory:tdd')
        expect(out).not.toMatch(/- run:.*coverage/)
        expect(out).not.toMatch(/- run:.*(semgrep|sast)/i)
    })

    it('S2: an uncontracted CI-rendered gate degrades to its audit comment, not a step', () => {
        // Render parity must survive an uncontracted rendered gate: comment, never a run step.
        const out = renderQualityGate(template, {
            ...NPM_OPTS,
            contract: npmContract({type: {contracted: false, reason: 'no tsconfig'}}),
        })
        expect(out).toContain('# type gate uncontracted: no tsconfig')
        expect(out).not.toContain('- run: npx tsc --noEmit')
    })

    it('IGNORES package.json scripts — the local gate never runs them, so CI must not either', () => {
        const out = renderQualityGate(template, {
            ...NPM_OPTS,
            scripts: {typecheck: 't', lint: 'l', test: 'vitest run', build: 'b'},
        })
        expect(out).toContain('- run: npx tsc --noEmit')
        expect(out).toContain('- run: npx eslint .')
        expect(out).toContain('- run: npx vitest run')
        expect(out).not.toContain('- run: npm run typecheck')
        expect(out).not.toContain('- run: npm test')
    })

    it('a contracted command override wins over built-ins', () => {
        const out = renderQualityGate(template, {
            ...NPM_OPTS,
            contract: npmContract({test: {contracted: true, command: 'vitest run --pool=forks'}}),
            scripts: {test: 'vitest run', build: 'b'},
        })
        expect(out).toContain('- run: vitest run --pool=forks')
        expect(out).not.toContain('- run: npx vitest run')
    })

    it('omits an uncontracted gate, leaving its reason as an audit comment', () => {
        const out = renderQualityGate(template, {
            ...NPM_OPTS,
            contract: npmContract({lint: {contracted: false, reason: 'no eslint config'}}),
        })
        expect(out).not.toContain('npx eslint')
        expect(out).not.toContain('npm run lint')
        expect(out).toContain('# lint gate uncontracted: no eslint config')
    })

    it('adds the Next.js typegen + deps:validate steps only when present', () => {
        const plain = renderQualityGate(template, NPM_OPTS)
        expect(plain).not.toContain('next typegen')
        expect(plain).not.toContain('deps:validate')

        const next = renderQualityGate(template, {
            ...NPM_OPTS,
            hasNextDep: true,
            scripts: {...NPM_OPTS.scripts, 'deps:validate': 'depcruise src'},
        })
        expect(next).toContain('npx next typegen')
        expect(next).toContain('- run: npm run deps:validate')
    })

    it('keeps the mutation jobs (npm-ified) when mutation is contracted', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).toContain('mutation-scope:')
        expect(out).toContain('npx stryker run \\')
        expect(out).toContain('name: Mutation Testing')
        expect(out).not.toContain('# factory:mutation-begin')
        expect(out).not.toContain('# factory:mutation-end')
        expect(out).not.toContain('# factory:mutation-setup')
    })

    it('replaces the mutation jobs with a vacuous-green Mutation Testing job when waived', () => {
        const out = renderQualityGate(template, {
            ...NPM_OPTS,
            contract: npmContract({mutation: {contracted: false, reason: 'waived via --waive mutation'}}),
        })
        // The required-check context survives — universal across factory repos.
        expect(out).toContain('name: Mutation Testing')
        expect(out).toContain('waived via --waive mutation')
        // The real mutation machinery is gone.
        expect(out).not.toContain('mutation-scope:')
        expect(out).not.toContain('stryker')
        expect(out).not.toContain('shard-mutation-scope.mjs')
    })
})

describe('renderQualityGate — contract setup_steps (Decision 73)', () => {
    const optsWithSteps: RenderQualityGateOpts = {
        ...NPM_OPTS,
        contract: {
            ...npmContract(),
            setup_steps: [
                {uses: 'supabase/setup-cli@v1', with: {version: 'latest'}},
                {name: 'Boot Supabase', run: 'supabase start'},
            ],
        },
    }

    it('renders uses-steps (with inputs) and named run-steps after the quality-job package setup', () => {
        const out = renderQualityGate(template, optsWithSteps)
        expect(out).toContain('- uses: supabase/setup-cli@v1')
        expect(out).toContain('version: latest')
        expect(out).toContain('- name: Boot Supabase')
        expect(out).toContain('run: supabase start')
        // After the package-manager install, before the gates.
        expect(out.indexOf('- run: npm ci')).toBeLessThan(out.indexOf('- uses: supabase/setup-cli@v1'))
        expect(out.indexOf('supabase start')).toBeLessThan(out.indexOf('- run: npx tsc --noEmit'))
    })

    it('renders the steps in the mutation shard job too (it boots the test suite as well)', () => {
        const out = renderQualityGate(template, optsWithSteps)
        expect(out.match(/supabase\/setup-cli@v1/g)).toHaveLength(2)
        expect(out.match(/supabase start/g)).toHaveLength(2)
    })

    it('renders nothing extra when setup_steps is absent', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).not.toContain('supabase')
    })
})

describe('renderQualityGate — structure invariants', () => {
    it('emits the three protection contexts and no auto-merge job', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).toContain('name: Quality')
        expect(out).toContain('name: Security Scan')
        expect(out).toContain('name: Mutation Testing')
        expect(out).not.toContain('auto-merge')
        expect(out).not.toContain('gh pr merge')
    })

    it('triggers on per-run staging branches and develop', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        expect(out).toMatch(/branches: \[["']staging-\*["'], develop\]/)
    })

    it('leaves no factory markers behind except gate-env (downstream injection point)', () => {
        const out = renderQualityGate(template, NPM_OPTS)
        const markers = out.match(/# factory:[a-z-]+/g) ?? []
        expect(markers).toEqual(['# factory:gate-env'])
    })

    it('composes with injectGateEnvIntoWorkflow (the scaffold pipeline)', () => {
        const out = injectGateEnvIntoWorkflow(renderQualityGate(template, NPM_OPTS), {API_URL: 'http://x'})
        expect(out).toContain('API_URL: "http://x"')
        expect(out).not.toContain('# factory:gate-env')
    })

    it('is deterministic: same inputs render byte-identical output', () => {
        expect(renderQualityGate(template, PNPM_OPTS)).toBe(renderQualityGate(template, PNPM_OPTS))
    })
})

describe('renderQualityGate — pnpm stack', () => {
    it('renders pnpm setup + built-in gate steps (the outsidey shape: scripts ≡ built-ins)', () => {
        const out = renderQualityGate(template, PNPM_OPTS)
        expect(out).toContain('pnpm/action-setup')
        expect(out).toContain('cache: pnpm')
        expect(out).toContain('- run: pnpm install --frozen-lockfile')
        expect(out).toContain('- run: pnpm exec tsc --noEmit')
        expect(out).toContain('- run: pnpm exec eslint .')
        expect(out).toContain('- run: pnpm exec vitest run')
        expect(out).toContain('- run: pnpm run build')
        expect(out).toContain('run: pnpm next typegen')
        expect(out).toContain('- run: pnpm deps:validate')
        expect(out).toContain('pnpm exec stryker run \\')
        expect(out).toContain('pnpm audit --audit-level=high')
        expect(out.match(/node-version-file: '\.nvmrc'/g)).toHaveLength(2)
        expect(out).not.toContain('node-version: 20')
    })
})

describe('renderQualityGate — non-npm stacks refuse', () => {
    it('throws loud for a deno contract', () => {
        const deno: GateContract = {
            version: 1,
            stack: 'deno',
            gates: {
                test: {contracted: true, command: 'deno test'},
                tdd: {contracted: true},
                coverage: {contracted: false, reason: 'waived-by-stack'},
                mutation: {contracted: false, reason: 'waived-by-stack'},
                sast: {contracted: false, reason: 'none'},
                type: {contracted: true, command: 'deno check .'},
                lint: {contracted: true, command: 'deno lint'},
                build: {contracted: false, reason: 'waived-by-stack'},
            },
        }
        expect(() => renderQualityGate(template, {...NPM_OPTS, contract: deno})).toThrow(/deno/)
    })
})

describe('mutation roots substitution (A4) + renderMutationNightly (A2)', () => {
    let nightly: string
    beforeAll(async () => {
        nightly = await readFile(join(resolveTemplatesDir(), '.github', 'workflows', 'mutation-nightly.yml'), 'utf8')
    })

    const rootsOpts = (roots: [string, ...string[]] | undefined): RenderQualityGateOpts => ({
        ...NPM_OPTS,
        contract: npmContract({mutation: roots === undefined ? {contracted: true} : {contracted: true, roots}}),
    })

    it('renderQualityGate rewrites the diff pathspec from contracted roots', () => {
        const out = renderQualityGate(template, rootsOpts(['app', 'utils']))
        expect(out).toContain("-- 'app/**/*.ts' 'utils/**/*.ts'")
        expect(out).not.toContain("'src/**/*.ts'")
    })

    it("default roots (['src'] / omitted) leave the template pathspec untouched", () => {
        const out = renderQualityGate(template, rootsOpts(undefined))
        expect(out).toContain("-- 'src/**/*.ts'")
    })

    it('renderMutationNightly: contracted → rendered with setup, roots, npm rewrite', () => {
        const out = renderMutationNightly(nightly, {...rootsOpts(['app']), packageManager: 'npm'})
        expect(out).not.toBeNull()
        expect(out).toContain("git ls-files -- 'app/**/*.ts'")
        expect(out).not.toContain('# factory:mutation-setup')
        expect(out).toContain('npx stryker run \\')
        expect(out).not.toContain('pnpm exec stryker')
        expect(out).toContain('actions/cache/save')
    })

    it('renderMutationNightly: pnpm keeps pnpm exec', () => {
        const out = renderMutationNightly(nightly, {...PNPM_OPTS})
        expect(out).toContain('pnpm exec stryker run \\')
    })

    it('renderMutationNightly: mutation waived → null (no nightly workflow)', () => {
        const out = renderMutationNightly(nightly, {
            ...NPM_OPTS,
            contract: npmContract({mutation: {contracted: false, reason: 'waived via --waive mutation'}}),
        })
        expect(out).toBeNull()
    })

    it('renderMutationNightly refuses non-npm stacks loud', () => {
        const contract = {...npmContract(), stack: 'deno' as const}
        expect(() => renderMutationNightly(nightly, {...NPM_OPTS, contract})).toThrow(/not supported/)
    })

    it('PR and nightly render ONE identical mutable-source exclude predicate (S11 drift lock)', () => {
        const grepLines = (text: string) => text.split('\n').filter((l) => l.includes('grep -Ev'))
        const pr = grepLines(renderQualityGate(template, rootsOpts(undefined)))
        const nightlyOut = grepLines(renderMutationNightly(nightly, rootsOpts(undefined)) ?? '')
        expect(pr).toHaveLength(1)
        expect(nightlyOut).toHaveLength(1)
        const pattern = /grep -Ev '([^']*)'/
        expect(pattern.exec(nonNull(pr[0]))?.[1]).toBe(pattern.exec(nonNull(nightlyOut[0]))?.[1])
        // The clause that drifted stays present in BOTH.
        expect(nonNull(pr[0])).toContain('robots|sitemap')
    })

    it('PR shard cache SAVES on always() — a below-threshold run still warms the incremental base', () => {
        const lines = renderQualityGate(template, rootsOpts(undefined)).split('\n')
        const idx = lines.findIndex((l) => l.includes('- name: Save Stryker incremental cache'))
        expect(idx).toBeGreaterThan(-1)
        expect(nonNull(lines[idx + 1]).trim()).toBe("if: always() && steps.slice.outputs.slice != ''")
    })

    it('throws loud when the grep -Ev exclude anchor is missing from the template', () => {
        const stripped = template
            .split('\n')
            .filter((l) => !l.includes('grep -Ev'))
            .join('\n')
        expect(() => renderQualityGate(stripped, rootsOpts(undefined))).toThrow(/grep -Ev/)
    })

    it('throws loud when non-default roots find no default pathspec to re-point', () => {
        const stripped = template.replaceAll("'src/**/*.ts'", "'lib/**/*.ts'")
        expect(() => renderQualityGate(stripped, rootsOpts(['app']))).toThrow(/default-roots pathspec/)
    })

    it('default roots do not require the pathspec literal to be present', () => {
        const stripped = template.replaceAll("'src/**/*.ts'", "'lib/**/*.ts'")
        expect(() => renderQualityGate(stripped, rootsOpts(undefined))).not.toThrow()
    })

    it('PR and nightly shard cache keys share one scheme (restore-keys prefix alignment)', () => {
        const key = /key: \$\{\{ runner\.os \}\}-stryker-shard-\$\{\{ matrix\.shard \}\}-\$\{\{ github\.sha \}\}/
        expect(template).toMatch(key)
        expect(nightly).toMatch(key)
    })
})
