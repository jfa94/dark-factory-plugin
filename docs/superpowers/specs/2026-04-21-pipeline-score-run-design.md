# Pipeline Score-Run: Per-Version Performance Test Design

**Status:** design
**Owner:** Javier
**Date:** 2026-04-21
**Scope:** Developer-only tool (not bundled as a plugin command)

## Purpose

Measure how well the `factory` pipeline adheres to its intended protocol on each
run, so plugin version changes can be compared apples-to-apples over time. The
headline metric is "percent of runs that deliver test/CI-passing code without
getting stuck or needing user input," decomposed into a per-step compliance
matrix that flags both _failures_ and _steps that were expected but not
performed_.

Primary audience: the plugin developer (Javier), invoking the tool after each
plugin release or after a significant change.

## Goals

- G1. Deterministic scoring — no natural-language judgment, no agent calls.
- G2. Reproducible inputs — same run state ⇒ same score.
- G3. Single-run analysis by default; batch/filter modes available.
- G4. Distinguish four outcomes per step: `pass`, `fail`, `skipped_ok`,
  `not_performed` (anomaly).
- G5. Accumulate run-level scores in a local history log for version-over-version
  comparison.
- G6. Zero runtime dependencies beyond what the plugin already requires
  (`bash`, `jq`, `gh`).

## Non-Goals

- NG1. Not a replacement for `bin/tests/*` (which tests the scripts
  themselves); this scores _pipeline runs_, not plugin units.
- NG2. No orchestration of new runs; only analyzes existing runs under
  `${CLAUDE_PLUGIN_DATA}/runs/`.
- NG3. No statistical significance testing — reporting absolute counts and
  per-step percentages is sufficient for solo-dev regression detection.
- NG4. Not shipped as a `/factory:*` command; lives under `tools/` for
  internal use.

## Constraints

- Runs before this feature lands do not have plugin version stamped in
  `state.json`. A one-time task must stamp current runs with their known
  version (`0.3.4`) and backfill `#82` CI outcomes via `gh`. Going forward,
  `pipeline-init` writes `.version`.
- `pipeline-wait-pr` currently does not record CI outcome as a metric. A new
  `run.ci` / `task.ci` metric event must be emitted when a PR resolves.
- Interrupted runs should still be usable — backfilling lets us score the
  outsidey `run-20260420-141621` even though it never reached rollup.

## Architecture

```
tools/score-run.sh            ← entry point; interactive picker or flags
  │
  ├─ bin/pipeline-score       ← core analyzer (reusable, deterministic)
  │    ├─ Loads run state.json + metrics.jsonl
  │    ├─ Calls step evaluators (one per expected step)
  │    ├─ Optionally calls `gh` for CI backfill
  │    ├─ Emits score JSON on stdout (default)
  │    └─ `--format table` renders human table (same script, different output)
  │
  └─ appends one-line JSON record to:
       ${CLAUDE_PLUGIN_DATA}/scores.jsonl
```

Rationale: the analyzer lives under `bin/` because it follows the
deterministic-script pattern and is unit-testable via `bin/tests/`. The
interactive wrapper lives under `tools/` (not `commands/`) because this is
dev-only and must not be auto-discovered by plugin consumers.

## Data Sources

Per run, read-only:

