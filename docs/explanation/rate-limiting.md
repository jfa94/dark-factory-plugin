# Rate Limiting

This document explains how the pipeline manages API rate limits and pauses.

## Two Rate Limit Windows

Anthropic's API has two independent rate limit windows:

**5-Hour Burst Window**

- Resets every 5 hours (session-anchored, not UTC-clock)
- Designed to prevent short-term overconsumption

**7-Day Rolling Window**

- Resets on a rolling 7-day basis
- Designed for sustained usage budgeting
- Harder to recover from when exceeded

Both windows are tracked independently. Exceeding either triggers recovery behavior.

---

## Quota Gates

The pipeline enforces three quota gates, each using `pipeline_quota_gate` from `bin/pipeline-lib.sh`:

| Gate          | When                         | Tier               |
| ------------- | ---------------------------- | ------------------ |
| **A — spec**  | Before spec generation (S0b) | `feature`          |
| **B — batch** | Before each parallel batch   | max tier in batch  |
| **C — task**  | Per-task pre-flight          | task's `risk_tier` |

Each gate calls `pipeline-quota-check` → `pipeline-model-router` and handles the result:

- `proceed` → continue
- `wait` → sleep `wait_minutes`, re-check (max 3 cycles), record pause time in state
- `end_gracefully` → drain in-flight tasks, mark run `partial`, run summary, cleanup

If 3 consecutive wait cycles still return `over_threshold: true`, the gate treats it as `end_gracefully` to prevent infinite sleep loops.

## How the Pipeline Checks Limits

Before each task spawn, the orchestrator runs:

```bash
pipeline-quota-check
```

This script reads `${CLAUDE_PLUGIN_DATA}/usage-cache.json`, which is written by
`bin/statusline-wrapper.sh` on every Claude Code statusline update. The statusline
JSON provides real-time `rate_limits` data — no API calls, no token cost.

Fields read from `usage-cache.json`:

- `five_hour.used_percentage`
- `five_hour.resets_at` (epoch seconds)
- `seven_day.used_percentage`
- `seven_day.resets_at` (epoch seconds)
- `captured_at` (epoch seconds of last statusline update)

The script computes dynamic thresholds based on window position:

**5-Hour Window:**

```
window_hour = 1-5 (which hour of the 5h window)
hourly_threshold = min(window_hour * 20, 90)
```

In hour 1, the threshold is 20%. By hour 5, it's 90%. This allows heavier usage late in the window when you're closer to reset.

**7-Day Window:**

```
window_day = 1-7 (which day of the 7d window)
thresholds = [14, 29, 43, 57, 71, 86, 95]
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

```json
{ "provider": "anthropic", "action": "wait", "wait_minutes": 47 }
```

Wait for the 5h window reset. `wait_minutes` is derived from `resets_at_epoch`
in the quota output — accurate to the actual session window, not a fixed UTC boundary.

**Case: 7d over threshold**

```json
{ "action": "end_gracefully" }
```

Stop spawning new tasks. Let in-flight tasks complete. Mark run as `partial`.

**Case: quota data unavailable** (`detection_method == "unavailable"`)

`pipeline-quota-check` emits this sentinel when `usage-cache.json` is missing, malformed,
or has missing rate-limit fields. `pipeline-model-router` converts it to `end_gracefully`
immediately — waiting cannot fix a broken wrapper:

```json
{
  "action": "end_gracefully",
  "trigger": "quota_detection_failed",
  "reason": "usage-cache-missing"
}
```

This is the fail-closed path: when the pipeline cannot verify quota it halts rather
than proceeding blindly. The sentinel path is exercised on the first run before the
statusline has ticked; subsequent runs (with the wrapper auto-installed via
`merged-settings.json`) have a warm cache.

---

## Statusline Auto-Install

`usage-cache.json` is written by `bin/statusline-wrapper.sh`. The wrapper is
**auto-installed for all pipeline sessions** via `templates/settings.autonomous.json`,
which declares `statusLine.command` pointing at the wrapper. `pipeline-ensure-autonomy`
regenerates `merged-settings.json` on version bumps, resolving the
`${CLAUDE_PLUGIN_ROOT}` path — no user setup required.

**Coexistence with a user's existing statusline.** When `pipeline-ensure-autonomy`
regenerates `merged-settings.json`, it reads `~/.claude/settings.json` for an
existing `statusLine.command`. If found, it injects the path as
`env.FACTORY_ORIGINAL_STATUSLINE` in the merged file so the wrapper chains to it
during pipeline sessions. The user's `~/.claude/settings.json` is never modified.

Outside pipeline sessions (any session not launched with `--settings merged-settings.json`),
the user's own statusline is unchanged.

If you want to preserve a custom statusline for pipeline sessions without relying on
auto-detection (e.g., a complex chained command), set `FACTORY_ORIGINAL_STATUSLINE`
manually in your environment or in `~/.claude/settings.json`'s `env` block:

```json
{
  "env": {
    "FACTORY_ORIGINAL_STATUSLINE": "~/.claude/my-statusline.sh"
  }
}
```

The wrapper is fail-silent on the cache write — a broken jq or missing directory
never breaks statusline output. The chain is also guarded: if `FACTORY_ORIGINAL_STATUSLINE`
points to a missing file, the wrapper falls back to its default output instead of crashing.

---

## Freshness

If `captured_at` is >120s old, `pipeline-quota-check` logs a warning but still
uses the data. This can happen during long `Agent()` tool calls when Claude Code's
statusline pauses. The cached values are still the most recent available.

---

## Wall-Clock Circuit Breaker

Independent of API rate limits, the pipeline can enforce a wall-clock cap via `maxRuntimeMinutes`. When set to a positive value, `pipeline-circuit-breaker` trips if the active runtime (excluding pauses) exceeds the threshold.

**Default: `0` (disabled).** The pipeline runs until all tasks complete or `maxConsecutiveFailures` is reached.

**When to enable:**

Set a positive `maxRuntimeMinutes` as an emergency brake on unattended cost exposure:

```
/factory:configure
> Set maxRuntimeMinutes to 480
```

Pause time (rate-limit waits) is excluded from the runtime counter, so a pipeline that waits for API windows will not trip the breaker prematurely.

**Resuming after a runtime trip:**

```
/factory:run resume
```

The orchestrator reads persisted state and continues from the first incomplete task.

---

## Consecutive Wait Limit

To prevent infinite sleep loops, the orchestrator tracks consecutive wait cycles. If 3 consecutive quota checks still return `over_threshold: true` after waiting, the pipeline treats it as `end_gracefully` and stops spawning new tasks.

This handles edge cases where:

- The statusline data is stale and not updating
- Rate limits are not resetting as expected
- External factors prevent quota recovery

---

## Graceful Exit

When 7d limits are exceeded:

1. Stop spawning new tasks
2. Let in-flight tasks complete
3. Mark run status as `partial`
4. Update `state.json` with resume-point
5. Print summary: utilization, next threshold, expected reset

The user can resume later:

```
/factory:run resume
```

---

## Monitoring Usage

Check current utilization:

```bash
cat "${CLAUDE_PLUGIN_DATA}/usage-cache.json" | jq '{
  five_hour: .five_hour.used_percentage,
  seven_day: .seven_day.used_percentage,
  captured_at: .captured_at
}'
```

Check run metrics for model distribution:

```bash
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.cost.by_model'
```
