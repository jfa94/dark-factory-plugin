---
description: "Run the dark-factory autonomous coding pipeline"
arguments:
  - name: mode
    description: "Operating mode: discover, prd, task, or resume"
    required: false
    default: "discover"
  - name: "--issue"
    description: "GitHub issue number (required for prd mode)"
    required: false
  - name: "--task-id"
    description: "Task ID to execute (required for task mode)"
    required: false
  - name: "--spec-dir"
    description: "Path to spec directory (required for task mode)"
    required: false
  - name: "--strict"
    description: "Require [PRD] marker on issues; fail instead of warn when missing"
    required: false
  - name: "--dry-run"
    description: "Validate inputs and show plan without executing"
    required: false
---

# /factory:run

You are the entry point — and the orchestrator — for the dark-factory autonomous coding pipeline. Parse the user's arguments, launch the run, and drive every phase to completion from this session.

**Core principle.** Every validation, state check, classification, prompt construction, and parsing is a Bash call to a `bin/pipeline-*` script. You NEVER do these tasks via natural language reasoning. Your job is to make judgment calls — interpreting results, deciding retries, handling unexpected states — while delegating all deterministic work to scripts, and to spawn sub-agents (`spec-generator`, `task-executor`, reviewers, `scribe`) with `Agent()` + `isolation: worktree`.

**Invariants.**

- Update task status at every transition: `pending` → `executing` → `reviewing` → `done`/`failed`/`needs_human_review`. All state writes go through `pipeline-state` (atomic writes); never modify state files directly.
- Record `started_at`, `ended_at`, branch name, worktree path, and PR number on every task.
- Never skip quality gates — a failing gate means the code is not ready.
- Never reason about code quality — the reviewer agents and quality gates handle that.
- Always check the circuit breaker before starting a task.
- Always clean up — even on failure, run summary and cleanup.
- Log judgment calls (retry vs skip, escalate vs continue) with the reason.

## Step 1: Check Autonomous Mode

Run the autonomy check:

```bash
pipeline-ensure-autonomy
```

Parse the result:

```bash
result=$(pipeline-ensure-autonomy)
status=$(printf '%s' "$result" | jq -r '.status')
settings_path=$(printf '%s' "$result" | jq -r '.settings_path')
```

If `status` is `ok` or `bypass`, continue to Step 2.

If `status` is `stale` or `missing`, stop and show the user:

> This pipeline requires autonomous-mode settings for safe operation.
>
> A settings file has been generated at `$settings_path`.
>
> **Recommended — relaunch with the generated settings file:**
>
> ```
> claude --settings $settings_path
> ```
>
> This loads the safety hooks (branch protection, protected-file guards, SQL-safety, vitest stop-gate) and the permission allow/deny lists that scope the pipeline to safe operations. The file is regenerated automatically whenever the plugin is upgraded.
>
> **Advanced / CI — bypass the acknowledgment check only:**
>
> ```
> export FACTORY_AUTONOMOUS_MODE=1
> ```
>
> This flag lets `/factory:run` proceed but does **not** load the hooks or permission lists. Use it only in CI or when equivalent guardrails are already enforced at the host level. For interactive runs on your own machine, prefer `--settings`.
>
> **Model recommendation.** The orchestration body below is long and must stay coherent across many sub-agent dispatches, quality-gate retries, and state transitions. Run the invoking session on **Opus** for best reliability. A weaker model will still execute the protocol but is more likely to drift, skip steps, or lose track of state across long runs.

Do not proceed without this confirmation.

## Step 2: Validate Preconditions

Run the project validator:

```bash
pipeline-validate --no-clean-check
```

Use `--no-clean-check` because the pipeline itself will create changes. If validation fails, report the failing checks and stop.

## Step 3: Parse Mode and Arguments

Determine the operating mode from the user's input:

| Mode       | Required Args              | Description                                             |
| ---------- | -------------------------- | ------------------------------------------------------- |
| `discover` | (none)                     | Find all open issues with [PRD] marker and process them |
| `prd`      | `--issue N`                | Process a single PRD issue                              |
| `task`     | `--task-id T --spec-dir D` | Execute a single task from an existing spec             |
| `resume`   | (none)                     | Resume the most recent interrupted run                  |

