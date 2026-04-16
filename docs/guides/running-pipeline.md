# Running the Pipeline

This guide covers all operating modes for `/dark-factory:run` and common invocation patterns.

## Operating Modes

### discover

Finds all open GitHub issues with the `[PRD]` marker and processes them in dependency order.

```
/dark-factory:run discover
```

Use when you have multiple PRD issues to process. The pipeline:

1. Queries GitHub for open issues with `[PRD]` in title or body
2. Sorts by dependency relationships (if any)
3. Processes each issue end-to-end
4. Stops on circuit breaker threshold or human escalation

### prd

Processes a single PRD issue by number.

```
/dark-factory:run prd --issue 42
```

The standard mode for autonomous development. The pipeline:

1. Fetches PRD body from GitHub issue #42
2. Generates spec with task decomposition
3. Executes tasks in dependency order
4. Runs adversarial review
5. Creates pull request(s)

Add `--strict` to require the `[PRD]` marker:

```
/dark-factory:run prd --issue 42 --strict
```

Without `--strict`, missing markers produce a warning. With `--strict`, missing markers fail the run.

### task

Executes a single task from an existing spec directory.

```
/dark-factory:run task --task-id task_03 --spec-dir .state/run-20260413-140000
```

Use when you want to re-run a specific task without re-generating the spec. The pipeline:

1. Reads `spec.md` and `tasks.json` from the specified directory
2. Executes only the named task
3. Skips dependency checks (assumes dependencies are satisfied)
4. Runs quality gates and review

### resume

Continues an interrupted run from the last checkpoint.

```
/dark-factory:run resume
```

The pipeline:

1. Reads the most recent run from `${CLAUDE_PLUGIN_DATA}/runs/`
2. Identifies the first incomplete task
3. Continues execution from that point
4. Preserves all prior audit logs and state

Runs can be interrupted by:

- Network failures
- Rate limit exhaustion (7d window exceeded)
- Manual stop
- System shutdown

All state is persisted to JSON, so resume is reliable.

---

## Validation Options

### --dry-run

Shows the execution plan without executing.

```
/dark-factory:run prd --issue 42 --dry-run
```

Output includes:

- PRD body (fetched from GitHub)
- Generated spec preview
- Task list with dependency graph
- Model/turns assignments per task
- Estimated token usage

Use to verify the pipeline understands your PRD correctly before committing to execution.

### --strict

Requires the `[PRD]` marker on issues.

```
/dark-factory:run discover --strict
```

Behavior:

- Without `--strict`: missing marker logs a warning, continues
- With `--strict`: missing marker fails the run with exit code 1

Use in CI environments where marker discipline is enforced.

---

## Common Patterns

### First Run on a New Codebase

Set high human oversight for the first few runs:

```
/dark-factory:configure
> Set humanReviewLevel to 3
```

Then run:

```
/dark-factory:run prd --issue 42 --dry-run
```

Review the execution plan. If it looks correct:

```
/dark-factory:run prd --issue 42
```

The pipeline pauses after spec generation for your approval.

### Overnight Batch Processing

For low-risk routine work:

1. Create multiple PRD issues with `[PRD]` marker
2. Set `humanReviewLevel` to 0 or 1
3. Launch:

```
/dark-factory:run discover
```

The pipeline processes all issues, pausing automatically when 5h rate limits approach and resuming after reset. If 7d limits are exceeded, the run ends gracefully and can be resumed later.

### Re-running a Failed Task

If a task fails quality gates:

1. Check the failure reason in state:

```bash
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.tasks.task_03'
```

2. Fix any environmental issues (missing dependencies, config errors)

3. Re-run the specific task:

```
/dark-factory:run task --task-id task_03 --spec-dir .state/run-20260413-140000
```

### Recovering from Rate Limits

If the pipeline stops due to rate limits:

1. Check current utilization:

```bash
cat "${CLAUDE_PLUGIN_DATA}/usage-cache.json" | jq '.five_hour.used_percentage'
```

2. Wait for the reset window, then resume:

```
/dark-factory:run resume
```

The pipeline automatically waits when 5h limits approach. If it ended due to 7d limits, wait for the window to reset before resuming.

---

## Environment Variables

| Variable                       | Purpose                                                                                                                                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DARK_FACTORY_AUTONOMOUS_MODE` | Set to `1` to bypass the acknowledgment check. **Does not load hooks or permissions** — use `claude --settings $CLAUDE_PLUGIN_DATA/merged-settings.json` for real runs (see [Getting Started](../getting-started.md#step-3-launch-with-autonomous-settings)) |
| `CLAUDE_PLUGIN_DATA`           | Directory for run state (auto-set by Claude Code)                                                                                                                                                                                                            |
| `TASK_FAILURE_TYPE`            | Set by orchestrator to provide failure context to retry attempts                                                                                                                                                                                             |

---

## Exit Behavior

The pipeline exits cleanly when:

- All tasks complete successfully
- Circuit breaker threshold is reached
- Human escalation is required and `humanReviewLevel > 0`
- Rate limits are exhausted without fallback

Check exit status in state:

```bash
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.status'
```

Possible values:

- `completed` - all tasks done
- `partial` - some tasks done, run can resume
- `failed` - unrecoverable error
- `escalated` - waiting for human input
