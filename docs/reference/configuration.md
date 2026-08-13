# Configuration Schema

All configuration lives in one Zod schema, `src/config/schema.ts`, where every
field carries a default. `ConfigSchema.parse({})` yields a complete, typed config,
so a missing config file is equivalent to all-defaults. Inspect and edit the
overlay with `factory configure` (see [cli.md](./cli.md)); print the resolved
config with `factory config-defaults`.

Edits are persisted as a **sparse overlay** — only the keys you set are written,
so unset keys continue to track future default changes.

Key paths are dotted (e.g. `quality.holdoutPercent`, `git.baseBranch`).

## Data dir (`CLAUDE_PLUGIN_DATA`)

Run/spec state lives OUTSIDE the target repo, under the data dir resolved by
`resolveDataDir()` (`src/config/load.ts`). The canonical dir for this install is:

```
~/.claude/plugins/data/factory-jfa94
```

`factory-<marketplace-id>`, where `jfa94` is this marketplace's id
(`.claude-plugin/marketplace.json` `name`). Production callers set it via the
`CLAUDE_PLUGIN_DATA` env var; if it is unset, state-using commands loud-fail with
a message pointing at the `factory-<your-marketplace-id>` form.

### The foreign-plugin leak (benign, self-corrected)

Another plugin (e.g. `codex`) can set `CLAUDE_PLUGIN_DATA` to **its own** data dir
(under `~/.claude/plugins/data/`). The source of the leak is outside factory's
control. Factory self-corrects: when `CLAUDE_PLUGIN_DATA` points at a foreign
plugin's dir, `resolveDataDir()` derives the canonical `factory-jfa94` dir (from
the cache-install layout, falling back to `marketplace.json`) and uses that
instead — so state is never written into another plugin's dir.

A **successful** redirect emits a **single DEBUG notice per distinct redirect per
process** (keyed on the `current → corrected` pair; `resolveDataDir()` is called
~20×/command, so the notice is deduplicated rather than spammed). It was demoted
from WARN to DEBUG (Fix 8): a self-correcting redirect is benign, so it no longer
clutters normal output — only a **real** problem inside the expected data dir (an
unparseable `marketplace.json`) still emits a WARN. The notice states that another
plugin set the var, that factory auto-redirected to its canonical dir, that no
action is required for correctness, and — if you want to silence it permanently —
to set `CLAUDE_PLUGIN_DATA` to factory's own `factory-<your-marketplace-id>` dir.
The redirect **behavior** is unconditional and unaffected by the notice
rate-limiting.

Why the leak happens, why it is benign, and why the notice repeats across
commands is explained in
[the plugin-data-dir explanation](../explanation/plugin-data-dir.md).

## `quality`

Quality-gate thresholds.

| Key                              | Type                  | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `holdoutPercent`                 | number 0–100          | `20`    | Percent of acceptance criteria withheld as an unreadable answer-key.                                                                                                                                                                                                                                                                                                                                                          |
| `holdoutPassRate`                | number 0–100          | `80`    | Min pass-rate (%) on the holdout set to clear the gate.                                                                                                                                                                                                                                                                                                                                                                       |
| `mutationScoreTarget`            | number 0–100          | `80`    | Target mutation score (%) for the mutation gate.                                                                                                                                                                                                                                                                                                                                                                              |
| `coverageRegressionTolerancePct` | number ≥0             | `0.5`   | Allowed coverage regression (percentage points) before the gate fails.                                                                                                                                                                                                                                                                                                                                                        |
| `securityCommand`                | string (optional)     | —       | Custom SAST/security command; else the built-in semgrep run.                                                                                                                                                                                                                                                                                                                                                                  |
| `securityAllowFailures`          | boolean               | `false` | Treat security findings as non-blocking.                                                                                                                                                                                                                                                                                                                                                                                      |
| `securityRedactFindings`         | boolean               | `true`  | Redact secrets from the persisted findings artifact.                                                                                                                                                                                                                                                                                                                                                                          |
| `setupCommand`                   | string (optional)     | —       | Per-worktree env-prep command run once in the new task worktree, BEFORE the test/type/build gates. When unset, a lockfile is auto-detected (`pnpm-lock.yaml` → `pnpm install --frozen-lockfile`, `yarn.lock` → `yarn install --frozen-lockfile`, `package-lock.json`/`npm-shrinkwrap.json` → `npm ci`); no lockfile is a no-op. Set this for non-JS repos or custom setups. Fails the run LOUD at preflight on non-zero exit. |
| `gateEnv`                        | record<string,string> | `{}`    | Name→value env vars injected into **every** deterministic gate command (`build`/`test`/`type`/`lint`/`mutation`/`security`), merged over `process.env`. Mirrors the repo's CI build-step env so the gate measures the code, not a missing-env crash. **Placeholders only — not a secret store.** See [the gate-env note](#gateenv--ci-parity-placeholders) below.                                                             |