Validate that required arguments are present for the chosen mode.

## Step 4: Initialize Run

For modes that create a new run (discover, prd, task):

```bash
pipeline-init "<run-id>" --issue <N> --mode <mode>
```

Generate a run-id from the current timestamp: `run-YYYYMMDD-HHMMSS`

For `resume` mode, read the existing run state:

```bash
pipeline-state resume-point "$(pipeline-state list | jq -r 'last')"
```

## Step 5: Handle Dry Run

If `--dry-run` was specified:

1. Show the execution plan (mode, issues, tasks to run)
2. Show validation results
3. Do NOT create the orchestrator worktree or spawn any agent
4. Exit cleanly

## Step 6: Orchestrate

From this point on, **you** are the orchestrator. Everything below runs in this session.

### Step 6a: Orchestrator worktree

The pipeline's own git operations (`pipeline-branch staging-init`, `git checkout staging`, spec-handoff merges in S3) must not touch the user's primary checkout. Create a dedicated orchestrator worktree and `cd` into it before running anything else in Step 6:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
orchestrator_wt="$PROJECT_ROOT/.claude/worktrees/orchestrator-$run_id"
mkdir -p "$(dirname "$orchestrator_wt")"

# Resume: worktree may already exist from a previous session. Reuse it.
if [[ -d "$orchestrator_wt/.git" ]] || git -C "$PROJECT_ROOT" worktree list --porcelain | grep -q "^worktree $orchestrator_wt$"; then
  echo "Reusing orchestrator worktree at $orchestrator_wt"
else
  pipeline-branch worktree-create "orchestrator-$run_id" "$orchestrator_wt" staging
fi

pipeline-state write "$run_id" .orchestrator.worktree "\"$orchestrator_wt\""
pipeline-state write "$run_id" .orchestrator.project_root "\"$PROJECT_ROOT\""
cd "$orchestrator_wt"
```

`.claude/worktrees/` is allowlisted by the autonomous-mode PreToolUse hooks, so reads/writes inside the orchestrator worktree are not blocked. Every subsequent Bash call in Step 6 runs with this cwd. If cleanup or `pipeline-cleanup` later tears the worktree down, consult `.orchestrator.worktree` in state to find it.

### Startup (once per run)

0. **Scaffold precheck:** run `pipeline-scaffold "$PROJECT_ROOT" --check`. If it exits non-zero, STOP with the message: `"Project not scaffolded. Run /factory:scaffold before starting a pipeline."` Do not proceed to state reads, do not attempt spec generation.
1. Read state: `pipeline-state read $run_id`
2. If resuming: `pipeline-state resume-point $run_id` to find the first incomplete task
3. Check circuit breaker: `pipeline-circuit-breaker $run_id` — exits non-zero if tripped. The `.reason` field in the output identifies the trip condition (`max consecutive failures` or `max runtime reached`). On any trip, mark run `partial`, run cleanup/summary, and exit so `/factory:run resume` can continue in a fresh context.

### Spec Generation Phase (before task execution)

This phase runs once at the beginning of a `prd` or `discover` mode run:

```
S0b. Quota gate before spec generation (Gate A):
     source pipeline-lib.sh
     # Gate A tier: hardcoded "feature" today (spec generation is feature-sized).
     # TODO: derive from config.tiers.spec once configurable.
     while true; do
       pipeline_quota_gate "$run_id" "feature" "spec"; rc=$?
       case $rc in
         0) break ;;                          # proceed
         2) mark run partial; run pipeline-summary; go to cleanup ;;
         3) continue ;;                       # wait_retry: re-invoke (orchestrator loop)
       esac
     done
     → Exit 0: proceed to S1.
     → Exit 2 (end_gracefully): mark run partial, run pipeline-summary, go to cleanup.
       Do NOT start spec generation.
     → Exit 3 (wait_retry): gate slept one chunk and is still over threshold; re-invoke
       in the same loop. No human intervention needed.

