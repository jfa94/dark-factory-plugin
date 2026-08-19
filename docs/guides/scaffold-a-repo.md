# How to Scaffold a Target Repo

Run this once per repository before any pipeline run. The factory refuses to start
against an unscaffolded or unprotected repo. `gh` is a hard dependency (the
protection probe and, with `--provision`, the protection write shell out to it).

## 1. Scaffold

From inside the target repo checkout:

```
/factory:scaffold [--repo <owner/name>]
```

Or call the CLI directly:

```bash
factory scaffold [--repo <owner/name>]
```

`--repo` is **optional**: when omitted it is auto-derived from the repo's `origin`
remote. Pass it only to override; an explicit value that disagrees with `origin`
fails loud.

This is idempotent. It:

- seeds the project-owned gate configs (`.stryker.config.json`,
  `.dependency-cruiser.cjs`, `eslint.config.mjs`) when the target is a Node package,
  resolves the repo's gate contract (`.factory/gates.json`), then writes the
  plugin-managed CI net (`.github/workflows/quality-gate.yml`, its
  `.github/scripts/shard-mutation-scope.mjs` helper, and — only when mutation is
  contracted — the warm-base `.github/workflows/mutation-nightly.yml`). The
  `.stryker.config.json` seed is deferred until the contract exists so its `mutate`
  globs render from the contracted mutation roots, and it is **shadow-guarded**:
  scaffold refuses to seed it when any sibling Stryker config already exists, naming
  the file Stryker's discovery would load instead. When the repo has no `src/`,
  scaffold detects mutable-source roots from the candidate dirs
  `app/components/lib/utils/db/server/hooks` and contracts them explicitly under
  `gates.mutation.roots`; it **refuses loudly** if mutation would contract with zero
  roots (add explicit roots or pass `--waive mutation`). See
  [Decision 75](../explanation/decisions.md#decision-75--mutation-ci-redesign-develop-only-warm-base-incremental-hash-shards-roots).
  The `quality-gate.yml` is
  **rendered per-repo from the gate contract** (Decision 53): the package-manager
  setup (lockfile-detected pnpm vs npm) and each gate step come from the contract, so
  CI runs the same checks the local merge gate enforces. npm-stack repos must commit
  a Node runtime declaration; scaffold selects `.node-version`, then `.nvmrc`, then
  `package.json#engines.node`, and renders that source as setup-node's
  `node-version-file` in both Quality and mutation jobs. Missing, malformed, or
  conflicting version-file declarations fail loud. When package.json is selected,
  scaffold also refuses `volta.node`, `volta.extends`, or `devEngines.runtime`
  fields that setup-node would prefer over `engines.node`. This render is **npm-stack
  only** — a `deno`/`custom` repo skips the CI net with a loud log and relies on the
  local `GateRunner`. The configured `quality.gateEnv` is **injected** into the
  rendered build step (set via `factory configure --set quality.gateEnv.<KEY>=<value>`),
  so one config drives both the factory's local merge gate and this repo's GitHub CI.
  An empty `gateEnv` leaves the build step's marker untouched, and a re-scaffold is
  byte-identical (drift is measured against the rendered file).

    **Repos whose test suite needs an environment booted in CI** (a local database, an
    emulator) declare it in the contract, not by hand-editing the managed workflow
    (Decision 73 — a hand-edited managed file makes the next scaffold refuse with
    `files_conflict`, see [step 2](#2-handle-a-files_conflict-refusal)). Add
    `setup_steps` to the
    committed `.factory/gates.json`:

    ```json
    {
        "version": 1,
        "stack": "npm",
        "gates": {"...": "..."},
        "setup_steps": [{"uses": "supabase/setup-cli@v1", "with": {"version": "latest"}}, {"run": "supabase start"}]
    }
    ```

    Each step is exactly one of `uses` (with optional `with` inputs) or `run`, plus an
    optional `name`. Re-run `factory scaffold`: the steps render after the
    package-manager install in BOTH the quality job and the mutation shards, and
    repeated scaffolds stay byte-stable;

- guarantees the `.gitignore` entries that keep factory state un-committed;
- emits / idempotently merges TWO target settings files, split by what is safe to
  commit:
    - `.claude/settings.json` (**committed**): the factory allow-list +
      `Read|Write|Edit(<data-dir>/**)` rules (tilde form when the data dir is under
      `$HOME`, absolute otherwise) + `worktree.baseRef:"head"`. Carries NO
      `additionalDirectories` — see below.
    - `.claude/settings.local.json` (**gitignored**, per-machine): the
      `permissions.additionalDirectories` entry so the built-in file tools reach the
      out-of-tree plugin data dir (`runs/`, `specs/`) without tripping the
      working-directory-boundary prompt. ALWAYS absolute — `~/` does not expand in
      `additionalDirectories` — which is exactly why it can't live in the committed
      file (it would leak `$HOME`/username and be wrong on another machine or CI).
      Written prune-then-add: a stale factory-managed entry (a literal
      `${CLAUDE_PLUGIN_DATA}` placeholder, a tilde form, or a previously-baked path
      that moved) is stripped and replaced on the next `factory scaffold` (which runs
      idempotently on every `/factory:run` preflight, so this self-heals with no
      separate migration step); the user's own entries are kept.

    Neither file ever ships the literal `${CLAUDE_PLUGIN_DATA}` placeholder — env-var
    interpolation in permission rules is unsupported and the var is hijackable by
    co-installed plugins, so a placeholder rule would match nothing; both bake the
    CLI-resolved canonical data dir instead. See [Decision 17](../explanation/decisions.md#decision-17-coarse-bash-allow-with-hook-enforced-defense-in-depth);

- probes branch protection on `develop` (the integration base) and **refuses loudly
  if it is missing**. Protection is two-profile
  ([Decision 74](../explanation/decisions.md#decision-74--run-scoped-develop-protection-two-profile-lifecycle),
  default `git.developProtection: "run-scoped"`): at rest develop carries only the
  **baseline** — `git.developBaselineStatusChecks` (derived default:
  `developRequiredStatusChecks` minus Mutation Testing → Quality + Security Scan) for
  non-admin PRs, admins bypass, no strict up-to-date — so you can push develop
  directly between runs. `run create` escalates to the strict profile; every
  run-terminal path drops it back.

Scaffold does **not** create or protect a shared `staging` branch. Each run cuts its
own private `staging-<run-id>` integration branch from `develop` at
[`run create`](../reference/cli.md#run-create) (Decision 33).

It prints a `ScaffoldReport`: `files_created`, `files_present`, `files_updated`
(outdated files auto-refreshed — both managed files and seed configs only while
provably pristine per the committed `.factory/scaffold.lock` hash record; commit the
lock alongside the seeds), `files_removed` (managed files deleted this run — a stale
`mutation-nightly.yml` is removed when mutation is uncontracted, but only while its
bytes provably match the lock; a customized one is a `files_conflict` that even
`--force-managed` will not delete), `protection` (enabled / strict-up-to-date / required checks /
provisioned), and `settings` (created / changed, plus a nested `local` with the same
shape for `.claude/settings.local.json`). A CUSTOMIZED seed config is
project-owned — reported under `files_present`, never overwritten (even a richer
superset of the shipped baseline is recognized as current, not drift); delete it and
re-scaffold to re-adopt the latest baseline.

## 2. Handle a `files_conflict` refusal

Managed files (the CI net) are plugin-authored by contract, but scaffold will not
clobber one you have edited. If a managed file matches neither the newly rendered
template nor the hash recorded in `.factory/scaffold.lock`, scaffold refuses with
`files_conflict` **before writing anything** — no seeds, no gate contract, no lock,
no protection changes:

```
files_conflict: managed file(s) differ from both the shipped template and the
recorded scaffold hash: .github/workflows/quality-gate.yml. Nothing was written…
```

Two ways forward:

```bash
# Keep the plugin's version — discard your local edits, then re-scaffold.
git checkout .github/workflows/quality-gate.yml
factory scaffold --repo <owner/name>

# Or re-adopt explicitly: overwrite the customized managed file(s) with the
# plugin template and re-record their hashes.
factory scaffold --repo <owner/name> --force-managed
```

A repo scaffolded before the lock recorded managed hashes will report a conflict on
its first re-scaffold even if it was never edited; `--force-managed` re-adopts it and
records the hashes, after which pristine files auto-update silently. If you need CI
behavior the template does not give you, express it in the committed gate contract
(`.factory/gates.json`) rather than by editing the managed workflow.

The same zero-write promise now covers the **gate-contract** refusals too — an
invalid `.factory/gates.json`, a below-floor contract, and the install-or-waive
refusal are all raised by a read-only preflight before the first seed lands, so any
failed `factory scaffold` leaves the working tree exactly as it found it.

One conflict `--force-managed` will **not** clear: a stale
`.github/workflows/mutation-nightly.yml` (mutation is uncontracted) whose bytes do
not match the recorded hash. Force authorizes overwriting toward the shipped
template, never deleting content of unknown provenance. Under `--force-managed` this
one file is **warned about and left in place** — it does not abort the run, and the
other conflicted managed files are still re-adopted:

```
--force-managed: re-adopting customized managed file(s): .github/workflows/quality-gate.yml
--force-managed: Note: .github/workflows/mutation-nightly.yml is STALE (mutation is
uncontracted) and its bytes don't match the recorded scaffold hash — --force-managed
cannot authorize DELETING unproven content; restore it (git checkout) or delete the
file yourself.
```

To clear it, restore it (`git checkout .github/workflows/mutation-nightly.yml`) and
re-scaffold to have it removed cleanly, or delete the file yourself. Without
`--force-managed` it is still a hard `files_conflict` refusal, listed alongside every
other conflicting managed file.

## 2a. Handle an unsupported lock version

```
scaffold: .factory/scaffold.lock declares version 2, but this engine supports
only version 1 — upgrade the factory plugin (or delete the lock to re-adopt
seeds). Nothing was written.
```

The repo was last scaffolded by a **newer** plugin. Upgrade the plugin rather than
working around it — the older engine cannot know the newer lock's shape, and
rewriting it as v1 would destroy the record. Deleting the lock is the escape hatch
of last resort: every seed then reads as customized (project-owned) until it is
re-adopted.

The refusal is by **value**, not by type: `"version": "2"` (a string) refuses exactly
like `2`, and the message quotes the value as JSON so the two are distinguishable in
the output. Do not "fix" the refusal by editing the `version` key — either upgrade the
plugin or delete the lock. A lock with no `version` key at all, or an unparsable one,
is not an unsupported version: it degrades fail-safe to an empty lock and every seed
reads as project-owned until re-adopted.

## 3. Handle a protection refusal

If scaffold refuses because `develop` is unprotected, you have two options.

**Provision it** (writes the mode's at-rest protection on `develop` — run-scoped:
baseline; permanent: strict):

```bash
factory scaffold --repo <owner/name> --provision
```

**Or protect it manually** in the repo settings — at minimum the baseline required
status checks (in `permanent` mode also strict "require branches to be up to date") —
then re-run `factory scaffold --repo <owner/name>` to re-verify.

Do not proceed against an unprotected repo: the serial-writer's correctness
depends on required-up-to-date protection while a run is active.

### Migrating a repo off the old permanent strict profile

Repos scaffolded before Decision 74 carry the strict profile permanently (blocking
direct pushes to develop). The one-shot fix is simply:

```bash
factory scaffold --provision        # downgrades develop to the baseline
```

(Refused while a run is active on the repo.) Alternatively, the first run that
reaches a terminal state after upgrading the plugin self-heals it, or write it by
hand:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/develop/protection --input - <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["Quality","Security Scan"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_deletions":true}
JSON
```

## 4. Tune the branch contract (optional)

The branches and required checks are configurable. To change them before
scaffolding:

```bash
factory configure --set git.baseBranch=develop
factory configure --set 'git.developRequiredStatusChecks=["Quality","Mutation Testing","Security Scan"]'
```

See [Configure the factory](./configure-the-factory.md) and the
[configuration reference](../reference/configuration.md).

## 5. Next

- Inspect or change settings: [Configure the factory](./configure-the-factory.md).
- Start a pipeline: [Run the pipeline](./run-the-pipeline.md).
