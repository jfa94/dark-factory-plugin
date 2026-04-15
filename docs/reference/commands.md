# Commands

Specification for all plugin commands.

## /dark-factory:run

Entry point for pipeline invocations.

### Arguments

| Argument     | Required        | Default    | Description                                         |
| ------------ | --------------- | ---------- | --------------------------------------------------- |
| `mode`       | No              | `discover` | Operating mode: `discover`, `prd`, `task`, `resume` |
| `--issue`    | For `prd` mode  | -          | GitHub issue number                                 |
| `--task-id`  | For `task` mode | -          | Task ID to execute                                  |
| `--spec-dir` | For `task` mode | -          | Path to spec directory                              |
| `--strict`   | No              | -          | Require `[PRD]` marker on issues                    |
| `--dry-run`  | No              | -          | Validate without executing                          |

### Modes

**discover**

```
/dark-factory:run discover
```

Finds all open issues with `[PRD]` marker and processes them.

**prd**

```
/dark-factory:run prd --issue 42
```

Processes a single PRD issue.

**task**

```
/dark-factory:run task --task-id task_03 --spec-dir .state/run-20260413-140000
```

Executes a single task from an existing spec.

**resume**

```
/dark-factory:run resume
```

Continues an interrupted run from the last checkpoint.

### Execution Flow

1. Check `DARK_FACTORY_AUTONOMOUS_MODE` environment variable. If unset, materialize `$CLAUDE_PLUGIN_DATA/merged-settings.json` from the bundled template and instruct the user to relaunch with `claude --settings $CLAUDE_PLUGIN_DATA/merged-settings.json`. Setting the env var bypasses this check but does **not** load hooks or permissions.
2. Run `pipeline-validate --no-clean-check` to verify preconditions
3. Parse mode and validate arguments
4. Initialize run state via `pipeline-init`
5. Spawn `pipeline-orchestrator` agent

### Exit Behavior

The command spawns the orchestrator agent and returns when the agent completes. Check run status in `${CLAUDE_PLUGIN_DATA}/runs/current/state.json`.

---

## /dark-factory:configure

Interactive settings editor.

### Arguments

| Argument  | Required | Default | Description                                     |
| --------- | -------- | ------- | ----------------------------------------------- |
| `setting` | No       | -       | Setting to configure (e.g., `humanReviewLevel`) |

### Execution Flow

1. Load current config from `${CLAUDE_PLUGIN_DATA}/config.json`
2. Load defaults from `plugin.json`
3. Present settings grouped by category
4. Validate and apply changes
5. For `localLlm` changes, probe Ollama availability

### Interactive Mode

When invoked without arguments, enters a conversational loop:

1. Shows current settings
2. Asks what to change
3. Applies and confirms each change
4. Offers to show updated settings

### Setting Categories

**Pipeline Control**

- `humanReviewLevel` - Autonomy level (0-4)

**Circuit Breaker**

- `maxRuntimeMinutes` - Max runtime (0 = unlimited)
- `maxConsecutiveFailures` - Max consecutive failures

**Review**

- `review.preferCodex` - Prefer Codex for review
- `review.routineRounds` - Routine tier rounds
- `review.featureRounds` - Feature tier rounds
- `review.securityRounds` - Security tier rounds

**Quality Gates**

- `quality.holdoutPercent` - Holdout percentage
- `quality.holdoutPassRate` - Holdout pass rate
- `quality.mutationScoreTarget` - Mutation score target
- `quality.mutationTestingTiers` - Tiers requiring mutation testing
- `quality.coverageMustNotDecrease` - Block coverage decreases

**Local LLM**

- `localLlm.enabled` - Enable Ollama fallback
- `localLlm.ollamaUrl` - Ollama server URL
- `localLlm.model` - Ollama model tag

**Parallel Execution**

- `maxParallelTasks` - Max concurrent executors

### Validation

Settings are validated against the schema in `plugin.json`:

- Numbers: checked against `min` and `max` constraints
- Enums: checked against allowed values
- Booleans: must be `true` or `false`
- URLs: must start with `http`

Invalid values are rejected with an error message.

### Persistence

Settings persist to `${CLAUDE_PLUGIN_DATA}/config.json`. Run state is stored separately in `${CLAUDE_PLUGIN_DATA}/runs/`.