S1. pipeline-fetch-prd <issue-number>             → PRD body + metadata
S2. Spawn spec-generator agent with PRD body
    → spec-generator runs with isolation: worktree in an ephemeral worktree.
    → spec-generator calls pipeline-validate-spec internally
    → spec-generator calls spec-reviewer (bundled) and retries up to 5x on validation failure
    → As its final step spec-generator completes the "Handoff Protocol" described in
      agents/spec-generator.md: it commits spec.md + tasks.json on a
      `spec-handoff/<run_id>` branch and writes the branch name, ref sha, and spec
      directory path to `.spec.handoff_branch`, `.spec.handoff_ref`, `.spec.path`
      via `pipeline-state`. These are the only channels through which a worktree-
      isolated agent's files reach the orchestrator worktree.

S3. Resolve the spec handoff onto staging (cross-worktree reconciliation):
    handoff_branch=$(pipeline-state read <run-id> .spec.handoff_branch)
    handoff_ref=$(pipeline-state read <run-id> .spec.handoff_ref)
    spec_path=$(pipeline-state read <run-id> .spec.path)
    → If handoff_branch is null/empty: spec-generator did not complete the handoff
      protocol. Fail the run:
          pipeline-gh-comment <issue> ci-escalation --data '{"reason":"spec handoff missing"}'
          pipeline-state write <run-id> .status '"failed"'
          exit 1
    → Fetch the handoff branch, falling back to the local ref if no remote:
          git fetch origin "$handoff_branch" 2>/dev/null \
            || git rev-parse --verify "$handoff_ref" >/dev/null
    → Materialize spec files at `.state/<run-id>/` inside the orchestrator worktree:
          mkdir -p ".state/<run-id>"
          git show "$handoff_ref:$spec_path/spec.md"    > ".state/<run-id>/spec.md"
          git show "$handoff_ref:$spec_path/tasks.json" > ".state/<run-id>/tasks.json"
    → Merge the handoff onto the shared `staging` branch so every task-executor
      worktree picks up the spec via `pipeline-branch commit-spec` (see S3b):
          git checkout staging
          git merge --ff-only "$handoff_ref" \
            || git merge --no-ff "$handoff_ref" -m "chore: merge spec handoff for <run-id>"
    → Record the canonical spec location in state (absolute path, not relative):
          pipeline-state write <run-id> .spec.path "$(pwd)/.state/<run-id>"
          pipeline-state write <run-id> .spec.committed true

S3b. pipeline-branch commit-spec .state/<run-id>    → idempotent commit-to-staging
    → See bin/pipeline-branch commit-spec. Guarantees .state/<run-id>/ is tracked
      on the staging branch so task-executors (in their own isolated worktrees) can
      read spec.md via `git show origin/staging:.state/<run-id>/spec.md`.

S3c. pipeline-human-gate <run-id> spec    → human gate after spec generation
    → Exit 0: proceed. Exit 42: pause (run status set to awaiting_human, GH
      comment posted). Resume with `/factory:run resume`.

S4. pipeline-validate-tasks .state/<run-id>/tasks.json
    → Output: {valid, task_count, execution_order: [{task_id, parallel_group}, ...], errors}
    → Note: parallel_group is an integer field on each execution_order entry, not a
      separate top-level array.

S5. Seed task state from tasks.json:
    For each task in tasks.json:
      pipeline-state write <run-id> '.tasks.<task_id>' '{"status":"pending","depends_on":[...],"files":[...],...}'
    pipeline-state write <run-id> .execution_order '<execution_order JSON>'
    → This makes pipeline-state deps-satisfied work (it reads .tasks[tid].depends_on)

