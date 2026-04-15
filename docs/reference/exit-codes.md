# Exit Codes

Reference for script exit codes and their meanings.

## General Conventions

| Exit Code | Meaning                               |
| --------- | ------------------------------------- |
| 0         | Success                               |
| 1         | General failure                       |
| 2         | Specific condition (script-dependent) |

---

## Core Scripts

### pipeline-validate

| Exit Code | Meaning                   |
| --------- | ------------------------- |
| 0         | All checks pass           |
| 1         | One or more checks failed |

### pipeline-init

| Exit Code | Meaning                                                                               |
| --------- | ------------------------------------------------------------------------------------- |
| 0         | Run initialized successfully                                                          |
| 1         | Invalid run-id, mode, or issue number; run already exists; active run without --force |

### pipeline-state

| Exit Code | Meaning                                                               |
| --------- | --------------------------------------------------------------------- |
| 0         | Success (read/write), or condition true (deps-satisfied, interrupted) |
| 1         | Failure, or condition false, or no incomplete task found              |

### pipeline-lock

| Exit Code | Meaning                                                      |
| --------- | ------------------------------------------------------------ |
| 0         | Lock acquired/released successfully                          |
| 1         | Lock acquisition failed (timeout or held by another process) |

---

## Input and Discovery

### pipeline-fetch-prd

| Exit Code | Meaning                                           |
| --------- | ------------------------------------------------- |
| 0         | PRD fetched successfully                          |
| 1         | Invalid issue number, gh CLI error, or empty body |
| 2         | Issue not found (404)                             |

### pipeline-validate-spec

| Exit Code | Meaning                                |
| --------- | -------------------------------------- |
| 0         | Spec is valid                          |
| 1         | Spec missing required files or invalid |

### pipeline-validate-tasks

| Exit Code | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| 0         | Tasks valid, output includes execution_order              |
| 1         | Validation failed (missing fields, cycles, dangling deps) |

---

## Task Execution

### pipeline-branch

| Exit Code | Meaning                                        |
| --------- | ---------------------------------------------- |
| 0         | Branch/worktree operation successful           |
| 1         | Git error, branch exists, or worktree conflict |

### pipeline-classify-task

| Exit Code | Meaning                   |
| --------- | ------------------------- |
| 0         | Classification successful |

### pipeline-classify-risk

| Exit Code | Meaning                   |
| --------- | ------------------------- |
| 0         | Classification successful |

### pipeline-build-prompt

| Exit Code | Meaning                   |
| --------- | ------------------------- |
| 0         | Prompt built successfully |
| 1         | Unknown flag              |

### pipeline-circuit-breaker

| Exit Code | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| 0         | Safe to proceed                                                    |
| 1         | Circuit breaker tripped (consecutive failures or runtime cap exceeded) |

---

## Review and Quality

### pipeline-detect-reviewer

| Exit Code | Meaning                                               |
| --------- | ----------------------------------------------------- |
| 0         | Always (detection never fails, just selects fallback) |

### pipeline-parse-review

| Exit Code | Meaning                                          |
| --------- | ------------------------------------------------ |
| 0         | Review parsed successfully                       |
| 1         | Parse failure (invalid input or unknown verdict) |

### pipeline-coverage-gate

| Exit Code | Meaning                             |
| --------- | ----------------------------------- |
| 0         | Coverage maintained or increased    |
| 1         | Coverage decreased beyond tolerance |

### pipeline-quality-gate

| Exit Code | Meaning                  |
| --------- | ------------------------ |
| 0         | All quality gates passed |
| 1         | One or more gates failed |

---

## Rate Limiting

### pipeline-quota-check

| Exit Code | Meaning                           |
| --------- | --------------------------------- |
| 0         | Headers parsed successfully       |
| 1         | Headers file not found or invalid |

### pipeline-model-router

| Exit Code | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| 0         | Routing decision made (proceed, wait, or end_gracefully) |
| 1         | Invalid tier or missing quota data                       |

---

## Completion

### pipeline-wait-pr

| Exit Code | Meaning                                       |
| --------- | --------------------------------------------- |
| 0         | PR merged successfully                        |
| 1         | Timeout waiting for merge                     |
| 2         | PR closed without merge (not due to conflict) |
| 3         | CI checks failed                              |
| 4         | Merge conflict detected                       |

### pipeline-gh-comment

| Exit Code | Meaning                           |
| --------- | --------------------------------- |
| 0         | Comment posted or label added     |
| 1         | Invalid arguments or gh CLI error |

### pipeline-summary

| Exit Code | Meaning              |
| --------- | -------------------- |
| 0         | Summary generated    |
| 1         | State file not found |

### pipeline-cleanup

| Exit Code | Meaning                         |
| --------- | ------------------------------- |
| 0         | Cleanup completed               |
| 1         | Invalid run-id or cleanup error |

### pipeline-scaffold

| Exit Code | Meaning               |
| --------- | --------------------- |
| 0         | Scaffolding created   |
| 1         | Error during creation |

---

## Hook Exit Codes

### branch-protection (PreToolUse)

| Exit Code | Meaning                                                       |
| --------- | ------------------------------------------------------------- |
| 0         | Allow operation                                               |
| 2         | Block operation (destructive git command on protected branch) |

### run-tracker (PostToolUse)

| Exit Code | Meaning                             |
| --------- | ----------------------------------- |
| 0         | Always (logging is fire-and-forget) |

### stop-gate (Stop)

| Exit Code | Meaning                         |
| --------- | ------------------------------- |
| 0         | Always (validation is advisory) |

### subagent-stop-gate (SubagentStop)

| Exit Code | Meaning                         |
| --------- | ------------------------------- |
| 0         | Always (validation is advisory) |

---

## Exit Code Usage in Orchestrator

The orchestrator uses exit codes for control flow:

```
pipeline-circuit-breaker <run-id>
  → exit 0: continue to next task
  → exit 1: stop pipeline

pipeline-state deps-satisfied <run-id> <task-id>
  → exit 0: spawn task executor
  → exit 1: wait for dependencies

pipeline-wait-pr <pr-number>
  → exit 0: mark task done, continue
  → exit 1: mark blocked, try other tasks
  → exit 2: mark rejected, continue
  → exit 3: spawn fix attempt
  → exit 4: attempt rebase, escalate if still conflicting
```
