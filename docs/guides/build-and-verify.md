# How to Build and Verify the Engine

This is the contributor workflow for the TypeScript engine. The source is in
`src/` with colocated `*.test.ts`; the shipped artifacts are two checked-in
esbuild bundles in `dist/`.

## The one command

```bash
pnpm run verify
```

`verify` runs, in order: `typecheck` → `check:circular` → `lint` → `test` →
`build`. This is the contract CI enforces and the gate for a release-worthy state.
If it is green, the checkout is healthy and the bundles are current.

The package manager is **pnpm**, pinned by `package.json#packageManager`
(`pnpm@11.9.0`). `pnpm-lock.yaml` is committed and CI installs with
`--frozen-lockfile`, so a dependency change must land with its lockfile update.

## The individual steps

| Step           | Command                                     | Notes                                                                             |
| -------------- | ------------------------------------------- | --------------------------------------------------------------------------------- |
| Type-check     | `pnpm run typecheck`                        | `tsc --noEmit`. **Use this, not `npx tsc`** — `npx tsc` is shadowed in this repo. |
| Circular check | `pnpm run check:circular`                   | `madge --circular --extensions ts src/`. Fails on any import cycle (see below).   |
| Lint           | `pnpm run lint`                             | `eslint .`                                                                        |
| Test           | `pnpm run test`                             | `vitest run` (one shot).                                                          |
| Test (watch)   | `pnpm run test:watch`                       | `vitest`.                                                                         |
| Build          | `pnpm run build`                            | `node scripts/build.mjs` → both bundles.                                          |
| Format         | `pnpm run format` / `pnpm run format:check` | `prettier`.                                                                       |

## The no-circular-dependency gate

`check:circular` runs `madge --circular` over `src/` and fails if any module
import cycle exists. The engine holds itself to the same no-circular-dependency
bar it scaffolds into target repos (the `.dependency-cruiser.cjs` SEED file, see
[scaffold a repo](./scaffold-a-repo.md)): a cycle is a hard `verify` failure, not
advisory. Leaf modules exist precisely to break cycles — dependency-free interface
modules such as `src/shared/exit-codes.ts` and the `src/cli/registry-types.ts` /
`src/hooks/registry-types.ts` registry-interface extractions keep heavy modules
from importing each other transitively. When you add a cross-module type that
introduces a cycle, extract the shared declaration into a leaf rather than
suppressing the check.

## Running a subset of tests

Vitest takes a path filter, so scope to the module you are changing:

```bash
npx vitest src/verifier/deterministic
npx vitest src/cli/subcommands/run.test.ts
```

Tests must be independent (no shared mutable state). For functions with broad
input domains, prefer property-based tests to catch edge cases example-based tests
miss.

The suite is **not** limited to `src/`. `vitest.config.ts` includes
`['src/**/*.test.ts', 'scripts/**/*.test.mjs']`, so plain-JS repo tooling under
`scripts/` is covered by the same `pnpm run test` run as the engine — put a
`scripts/<tool>.test.mjs` next to any script whose logic is worth pinning, and
export the pure helpers from the script (guarding the CLI body behind an
entrypoint check) so the test can import them without executing the tool.

## The build output

`scripts/build.mjs` emits:

- `dist/factory.js` — from `src/bin/factory.ts` (the CLI).
- `dist/factory-hook.js` — from `src/bin/factory-hook.ts` (the hook dispatcher).

Both are full inlines (no `external`), so they run at a user's site with no
`node_modules` — `zod` and `proper-lockfile` are bundled in. A
`#!/usr/bin/env node` banner plus `chmod 0755` makes them directly executable;
they are kept un-minified so the checked-in artifact stays diff-reviewable.

**The bundles are committed.** When you change `src/`, re-run `pnpm run build` (or
`pnpm run verify`) and commit the regenerated `dist/` alongside your source change,
or CI will fail on a stale bundle.

### The build-integrity gate: `committed dist == build(src)`

The shipped artifacts are checked in, but the security scan (semgrep) is told to
ignore them — `.semgrepignore` excludes `dist/`, so the scan only ever sees `src/`.
That leaves a gap on its own: a hand-edited or stale bundle could ship code the
scan never inspected. A dedicated CI step in `.github/workflows/tests.yml` closes
it at the root:

