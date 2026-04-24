# Pipeline-Score Refinements Design

**Status:** design
**Owner:** Javier
**Date:** 2026-04-21
**Scope:** Refinement to the `pipeline-score` analyzer shipped in `feat/pipeline-score-run`
**Supersedes for the affected sections:** `2026-04-21-pipeline-score-run-design.md`

## Purpose

Address six defects and naming issues found on the first real run of
`pipeline-score` against `run-20260420-141621`:

1. `not_performed` is excluded from compliance %, making compliance trivially
   100 % on runs that silently skipped steps.
2. `skipped_ok` is an over-broad bucket: it lumps mode-legit skips (e.g., no
   spec in task mode) with "task never executed" skips that should count as
   failures.
3. PR CI detection misclassifies PRs whose rollup contains `StatusContext`
   nodes (e.g., Snyk commit-status) as red, because the jq expression only
   reads `.conclusion` (a `CheckRun` field) and ignores `.state` (the
   `StatusContext` field).
4. Quota/utilization checks are emitted only to the observability block.
   They should be a first-class per-task step — the pipeline is supposed to
   check utilization _before_ each task starts.
5. `T13_no_fix_loop_exhaustion` / `T14_terminal_status_done` have unclear
   names and T14 duplicates T9.
6. The header line does not carry the run's start / end time.

## Scope

- Out-of-scope: rewriting the scoring framework or adding new data sources.
  Everything stays deterministic, `bash`+`jq`+`gh`, reading the same
  `state.json` / `metrics.jsonl` / `audit.jsonl`.
- Out-of-scope: producing cross-version trend analytics beyond what the
  existing history subcommand offers.

## Decisions

### D1. `not_performed` counts against compliance

New compliance formula:

    compliance = pass / (pass + fail + not_performed)

`skipped_na` is still excluded (genuine N/A).
`skipped_task_inactive` counts as failure (see D2).

### D2. Split `skipped_ok` into two buckets

- `skipped_na` — step is legitimately N/A in this configuration:
  - Mode mismatch (`R2`/`R3` in task mode).
  - No PR exists to check against (`R9`/`R10`, `T12`/`T13`).
  - No holdout fixture for task (`T7`).
  - Task `risk_tier` is bugfix/chore so policy says don't mutate
    (`T8`).
- `skipped_task_inactive` — task never reached `executing` status. Applies
  to all per-task steps that depend on task activity (`T2`-`T6`, `T9`-`T10`,
  `T14`).

Evaluators return one of: `pass`, `fail`, `skipped_na`, `skipped_task_inactive`,
`not_performed`.

Aggregator keeps five counters instead of four.

Output table renders five columns: `pass`, `fail`, `skip_na`, `skip_inact`,
`not_perf`, `compliance`.

### D3. Fix PR CI detection

In `tools/score-run-backfill.sh`, `eval_R10_final_pr_ci_green`, and
`eval_T11_pr_ci_green` (→ `T12_pr_ci_green` after renumber), replace the jq
expression:

    map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end

with a shared helper that returns one of four outcomes:
`green | red | pending | unknown`.

Rationale: `statusCheckRollup` mixes `CheckRun` nodes (which report terminal
state via `.conclusion`) and `StatusContext` nodes (which report state via
`.state`). Both can also be mid-flight — `CheckRun.status != COMPLETED` and
`StatusContext.state == PENDING|EXPECTED` mean the check has not yet
resolved. The old expression collapsed all three of
{in-flight, StatusContext success, missing conclusion} into `red`, which is
wrong: the outsidey run's PRs 99-102 have only a single Snyk StatusContext
with `state: SUCCESS` but remain pending at the required-check level, and
the scorer must report them as `pending`, not `red` and not `green`.

Normalization — for each rollup entry, derive a tuple `(kind, outcome)`:

- Read `.status`, `.conclusion`, and `.state` (whichever are present).
- If `.status` ∈ {`QUEUED`,`IN_PROGRESS`,`WAITING`,`PENDING`} or
  `.state` ∈ {`PENDING`,`EXPECTED`} or
  (`.status == COMPLETED` but `.conclusion == null`) → `pending`.
- Else resolve `outcome = (.conclusion // .state | ascii_upcase)` and bucket:
  - `SUCCESS`, `SKIPPED`, `NEUTRAL` → `pass`.
  - `FAILURE`, `TIMED_OUT`, `CANCELLED`, `STARTUP_FAILURE`,
    `ACTION_REQUIRED`, `ERROR` → `fail`.
  - Anything else → `unknown`.

Aggregate:

- Any entry `fail` → helper returns `red`.
- Else any entry `pending` → `pending`.
- Else all entries `pass` → `green`.
- Else (empty list, or all `unknown`) → `unknown`.

