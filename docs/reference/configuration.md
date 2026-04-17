# Configuration Schema

Complete reference for every runtime config option read by the pipeline scripts from `${CLAUDE_PLUGIN_DATA}/config.json`. Write values with `/factory:configure`.

## Pipeline Behavior

### maxRuntimeMinutes

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 0      |
| Min      | 0      |
| Max      | 1440   |

Maximum pipeline runtime in minutes before circuit breaker trips. `0` = unlimited (default). Set to a positive value to enable a wall-clock emergency brake.

### maxConsecutiveFailures

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 5      |
| Min      | 1      |
| Max      | 10     |

Consecutive task failures before pipeline aborts.

### humanReviewLevel

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 0      |
| Min      | 0      |
| Max      | 4      |

Human oversight level. Default (0) assumes CI branch protection and GitHub auto-merge are enabled.

| Value | Name              | Behavior                                             |
| ----- | ----------------- | ---------------------------------------------------- |
| 0     | Full Autonomy     | Pipeline creates PR and enables auto-merge (default) |
| 1     | PR Approval       | Pipeline creates PR, human merges                    |
| 2     | Review Checkpoint | Human signs off before PR creation                   |
| 3     | Spec Approval     | Human approves spec before execution                 |
| 4     | Full Supervision  | Human approves at every stage                        |

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

Review rounds for routine-tier tasks.

### review.featureRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 4      |
| Min      | 1      |
| Max      | 10     |

Maximum adversarial review rounds for feature-tier tasks.

### review.securityRounds

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 6      |
| Min      | 1      |
| Max      | 10     |

Maximum adversarial review rounds for security-tier tasks.

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

### quality.coverageRegressionTolerancePct

| Property | Value  |
| -------- | ------ |
| Type     | number |
| Default  | 0.5    |
| Min      | 0      |
| Max      | 10     |

Maximum allowed drop in coverage (percentage points) before the regression gate fails. Default `0.5` absorbs measurement noise from branch/line count shifts. This is a regression tolerance, NOT a minimum-coverage floor — projects that want to enforce a floor should add a dedicated CI step.

---

## Task Execution

### execution.defaultModel

| Property | Value               |
| -------- | ------------------- |
| Type     | string              |
| Default  | sonnet              |
| Enum     | haiku, sonnet, opus |

Default model for task execution. Overridden by per-tier overrides below:

| Tier (from `pipeline-classify-task`) | Default model | Override key                    |
| ------------------------------------ | ------------- | ------------------------------- |
| Simple                               | haiku         | `execution.modelByTier.simple`  |
| Medium                               | sonnet        | `execution.modelByTier.medium`  |
| Complex                              | opus          | `execution.modelByTier.complex` |

### execution.modelByTier.simple

| Property | Value               |
| -------- | ------------------- |
| Type     | string              |
| Default  | haiku               |
| Enum     | haiku, sonnet, opus |

Model used for tasks classified as simple tier (low file count, no dependencies).

### execution.modelByTier.medium

| Property | Value               |
| -------- | ------------------- |
| Type     | string              |
| Default  | sonnet              |
| Enum     | haiku, sonnet, opus |

Model used for tasks classified as medium tier.

### execution.modelByTier.complex

| Property | Value               |
| -------- | ------------------- |
| Type     | string              |
| Default  | opus                |
| Enum     | haiku, sonnet, opus |

Model used for tasks classified as complex tier (many files or deep dependency chains).

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

---

## Safety

Used by the `write-protection` and `secret-commit-guard` PreToolUse hooks. All three keys default to permissive values so the hooks no-op until a project opts in.

### safety.writeBlockedPaths

| Property | Value |
| -------- | ----- |
| Type     | array |
| Default  | `[]`  |

Glob patterns (bash globstar + extglob) of file paths that the write-protection hook must block. Evaluated on PreToolUse for `Edit`, `Write`, and `MultiEdit` tool calls. Empty by default; add entries like `"**/migrations/**"` or `".env*"` to opt into blocking.

### safety.useTruffleHog

| Property | Value   |
| -------- | ------- |
| Type     | boolean |
| Default  | false   |

When `true`, the secret-commit-guard hook runs `trufflehog filesystem --directory <cwd> --only-verified` before every `git commit` in addition to the built-in path and regex scans. Findings are filtered against `safety.allowedSecretPatterns`. If `trufflehog` is not installed the hook logs a warning and continues with regex-only scanning (does not block).

### safety.allowedSecretPatterns

| Property | Value |
| -------- | ----- |
| Type     | array |
| Default  | `[]`  |

Regex patterns (extended regex, evaluated by `grep -E`) for known-safe secret-like strings (e.g. Supabase anon keys, Stripe publishable keys). Any path-scan hit or TruffleHog finding whose raw value matches one of these patterns is filtered out before the hook decides whether to block a commit.
