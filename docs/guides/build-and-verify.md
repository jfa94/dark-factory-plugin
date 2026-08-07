# How to Build and Verify the Engine

This is the contributor workflow for the TypeScript engine. The source is in
`src/` with colocated `*.test.ts`; the shipped artifacts are two checked-in
esbuild bundles in `dist/`.

## The one command

```bash
npm run verify
```

`verify` runs, in order: `typecheck` → `check:circular` → `lint` → `test` →
`build`. This is the contract CI enforces and the gate for a release-worthy state.
If it is green, the checkout is healthy and the bundles are current.

## The individual steps

| Step           | Command                                   | Notes                                                                             |
| -------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Type-check     | `npm run typecheck`                       | `tsc --noEmit`. **Use this, not `npx tsc`** — `npx tsc` is shadowed in this repo. |
| Circular check | `npm run check:circular`                  | `madge --circular --extensions ts src/`. Fails on any import cycle (see below).   |
| Lint           | `npm run lint`                            | `eslint .`                                                                        |
| Test           | `npm run test`                            | `vitest run` (one shot).                                                          |
| Test (watch)   | `npm run test:watch`                      | `vitest`.                                                                         |
| Build          | `npm run build`                           | `node scripts/build.mjs` → both bundles.                                          |
| Format         | `npm run format` / `npm run format:check` | `prettier`.                                                                       |

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

## The build output

`scripts/build.mjs` emits:

- `dist/factory.js` — from `src/bin/factory.ts` (the CLI).
- `dist/factory-hook.js` — from `src/bin/factory-hook.ts` (the hook dispatcher).

Both are full inlines (no `external`), so they run at a user's site with no
`node_modules` — `zod` and `proper-lockfile` are bundled in. A
`#!/usr/bin/env node` banner plus `chmod 0755` makes them directly executable;
they are kept un-minified so the checked-in artifact stays diff-reviewable.

**The bundles are committed.** When you change `src/`, re-run `npm run build` (or
`npm run verify`) and commit the regenerated `dist/` alongside your source change,
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
      npm run build
      git diff --exit-code -- dist/ templates/.github/scripts/shard-mutation-scope.mjs
```

Because `scripts/build.mjs` is a deterministic, dependency-inlined esbuild (no
`external`), `build(src)` is reproducible: rebuilding on CI and asserting the
working tree is unchanged proves the **committed `dist/` is exactly `build(src)`**.
That equivalence is what makes scanning `src/` sufficient — the scanned source and
the shipped artifact are provably the same code. The same `git diff --exit-code`
also covers the generated helper (`shard-mutation-scope.mjs`); its adjacent managed
test is ordinary source and runs against that bundle in scaffolded repositories. This catches the
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

## Versioning

The plugin version is `package.json#version`. Bump it per the significance of your
change (patch for fixes/refactors, minor for new backward-compatible capabilities,
major for breaking changes).
