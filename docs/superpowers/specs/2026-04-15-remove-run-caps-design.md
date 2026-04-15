# Spec: Remove run-length caps to support long autonomous sessions

> Date: 2026-04-15
> Status: Approved for implementation

## Motivation

The dark-factory plugin's purpose is long-running autonomous coding pipelines. Three of the four current circuit breakers (`maxTasks`, `maxOrchestratorTurns`, and the floored `maxRuntimeMinutes`) actively fight that purpose: they cap the number of tasks a single run can complete, forcing a 40-task feature spec to be split across runs even when every other signal is healthy.

`maxConsecutiveFailures` is the only breaker that tracks real runaway behavior (repeated task failure = model stuck). A wall-clock emergency brake is still useful for catching wedged runs, but only as an opt-in safeguard, not a default.

Separately, long autonomous runs accumulate tool-call history that drives context rot and uncached-read token spend. Lowering Claude Code's auto-compact trigger keeps the working context lean across the long run.

## Scope

**In scope**

- Delete `maxTasks` from plugin config, circuit breaker, tests, and docs.
- Delete `execution.maxOrchestratorTurns` from plugin config, circuit breaker, tests, and docs (reverses plan-15b).
- Change `maxRuntimeMinutes` default from `360` to `0` (sentinel = unlimited); drop min floor from `10` to `0`. Keep the field.
- Change `maxConsecutiveFailures` default from `3` to `5`.
- Add `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` to `settings.json` via an `env` block.
- Update all active `docs/` references, commands, and circuit-breaker tests.
- Bump plugin version `0.1.0` → `0.2.0` (breaking config surface).

**Out of scope**

- State-file migration. Existing `circuit_breaker.tasks_completed` and `.turns_completed` fields will simply stop being read. Leaving them on disk is cheaper than migrating.
- `remediation/` folder contents — frozen artifacts of past phase rollouts, not live config.
- Changes to per-task turn caps (`execution.maxTurnsSimple|Medium|Complex`) — those bound individual sub-agent runs, not the orchestrator loop, and remain useful.
- Review-round caps (`review.*Rounds`) — bounded per task, not per run.

## Design

### Circuit breaker changes (`bin/pipeline-circuit-breaker`)

Drop the `max_tasks` read and the `tasks_completed >= max_tasks` check. Drop the `max_turns` read and the `turns_completed >= max_turns` check. The consecutive-failures check remains unchanged except that its default source (`read_config '.maxConsecutiveFailures'`) will now resolve to `5`. Guard the runtime check behind `if (( max_runtime > 0 ))` so `0` disables it entirely — the script continues running and only the runtime branch is skipped.

The turn-budget graceful-wind-down logic introduced in plan-15b is removed with `maxOrchestratorTurns`. Wind-down on `maxConsecutiveFailures` remains the sole orchestrator-level brake.

### Config surface (`.claude-plugin/plugin.json`)

Final shape of the four affected entries:

- `maxTasks`: **removed**.
- `execution.maxOrchestratorTurns`: **removed**.
- `maxRuntimeMinutes`: `default: 0`, `min: 0`, `max: 1440`. Description rewritten: "Maximum pipeline runtime in minutes before circuit breaker trips. `0` = unlimited (default). Set to a positive value to enable a wall-clock emergency brake."
- `maxConsecutiveFailures`: `default: 5`, `min: 1`, `max: 10`. Description unchanged.

Top-level `"version"` bumps to `"0.2.0"`.

### Autocompact override (`settings.json`)

Add an `env` block before `permissions`:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "50"
  },
  "permissions": { ... }
}
```

**Value chosen: 50.** Claude Code default is ~95%. At 1M context, 50% triggers compaction around 500K tokens consumed.

- **Below 50% is thrashing territory.** Auto-compact fails if a single tool output exceeds half the post-compact context. A 250K-token file read — plausible on a large repo explore — would break a 40% threshold. 50% is the practical floor.
- **Above ~60% wastes the point.** Past 600K tokens, attention degradation compounds and per-turn uncached-read cost is already high.
- **Cache behavior:** more frequent compactions reset the cache prefix, but the alternative (a constantly-invalidating 800K-token prefix) is worse. Summaries are small relative to raw history.

### Documentation sync

Active files to update:

- `docs/reference/configuration.md` — remove `maxTasks` and `maxOrchestratorTurns` tables; rewrite `maxRuntimeMinutes` (document `0 = unlimited`); update `maxConsecutiveFailures` default.
- `docs/reference/commands.md`, `docs/getting-started.md`, `docs/reference/bin-scripts.md`, `docs/reference/exit-codes.md`
- `docs/guides/configuration.md`, `docs/architecture/components.md`
- `commands/configure.md`

`remediation/` is left untouched (historical artifacts). Run the `scribe` agent at the end to catch any references missed by manual sweep.

### Tests (`bin/tests/config.sh`, `bin/tests/state.sh`)

- Remove assertions that depend on `maxTasks` tripping the breaker.
- Remove assertions that depend on `maxOrchestratorTurns` / `turns_completed` tripping the breaker or initiating wind-down.
- Add assertion: `maxRuntimeMinutes=0` never trips the runtime branch regardless of elapsed wall time.
- Add assertion: `maxConsecutiveFailures` default resolves to `5`.
- Assertions that verify `consecutive_failures` trips at threshold must update their expected threshold from `3` to `5`.

## Acceptance criteria

- `maxTasks` does not appear anywhere in `.claude-plugin/plugin.json`, `bin/pipeline-circuit-breaker`, or `docs/`.
- `execution.maxOrchestratorTurns` does not appear anywhere in `.claude-plugin/plugin.json`, `bin/pipeline-circuit-breaker`, or `docs/`.
- Running `pipeline-circuit-breaker` with a 1000-task, 700-orchestrator-turn state file and `maxRuntimeMinutes=0` exits 0 (safe to proceed).
- Running `pipeline-circuit-breaker` with `consecutive_failures=5` exits 1 (tripped).
- Running `pipeline-circuit-breaker` with `consecutive_failures=4` exits 0.
- `settings.json` sets `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50` in an `env` block.
- Plugin version is `0.2.0`.
- All updated tests in `bin/tests/` pass.

## Risks and mitigations

- **Runaway cost.** Without a task or turn cap, a stuck orchestrator could burn significant tokens before `maxConsecutiveFailures=5` trips. Mitigation: autocompact at 50% caps per-turn cost growth, and the failures breaker still catches true stuck-loop behavior. Users concerned about cost can set `maxRuntimeMinutes` to a positive value as an escape hatch.
- **Autocompact thrashing at 50%.** If real workloads show repeated compact→refill cycles, raise to `60` as a follow-up. Telemetry in `observability.metricsExport` should surface this.
- **Plan-15b regression.** `maxOrchestratorTurns` was added deliberately for graceful wind-down. This removal is an intentional reversal justified by the plugin's long-run purpose; the wind-down machinery stays tied to `maxConsecutiveFailures`.
