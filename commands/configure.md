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
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `humanReviewLevel` | - | 1 | 0=full auto, 1=PR approval, 2=review checkpoint, 3=spec approval, 4=full supervision |

### Circuit Breaker
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `circuitBreaker.maxTasks` | - | 20 | Max tasks per run |
| `circuitBreaker.maxRuntimeMinutes` | - | 360 | Max runtime in minutes |
| `circuitBreaker.maxConsecutiveFailures` | - | 3 | Max consecutive failures before stopping |

### Review
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `review.preferCodex` | - | true | Prefer Codex for adversarial review |
| `review.routineRounds` | - | 2 | Review rounds for routine tasks |
| `review.featureRounds` | - | 4 | Review rounds for feature tasks |
| `review.securityRounds` | - | 6 | Review rounds for security tasks |

### Quality Gates
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `holdout.enabled` | - | true | Enable holdout validation |
| `holdout.percent` | - | 20 | Percentage of criteria to withhold |
| `mutationTesting.enabled` | - | true | Enable mutation testing |
| `mutationTesting.scoreThreshold` | - | 80 | Minimum mutation score |

### Local LLM (Ollama)
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `localLlm.enabled` | - | false | Enable Ollama fallback |
| `localLlm.ollamaUrl` | - | http://localhost:11434 | Ollama server URL |
| `localLlm.model` | - | qwen2.5-coder:14b | Ollama model name |

### Parallel Execution
| Setting | Current | Default | Description |
|---------|---------|---------|-------------|
| `parallel.maxConcurrent` | - | 3 | Max concurrent task executors |

Fill in the "Current" column with actual values from the loaded config.

## Step 3: Handle Changes

If the user specifies a setting to change:

1. **Validate the value** — check type and range:
   - `humanReviewLevel`: integer 0-4
   - `circuitBreaker.*`: positive integers
   - `review.*Rounds`: positive integers
   - `holdout.percent`: integer 1-50
   - `mutationTesting.scoreThreshold`: integer 50-100
   - `localLlm.enabled`: boolean
   - `localLlm.ollamaUrl`: valid URL (starts with http)
   - `parallel.maxConcurrent`: integer 1-10

2. **For `localLlm` changes**: probe Ollama availability:
   ```bash
   curl -sf --connect-timeout 3 "${ollamaUrl}/api/tags"
   ```
   If unreachable, warn the user but still save the setting.

3. **Write the updated config** (always to config.json, never to run state):
   ```bash
   tmpfile=$(mktemp "${CLAUDE_PLUGIN_DATA}/config.XXXXXX")
   jq --arg k "<key>" --argjson v <value> '.[$k] = $v' "${CLAUDE_PLUGIN_DATA}/config.json" > "$tmpfile"
   mv -f "$tmpfile" "${CLAUDE_PLUGIN_DATA}/config.json"
   ```

4. **Confirm the change** — show the updated value.

## Step 4: Interactive Mode

If no arguments provided, enter a conversational loop:
- Show current settings
- Ask what the user wants to change
- Apply and confirm each change
- Offer to show the updated settings after each change
