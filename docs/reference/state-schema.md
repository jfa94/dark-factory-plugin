# State Schema

Reference for run state structure and task lifecycle.

## Directory Structure

```
${CLAUDE_PLUGIN_DATA}/
├── config.json                    # User configuration
├── usage-cache.json               # Rate limit data from statusline wrapper
├── pipeline.lock                  # Lock file (PID + timestamp)
├── metrics.jsonl                  # JSONL event log (MCP server)
│
├── runs/
│   ├── current -> run-YYYYMMDD-HHMMSS/   # Symlink to active run
│   │
│   └── run-YYYYMMDD-HHMMSS/
│       ├── state.json             # Run state
│       ├── audit.jsonl            # Append-only audit log
│       ├── metrics.jsonl          # Append-only metrics
│       ├── holdouts/
│       │   └── <task-id>.json     # Withheld acceptance criteria
│       └── reviews/
│           └── <task-id>_round_N.json
│
└── archive/                       # Completed runs (moved by cleanup)
```

---

## state.json

### Top-Level Fields

| Field             | Type   | Description                                  |
| ----------------- | ------ | -------------------------------------------- | -------------------------- |
| `run_id`          | string | Run identifier (e.g., `run-20260413-140000`) |
| `status`          | string | Run status                                   |
| `mode`            | string | Operating mode                               |
| `started_at`      | string | ISO 8601 timestamp                           |
| `updated_at`      | string | ISO 8601 timestamp                           |
| `ended_at`        | string | null                                         | ISO 8601 timestamp or null |
| `input`           | object | Input parameters                             |
| `spec`            | object | Spec generation state                        |
| `tasks`           | object | Task states keyed by task_id                 |
| `execution_order` | array  | Validated task execution order               |
| `circuit_breaker` | object | Circuit breaker counters                     |
| `cost`            | object | Token/cost tracking                          |

### Run Status Values

| Status        | Description                     |
| ------------- | ------------------------------- |
| `running`     | Pipeline actively executing     |
| `completed`   | All tasks finished successfully |
| `partial`     | Some tasks done, can resume     |
| `failed`      | Unrecoverable error             |
| `interrupted` | Manually stopped or crashed     |

### Mode Values

| Mode       | Description                    |
| ---------- | ------------------------------ |
| `discover` | Processing multiple PRD issues |
| `prd`      | Processing single PRD issue    |
| `task`     | Executing single task          |
| `resume`   | Resuming interrupted run       |

---

## Input Object

```json
{
  "input": {
    "issue_numbers": [42, 43],
    "resumed_from": "run-20260412-090000"
  }
}
```

| Field           | Type   | Description          |
| --------------- | ------ | -------------------- | ----------------- |
| `issue_numbers` | array  | GitHub issue numbers |
| `resumed_from`  | string | null                 | Run ID if resumed |

---

## Spec Object

```json
{
  "spec": {
    "status": "approved",
    "path": "/path/to/spec",
    "handoff_branch": "spec-handoff/run-20260413-140000",
    "handoff_ref": "abc123",
    "review_iterations": 2,
    "review_score": 56
  }
}
```

| Field               | Type   | Description                       |
| ------------------- | ------ | --------------------------------- |
| `status`            | string | Spec status                       |
| `path`              | string | Path to spec directory            |
| `handoff_branch`    | string | Branch for cross-worktree handoff |
| `handoff_ref`       | string | Git ref of handoff commit         |
| `review_iterations` | number | Number of spec review rounds      |
| `review_score`      | number | Last review score (max 60)        |

### Spec Status Values

| Status       | Description                 |
| ------------ | --------------------------- |
| `pending`    | Not started                 |
| `generating` | spec-generator running      |
| `reviewing`  | spec-reviewer running       |
| `approved`   | Passed review (score >= 54) |
| `failed`     | Failed after max retries    |

---

## Task Object

```json
{
  "tasks": {
    "task_01": {
      "status": "done",
      "tier": "medium",
      "risk_tier": "feature",
      "model_used": "sonnet",
      "provider": "anthropic",
      "depends_on": ["task_00"],
      "branch": "dark-factory/42/task-01-auth-flow",
      "worktree_path": "/tmp/worktrees/task_01",
      "pr_number": 123,
      "pr_url": "https://github.com/...",
      "pr_status": "merged",
      "review_rounds": [...],
      "quality_gates": {...},
      "started_at": "2026-04-13T14:30:00Z",
      "ended_at": "2026-04-13T14:45:00Z",
      "tokens_used": 45000,
      "error": null,
      "prior_work_dir": null,
      "prior_branch": null,
      "prior_commit": null
    }
  }
}
```

### Task Status Values

| Status               | Description              |
| -------------------- | ------------------------ |
| `pending`            | Not started              |
| `executing`          | task-executor running    |
| `reviewing`          | task-reviewer running    |
| `done`               | Completed successfully   |
| `failed`             | Failed after max retries |
| `interrupted`        | Stopped mid-execution    |
| `needs_human_review` | Requires human input     |
| `ci_fixing`          | Fixing CI failures       |

