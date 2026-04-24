# Stage Taxonomy

Canonical contract between `pipeline-run-task` (the stage-machine wrapper) and the orchestrator. Re-read this before editing the wrapper or changing the orchestrator loop.

## Invocation

```
pipeline-run-task <run-id> <task-id> --stage <stage>
                  [--worktree <path>]
                  [--review-file <path>]...
                  [--ci-status <green|red|timeout>]

pipeline-run-task <run-id> RUN --stage finalize-run
```

`<task-id>` is the literal string `RUN` for the run-level finalize stage; every other stage expects a hyphenated task id (e.g. `proxy-001`).

## Exit codes

| rc  | meaning                                                        | orchestrator action                                                                 |
| --- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 0   | stage complete, no spawn required                              | advance to next stage                                                               |
| 2   | end_gracefully (quota cap, circuit breaker, retries exhausted) | drain in-flight, mark run partial, cleanup                                          |
| 3   | wait_retry (one quota chunk slept, still over)                 | re-invoke same stage without sleep                                                  |
| 10  | spawn_required; stdout is the manifest JSON                    | emit listed `Agent()` calls in one message; re-invoke with manifest's `stage_after` |
| 20  | human_gate_pause                                               | stop the run; `/factory:run resume` restarts                                        |
| 30  | task_terminal_failed / needs_human_review                      | skip task, continue loop at the next task                                           |

Exit 0 and 3 look similar in source but have opposite semantics: 0 means "move on", 3 means "call me again with the same stage because I slept one chunk and still do not know". The difference matters at the quota boundary.

## Spawn manifest

Emitted on stdout with exit 10.

```json
{
  "action": "spawn_agents",
  "stage_after": "postexec",
  "agents": [
    {
      "subagent_type": "task-executor",
      "isolation": "worktree",
      "model": "sonnet",
      "maxTurns": 60,
      "prompt_file": ".state/<run-id>/<task-id>.executor-prompt.md"
    }
  ]
}
```

Pass every field through to `Agent()` verbatim. The `prompt_file` is already written by the wrapper from the externalized template under `skills/pipeline-orchestrator/prompts/`; load and inline its content, do not modify.

Multiple entries in `agents` run in parallel — emit them in a single assistant message.

## Stage transitions

```
preflight  → postexec
postexec   → postreview     (claude reviewer path)
postexec   → postreview     (via exit 0 fall-through, codex path writes review-file inline)
postreview → postexec       (REQUEST_CHANGES, retry loop)
postreview → ship           (all APPROVE)
ship       → ship           (async CI, re-invoke with --ci-status on wake)
ship       → terminal       (ci green → done; ci red retries → failed)
finalize-run → terminal     (scribe spawn, final PR, cleanup, run status=done)
```

Each stage starts by calling `_already_past`: if `.tasks.<id>.stage` is already at or past the requested marker (`preflight_done`, `postexec_done`, `postreview_done`, `ship_done`), the stage short-circuits with exit 0. Resume is therefore idempotent — re-invoking `--stage preflight` after the wrapper wrote `preflight_done` is a no-op.

## Per-stage summaries

### preflight

- Circuit breaker (`pipeline-circuit-breaker`) — trip → exit 2.
- Deps (`pipeline-state deps-satisfied`) — unsatisfied → exit 30 (skip for now; orchestrator will return to this task at the group boundary).
- Classify (`pipeline-classify-task`, `pipeline-classify-risk`) — writes `.tasks.<id>.classify`, `.risk`, `.risk_tier`.
- Quota gate C (`pipeline_quota_gate "<risk_tier>" "task-<id>"`) — 0 / 2 / 3 per exit table.
- Prompt build (`pipeline-build-prompt`) — writes `.state/<run-id>/<id>.executor-prompt.md`.
- Transitions status to `executing`, writes `stage=preflight_done`, exit 10 with task-executor manifest.

### postexec

- Reads `.tasks.<id>.worktree` (written by `SubagentStop` hook); falls back to `--worktree` arg.
- Quality gate (`pipeline-quality-gate`) — fail → exit 30.
- Coverage gate (`pipeline-coverage-gate --task-id <id>`) — fail → exit 30. Emitted metric is `task.gate.coverage task_id=<id>`.
- Holdout (`pipeline-holdout-validate`) — if a holdout file exists and no prior reviewer output, spawns a `implementation-reviewer` manifest (exit 10, re-invoke `postexec`). Second pass runs `check` → fail → exit 30, pass → continue.
- Reviewer detection (`pipeline-detect-reviewer --base staging`) + provider metric.
- Codex path: runs `pipeline-codex-review` inline, writes `.state/<run-id>/<id>.review.codex.json`, records path in `.tasks.<id>.review_files`, sets `stage=postexec_done`, exit 0.
- Claude path: writes reviewer prompt to `.state/<run-id>/<id>.reviewer-prompt.md`, emits manifest with risk-tier fan-out (routine → 1 reviewer; feature → +architecture-reviewer; security → +code-reviewer/security-reviewer/architecture-reviewer), exit 10.

