# Bin Scripts

Reference for all deterministic pipeline utilities in `bin/`.

All scripts source `pipeline-lib.sh` for shared functions. Scripts output JSON where applicable and use exit codes for flow control.

---

## Core Scripts

### pipeline-lib.sh

Shared library sourced by all scripts.

**Functions:**

| Function                 | Description                             |
| ------------------------ | --------------------------------------- |
| `log_info`               | Log info message to stderr              |
| `log_warn`               | Log warning message to stderr           |
| `log_error`              | Log error message to stderr             |
| `read_config`            | Read config value with default fallback |
| `atomic_write`           | Write file atomically via temp + mv     |
| `current_run_id`         | Get current run ID from symlink         |
| `require_command`        | Exit if command not found               |
| `slugify`                | Convert string to slug                  |
| `temp_file`              | Create temp file with cleanup trap      |
| `detect_pkg_manager`     | Detect npm/yarn/pnpm/bun                |
| `parse_iso8601_to_epoch` | Parse ISO timestamp to epoch seconds    |

---

### pipeline-validate

Pre-flight validation. Checks git, gh auth, required agents/skills, data directory.

**Usage:**

```bash
pipeline-validate [--strict] [--no-clean-check]
```

**Flags:**

| Flag               | Description                                 |
| ------------------ | ------------------------------------------- |
| `--strict`         | Check optional user-provided agents (scout) |
| `--no-clean-check` | Skip working tree clean check               |

**Checks:**

1. Git remote `origin` configured
2. Working tree clean (unless `--no-clean-check`)
3. `gh` CLI installed and authenticated
4. Required skill `prd-to-spec` present
5. `CLAUDE_PLUGIN_DATA` writable
6. Optional agents (with `--strict`)

**Output:**

```json
{
  "valid": true,
  "checks": [
    {"name": "git_remote", "status": "pass", "detail": "origin configured"},
    ...
  ]
}
```

**Exit codes:** 0=all pass, 1=failure

---

### pipeline-init

Initialize a new pipeline run. Creates directory structure, state.json, audit/metrics logs, symlink.

**Usage:**

```bash
pipeline-init <run-id> [--issue <N>] [--mode <mode>] [--force]
```

**Arguments:**

| Argument  | Required | Description                                  |
| --------- | -------- | -------------------------------------------- |
| `run-id`  | Yes      | Run identifier (e.g., `run-20260413-140000`) |
| `--issue` | No       | GitHub issue number                          |
| `--mode`  | No       | Operating mode: discover, prd, task, resume  |
| `--force` | No       | Override active run symlink                  |

**Creates:**

```
${CLAUDE_PLUGIN_DATA}/runs/<run-id>/
├── state.json
├── audit.jsonl
├── metrics.jsonl
├── holdouts/
└── reviews/
```

**Output:**

```json
{
  "run_id": "run-20260413-140000",
  "state_path": "/path/to/state.json",
  "created": true
}
```

**Exit codes:** 0=success, 1=failure

---

### pipeline-state

State manager for pipeline runs.

**Usage:**

```bash
pipeline-state <action> <run-id> [args...]
```

**Actions:**

| Action           | Arguments                     | Description                |
| ---------------- | ----------------------------- | -------------------------- |
| `read`           | `<run-id> [key]`              | Read full state or jq key  |
| `write`          | `<run-id> <key> <value>`      | Atomic write to state key  |
| `task-status`    | `<run-id> <task-id> <status>` | Update task status         |
| `deps-satisfied` | `<run-id> <task-id>`          | Check if deps done         |
| `interrupted`    | `<run-id>`                    | Check if run interrupted   |
| `resume-point`   | `<run-id>`                    | Find first incomplete task |
| `list`           | -                             | List all runs              |

**Task statuses:** pending, executing, reviewing, done, failed, interrupted, needs_human_review, ci_fixing

**Exit codes:** 0=success/true, 1=failure/false

---

### pipeline-lock

Acquire/release directory lock. Prevents concurrent access to shared resources.

**Usage:**

```bash
pipeline-lock acquire <lock-name> [--timeout <seconds>]
pipeline-lock release <lock-name>
```

---

### pipeline-run-task

