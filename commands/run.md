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

Invoke the `run-pipeline` skill with these arguments. The skill contains the full orchestrator protocol (startup, mode dispatch, spec generation, per-task stage-machine loop, finalize-run). Every per-task step is driven by `bin/pipeline-run-task`; the skill's Iron Laws and red-flag table prevent drift across long runs.

Parse `mode` from the user's input. Validate required args for the chosen mode:

| Mode       | Required args              |
| ---------- | -------------------------- |
| `discover` | —                          |
| `prd`      | `--issue N`                |
| `task`     | `--task-id T --spec-dir D` |
| `resume`   | —                          |

Then load the skill:

```
Skill(run-pipeline, "mode=<mode> issue=<N> task-id=<T> spec-dir=<D> strict=<bool> dry-run=<bool>")
```

All orchestration logic lives in `skills/run-pipeline/SKILL.md` and its `reference/` + `prompts/` directories. Do not duplicate it here.