### `gateEnv` — CI-parity placeholders

The deterministic gates run in a **fresh task worktree** with no `.env.local` and no
build-time env injection. A repo whose CI supplies placeholder env vars for the same
build step — e.g. a Next.js static prerender that needs `NEXT_PUBLIC_*` defined — would
otherwise fail the `build` gate on a missing-env crash, a **false-negative floor**
unrelated to task quality. `quality.gateEnv` closes that gap: its name→value map is
merged over `process.env` into the spawn env of every gate command
(`defaultGateTools(gateEnv)`, `src/verifier/deterministic/tools.ts`, wired from config in
`src/cli/wiring.ts`).

**Setting values.** Mirror your CI build-step env by setting each leaf individually:

```bash
factory configure --set quality.gateEnv.NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
factory configure --set quality.gateEnv.NEXT_PUBLIC_SUPABASE_KEY=ci-placeholder
```

The schema requires **string** values whose keys are valid POSIX env names
(`z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())`) — an explicit "set this var"
with a usable name. A purely numeric value is JSON-coerced to a number at the `--set` boundary
and rejected, so quote it as JSON: `--set quality.gateEnv.PORT='"54321"'`.

**One config, both gates.** `quality.gateEnv` is the single source of truth for build-env parity in
**both** directions: the local merge gate merges it over `process.env` for every gate command, and
`factory scaffold` injects it into the managed `quality-gate.yml` it renders — `injectGateEnvIntoWorkflow`
(`src/ci/inject-gate-env.ts`) replaces the `# factory:gate-env` marker following the rendered build
step with a real `env:` block built from the resolved map. So editing `quality.gateEnv` (then
re-scaffolding) keeps the local gate and the repo's GitHub CI in lockstep; an empty map leaves the
marker untouched, and a re-scaffold is byte-identical (idempotent).

This is **CI parity, not secrets**: these placeholders sit in the sparse config overlay in
plaintext. Never put a real credential here — they exist only so the merge gate
exercises the same build CI does.

## `quota`

The two-window quota pacer.