Stage-machine wrapper that drives a single task (or the run-level finalize step) through the pipeline protocol. Every validation, classification, state-write, quota-gate, quality-gate, coverage-gate, holdout, review dispatch, PR-open, CI-wait, and cleanup step lives inside this wrapper — the orchestrator LLM never names them.

**Usage:**

```bash
pipeline-run-task <run-id> <task-id> --stage <stage> [--worktree <path>] [--review-file <path>]... [--ci-status <green|red|timeout>]
pipeline-run-task <run-id> RUN --stage finalize-run
```

**Arguments:**

| Argument        | Required | Description                               |
| --------------- | -------- | ----------------------------------------- |
| `run-id`        | Yes      | Run identifier                            |
| `task-id`       | Yes      | Task ID (or `RUN` for finalize-run stage) |
| `--stage`       | Yes      | Stage to execute                          |
| `--worktree`    | No       | Path to task worktree                     |
| `--review-file` | No       | Path to reviewer output (repeatable)      |
| `--ci-status`   | No       | CI result: `green`, `red`, or `timeout`   |

**Stages:**

| Stage          | Purpose                                                  |
| -------------- | -------------------------------------------------------- |
| `preflight`    | Circuit breaker, dep check, classify, quota gate, prompt |
| `postexec`     | Quality gate, coverage gate, holdout, review dispatch    |
| `postreview`   | Parse verdicts, retry or advance                         |
| `ship`         | Human gate, task-commit, PR create, CI wait              |
| `finalize-run` | Scribe spawn, final PR, cleanup                          |

**Exit codes:**

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| 0    | Stage complete — advance to next                               |
| 2    | `end_gracefully` (quota cap, circuit breaker, exhausted)       |
| 3    | `wait_retry` (quota chunk slept, still over) — re-invoke       |
| 10   | `spawn_required` — stdout is a JSON spawn manifest             |
| 20   | `human_gate_pause` — orchestrator halts until resume           |
| 30   | `task_terminal_failed` / `needs_human_review` — skip, continue |

**Spawn manifest shape (exit 10):**

