# Human Review Levels

Controlled by `humanReviewLevel` in plugin config (default: 0). Consulted by `pipeline-run-task` internally and by the orchestrator only at spec-approval boundaries.

| Level | Behavior                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| 0     | Full auto: create PR, CI auto-merges on green. Requires CI + branch protection.                                           |
| 1     | Create PR, wait for human merge. `pipeline-wait-pr` tolerates merge delays; task stays in `reviewing` until human merges. |
| 2     | Pause after adversarial review, before PR creation. Orchestrator spawns reviewers; wrapper exits 20 at ship stage.        |
| 3     | Pause after spec generation for human approval, and all level-2 pauses.                                                   |
| 4     | Pause after spec, after every task (post-execute gate), and after every review round. Maximum human-in-the-loop.          |

## Pause semantics

"Pause" means the wrapper/orchestrator:

1. Writes `.status = "awaiting_human"` (or equivalent per-task state).
2. Posts a GitHub issue comment via `pipeline-gh-comment` naming what requires approval.
3. Stops. Resume via `/factory:run resume`.

## Gate checkpoints

| Gate             | Fires at                                         | Invoked by                      | Blocking levels |
| ---------------- | ------------------------------------------------ | ------------------------------- | --------------- |
| spec             | After spec-generator + spec-reviewer return      | Orchestrator (S6 in spec phase) | 3, 4            |
| pre-execute      | Before each task-executor spawn                  | Wrapper preflight (future)      | 4               |
| post-execute     | After task-executor returns, before quality gate | Wrapper postexec (future)       | 4               |
| pre-merge / ship | Before `gh pr create`                            | Wrapper ship                    | 2, 3, 4         |

The wrapper owns all per-task gates. The orchestrator only calls `pipeline-human-gate "$run_id" spec` (after spec generation). Every other gate is internal.

## Current wrapper behavior

`ship` stage consults `humanReviewLevel`: if `>= 3`, calls `pipeline-human-gate "$run_id" "ship-$task_id"` and returns exit 20 on non-zero.

Other per-task gates (pre-execute, post-execute) are not yet wired — they were not called in the baseline prose protocol and are captured here for future parity. If `humanReviewLevel == 4` today, you still get ship-stage pauses, but not per-task pre/post pauses. Treat this as the current ceiling.

## Exit 20 handling

```
20) exit 0 ;;   # stop the orchestrator; user resumes via /factory:run resume
```

Do not retry. Do not spawn a replacement. The user must acknowledge the gate — after approval they run `/factory:run resume` and the wrapper's `_already_past` idempotency takes over.