S6. If humanReviewLevel >= 3: pause for human spec approval
```

For `task` mode: skip S1-S3b, read spec from `--spec-dir` argument, write `.spec.path` to state directly, then run S4-S5.

### Execution Sequence

The pipeline runs tasks in two nested loops:

- **Outer loop**: iterate `parallel_group` integers in ascending order (groups are sequential)
- **Inner loop**: batch tasks within a group, spawn task-executors in parallel per batch

#### Group iteration (outer loop)

```
Load execution_order from state: pipeline-state read <run-id> .execution_order
Determine distinct parallel_group values, sorted ascending: [0, 1, 2, ...]
maxConcurrent = read_config '.maxParallelTasks' (default 3)

For each group G (in ascending order):
  tasks_in_group = [entry.task_id for entry in execution_order if entry.parallel_group == G]
  Chunk tasks_in_group into batches of size maxConcurrent
  For each batch:
    Quota gate (Gate B):
      while true; do
        pipeline_quota_gate "$run_id" "<max tier in batch>" "batch-G$G"; rc=$?
        case $rc in
          0) break ;;                          # proceed
          2) drain in-flight tasks; mark run partial; go to cleanup ;;
          3) continue ;;                       # wait_retry: re-invoke
        esac
      done
    Run "Pre-flight" for every task in the batch (sequential)
    Run "Execute" for the batch (one assistant message, parallel Agent calls)
    Run "Quality Gate" → "Spawn Reviewers" → "Parse Verdicts" → "Create PR & Wait" → "Finalize"
      for each task in the batch (sequential per task)
  All tasks in group must reach a terminal state (done, failed, or needs_human_review)
  before moving to the next group.
```

**Concurrent spawning.** Spawn concurrent task-executor agents by emitting multiple Agent tool calls in a single assistant message — Claude Code invokes them in parallel natively, no background-job mechanism is needed. Example, for `maxConcurrent = 3`:

```
Emit one assistant message with N Agent() tool calls:
  Agent({subagent_type: "task-executor", isolation: "worktree", description: "Execute T1", prompt: "..."})
  Agent({subagent_type: "task-executor", isolation: "worktree", description: "Execute T2", prompt: "..."})
  Agent({subagent_type: "task-executor", isolation: "worktree", description: "Execute T3", prompt: "..."})