### postreview

- Reads `--review-file` paths (orchestrator-supplied, one per agent that returned) or falls back to `.tasks.<id>.review_files` (codex path).
- Parses each via `pipeline-parse-review`.
- Any `NEEDS_DISCUSSION` → `status=needs_human_review`, `stage=postreview_pending_human`, exit 30.
- Any `REQUEST_CHANGES` (and no `NEEDS_DISCUSSION`) → increment `review_attempts`; if `>3`, exhausted → status `failed`, exit 30; else emit executor-fix manifest, `stage_after=postexec`, exit 10.
- All `APPROVE` → `stage=postreview_done`, exit 0.

### ship

- If `--ci-status` present (asyncRewake wake-up path):
  - `green` → status `done`, `stage=ship_done`, exit 0.
  - `red` → increment `ci_fix_attempts`; `>2` → status `failed`, exit 30; else executor-ci-fix manifest, `stage_after=ship`, exit 10.
  - other → treat as timeout → status `needs_human_review`, exit 30.
- Else (first ship invocation):
  - `humanReviewLevel >= 3` → `pipeline-human-gate ship-<id>`; fail → exit 20.
  - `pipeline-branch task-commit` → commit remaining changes.
  - `gh pr create --fill --base staging` → records `.pr_number`, `.pr_url`, status `reviewing`, emits `task.pr_created`.
  - If `FACTORY_ASYNC_CI=off`: runs `pipeline-wait-pr` inline; on green → status `done`, `stage=ship_done`, exit 0; on red → exit 30. (Used in tests and as asyncRewake fallback.)
  - Else: logs `ship wait_ci`, exit 0. The asyncRewake hook re-invokes with `--ci-status` when CI terminalizes.

### finalize-run

- Scans all tasks; if any are non-terminal, exit 3 (wait_retry).
- Verifies every task PR is merged into `origin/staging`: for each task `.pr_number`, checks GitHub PR `state=MERGED` and that the merge commit SHA is an ancestor of `origin/staging`. Any gap → exit 3 (wait_retry).
- Reads `.scribe.status`. If not `done`:
  - Writes `RUN.scribe-prompt.md`, sets `.scribe.status="spawned"`, emits scribe manifest, exit 10.
- Reads `.final_pr.pr_url`. If empty:
  - `gh pr create --base develop --head staging` → records `.final_pr.pr_url`, `.final_pr.pr_number`, emits `run.final_pr_created`.
- Runs `pipeline-cleanup`, sets `.status="done"`, `.ended_at`, exit 0.

## Metrics emitted

Each stage wraps its work in `log_step_begin / log_step_end` (defined in `pipeline-lib.sh`). In addition:

- preflight → `task.executor_spawned`
- postexec → `task.review.provider`, `task.gate.quality`, `task.gate.coverage` (all `task_id`-scoped)
- ship → `task.pr_created`, `task.ci` (via `emit_ci_metric`)
- finalize-run → `run.final_pr_created`, `run.ci` (via `emit_ci_metric`)
- every stage → `pipeline.step.begin`, `pipeline.step.end` with `status` (ok / skipped / spawn / wait_retry / end_gracefully / failed / needs_human_review / human_gate_pause / wait_ci)

The scorer consumes these exclusively. Skipping a stage means its `step.begin`/`step.end` never fire — which is how the post-run scorer detects drift.

## Do NOT

- Do not call `pipeline-quality-gate`, `pipeline-coverage-gate`, `pipeline-holdout-validate`, `pipeline-detect-reviewer`, `pipeline-codex-review`, `pipeline-branch task-commit`, `gh pr create`, `pipeline-wait-pr`, `pipeline-cleanup`, or `pipeline-summary --post-to-issue` directly from the orchestrator. The wrapper owns all of them.
- Do not write to `.tasks.<id>.stage`, `.tasks.<id>.status`, `.tasks.<id>.quality_gate`, `.tasks.<id>.review_attempts`, `.tasks.<id>.ci_fix_attempts`, or `.tasks.<id>.pr_number` from the orchestrator. The wrapper owns them.
- Do not pass `--worktree` on every `postexec` call — the `SubagentStop` hook writes it. Pass only as a fallback when the hook is unavailable (tests, scripted runs).
