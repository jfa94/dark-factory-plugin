# Legacy Per-Task Protocol (archive)

Human-readable archive of the 280-line prose protocol the `pipeline-run-task` wrapper replaced. Preserved for audit / incident review. **Not linked from `SKILL.md`.** Do not paste this into an orchestrator session — the wrapper owns every step listed here.

This file is frozen against the wrapper's first release. If the wrapper gains/loses a step, update the wrapper + `reference/stage-taxonomy.md`, not this file.

---

## Execution Sequence (per task) — prose form

For each task `$t` in the current parallel group, walk these seven steps in order.

### 1. Pre-flight

- `pipeline-circuit-breaker $run_id` — if tripped, do not start new tasks; jump to cleanup.
- `pipeline-state deps-satisfied $run_id $t` — if not satisfied, poll at the group boundary.
- `pipeline-classify-task '<task-json>'` → `{tier, model, maxTurns}`.
- `pipeline-classify-risk '<task-json>'` → record `risk_level` in `.tasks.$t.risk_tier`.
- Quota gate (Gate C):

  ```
  while true; do
    pipeline_quota_gate "$run_id" "<risk_level>" "task-$t" "$t"; rc=$?
    case $rc in
      0) break ;;                          # proceed
      2) drain in-flight tasks; mark run partial; go to cleanup ;;
      3) continue ;;                       # wait_retry: re-invoke
    esac
  done
  ```

- `pipeline-build-prompt '<task-json>' --holdout 20%` → full executor prompt.

### 2. Execute

- Human gate (pre-execute): `pipeline-human-gate $run_id pre-execute` — exit 42 pauses.
- `pipeline-state task-status $run_id $t executing`.
- Spawn `task-executor` agent with built prompt, `isolation: worktree`.
- On return, record worktree path. Every executing task must have `.tasks.$t.worktree` written.
- On agent hard failure: `pipeline-state task-status $run_id $t failed`; jump to Finalize.
- On interruption mid-exec: record prior-work fields (`prior_work_dir`, `prior_branch`, `prior_commit`).

### 3. Quality Gate

- `pipeline-quality-gate $run_id $t $worktree_path` — writes `.tasks.$t.quality_gate`.
- `pipeline-coverage-gate <before> <after>` — block on coverage regression.
- On non-zero: increment `quality_attempts`; if `< 3`, task-status `ci_fixing`, re-spawn executor with failure logs; if `>= 3`, `needs_human_review` + escalation comment.

### 3b. Holdout Validation (Layer 4)

- Skip when `holdoutPercent == 0` or no holdout file.
- Build focused reviewer prompt via `pipeline-holdout-validate prompt`.
- Spawn `task-reviewer` cold against diff.
- Capture output; run `pipeline-holdout-validate check`.
- Exit 0 pass → continue. Exit 1 fail → increment `holdout_attempts`; `< 2` re-spawn with failed criteria; `>= 2` `needs_human_review`.
- Exit 2 parse error → warn, continue.

### 3c. Mutation Testing (Layer 5 — feature/security tiers)

- Skip unless `risk_tier` in `mutationTestingTiers`.
- Run stryker; compare score to `mutationScoreTarget` (default 80).
- On shortfall: increment `mutation_rounds`; `< 2` spawn `test-writer`, re-run; `>= 2` warn and continue.

### 4. Spawn Reviewers

- `pipeline-detect-reviewer --base staging` → `{reviewer, command}`.
- Emit `task.review.provider` metric.
- Codex path: run command inline, `pipeline-parse-review --reviewer codex`.
- Claude path: spawn `task-reviewer` + risk-tier fan-out (feature → +architecture-reviewer; security → +code-reviewer/security-reviewer/architecture-reviewer).

### 5. Parse Verdicts

- `pipeline-parse-review < <output-file>` for each reviewer.
- Read `review_attempts` once before branching.
- Any `REQUEST_CHANGES` with blockers: increment `review_attempts`; `< 3` re-execute with fix instructions; `>= 3` `needs_human_review`.
- Any `NEEDS_DISCUSSION`: `needs_human_review`, escalation comment.
- All `APPROVE`: advance.

### 6. Create PR & Wait

- Human gate (post-execute): `pipeline-human-gate $run_id post-execute`.
- `pipeline-branch task-commit $t --worktree $worktree_path`.
- `pr_number=$(gh pr create --base staging --head task/$t ...)`.
- `pipeline-state write $run_id ".tasks.$t.pr_number" $pr_number`.
- Human gate (pre-merge): `pipeline-human-gate $run_id pre-merge`.
- If `humanReviewLevel <= 1`: `pipeline-wait-pr $pr_number`.
  - Exit 0: status `done`.
  - Exit 3 (CI fail): `ci_fixing`, re-spawn with failure log; max 2 CI-fix attempts.
  - Exit 4 (conflict): `conflict-escalated` comment, `needs_human_review`.

### 7. Finalize

- Write `.tasks.$t.finished_at`.
- Next task.

---

## Failings of the prose protocol (motivation for the wrapper)

Observed in run `run-20260420-141621` (first real production run, 21 tasks, 15h30):

- `pipeline-quality-gate` never emitted `task.gate.quality` for any task (hyphen-bug in `pipeline-state` silently rejected every `task-write`; gate exited 1 before metric).
- `pipeline-coverage-gate` emitted its metric without `task_id=` so T6 regex never matched.
- Reviewer fan-out was skipped entirely on most tasks (orchestrator drift across 21 iterations).
- `pipeline-wait-pr` never invoked (scripted sync poll hit the bash 10-min cap and the orchestrator moved on).
- Scribe + rollup PR never fired.
- `task.classify`/`task.start`/`task.end` were the only per-task metrics that survived.

The wrapper closes every gap by never letting the orchestrator LLM name the steps.