```yaml
- name: Assert committed bundles match a fresh build (semgrep scans src, ships dist)
  run: |
      pnpm run build
      git diff --exit-code -- dist/ templates/.github/scripts/shard-mutation-scope.mjs
```

Because `scripts/build.mjs` is a deterministic, dependency-inlined esbuild (no
`external`), `build(src)` is reproducible: rebuilding on CI and asserting the
working tree is unchanged proves the **committed `dist/` is exactly `build(src)`**.
That equivalence is what makes scanning `src/` sufficient — the scanned source and
the shipped artifact are provably the same code. The same `git diff --exit-code`
also covers the templates build output (`shard-mutation-scope.mjs`), catching the
case where someone edits a bundle by hand or forgets to rebuild and commit. The
step fails loud on any drift.

This is the CI half of the invariant; the scaffold-doc half (how the template
artifact reaches downstream repos) lives in
[Decision 15](../explanation/decisions.md).

## The CLI registry seam

To add a subcommand, create `src/cli/subcommands/<name>.ts` exporting a
`Subcommand` (`{ describe, run }`), then register it in the frozen registry in
`src/cli/main.ts`. The thin entry `src/bin/factory.ts` is the only place that
calls `process.exit`. Hooks follow the same pattern via `src/hooks/main.ts`.

## The coverage ratchet

CI runs coverage as a separate step after `verify`:

```bash
pnpm exec vitest run --coverage
```

Thresholds live in `vitest.config.ts` under `test.coverage.thresholds` (v8
provider). They are a **ratchet**, not an aspiration: each number is the
then-current full-suite result rounded DOWN to one decimal, so the step fails only
on a regression. When coverage rises durably, raise the floor in the same commit;
never lower it to make a change pass.

## The plugin CI pipeline

`.github/workflows/tests.yml` has two jobs:

| Job       | What it does                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify`  | pnpm setup (from `packageManager`) → `pnpm install --frozen-lockfile` → `version:check` → `pnpm run verify` → coverage ratchet → the build-integrity gate below. |
| `semgrep` | SAST over authored source (`p/typescript`, `p/security-audit`, `p/secrets`), scoped by `.semgrepignore`.                                                         |

Every third-party action is **pinned to a full commit SHA** with the human-readable
tag in a trailing comment. Keep it that way when bumping an action: a tag is
mutable, a SHA is not.

The workflow declares a top-level `permissions: contents: read`. Nothing in it
writes to the repo or its APIs, so the `GITHUB_TOKEN` it hands to third-party
actions is read-only. If you add a job that genuinely needs to write, scope the
extra permission to **that job**, not the workflow.

## Versioning

The plugin version is `package.json#version` — the **canonical** source. Two
manifests must mirror it: `.claude-plugin/plugin.json` and the `plugins[0]` entry of
`.claude-plugin/marketplace.json`. `scripts/version.mjs` owns that invariant:

```bash
pnpm run version:check   # exits 1 naming any drifted manifest (CI runs this)
pnpm run version:sync    # rewrites both manifests from package.json
```

Bump `package.json#version` per the significance of your change (patch for
fixes/refactors, minor for new backward-compatible capabilities, major for breaking
changes), then run `version:sync` and commit all three files together. Never edit
the manifest versions by hand — `version:check` is a CI step and will fail on drift.

Both verbs fail loud rather than guessing:

- `package.json#version` must be **canonical SemVer 2.0.0** (core triple, optional
  prerelease and build metadata). A non-conforming value aborts both verbs instead
  of being propagated into the manifests.
- `sync` does a targeted replace of the `"version"` literal only — a full
  re-serialize would reformat unrelated manifest content on every bump. If the
  expected literal is absent from a manifest, it throws naming that file rather
  than leaving it silently unwritten.

The pure helpers (`readCanonicalVersion`, `manifestDrift`, `bumpVersionLiteral`)
are exported and covered by `scripts/version.test.mjs`; the CLI body runs only when
the script is the entrypoint.