| Source            | Location                                        | Role                                                                                                                                            |
| ----------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.json`      | `${CLAUDE_PLUGIN_DATA}/runs/<id>/state.json`    | Run status, task statuses, spec handoff fields, PR numbers, quality attempts, review attempts, final PR                                         |
| `metrics.jsonl`   | `${CLAUDE_PLUGIN_DATA}/runs/<id>/metrics.jsonl` | Event timeline: `task.start`, `task.end`, `task.gate.quality`, `task.gate.coverage`, `task.classify`, `run.summary` (+ new `run.ci`, `task.ci`) |
| `audit.jsonl`     | `${CLAUDE_PLUGIN_DATA}/runs/<id>/audit.jsonl`   | State transitions (used to detect `awaiting_human`, escalations)                                                                                |
| `reviews/*.json`  | `${CLAUDE_PLUGIN_DATA}/runs/<id>/reviews/`      | Reviewer verdicts                                                                                                                               |
| `holdouts/*.json` | `${CLAUDE_PLUGIN_DATA}/runs/<id>/holdouts/`     | Holdout files (presence = "holdout should have run")                                                                                            |
| `gh` CLI          | live                                            | CI outcome + merge state for historical runs without `task.ci` metric                                                                           |

Write-only:

| Sink           | Location                             | Role                                         |
| -------------- | ------------------------------------ | -------------------------------------------- |
| `scores.jsonl` | `${CLAUDE_PLUGIN_DATA}/scores.jsonl` | Append-only history; one JSON per scored run |

## Step Model

### Four states

| State           | Counts toward denominator | Flagged as anomaly |
| --------------- | ------------------------- | ------------------ |
| `pass`          | yes                       | no                 |
| `fail`          | yes                       | no                 |
| `skipped_ok`    | no                        | no                 |
| `not_performed` | no                        | **yes**            |

Compliance % = `pass / (pass + fail)`. Anomaly count surfaced alongside.

### Per-step contract

Each step is a pair of functions:

```
applies(run, task?) -> required | optional | no
  required:  step MUST run; absence ⇒ not_performed
  optional:  step may legitimately be skipped by config; absence ⇒ skipped_ok
  no:        step does not apply (tier mismatch, etc.); omitted from report

evaluate(run, task?) -> pass | fail | unknown
  unknown: no evidence either way (combined with `applies=required` ⇒ not_performed)
```

### Run-level steps

| ID  | Step                     | `applies`                                         | `evaluate`                                                                                             |
| --- | ------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R1  | `autonomy_ok`            | required                                          | state file exists AND pipeline-init succeeded (no `init.error` audit entry)                            |
| R2  | `spec_generated`         | required (modes: prd, discover); no (mode: task)  | `.spec.path != null` AND `.spec.committed == true`                                                     |
| R3  | `spec_reviewer_approved` | required if R2 applies                            | reviewer record for spec with verdict=APPROVE                                                          |
| R4  | `tasks_decomposed`       | required                                          | `.execution_order` length ≥ 1                                                                          |
| R5  | `no_circuit_trip`        | required                                          | no `circuit_breaker` metric event                                                                      |
| R6  | `no_human_gate_pause`    | required                                          | no state transition to `awaiting_human` in audit log                                                   |
| R7  | `scribe_ran`             | required if all tasks reached terminal done state | metric event `agent.scribe.end` OR scribe commit on staging                                            |
| R8  | `final_pr_opened`        | required if R7 required                           | `.final_pr.pr_number != null` (fallback: `.rollup.pr_number`)                                          |
| R9  | `final_pr_merged`        | required if R8 applies                            | `gh pr view <final_pr.pr_number> --json state` → MERGED                                                |
| R10 | `final_pr_ci_green`      | required if R8 applies                            | `run.ci` metric event `status=green` (fallback: `gh pr view --json statusCheckRollup`)                 |
| R11 | `no_escalation_comments` | required                                          | zero `pipeline-gh-comment` events of type `ci-escalation` / `review-escalation` / `conflict-escalated` |
| R12 | `terminal_status_done`   | required                                          | `.status == done`                                                                                      |

### Per-task steps

Denominator: tasks that reached `executing` at least once. Tasks that never
entered `executing` are excluded (they are counted separately under "tasks
never attempted").

| ID  | Step                                                            | `applies`                                                          | `evaluate`                                                                          |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| T1  | `executor_spawned`                                              | required                                                           | `.tasks.$t.worktree != null`                                                        |
| T2  | `quality_check_<cmd>` (dynamic)                                 | required if cmd listed in `.tasks.$t.quality_gate.checks`          | `.tasks.$t.quality_gate.checks[] .status == "passed"` for that command              |
|     | — default commands: `lint_pass`, `typecheck_pass`, `tests_pass` | required                                                           | per above (reads state, not metrics — metric event only carries aggregate status)   |
| T5  | `coverage_non_regress`                                          | required                                                           | `task.gate.coverage` metric event `status=pass`                                     |
| T6  | `holdout_pass`                                                  | optional (required iff `holdouts/$t.json` exists)                  | `.tasks.$t.quality_gates.holdout == pass`                                           |
| T7  | `mutation_pass`                                                 | optional (required iff `risk_tier ∈ quality.mutationTestingTiers`) | `.tasks.$t.mutation_score >= target`                                                |
| T8  | `reviewer_approved_first_round`                                 | required                                                           | `.tasks.$t.review_attempts == 0` AND terminal verdict APPROVE                       |
| T9  | `reviewer_approved_overall`                                     | required                                                           | terminal reviewer verdict APPROVE                                                   |
| T10 | `pr_created`                                                    | required if task reached post-review                               | `.tasks.$t.pr_number != null` (backfill: scan `gh pr list --search "head:task/$t"`) |
| T11 | `pr_ci_green`                                                   | required if T10 applies                                            | `task.ci` metric event `status=green` (fallback: `gh pr checks <pr>`)               |
| T12 | `pr_merged`                                                     | required if T10 applies                                            | state done AND `gh pr view <pr> --json merged == true`                              |
| T13 | `no_fix_loop_exhaustion`                                        | required                                                           | `quality_attempts < 3` AND `review_attempts < 3`                                    |
| T14 | `terminal_status_done`                                          | required                                                           | `.tasks.$t.status == done`                                                          |

### Incompleteness bucket

Run is bucketed as `incomplete` when `.status ∈ {interrupted, partial}` AND
`.final_pr_number == null`. Incomplete runs are scored with their available
data; headline "full-success" rate is computed only over `terminated` runs.
The incompleteness count is itself reported as its own regression signal.

## Plugin Changes Required

1. **Stamp version in state.** `pipeline-init` writes `.version` from
   `.claude-plugin/plugin.json` when creating state.
2. **Emit CI outcome metrics.** `pipeline-wait-pr` emits `task.ci` (per task)
   and the orchestrator emits `run.ci` when the rollup PR resolves, with
   `{status: green | red | timeout, checks: [...]}`.
3. **Backfill script.** One-time `tools/score-run.sh backfill <run-id>`:
   - If `.version` missing, resolve it by mapping `.started_at` against
     `git log --follow -- .claude-plugin/plugin.json` history (find the
     version active at that timestamp). If unresolvable, prompt the user.
   - If `.final_pr_number` / `.tasks.*.pr_number` missing, scan
     `gh pr list --search "head:task/*"` and `gh pr list --search "base:develop head:staging"` to recover. Scope the search to the project repo detected from `.orchestrator.project_root` + `git remote`.
   - Emit synthetic `task.ci` / `run.ci` events from `gh pr view`.
4. **Scribe metric.** `scribe` agent spawn records a `agent.scribe.end` event
   in `metrics.jsonl` (new line in `run.md` Step "After all groups complete").

## Command-Line Interface

```
tools/score-run.sh                # interactive: show 5 most recent runs, pick
tools/score-run.sh --run <run-id>
tools/score-run.sh --since 2026-04-01
tools/score-run.sh --versions 0.3.2,0.3.3,0.3.4
tools/score-run.sh --json                # emit raw JSON report (no table render)
tools/score-run.sh backfill <run-id>     # one-time data recovery subcommand
tools/score-run.sh history               # print contents of scores.jsonl as table
```

## Output

Terminal table (see design-section sample) plus one appended line to
`scores.jsonl`:

```jsonc
{
  "ts": "2026-04-21T…Z",
  "run_id": "run-20260420-141621",
  "plugin_version": "0.3.2",
  "mode": "prd",
  "bucket": "incomplete",
  "tasks": { "attempted": 18, "done": 15, "interrupted": 3, "pending": 3 },
  "run_steps": { "pass": 5, "fail": 1, "skipped_ok": 0, "not_performed": 6 },
  "task_steps_aggregate": { "pass": 114, "fail": 5, "skipped_ok": 46, "not_performed": 35 },
  "compliance_per_step": { "T2_lint_pass": 1.00, "T8_reviewer_approved_first_round": 0.67, … },
  "anomalies": 41,
  "full_success": false
}
```

## Reproducibility Check

Each step evaluator is pure: inputs are `state.json`, `metrics.jsonl`,
`audit.jsonl`, `reviews/`, `holdouts/`, and `gh` CLI queries (which return
immutable historical data). No LLM calls. No time-dependent logic beyond
reading timestamps. Re-running the scorer on the same run yields byte-identical
JSON output.

Apples-to-apples comparison across versions relies on holding inputs
approximately constant:

- The per-run compliance matrix is independent of task count/difficulty
  because it measures _protocol adherence_, not speed or scope.
- Aggregation across versions is done by `risk_tier` (from
  `pipeline-classify-risk`) to avoid comparing routine-tier tasks with
  security-tier tasks.

Developer-side ritual: run `tools/score-run.sh` after every pipeline run
(interactive takes ~5 seconds), then `tools/score-run.sh history` before
shipping a version bump.

## Testing

- Unit tests in `bin/tests/score.sh` — one per step evaluator, with
  hand-built `state.json` / `metrics.jsonl` fixtures.
- Integration test: score the outsidey `run-20260420-141621` as a golden
  fixture; output must equal a committed `.expected.json`.
- Regression test: after every change to `bin/pipeline-score`, re-score
  all fixture runs; any diff is a failing test unless the baseline is
  updated intentionally.

## Rollout

1. Land `.version` stamping + `task.ci` / `run.ci` metrics on a feature
   branch. No behavior change for existing runs.
2. Land `bin/pipeline-score` + `tools/score-run.sh` + tests.
3. Backfill existing runs (two under `factory-jfa94/runs/`) manually via
   `tools/score-run.sh backfill`.
4. Score outsidey run; commit its `scores.jsonl` as the first baseline.

## Open Risks

- `gh pr list --search "head:task/*"` may be noisy across repos; scope the
  search by repo detected from state.
- `audit.jsonl` schema drift: current code does not guarantee a stable
  state-transition event format. Scorer must be tolerant and treat missing
  events as `not_performed`, not crash.
- Scribe does not currently emit a `agent.scribe.end` metric. Until that
  lands, `scribe_ran` will often show `not_performed` on runs that actually
  did run scribe. Flagged as a known baseline gap until metric is added.