Wait for all N calls to return.
```

Each task-executor runs in its own worktree; model/maxTurns come from the Pre-flight step. Groups are strictly sequential: no task from group N+1 starts until every task in group N is `done`, `failed`, or `needs_human_review`.

#### Execution Sequence (per task)

For each task `$t` in the current parallel group, walk these seven steps in order. Every step names the exact script to call; every branch has an explicit success/failure path; every status transition is explicit.

1. **Pre-flight**
   - `pipeline-circuit-breaker $run_id` — if tripped, do not start new tasks; jump to cleanup.
   - `pipeline-state deps-satisfied $run_id $t` — if not satisfied, poll at the group boundary.
   - `pipeline-classify-task '<task-json>'` — `{tier, model, maxTurns}`.
   - `pipeline-classify-risk '<task-json>'` — record `risk_level` in `.tasks.$t.risk_tier`.
   - Quota gate (Gate C):
     ```
     while true; do
       pipeline_quota_gate "$run_id" "<risk_level>" "task-$t"; rc=$?
       case $rc in
         0) break ;;                          # proceed
         2) drain in-flight tasks; mark run partial; go to cleanup ;;
         3) continue ;;                       # wait_retry: re-invoke
       esac
     done
     ```
     Sources `pipeline-lib.sh`. Does at most ONE sleep chunk (≤540s / 9min) per
     invocation to stay under the 10-min bash tool cap. Records `pause_minutes`
     and `quota_wait_cycles` in state for circuit breaker and stuck-cache detection.
   - `pipeline-build-prompt '<task-json>' --holdout 20%` — full executor prompt.
     - `pipeline-build-prompt` reads `.spec.path` and any prior-work fields
       (`.tasks.$t.prior_work_dir`, `.prior_branch`, `.prior_commit`) from state,
       so you never hardcode spec or worktree locations.

2. **Execute**
   - **Human gate (pre-execute):** `pipeline-human-gate $run_id pre-execute` — if exit 42, pause and surface the comment. Exit 0 proceeds.
   - `pipeline-state task-status $run_id $t executing`
   - Spawn `task-executor` agent with the built prompt and `isolation: worktree`.
   - On return, record the worktree path: `pipeline-state write $run_id ".tasks.$t.worktree" "$worktree_path"`.
   - If the agent failed hard (Agent tool returned non-success):
     - `pipeline-state task-status $run_id $t failed`
     - Jump to step 7 (Finalize) for this task.
   - If a task is paused mid-execution (interruption, rate limit, crash), record
     prior-work fields BEFORE the next attempt so the resume prompt can find the
     branch:
     ```
     pipeline-state write $run_id ".tasks.$t.prior_work_dir" "$worktree_path"
     pipeline-state write $run_id ".tasks.$t.prior_branch"  "task/$t"
     pipeline-state write $run_id ".tasks.$t.prior_commit"  "$(git -C $worktree_path rev-parse HEAD)"
     ```

3. **Quality Gate**
   - `pipeline-quality-gate $run_id $t $worktree_path` — runs the project's
     lint/typecheck/test scripts (or the `dark-factory.quality` override) and
     writes the structured result to `.tasks.$t.quality_gate`.
   - `pipeline-coverage-gate <before> <after>` — block if test coverage
     decreased relative to the pre-task baseline. Its exit code feeds the
     same retry loop as the quality gate above.
   - If both exit codes are 0: continue to step 3b.
   - If exit code is non-zero:
     - `prior=$(pipeline-state read $run_id ".tasks.$t.quality_attempts // 0")`
     - `pipeline-state write $run_id ".tasks.$t.quality_attempts" $((prior + 1))`
     - If `quality_attempts < 3`:
       - `pipeline-state task-status $run_id $t ci_fixing`
       - Re-spawn `task-executor` with the failure logs from `.state/$run_id/$t.<cmd>.log` as fix context.
       - Goto step 3.
     - If `quality_attempts >= 3`:
       - `pipeline-state task-status $run_id $t needs_human_review`
       - `pipeline-gh-comment <issue> ci-escalation --data '{"reason":"quality_gate exhausted"}'`
       - Jump to step 7.

3b. **Holdout Validation** (Layer 4)

- Skip when `quality.holdoutPercent` is `0` or no holdout file exists at
  `${CLAUDE_PLUGIN_DATA}/runs/$run_id/holdouts/$t.json` (the latter happens
  for tasks with too few acceptance criteria to withhold any).
- `prompt=$(pipeline-holdout-validate prompt $run_id $t)` — builds the
  focused reviewer prompt from the persisted holdout file.
- Spawn `task-reviewer` via `Agent({subagent_type: "task-reviewer", isolation: "worktree", prompt: "$prompt"})`.
  The reviewer runs cold against the diff in the same worktree the executor
  produced and must respond with the strict JSON shape the prompt requests.
- Capture the reviewer output to `.state/$run_id/$t.holdout.out`, then run
  `pipeline-holdout-validate check $run_id $t .state/$run_id/$t.holdout.out`.
- On exit 0 (`pass`): record `.tasks.$t.quality_gates.holdout = pass` and
  continue to step 3c.
- On exit 1 (`fail`):
  - `prior=$(pipeline-state read $run_id ".tasks.$t.holdout_attempts // 0")`
  - `pipeline-state write $run_id ".tasks.$t.holdout_attempts" $((prior + 1))`
  - If `holdout_attempts < 2`:
    - `pipeline-state task-status $run_id $t ci_fixing`
    - Re-spawn `task-executor` with the failed-criteria evidence as fix
      context (`TASK_FAILURE_TYPE=holdout`). The unsatisfied criteria are
      now visible — that is intentional, but record `.tasks.$t.holdout_revealed = true`
      so reporting reflects that the task no longer meets the surprise-test bar.
    - Goto step 2.
  - If `holdout_attempts >= 2`:
    - `pipeline-state task-status $run_id $t needs_human_review`
    - `pipeline-gh-comment <issue> review-escalation --data '{"reason":"holdout_validation_exhausted"}'`
    - Jump to step 7.
- On exit 2 (input/parse error): log a warning, record
  `.tasks.$t.quality_gates.holdout = error`, and continue to step 3c. Holdout
  is a quality signal, not a hard gate — a malformed reviewer response
  shouldn't block an otherwise-passing task, but the metric must surface in
  the run summary.

3c. **Mutation Testing** (Layer 5 — feature and security tiers only)

- Check whether `risk_tier` is in `quality.mutationTestingTiers` config (default: `["feature","security"]`). If not, skip to step 4.
- Run `stryker run` (or the project's configured mutation command) in the worktree. Read the summary score.
- If score ≥ `quality.mutationScoreTarget` (default 80): continue to step 4.
- If score < target:
  - `mutation_round=$(pipeline-state read $run_id ".tasks.$t.mutation_rounds // 0")`
  - If `mutation_round < 2`:
    - `pipeline-state write $run_id ".tasks.$t.mutation_rounds" $((mutation_round + 1))`
    - Spawn `test-writer` (bundled) via `Agent({subagent_type: "test-writer", ...})` with the surviving-mutants report as context.
    - After `test-writer` completes, re-run mutation testing. Goto score check.
  - If `mutation_round >= 2`: log a warning ("mutation score below target after 2 rounds — proceeding") and continue to step 4.

4. **Spawn Reviewers**
   - `detect=$(pipeline-detect-reviewer --base staging)` — discover the reviewer
     toolchain (`{reviewer, command}`).
   - If `$(printf '%s' "$detect" | jq -r '.reviewer') == "codex"`:
     - Run `$(printf '%s' "$detect" | jq -r '.command') --task-id $t --spec-dir $spec_dir 2>codex.err >codex.out`
     - If non-zero exit: retry once. If still non-zero, log warning and fall
       through to Claude `task-reviewer` (spawn via Agent below).
     - On success: `pipeline-parse-review --reviewer codex <codex.out` → verdict JSON.
     - Do NOT spawn `task-reviewer` (Codex replaces it).
   - Else: spawn `task-reviewer` via `Agent({subagent_type: "task-reviewer", ...})`.
   - Risk-tier fan-out (emit concurrent `Agent()` calls in a single assistant message — Claude Code runs them in parallel natively):
     - `risk_tier == "security"`: also spawn `code-reviewer`, `security-reviewer`, and `architecture-reviewer` (all bundled). All four reviewers must APPROVE before proceeding. Any REQUEST_CHANGES re-enters the fix loop (up to `review.securityRounds` from `pipeline-classify-risk`).
       - `code-reviewer` — injection vectors, auth/authz, secrets, crypto, input validation at trust boundaries.
       - `security-reviewer` — OWASP Top 10, secrets exposure, supply-chain risks, AI-specific insecure defaults, framework-specific concerns (Next.js, Supabase).
       - `architecture-reviewer` — module boundaries, dependency direction, coupling metrics, AI-specific anti-patterns (god objects, leaky abstractions).
     - `risk_tier == "feature"`: also spawn `architecture-reviewer` (bundled).
     - `risk_tier == "routine"`: only `task-reviewer` (or Codex).

5. **Parse Verdicts**
   - For each returned reviewer: `pipeline-parse-review < <output-file>` →
     `{verdict, declared_blockers, findings, ...}`.
   - **Always read `review_attempts` first** so both verdict branches below
     can reference it. Reading is independent of incrementing — first-pass
     NEEDS_DISCUSSION needs `review_attempts` for the escalation comment,
     but must NOT bump the counter (no fix loop has run):
     - `review_attempts=$(pipeline-state read $run_id ".tasks.$t.review_attempts // 0")`
   - If any verdict is `REQUEST_CHANGES` with `declared_blockers > 0`:
     - `review_attempts=$((review_attempts + 1))`
     - `pipeline-state write $run_id ".tasks.$t.review_attempts" $review_attempts`
     - If `review_attempts < 3`:
       - `pipeline-state task-status $run_id $t ci_fixing`
       - `pipeline-build-prompt '<task-json>' --fix-instructions '<findings>'`
       - Goto step 2.
     - If `review_attempts >= 3`:
       - `pipeline-state task-status $run_id $t needs_human_review`
       - `pipeline-gh-comment <issue> review-escalation --data "$(jq -n --arg run_id "$run_id" --arg task_id "$t" --argjson review_attempts "$review_attempts" --arg verdict "REQUEST_CHANGES" --arg reason "reviewer blocked merge after $review_attempts fix attempts" '{run_id:$run_id,task_id:$task_id,review_attempts:$review_attempts,verdict:$verdict,reason:$reason}')"`
       - Jump to step 7.
   - If any verdict is `NEEDS_DISCUSSION`:
     - `pipeline-state task-status $run_id $t needs_human_review`
     - `pipeline-gh-comment <issue> review-escalation --data "$(jq -n --arg run_id "$run_id" --arg task_id "$t" --argjson review_attempts "$review_attempts" --arg verdict "NEEDS_DISCUSSION" --arg reason "reviewer flagged ambiguity requiring human judgement" '{run_id:$run_id,task_id:$task_id,review_attempts:$review_attempts,verdict:$verdict,reason:$reason}')"`
     - Jump to step 7.
   - If all verdicts are `APPROVE`: continue to step 6.

6. **Create PR & Wait**
   - **Human gate (post-execute):** `pipeline-human-gate $run_id post-execute` — exit 42 pauses before any PR is created.
   - `pipeline-branch task-commit $t --worktree $worktree_path` — commit any remaining changes on the `task/$t` branch (no-op if clean).
   - `pr_number=$(gh pr create --base staging --head task/$t ...)`
   - `pipeline-state write $run_id ".tasks.$t.pr_number" $pr_number`
   - **Human gate (pre-merge):** `pipeline-human-gate $run_id pre-merge` — exit 42 pauses before `pipeline-wait-pr` observes merges.
   - If `humanReviewLevel <= 1`: `pipeline-wait-pr $pr_number`.
     - On exit 0: `pipeline-state task-status $run_id $t done`.
     - On exit 3 (CI fail): `pipeline-state task-status $run_id $t ci_fixing`,
       fetch failure log via `gh run view --log-failed`, re-spawn task-executor
       with fix instructions; max 2 CI-fix attempts, then `needs_human_review`.
     - On exit 4 (conflict): `pipeline-gh-comment <issue> conflict-escalated`,
       mark `needs_human_review`.
   - On any unhandled failure: mark `needs_human_review` and jump to step 7.

7. **Finalize**
   - `pipeline-state write $run_id ".tasks.$t.finished_at" "$(date -u +%FT%TZ)"`
   - Move to the next task in the batch.

After every task in the group is terminal (`done`, `failed`, or `needs_human_review`), proceed to the next parallel group. Attempt counters are namespaced (`quality_attempts` vs `review_attempts`) so the two retry loops do not interfere with each other.

### After all groups complete

```
pipeline-summary $run_id --post-to-issue
```

Then spawn `scribe` (bundled) to update `/docs` before worktrees are removed:

```
Agent({
  subagent_type: "scribe",
  description: "Post-pipeline docs update",
  prompt: "Incremental mode. Update /docs to reflect all changes shipped in this pipeline run."
})
```

Scribe reads `<!-- last-documented: <hash> -->` from the first line of `docs/README.md`, diffs against HEAD, and updates only affected doc sections. If scribe commits changes, those commits land on the working branch before cleanup. If scribe fails or finds nothing to update, the pipeline still completes — docs update is best-effort, never a blocker.

### Final staging → develop PR

Once every task PR has merged into `staging` and scribe has pushed any doc updates, open the rollup PR from `staging` to `develop`:

```
gh pr create --base develop --head staging \
    --title "Pipeline run $run_id: rollup to develop" \
    --body "$(pipeline-summary $run_id --format markdown)" >/dev/null
