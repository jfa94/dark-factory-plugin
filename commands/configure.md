---
description: 'Inspect or edit factory pipeline settings'
argument-hint: '[--get <key>] [--set <key=value>] [--unset <key>]'
arguments:
    - name: '--get'
      description: 'Print one resolved value (dotted key path)'
      required: false
    - name: '--set'
      description: 'Set a value (key=value, repeatable), validate, persist'
      required: false
    - name: '--unset'
      description: 'Revert a key to its default (repeatable)'
      required: false
---

# /factory:configure

View and edit the factory config. Every operation goes through one deterministic CLI —
`factory configure` — which validates the whole config against the canonical Zod schema
**before** it touches disk and persists only a sparse overlay (so future default changes
stay visible). You never hand-edit `config.json`.

## Inspect

```bash
factory configure                 # print the full resolved config (defaults + overlay) as JSON
factory configure --get <key>     # print one resolved value, e.g. --get quality.holdoutPercent
```

## Change

```bash
factory configure --set <key>=<value>   # repeatable; validates + persists; prints the resolved config
factory configure --unset <key>         # repeatable; reverts the key to its default
```

`<value>` parses as JSON when it can (numbers, booleans, arrays — `25`, `true`,
`'["a","b"]'`); otherwise as a bare string. A value that fails schema validation is a loud
error and **nothing is written**. Examples:

```bash
factory configure --set quality.holdoutPercent=25
factory configure --set git.provision=true
factory configure --unset quality.securityCommand
```

## The settings (canonical keys + defaults)

These are the keys the schema actually reads. Run `factory configure` to see live values.

### Quality gates (`quality.*`)

| Key                              | Default | Meaning                                               |
| -------------------------------- | ------- | ----------------------------------------------------- |
| `holdoutPercent`                 | 20      | % of acceptance criteria held out as an answer-key    |
| `holdoutPassRate`                | 80      | Min % of withheld criteria that must pass             |
| `mutationScoreTarget`            | 80      | Min mutation score (%)                                |
| `coverageRegressionTolerancePct` | 0.5     | Max coverage drop (pp) before the gate fails          |
| `securityCommand`                | —       | Custom SAST command (else built-in semgrep)           |
| `securityAllowFailures`          | false   | Treat security findings as non-blocking               |
| `securityRedactFindings`         | true    | Redact secrets from the persisted findings artifact   |
| `gateEnv`                        | {}      | Env vars injected into every gate command (CI parity) |

> **`quality.gateEnv`** mirrors your CI build step's env so the verifier floor measures the
> code, not a missing-env build crash. The gates run `build`/`test`/`type`/`lint`/`security`
> in a fresh worktree with no `.env.local`; if your CI injects placeholders for the same
> build (e.g. a Next.js static prerender that needs `NEXT_PUBLIC_*`), set them here as a
> name→value map. **Placeholders only — not a secret store.** Set each leaf individually:
>
> ```bash
> factory configure --set quality.gateEnv.NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
> factory configure --set quality.gateEnv.NEXT_PUBLIC_SUPABASE_KEY=ci-placeholder
> ```
>
> A purely numeric value is JSON-coerced to a number (rejected by the string-only schema) —
> quote it: `--set quality.gateEnv.PORT='"54321"'`.
>
> `factory scaffold` **renders the configured `gateEnv` into the managed `quality-gate.yml`**
> so one config feeds both the local gate and CI (see [/factory:scaffold](./scaffold.md)).

### Spec apex gate (`spec.*`)

| Key                   | Default | Meaning                                             |
| --------------------- | ------- | --------------------------------------------------- |
| `passReviewThreshold` | 56      | Spec-review pass threshold out of 60                |
| `dimensionFloor`      | 5       | Any rubric dimension ≤ this auto-fails the spec     |
| `maxRegenIterations`  | 5       | Max generate→review revisions before a loud give-up |
| `prdBodyMaxBytes`     | 65536   | Max PRD body bytes retained before truncation       |

> The Decision-21 apex pin (spec generator + reviewer model/effort) is NOT config —
> it is invariant by construction, hard consts in `src/spec/agents.ts`.

### Review panel (`review.*`)

