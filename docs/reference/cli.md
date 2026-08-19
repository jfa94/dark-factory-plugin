# CLI Reference

The `factory` CLI is the deterministic engine — it owns ALL pipeline control
flow and exposes exactly ONE seam, the **orchestrator** (`next-task` + `next-action`). Every
subcommand prints exactly one JSON document to stdout (or `--summary` human text
for `state`); `--help` on any subcommand prints its contract. The binary is
`dist/factory.js`, reached on `PATH` as `factory` via the `bin/factory` shim.

Subcommands are **reporters** (read-only; emit an envelope), **the orchestrator** (`next-task`
records nothing; `next-action --results` records an agent spawn's output into ONE state
step; `run docs --results` records a scribe spawn's output likewise), or **writers** (one
state mutation). `run create`, `run finalize`, `run stop`, `run cancel`, `scaffold`, and the
orchestrators' (`next-action` ship / `run docs` record) side effects perform actions (state and/or
GitHub side effects). The orchestrator seams spawn nothing themselves — they emit a spawn request
the runner spawns from (see [Model A](../explanation/model-a.md)).

Run/spec state is read from and written to `$CLAUDE_PLUGIN_DATA`.

## Global behavior

- No args / `--help` / `-h` → prints the registry, exits `0`.
- Unknown subcommand → stderr message, exits `2` (USAGE).
- A subcommand's own usage error → exits `2`; any other error → exits `1`.
- `run create` against an already-active run → exits `3` (CONFLICT) — see
  [`run create`](#run-create).

See [exit-codes.md](./exit-codes.md).

---

## `config-defaults`

Reporter. Prints the fully resolved config (defaults + any `config.json` overlay)
as JSON. Doubles as a smoke test of the config loader.

```
factory config-defaults
```

## `configure`

Inspect or edit the persisted config overlay. Every edit round-trips through the
schema before it touches disk; an invalid value is a loud error, never persisted.
Writes are a sparse overlay, so future default changes stay visible.

```
factory configure                          # print the resolved config
factory configure --get <key.path>         # print one resolved value
factory configure --set <key.path=value>   # set (repeatable), validate, persist
factory configure --unset <key.path>       # revert a key to its default (repeatable)
```

Values parse as JSON when possible (numbers, booleans, arrays), else as a bare
string. `--get` cannot be combined with `--set`/`--unset`. Example:
`factory configure --set quality.holdoutPercent=25`. Keys are in
[configuration.md](./configuration.md).

## `scaffold`

Action. Prepares a target repo for the pipeline in a **two-pass** template loop
(Decision 53): pass 1 seeds the project-owned gate configs (`.stryker.config.json`,
`.dependency-cruiser.cjs`, `eslint.config.mjs`) for Node packages; then it resolves
the repo's gate contract (`.factory/gates.json`); then pass 2 writes the managed CI
net (`.github/workflows/quality-gate.yml` and its shard helper). It also ensures the
`.gitignore` guard and probes branch protection on `develop` (the integration base)
— **refusing loudly** when `develop` is not protected, unless `--provision` is set.
Per-run `staging-<run-id>` branches are minted at [`run create`](#run-create);
scaffold no longer creates or protects a shared `staging` branch.

The CI net is **rendered per-repo from the resolved gate contract**, not copied
verbatim — `renderQualityGate` (`src/ci/render-quality-gate.ts`) fills the template's
`# factory:*` markers with the target's package-manager setup (lockfile-detected pnpm
vs npm) and per-gate steps, so CI runs the same checks the local `GateRunner` enforces.
An npm-stack target must commit `.node-version`, `.nvmrc`, or a non-empty string at
`package.json#engines.node`. Precedence is `.node-version` → `.nvmrc` → package.json;
the two version files must agree when both exist. The selected file is rendered as
setup-node's `node-version-file` for Quality and mutation jobs, so scaffold never
infers CI's runtime from the operator's host. If package.json is selected,
`volta.node`, `volta.extends`, and `devEngines.runtime` are refused because setup-node
would silently prefer them over `engines.node`. Each gate step resolves in precedence
order: contracted `command` override → GateRunner built-in (`npx tsc --noEmit`, `npx eslint .`,
`npx vitest run`, `npm run build`); an uncontracted gate is omitted with an audit
comment, and a waived `mutation` gate collapses to a vacuous-green aggregator job kept
named exactly `Mutation Testing` (so the required-check context stays universal).
The render is **npm-stack only** — a `deno`/`custom` contract skips the CI net with a
loud log and relies on the local GateRunner (a hardcoded workflow would fail at its
install step).

The configured `quality.gateEnv` (set via `factory configure --set quality.gateEnv.<KEY>=<value>`)
is **injected into the rendered `quality-gate.yml`** — `injectGateEnvIntoWorkflow`
(`src/ci/inject-gate-env.ts`) composes over the render, replacing the template's
`# factory:gate-env` marker with a real `env:` block — so one config drives both the
local merge gate and this repo's GitHub CI. Drift is measured against the _rendered_
managed file, so it stays byte-identical across re-runs; an empty `gateEnv` leaves the
marker untouched.

The develop-protection probe is two-profile (Decision 74). In the default
`git.developProtection: "run-scoped"` mode it asserts the **baseline**:
`git.developBaselineStatusChecks` (default derived: `git.developRequiredStatusChecks`
minus `"Mutation Testing"` → `["Quality", "Security Scan"]`), strict
NOT required, `enforce_admins: false` — the strict run profile
(`git.developRequiredStatusChecks`, default
`["Quality", "Mutation Testing", "Security Scan"]`, strict, admins enforced) is
escalated by [`run create`](#run-create) and dropped back at every run terminal. In
`permanent` mode the probe asserts the strict profile, as before D74. Run-scoped
`--provision` writes the baseline (this is also the one-shot migration off the old
permanent profile) and refuses while a run is active on the repo. The per-run staging
branch's checks come from `git.stagingRequiredStatusChecks` (default empty) at
[`run create`](#run-create).

```
factory scaffold [--repo <owner/name>] [--provision] [--waive mutation|coverage] [--force-managed]
```

| Flag                  | Required | Notes                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <owner/name>` | no       | Target GitHub repo (used for the protection probe). Auto-derived from the `origin` remote when omitted; an explicit value that disagrees with it fails loud.                                                                                                                                                                                                                                   |
| `--provision`         | no       | Write the mode's at-rest protection on develop (run-scoped: baseline; permanent: strict). Default: refuse when unprotected.                                                                                                                                                                                                                                                                    |
| `--waive mutation`    | no       | Record the mutation gate as deliberately waived in the contract instead of refusing when stryker is not installed.                                                                                                                                                                                                                                                                             |
| `--waive coverage`    | no       | Record the coverage gate as deliberately waived instead of refusing when no vitest coverage provider is installed.                                                                                                                                                                                                                                                                             |
| `--force-managed`     | no       | Re-adopt conflicted MANAGED files: overwrite a customized managed file with the plugin template and re-record its hash. Default: refuse (`files_conflict`). Never authorizes DELETING a customized/unknown stale nightly (below) — force only overwrites toward the shipped template; such a nightly is warned about and left in place, and does not block the re-adoption of the other files. |

### Managed-file ownership is fail-safe

Managed files (the CI net) are plugin-authored by contract, but a re-scaffold no
longer clobbers them blindly. `.factory/scaffold.lock` gained a `managed` hash map
alongside `seeds`, and a **preflight runs before any write**:

| On-disk managed file                                         | Outcome                                              |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| byte-equal to the new render                                 | no-op (`files_present`)                              |
| differs from the render but matches the lock's recorded hash | **pristine** → auto-update (`files_updated`)         |
| differs from both (customized, or no lock entry)             | **`files_conflict` refusal — ZERO writes**           |
| differs from both, `--force-managed` given                   | overwrite + re-record the hash (logged as a warning) |

A `files_conflict` aborts the whole command before any seed, gate contract, lock,
or protection change lands, and names the offending files; restore them
(`git checkout`) or pass `--force-managed`. The `managed` key is additive to lock
version 1, so an older engine ignores it and degrades safely, and a legacy lock
with no `managed` entries simply reports a conflict instead of silently clobbering.

**Every refusal is zero-write.** Before the managed preflight, a **read-only gate
contract preflight** (`preflightGateContract`) resolves the contract this run will
end up with — the committed `.factory/gates.json` when valid, else a fresh
resolution with this run's to-be-seeded files projected as present (a to-be-seeded
`eslint.config.mjs` flips the lint gate). So an invalid `gates.json`, a below-floor
contract, and the install-or-waive refusal all throw **before any seed, lock, or
workflow is written**, and the managed preflight compares against the same renders
pass 2 will write. The authoritative `ensureGateContract` still runs after seeds and
its result is what gets persisted.

**Lock versions.** A `.factory/scaffold.lock` whose `version` key is present and is
anything other than the number `1` refuses loudly with `UnsupportedLockVersionError`
and writes nothing — upgrade the plugin, or delete the lock to re-adopt seeds from
scratch. The check is by value, not by type: `2`, `"1"`, `"2"`, `true` and any other
non-`1` value all refuse, and the error renders the offending value JSON-quoted so
`2` and `"2"` are distinguishable. A lock with **no** `version` key, or one that is
malformed/unparsable, still degrades to an empty lock (every seed then reads as
customized — fail-safe) and is rewritten valid on the next persist.

When mutation is **uncontracted** in the gate contract but a previously scaffolded
`.github/workflows/mutation-nightly.yml` still exists, scaffold removes the stale
workflow — but only with **current proof**: its bytes must match the lock's
recorded managed hash (re-verified immediately before the delete). A customized or
unknown stale nightly is never deleted; `--force-managed` cannot authorize it:

| Stale nightly, bytes match neither render nor lock hash | Outcome                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| no `--force-managed`                                    | `files_conflict` refusal — zero writes, the nightly named alongside any other conflicts        |
| `--force-managed`                                       | **warn, leave in place** — other conflicted managed files are still re-adopted in the same run |

Restore it (`git checkout`) or delete it yourself. A successful removal drops the lock
entry and lands in `files_removed`.

Emits a `ScaffoldReport`: `{ repo, files_created, files_present, files_updated,
files_removed, protection, settings }`. `files_removed` (always present) carries
managed files deleted this run — currently only the stale mutation nightly above.
`files_updated` carries the outdated files auto-refreshed
this run: managed CI-net files **only while provably pristine** (above), and SEED
gate configs **only while pristine** — their bytes still matching the hash the committed
`.factory/scaffold.lock` recorded when scaffold wrote them
([Decision 15](../explanation/decisions.md#decision-15-project-scaffolding)). A
customized seed (or one with no lock entry — e.g. scaffolded before the lock
existed) is project-owned: reported under `files_present`, never overwritten, never
flagged (no `files_outdated`). Delete a seed and re-scaffold to re-adopt the latest
baseline. A narrow migration exception recognizes the two exact historical
`e2e/example.spec.ts` hashes that disabled the unregistered
`playwright/no-skipped-test` rule; those pristine bytes upgrade once and enter the
lock. Any customization changes the hash and remains untouched.

## `spec <resolve|gate|store>`

Reporter. The deterministic spec-build seam. The spec pipeline needs two agent
spawns (spec-generator + spec-reviewer), which the runner owns; the CLI owns
the deterministic glue. State is threaded through a transient scratch dir
(`<os-tmpdir>/factory-spec-build/spec-build/<repo-key>/<issue>/{prd,generated,verdict}.json`)
rooted at the **OS temp dir** (`defaultSpecBuildRoot()`, `src/core/state/paths.ts`),
**not** the plugin data dir the durable/ephemeral stores use — these files are
pre-validation agent output that never needs to survive one generate/review loop.
The `SpecBuildDeps.scratchRoot` field carries this root independently of the
durable-store `dataDir` (`src/spec/build.ts`); tests inject their own isolated tmp
root. Each action takes `--repo` + `--issue` and emits one envelope naming the next
step.

```
factory spec resolve --repo <owner/name> --issue <n> [--supersede]
factory spec gate    --repo <owner/name> --issue <n>
factory spec store   --repo <owner/name> --issue <n>
```

- **resolve** — reuse an existing spec for the issue (`{kind:"reuse", pointer}`),
  else fetch the PRD and emit the generate spawn (`{kind:"generate", spawn,
prd_path, generated_path, max_iterations}`). Before emitting `generate`, a
  **deterministic specifiability gate** ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park))
  screens the raw PRD body (≥200 non-heading chars, ≥1 extractable requirement, and
  either an acceptance-criteria-style heading OR nested per-requirement criteria —
  testable sub-bullets under each requirement, the `/write-a-prd` template shape;
  [Decision 56](../explanation/decisions.md#decision-56--specifiability-gate-accepts-nested-per-requirement-criteria)).
  A PRD that fails is refused loud and terminal —
  `{kind:"unspecifiable", prd_path, blockers}` on stdout **and exit `1`** (the exit
  enum is frozen; the envelope `kind` is the machine discriminator) — before any agent
  spawn, so an unspecifiable PRD costs zero agent turns. `resolve` also persists a
  **durable PRD snapshot** (`prd.json`) beside the spec: `reuse` backfills it once via
  `gh` when a pre-Decision-47 spec lacks it, and `store` writes it on first
  generation. The traceability phase audits this snapshot, never a re-fetch. - `--supersede` — delete the durable spec dir for the issue (`SpecStore.deleteByIssue`,
  idempotent) **before** the reuse check, so resolve always falls through to
  `generate` and the runner regenerates the spec from the PRD. The runner's
  `/factory:run --supersede` forwards this flag into Phase 1 so a superseding run
  does not inherit the same broken spec it is trying to escape. Deletion is
  mandatory — regenerating without deleting risks two dirs for one issue, which
  `resolveByIssue` treats as a store-integrity error.
- **gate** — run the deterministic spec gates over the generator output; emit
  `{kind:"revise", source:"gate", blockers, spawn, …}` on a block, else the review spawn
  (`{kind:"review", spawn, verdict_path, …}`).
- **store** — adjudicate the review (single 56/60 threshold + any-dimension floor);
  emit `{kind:"revise", source:"review", blockers, spawn, …}` on NEEDS_REVISION, else
  persist and emit `{kind:"stored", pointer}`.

The runner loops generate ⇄ review (bounded by `max_iterations`) until
`reuse` or `stored`.

**Revise carries the prior spec — incremental patch, not a re-author.** A `revise`
envelope is symmetric with `generate`/`review`: it carries its own apex-pinned `spawn`
request (`buildReviseSpawn`, `src/spec/agents.ts`) whose `context` embeds the PRIOR
spec (`prior_spec_md` + `prior_tasks`) alongside the `review_feedback` blockers to clear.
The runner spawns the generator straight from `env.spawn.context` — it does **not**
hand-assemble context at the prompt layer. The generator applies the minimal edits needed
to clear the blockers and re-emits the full `GenerateResult`, preserving everything else.
This closes a regression where the re-spawned generator, given only the PRD + blocker
strings in a fresh context, re-authored from scratch and failed previously-satisfied
requirements and traceability lines. `store`'s revise reads `prd.json` from the scratch
dir (durable across the loop) to rebuild that context.

The three spawn `context` shapes are typed in `src/spec/agents.ts` (`GenerateContext`,
`ReviseContext extends GenerateContext`, `ReviewContext`) so the builders return precise
`SpecSpawnSpec<C>` types and a missing/typo'd revise-context key is a compile error. Adding
the `<C>` type parameter does not change the serialized JSON (the revise `spawn` field itself
is new — see above). The revise envelope's `blockers` is `readonly`; the
invariant is that `spawn.context.review_feedback` is derived from `blockers` at the single
construction site. The prior-spec fields are also untrusted: because `prior_spec_md` /
`prior_tasks` derive from the untrusted PRD, the `spec-generator`'s Untrusted Input Contract
treats them and `review_feedback` as data to patch, never directives to obey.

## `run <create|finalize|traceability|docs|e2e-assess|e2e|stop|cancel>`

### `run create`

Action. Resolves a durable spec, creates a fresh run, seeds one `pending` task per
spec task, cuts + GitHub-protects the run's `staging-<run-id>` integration branch
from `develop` (Decision 33), and — in run-scoped protection mode (D74) —
**escalates develop** to the strict run profile (`git.developRequiredStatusChecks`,
strict up-to-date, admins enforced) before the run row persists, then emits
`{kind:"created", run, gates}`. Seeding copies only dependency edges (`depends_on`); neither `risk_tier` nor
`tdd_exempt` is persisted — both read live from the spec (Decision 25). Duplicate, self, dangling, or cyclic dependency edges fail
loudly at seed time.

The `gates` field on the `created`/`superseded` envelope is the **gates-in-force**
enumeration (S3, `{contracted, skipped, warnings}`) derived from the repo's committed
`.factory/gates.json` — see [Gates in force](./automated-gates.md#gates-in-force-s3).
Each dropped **floor** gate (a `DEFAULT_GATES` id — `test`/`tdd`/`type`, plus `build`
on non-deno stacks — left `contracted: false`) is additionally warned on **stderr**,
since a hand-edited contract that drops a floor gate is the one misconfiguration TCB
write-protection cannot catch.

```
factory run create [--repo <owner/name>] (--issue <n> | --spec-id <id>) [--run-id <id>]
                   [--new] [--supersede | --resume] [--no-ship] [--e2e]
                   [--approve-spec] [--ignore-quota] [--session-id <id>]
```

| Flag                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--repo <owner/name>` | **Optional.** Repo identity (the first key of the spec store). Auto-derived from the `origin` remote when omitted; an explicit value that disagrees with the remote fails loud.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `--issue <n>`         | PRD issue number — the stable lookup key. One of `--issue`/`--spec-id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--spec-id <id>`      | Explicit `<issue>-<slug>` spec id. Mutually exclusive with `--issue`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `--run-id <id>`       | Override the generated `run-YYYYMMDD-HHMMSS` id (determinism/tests). A named id forces a fresh create.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `--new`               | Force a fresh run, bypassing the active-run conflict scan.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--supersede`         | If an active run exists for this spec, mark it `superseded`, delete its `staging-<run-id>` branch (auto-closing its task PRs), drop develop to baseline protection (run-scoped, no sibling run), then create a fresh run (which re-escalates). Emits `{kind:"superseded", run, supersededId}`. Mutually exclusive with `--resume`. **Run-level only** — `run create` does not touch the durable spec; the runner regenerates it by forwarding `--supersede` into Phase 1's [`spec resolve`](#spec-resolvegatestore) (skipped when `--spec-id` is used).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `--resume`            | If an active run exists, do not create — return the conflict (exit `3`) so the caller hands off to [`resume`](#resume). Mutually exclusive with `--supersede`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--no-ship`           | Open the task/rollup PRs but never merge. **Default (omit): live** — serial-merge each task into the run's `staging-<run-id>` branch and the rollup into develop. Persisted as `ship_mode` so the runner + resume + finalize read it without re-passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `--e2e`               | Opt into the run-level **e2e phase** ([Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag), overhauled by [Decision 40](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)): a run-start **e2e-assessment** resolves boot config + machinery before any task, then after every task is terminal, author + run Playwright journeys against the integrated staging app before docs/finalize; a mappable failing journey reopens its task with feedback, an unmappable pre-existing failure is **adjudicated**. Persisted as `e2e: true`. **Create-only + immutable on resume**, exactly like `--no-ship` — rejected loud if paired with `--resume`. **Eagerly checks three static prerequisites at create time** — `package.json`, a `@playwright/test` dependency, and a `playwright.config.ts` — and fails loud if any is missing; `e2e.startCommand`/`e2e.baseURL` are optional overrides, not requirements (the assessment resolves them). It **also refuses (S4) a `playwright.config.ts` whose declared `testDir` is not the TCB-covered literal `e2e`/`./e2e`** (an absent declaration fails closed too — Playwright defaults to `tests`, outside the TCB write-deny), so a suite the write-guard cannot see never enters a run. See [Run with end-to-end tests](../guides/run-with-e2e.md). |
| `--approve-spec`      | **Create-only opt-in, default OFF** ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park)). Creates the run in full (staging cut, tasks seeded), then parks it `suspended` for human spec sign-off **before any agent runs** — ONE state write, **no quota checkpoint** (a non-quota suspend never writes one). The `created`/`superseded` envelope gains `spec_approval: {spec_path, note}` naming the `spec.md` to review; exit stays `0`. `factory resume` **is** the sign-off (`planResume` clears non-quota suspends unconditionally). Rejected loud if paired with `--resume`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `--ignore-quota`      | Bypass the weekly-quota hard stop **and** the per-step quota pacer for this run. Persisted as `ignore_quota: true` so both orchestrators + runners skip the gate without re-passing. Lets create/supersede proceed even when the existing run is 7d-parked. Operator override for a mistaken suspend / manual reset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `--session-id <id>`   | Owning Claude Code session id for the session-scoped Stop gate. Defaults to `$CLAUDE_CODE_SESSION_ID`. **Always required — no exemption (Decision 42)**: an ownerless run is rejected as a usage error (the Stop hook finalizes via `findActiveByOwner`, which can never match an ownerless run).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

**Autonomy gate (mandatory, no opt-out):** `run create` HALTS loud (`NotAutonomousError`,
exit 1) unless the session is autonomous (`FACTORY_AUTONOMOUS_MODE=1`). The pipeline runs
unattended by design; `/factory:run` calls [`factory autonomy preflight`](#autonomy-preflight)
first, which builds the settings in memory and prints the inline-settings
`claude --worktree --settings '<json>'` relaunch command when needed (`ensure`/`status`
remain the manual primitives). See
[Decision 29](../explanation/decisions.md#decision-29-autonomy-is-mandatory--enforced-in-the-engine-no-opt-out)
and [Decision 31](../explanation/decisions.md#decision-31-run-entry-preflight-auto-scaffolds-autonomous-settings).

Loud error if no spec exists for the issue — generate one first. `run create` also
**preflights the durable PRD snapshot** ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park)):
the end-of-run traceability phase audits `prd.json`, so a spec that predates the
snapshot fails create loud with the backfill remedy (`factory spec resolve --issue <n>`,
or `--supersede` to regenerate) rather than a full-run-cost failure. The in-protocol
`spec resolve` always backfills first; this guards the off-protocol `--spec-id` path.
The runner (the in-session event loop) drives up to `maxParallelTasks` ready tasks
concurrently (see [Run the pipeline](../guides/run-the-pipeline.md)).

**Active-run conflict (Decision 35 — no silent reuse).** A PRD has at most one active
run at a time. `run create` does **not** reuse an existing run: when a non-terminal
run already exists for this `(repo, spec_id)`, it exits `3` (CONFLICT) and emits
`{kind:"exists", existing:{run_id, status}}`. Two escapes resolve the conflict:

- `--supersede` — mark the old run `superseded`, delete its `staging-<run-id>` branch
    - PRs, and create a fresh run (`{kind:"superseded", run, supersededId}`).
- `--resume` — return the conflict so the caller hands off to [`resume`](#resume).

`--new` (or an explicit `--run-id`) bypasses the conflict scan and forces a fresh
run unconditionally. The scan→create is serialized under a per-`(repo, spec_id)` lock
so two concurrent same-spec creates cannot both mint an orphan. `--resume` simply
reports the conflict (`kind:"exists"`) for the caller to hand off to [`resume`](#resume);
it does **not** validate the create-time `--no-ship` flag against the live
run — flag-compatibility belongs to the resume hand-off, not a premature gate here, so a
resumed run keeps its own persisted dials regardless. Emits `{kind:"created", run}` on
the fresh-create path.

**Weekly-quota hard stop (distinct from the generic conflict).** When the existing run
is **weekly-parked** — `status === "suspended"` _and_ `quota.binding_window === "7d"` —
`run create` blocks **every** new-run attempt for the spec (the default path, `--new`,
and `--supersede` alike), not just a bare re-create. It exits `3` (CONFLICT) and emits a
distinct envelope: `{kind:"pause", scope:"7d", run_id, status, reason,
resets_at_epoch?}`. The caller must treat this as a hard stop — report the reason and
reset horizon and tell the operator to `factory resume` after the window resets, NOT offer
the supersede/resume choice. Three carve-outs: a **5h pause** and an **`unavailable`
suspend** (no `binding_window`) are never blocked; the **`--resume` intent** falls through
to the ordinary `kind:"exists"` conflict (the `resume` door re-checks the live window); and
**`--ignore-quota`** overrides the block, letting create/supersede proceed. See
[Quota pacing — the weekly-quota hard stop](../explanation/quota-pacing.md#the-weekly-quota-hard-stop-on-run-create).

### `run finalize`

Action. Turns an all-terminal run into its shipped outcome, in resume-safe order:
build the report (`report.md`), emit telemetry, then — **when the run failed** —
post ONE comment on the originating PRD issue listing every failed task (deduped via
a hidden run marker, Decision 36; the PRD stays open), or — **only when the run
completed** (Decision 34: develop receives whole PRDs only) — forward-reconcile
`develop` into the run branch (no force-push), open + CI-gate + (in `live` mode)
squash-merge the `staging-<run-id> → develop` rollup, comment on + close the
originating PRD issue, and delete the per-run branch; finally flip the run terminal
**last**. A `failed` run leaves `develop` untouched, the PRD open, and keeps its
branch for rescue. Loud if any task is still non-terminal. Idempotent (a re-entered
finalize posts no duplicate comment).

```
factory run finalize [--run <id>] [--no-ship]
```

Ship mode defaults to the run's **persisted `ship_mode`** (set at `run create`); no flag
is needed. `--no-ship` overrides it to no-merge for THIS finalize only (opens the
`staging-<run-id> → develop` rollup PR but never merges). Emits
`{kind:"finalized", run, report, rollup?, failure_comment_posted}`.

A **failed traceability phase** ([`run traceability`](#run-traceability), Decision 47)
overrides the terminal status to `failed` here: finalize blocks the rollup, leaves
`develop` untouched, and the PRD comment carries an "Unmet PRD requirements" block —
the same "never ship silently" path a failed e2e phase takes.

### `run traceability`

Orchestrator (emit + record), symmetric with [`run docs`](#run-docs): the run-level
**PRD-traceability phase** ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park)),
scheduled once per **non-debug** run **between the e2e phase and docs**, on every
prospectively-`completed` run (`+1 Opus` per run). The CLI **never spawns the auditor** —
a runner does.

```
factory run traceability [--run <id>] [--results <path>]
```

- **Emit** (no `--results`): reads the durable PRD snapshot (`prd.json`), extracts its
  numbered requirements (LOUD if none — the specifiability gate should have refused such a
  PRD), fetches `origin/<baseBranch>` + the staging tip, prepares a **detached, read-only**
  auditor worktree at `worktrees/<run-id>/.trace` (under `worktrees/`, not `runs/`, so the
  TCB `data-runs` write-deny does not fire; no branch to GC), and returns a `spawn` request
  `{kind:"spawn", run_id, worktree, base_ref, staging_branch, model:"opus", max_turns, prompt}`.
  The prompt embeds the requirements as the **axiom** and directs the `traceability-auditor`
  agent (`agents/traceability-auditor.md`) to judge ONLY the whole-PRD diff
  (`git diff base_ref..HEAD`) and resulting tree — never task statuses or review verdicts.
  Idempotent on resume; a crash-retry resets the worktree to the staging tip.
- **Record** (`--results <path>`): reads the auditor's
  `{status:"<STATUS line>", verdicts:[{index, verdict:"met|partial|unmet", evidence}]}`
  envelope. On a `DONE` status it enforces **semantic coverage** (exactly one verdict per
  requirement `1..n`, LOUD on a gap/dup), persists one row per requirement (keyed by
  requirement **text**, not index) in the run-state `traceability` phase marker, removes the
  worktree, then concludes:
    - `{kind:"done", run_id}` — no `unmet` verdict (a `partial` **passes** the gate but
      surfaces as a `traceability_gaps` row in the report). The run proceeds to docs.
    - `{kind:"failed", run_id, reason}` — any `unmet` verdict. A verdict is judgment, **not
      retried**; finalize condemns the run (rollup blocked), and the report/PRD comment carry
      the unmet requirements.

    A **crashed/non-`DONE` auditor** increments `attempts` and, below `MAX_TRACE_ATTEMPTS` (2),
    suspends the run for a retry (`{kind:"suspend", …}`) **without** a quota checkpoint (resumable
    via `/factory:resume`); at the cap it concludes `{kind:"failed", …}` — the **anti-docs delta**:
    docs at cap degrades to best-effort-done, but the delivery gate never ships an unaudited run.

`next-task` schedules `traceability` after e2e and before docs, so a failed audit never
reaches the docs or rollup steps. Debug runs skip the phase (their review⇄fix loop IS their
traceability).

### `run docs`

Orchestrator (emit + record), symmetric with [`next-action`](#next-action): the engine-owned
documentation phase ([Decision 37](../explanation/decisions.md#decision-37--documentation-is-an-engine-phase-before-finalize)).
The CLI **never spawns scribe** — a runner does.

```
factory run docs [--run <id>] [--results <path>]
```

- **Emit** (no `--results`): prepares a docs worktree on a `docs-<run-id>` branch off
  the run's `staging-<run-id>` tip and returns a `DocsAction` spawn request
  `{kind:"spawn", run_id, worktree, base_ref, staging_branch, docs_branch, model, max_turns, prompt}`.
  `base_ref` is `origin/<baseBranch>` (the whole-PRD diff base); the prompt directs
  scribe to `cd` into the worktree, diff `base_ref..HEAD`, update `/docs`, and commit
  **in the worktree without pushing**. Idempotent on resume — an existing worktree from
  a prior failed attempt is reused, not re-created.
- **Record** (`--results <path>`): reads a `{status:"<scribe STATUS line>"}` JSON file. On
  `STATUS: DONE` **or `DONE_WITH_CONCERNS`** (both parse to `done` — `src/producer/agents.ts`),
  fast-forward/merges `docs-<run-id>` into `staging-<run-id>`, pushes the
  staging branch (scribe's commit, if any, rides along), removes the worktree, marks the
  `docs` phase `done`, and returns `{kind:"done", run_id}`. On any other status
  (`BLOCKED`/`NEEDS_CONTEXT`/unparseable),
  increments the `docs.attempts` counter and writes a `failed` docs marker. While
  `attempts < MAX_DOCS_ATTEMPTS` (2) it transitions the run to **suspended** (the staging
  branch + worktree are kept for retry) and returns `{kind:"suspend", run_id, reason}`;
  once the cap is hit it treats docs as best-effort and returns `{kind:"done", run_id}`
  so the run finalizes `completed` without a docs commit rather than suspend-looping.

The runner runs `run docs` only when [`next-task`](#next-task) emits `document`. `next-task`
withholds `finalize` until the `docs` phase is `done`, so `run finalize` never
ships a half-documented rollup.

### `run e2e-assess`

Orchestrator (emit + record), symmetric with [`run docs`](#run-docs)/[`run e2e`](#run-e2e):
the **run-start e2e-assessment** phase ([Decision 40 D3](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)),
scheduled once per `--e2e` run **before any task executes**. The CLI **never spawns the
e2e-assessor** — a runner does. A run created without `--e2e` never reaches it.

```
factory run e2e-assess [--run <id>] [--results <path>]
```

- **Emit** (no `--results`): prepares an assessor worktree on an `e2e-assess-<run-id>` branch
  off the run's `staging-<run-id>` tip and returns a `spawn` request. The prompt directs the
  `e2e-assessor` (pinned to **opus**) to do three jobs in one spawn: (a) **coverage forecast**
  — map each EXISTING committed spec this run's tasks touch to `{spec_path, task_ids,
expectation}` rows (`needs-update` vs `should-still-pass`), pre-routing later suite failures
  for [`run e2e`](#run-e2e)'s adjudication; (b) **machinery** — resolve the real boot config
  (start command + base URL), write it into the repo's `playwright.config.ts` (D10 single
  source of truth), and author seed/auth support (`e2e/support/`, `e2e/auth.setup.ts`) when
  the app needs it, validating by booting + logging in; (c) **verdict**.
- **Record** (`--results <path>`): reads the assessor's verdict — `ok` | `degraded` (auth-only
  gap → a named warning, coverage degrades to logged-out) | `boot-impossible` |
  `machinery-impossible`. Persists the forecast + resolved boot config on run state as
  `e2e_assessment`. Both `-impossible` verdicts fail the run **loud in plain language** (every
  non-terminal task is swept `blocked-environmental` and the run heads straight to finalize →
  `failed`). Retry contract mirrors the author's: a deliberate `-impossible` verdict is FINAL
  (no retry); only a **crash** or a guard violation (stray files / bogus forecast rows) earns
  the one automatic re-spawn (`attempts`, cap 2), after which it becomes the same loud fail.

`next-task` schedules `e2e-assess` before the first task, so a boot/machinery-impossible
assessment fails the run before any task work is spent. See
[Run with end-to-end tests](../guides/run-with-e2e.md).

### `run e2e`

Orchestrator (emit + record), symmetric with [`run docs`](#run-docs): the engine-owned
end-to-end phase on an `--e2e` run ([Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag),
overhauled by [Decision 40](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)),
ordered after the run-start [`e2e-assess`](#run-e2e-assess) phase and immediately **before**
the docs phase. The CLI **never spawns the e2e-author** — a runner does. Only ever runs when
`next-task` schedules the e2e stage; a run created without `--e2e` never reaches it.

```
factory run e2e [--run <id>] [--results <path>]
```

The phase does two distinct kinds of work, so a single subcommand covers both — the
returned envelope's `kind` tells the runner whether an agent is needed:

- **Emit** (no `--results`): on the **first** entry (`e2e_phase` unset) it prepares an
  author worktree on an `e2e-<run-id>` branch off the run's `staging-<run-id>` tip and
  returns a `spawn` request
  `{kind:"spawn", run_id, worktree, base_ref, staging_branch, e2e_branch, throwaway_dir, model, max_turns, prompt}`.
  The prompt directs the `e2e-author` to boot the app with the **resolved boot config**
  (`resolveBootConfig` = `e2e.startCommand`/`e2e.baseURL` override ?? the values the run-start
  assessment wrote into `playwright.config.ts`, D10), explore each user-facing task, author
  **critical** journey specs into the worktree's `e2e/` directory (committed) plus **throwaway**
  specs into `throwaway_dir` (gitignored, never committed), self-validate them green against
  staging, and return a manifest of `{task_ids, spec_path, kind, title}` rows (`title` is the
  human-readable journey name, D12) — **without pushing**. On a **re-entry** (after a reopened
  task settles back to terminal) it does not spawn — it re-runs the already-authored suite
  mechanically and returns a conclusive `done` | `failed` | `reopen` | `suspend`. A crashed or
  unparseable author earns ONE automatic re-spawn (`author_attempts`, D5) before the phase
  fails; a deliberate BLOCKED/NEEDS_CONTEXT verdict fails fast. If the boot config cannot be
  resolved at all it returns `{kind:"suspend", …}` and suspends the run.
- **Record** (`--results <path>`): reads the e2e-author's
  `{status:"<STATUS line>", manifest:[{task_ids, spec_path, kind, title}]}` envelope
  (`E2eResultsSchema`). Any non-`DONE` author status fails the whole e2e phase (no
  re-author retry loop). Before proceeding it validates the manifest: every `spec_path` is
  guarded against traversal/absolute paths, and every `task_id` is checked against
  `run.tasks` (an unknown id fails loud rather than silently vanishing at reopen time). It
  then enforces the **trust boundary** (D6) — a name-only diff of the author branch against
  staging requires every changed file under `<testDir>/` to be a declared **critical** manifest
  entry (carve-out: the assessment-owned `e2e/support/**` and `e2e/auth.setup.ts`), and rejects
  any changed path outside `<testDir>/` (the branch is merged unreviewed, so a stray edit to
  application source aborts the phase).
  On `DONE` it runs the **fail-first proof** on every critical spec (red against the base
  branch with its `control:` assertion green; green against staging), merges only the proven
  critical specs into `staging-<run-id>`, then runs the full suite and applies the
  disposition. Authored specs execute under a **scrubbed, allowlisted env** (PATH/HOME plus
  the `FACTORY_E2E_*`/`BASE_URL` boot vars — never the full inherited `process.env`).

Both paths converge on the same suite-run decision, which returns one of:

- `{kind:"done", run_id}` — every critical spec is present and `passed`/`flaky` (a residual
  throwaway red becomes an advisory line in the report, never a blocker); the phase is
  marked `done` and the run proceeds to docs/finalize.
- `{kind:"reopen", run_id, task_ids, reason}` — a mappable failure; the named tasks are
  reset to `pending` carrying the failure as `e2e_feedback` (reusing the `resetTaskRow`
  rescue primitive). **The run status stays `running`** — only task rows reset. A critical
  **miss** (spec absent from results, or `failed`/`skipped` — not just red) reopens; pass 1
  additionally reopens for any mappable throwaway failure; pass 2+ reopens only for
  critical. The e2e phase re-fires once the reopened tasks settle.
- `{kind:"adjudicate", run_id, ...}` — a critical failure that **no manifest entry maps to a
  task** (a pre-existing committed spec, not authored this run). Rather than failing the run
  outright, the phase routes it through **adjudication** (D7) using the assessment's
  affected-specs forecast: a `should-still-pass` spec → reopen the mapped task; a `needs-update`
  spec → the adjudicator rewrites it to the new behavior; an **unforecast** spec → the
  adjudicator rules **regression** (fail loud, cited) vs **intentional-change** (rewrite +
  fail-first re-proof + merge + suite re-run). The in-flight adjudication is tracked by a cursor
  on `e2e_phase.adjudication`; each spec may be adjudicated **at most once per run**
  (`adjudication_counts`) — a spec failing again after its one adjudication is a regression.
- `{kind:"failed", run_id, reason}` — an adjudicated-**regression** verdict, a **tooling
  failure** (nonzero exit / reporter `errors[]` with no spec marked failed — never attributed
  to a task), an exhausted `e2e.reopenCap`, a rejected fail-first proof, a manifest referencing
  an unknown `task_id` or unsafe `spec_path`, an author branch violating the trust boundary, or
  a non-`DONE` author status. The docs phase is then skipped. A failed verdict is not permanent
  — `factory rescue apply --reset-e2e` (only once the underlying cause no longer applies) clears
  it, preserving the manifest + reopen counts (and dropping any live adjudication cursor), so
  the phase re-enters on the next pass.
- `{kind:"suspend", run_id, reason}` — the boot config could not be resolved (no config
  override and no assessment-resolved value); resumable via `/factory:resume`.

`next-task` schedules e2e before docs, so a failed e2e phase never reaches the docs or
rollup steps. See [Run with end-to-end tests](../guides/run-with-e2e.md).

### `run stop`

Action. **Parks a live run** so its owning session can stop while keeping the run
resumable — the non-destructive counterpart to [`run cancel`](#run-cancel)
([Decision 72](../explanation/decisions.md)). One state write flips the run to
`suspended` with **NO quota checkpoint** (`run.quota` absent — the exact `--approve-spec`
precedent), so a plain [`factory resume`](#resume) un-parks it (`planResume` clears a
quota-less suspend unconditionally). Tasks are **untouched**. `next-task` on a parked run
emits a `park`-scope pause envelope and never auto-clears it — the orchestrator's park
guard is what keeps a background loop from silently resuming a deliberately-stopped run.
Idempotent on an already `paused`/`suspended` run (`already_parked: true`, no write); a
terminal run is a loud error (nothing to park).

```
factory run stop [--run <id>] [--session-id <id>]
```

| Flag                | Notes                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--run <id>`        | The run to park. Default: the active run THIS session owns (`findActiveByOwner`), then the current run for the checkout. Loud if the session owns two live runs. |
| `--session-id <id>` | Owning session id used to locate the run when `--run` is omitted. Defaults to `$CLAUDE_CODE_SESSION_ID`.                                                         |

Like `cancel`, `stop` has **no autonomy gate** — a stop verb must work from any session.
Emits `{kind:"stopped", run, already_parked}`.

### `run cancel`

Action. **Abandons a live run** so its owning session can stop — the in-session escape
from the Stop gate (Decision 35 addendum). To pause a run you intend to continue, use
[`run stop`](#run-stop) instead — `cancel` is **irreversible**. Marks the run terminal by
reusing `failed`, via `state.finalize` **directly** (NOT the `run finalize` ship path): no
rollup CI, no merge, no PRD close. Because `finalize` validates only that the _target_
status is terminal — never the task statuses — a run with a task still `executing` is
cancellable (the same mechanism `--supersede` uses). **Before** the terminal flip it
**sweeps every in-flight task** (`executing`/`reviewing`/`shipping`) to `failed` /
`blocked-environmental` with reason `"run cancelled by operator"` and drops its
`spawn_in_flight` ([Decision 72](../explanation/decisions.md)) — so a cancelled run leaves
no row that reads as live work to `rescue scan` or the statusline; `pending` rows (which
never ran) stay untouched. Idempotent for `failed` (the sweep is skipped once terminal); a
run already terminal as `completed`/`superseded` is a loud error. A cancelled run is **not
resumable** — start fresh with `/factory:run`.

```
factory run cancel [--run <id>] [--cleanup] [--session-id <id>]
```

| Flag                | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--run <id>`        | The run to cancel. Default: the active run THIS session owns (`findActiveByOwner`), then the current run for the checkout. Loud if none resolves.                                                                                                                                                                                                                                                     |
| `--cleanup`         | Also tear down the run's PINNED `staging-<run-id>` branch + its task PRs (protection first, then the branch — GitHub blocks deleting a protected ref), then (run-scoped mode, D74) drop develop back to its baseline protection unless a sibling run on the repo is active. **Default (omit): leave them — develop stays on the strict profile until a terminal path or re-provision downgrades it.** |
| `--session-id <id>` | Owning session id used to locate the run when `--run` is omitted. Defaults to `$CLAUDE_CODE_SESSION_ID`.                                                                                                                                                                                                                                                                                              |

Unlike `run create`/`resume`, cancel has **no autonomy gate** — it is the documented exit
from the Stop gate and must work from any session. Emits `{kind:"cancelled", run, cleaned_up}`.

## `resume`

Action (Decision 35 — a top-level verb, distinct from `run`/`rescue`/`debug`).
Re-checks the live quota window and resumes a paused/suspended run if the binding
window recovered. Reads nothing else; leaves state untouched when blocked. A terminal
run is a loud error (nothing to resume). The documented operator
entry is `/factory:resume` (Decision 50) — it runs
[`rescue scan`](#rescue-scan) first and routes for you; this verb is its clean-park path.

```
factory resume [--run <id>] [--ignore-quota]
```

Subject to the same mandatory autonomy gate as `run create` (halts loud unless
`FACTORY_AUTONOMOUS_MODE=1`).

`--ignore-quota` persists `ignore_quota: true` on the run **before** the resume plan
runs, so `planResume` force-clears the checkpoint regardless of the live window reading,
and subsequent steps stay un-paced. It is a `boolean` operator override (a mistaken
suspend / manual reset), NOT a ship flag — unlike `--no-ship` (rejected
loud on resume), it combines freely. See
[Quota pacing — `--ignore-quota`](../explanation/quota-pacing.md#--ignore-quota--the-per-run-pacing-override).

In run-scoped protection mode (D74) a successful resume also idempotently
**re-escalates develop** to the strict run profile — a rescued `failed` run was
de-escalated at its terminal flip and must not roll up under baseline-only
GitHub-side enforcement.

`--run` defaults to **this repo's current run** — resolved from the caller's
checkout (`origin` remote → `<dataDir>/current/<repoKey>`); if the repo can't be
derived there is no current run (see
[Per-repo current](#per-repo-current-run-resolution)). Emits one of:

- `{kind:"resumed", run}` — window recovered (or the run was already running).
- `{kind:"pause", run_id, status, reason, resets_at_epoch?}` — not
  recovered; state untouched.

## `state`

Reporter (read-only). Prints run state.

```
factory state                 # current run's state.json (JSON)
factory state <run-id>        # that run's state.json (JSON)
factory state --summary       # compact human summary
```

No current run is not an error: prints `{"current": null}` (or `no current run`
with `--summary`) and exits `0`. State corruption is loud.

For a `failed` or `superseded` run, the `--summary` header appends
`reason=<terminal_reason>` (or `reason=reason unavailable` for a terminal state
written before the field existed) — see
[`terminal_reason`](./state-model.md#terminal_reason--why-the-run-ended-badly).
The same reason appears in the rescue scan (`/factory:resume`), the partial
report, and the run summary as a `**Reason:**` line.

With no `<run-id>`, the current run is resolved **per repo** from the caller's
checkout — see below. `score`, `rescue`, `resume`, and `next-task` resolve the
same way.

### Per-repo current run resolution

The global repo-less `runs/current` pointer is **retired** ([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)).
Every command that defaults to "the current run" (`state`, `score`, `rescue`,
`resume`, and the machine-driven `next-task`) resolves it **per repo** from the
shell's cwd, so two runs in two different checkouts never shadow each other:

1. derive the repo from the checkout's `origin` remote;
2. read `<dataDir>/current/<repoKey>` → that repo's current run;
3. if the repo can't be derived (no `origin`), there is no current run (`null`,
   never an error — a broken git env, versus a plain missing remote, still
   surfaces loud).

`--run <id>` always wins over this resolution; `next-action` ignores it entirely
(always requires `--run`). The only consumers with **no cwd** — the hook guards
and statusline ticks — resolve via a 3-tier order (owner session → cwd repo
pointer → newest non-terminal scan); see [hooks.md](hooks.md#active-run-resolution).

## The orchestrator (`next-task` + `next-action`)

The orchestrator is the engine's single control-flow seam. `next-task` is the **run-level**
orchestrator (which task is ready); `next-action` is the **task-level** orchestrator (run one task's
deterministic steps until it needs agents). The runner — the in-session event
loop (see [Run the pipeline](../guides/run-the-pipeline.md))
— alternates them: `next-task` to pick a task, `next-action` to advance it, spawn the agents
the request names, then `next-action --results` to record their output back. Neither orchestrator
spawns anything itself.

The six retired single-step writers — `run-task`, `advance`, `fail`,
`record-producer`, `record-holdout`, `record-reviews` — collapsed into the orchestrator.
Their record logic now runs inside `next-action --results` (`src/orchestrator/record.ts`); the
producer / holdout / reviews records are no longer separate CLI calls.

## `next-task`

Reporter (run-level orchestrator). One run-loop step: terminal check, quota gate
(persisting a pause/suspend checkpoint on breach), stale-checkpoint clear on
recovery, transitive cascade-fail of tasks blocked on an unsatisfiable dependency,
then the ready set. Writes only on a quota breach or a cascade-fail; otherwise
read-only. Throws LOUD on a dependency deadlock.

```
factory next-task [--run <id>]                          # defaults to the caller-repo current run
factory next-task --assert-owner <session>              # loud-assert current-run ownership
```

`--assert-owner <session>` is an opt-in guard for a `next-task` that adopts the
per-repo current run rather than passing `--run`, defending against a concurrent
`run create` having repointed that repo's current pointer onto a foreign run: it
throws loud if the resolved run's persisted `owner_session` disagrees with
`<session>`. Degrades safe (no assertion) when either side is unknown.

Manual `factory next-task` never needs it. It runs only on the current-run path;
the explicit `--run <id>` path bypasses it.

Every envelope also carries the self-resolved run context (`run_id`, canonical
`data_dir`, `ship_mode`) so a caller adopts them from the first `next-task`.

Emits one of:

- `{ kind:"work", run_id, ready:[...], cascade_failed:[...], max_parallel, stale:[...], hung:[...] }` —
  ready tasks, **in-flight first** (crash-resume finishes started work before opening
  new), then pending in spec order. `max_parallel` is the config's
  `maxParallelTasks` — the runner drives at most that many tasks in flight. `stale`
  and `hung` are DISJOINT subsets of `ready` banded by in-flight spawn age
  (`spawn_in_flight.spawned_at`, [state model](./state-model.md#spawn_in_flight--idempotent-re-spawn-checkpoint)) — **advisory only**,
  the task's status is unchanged. `stale` (`stallTtlMinutes < age ≤ hungSpawnMinutes`):
  liveness-check first, then abandon a silently-dead agent's spawn and re-drive the
  task via `next-action` (idempotent — the reset re-spawns clean, and the dead agent's
  late results are rejected by the stale `result_key` guard). `hung`
  (`age > hungSpawnMinutes`, Decision 66): kill the spawn's agents **even if alive**
  and re-drive — bounded engine-side by `SPAWN_REDRIVE_CAP` per `(phase, rung)`
  checkpoint, after which the re-drive fails the task `blocked-environmental`. The
  stale-shipping adoption probe (Decision 60) gates on the union of both bands. Empty
  lists are the steady state.
- `{ kind:"traceability", run_id, data_dir, ship_mode }` — all tasks are terminal and
  the run will complete (non-debug), but the PRD-traceability audit has not concluded
  (Decision 47). Ordered **after the e2e phase, before `document`**. The runner runs
  [`factory run traceability`](#run-traceability); a `failed` audit routes straight to
  `finalize` (which condemns the run), so `document` never runs on a condemned run.
- `{ kind:"document", run_id, data_dir, ship_mode }` — all tasks are terminal
  and the run will complete, but `/docs` needs updating first. The runner runs
  `factory run docs`, which emits a scribe spawn request; the runner spawns the scribe
  agent and records the docs commit onto the staging branch. `next-task` emits
  `finalize` only after that record.
- `{ kind:"finalize", run_id, cascade_failed:[...] }` — nothing left to
  schedule and the docs phase (when applicable) is already `done`; the runner
  calls `factory run finalize` next. `cascade_failed` is this-invocation-only.
- `{ kind:"done", run_id, run_status }` — the run is already terminal.
- `{ kind:"pause", run_id, scope, reason, resets_at_epoch? }` — a quota
  window blocked; the checkpoint is persisted.

## `next-action`

The per-task orchestrator (the engine seam). Resumes at the task's
persisted `phase` cursor, optionally records the previous spawn's agent results
(`--results`), then runs every deterministic phase it can until it needs agents or
the task is terminal. Emits ONE JSON `NextAction`.

```
factory next-action --run <id> --task <id> [--results <file>] [--ship-mode <mode>]
```

`--ship-mode` (`no-merge` | `live`) is the internal-seam override the runner passes
machine-side; omit it to honor the run's persisted `ship_mode` (users never type it —
the user-facing knob is `--no-ship` on `run create`/`run finalize`). Emits one of:

- `{ kind:"spawn", run_id, task_id, phase, result_key, request, holdout?, expects, worktree, base_ref }`
  — the agents to run (`request.agents`) and what to feed back. Each agent carries
  `{ role, agent_type, model, max_turns, prompt?, isolation, effort? }`; `agent_type`
  is the runner-facing `Task(subagent_type)` value the runner spawns **verbatim**
  (`AGENT_TYPE_BY_ROLE`, `src/core/phase-machine/spawn.ts`, Decision 52) — there is no
  prose spawn matrix for the runner to re-derive. `prompt` (when present) is the
  engine-composed agent prompt the runner spawns **verbatim** — set on producer specs
  (the full `ProducerContext` + the cd-to-worktree sentence, composed at spawn time);
  omitted on panel-reviewer specs, whose lens the runner still builds inline from
  `agents/<role>.md` + `skills/review-protocol/SKILL.md`. A verify (`expects:"reviews"`)
  request additionally carries `request.cross_vendor` (the resolved Codex slot — when
  `status:"present"` it includes a pre-composed quality-reviewer `prompt` the runner
  spawns verbatim via `codex exec`) and `request.verifier_spec` (the finding-verifier
  spawn template — `{ agent_type, model, isolation, prompt_template, interpolate_fields }`;
  the runner renders one instance per blocking+citable finding by substituting only the
  admissible `interpolate_fields` — what the verifier can check against the code — never
  the reviewer's `description`, `severity`, or `reviewer`). `effort` (the `Agent`
  reasoning level) appears only on a high producer-escalation rung once the model
  dial has climbed to its ceiling (see [producer-ladder](../explanation/producer-ladder.md))
  and is omitted otherwise so the agent inherits the spawn default. `phase` is one of
  `tests | exec | verify` (preflight only advances; ship never spawns). `expects`
  is `producer-status` (tests/exec — one producer agent) or `reviews` (verify —
  the four-reviewer panel); a `holdout` accompanies `verify` when a holdout answer
  key was withheld. `worktree` is the task working tree the agents commit in.
  `base_ref` is the per-run staging base that worktree forked from
  (`origin/staging-<run-id>`); the panel and holdout validator diff against THIS, never
  a bare `origin/staging` (which namespace-collides after a repo branch rename). Its
  branch is `run.staging_branch` — the name pinned in `RunState` at create
  ([state model](./state-model.md#runstate)), never recomputed — so it stays fixed
  to the branch already pushed to origin even if the naming scheme changes mid-run.
- `{ kind:"done", run_id, task_id, outcome }` — the task is `done` or a
  classified `failed`.
- `{ kind:"pause", run_id, task_id, scope, reason, resets_at_epoch? }`.

**The `--results` record.** `--results <file>` feeds back exactly what the previous
spawn envelope's `expects` named, and records it into ONE state step (advance, bump
the producer rung, or terminal). The file MUST echo the envelope's `result_key`
verbatim:

```
expects=producer-status → { "result_key": {…}, "producer": { "status": "<STATUS line>" } }
expects=reviews         → { "result_key": {…}, "holdout"?: { "raw": "<validator output>" },
                            "reviews": { reviews, verifications, crossVendorAbsent? } }
```

The record is **at-least-once delivery, exactly-once application**: the `result_key`
(`{phase, rung}`) is validated against the live cursor before any mutation, so a
stale or duplicate delivery is rejected LOUD rather than double-recorded. On a
rejection, re-invoke **without** `--results` to re-derive the current spawn
envelope (re-invoking without results is idempotent). When that re-derived spawn
matches a recorded `spawn_in_flight` checkpoint — i.e. a previous spawn for the
same `(phase, rung)` was emitted but never recorded (a stop in the post-spawn /
pre-record window) — the orchestrator first resets the shared task worktree to the
checkpoint's `tip_sha`, discarding the abandoned producer's partial commits before
re-spawning clean ([state model](./state-model.md#spawn_in_flight--idempotent-re-spawn-checkpoint)).
The `reviews` record runs the
full verify merge gate internally — re-runs the deterministic gates, re-derives the
persisted holdout evidence, citation-verifies the reviews against the worktree,
and confirms each surviving blocker via the supplied `verifications` (a kept
citable blocker with no recorded verdict fails closed). Holdout is recorded **before**
reviews. A refused live merge re-routes the task through `exec` to re-sync, bounded
by a persisted per-task budget (`merge_resyncs`).

If the supplied `holdout.raw` is malformed — unparseable, wrong verdict cardinality,
criterion-text mismatch, or a `satisfied` verdict with blank evidence — it is an
**evaluator failure**, not a producer miss: no verdicts are persisted, the rung is
untouched, and the emitted step re-runs the verify wave at the same rung. This is
bounded by `HOLDOUT_EVALUATOR_RETRY_CAP` (2); exhaustion fails the task
`blocked-environmental`. See
[`holdout_evaluator_retries`](./state-model.md#holdout_evaluator_retries--evaluator-faults-are-not-producer-misses).

## `score`

Reporter (read-only). Resolves the run + its spec, derives the partial report, and
emits the compact `RunSummary`.

```
factory score [--run <id>]
factory score --fleet
factory score --reviewers
```

Emits `{ kind:"score", summary }`. The summary carries the S11 touch metric:
`touches` (length of the run's `human_touches` ledger) and `touch_metric`
(derived, never stored: `(completed ? 1 : 0) / touches` — `launch` counts, so a
clean lights-out run scores exactly `1.0`). A run with an empty ledger reports
`touches: 0` and `touch_metric: null` (the 0-division guard). The summary also
carries the outer-loop review-miss roll-up ([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)):
`misses` (the run's `misses[]` count) and `misses_by_lens` (bucketed by the
reviewer lens that should have caught each, `'none'` = un-lensed). Both are
derived from `run.misses`, never stored a second time.

`--fleet` reports the metrics across **every** run in the store: emits
`{ kind:"fleet-score", runs:[{run_id, status, touches, metric, misses}], aggregate, total_misses, misses_per_run, misses_by_lens }`.
`aggregate = sum(completed) / sum(touches)` over runs carrying the touch ledger
(`null` when none do); `misses_per_run` divides `total_misses` by the
**terminal**-run count (`null` when zero terminal runs — a live run is a moving
denominator, never a fabricated rate); `misses_by_lens` sums every run's
per-lens buckets. Malformed run dirs warn + skip (tolerant `listRuns`).

`--reviewers` derives per-lens review VALUE from the `review.round` telemetry
([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)),
joined with misses attributed to each lens. Emits
`{ kind:"reviewer-score", lenses:[{lens, rounds, confirmed_blockers, yield, send_back_rate, misses}], runs_covered, runs_without_events, cross_vendor_absent_rounds, unattributed_misses }`.
`yield`/`send_back_rate` are `null` when a lens has zero rounds (no fabricated
rate). It is **honest about coverage**: `runs_without_events` counts runs whose
`review.round` metrics are absent (telemetry is lossy — `emitMetric` swallows IO
errors), so a metrics-less run is never silently scored as clean.

## `miss`

Writer. Records a **review miss** — a defect found in shipped factory-produced
code, post-merge — into the run's `misses[]` ledger ([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)).
This is the outer quality loop's only human-authored input: the engine cannot
re-derive "a bug shipped", so a miss is one of the three sanctioned
stored-EVENT exceptions to derive-don't-store (beside `self_heal` and
`human_touches`).

```
factory miss [--run <id>] --task <id> --note <text> [--lens <reviewer|none>]
```

| Flag     | Meaning                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--run`  | The run whose shipped code the defect traces to. Defaults to the caller-repo current run — so a miss found the day after finalize records fine from the repo checkout.                                 |
| `--task` | REQUIRED. The task carrying the defect; **must** ∈ the run's tasks (a `superRefine` rejects a dangling id).                                                                                            |
| `--note` | REQUIRED human description — a miss without one is noise.                                                                                                                                              |
| `--lens` | Optional. Which reviewer lens _should_ have caught it (`quality-reviewer`, `silent-failure-hunter`, …), or `none`. Buckets the miss in `score`'s `misses_by_lens` and the `--reviewers` per-lens join. |

Appends `{task_id, at, note, lens?}` and emits `{ kind:"miss", run_id, task_id, misses:<new total> }`.

## `rescue <scan|apply|auto|gc>`

The repair plumbing under **`/factory:resume`** (Decision 50 — ONE consent-gated
repair verb; it absorbed `factory recover`, Decision 48's surface). `scan` is the
read-only scan + route the command layer acts on; `apply` is the ONLY mutation —
what approved plan items execute; `auto` is the runner's bounded self-heal; `gc`
is the orphaned staging-branch/protection sweep (Decision 55). The
`/factory:resume` command pairs these with the `rescue-diagnostic` +
`rescue-reconciler` agents — the CLI itself never spawns agents or prompts. See
[Rescue a stalled run](../guides/rescue-a-stalled-run.md).

### `rescue scan`

Reporter (read-only). Classifies every task and reports what a re-drive would do.

```
factory rescue scan [--run <id>]
```

Emits a `RescueScan` plus the routing `/factory:resume` acts on: `{ run_id, run_status,
counts, resettable, dead_ends, needs_rescue, e2e_failed, e2e_assessment_failed,
traceability_failed, rollup_pending, empty_task_map, would_deadlock, summary, tasks, work,
route, reconcile, github, hints, awaiting? }`. The routing fields:

- `route` — `nothing` (no run, or terminal with nothing repairable) | `resume`
  (clean: a park, or a healthy `running` re-entry) | `repair` (`needs_rescue` or
  dead-ends — propose before touching). With no resolvable run the envelope is
  `{kind:"nothing", reason:"no-run", route:"nothing"}` — safe to fire blind.
- `reconcile` — `true` when the git probe flags drift (staging base unresolvable,
  or a recorded task branch missing): the command layer spawns `rescue-reconciler`.
- `github` — the **P1 GitHub-truth** survey ([`reconcile` module](#reconcile)), read-only
  evidence for the reconciler. On success `{ok:true, facts, drifts, rollup_landed}`; on a
  gh outage (down / unauthenticated) it **degrades to `{ok:false, error}`** so the repair
  entry point keeps working — the outage is surfaced verbatim, never silently dropped. The
  `drifts` classify state↔GitHub disagreement (`merged-unrecorded`, `closed-unmerged`,
  `stale-pr-number`, `pr-unrecorded`, `branch-missing`, `staging-missing`, `rollup-landed`);
  each line's `detail` names its manual remedy. Detection only — `apply` never mutates
  GitHub. For a loud, gh-outage-intolerant survey use [`factory reconcile`](#reconcile).
- `hints` — one exact `factory rescue apply …` command per proposable repair
  (default reset, per-dead-end `--task <id> --include-dead-ends`, `--reset-e2e`,
  `--reset-traceability`, `--recheck-rollup`). These are the plan items the
  consent prompt renders — and the manual escape hatch when declined.
- `awaiting` — present only when the run is parked: the **derived** cause
  (`quota`/`e2e`/`traceability`/`docs`/`spec-approval`/`unknown` — never stored).

Dispositions: `shipped`, `runnable`, `stuck` (crashed in-flight), `recoverable`
(a `blocked-environmental`, `needs-context`, or `blocked-dependency` fail — Decisions 69
& 72), `dead-end` (`spec-defect`/`capability-budget` fail). A `needs-context` task's line
carries the recorded `question`, and its repair `hint` is a `--task <id> --answer` command
(not a blind reset).
Default-resettable = `stuck ∪ recoverable`. `e2e_failed` is `true` iff
`run.e2e_phase.status === "failed"` and `e2e_assessment_failed` is `true` iff
`run.e2e_assessment.status === "failed"` (the run-start assessment, Decision 40 D3) — both
fold into `needs_rescue` so a run stuck ONLY on a failed e2e phase or assessment (every task
`done`, `resettable` empty) still scans as needing rescue, not "nothing to do". Both are
cleared by `apply --reset-e2e`.
`rollup_pending` is `true` iff `run.rollup?.merged === false` — either a `completed` run
whose staging→develop rollup was **armed but never landed** (e.g. the "auto-armed"
branch-policy fallback, D3), or a **non-terminal** run that hit a **forward-reconcile
conflict** in finalize (`run.rollup.number` absent). It folds into `needs_rescue` (from a
purely durable-state check, no live GitHub call) but is **never auto-recovered**. The
`--recheck-rollup` repair hint is proposed **only for the `completed` case** (`run_status
=== "completed"`); the conflict case needs a human to resolve the staging↔develop merge and
then a plain `factory resume` (the scan summary says so), so no apply command is offered.

`empty_task_map` is `true` iff the run has **zero tasks** (Decision 57) — half-created
wreckage from a crash between run birth and task seeding (impossible for runs created after
the atomic-seeding fix, but pre-existing wreckage must not scan as healthy: a task-only scan
over `{}` reports `total: 0` with every other fold `false`). It folds into `needs_rescue`,
and its only repair `hint` is `factory run cancel --run <id> --cleanup` — there is nothing to
reset, so the remedy is cancel + re-create, never a task reset. The parked-cause derivation
(`awaiting`) likewise no longer misreads an empty task map as `spec-approval`.

The scan also appends a read-only `work` field — a git-grounded recoverable-work survey
(`assessWork`, `src/rescue/assess.ts`):

```
"work": {
  "base_ref": "origin/staging-<run-id>",
  "base_resolved": true,
  "tasks": [
    { "task_id", "branch", "branch_exists", "commits_ahead", "pr_number?" }
  ]
}
```

One entry per **non-shipped branched** task (`done` and branchless tasks are skipped),
in `run.tasks` order. `commits_ahead` counts the commits the local `factory/<run>/<task>`
branch carries above the run's staging base (`origin/staging-<run-id>`), so a failed task
that got far before failing shows a high count vs an empty one. `commits_ahead` is `null`
(not `0`) when the base or branch is unresolvable — `0` means "branch exists but adds
nothing"; `null` means "nothing to count against". `base_resolved: false` (a deleted
staging branch) nulls every count. This is **evidence only** — nothing here reuses or
deletes a commit; resume still re-cuts a reset branch from staging and redoes the work.
Backed by new `GitClient.refExists`/`commitsAhead` (`src/git/git-client.ts`).

### `rescue apply`

Writer. Adopts forward-only GitHub drift first (Decision 60 — records merged PRs `done`,
rebinds/clears stale `pr_number`s, re-pushes still-local branches, reopens a landed
rollup), **before** resetting the remaining resettable tasks to `pending` and reopening a
terminal run — so a merged-but-unrecorded PR is recorded `done` rather than reset away. A
gh outage degrades adoption to a no-op (`{ok:false}`); the reset still runs. This is what
an approved `/factory:resume` repair plan executes — every flag is a human assertion an
approved plan item carries.

```
factory rescue apply [--run <id>] [--task <id>]... [--answer <text>] [--include-dead-ends] [--reset-e2e] [--reset-traceability] [--recheck-rollup]
```

| Flag                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--task <id>`          | Reset exactly this task (repeatable). Overrides the default set; a `done` task is a loud error, a `pending` one is skipped; a named dead-end IS reset.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `--answer <text>`      | Answer a `needs-context` failure's recorded question ([Decision 69](../explanation/decisions.md)). Requires exactly ONE `--task`, and that task must carry a recorded `needs_context.question` (both loud errors otherwise). The reset preserves the question and stamps the answer alongside it; the next producer spawn's prompt injects both. Mutually exclusive with `auto`.                                                                                                                                                                                                                                                                                                                                                                       |
| `--include-dead-ends`  | Also reset dead-end fails. Use only after the root cause is fixed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `--reset-e2e`          | Clears a `failed` e2e-phase verdict so it re-enters, **and** drops a `failed` run-start `e2e_assessment` (Decision 40 D3) so the assessment re-runs. A post-authoring e2e-phase failure keeps its manifest + reopen counts + `adjudication_counts` and drops any live `adjudication` cursor; a pre-authoring failure (empty manifest) drops `e2e_phase` entirely so the author re-spawns. Use only once the underlying cause no longer applies — alone sufficient to reopen a terminal run even when no task is resettable. The phase repair is **decoupled from reopening**: it also fires on a **non-terminal** run (e.g. a crash between e2e's `markFailed` and finalize left the run `running`), so the documented recovery never silently no-ops. |
| `--recheck-rollup`     | Reopens a `completed` run whose rollup **armed but never landed** (`rollup_pending`) so a re-drive re-enters `finalizeRun` and its `rollup()` resume-guard picks up the now-merged PR (PRD-close + branch-GC). Use only after confirming the queued merge landed — alone sufficient to reopen a terminal run, and its repair likewise applies on a non-terminal run. Reopen only: `apply` never mutates the `rollup` pointer, only `finalizeRun` does.                                                                                                                                                                                                                                                                                                 |
| `--reset-traceability` | Clears a `failed` PRD-traceability audit (S9, Decision 47) so it re-runs. Use only once the unmet PRD intent is genuinely addressed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Default (no `--task`): resets `stuck` + `recoverable`, leaving dead-ends failed;
reopens a terminal run to `running` when it reset work (or when `--reset-e2e` clears
a failed e2e phase, `--reset-traceability` clears a failed audit, or
`--recheck-rollup` targets an armed-not-landed rollup).
Idempotent. Emits `{ run_id, run_status, reset, reopened, skipped, resume? }`. An
apply that did work also clears any surviving park itself (the `resume` field, run
`{touch:false}`), so the whole approved plan costs exactly ONE `recover` human touch
(Decision 49) and the follow-up `factory resume` is a touchless re-entry.

### `rescue auto`

The runner's bounded self-heal, fired after a failed finalize (Decision 48's `--auto`,
renamed by Decision 50; bound raised to **three** cycles by Decision 60). Never
operator-typed.

```
factory rescue auto [--run <id>]
```

Adopts forward-only GitHub drift first (Decision 60 — free; never spends the budget below),
then resets only the _effective_ auto-safe set (resettable tasks that stay actionable
post-reset — never dead-ends, e2e resets, traceability resets, rollup rechecks, or
git drift). A `needs-context` failure scans `recoverable` but is **excluded** here
([Decision 69](../explanation/decisions.md)): self-heal has no answer to give, so a blind
reset would only re-ask the same question and re-fail (its dependents stay excluded too).
The reset stamps `self_heal {attempts, last_at}` — the sanctioned stored-event
exception. Runs while `attempts < SELF_HEAL_MAX_ATTEMPTS` (**3**); a blocked auto
(`attempts >= 3`, empty effective set, or dead-ends only) emits `{kind:"page"}` and posts
ONE deduped PRD comment pointing at `factory rescue scan`. Never appends a human touch.

### `rescue gc`

The orphaned staging-branch/protection sweep (Decision 55). Every other rescue
helper excludes terminal runs — exactly the population that leaks a protected
`staging-<run-id>` branch when no teardown path fired (a `failed` run banked for
rescue, a crash between finalize steps, a `suspended` run abandoned after its PRD
shipped out-of-band). `gc` reclaims those.

```
factory rescue gc                        # scan: probe GitHub for leftovers (read-only)
factory rescue gc --apply --run <id>...  # tear down the named terminal runs' leftovers
```

Without `--apply` (scan): probes every **terminal** (`completed`/`superseded`/`failed`)
and **suspended** run's pinned `staging_branch` via `branchExists` (a read-only
`GhClient` probe) + `repoProtection`, and emits `{ kind:"gc", findings, suspended, stale }`:

- `findings` — terminal runs with a live branch and/or protection rule. Each carries
  `{ run_id, run_status, staging_branch, branch_exists, protection_live, banked, hint }`;
  `hint` is the exact `factory rescue gc --apply --run <id>` command. A `failed` run is
  flagged `banked: true` — its branch is deliberately kept for rescue, so GC it only once
  the run is truly dead.
- `suspended` — suspended runs with live leftovers. NEVER `gc --apply` targets (deleting
  their branch destroys resumability); each carries a
  `factory run cancel --run <id> --cleanup` hint instead.
- `stale` — run dirs **this engine cannot parse** (Decision 57): an old schema version
  (`schema_version !== 3`) or corrupt JSON — the population `listRuns` warn-skips, and a
  stale `current` pointer at one of these is what crashed `run create` in the 2026-07-07
  incident. Each carries `{ run_id, reason, staging_branch?, branch_exists?, protection_live?,
hint }`; `reason` is `schema-v<N>` or `corrupt-json`. `staging_branch`/`repo` are
  **best-effort raw extractions** from the unparseable JSON — GitHub is probed (and the live
  fields populated) only when both were extractable; otherwise the finding is state-side only.
  `hint` is the same `factory rescue gc --apply --run <id>` sweep command.

Candidates come from run state only — a rule lingering on a branch deleted
out-of-band is invisible to the REST branch-protection endpoints (404 on a missing
branch).

With `--apply --run <id>` (repeatable): deletes protection FIRST (GitHub blocks
deleting a protected ref), then the branch, for each named run. Refuses any
non-terminal run with a loud error pointing at `run cancel --cleanup`. Idempotent —
both deletes tolerate an already-gone (404) ref. A named id that is a **stale** run dir
(Decision 57) routes to the stale sweep instead: best-effort branch/protection teardown
(when raw-extractable), then the run dir plus any `current` pointer naming it are deleted
(`StateManager.deleteRun`). Emits `{ kind:"gc-applied", cleaned, stale_cleaned? }` — the
`stale_cleaned` array (one `{ run_id, staging_branch?, state_deleted: true }` per swept
stale dir) is present only when a stale id was swept.

Provisioning note: since Decision 55 `putProtection` sets `allow_deletions: true`, so a
leftover per-run staging branch also stays deletable with a plain `git push --delete`
without stripping protection first.

## `reconcile`

Reporter + writer. The **GitHub-truth** reconciler (P1,
[Decision 59](../explanation/decisions.md#decision-59--the-engine-sees-github-truth-read-only-reconcile)
detection +
[Decision 60](../explanation/decisions.md#decision-60--autonomous-forward-only-adoption-write-side)
adoption): `rescue scan` is pure over run state, so state↔GitHub drift — a PR merged but
never recorded `done`, a closed-unmerged PR still counted on, a landed auto-armed rollup, a
deleted staging branch — was invisible to the engine. `reconcile` closes that blind spot by
probing GitHub through the single `gh` seam and classifying the drift. **Read-only by
default**; `--adopt` applies the forward-only repairs against the SAME report (no second
probe).

```
factory reconcile [--run <id>] [--adopt]
```

| Flag         | Notes                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--run <id>` | The run to reconcile. Defaults to this repo's current run.                                                                                                                                                                             |
| `--adopt`    | Apply the forward-only repairs (Decision 60): record merged-unrecorded PRs as `done`, rebind stale `pr_number`s, re-push a branch still present locally, reopen a run whose rollup landed. Never resets, force-pushes, or closes a PR. |

Emits ONE JSON document (the `adoption` field is present only under `--adopt`):
`{ kind:"reconcile", run_id, run_status, facts, drifts, rollup_landed, adoption? }`.

- `facts` — the gathered GitHub truth: `{ repo, staging:{branch, tip}, tasks:[...],
rollup? }`. `tasks` carries one entry per **branched** task (branchless tasks have nothing
  to probe) with every PR ever opened from its head (`prList {state:'all'}`) and its merged
  SHA when merged; a remote-head `branch_tip` is probed **only** when the recorded PR is
  found OPEN (the sole shape where a missing branch is real drift). `rollup` is present only
  when the run's rollup marker says `merged:false`.
- `drifts` — the classified state↔GitHub disagreements (pure over `facts`). The seven
  classes: `merged-unrecorded` (recorded PR is MERGED but the task is not `done`),
  `closed-unmerged` (recorded PR was CLOSED without merging while the task still counts on
  it), `stale-pr-number` (recorded `pr_number` matches no PR on the head), `pr-unrecorded`
  (an OPEN PR exists but state records no `pr_number`), `branch-missing` (a recorded-OPEN
  PR whose head branch is gone — resume needs a re-push), `staging-missing` (a non-terminal
  run's staging branch is gone), `rollup-landed` (the rollup PR IS merged but the marker
  says `merged:false`). Each line's `detail` names its manual remedy. A `done` task is never
  classified, and an unrecorded MERGED PR on a head is **not** drift (the e2e-reopen shape).
- `rollup_landed` — the `rollup-landed` fold, so consumers read it without scanning `drifts`.
- `adoption` (only under `--adopt`) — `{ ok, adopted, actions, changed }`: the forward-only
  repairs applied against this same report. `adopted` lists the task ids recorded `done`;
  `actions` details every write (class + task/PR); `changed` is false when the report held
  nothing adoptable. Adoptions are **free** — they never spend the self-heal budget nor log a
  `human_touch`. `merged-unrecorded` → task `done`; `stale-pr-number` → rebind/clear the
  recorded `pr_number`; `branch-missing` with the branch still local → plain `git push` (never
  `--force`; skipped + surfaced if the local branch is gone); `rollup-landed` (or every task
  now `done`) → reopen the completed run so resume can finalize. `closed-unmerged` /
  `staging-missing` / orphan worktrees are NOT adopted —
  they need judgment and stay [`reconcile` §4](../guides/rescue-a-stalled-run.md#4-reconcile-gitgithub-drift) / reconciler-agent territory.

**Fails LOUD when gh is unavailable** — GitHub facts are this command's entire job, so any
gh error propagates (non-zero exit). This is the deliberate contrast with
[`rescue scan`](#rescue-scan), whose `github` section **contains** a gh outage
(`{ok:false, error}`) so the repair entry point keeps working. Fact-gathering is
all-or-nothing: any single gh failure aborts with no partial facts. See
[Rescue a stalled run § 4](../guides/rescue-a-stalled-run.md#4-reconcile-gitgithub-drift).

## `autonomy <ensure|status|preflight>`

Autonomous mode is **mandatory** for a run (`run create`/`resume` halt without it —
[Decision 29](../explanation/decisions.md#decision-29-autonomy-is-mandatory--enforced-in-the-engine-no-opt-out)). These verbs set it up and check it. `preflight` is the **run-entry composer** `/factory:run` calls; `ensure`/`status` are the manual primitives.

### `autonomy ensure`

Default verb. Builds the autonomous settings **in memory** (nothing is written to
disk — v1.47 retired the `merged-settings.json` artifact) from
`templates/settings.autonomous.json` **only**: placeholders (`${CLAUDE_PLUGIN_ROOT}` /
`${CLAUDE_PLUGIN_DATA}`) substituted, `env.CLAUDE_PLUGIN_DATA` baked, and the
`statusLine` wired to `factory statusline`. If you have your own (non-factory)
`statusLine` it is preserved by chaining it through `FACTORY_ORIGINAL_STATUSLINE`.
Then prints the relaunch command, with that settings object as exactly ONE
shell-quoted inline `--settings` argument (a typed `RelaunchSpec` — executable +
argv — rendered by a single audited POSIX quoter).

**Your `~/.claude/settings.json` is never re-serialized into the payload** (v1.47.1).
Your `statusLine` command is the only field read from it. The rest — `env`,
`permissions`, `apiKeyHelper` — stays out by construction, because the inline argument
lands in process argv, the session transcript, and (once you paste the command) shell
history, none of which are confidential. Nothing is lost: your settings still apply as
an **underlying layer** beneath `--settings` — `permissions.deny` unions across layers
and hooks from both layers fire (Decision 13, spike item 2 + the v1.47.1 amendment). A
consequence of the same change: `permissions.allow` is no longer unioned with your layer
(the template is the sole source), and stale `FACTORY_ORIGINAL_STATUSLINE` /
`FACTORY_SETTINGS_HASH` values from a prior relaunch can no longer ride along, so they
are no longer scrubbed.

```
factory autonomy ensure [--user-settings <path>]
```

| Flag                     | Required | Notes                                                                                                          |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- |
| `--user-settings <path>` | no       | Override the user-settings source (default: `~/.claude/settings.json`). Only its `statusLine` command is read. |

Prints a human-readable relaunch message to stdout that includes the command

```
claude --worktree --settings '<json>'
```

— not a `{kind:…}` envelope. The command carries **no permission-mode override**: the
inline settings are permissive by design and that is the entire mechanism (the 2026-08-17
spike on Claude Code 2.1.233 rejected native `--permission-mode auto` — its probabilistic
classifier blocked a required pipeline op and approved an out-of-root write; see the
Decision 65/67 amendment). Task worktrees
and results live under the target repo's `.claude/worktrees/` — the one subtree Claude
Code's built-in protected-path check exempts — and nothing else agent-side writes under
`~/.claude/` (the plugin's data dir holds run/spec state, which only the engine writes,
via Node `fs`, which the permission system never sees). The real security boundary stays
the path-resolving hook layer (branch-protection, secret-guard, pipeline-guards,
holdout-guard, write-protection); the template's `deny` block is deliberately short —
accident-prevention for a non-adversarial agent, not a containment boundary. See
[Decision 67](../explanation/decisions.md#decision-67--task-worktrees--results-relocate-into-the-target-repos-claudeworktrees)
for the relocation and [Decision 65](../explanation/decisions.md#decision-65--deny-list-shrink-to-honest-accident-prevention)
for the deny-list.

### `autonomy status`

Reporter. Reports whether the current session satisfies the autonomy gate. **Exits 0
when autonomous, 1 when not — and never throws** (it is the diagnostic you run precisely
when the gate has halted you).

```
factory autonomy status [--json]
```

| Flag     | Required | Notes                                          |
| -------- | -------- | ---------------------------------------------- |
| `--json` | no       | Emit the machine-readable payload (see below). |

`--json` emits `{ autonomous, envSet }`: `autonomous` is the gate predicate
(`FACTORY_AUTONOMOUS_MODE === "1"`); `envSet` distinguishes an unset var from a wrong
value. **Breaking (v1.47):** the `mergedSettingsPresent`/`mergedSettingsPath` fields are
gone with the on-disk artifact.

### `autonomy preflight`

Composer — the run-entry check `/factory:run` (and `/factory:debug`) calls at the top of
setup ([Decision 31](../explanation/decisions.md#decision-31-run-entry-preflight-auto-scaffolds-autonomous-settings)).
Rather than merely halting and telling you to run `ensure` yourself, it builds and
prints the relaunch for you when the session is not autonomous.

```
factory autonomy preflight [--user-settings <path>]
```

The verdict is **two-state** (v1.47 — the staleness/hash state machine died with the
on-disk artifact; every relaunch carries the current settings by construction):

| Autonomous?                                                     | Outcome                                              |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| yes (however the env got set, incl. a directly-exported CI env) | **proceed** (exit 0, nothing built)                  |
| no                                                              | **build in memory + print relaunch + halt** (exit 1) |

On a halt it delegates to `ensure` and prints the same inline-settings
`claude --worktree --settings '<json>'` relaunch block ([see `ensure`](#autonomy-ensure)),
and **exits 1**. On proceed it touches nothing and **exits 0**. Like `status`, it is
infallible on the decision path (an unresolvable data/root dir or template degrades to a
halt-with-message, never a throw). The relaunch itself is irreducible — Claude Code reads settings only at launch,
so a running session can never make _itself_ autonomous; preflight automates the scaffold, not
the relaunch. The mandatory-autonomy engine gate (`requireAutonomousMode`, Decision 29) stays as
the correctness backstop behind it.

| Flag                     | Required | Notes                                                             |
| ------------------------ | -------- | ----------------------------------------------------------------- |
| `--user-settings <path>` | no       | Override the user-settings source passed through to a regenerate. |

## `statusline`

Side-effecting passthrough — NOT a machine subcommand. Wire it as the Claude Code
`statusLine.command`. Claude Code pipes a JSON payload to stdin on every statusline
tick; this subcommand:

1. reads the whole stdin payload (may be empty / non-JSON),
2. if it carries `.rate_limits`, atomically persists `rate_limits + {captured_at}`
   to `${CLAUDE_PLUGIN_DATA}/usage-cache.json` — the ONLY producer of the cache the
   quota pacer (`StatuslineUsageSignal`) reads,
3. passes the SAME payload through to `$FACTORY_ORIGINAL_STATUSLINE` (if set) and
   forwards ITS stdout as the displayed statusline (with a 3s timeout).

```
factory statusline
```

IO contract: stdout is the DISPLAYED statusline text (passthrough), never a
`{kind:…}` envelope. Fail-soft invariant: the statusline fires constantly and must
never crash — every degraded condition (empty/non-JSON stdin, no `rate_limits`,
unresolvable data dir, a broken/slow original command) is a clean no-op returning
exit 0. Diagnostics go to stderr; a cache-write failure is additionally surfaced
inline in the displayed text (`[factory: usage-cache …]`) so a silently stale
quota cache is visible.

**Run-progress suffix (S11, [Decision 49](../explanation/decisions.md#decision-49--observability-touch-metric--statusline-progress--score---fleet)).**
When a current run exists, the displayed text gains a suffix
` [factory <done>/<total> <phase> <run_id> <status>]` — shipped/total task counts,
the first in-flight task's phase, the run id, and the run status. It resolves the
repo from the payload's `workspace.current_dir` and reads THAT repo's per-repo
current pointer (Decision 61 — no global `runs/current` to read) straight through
to `state.json` with a plain `JSON.parse` (never `parseRunState`): a torn
concurrent write, schema mismatch, missing pointer, or a cwd outside any checkout
degrades to **no suffix**, never a throw. Terminal runs
(`completed`/`failed`/`superseded`) linger for **30 minutes** past `ended_at`, then
the suffix disappears. Set `FACTORY_STATUSLINE_PROGRESS=0` to suppress the suffix
entirely (the usage-cache write is unaffected). Because it keys off the payload's
`workspace.current_dir`, two concurrent runs in different repos each show their
OWN run's suffix; a tick with no usable cwd (or outside any checkout) simply shows
no suffix.

## `debug <start|review|spec|seed|finalize>`

The `/factory:debug` whole-scope review⇄fix loop: review the CURRENT state of a
checkout (not a PRD), convert adjudicated findings into a fix spec, run the fix
tasks through the normal task pipeline, and repeat for a bounded number of passes.

```
factory debug start [--base <ref> | --full] [--no-ship] [--author-e2e] [--max-passes <n>] [--session-id <id>]
factory debug review --emit --run <id>
factory debug review --record --run <id> --results <path>
factory debug spec resolve|gate|store --run <id>
factory debug seed --run <id>
factory debug finalize --run <id> [--no-ship]
```

| Action     | What it does                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `start`    | Cut the debug staging branch from the target's HEAD, mint the run id, emit the pass-1 review scope. |
| `review`   | `--emit` spawns the whole-scope review panel; `--record` adjudicates its output.                    |
| `spec`     | Thin pass-through to `factory spec resolve\|gate\|store` fed a synthetic PRD.                       |
| `seed`     | Create (pass 1) or append (pass > 1) the run's tasks from the resolved spec.                        |
| `finalize` | Turn an all-terminal debug run into its shipped outcome.                                            |

The in-session runner drives the agent spawns AND the bounded review⇄fix loop;
each action emits ONE JSON envelope naming the next step. Scratch JSON lives in
`<dataDir>/debug/<run-id>/{session.json,pass-<n>/findings.{json,md}}`. A debug
run resumed via `factory resume` answers `{ kind:"debug-resume", run_id, run }` —
continue it with `factory debug`, not the PRD pipeline.