| Key                     | Type      | Default                  | Meaning                                                                                                                                                                                                                                                 |
| ----------------------- | --------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hourlyThresholds`      | number[5] | `[20,40,60,80,90]`       | 5h-window utilization caps by hour 1..5 (%).                                                                                                                                                                                                            |
| `dailyThresholds`       | number[7] | `[20,40,60,80,95,95,95]` | 7d-window utilization caps by day 1..7 (%). Ramps to 95% by window-day 5 (a 5-workday spend pattern) then plateaus through days 6–7, leaving a 5% end-of-window reserve. "Window-day N" is a position in the rolling 7d window, not a calendar weekday. |
| `producerModels.low`    | string    | `claude-sonnet-4-5`      | Producer model for low risk tier.                                                                                                                                                                                                                       |
| `producerModels.medium` | string    | `claude-sonnet-4-5`      | Producer model for medium risk tier.                                                                                                                                                                                                                    |
| `producerModels.high`   | string    | `claude-opus-4-6`        | Producer model for high risk tier.                                                                                                                                                                                                                      |

Each `hourlyThresholds` / `dailyThresholds` element is validated as a percentage in
`[0, 100]`, and the array as a whole must be **non-decreasing** (a later checkpoint may
not cap lower than an earlier one) — an out-of-range or descending value is a loud config
error, never persisted.

The review panel is risk-_invariant_ (Decision 26), so there is no review-depth
dial here. `producerModels` is the only dial the quota router carries.

## `spec`

The spec-build pipeline.

| Key                   | Type     | Default | Meaning                                                                          |
| --------------------- | -------- | ------- | -------------------------------------------------------------------------------- |
| `passReviewThreshold` | int 0–60 | `56`    | The single spec-review pass threshold out of 60.                                 |
| `dimensionFloor`      | int 0–10 | `5`     | Any rubric dimension scoring `≤` this forces NEEDS_REVISION regardless of total. |
| `maxRegenIterations`  | int >0   | `5`     | Max generate ⇄ review revision iterations before a loud give-up.                 |
| `prdBodyMaxBytes`     | int >0   | `65536` | Max bytes of PRD body retained before truncation.                                |

The Decision-21 apex pin (the model/effort the spec generator AND reviewer run at)
is deliberately **not** a config key: it is an _unconditional_ pin, hard consts in
`src/spec/agents.ts` — invariant by construction.

## `review`

The judgment panel.

| Key                  | Type                | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`              | string (optional)   | —       | **Holdout-validator model override only.** The review panel no longer reads this key — each reviewer runs on a fixed **per-role** model ([Decision 64](../explanation/decisions.md#decision-64--per-role-reviewer-model-reverses-the-single-fixed-reviewer-model)). It now only overrides the `general-purpose` holdout-validator sidecar's model (`resolveReviewModel`, consumed at `src/orchestrator/orchestrator.ts`); unset ⇒ the documented fallback. |
| `requireCrossVendor` | `"warn" \| "block"` | `warn`  | Policy when no cross-vendor (Codex) reviewer ran on the advancing verify pass ([Decision 44](../explanation/decisions.md#decision-44--verifier-upgrades-grep-rescue-claim-only-verification-real-cross-vendor)). `warn` records the absence loudly; `block` additionally fails the merge gate so a task cannot ship single-vendor.                                                                                                                         |

Cross-vendor availability is **probed at spawn time** (`codex --version`, memoized),
never inferred from config presence — the engine stamps `cross_vendor` on the verify
spawn manifest and the runner executes the quality-reviewer via `codex exec` when
Codex is present. `requireCrossVendor` only sets the policy for when it is **absent**.
See [verifier.md](../explanation/verifier.md).

> **Recommendation (Decision 61).** The default stays `warn`. Flip to `block` **only
> once Codex is reliably provisioned in the run environment AND autonomous repair is
> live** (self-heal recovers environmental blocks) — under `block`, a missing Codex
> fails the task _environmental_ (not merge-gate-blocked), which is rescue-recoverable
> but becomes a stall source without self-repair. Set it per-maintainer via
> `factory configure --set review.requireCrossVendor=block` (writes
> `$CLAUDE_PLUGIN_DATA/config.json`, not the repo).

> **Turn budgets are no longer configurable here.** The former `review.maxTurnsDeep` /
> `review.maxTurnsQuick` keys and the whole `testWriter` block are **deleted**. Every
> agent's turn cap (`max_turns`) is now single-sourced to its own frontmatter
> (`agents/*.md` `maxTurns:`) — the engine never stamps it, so it is plugin-author-owned,
> not operator-tunable ([Decision 63](../explanation/decisions.md#decision-63--per-agent-dial-pinning--max_turns-single-sourced-to-frontmatter)).
> The one carve-out is the `general-purpose` holdout-validator sidecar, whose cap is the
> `HOLDOUT_MAX_TURNS` const in `src/orchestrator/orchestrator.ts` (no frontmatter to fall
> back to).

## `codex`

| Key     | Type              | Default | Meaning                               |
| ------- | ----------------- | ------- | ------------------------------------- |
| `model` | string (optional) | —       | Codex cross-vendor implementer model. |

## `git`

Branch and protection contract.

| Key                           | Type     | Default                                                           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | -------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseBranch`                  | string   | `develop`                                                         | The durable integration base: each run's `staging-<run-id>` branch forks from it and rolls up into it. Scaffold protects this branch. Never `main`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `developProtection`           | enum     | `run-scoped`                                                      | Decision 74. `run-scoped`: develop sits at the **baseline** profile at rest; `run create` escalates to the strict run profile and every run-terminal path (finalize / supersede / `cancel --cleanup`) drops it back; `resume` re-escalates idempotently. `permanent`: scaffold writes the strict profile once and the engine never touches develop protection again (pre-D74 behavior). Run-scoped caveat: the engine's PUTs are full replaces — custom manual rules on develop get clobbered.                                                                                                                                                                   |
| `developBaselineStatusChecks` | string[] | derived: `developRequiredStatusChecks` minus `"Mutation Testing"` | The at-rest baseline profile (run-scoped mode): required checks for **non-admin** PRs into develop, `strict: false`, `enforce_admins: false` — admins can push develop directly between runs. Derived default drops exactly the mutation gate, so a custom run-profile context (e.g. a repo's pgTAP check) stays required at rest; an explicitly set value (including `[]`) overrides. A repo's committed contract can add checks additively via `requiredChecks`, or keep `"Mutation Testing"` required at rest via `requireMutationAtRest` — see [per-repo required checks](automated-gates.md#per-repo-required-checks-requiredchecks-requiremutationatrest). |
| `developRequiredStatusChecks` | string[] | `["Quality", "Mutation Testing", "Security Scan"]`                | Status checks the **strict run profile** enforces on `develop` (written at `run create` in run-scoped mode; at scaffold `--provision` in permanent mode). Defaults to the three contexts the rendered quality-gate workflow always reports (Decision 53), so the rollup PR cannot merge red. A repo's committed `.factory/gates.json` can add extra contexts via `requiredChecks` (additive-only) — see [per-repo required checks](automated-gates.md#per-repo-required-checks-requiredchecks-requiremutationatrest).                                                                                                                                            |
| `stagingRequiredStatusChecks` | string[] | `[]`                                                              | Status checks provisioned onto each **`staging-<run-id>`** branch at run create. Empty by default: the engine's local GateRunner is the primary task-level gate, and a required check here would make every task-PR merge wait on CI wall-clock. Protection itself (strict-up-to-date) is still mandatory.                                                                                                                                                                                                                                                                                                                                                       |
| `provision`                   | boolean  | `false`                                                           | Opt-in protection provisioning. Off by default — the run verifies and refuses when protection is missing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `branchPrefix`                | string   | `factory`                                                         | Prefix for run-scoped task branches: `<branchPrefix>/<run_id>/<task_id>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `rollupCiWaitMinutes`         | int >0   | `30`                                                              | Outer bound (minutes) finalize waits for the rollup PR's full-CI gate before giving up with `ci-timeout`. Sized above the slowest expected quality-gate run (mutation on a cold cache); a timeout parks the run recoverably (`factory resume` re-enters the poll). Replaces the former hard-coded ~20-min bound ([Decision 75](../explanation/decisions.md#decision-75--mutation-ci-redesign-develop-only-warm-base-incremental-hash-shards-roots)).                                                                                                                                                                                                             |

## `e2e`

The run-level end-to-end phase ([Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag),
overhauled by [Decision 40](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)).
All keys are optional/defaulted, so a repo that never passes `--e2e` pays nothing. Every
key below is **actually read** by the runtime at each call site (`src/orchestrator/e2e.ts`,
`src/orchestrator/assessment.ts`, `src/verifier/e2e/runner.ts`) — nothing here is
declared-but-unwired.

**Boot config is resolved, not required (Decision 40 D2/D10).** `startCommand`/`baseURL`
are **optional overrides**. The single source of truth for the boot command + URL is the
repo's `playwright.config.ts`, which the run-start **e2e-assessment** phase resolves and
writes on the first `--e2e` run (`resolveBootConfig` = config override ?? assessment-resolved).
An `--e2e` run no longer requires these keys to be set; instead `factory run create --e2e`
eagerly checks three static prerequisites — `package.json`, a `@playwright/test` dependency,
and a `playwright.config.ts` — and fails loud at create time if any is missing. Set the two
keys only to **override** what the assessment would otherwise resolve.

| Key              | Type              | Default | Meaning                                                                                                                                                                                                                          |
| ---------------- | ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `startCommand`   | string (optional) | —       | **Optional override.** Command that boots the target app — for Playwright's `webServer` (test runs) and the e2e-author's live-exploration boot. Unset ⇒ the assessment-resolved value in `playwright.config.ts` is used instead. |
| `baseURL`        | URL (optional)    | —       | **Optional override.** Base URL the app serves once `startCommand` is up. Validated as a well-formed URL at config-parse time. Unset ⇒ the assessment-resolved value is used.                                                    |
| `readyTimeoutMs` | int >0            | `30000` | Max wait for `startCommand` to become ready before the boot is a failure (ms).                                                                                                                                                   |
| `reopenCap`      | int ≥0            | `2`     | Per-task cap on e2e-triggered reopens. A critical spec still red after this many reopens of its mapped task fails the run outright instead of looping forever.                                                                   |

To override the assessment-resolved boot config, set either or both keys:

```bash
factory configure --set e2e.startCommand="npm run dev"
factory configure --set e2e.baseURL="http://localhost:3000"
```

> The committed critical suite lives in the literal `e2e/` directory — persistence there IS
> the criticality signal (no `@critical` tag exists). This is **not configurable** (the
> retired `e2e.testDir` key is ignored with a warning): the seeded
> `templates/playwright.config.ts` hardcodes `e2e`, and the TCB `e2e-suite` write-guard is
> hardcoded to the same path component; a custom `testDir` would silently diverge from what
> actually runs and gates, so the engine holds the path as the constant `E2E_TEST_DIR`
> (`src/config/schema.ts`) rather than leaving it a knob. The **target repo's own** `playwright.config.ts` is checked against the same
> literal at run birth (S4): `run create --e2e` refuses a config whose declared `testDir` is
> not `e2e`/`./e2e` (an absent declaration fails closed — Playwright defaults to `tests`,
> outside the write-deny). (There is **no** CI `e2e` job — [Decision 40 D11](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)
> removed it from `quality-gate.yml`; e2e gating is run-level only.) See
> [Run with end-to-end tests](../guides/run-with-e2e.md).

## Root keys

| Key                      | Type   | Default | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxConsecutiveFailures` | int >0 | `3`     | **Floor** of the circuit-breaker threshold: the run aborts when cumulative genuine `capability-budget` failures (cascade/wedge fails excluded) reach `max(floor, ceil(0.15 × total tasks))` — big task graphs tolerate proportionally more (≤20 tasks behave as a flat cap of 3; 30 → 5, 40 → 6). The ratio is a module constant, not config. The key keeps its historical name for back-compat.                                                                                                                                                                                                                                                                                                                                      |
| `maxParallelTasks`       | int >0 | `3`     | Max tasks the runner drives in flight at once; emitted to the runner as `max_parallel` on the `work` envelope (the runner reads the envelope, never this file). `1` = sequential.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `stallTtlMinutes`        | int >0 | `15`    | Minutes an in-flight spawn (`spawn_in_flight.spawned_at`) may age before `next-task` flags its task in the `work` envelope's `stale` list (the ADVISORY band: `stallTtlMinutes < age ≤ hungSpawnMinutes`). A silently-dead agent inside a live session is otherwise never re-driven. The flag tells the runner to liveness-check the spawn's agents and, only if all are dead, abandon and re-drive via `next-action` (see [cli.md](./cli.md#next-task) and [state-model.md](./state-model.md#spawn_in_flight--idempotent-re-spawn-checkpoint)). Also sizes the runner's heartbeat cron, which clamps the interval to `min(TTL, 59)` because `*/60` is invalid cron syntax — keep it under 60 anyway (usage-cache staleness ceiling). |
| `hungSpawnMinutes`       | int >0 | `120`   | HARD wall-clock cap on one in-flight spawn (Decision 66). Past this age `next-task` flags the task in the `work` envelope's `hung` list (disjoint from `stale`): the runner kills the spawn's agents **even if alive** and re-drives. Bounded engine-side by `SPAWN_REDRIVE_CAP` (2) per `(phase, rung)` checkpoint — once spent, the re-drive fails the task `blocked-environmental` so finalize → rescue-auto → page own the escalation. Must exceed `stallTtlMinutes` (schema-enforced).                                                                                                                                                                                                                                           |

## Retired keys

The following bash-era keys are deliberately **absent** and must not be carried
forward (human-review gates are retired — Decision 5/19; the review-depth axis was
removed — Decision 25): `humanReviewLevel`, `NEEDS_DISCUSSION`, the exit-42 code,
and the per-tier review caps.

These schema keys were removed because they were **never actually consumed**. Zod
strips an unknown key silently, so `loadConfig` warns loudly (once per process per
file) when a raw overlay still carries one:

| Retired key         | Why it is gone                                                                                                                                                     | Replacement                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| `git.stagingBranch` | Every consumer read the schema default, never a set value — there is no shared staging branch. The real branch is per-run `staging-<run-id>` (`runStagingBranch`). | none needed (the prefix is a constant)               |
| `e2e.testDir`       | A `superRefine` already rejected every non-default value, so the knob could only ever hold `e2e`. Both the template and the TCB write-guard hardcode that path.    | the `E2E_TEST_DIR` constant (`src/config/schema.ts`) |

Remove them from your overlay:

```bash
factory configure --unset git.stagingBranch
factory configure --unset e2e.testDir
```
