# Rate Limiting

This document explains how the pipeline manages API rate limits and when local LLM fallback activates.

## Two Rate Limit Windows

Anthropic's API has two independent rate limit windows:

**5-Hour Burst Window**

- Resets every 5 hours
- Designed to prevent short-term overconsumption
- Can be exceeded briefly, then must wait for reset

**7-Day Rolling Window**

- Resets on a rolling 7-day basis
- Designed for sustained usage budgeting
- Harder to recover from when exceeded

Both windows are tracked independently. Exceeding either triggers fallback behavior.

---

## How the Pipeline Checks Limits

Before each task spawn, the orchestrator runs:

```bash
pipeline-quota-check
```

This script reads `${CLAUDE_PLUGIN_DATA}/last-headers.json`, which contains rate limit headers from the most recent API call:

- `anthropic-ratelimit-unified-5h-utilization`
- `anthropic-ratelimit-unified-7d-utilization`
- `anthropic-ratelimit-unified-status`
- `is_using_overage`

The script computes dynamic thresholds based on window position:

**5-Hour Window:**

```
window_hour = 1-5 (which hour of the 5h window)
hourly_threshold = min(window_hour * 0.20, 0.90)
```

In hour 1, the threshold is 20%. By hour 5, it's 90%. This allows heavier usage late in the window when you're closer to reset.

**7-Day Window:**

```
window_day = 1-7 (which day of the 7d window)
thresholds = [0.142, 0.286, 0.429, 0.571, 0.714, 0.857, 0.95]
daily_threshold = thresholds[window_day - 1]
```

Similar logic: more aggressive usage is allowed later in the window.

---

## Model Routing Decisions

`pipeline-model-router` takes the quota check output and makes routing decisions:

**Case: Both windows within limits**

```json
{ "provider": "anthropic", "action": "proceed" }
```

Normal operation. Use Claude.

**Case: 5h over threshold, 7d within limits**

If `localLlm.enabled` and Ollama available:

```json
{ "provider": "ollama", "action": "proceed", "review_cap": 20 }
```

Route to Ollama with elevated review caps. Continue until 5h window resets.

If Ollama unavailable:

```json
{ "provider": "anthropic", "action": "wait", "wait_until": "..." }
```

Wait for next hour boundary, then retry with Claude.

**Case: 7d over threshold**

If `localLlm.enabled` and Ollama available:

```json
{ "provider": "ollama", "action": "proceed", "review_cap": 20 }
```

Route to Ollama. Continue until next daily threshold.

If Ollama unavailable:

```json
{ "action": "end_gracefully" }
```

Stop spawning new tasks. Let in-flight tasks complete. Mark run as `partial`.

---

## Why Ollama Fallback Exists

Without fallback, rate limit hits stop the pipeline entirely. For overnight batch runs or large PRDs, this means wasted time and partial progress.

Ollama fallback keeps the pipeline moving. The local model produces lower quality code, but it still passes through the same quality gates. If it fails more often, the review loop catches it.

The tradeoff is explicit:

- **With fallback:** Pipeline continues, may take more iterations
- **Without fallback:** Pipeline waits or stops, no risk of lower quality

Choose based on your priorities.

---

## Elevated Review Caps

Local models need more review iterations to converge on acceptable code. The pipeline compensates with elevated caps:

| Risk Tier | Cloud Rounds | Ollama Rounds |
| --------- | ------------ | ------------- |
| Routine   | 2            | 15            |
| Feature   | 4            | 20            |
| Security  | 6            | 25            |

These caps only apply when running on Ollama. Quality thresholds remain unchanged: coverage must not decrease, holdout pass rate must be 80%, mutation score must be 80%.

---

## Cold Start

On first run, `last-headers.json` does not exist. The pipeline handles this by running a minimal probe:

```bash
claude -p "ok" --max-turns 1 --model haiku
```

This populates initial headers at minimal cost.

---

## Billing Mode Detection

The pipeline auto-detects billing mode from headers:

| Headers Present                        | Mode         |
| -------------------------------------- | ------------ |
| `unified-*` + `is_using_overage=false` | Subscription |
| `unified-*` + `is_using_overage=true`  | Overage      |
| Standard `ratelimit-*` only            | API key      |

Subscription users have pre-paid flat rate. API users pay per token.

Cost estimates in metrics only apply to API/overage users. Subscription users show $0 cost (already paid).

---

## Wall-Clock Circuit Breaker

Independent of API rate limits, the pipeline can enforce a wall-clock cap via `maxRuntimeMinutes`. When set to a positive value, `pipeline-circuit-breaker` trips if the active runtime (excluding pauses) exceeds the threshold.

**Default: `0` (disabled).** The pipeline runs until all tasks complete or `maxConsecutiveFailures` is reached.

**When to enable:**

Set a positive `maxRuntimeMinutes` as an emergency brake on unattended cost exposure:

```
/dark-factory:configure
> Set maxRuntimeMinutes to 480
```

Pause time (rate-limit waits) is excluded from the runtime counter, so a pipeline that waits for API windows will not trip the breaker prematurely.

**Resuming after a runtime trip:**

```
/dark-factory:run resume
```

The orchestrator reads persisted state and continues from the first incomplete task.

---

## Graceful Exit

When 7d limits are exceeded without Ollama fallback:

1. Stop spawning new tasks
2. Let in-flight tasks complete
3. Mark run status as `partial`
4. Update `state.json` with resume-point
5. Print summary: utilization, next threshold, expected reset

The user can resume later:

```
/dark-factory:run resume
```

The orchestrator reads persisted state and continues from the first incomplete task.

---

## Configuring Fallback

Enable fallback:

```
/dark-factory:configure
> Set localLlm.enabled to true
```

Choose a model based on available VRAM:

| VRAM  | Model | Setting                                       |
| ----- | ----- | --------------------------------------------- |
| 8GB   | 7B    | `localLlm.model: qwen2.5-coder:7b`            |
| 16GB+ | 14B   | `localLlm.model: qwen2.5-coder:14b` (default) |
| 24GB+ | 32B   | `localLlm.model: qwen2.5-coder:32b`           |

For remote Ollama:

```
/dark-factory:configure
> Set localLlm.ollamaUrl to http://192.168.1.50:11434
```

---

## Environment Override for Ollama

When `pipeline-model-router` returns Ollama, the orchestrator sets environment variables before spawning `task-executor`:

```bash
ANTHROPIC_BASE_URL=http://localhost:11434/v1
ANTHROPIC_AUTH_TOKEN=dummy
```

The task-executor operates identically. It does not know it's running on a local model. This design keeps agent prompts unchanged regardless of provider.

---

## Monitoring Usage

Check current utilization:

```bash
cat "${CLAUDE_PLUGIN_DATA}/last-headers.json" | jq '{
  five_hour: .["anthropic-ratelimit-unified-5h-utilization"],
  seven_day: .["anthropic-ratelimit-unified-7d-utilization"]
}'
```

Check run metrics for provider distribution:

```bash
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.cost.by_model'
```
