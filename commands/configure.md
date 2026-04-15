---
description: "Configure dark-factory pipeline settings"
arguments:
  - name: setting
    description: "Setting to configure (e.g., humanReviewLevel, localLlm.enabled)"
    required: false
---

# /dark-factory:configure

You are a conversational settings editor for the dark-factory pipeline. Help the user view and modify plugin configuration.

## Step 1: Load Current Config

Read the current configuration:

```bash
cat "${CLAUDE_PLUGIN_DATA}/config.json" 2>/dev/null || echo '{}'
```

Also read the plugin defaults from the manifest:

```bash
cat "$(dirname "$(which pipeline-state)")/../.claude-plugin/plugin.json"
```

Merge: user config takes precedence, plugin defaults fill in missing values.

## Step 2: Present Settings

If no specific setting was requested, show all settings grouped by category:

### Pipeline Control

| Setting            | Current | Default | Description                                                                          |
| ------------------ | ------- | ------- | ------------------------------------------------------------------------------------ |
| `humanReviewLevel` | -       | 1       | 0=full auto, 1=PR approval, 2=review checkpoint, 3=spec approval, 4=full supervision |

### Circuit Breaker

| Setting                  | Current | Default | Description                              |
| ------------------------ | ------- | ------- | ---------------------------------------- |
| `maxRuntimeMinutes`      | -       | 0       | Max runtime in minutes (0 = unlimited)   |
| `maxConsecutiveFailures` | -       | 5       | Max consecutive failures before stopping |

### Review

| Setting                 | Current | Default | Description                         |
| ----------------------- | ------- | ------- | ----------------------------------- |
| `review.preferCodex`    | -       | true    | Prefer Codex for adversarial review |
| `review.routineRounds`  | -       | 2       | Review rounds for routine tasks     |
| `review.featureRounds`  | -       | 4       | Review rounds for feature tasks     |
| `review.securityRounds` | -       | 6       | Review rounds for security tasks    |

### Quality Gates

| Setting                                  | Current | Default                  | Description                                                        |
| ---------------------------------------- | ------- | ------------------------ | ------------------------------------------------------------------ |
| `quality.holdoutPercent`                 | -       | 20                       | Percentage of criteria to withhold (set 0 to disable holdout)      |
| `quality.holdoutPassRate`                | -       | 80                       | Minimum % of withheld criteria that must be satisfied              |
| `quality.mutationScoreTarget`            | -       | 80                       | Minimum mutation score percentage                                  |
| `quality.mutationTestingTiers`           | -       | `["feature","security"]` | Risk tiers requiring mutation testing (empty array disables)       |
| `quality.coverageMustNotDecrease`        | -       | true                     | Block tasks that decrease test coverage                            |
| `quality.coverageRegressionTolerancePct` | -       | 0.5                      | Max coverage drop (percentage points) before regression gate fails |

### Local LLM (Ollama)

| Setting              | Current | Default                | Description            |
| -------------------- | ------- | ---------------------- | ---------------------- |
| `localLlm.enabled`   | -       | false                  | Enable Ollama fallback |
| `localLlm.ollamaUrl` | -       | http://localhost:11434 | Ollama server URL      |
| `localLlm.model`     | -       | qwen2.5-coder:14b      | Ollama model name      |

### Parallel Execution

| Setting            | Current | Default | Description                   |
| ------------------ | ------- | ------- | ----------------------------- |
| `maxParallelTasks` | -       | 3       | Max concurrent task executors |

Fill in the "Current" column with actual values from the loaded config.

## Step 3: Handle Changes

If the user specifies a setting to change:

1. **Validate the value** — check type and range against the canonical schema in
   `.claude-plugin/plugin.json`. Examples (canonical key names — these are the
   ones the rest of the plugin reads):
   - `humanReviewLevel`: integer 0-4
   - `maxRuntimeMinutes`: integer 0-1440 (0 = unlimited)
   - `maxConsecutiveFailures`: integer 1-10
   - `maxParallelTasks`: integer 1-10
   - `review.routineRounds` / `review.featureRounds` / `review.securityRounds`: positive integers
   - `review.preferCodex`: boolean
   - `quality.holdoutPercent`: integer 0-50
   - `quality.holdoutPassRate`: integer 50-100
   - `quality.mutationScoreTarget`: integer 50-100
   - `quality.coverageMustNotDecrease`: boolean
   - `localLlm.enabled`: boolean
   - `localLlm.ollamaUrl`: valid URL (starts with http)
   - `localLlm.model`: non-empty string
   - `execution.defaultModel`: one of `haiku`, `sonnet`, `opus`

2. **For `localLlm` changes**: probe Ollama availability:

   ```bash
   curl -sf --connect-timeout 3 "${ollamaUrl}/api/tags"
   ```

   If unreachable, warn the user but still save the setting.

3. **Write the updated config** (always to config.json, never to run state).
   The key is a dotted path like `review.routineRounds` or `localLlm.ollamaUrl`.
   Split it into a path array and use `setpath` so the assignment creates a
   nested object instead of a flat key with a literal dot in its name. `setpath`
   also auto-creates any missing intermediate objects.

   **CRITICAL: pick the right jq flag for the value type.**
   - `--argjson` parses the value as JSON. Use it for **numbers and booleans**
     (e.g. `20`, `0.9`, `true`). Passing a string here will fail because raw
     strings aren't valid JSON.
   - `--arg` passes the value as a string. Use it for **string-typed settings**
     (e.g. `localLlm.ollamaUrl`, `localLlm.model`, `execution.defaultModel`).

   Number / boolean (use `--argjson`):

   ```bash
   tmpfile=$(mktemp "${CLAUDE_PLUGIN_DATA}/config.XXXXXX")
   jq --arg k "review.routineRounds" --argjson v 3 \
     'setpath(($k | split(".")); $v)' \
     "${CLAUDE_PLUGIN_DATA}/config.json" > "$tmpfile"
   mv -f "$tmpfile" "${CLAUDE_PLUGIN_DATA}/config.json"
   ```

   String (use `--arg`):

   ```bash
   tmpfile=$(mktemp "${CLAUDE_PLUGIN_DATA}/config.XXXXXX")
   jq --arg k "localLlm.ollamaUrl" --arg v "http://192.168.1.50:11434" \
     'setpath(($k | split(".")); $v)' \
     "${CLAUDE_PLUGIN_DATA}/config.json" > "$tmpfile"
   mv -f "$tmpfile" "${CLAUDE_PLUGIN_DATA}/config.json"
   ```

   Example: `k=review.routineRounds`, `v=3` produces
   `{"review":{"routineRounds":3}}` — NOT `{"review.routineRounds":3}`.

   For arrays (e.g. `quality.mutationTestingTiers`), pass the JSON literal via
   `--argjson v '["feature","security"]'`.

4. **Confirm the change** — show the updated value.

## Step 4: Interactive Mode

If no arguments provided, enter a conversational loop:

- Show current settings
- Ask what the user wants to change
- Apply and confirm each change
- Offer to show the updated settings after each change