Caller mapping:

- `eval_R10_final_pr_ci_green` and `eval_T12_pr_ci_green`:
  - `green` → `pass`
  - `red` → `fail`
  - `pending` → `not_performed`
  - `unknown` → `not_performed`
- `tools/score-run-backfill.sh`: when color ∈ {`green`,`red`}, write a
  `task.ci` event with `status: green|red`. When color ∈
  {`pending`,`unknown`}, **skip the emit** so the scorer sees no terminal
  CI evidence and returns `not_performed` — matching the PR's true state.

Implemented as `_gh_pr_ci_color <pr_number>` in
`bin/pipeline-score-steps.sh` so all three call sites share it.

### D4. New `T1_quota_checked` step

Pipeline already emits `quota.check` metric events. Requirement: the event
payload must carry `task_id` so the scorer can correlate checks with tasks.

Step evaluator:

- If task never reached `executing` → `skipped_task_inactive`.
- Else if at least one `quota.check` event with matching `task_id` exists with
  timestamp ≤ task's first `task.start` event → `pass`.
- Else → `fail`.

Pipeline change: the quota gate in `bin/pipeline-lib.sh` (or wherever
`quota.check` is emitted) must include `task_id` when invoked in per-task
context. Run-start checks without a task continue to emit without the field
and are invisible to this step.

### D5. Renumber and rename

Contiguous series `T1`-`T14`, with `T14_terminal_status_done` dropped and
`T13_no_fix_loop_exhaustion` renamed.

| New ID | New name                           | Old ID | Note                                             |
| ------ | ---------------------------------- | ------ | ------------------------------------------------ |
| `T1`   | `T1_quota_checked`                 | —      | new (D4)                                         |
| `T2`   | `T2_executor_spawned`              | `T1`   | renumber                                         |
| `T3`   | `T3_lint_pass`                     | `T2`   | renumber                                         |
| `T4`   | `T4_typecheck_pass`                | `T3`   | renumber                                         |
| `T5`   | `T5_tests_pass`                    | `T4`   | renumber                                         |
| `T6`   | `T6_coverage_non_regress`          | `T5`   | renumber                                         |
| `T7`   | `T7_holdout_pass`                  | `T6`   | renumber                                         |
| `T8`   | `T8_mutation_pass`                 | `T7`   | renumber                                         |
| `T9`   | `T9_reviewer_approved_first_round` | `T8`   | renumber                                         |
| `T10`  | `T10_reviewer_approved_overall`    | `T9`   | renumber                                         |
| `T11`  | `T11_pr_created`                   | `T10`  | renumber                                         |
| `T12`  | `T12_pr_ci_green`                  | `T11`  | renumber                                         |
| `T13`  | `T13_pr_merged`                    | `T12`  | renumber                                         |
| `T14`  | `T14_within_retry_budget`          | `T13`  | renumber + rename (was `no_fix_loop_exhaustion`) |
| —      | (dropped)                          | `T14`  | redundant with `T10`                             |

### D6. Start / end time in header

Source `state.json` fields: `.started_at` and `.ended_at`.

Header line changes from:

    Run: <id>   plugin-version: <v>   mode: <m>   status: <s>   bucket: <b>

to:

    Run: <id>   plugin-version: <v>   mode: <m>   status: <s>   bucket: <b>
    Started: <iso>   Ended: <iso>   Duration: <h:mm:ss>

Duration computed from epoch difference if both are non-null; otherwise the
missing side renders `—` and duration renders `—`.

### D7. Score schema bump

Add top-level `score_schema: 2` field to the JSON output and each
`scores.jsonl` record. Old records (no field or `score_schema: 1`) are
considered legacy — the `history` subcommand includes a column for schema
version and skips cross-schema compliance comparisons.

## Migration

Historical `scores.jsonl` entries were written under schema 1 (four
outcomes, old step IDs). No rewrite — preserve as-is, tag newer entries with
`score_schema: 2`. Users re-scoring old runs will get schema-2 entries
appended.

The golden fixture at `bin/tests/fixtures/score/outsidey-20260420/` must be
regenerated: rebuild `expected.json` after new evaluators land and assert
the new shape in `bin/tests/score.sh`.

## Verification

- `bin/test` must pass with updated fixture.
- `tools/score-run.sh --run run-20260420-141621 --format table` must show:
  - Start / end / duration on the header.
  - Compliance < 100 % on steps with any `not_performed` or
    `skipped_task_inactive`.
  - `T12_pr_ci_green` shows non-zero passes once backfill is re-run against
    the new `_gh_pr_ci_color` helper.
  - `T1_quota_checked` present and populated.
