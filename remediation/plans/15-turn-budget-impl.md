# Plan 15b — Turn Budget: Checkpoint-Resume with Turn Tracking

**Priority:** P2 (future scaling — not blocking current 20-task pipeline)
**Depends on:** Plan 15 analysis (`remediation/analysis/15-turn-budget.md`)
**Findings:** Open Question #8 (resolved), Option E from analysis

## Problem

The circuit breaker caps tasks (20), runtime (360 min), and consecutive failures (3) but does not track or cap orchestrator turns. No retry loop in the orchestrator is budget-aware — if a future `maxTurns` value is lowered from 9999, the orchestrator would be interrupted mid-task with `error_max_turns` rather than gracefully winding down.

For the current 20-task design target this is acceptable (254-334 turns << 9999). For future scaling beyond 20 tasks, turn tracking provides defense-in-depth and enables graceful degradation.

## Scope

- Add a turn counter to `pipeline-state`
- Add a `maxTurns` threshold to `pipeline-circuit-breaker`
- Add turn-tracking guidance to `agents/pipeline-orchestrator.md`
- Update `plugin.json` userConfig with `execution.maxOrchestratorTurns`

## Tasks

| task_id     | Title                                         | Files                                                           |
| ----------- | --------------------------------------------- | --------------------------------------------------------------- |
| task_15b_01 | Add turn counter to pipeline-state            | `bin/pipeline-state`, `bin/test-phase1.sh`                      |
| task_15b_02 | Add maxTurns threshold to circuit breaker     | `bin/pipeline-circuit-breaker`, `bin/test-phase1.sh`            |
| task_15b_03 | Add turn-tracking instruction to orchestrator | `agents/pipeline-orchestrator.md`, `.claude-plugin/plugin.json` |

### task_15b_01 — Turn counter in pipeline-state

Add a `pipeline-state increment-turn <run-id>` subcommand that atomically increments `.circuit_breaker.turns_completed` in state.json. The orchestrator calls this once per assistant turn (at the top of each turn, before any other work).

**Acceptance criteria:**

- `pipeline-state increment-turn` increments `.circuit_breaker.turns_completed` from 0 to 1, 1 to 2, etc.
- Counter initializes to 0 if absent
- Atomic write (tmp + mv pattern, same as existing state writes)
- Test: increment 3 times, verify counter is 3

### task_15b_02 — Circuit breaker turn threshold

Add a fourth threshold to `pipeline-circuit-breaker`:

- Config key: `execution.maxOrchestratorTurns` (default: 500)
- State key: `.circuit_breaker.turns_completed`
- Trip condition: `turns_completed >= maxOrchestratorTurns`

The default of 500 is ~50% headroom above the 334-turn moderate-friction estimate for 20 tasks.

**Acceptance criteria:**

- Circuit breaker reads `maxOrchestratorTurns` from config (default 500)
- Trips when `turns_completed >= maxOrchestratorTurns`
- Reason string: `"max orchestrator turns reached (N >= M)"`
- Existing thresholds unchanged
- Test: set counter to 500, verify circuit breaker trips

### task_15b_03 — Orchestrator turn-tracking instruction

Add a section to `agents/pipeline-orchestrator.md` instructing the orchestrator to call `pipeline-state increment-turn <run-id>` at the start of each turn. Add `execution.maxOrchestratorTurns` to `plugin.json` userConfig.

**Acceptance criteria:**

- Orchestrator prompt includes turn-tracking instruction
- `plugin.json` has `execution.maxOrchestratorTurns` config key with default 500
- Instruction is placed in the "Startup" section so it's visible early

## Verification

1. `bin/test-phase1.sh` passes with new turn counter tests
2. Circuit breaker trips at configured turn threshold
3. `plugin.json` schema validates
4. `bin/test-phase9.sh` passes (config key present)
