/**
 * Scaffold-time gate-contract resolution (S7, Decision 46).
 *
 * `factory scaffold` detects the target's stack and writes `.factory/gates.json`
 * — the committed, TCB-write-denied agreement on which gates apply. Every gate id
 * gets an EXPLICIT entry; a below-FLOOR resolution (no test / type-equivalent /
 * build-equivalent gate) REFUSES rather than writing a contract that would let
 * "nothing ran" pass a task.
 *
 * Seed-like semantics: absent → resolve + write; present + valid → project-owned,
 * untouched; present + invalid → refuse (never silently regenerate a corrupt
 * committed contract).
 */
/* eslint-disable security/detect-non-literal-fs-filename -- fs on internal derived paths (run/spec/state/repo/data dirs), never external input; runtime write-danger is covered by the TCB write-deny hook */
import {existsSync, readdirSync, statSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'
import {isMutableSrc} from '../../verifier/deterministic/scope.js'
import {
    GATE_CONTRACT_REL,
    GateContractSchema,
    loadGateContract,
    type GateContract,
    type GateContractEntry,
    type GateContractStack,
} from '../../verifier/deterministic/gate-contract.js'
import {ESLINT_CONFIGS} from '../../verifier/deterministic/strategies/lint.js'

/** Detect the target's stack. A root JS lockfile is decisive proof of a node
 * toolchain and wins over a coexisting deno.json — the deno.json may only scope
 * a subdirectory (e.g. a Supabase Edge Function workspace member). Absent a
 * lockfile, deno.json wins (deno repos often carry a package.json for tooling). */
export function detectStack(targetRoot: string): GateContractStack {
    const has = (f: string) => existsSync(join(targetRoot, f))
    const hasPkg = has('package.json')
    const hasDeno = has('deno.json') || has('deno.jsonc')
    const hasNodeLock = has('pnpm-lock.yaml') || has('package-lock.json') || has('yarn.lock') || has('bun.lockb')
    if (hasPkg && hasNodeLock) {
        return 'npm'
    }
    if (hasDeno) {
        return 'deno'
    }
    if (hasPkg) {
        return 'npm'
    }
    return 'custom'
}

interface PackageJson {
    readonly scripts?: Record<string, string>
    readonly dependencies?: Record<string, string>
    readonly devDependencies?: Record<string, string>
}

async function readPackageJson(targetRoot: string): Promise<PackageJson> {
    const raw = await readFile(join(targetRoot, 'package.json'), 'utf8')
    try {
        return JSON.parse(raw) as PackageJson
    } catch (err) {
        throw new Error(`scaffold: package.json is not valid JSON: ${(err as Error).message}`)
    }
}

function hasDep(pkg: PackageJson, name: string): boolean {
    return pkg.dependencies?.[name] !== undefined || pkg.devDependencies?.[name] !== undefined
}

/**
 * Strip `//` line comments and block comments from deno.jsonc for the build-task
 * probe. Line comments are only stripped when the line STARTS with `//` so a
 * `"https://deno.land/..."` import-map value is never clobbered.
 */
function stripJsoncComments(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** Does deno.json / deno.jsonc define a `build` task? Throws loud on unparseable. */
async function denoHasBuildTask(targetRoot: string): Promise<boolean> {
    const jsonc = existsSync(join(targetRoot, 'deno.jsonc'))
    const file = jsonc ? 'deno.jsonc' : 'deno.json'
    const raw = await readFile(join(targetRoot, file), 'utf8')
    let parsed: unknown
    try {
        parsed = JSON.parse(jsonc ? stripJsoncComments(raw) : raw)
    } catch (err) {
        throw new Error(`scaffold: ${file} is not parseable JSON: ${(err as Error).message}`)
    }
    const tasks = (parsed as {tasks?: Record<string, unknown>}).tasks
    return typeof tasks?.build === 'string'
}

/** Inputs to contract resolution — pure of process/argv, unit-testable. */
export interface ResolveGatesOptions {
    readonly targetRoot: string
    /** `config.quality.securityCommand` — contracts the sast gate when set. */
    readonly securityCommand?: string | undefined
    /** `--waive mutation`: record mutation as deliberately waived instead of refusing. */
    readonly waiveMutation: boolean
    /** `--waive coverage`: record coverage as deliberately waived instead of refusing. */
    readonly waiveCoverage: boolean
    /**
     * Seed files (repo-relative) THIS scaffold run will create, treated as already
     * present during resolution (5b). Lets the read-only preflight resolve the SAME
     * contract the post-seed authoritative pass will (a to-be-seeded
     * `eslint.config.mjs` flips the lint gate) without a second policy implementation.
     */
    readonly projectedSeedFiles?: readonly string[]
}

const yes: GateContractEntry = {contracted: true}
const no = (reason: string): GateContractEntry => ({contracted: false, reason})

/**
 * Top-level directories probed for mutable source when the historical `src/`
 * layout is absent (e.g. Next.js app-dir repos). Order is the contracted order.
 */
export const MUTATION_ROOT_CANDIDATES: readonly string[] = [
    'app',
    'components',
    'lib',
    'utils',
    'db',
    'server',
    'hooks',
] as const

/** Does `root` (repo-relative top-level dir) contain at least one mutable .ts file? */
function hasMutableTs(targetRoot: string, root: string): boolean {
    const abs = join(targetRoot, root)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        return false
    }
    const entries = readdirSync(abs, {recursive: true, encoding: 'utf8'})
    return entries.some((rel) => isMutableSrc(`${root}/${rel.replaceAll('\\', '/')}`, [root]))
}

/**
 * Detect the repo's mutable-source roots for the mutation contract. `src/` wins
 * (the default — the contract omits `roots`); otherwise every candidate dir with
 * mutable .ts files is contracted EXPLICITLY. An empty result with mutation
 * contracted would be a silent no-op gate (the required "Mutation Testing" check
 * passing without mutating a single file) — the caller refuses loudly instead.
 */
export function detectMutationRoots(targetRoot: string): readonly string[] | undefined {
    if (hasMutableTs(targetRoot, 'src')) {
        return undefined
    }
    const roots = MUTATION_ROOT_CANDIDATES.filter((r) => hasMutableTs(targetRoot, r))
    return roots.length > 0 ? roots : []
}

async function resolveNpm(opts: ResolveGatesOptions): Promise<GateContract> {
    const pkg = await readPackageJson(opts.targetRoot)
    // FLOOR: test + type + build must all be contractable — collect every shortfall
    // into ONE refusal so the user fixes the lot in one pass.
    const floor: string[] = []
    if (!hasDep(pkg, 'vitest')) {
        floor.push('test gate: no vitest dependency — install vitest')
    }
    if (!existsSync(join(opts.targetRoot, 'tsconfig.json'))) {
        floor.push('type gate: no tsconfig.json — add one')
    }
    if (pkg.scripts?.build === undefined) {
        floor.push('build gate: no scripts.build — add a build script')
    }
    if (floor.length > 0) {
        throw new Error(`scaffold: gate contract below floor for stack 'npm':\n  - ${floor.join('\n  - ')}`)
    }
    const strykerResolvable =
        hasDep(pkg, '@stryker-mutator/core') || existsSync(join(opts.targetRoot, 'node_modules', '.bin', 'stryker'))
    let mutation: GateContractEntry
    // The explicit waiver wins even with stryker installed — the no-roots refusal
    // below names --waive mutation as its exit, so the flag must actually take it.
    if (opts.waiveMutation) {
        mutation = no('waived via --waive mutation')
    } else if (strykerResolvable) {
        const roots = detectMutationRoots(opts.targetRoot)
        if (roots?.length === 0) {
            throw new Error(
                'scaffold: mutation gate: no mutable-source roots found — no src/ and none of ' +
                    `${MUTATION_ROOT_CANDIDATES.join('/')} contain mutable .ts files. Contracting mutation ` +
                    'would make the "Mutation Testing" check a silent no-op; add explicit roots to ' +
                    '.factory/gates.json (gates.mutation.roots) or pass --waive mutation'
            )
        }
        mutation = roots === undefined ? yes : {contracted: true, roots: [...roots] as [string, ...string[]]}
    } else {
        throw new Error(
            'scaffold: mutation gate: stryker not installed — install @stryker-mutator/core ' +
                'or pass --waive mutation to record the waiver'
        )
    }
    // Coverage (S8): the gate MEASURES via vitest's json-summary reporter, which
    // needs a coverage provider installed. Mirror mutation's loud-provision.
    const coverageProvider = hasDep(pkg, '@vitest/coverage-v8') || hasDep(pkg, '@vitest/coverage-istanbul')
    let coverage: GateContractEntry
    if (coverageProvider) {
        coverage = yes
    } else if (opts.waiveCoverage) {
        coverage = no('waived via --waive coverage')
    } else {
        throw new Error(
            'scaffold: coverage gate: no vitest coverage provider — install @vitest/coverage-v8 ' +
                '(or @vitest/coverage-istanbul) or pass --waive coverage to record the waiver'
        )
    }
    const eslintConfig = ESLINT_CONFIGS.some(
        (c) => existsSync(join(opts.targetRoot, c)) || opts.projectedSeedFiles?.includes(c) === true
    )
    let lint: GateContractEntry
    if (!eslintConfig) {
        lint = no('no eslint config')
    } else if (hasDep(pkg, 'eslint') || existsSync(join(opts.targetRoot, 'node_modules', '.bin', 'eslint'))) {
        lint = yes
    } else {
        // Config present (often the scaffold seed) but eslint itself not installed —
        // contracting would fail every task as contracted-but-unrunnable.
        lint = no('eslint config present but eslint not installed — install eslint and re-scaffold')
    }
    return {
        version: 1,
        stack: 'npm',
        gates: {
            test: yes,
            tdd: yes,
            coverage,
            mutation,
            sast:
                opts.securityCommand != null && opts.securityCommand.length > 0
                    ? yes
                    : no('no quality.securityCommand configured'),
            type: yes,
            lint,
            build: yes,
        },
    }
}

async function resolveDeno(opts: ResolveGatesOptions): Promise<GateContract> {
    const build = (await denoHasBuildTask(opts.targetRoot))
        ? ({contracted: true, command: 'deno task build'} as const)
        : no('waived-by-stack: no emit step — deno check covers compilation')
    return {
        version: 1,
        stack: 'deno',
        gates: {
            test: {contracted: true, command: 'deno test'},
            tdd: yes,
            coverage: no(
                'waived-by-stack: deno coverage emits lcov, no json-summary — contract a coverage ' +
                    'command that writes coverage/coverage-summary.json or keep waived'
            ),
            mutation: no('waived-by-stack: stryker does not support deno'),
            sast:
                opts.securityCommand != null && opts.securityCommand.length > 0
                    ? yes
                    : no('no quality.securityCommand configured'),
            type: {contracted: true, command: 'deno check .'},
            lint: {contracted: true, command: 'deno lint'},
            build,
        },
    }
}

/**
 * Resolve the contract for the detected stack. Throws with a precise, per-gate
 * message when the floor is unsatisfiable (custom stack, missing npm tooling) or
 * when mutation is neither resolvable nor explicitly waived.
 */
export async function resolveGateContract(opts: ResolveGatesOptions): Promise<GateContract> {
    const stack = detectStack(opts.targetRoot)
    if (stack === 'custom') {
        throw new Error(
            "scaffold: gate contract floor unsatisfiable for stack 'custom' — no package.json (npm) " +
                'or deno.json/deno.jsonc (deno) detected; the factory requires contractable ' +
                'test + type + build gates'
        )
    }
    const contract = stack === 'npm' ? await resolveNpm(opts) : await resolveDeno(opts)
    // Structural self-check: scaffold must never emit a contract the loader rejects.
    return GateContractSchema.parse(contract)
}

/**
 * Should scaffold recommend installing fast-check? Advisory only (S8 PBT
 * guidance): npm stack without a fast-check dep — the test-writer prefers
 * property tests when the library is ALREADY present, and never injects deps.
 */
export async function recommendFastCheck(targetRoot: string): Promise<boolean> {
    if (detectStack(targetRoot) !== 'npm') {
        return false
    }
    return !hasDep(await readPackageJson(targetRoot), 'fast-check')
}

/** Outcome of {@link ensureGateContract} for the scaffold report. */
export interface GateContractResult {
    readonly status: 'created' | 'present'
    readonly stack: GateContractStack
    /** The effective contract (loaded or freshly resolved) — drives the CI render (Decision 53). */
    readonly contract: GateContract
}

const invalidContractError = (error: string): Error =>
    new Error(`scaffold: ${GATE_CONTRACT_REL} is INVALID (${error}) — fix it or delete it and re-run factory scaffold`)

/**
 * READ-ONLY contract preflight (5b): resolve the contract scaffold WILL end up
 * with — the loaded committed one, or a fresh resolution with the run's seeds
 * projected as present — WITHOUT writing anything. Every resolution/refusal
 * error (invalid contract, below-floor, install-or-waive) propagates from here
 * BEFORE any seed/lock write, giving refusals zero-write semantics. The
 * authoritative `ensureGateContract` still runs after seeds and its result is
 * what gets persisted.
 */
export async function preflightGateContract(opts: ResolveGatesOptions): Promise<GateContract> {
    const load = await loadGateContract(opts.targetRoot)
    if (load.state === 'invalid') {
        throw invalidContractError(load.error)
    }
    if (load.state === 'ok') {
        return load.contract
    }
    return resolveGateContract(opts)
}

/**
 * Seed-like ensure: absent → resolve + write `.factory/gates.json`; present +
 * valid → untouched (project-owned); present + invalid → refuse loud (fix or
 * delete and re-scaffold — never silently regenerate a committed contract).
 */
export async function ensureGateContract(opts: ResolveGatesOptions): Promise<GateContractResult> {
    const load = await loadGateContract(opts.targetRoot)
    if (load.state === 'invalid') {
        throw invalidContractError(load.error)
    }
    if (load.state === 'ok') {
        return {status: 'present', stack: load.contract.stack, contract: load.contract}
    }
    const contract = await resolveGateContract(opts)
    const dest = join(opts.targetRoot, GATE_CONTRACT_REL)
    await mkdir(dirname(dest), {recursive: true})
    await writeFile(dest, JSON.stringify(contract, null, 2) + '\n', 'utf8')
    return {status: 'created', stack: contract.stack, contract}
}
