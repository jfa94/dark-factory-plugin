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

| Flag               | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `--strict`         | Check optional agents (architecture-reviewer, security-reviewer, etc.) |
| `--no-clean-check` | Skip working tree clean check                                          |

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

| Action           | Arguments                     | Description              |
| ---------------- | ----------------------------- | ------------------------ |
| `read`           | `<run-id> [key]`              | Read full state or jq key |
| `write`          | `<run-id> <key> <value>`      | Atomic write to state key |
| `task-status`    | `<run-id> <task-id> <status>` | Update task status        |
| `deps-satisfied` | `<run-id> <task-id>`          | Check if deps done        |
| `interrupted`    | `<run-id>`                    | Check if run interrupted  |
| `resume-point`   | `<run-id>`                    | Find first incomplete task |
| `list`           | -                             | List all runs             |

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

Branch creation, worktree operations, staging init.

**Usage:**

```bash
pipeline-branch create <branch-name> [--from <ref>]
pipeline-branch worktree <branch-name> <worktree-path>
pipeline-branch cleanup <worktree-path>
```

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

| Threshold    | Config Key               | Default    |
| ------------ | ------------------------ | ---------- |
| Max runtime  | `maxRuntimeMinutes`      | 0 (off)    |
| Max failures | `maxConsecutiveFailures` | 5          |

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
pipeline-detect-reviewer
```

**Output:**

```json
{
  "reviewer": "codex",
  "command": "codex adversarial-review --base <ref> --wait"
}
```

Or:

```json
{
  "reviewer": "claude-code",
  "agent": "task-reviewer"
}
```

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
pipeline-coverage-gate <before.json> <after.json> [--tolerance <percent>]
```

**Flags:**

| Flag          | Description                               |
| ------------- | ----------------------------------------- |
| `--tolerance` | Allowed coverage decrease (default: 0.5%) |

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

**Reads:** `${CLAUDE_PLUGIN_DATA}/last-headers.json`

**Output:**

```json
{
  "five_hour": {
    "utilization": 0.45,
    "hourly_threshold": 0.4,
    "over_threshold": true,
    "resets_at": "2026-04-13T18:00:00Z",
    "window_hour": 3
  },
  "seven_day": {
    "utilization": 0.25,
    "daily_threshold": 0.286,
    "over_threshold": false,
    "resets_at": "2026-04-15T00:00:00Z",
    "window_day": 2
  },
  "billing_mode": "subscription"
}
```

---

### pipeline-model-router

Route to Anthropic or Ollama based on quota.

**Usage:**

```bash
pipeline-model-router --quota '<quota-json>' --task-tier <tier>
```

**Output:**

```json
{
  "provider": "anthropic",
  "model": "sonnet",
  "action": "proceed"
}
```

Or:

```json
{
  "provider": "ollama",
  "model": "qwen2.5-coder:14b",
  "action": "proceed",
  "review_cap": 20
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

Delete branches, close issues, clean worktrees.

**Usage:**

```bash
pipeline-cleanup <run-id> [--dry-run]
```

---

### pipeline-scaffold

Create project scaffolding files.

**Usage:**

```bash
pipeline-scaffold [--type <type>]
```

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

| Suite        | Coverage                                       |
| ------------ | ---------------------------------------------- |
| state        | pipeline-state, pipeline-init, circuit breaker |
| spec-intake  | PRD fetch, spec validation, task validation    |
| task-prep    | classify-task, classify-risk, build-prompt     |
| branching    | pipeline-branch operations, worktree lifecycle |
| cleanup      | pipeline-cleanup, archive operations           |
| hooks        | branch-protection, run-tracker, stop-gate      |
| audit-hooks  | Audit log integrity, tamper detection          |
| routing      | quota-check, model-router decisions            |
| orchestrator | Orchestrator-level integration                 |
| config       | Config parsing, defaults, validation           |
| integration  | End-to-end multi-script workflows              |

**Examples:**

```bash
bin/test                     # Run all suites (654 tests)
bin/test state hooks         # Run only state and hooks suites
bin/test --list              # Show available suite names
```

Suites live in `bin/tests/` with domain-scoped names (e.g., `state.sh`, `routing.sh`).
