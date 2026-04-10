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
  - name: "--dry-run"
    description: "Validate inputs and show plan without executing"
    required: false
---

# /dark-factory:run

You are the entry point for the dark-factory autonomous coding pipeline. Parse the user's arguments and orchestrate the pipeline launch.

## Step 1: Check Autonomous Mode

Check if this session has the required safety settings:

```bash
echo "${DARK_FACTORY_AUTONOMOUS_MODE:-}"
```

If `DARK_FACTORY_AUTONOMOUS_MODE` is not `1`, materialize a relaunchable settings file and tell the user how to relaunch:

```bash
# Resolve plugin root from the installed pipeline-state binary
plugin_root=$(dirname "$(dirname "$(which pipeline-state)")")
mkdir -p "$CLAUDE_PLUGIN_DATA"

# Substitute absolute paths into the autonomous settings template.
# The template ships with a relative hook path — we rewrite it to an absolute path
# so that `claude --settings <file>` works regardless of the user's cwd.
merged_settings="$CLAUDE_PLUGIN_DATA/merged-settings.json"
jq --arg root "$plugin_root" \
  '.hooks.PreToolUse[0].hooks[0].command = ($root + "/hooks/branch-protection.sh")' \
  "$plugin_root/templates/settings.autonomous.json" \
  > "$merged_settings"

echo "Generated: $merged_settings"
```

Then stop and show the user:

> This pipeline requires autonomous mode settings for safe operation.
>
> Relaunch Claude Code with the generated settings file:
> ```
> claude --settings $CLAUDE_PLUGIN_DATA/merged-settings.json
> ```
>
> Or set `DARK_FACTORY_AUTONOMOUS_MODE=1` in your environment to acknowledge autonomous operation.

Do not proceed without this confirmation.

## Step 2: Validate Preconditions

Run the project validator:

```bash
pipeline-validate --no-clean-check
```

Use `--no-clean-check` because the pipeline itself will create changes. If validation fails, report the failing checks and stop.

## Step 3: Parse Mode and Arguments

Determine the operating mode from the user's input:

| Mode | Required Args | Description |
|------|--------------|-------------|
| `discover` | (none) | Find all open issues with [PRD] marker and process them |
| `prd` | `--issue N` | Process a single PRD issue |
| `task` | `--task-id T --spec-dir D` | Execute a single task from an existing spec |
| `resume` | (none) | Resume the most recent interrupted run |

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
3. Do NOT spawn the orchestrator
4. Exit cleanly

## Step 6: Spawn Orchestrator

Spawn the pipeline orchestrator agent with the appropriate context:

```
Agent({
  description: "Run dark-factory pipeline",
  subagent_type: "pipeline-orchestrator",
  prompt: "... mode, run_id, issue numbers, spec path, etc ..."
})
```

Pass all relevant context:
- Run ID
- Mode
- Issue number(s)
- Spec directory (for task mode)
- Task ID (for task mode)
- Resume point (for resume mode)

The orchestrator handles everything from here — spec generation, task execution, review, PR creation, and cleanup.
