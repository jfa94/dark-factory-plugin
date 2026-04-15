# Configuring Settings

This guide covers how to adjust pipeline behavior via `/dark-factory:configure` and when to change each setting.

## Accessing Configuration

Run the interactive configuration command:

```
/dark-factory:configure
```

The command:

1. Loads current settings from `${CLAUDE_PLUGIN_DATA}/config.json`
2. Loads defaults from `plugin.json`
3. Presents settings grouped by category
4. Validates changes before applying

Settings persist across sessions.

---

## Pipeline Behavior

### maxRuntimeMinutes

**Default:** 0 (unlimited) | **Range:** 0-1440

Maximum pipeline runtime before the circuit breaker trips. `0` disables the wall-clock cap entirely.

**When to change:**

- Set a positive value (e.g., 480) as an emergency brake on cost for unattended runs
- Leave at 0 to let the pipeline run until all tasks complete

### maxConsecutiveFailures

**Default:** 5 | **Range:** 1-10

Consecutive task failures before the pipeline aborts.

**When to change:**

- Increase if failures are environmental (flaky tests, network issues)
- Decrease for production repos where failures indicate real problems

### humanReviewLevel

**Default:** 1 | **Range:** 0-4

Controls human oversight checkpoints:

| Level | Name              | Behavior                                   |
| ----- | ----------------- | ------------------------------------------ |
| 0     | Full Autonomy     | Pipeline creates PR and enables auto-merge |
| 1     | PR Approval       | Pipeline creates PR, human merges          |
| 2     | Review Checkpoint | Human signs off before PR creation         |
| 3     | Spec Approval     | Human approves spec before execution       |
| 4     | Full Supervision  | Human approves at every stage              |

**When to change:**

- Use 0 for trusted, well-tested codebases with strong CI
- Use 1 (default) for standard autonomous workflow
- Use 3-4 for first runs or security-sensitive work

### maxParallelTasks

**Default:** 3 | **Range:** 1-10

Maximum concurrent task-executor agents.

**When to change:**

- Increase to speed up independent task execution
- Decrease if hitting memory limits or API rate limits

---

## Code Review

### review.routineRounds / featureRounds / securityRounds

Maximum adversarial review rounds by risk tier when using cloud models.

| Tier     | Default | Range |
| -------- | ------- | ----- |
| Routine  | 2       | 1-5   |
| Feature  | 4       | 1-10  |
| Security | 6       | 1-10  |

**When to change:**

- Increase for codebases with complex review requirements
- Decrease to reduce API costs on low-risk changes

### review.ollamaRoutineRounds / ollamaFeatureRounds / ollamaSecurityRounds

Review rounds when running on local Ollama models. Higher than cloud defaults to compensate for lower model quality.

| Tier     | Default | Range |
| -------- | ------- | ----- |
| Routine  | 15      | 5-50  |
| Feature  | 20      | 5-50  |
| Security | 25      | 5-50  |

### review.preferCodex

**Default:** true

Use OpenAI Codex for adversarial review when available, fall back to Claude Code `task-reviewer` otherwise.

**When to change:**

- Set false if Codex is unavailable or you prefer Claude Code review
- Keep true for Codex's purpose-built adversarial review mode

---

## Quality Gates

### quality.holdoutPercent

**Default:** 20 | **Range:** 0-50

Percentage of acceptance criteria withheld from task-executor for holdout validation.

**When to change:**

- Increase (30-40%) for complex specs where surface-level implementation is a risk
- Set to 0 to disable holdout validation entirely

### quality.holdoutPassRate

**Default:** 80 | **Range:** 50-100

Minimum percentage of withheld criteria that must be satisfied without being explicitly requested.

**When to change:**

- Decrease (70%) if holdout failures are frequent but implementations are correct
- Increase (90%) for critical paths where spec adherence is essential

### quality.mutationScoreTarget

**Default:** 80 | **Range:** 50-100

Minimum mutation score percentage for feature and security tier tasks.

**When to change:**

- Decrease (60-70%) for codebases where full mutation coverage is impractical
- Keep at 80% (industry standard) for production code

### quality.mutationTestingTiers

**Default:** `["feature", "security"]`

Risk tiers that require mutation testing. Routine tasks skip mutation testing by default.

**When to change:**

- Add `"routine"` if you want mutation testing on all tasks
- Remove tiers if mutation testing is too slow for your codebase

### quality.coverageMustNotDecrease

**Default:** true

Block tasks that decrease test coverage.

**When to change:**

- Set false during refactoring where coverage may temporarily decrease
- Keep true for feature work where coverage should increase or stay stable

---

## Task Execution

### execution.defaultModel

**Default:** sonnet | **Options:** haiku, sonnet, opus

Default model for task execution. Overridden by complexity classification:

| Complexity | Model  |
| ---------- | ------ |
| Simple     | haiku  |
| Medium     | sonnet |
| Complex    | opus   |

**When to change:**

- Set to `opus` for codebases requiring complex reasoning
- Set to `haiku` to reduce costs on simple tasks

### execution.maxTurnsSimple / maxTurnsMedium / maxTurnsComplex

Maximum turns per task by complexity tier.

| Tier    | Default | Range  |
| ------- | ------- | ------ |
| Simple  | 40      | 10-200 |
| Medium  | 60      | 20-200 |
| Complex | 80      | 20-200 |

**When to change:**

- Increase for tasks that require extensive exploration
- Decrease to fail fast on tasks that aren't converging

---

## Local LLM Fallback

### localLlm.enabled

**Default:** false

Enable Ollama fallback when API rate limits approach.

**When to change:**

- Set true for overnight runs where rate limits are likely
- Keep false if you have Pro Max subscription or prefer waiting for limits

### localLlm.ollamaUrl

**Default:** `http://localhost:11434`

Ollama server URL. Supports local or remote servers.

**When to change:**

- Point to a remote server: `http://192.168.1.50:11434`
- The remote server must be running `OLLAMA_HOST=0.0.0.0:11434 ollama serve`

### localLlm.model

**Default:** `qwen2.5-coder:14b`

Ollama model tag. Auto-pulled on first use if not present.

| VRAM  | Model               | Use Case                |
| ----- | ------------------- | ----------------------- |
| 8GB   | `qwen2.5-coder:7b`  | Simple tasks only       |
| 16GB+ | `qwen2.5-coder:14b` | Routine + feature tasks |
| 24GB+ | `qwen2.5-coder:32b` | Near cloud quality      |

### localLlm.useLiteLlm / liteLlmUrl

Optional LiteLLM proxy for unified multi-provider routing. Only recommended for teams or heavy usage.

---

## Dependencies

### dependencies.prMergeTimeout

**Default:** 45 | **Range:** 5-180

Minutes to wait for a dependency PR to merge.

### dependencies.pollInterval

**Default:** 60 | **Range:** 10-300

Seconds between merge status checks.

**When to change:**

- Decrease poll interval for faster CI pipelines
- Increase timeout for repos with slow CI or required reviewers

---

## Observability

### observability.auditLog

**Default:** true

Enable tamper-evident audit logging of all tool uses.

**When to change:**

- Keep true for compliance (EU AI Act requires audit trails)
- Set false only for local experimentation

### observability.metricsExport

**Default:** json | **Options:** json, sqlite

Metrics storage format.

**When to change:**

- Use sqlite for querying metrics across many runs
- Use json for simple inspection

### observability.metricsRetentionDays

**Default:** 90 | **Range:** 7-365

Days to retain metrics data.