```json
{
  "action": "spawn_agents",
  "stage_after": "<next-stage>",
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

---

## Input and Discovery

### pipeline-fetch-prd

Fetch PRD body from GitHub issue.

**Usage:**

```bash
pipeline-fetch-prd <issue-number> [--strict]
```

**Flags:**

| Flag       | Description                     |
| ---------- | ------------------------------- |
| `--strict` | Require `[PRD]` marker in issue |

**Output:**

```json
{
  "issue_number": 42,
  "title": "...",
  "body": "...",
  "has_prd_marker": true
}
```

---

### pipeline-validate-spec

Validate spec output files.

**Usage:**

```bash
pipeline-validate-spec <spec-dir>
```

**Checks:**

- `spec.md` exists and is non-empty
- `tasks.json` exists and is valid JSON
- Tasks have required fields

---

### pipeline-validate-tasks

Field validation, cycle detection, topological sort.

**Usage:**

```bash
pipeline-validate-tasks <tasks-json-path>
```

**Validations:**

1. Required fields: task_id, title, description
2. Dependency cycle detection (DFS)
3. Topological sort via Kahn's algorithm
4. Parallel group assignment

**Output:**

```json
{
  "valid": true,
  "task_count": 5,
  "execution_order": [
    { "task_id": "task_01", "parallel_group": 0 },
    { "task_id": "task_02", "parallel_group": 0 },
    { "task_id": "task_03", "parallel_group": 1 }
  ]
}
```

---

## Task Execution

### pipeline-branch

Branch creation, worktree operations, staging init, task commit.

**Usage:**

```bash
pipeline-branch staging-init
pipeline-branch commit-spec <spec-dir>
pipeline-branch create <branch-name> [--base <ref>]
pipeline-branch worktree-create <branch-name> <worktree-path>
pipeline-branch worktree-remove <worktree-path>
pipeline-branch exists <branch-name>
pipeline-branch naming <task-id> <issue-number>
pipeline-branch task-commit <task-id> --worktree <path> [--message <msg>]
```

**Actions:**

| Action            | Description                                        |
| ----------------- | -------------------------------------------------- |
| `staging-init`    | Create or reconcile staging branch from base       |
| `commit-spec`     | Commit spec directory to staging                   |
| `create`          | Create task branch from base (default: staging)    |
| `worktree-create` | Create worktree for branch                         |
| `worktree-remove` | Remove worktree and optionally delete branch       |
| `exists`          | Check if branch exists (local or remote)           |
| `naming`          | Generate branch name from task-id and issue number |
| `task-commit`     | Finalize task changes in worktree                  |

**task-commit flags:**

| Flag         | Required | Description           |
| ------------ | -------- | --------------------- |
| `--worktree` | Yes      | Path to task worktree |
| `--message`  | No       | Custom commit message |

---

### pipeline-classify-task

Classify task complexity to determine model and max turns.

**Usage:**

```bash
pipeline-classify-task '<task-json>'
```

**Classification logic:**

- File count: 1=simple, 2=medium, 3+=complex
- Dep count: 0=simple, 1-2=medium, 3+=complex
- Tier = max(file_rank, dep_rank)

**Output:**

```json
{
  "tier": "medium",
  "model": "sonnet",
  "maxTurns": 60,
  "reasoning": "2 file(s), 1 dep(s) -> medium"
}
```

---

### pipeline-classify-risk

Classify task risk tier from file paths.

**Usage:**

```bash
pipeline-classify-risk '<task-json>'
```

**Risk patterns:**

| Tier     | Patterns                                                                       |
| -------- | ------------------------------------------------------------------------------ |
| Security | auth/_, security/_, migration/_, payment/_, crypto/_, .env_, middleware/auth\* |
| Feature  | api/_, routes/_, models/_, services/_, hooks/\*                                |
| Routine  | Everything else                                                                |

**Output:**

```json
{
  "tier": "security",
  "review_rounds": 6,
  "extra_reviewers": ["security-reviewer", "architecture-reviewer"],
  "matched_patterns": ["auth/*"],
  "reasoning": "src/auth/login.ts -> security tier"
}
```

---

### pipeline-build-prompt

Build structured prompt for task executor.

**Usage:**

```bash
pipeline-build-prompt '<task-json>' [--spec-path <path>] [--holdout <percent>] [--fix-instructions <json>]
```

**Flags:**

| Flag                 | Description                               |
| -------------------- | ----------------------------------------- |
| `--spec-path`        | Path to spec directory                    |
| `--holdout`          | Percentage of criteria to withhold (0-50) |
| `--fix-instructions` | JSON with review findings to address      |
| `--seed`             | Seed for holdout randomization            |

**Holdout behavior:**

When `--holdout` is specified, the script:

1. Randomly selects N% of acceptance criteria
2. Saves withheld criteria to `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/holdouts/<task-id>.json`
3. Returns prompt with only visible criteria

---

### pipeline-circuit-breaker

Check safety thresholds before each task.

**Usage:**

```bash
pipeline-circuit-breaker <run-id>
```

**Thresholds checked:**

| Threshold    | Config Key               | Default |
| ------------ | ------------------------ | ------- |
| Max runtime  | `maxRuntimeMinutes`      | 0 (off) |
| Max failures | `maxConsecutiveFailures` | 5       |

The runtime check is skipped when `maxRuntimeMinutes` is `0`. The script trips on two conditions only: `maxConsecutiveFailures` being reached, or a positive `maxRuntimeMinutes` being exceeded.

**Output:**

```json
{
  "tripped": false,
  "runtime_minutes": 45,
  "pause_minutes": 2,
  "consecutive_failures": 0,
  "thresholds": {
    "max_runtime_minutes": 0,
    "max_consecutive_failures": 5
  },
  "reason": null
}
```

**Exit codes:** 0=safe, 1=tripped

---

## Review and Quality

### pipeline-detect-reviewer

Check Codex availability, return reviewer configuration.

**Usage:**

```bash
pipeline-detect-reviewer [--base <ref>]
```

**Flags:**

| Flag     | Default   | Description             |
| -------- | --------- | ----------------------- |
| `--base` | `staging` | Git ref to diff against |

**Detection logic:**

1. Check if `codex` command exists
2. Run `codex login status` to verify authentication
3. If both pass: return Codex config with command path
4. Otherwise: return Claude Code fallback

**Output (Codex available):**

```json
{
  "reviewer": "codex",
  "command": "/path/to/plugin/bin/pipeline-codex-review --base staging"
}
```

**Output (fallback):**

```json
{
  "reviewer": "claude-code",
  "agent": "task-reviewer"
}
```

---

### pipeline-codex-review

Codex exec wrapper for adversarial code review. Builds a prompt from task metadata, spec files, and git diff, invokes Codex with structured output, and maps the result to the normalized pipeline verdict JSON.

**Usage:**

```bash
pipeline-codex-review --base <ref> --task-id <id> --spec-dir <path>
```

**Arguments:**

| Argument     | Required | Default   | Description                                                 |
| ------------ | -------- | --------- | ----------------------------------------------------------- |
| `--base`     | No       | `staging` | Git ref for diff base                                       |
| `--task-id`  | Yes      | -         | Task identifier for prompt context                          |
| `--spec-dir` | No       | -         | Path to spec directory (spec.md, acceptance.md, holdout.md) |

**Behavior:**

1. Compute `git diff --unified=5 <base> HEAD`
2. If diff is empty: emit auto-approve verdict and exit 0
3. Build prompt from `skills/review-protocol/SKILL.md` + spec files + diff
4. Invoke Codex with sandbox cascade: `read-only` → `workspace-read` → no sandbox
5. Parse Codex JSON output via `schemas/codex-review.schema.json`
6. Map to normalized verdict JSON (same shape as `pipeline-parse-review`)

**Output:**

```json
{
  "verdict": "REQUEST_CHANGES",
  "round": 1,
  "confidence": "HIGH",
  "findings": [
    {
      "title": "SQL injection risk",
      "file": "src/db.ts",
      "severity": "critical",
      "category": "codex",
      "description": "User input passed directly to query",
      "suggestion": "",
      "blocking": true
    }
  ],
  "blocking_count": 1,
  "non_blocking_count": 0,
  "declared_blockers": 1,
  "criteria_passed": 0,
  "criteria_failed": 0,
  "holdout_passed": 0,
  "holdout_failed": 0,
  "summary": "Patch has one critical security issue.",
  "reviewer": "codex"
}
```

**Exit codes:** 0=success (JSON on stdout), 1=failure

**Schema:** `schemas/codex-review.schema.json`

The Codex output schema defines:

| Field                         | Type   | Description                                    |
| ----------------------------- | ------ | ---------------------------------------------- |
| `findings`                    | array  | Individual issues found                        |
| `findings[].title`            | string | One-line summary                               |
| `findings[].body`             | string | Detailed explanation                           |
| `findings[].priority`         | enum   | `critical`, `high`, `medium`, `low`            |
| `findings[].confidence_score` | number | 0-1 confidence this is a real issue            |
| `findings[].code_location`    | object | Optional `absolute_file_path` and `line_range` |
| `overall_correctness`         | enum   | `patch is correct` or `patch is incorrect`     |
| `overall_explanation`         | string | One-paragraph assessment                       |
| `overall_confidence_score`    | number | 0-1 overall confidence                         |

Priority mapping: `critical`/`high` = blocking, `medium`/`low` = non-blocking.

---

### pipeline-parse-review

Extract structured verdict from reviewer output.

**Usage:**

```bash
echo "<reviewer output>" | pipeline-parse-review
```

**Output:**

```json
{
  "verdict": "REQUEST_CHANGES",
  "findings": [
    {
      "severity": "critical",
      "file": "src/auth.ts",
      "line": 42,
      "description": "SQL injection via unsanitized input",
      "category": "security"
    }
  ],
  "round": 1,
  "reviewer": "codex",
  "summary": "..."
}
```

---

### pipeline-coverage-gate

Compare before/after coverage reports. Block if coverage decreased.

**Usage:**

```bash
pipeline-coverage-gate <before.json> <after.json> [--tolerance <percent>] [--task-id <id>]
```

**Flags:**

| Flag          | Description                                          |
| ------------- | ---------------------------------------------------- |
| `--tolerance` | Allowed coverage decrease (default: 0.5%)            |
| `--task-id`   | Task identifier for metrics logging (added in 0.3.5) |

**Output:**

```json
{
  "passed": true,
  "before": { "lines": 80, "branches": 75, "functions": 85, "statements": 80 },
  "after": { "lines": 82, "branches": 76, "functions": 85, "statements": 81 },
  "delta": { "lines": 2, "branches": 1, "functions": 0, "statements": 1 },
  "tolerance": 0.5
}
```

**Exit codes:** 0=passed, 1=failed

---

### pipeline-quality-gate

Run the full quality gate stack.

**Usage:**

```bash
pipeline-quality-gate <run-id> <task-id>
```

Runs layers in sequence: static analysis, tests, coverage, holdout, mutation.

---

## Rate Limiting

### pipeline-quota-check

Parse rate limit headers, compute window position.

**Usage:**

```bash
pipeline-quota-check
```

**Reads:** `${CLAUDE_PLUGIN_DATA}/usage-cache.json` (written by `bin/statusline-wrapper.sh`)

**Output:**

```json
{
  "five_hour": {
    "utilization": 45,
    "hourly_threshold": 40,
    "over_threshold": true,
    "window_hour": 3,
    "resets_at_epoch": 1776329771
  },
  "seven_day": {
    "utilization": 25,
    "daily_threshold": 29,
    "over_threshold": false,
    "window_day": 2,
    "resets_at_epoch": 1776900000
  },
  "detection_method": "statusline"
}
```

---

### pipeline-model-router

Route task execution based on quota utilization.

**Usage:**

```bash
pipeline-model-router --quota '<quota-json>' --tier <routine|feature|security>
```

**Output (proceed):**

```json
{
  "provider": "anthropic",
  "action": "proceed",
  "review_cap": 2,
  "tier": "routine"
}
```

**Output (wait — 5h over threshold):**

```json
{
  "provider": "anthropic",
  "action": "wait",
  "trigger": "5h_over",
  "wait_minutes": 47,
  "tier": "routine"
}
```

**Output (end gracefully — 7d over threshold):**

```json
{
  "provider": "anthropic",
  "action": "end_gracefully",
  "trigger": "7d_over",
  "tier": "routine"
}
```

---

## Completion

### pipeline-wait-pr

Poll for PR merge with CI/conflict handling.

**Usage:**

```bash
pipeline-wait-pr <pr-number> [--timeout <minutes>]
```

---

### pipeline-gh-comment

Post comments and labels to GitHub issues.

**Usage:**

```bash
pipeline-gh-comment <issue-number> --body '<text>'
pipeline-gh-comment <issue-number> --label '<label>'
```

---

### pipeline-summary

Aggregate run results into execution summary.

**Usage:**

```bash
pipeline-summary <run-id>
```

---

### pipeline-cleanup

Clean up after a pipeline run: branches, worktrees, issues, spec directory, and state archival.

**Usage:**

```bash
pipeline-cleanup <run-id> [flags]
```

**Flags:**

| Flag                 | Description                                       |
| -------------------- | ------------------------------------------------- |
| `--close-issues`     | Close GitHub issues (only if ALL tasks merged)    |
| `--delete-branches`  | Delete local+remote branches for merged PRs       |
| `--remove-worktrees` | Remove git worktrees for merged tasks             |
| `--clean-spec`       | Remove spec dir after all tasks merged            |
| `--spec-dir <path>`  | Spec directory path (required for `--clean-spec`) |

**Behavior:**

1. **Branch deletion** (`--delete-branches`): Only deletes branches for tasks with status=done AND whose PR is actually MERGED. Skips branches for unfinished tasks or non-merged PRs.

2. **Worktree removal** (`--remove-worktrees`): Removes worktree directories for done tasks.

3. **Orphan cleanup** (runs when `--remove-worktrees` is set):
   - `worktree-agent-*` branches: Claude Code's `isolation:worktree` harness creates these but only removes the worktree directory, leaving orphan branches. The script deletes any not backing a live worktree.
   - `spec-handoff/<run_id>` branch: Deleted for the current run (already merged into staging). Cross-references active runs via `pipeline-state list` to avoid deleting mid-run branches for other runs.
   - `orchestrator-run-*` branches and worktrees: Sweeps orphan orchestrator artifacts left by crashed/aborted runs.

4. **Issue closure** (`--close-issues`): Closes issues only when ALL tasks for the run are done.

5. **Spec cleanup** (`--clean-spec`): Removes the spec directory only when all tasks are done. Includes refuse-list to prevent deletion of system paths, `$HOME`, or project root.

6. **State archival**: Copies `state.json`, `audit.jsonl`, `metrics.jsonl`, `reviews/`, and `holdouts/` to `${CLAUDE_PLUGIN_DATA}/archive/<run-id>/`, then removes the run directory.

7. **Retention trim**: Drops audit/metrics JSONL lines older than `observability.metricsRetentionDays` (default 90).

**Output:**

```json
{
  "run_id": "run-20260413-140000",
  "cleanup_status": "ok",
  "branches_deleted": 3,
  "branches_skipped": 1,
  "worktrees_removed": 3,
  "agent_branches_deleted": 2,
  "spec_handoff_deleted": 1,
  "orphan_spec_deleted": 0,
  "orchestrator_branches_deleted": 1,
  "orchestrator_wts_removed": 1,
  "issues_closed": 1,
  "spec_cleaned": true,
  "archive_path": "/path/to/archive/run-20260413-140000",
  "warnings": [],
  "worktree_errors": [],
  "issue_errors": [],
  "agent_branch_errors": [],
  "orchestrator_errors": []
}
```

**Exit codes:** 0=success, 1=partial failure (some cleanup operations failed)

---

### pipeline-scaffold

Create project scaffolding files.

**Usage:**

```bash
pipeline-scaffold [--type <type>]
```

---

## Statusline Integration

### statusline-wrapper.sh

Composable statusline script that captures Claude Code rate limit data for pipeline quota checks.

**Usage:**

Configure as `statusLine.command` in `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "/path/to/dark-factory/bin/statusline-wrapper.sh"
  }
}
```

**Behavior:**

1. Reads Claude Code statusline JSON from stdin
2. Extracts `.rate_limits` and writes to `${CLAUDE_PLUGIN_DATA}/usage-cache.json` with `captured_at` timestamp
3. Chains to original statusline if `FACTORY_ORIGINAL_STATUSLINE` env var is set
4. Otherwise, outputs default statusline: `<model> in <dir> | <remaining%> left for <time>`

**Chaining to existing statusline:**

```json
{
  "env": {
    "FACTORY_ORIGINAL_STATUSLINE": "~/.claude/statusline.sh"
  },
  "statusLine": {
    "type": "command",
    "command": "/path/to/dark-factory/bin/statusline-wrapper.sh"
  }
}
```

**Output file (`usage-cache.json`):**

```json
{
  "five_hour": {
    "used_percentage": 45.2,
    "resets_at": 1776329771
  },
  "seven_day": {
    "used_percentage": 25.0,
    "resets_at": 1776900000
  },
  "captured_at": 1776312000
}
```

**Notes:**

- Fails silently on cache write errors to never break statusline output
- `CLAUDE_PLUGIN_DATA` defaults to `~/.claude/plugin-data/factory` when not set
- Required for `pipeline-quota-check` to function

---

## Test Runner

### bin/test

Master test runner for all pipeline test suites.

**Usage:**

```bash
bin/test [suite...] [--list]
```

**Flags:**

| Flag     | Description                      |
| -------- | -------------------------------- |
| `--list` | List available suites, then exit |

**Available suites:**

| Suite       | Coverage                                       |
| ----------- | ---------------------------------------------- |
| state       | pipeline-state, pipeline-init, circuit breaker |
| spec-intake | PRD fetch, spec validation, task validation    |
| task-prep   | classify-task, classify-risk, build-prompt     |
| branching   | pipeline-branch operations, worktree lifecycle |
| cleanup     | pipeline-cleanup, archive operations           |
| hooks       | branch-protection, run-tracker, stop-gate      |
| audit-hooks | Audit log integrity, tamper detection          |
| routing     | quota-check, model-router decisions            |
| run-command | commands/run.md structural integrity           |
| config      | Config parsing, defaults, validation           |
| integration | End-to-end multi-script workflows              |

**Examples:**

```bash
bin/test                     # Run all suites (654 tests)
bin/test state hooks         # Run only state and hooks suites
bin/test --list              # Show available suite names
```

Suites live in `bin/tests/` with domain-scoped names (e.g., `state.sh`, `routing.sh`).