final_pr_number=$(gh pr view staging --json number -q .number)
pipeline-state write $run_id ".final_pr_number" "$final_pr_number"
```

CI runs the full-codebase quality gate on this PR (the workflow detects `base_ref == develop` and runs full mutation testing instead of incremental). Auto-merge is already enabled by the `auto-merge` job in `.github/workflows/quality-gate.yml` — no extra `gh pr merge --auto` call is needed.

If `humanReviewLevel >= 2`, skip the rollup PR creation and post a `pipeline-gh-comment <issue> final-rollup-pending` instead; a human opens the PR after review.

```
pipeline-cleanup $run_id --close-issues --delete-branches \
    --remove-worktrees --clean-spec --spec-dir <path>
```

`--remove-worktrees` tears down every task-executor worktree; remove the orchestrator worktree last:

```
pipeline-branch worktree-remove "$orchestrator_wt"
```

## Human Review Levels

Adjust behavior based on `humanReviewLevel` from plugin config:

| Level | Behavior                                                                              |
| ----- | ------------------------------------------------------------------------------------- |
| 0     | Full auto: create PR, CI auto-merges on green (default; needs CI + branch protection) |
| 1     | Create PR, wait for human merge                                                       |
| 2     | Pause after adversarial review, before PR creation                                    |
| 3     | Pause after spec generation for human approval                                        |
| 4     | Pause after spec, after each task, after each review round                            |

"Pause" means: update state with a `waiting_for_human` status, post a GitHub issue comment explaining what needs approval, then stop. The pipeline resumes via `/factory:run resume`.

## Resume

When invoked with resume mode:

1. Read state to find `resume_point`
2. Skip tasks with `status: done`
3. Resume from first incomplete task
4. Failed tasks: skip unless `--retry-failed` flag is set
5. `interrupted` tasks: treat as if they never started (re-execute)

Step 6a reuses the orchestrator worktree if it still exists at `.orchestrator.worktree` in state.

## Failure Handling

When a task-executor fails, set `TASK_FAILURE_TYPE` env var before retry:

| Failure Type   | Action                                                       |
| -------------- | ------------------------------------------------------------ |
| `max_turns`    | Include partial work in prompt, ask to finish remaining work |
| `quality_gate` | Include gate output, ask to fix specific failures            |
| `agent_error`  | Include error details, retry with same prompt                |
| `no_changes`   | Explicitly request code changes with diff                    |
| `code_review`  | Include prior review findings as fix instructions            |

Max 4 total attempts per task. After exhausting retries: mark `failed`, continue other tasks.

## Rate Limit Recovery

Rate limit waits are handled inside `pipeline_quota_gate` (defined in `bin/pipeline-lib.sh`). The function:

1. Calls `pipeline-quota-check` → `pipeline-model-router` to get a routing decision.
2. On `action=proceed`: resets `.circuit_breaker.quota_wait_cycles` to 0 and returns exit 0.
3. On `action=end_gracefully` (7d over, or quota data unavailable): returns exit 2 immediately.
4. On `action=wait`: sleeps ONE chunk (default 540s / 9min, below the Claude Code bash-tool 10min cap), updates `.circuit_breaker.pause_minutes` in state, re-checks once. If clear → exit 0. If still over → increments `.circuit_breaker.quota_wait_cycles` and returns exit 3 (`wait_retry`) for the orchestrator to re-invoke.
5. Stuck-cache guard: when `quota_wait_cycles` reaches `FACTORY_QUOTA_GATE_MAX_CYCLES` (default 60, ≈9h of cumulative waits) the gate returns exit 2 instead of yielding, so a frozen statusline never loops forever.

Callers at all three gates (A=spec, B=batch, C=task) wrap the call in a `while` loop: exit 0 breaks, exit 2 cleans up and exits, exit 3 re-invokes. Long waits (e.g. 5h reset) are handled autonomously across many orchestrator re-invocations — no human intervention.

When `action: end_gracefully`:

1. Do NOT start new tasks
2. Wait for in-flight tasks to complete
3. Mark run as `partial`
4. Run summary (includes partial results)
