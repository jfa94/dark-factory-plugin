# How to Run with End-to-End Tests

This guide adds an autonomous Playwright end-to-end (e2e) phase to a run. The unit
gates (vitest, TDD, coverage, mutation, SAST, type, lint) verify each task in
isolation; they cannot catch a feature that breaks only once every task's change is
integrated. The e2e phase authors and runs journey tests against the **integrated
staging app** after all tasks are terminal, and reopens the task responsible for any
failing journey. It assumes you already know how to [run the pipeline](./run-the-pipeline.md).

For the design rationale (criticality-by-persistence, the fail-first proof, the reopen
cadence), see [Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag);
for the zero-knowledge overhaul (run-start assessment, adjudication, resolved-not-required
boot config, plain-language reporting) see
[Decision 40](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language).
For the config keys and CLI surface, see [configuration](../reference/configuration.md#e2e),
[`run e2e-assess`](../reference/cli.md#run-e2e-assess), and [`run e2e`](../reference/cli.md#run-e2e).

## Prerequisites

`factory run create --e2e` eagerly checks three **static** prerequisites at create time and
fails loud if any is missing (Decision 40 D2):

- a `package.json`,
- a `@playwright/test` dependency, and
- a `playwright.config.ts`.

The runner refuses the `npx` fallback: a missing local `node_modules/.bin/playwright` fails
the phase loud. Everything else the phase needs to actually boot — the start command, the
base URL, and any seed/auth machinery — is **resolved for you** by the run-start assessment
(next section), not something you must configure up front.

## 1. Boot config is resolved, not configured (optional override)

You no longer have to configure a start command or base URL before an `--e2e` run. The
run-start **e2e-assessment** phase resolves the real boot command + URL, writes them into the
repo's `playwright.config.ts` (the single source of truth, Decision 40 D10), and validates
them by actually booting the app. `resolveBootConfig` reads a config override **if present**,
else the assessment-resolved value.

Set the two keys only to **override** what the assessment would resolve:

```bash
factory configure --set e2e.startCommand="npm run dev"
factory configure --set e2e.baseURL="http://localhost:3000"
```

The scaffolded `webServer` block is **env-driven**: the phase passes `FACTORY_E2E_START_COMMAND`,
`BASE_URL`, and `FACTORY_E2E_READY_TIMEOUT_MS` into every Playwright invocation, plus
`FACTORY_E2E=1` — which forces `reuseExistingServer: false` so a factory-driven run always
boots a fresh app. Playwright's own `webServer` owns the boot, readiness poll, and teardown;
the engine does not run a separate process manager. `baseURL` (when set as an override) is
validated as a well-formed URL at config time (see the [full key table](../reference/configuration.md#e2e)).

The committed critical suite always lives in the literal `e2e/` directory. This is
**not configurable** — the scaffolded `playwright.config.ts` and the TCB write-guard
both hardcode that path, so the engine holds it as a constant (`E2E_TEST_DIR`) rather
than a knob. (The old `e2e.testDir` key is retired; an overlay still carrying it is
ignored with a warning.) The repo's **own** `playwright.config.ts` is held to the same
literal at run birth: `run create --e2e` reads it and refuses any `testDir` other than
`e2e`/`./e2e` (S4, see [Limitations](#limitations)).

Remaining tuning keys:

- `e2e.readyTimeoutMs` (default `30000`) — how long to wait for the app to boot.
- `e2e.reopenCap` (default `2`) — how many times a task may be reopened by a still-red
  critical journey before the run fails outright.

## 2. Start the run with `--e2e`

```
/factory:run --repo <owner/name> --issue <N> --e2e
```

`--e2e` is **create-only and immutable**, exactly like `--no-ship`: it is
persisted on the run at creation and cannot be added, removed, or changed on resume.
Passing `--e2e` together with `--resume` is rejected loud — a resumed run keeps the
`e2e` setting it was born with. It combines freely with `--no-ship` and
`--ignore-quota`.

## 3. What the e2e phase does

### 3.0 Run-start assessment (before any task)

Before the FIRST task runs, `factory next-task` schedules a one-time **e2e-assessment**
stage (`factory run e2e-assess`, Decision 40 D3). The `e2e-assessor` agent (pinned to opus)
does three jobs in one spawn:

- **Coverage forecast** — maps each EXISTING committed spec this run's tasks touch to a
  `should-still-pass` or `needs-update` expectation. This forecast is what later routes an
  unmappable suite failure through adjudication (§3.4).
- **Machinery** — resolves the real boot config (start command + base URL), writes it into
  the repo's `playwright.config.ts` (the single source of truth), and authors any seed/auth
  support the app needs (`e2e/support/seed.ts`, `e2e/auth.setup.ts`). It **validates** by
  actually booting the app and logging in.
- **Verdict** — `ok`; `degraded` (auth machinery couldn't be resolved → coverage degrades to
  logged-out, with a named warning in the report); or `boot-impossible` / `machinery-impossible`,
  either of which **fails the run LOUD in plain language** before any task work is spent (every
  non-terminal task is swept `blocked-environmental`).

A deliberate `-impossible` verdict is final; only a crash or a guard violation earns one
automatic re-spawn. The result is persisted on run state as `e2e_assessment`.

### 3.1 The e2e phase (once every task is terminal)

Once every task is terminal and the run would complete, `factory next-task` schedules the
e2e stage **before** documentation (don't document code the e2e verdict is about to
change). The runner steps [`factory run e2e`](../reference/cli.md#run-e2e):

1. **Author (once per run).** The `e2e-author` agent boots the app, explores each
   user-facing task via the Playwright MCP tools, and writes two kinds of spec —
   distinguished only by **where they land**:
    - **Critical** specs (committed into the repo's `e2e/` directory) — thin, journey-oriented,
      load-bearing. They gate this run and every future `--e2e` run. (There is **no** CI `e2e`
      job — Decision 40 D11 removed it from `quality-gate.yml` as a self-bricking hazard; e2e
      gating is run-level only.)
    - **Throwaway** specs (a gitignored run directory, never committed) — one per
      user-facing task, broader coverage, discarded at run end.

    The author returns a manifest linking each spec to the `task_id`(s) it covers — the
    only join the engine has from a failing spec back to its task.

2. **Manifest + trust-boundary checks.** The author branch is merged **unreviewed**, so
   before spending the fail-first proof the engine validates the returned manifest: every
   `spec_path` is rejected if it is absolute or contains `..`, and every `task_id` must
   exist in `run.tasks` (an unknown id fails loud instead of silently vanishing at reopen
   time). Two location rules then bound what can land, with `<testDir>/` (e.g. `e2e/`) as
   the single allowed area:
    - Every **`critical`** manifest entry's `spec_path` must itself start with `<testDir>/`.
      A critical entry declared at the repo root (or anywhere outside `testDir`) is rejected —
      otherwise a spec could merge an unreviewed file into application source just by
      self-declaring as "critical".
    - The engine diffs the author branch against staging by name and requires every changed
      file under `<testDir>/` to be a declared **critical** manifest entry (D6), with a
      carve-out for the assessment-owned `e2e/support/**` and `e2e/auth.setup.ts`. Any changed
      path outside `<testDir>/` is rejected outright. Throwaway specs live in a gitignored run
      directory (never committed, so never in this diff), so a legitimate author branch touches only its declared
      critical specs. A stray edit to application source — or an undeclared file under
      `<testDir>/` — aborts the phase rather than landing unreviewed.

    Authored specs also execute under a **scrubbed, allowlisted environment** (only
    `PATH`/`HOME` plus the `FACTORY_E2E_*`/`BASE_URL` boot vars — never the parent process's
    full `process.env`), so an autonomously-authored spec can't reach ambient CI tokens or
    cloud credentials.

3. **Fail-first proof (critical specs only).** Before any critical spec is merged, the
   engine runs it twice: once against the **unmodified base branch** (its `control:`
   assertion must pass — proving the app booted — while every journey assertion fails —
   proving the feature didn't exist yet) and once against **staging with the feature**
   (everything must pass). A spec that already passes on base is rejected as vacuous; one
   whose control fails on base is rejected as "base unusable". Only proven specs are
   merged into `staging-<run-id>`. This stands in for the human review an
   autonomously-authored assertion never gets. The base-side proof runs in a scratch
   worktree that is `npm ci`-provisioned just like a task worktree.

4. **Run the suite + decide.** The full suite runs against current staging — the committed
   critical specs, plus the throwaway specs (which **do** run, via a generated `--config`
   pointing `testDir` at the run's never-committed throwaway dir — `.claude/worktrees/<run-id>/.e2e-throwaway`,
   gitignored, alongside the run's other scratch worktrees — with `cwd` set to the run worktree).
   The run worktree is re-synced to staging and `npm ci`-provisioned on every pass. The
   disposition:
    - **Every critical spec present and green** → the phase passes; a residual throwaway red
      becomes an advisory line in the report, not a blocker. The run proceeds to docs, then
      finalize. A critical spec counts as green only if it appears in the results as
      `passed` or `flaky` — one that is **absent, `failed`, or `skipped`** is a miss that
      reopens its task (no longer treated as a silent pass).
    - **A mappable failure** → the task(s) it covers are reopened (reset to `pending`
      carrying the failure as `e2e_feedback`, with the Playwright per-test error detail —
      4KB cap, D8 — threaded into the feedback) and re-driven through the normal phase
      machine. The run **stays `running`** — the e2e phase never marks the run itself
      failed or complete. Once the reopened tasks settle back to terminal, the phase
      re-fires (re-running the existing suite, not re-authoring it). Pass 1 reopens for any
      mappable failure (critical miss or throwaway red); pass 2+ reopens only for critical.
    - **An unmappable critical failure** (a pre-existing committed spec no manifest entry
      names) → **adjudication** (D7), routed by the assessment's affected-specs forecast: a
      `should-still-pass` spec reopens the task it was mapped to; a `needs-update` spec is
      rewritten to the new behavior by the adjudicator; an **unforecast** spec is ruled by the
      adjudicator — **regression** (fail the run, loud and cited) vs **intentional-change**
      (rewrite the spec, re-prove it fail-first, merge, and re-run the suite). Each spec is
      adjudicated **at most once per run** (`adjudication_counts`); a second failure after its
      one adjudication is a regression. This replaces the old behavior where any unmappable
      critical failure failed the run outright.
    - **A tooling failure** (nonzero Playwright exit / reporter `errors[]` with no individual
      spec marked failed — e.g. the app never booted) fails the run outright rather than
      being silently absorbed into a green suite or attributed to an arbitrary task. This is
      checked for **both** suites: a broken **critical** run always fails the phase, and a
      broken **throwaway** run fails it too **on pass 1** (mirroring the critical check).
      On pass 2+ — where the throwaway tier is already non-gating (Decision 8) — a throwaway
      tooling failure no longer fails the run but is **folded into the advisory line** rather
      than silently dropped.
    - Playwright's own **flaky** classification (fail then pass on retry) never reopens.

## 4. Read the outcome

The e2e phase is not a terminal state — it feeds the normal run outcome (see
[Run the pipeline § Read the outcome](./run-the-pipeline.md#4-read-the-outcome)). It ends
the run's e2e contribution in one of:

- **Pass** — every critical journey green; the committed critical suite ships with the
  rollup and keeps gating future runs. Any throwaway red is reported as advisory. The run
  report lists the verified journeys by their human-readable `title` (Decision 40 D12), plus
  any tasks the e2e suite reopened and any degraded-coverage warnings.
- **Fail** — the run finalizes `failed` when a critical journey exhausts `e2e.reopenCap`, an
  unmappable pre-existing failure is **adjudicated a regression**, a **tooling failure** occurs
  on either suite (nonzero exit / reporter `errors[]` with no spec marked failed — the throwaway
  one only gates on pass 1), the manifest references an unknown `task_id` or an unsafe
  `spec_path`, the author branch violates the trust boundary (a change outside `testDir`, or an
  undeclared file inside it), the fail-first proof rejects a spec, or the e2e-author returns a
  non-`DONE` status. The run can also fail at the **run-start assessment** (`boot-impossible` /
  `machinery-impossible`), before any task runs. There is deliberately no re-author retry loop.
  On a failed e2e phase the traceability, docs, and rollup steps are skipped. A failed verdict is **not
  permanent**, though: `factory rescue apply --reset-e2e` clears the concluded verdict so the
  phase re-enters and re-runs on the next pass. The clear is **manifest-aware**: a phase that
  failed **after** authoring keeps its manifest and per-task reopen counts (the author is not
  re-invoked) and only drops any live adjudication cursor; a phase that failed **before** a
  manifest was ever authored (empty manifest — e.g. the author crashed or returned an unsafe
  path) is cleared **entirely**, so the next pass genuinely re-spawns the author instead of
  settling to a false "done" with zero e2e coverage. `--reset-e2e` also drops a failed run-start
  `e2e_assessment`, and `rescue scan` gained an `e2e_assessment_failed` flag. This is never
  automatic — `factory rescue scan` reports a failed phase as `e2e_failed: true` (folded into
  `needs_rescue` even when every task is `done`), but `apply` clears it only when `--reset-e2e`
  is explicitly passed, once the underlying cause (flaky infra, an app bug, a since-fixed
  reopen-cap exhaustion) no longer applies. Plain `resume` does not clear it — it only re-checks
  the quota gate.
- **Suspend** — the boot config could not be resolved (neither a config override nor an
  assessment-resolved value). Set an override (step 1) and resume:

    ```
    /factory:resume [--run <id>]
    ```

## Limitations

- `debug`'s e2e integration (`--full-e2e`, folding e2e results into a report → spec →
  re-review loop) is **not built** — the deferred item in
  [Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag).
  The e2e runner, author, and manifest contract are consumer-agnostic so debug can become
  a second consumer later, but today the only consumer is `factory run --e2e`.
- The TCB `e2e-suite` write-guard covers only the literal `e2e/` directory. This is a
  deliberate literal (reading config to widen it would be the circular trust the TCB
  refuses). The divergence window is instead closed **at run birth** (S4): `assertE2ePrereqs`
  (`src/orchestrator/preflight.ts`) reads the target repo's own `playwright.config.ts` and
  refuses a `run create --e2e` whose declared `testDir` is anything other than `e2e`/`./e2e`
  — including an **absent** declaration, which fails closed because Playwright's own default
  is `tests`, outside the write-deny. So a suite the guard cannot see never enters a run (see
  [Configuration § e2e](../reference/configuration.md#e2e)).