### Task Fields

| Field            | Type   | Description                             |
| ---------------- | ------ | --------------------------------------- | ----------------------- |
| `status`         | string | Task status                             |
| `tier`           | string | Complexity tier (simple/medium/complex) |
| `risk_tier`      | string | Risk tier (routine/feature/security)    |
| `model_used`     | string | Model that executed task                |
| `provider`       | string | anthropic                               |
| `depends_on`     | array  | Task IDs this depends on                |
| `branch`         | string | Git branch name                         |
| `worktree_path`  | string | Path to worktree                        |
| `pr_number`      | number | Pull request number                     |
| `pr_url`         | string | Pull request URL                        |
| `pr_status`      | string | open/merged/closed                      |
| `review_rounds`  | array  | Review round records                    |
| `quality_gates`  | object | Quality gate results                    |
| `started_at`     | string | ISO 8601 timestamp                      |
| `ended_at`       | string | ISO 8601 timestamp                      |
| `tokens_used`    | number | Tokens consumed                         |
| `error`          | string | null                                    | Error message if failed |
| `prior_work_dir` | string | Worktree path from previous attempt     |
| `prior_branch`   | string | Branch from previous attempt            |
| `prior_commit`   | string | Last commit from previous attempt       |

---

## Review Rounds

```json
{
  "review_rounds": [
    {
      "round": 1,
      "reviewer": "codex",
      "verdict": "REQUEST_CHANGES",
      "blocking_findings": 2,
      "timestamp": "2026-04-13T14:35:00Z"
    },
    {
      "round": 2,
      "reviewer": "codex",
      "verdict": "APPROVE",
      "blocking_findings": 0,
      "timestamp": "2026-04-13T14:40:00Z"
    }
  ]
}
```

| Field               | Type   | Description                              |
| ------------------- | ------ | ---------------------------------------- |
| `round`             | number | Review round number                      |
| `reviewer`          | string | codex or claude-code                     |
| `verdict`           | string | APPROVE/REQUEST_CHANGES/NEEDS_DISCUSSION |
| `blocking_findings` | number | Count of blocking issues                 |
| `timestamp`         | string | ISO 8601 timestamp                       |

---

## Quality Gates

```json
{
  "quality_gates": {
    "coverage": {
      "passed": true,
      "delta": 0.9
    },
    "holdout": {
      "passed": true,
      "criteria_checked": 2,
      "criteria_passed": 2
    },
    "mutation": {
      "passed": true,
      "score": 85
    }
  }
}
```

---

## Execution Order

```json
{
  "execution_order": [
    { "task_id": "task_01", "parallel_group": 0 },
    { "task_id": "task_02", "parallel_group": 0 },
    { "task_id": "task_03", "parallel_group": 1 }
  ]
}
```

Tasks in the same `parallel_group` run concurrently. Groups execute sequentially.

---

## Circuit Breaker

```json
{
  "circuit_breaker": {
    "consecutive_failures": 0,
    "runtime_minutes": 45,
    "pause_minutes": 10
  }
}
```

| Field                  | Type   | Description                              |
| ---------------------- | ------ | ---------------------------------------- |
| `consecutive_failures` | number | Consecutive failures (resets on success) |
| `runtime_minutes`      | number | Active runtime (excludes pauses)         |
| `pause_minutes`        | number | Time spent waiting (rate limits)         |

> Legacy state files from 0.1.x runs may contain `tasks_completed` and `turns_completed` fields. These are ignored from 0.2.0 onward — no migration is required.

---

## Cost Tracking

```json
{
  "cost": {
    "total_tokens": 120000,
    "estimated_usd": 0.85,
    "by_model": {
      "opus": { "tokens": 30000, "usd": 0.45 },
      "sonnet": { "tokens": 80000, "usd": 0.35 },
      "haiku": { "tokens": 10000, "usd": 0.05 }
    }
  }
}
```

---

## Holdout Files

`${CLAUDE_PLUGIN_DATA}/runs/<run-id>/holdouts/<task-id>.json`:

```json
{
  "task_id": "task_01",
  "withheld_criteria": [
    "Password must be at least 12 characters",
    "Rate limit: 3 attempts per minute"
  ],
  "total_criteria": 5,
  "withheld_count": 2
}
```

---

## Audit Log

`audit.jsonl` - one JSON object per line:

```json
{
  "timestamp": "2026-04-13T14:30:00Z",
  "run_id": "run-20260413-140000",
  "agent": "task-executor",
  "task_id": "task_01",
  "tool": "Write",
  "file": "src/auth.ts",
  "action": "create",
  "model": "sonnet",
  "provider": "anthropic",
  "tokens_in": 1500,
  "tokens_out": 800,
  "prev_hash": "abc123..."
}
```

Each entry includes a SHA256 hash chain linking to the previous entry for tamper evidence.
