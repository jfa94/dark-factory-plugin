# Configuration Schema

Complete reference for all `userConfig` options in `plugin.json`.

## Pipeline Behavior

### maxTasks

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 20     |
| Min      | 1      |
| Max      | 100    |

Maximum tasks per run. Circuit breaker trips when this threshold is reached.

### maxRuntimeMinutes

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 360    |
| Min      | 10     |
| Max      | 1440   |

Maximum pipeline runtime in minutes before circuit breaker trips.

### maxConsecutiveFailures

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 3      |
| Min      | 1      |
| Max      | 10     |

Consecutive task failures before pipeline aborts.

### humanReviewLevel

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 1      |
| Min      | 0      |
| Max      | 4      |

Human oversight level:

| Value | Name              | Behavior                                   |
| ----- | ----------------- | ------------------------------------------ |
| 0     | Full Autonomy     | Pipeline creates PR and enables auto-merge |
| 1     | PR Approval       | Pipeline creates PR, human merges          |
| 2     | Review Checkpoint | Human signs off before PR creation         |
| 3     | Spec Approval     | Human approves spec before execution       |
| 4     | Full Supervision  | Human approves at every stage              |

### maxParallelTasks

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 3      |
| Min      | 1      |
| Max      | 10     |

Maximum concurrent task-executor agents.

---

## Code Review

### review.routineRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 2      |
| Min      | 1      |
| Max      | 5      |

Review rounds for routine-tier tasks (cloud models).

### review.featureRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 4      |
| Min      | 1      |
| Max      | 10     |

Maximum adversarial review rounds for feature-tier tasks (cloud models).

### review.securityRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 6      |
| Min      | 1      |
| Max      | 10     |

Maximum adversarial review rounds for security-tier tasks (cloud models).

### review.ollamaRoutineRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 15     |
| Min      | 5      |
| Max      | 50     |

Review rounds for routine-tier tasks when running on Ollama.

### review.ollamaFeatureRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 20     |
| Min      | 5      |
| Max      | 50     |

Review rounds for feature-tier tasks when running on Ollama.

### review.ollamaSecurityRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 25     |
| Min      | 5      |
| Max      | 50     |

Review rounds for security-tier tasks when running on Ollama.

### review.preferCodex

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | true    |

Use Codex adversarial review when available, fall back to Claude Code.

---

## Quality Gates

### quality.holdoutPercent

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 20     |
| Min      | 0      |
| Max      | 50     |

Percentage of acceptance criteria to withhold for holdout validation. Set to 0 to disable holdout validation.

### quality.holdoutPassRate

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 80     |
| Min      | 50     |
| Max      | 100    |

Minimum percentage of withheld criteria that must be satisfied.

### quality.mutationScoreTarget

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 80     |
| Min      | 50     |
| Max      | 100    |

Minimum mutation score percentage.

### quality.mutationTestingTiers

| Property | Value                     |
| -------- | ------------------------- |
| Type     | array                     |
| Default  | `["feature", "security"]` |

Risk tiers that require mutation testing. Empty array disables mutation testing.

### quality.coverageMustNotDecrease

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | true    |

Block tasks that decrease test coverage.

---

## Task Execution

### execution.defaultModel

| Property | Value               |
| -------- | ------------------- |
| Type     | string              |
| Default  | sonnet              |
| Enum     | haiku, sonnet, opus |

Default model for task execution. Overridden by complexity classification:

| Complexity | Model  |
| ---------- | ------ |
| Simple     | haiku  |
| Medium     | sonnet |
| Complex    | opus   |

### execution.maxTurnsSimple

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 40     |
| Min      | 10     |
| Max      | 200    |

Max turns for simple/haiku-tier tasks.

### execution.maxTurnsMedium

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 60     |
| Min      | 20     |
| Max      | 200    |

Max turns for medium/sonnet-tier tasks.

### execution.maxTurnsComplex

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 80     |
| Min      | 20     |
| Max      | 200    |

Max turns for complex/opus-tier tasks.

### execution.maxOrchestratorTurns

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 500    |
| Min      | 50     |
| Max      | 9999   |

Circuit-breaker threshold on orchestrator assistant turns. Trips when `.circuit_breaker.turns_completed` reaches this value, enabling graceful wind-down before the runtime `maxTurns` cap. Default 500 provides ~50% headroom over the 334-turn moderate-friction estimate for a 20-task pipeline.

---

## Local LLM Fallback

### localLlm.enabled

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | false   |

Enable Ollama fallback when Anthropic rate limits approach.

### localLlm.ollamaUrl

| Property | Value                  |
| -------- | ---------------------- |
| Type     | string                 |
| Default  | http://localhost:11434 |

Ollama server URL. Supports local or remote servers.

### localLlm.model

| Property | Value             |
| -------- | ----------------- |
| Type     | string            |
| Default  | qwen2.5-coder:14b |

Ollama model tag. Auto-pulled on first use if not present on server.

### localLlm.useLiteLlm

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | false   |

Use LiteLLM proxy for unified routing instead of direct Ollama.

### localLlm.liteLlmUrl

| Property | Value                 |
| -------- | --------------------- |
| Type     | string                |
| Default  | http://localhost:4000 |

LiteLLM proxy URL. Only used if `useLiteLlm` is true.

---

## Dependencies

### dependencies.prMergeTimeout

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 45     |
| Min      | 5      |
| Max      | 180    |

Minutes to wait for dependency PR to merge.

### dependencies.pollInterval

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 60     |
| Min      | 10     |
| Max      | 300    |

Seconds between merge status polls.

---

## Observability

### observability.auditLog

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | true    |

Enable tamper-evident audit logging of all tool uses.

### observability.metricsExport

| Property | Value        |
| -------- | ------------ |
| Type     | string       |
| Default  | json         |
| Enum     | json, sqlite |

Metrics storage format.

### observability.metricsRetentionDays

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 90     |
| Min      | 7      |
| Max      | 365    |

Days to retain metrics data.