| Key                  | Default | Meaning                                                                                                                                             |
| -------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `model`              | —       | Holdout-validator model override only — the panel now stamps a fixed per-role model (Δ T reversal) and no longer reads this key                     |
| `requireCrossVendor` | warn    | Second-vendor reviewer policy (Δ U/S5): `warn` surfaces an absence in the report/summary; `block` fails the merge gate until Codex actually reviews |

> `requireCrossVendor` needs `codex.model` set AND the `codex` CLI installed —
> the engine probes `codex --version` and stamps the verify manifest; with
> `block` + no working Codex, verify wait-retries instead of shipping
> single-vendor.
>
> Reviewer/producer turn budgets (`max_turns`) are no longer config — each
> agent's own frontmatter (`agents/*.md` `maxTurns:`) is the single source of
> truth (not overridable via `/factory:configure`).

### E2E phase (`e2e.*`, Decisions 39 + 40)

| Key              | Default | Meaning                                                                                                                         |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `startCommand`   | —       | **Optional override** (D10) of the boot command — normally the run-start e2e-assessment resolves this itself                    |
| `baseURL`        | —       | **Optional override** (D10) of the base URL the app serves once booted — normally assessment-resolved                           |
| `testDir`        | e2e     | Repo-relative dir the COMMITTED critical suite lives in — persistence here IS the criticality signal, no `@critical` tag exists |
| `readyTimeoutMs` | 30000   | Max wait for the boot command to become ready before the boot fails                                                             |
| `reopenCap`      | 2       | Per-task cap on e2e-triggered reopens; a critical spec still red after this many fails the run outright                         |

> No setup is required before `--e2e` (Decision 40). `run create --e2e` only
> checks the static prerequisites (`package.json`, `@playwright/test` dep,
> `playwright.config.ts` — `factory scaffold` provides them); the run-start
> **e2e-assessment** then resolves the real boot command + base URL and writes
> them into the repo's `playwright.config.ts`. Set `e2e.startCommand`/
> `e2e.baseURL` only to override what assessment resolved (a config value wins).
> If neither source can produce a boot pair, the phase **suspends** loud
> (resumable via `/factory:resume`) rather than skipping silently.

### Quota pacer (`quota.*`)

`hourlyThresholds` ([20,40,60,80,90]), `dailyThresholds` ([20,40,60,80,95,95,95]), and the
producer dial `quota.producerModels.{low,medium,high}` (sonnet/sonnet/opus by risk tier).

### Git / serial-writer (`git.*`)

| Key                           | Default                                     | Meaning                                                                                        |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `baseBranch`                  | develop                                     | Branch staging forks from / rolls up into (never main)                                         |
| `stagingBranch`               | staging                                     | Integration branch task PRs serial-merge into                                                  |
| `developProtection`           | run-scoped                                  | D74: strict profile only while a run is active; `permanent` = always strict                    |
| `developBaselineStatusChecks` | derived: run profile minus Mutation Testing | At-rest checks on develop (run-scoped; non-admin PRs, admins bypass); explicit value overrides |
| `developRequiredStatusChecks` | Quality, Mutation Testing, Security Scan    | Checks the strict run profile enforces on develop (rollup PR gate)                             |
| `stagingRequiredStatusChecks` | []                                          | Checks provisioned onto each per-run staging branch                                            |
| `provision`                   | false                                       | Write branch protection when missing (else refuse)                                             |
| `branchPrefix`                | factory                                     | Prefix for run-scoped task branches                                                            |

> Run-scoped caveat (D74): the engine owns develop's protection shape — its escalate /
> de-escalate PUTs are full replaces, so custom manual rules on develop get clobbered.
> Use `developProtection: permanent` if you manage develop's protection yourself.

### Other roots

`codex.model` (—), `maxConsecutiveFailures` (3 — the
circuit-breaker FLOOR; effective threshold `max(floor, ceil(0.15 × total tasks))`),
`maxParallelTasks` (3 — max tasks the runner drives in flight; emitted as
`max_parallel` on the work envelope).

> Retired (locked decision 5 — human gates removed): `humanReviewLevel`,
> `review.routineRounds/featureRounds/securityRounds`, `review.preferCodex`, the
> `safety.*` block, `execution.*`. These keys no longer exist; do not write them.

## Interactive

With no flags, print the full config, ask the user what to change, and apply each change
with a `--set`/`--unset` call, confirming the resolved value after each.
