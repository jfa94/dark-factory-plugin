# Components

This document provides a detailed inventory of all plugin components: agents, hooks, bin scripts, commands, skills, and MCP servers.

## Plugin File Structure

```
dark-factory-plugin/
├── .claude-plugin/
│   └── plugin.json              # Manifest with userConfig schema
├── commands/
│   ├── run.md                   # /dark-factory:run entry point
│   └── configure.md             # /dark-factory:configure settings editor
├── agents/
│   ├── pipeline-orchestrator.md # Control loop, subagent spawning
│   ├── spec-generator.md        # PRD to spec conversion
│   ├── task-executor.md         # Code generation in worktree
│   └── task-reviewer.md         # Adversarial code review
├── skills/
│   └── review-protocol/
│       └── SKILL.md             # Actor-Critic review methodology
├── hooks/
│   ├── hooks.json               # Hook definitions
│   ├── branch-protection.sh     # Block destructive git operations
│   ├── run-tracker.sh           # Audit logging
│   ├── stop-gate.sh             # Session end validation
│   └── subagent-stop-gate.sh    # Subagent artifact validation
├── bin/
│   └── (21 scripts)             # Deterministic pipeline utilities
├── servers/
│   └── pipeline-metrics/        # Metrics MCP server
├── templates/
│   └── settings.autonomous.json # Safety settings for autonomous mode
├── settings.json                # Default permission grants
└── .mcp.json                    # MCP server configuration
```

---

## Commands

### `/dark-factory:run`

Entry point for all pipeline invocations.

**Arguments:**

| Argument     | Required        | Default    | Description                                         |
| ------------ | --------------- | ---------- | --------------------------------------------------- |
| `mode`       | No              | `discover` | Operating mode: `discover`, `prd`, `task`, `resume` |
| `--issue`    | For `prd` mode  | -          | GitHub issue number                                 |
| `--task-id`  | For `task` mode | -          | Task ID to execute                                  |
| `--spec-dir` | For `task` mode | -          | Path to spec directory                              |
| `--strict`   | No              | -          | Require [PRD] marker on issues                      |
| `--dry-run`  | No              | -          | Validate without executing                          |

**Behavior:**

1. Check `DARK_FACTORY_AUTONOMOUS_MODE` environment variable
2. Run `pipeline-validate` to check preconditions
3. Parse mode and validate arguments
4. Initialize run state via `pipeline-init`
5. Spawn `pipeline-orchestrator` agent

### `/dark-factory:configure`

Conversational settings editor.

**Behavior:**

1. Load current config from `${CLAUDE_PLUGIN_DATA}/config.json`
2. Load defaults from `plugin.json`
3. Present settings grouped by category
4. Validate and apply changes
5. Validate changes against schema

---

## Agents

### pipeline-orchestrator

Central control loop that iterates the task DAG, spawns subagents, and manages retries.

| Property  | Value                                      |
| --------- | ------------------------------------------ |
| Model     | opus                                       |
| Max Turns | 9999                                       |
| Tools     | Bash, Read, Write, Edit, Grep, Glob, Agent |

**Key behaviors:**

- Delegates all deterministic work to `bin/pipeline-*` scripts
- Makes judgment calls: retry vs skip, escalate vs continue
- Spawns concurrent task-executors via multiple Agent calls in one message
- Manages review rounds and human escalation

### spec-generator

Converts a PRD issue body into a spec directory with `spec.md` and `tasks.json`.

| Property  | Value       |
| --------- | ----------- |
| Model     | opus        |
| Max Turns | 60          |
| Isolation | worktree    |
| Skills    | prd-to-spec |

**Key behaviors:**

- Skips step 5 (user quiz) in autonomous mode
- Validates output via `pipeline-validate-spec`
- Spawns `spec-reviewer` for quality validation
- Completes handoff protocol to transfer spec across worktree boundary

### task-executor

Implements a single task from the spec in an isolated worktree.

| Property  | Value                                          |
| --------- | ---------------------------------------------- |
| Model     | sonnet (default, overridden by classification) |
| Max Turns | 60 (default, overridden by classification)     |
| Isolation | worktree                                       |

**Model/turns by complexity:**

| Tier    | Model  | Max Turns |
| ------- | ------ | --------- |
| Simple  | haiku  | 40        |
| Medium  | sonnet | 60        |
| Complex | opus   | 80        |

**Key behaviors:**

- Reads spec and task context
- Implements code changes
- Writes tests (property-based where applicable)
- Runs tests and auto-fixes failures (max 3 attempts)
- Commits with task_id reference

### task-reviewer

Fresh-context adversarial code review with structured verdicts.

| Property  | Value                        |
| --------- | ---------------------------- |
| Model     | sonnet                       |
| Max Turns | 25                           |
| Skills    | review-protocol              |
| Tools     | Read, Grep, Glob (read-only) |

**Key behaviors:**

- Reviews with zero implementation context
- Follows Actor-Critic adversarial posture
- Validates acceptance criteria with file:line evidence
- Validates holdout criteria (criteria executor did not see)
- Outputs structured verdict: APPROVE, REQUEST_CHANGES, or NEEDS_DISCUSSION

---

## Existing Agents (Reused by Reference)

These agents are defined in the user's `.claude/agents/` directory. The plugin spawns them by name via the Agent tool.

| Agent                   | Spawned By              | Purpose                                     |
| ----------------------- | ----------------------- | ------------------------------------------- |
| `spec-reviewer`         | spec-generator          | Validates spec quality (score >= 54/60)     |
| `code-reviewer`         | orchestrator (fallback) | General code review when Codex unavailable  |
| `architecture-reviewer` | orchestrator            | Extra review for security-tier tasks        |
| `security-reviewer`     | orchestrator            | OWASP Top 10, secrets exposure              |
| `test-writer`           | orchestrator            | Kills mutation testing survivors            |
| `scout`                 | spec-generator          | Codebase exploration during spec generation |
| `scribe`                | orchestrator            | Post-pipeline docs update                   |

---

## Skills

### review-protocol

Injects Actor-Critic adversarial review methodology into any reviewer.

**Checklist:**

- Correctness: edge cases, error paths, return types
- Security: OWASP Top 10, input validation, secrets exposure
- Test quality: meaningful assertions, failure mode coverage
- AI anti-patterns: hallucinated APIs, over-abstraction, copy-paste drift, dead code, tautological tests
- Performance: algorithmic complexity, missing pagination, memory leaks

**Verdict rules:**

- `APPROVE`: Zero blocking findings AND all acceptance criteria pass
- `REQUEST_CHANGES`: Any blocking finding OR any criterion fails
- `NEEDS_DISCUSSION`: Ambiguity requiring human judgment

---

## Hooks

Defined in `hooks/hooks.json`. All hooks fire for all plugin agents.

### branch-protection (PreToolUse)

Blocks destructive git operations on protected branches (main, master, develop).

**Blocked operations:**

- Push to protected branch (direct or via refspec)
- Force push to protected branch
- Delete protected branch (local or remote)
- Hard reset to protected branch

**Exit codes:**

- 0: Allow operation
- 2: Block operation (JSON reason on stderr)

### run-tracker (PostToolUse)

Append-only audit logging during active pipeline runs.

**Triggers:** Bash, Write, Edit tool uses

**Writes to:** `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/audit.jsonl`

**Tamper-evidence:** Each entry includes SHA256 hash chain linking to previous entry. Reordering or deletion is detectable via `--verify` mode.

### stop-gate (Stop)

Validates state consistency when agent session ends.

**Behavior:**

- Checks for incomplete state transitions
- Marks interrupted runs in state
- Removes `runs/current` symlink on clean exit

### subagent-stop-gate (SubagentStop)

Validates subagent artifacts on completion.

**Behavior:**

- Verifies expected output files exist
- Records completion status in parent state

---

## Bin Scripts

All scripts live in `bin/`. They source `pipeline-lib.sh` for shared functions.

### Core Scripts

| Script              | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `pipeline-lib.sh`   | Shared library: logging, config, state shortcuts, utilities |
| `pipeline-validate` | Project precondition checks                                 |
| `pipeline-init`     | Create run state tracking files                             |
| `pipeline-state`    | Read/write task status, dep satisfaction                    |
| `pipeline-lock`     | Acquire/release directory lock                              |

### Input & Discovery

| Script                    | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `pipeline-fetch-prd`      | Fetch PRD body from GitHub issue                    |
| `pipeline-validate-spec`  | Validate spec output files                          |
| `pipeline-validate-tasks` | Field validation, cycle detection, topological sort |

### Task Execution

| Script                     | Purpose                                            |
| -------------------------- | -------------------------------------------------- |
| `pipeline-branch`          | Branch creation, worktree operations, staging init |
| `pipeline-classify-task`   | Complexity classification (model/turns)            |
| `pipeline-classify-risk`   | Risk tier (routine/feature/security)               |
| `pipeline-build-prompt`    | Template task metadata into structured prompt      |
| `pipeline-circuit-breaker` | Check runtime/consecutive-failures thresholds      |

### Review & Quality

| Script                     | Purpose                                          |
| -------------------------- | ------------------------------------------------ |
| `pipeline-detect-reviewer` | Check Codex availability, return reviewer config |
| `pipeline-codex-review`    | Codex exec wrapper for adversarial review        |
| `pipeline-parse-review`    | Extract structured verdict from reviewer output  |
| `pipeline-coverage-gate`   | Compare coverage before/after, block decreases   |

### Rate Limiting

| Script                  | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `statusline-wrapper.sh` | Capture rate limits from Claude Code statusline          |
| `pipeline-quota-check`  | Read usage-cache.json, compute window position           |
| `pipeline-model-router` | Return proceed/wait/end_gracefully action based on quota |

### Completion

| Script                | Purpose                                        |
| --------------------- | ---------------------------------------------- |
| `pipeline-wait-pr`    | Poll for PR merge with CI/conflict handling    |
| `pipeline-gh-comment` | Post comments and labels to GitHub issues      |
| `pipeline-summary`    | Aggregate run results into execution summary   |
| `pipeline-cleanup`    | Delete branches, close issues, clean worktrees |
| `pipeline-scaffold`   | Create project scaffolding files               |

---

## MCP Servers

### pipeline-metrics

Provides tools for recording and querying pipeline execution metrics.

**Configuration:** `.mcp.json`

**Storage:** SQLite at `${CLAUDE_PLUGIN_DATA}/metrics.db`

**Tools:**

| Tool              | Description                 |
| ----------------- | --------------------------- |
| `metrics_record`  | Record a pipeline event     |
| `metrics_query`   | Query events with filters   |
| `metrics_summary` | Summarize metrics for a run |
| `metrics_export`  | Export all metrics as JSON  |

**Event types:** `task_start`, `task_end`, `review_round`, `quality_gate`, `model_switch`, `circuit_breaker`, `run_start`, `run_end`

**Installation:**

```bash
cd servers/pipeline-metrics && npm install
```

Then enable in `.mcp.json` by setting `"disabled": false`.

---

## Templates

### settings.autonomous.json

Bundled safety settings for autonomous operation. Includes:

- `DARK_FACTORY_AUTONOMOUS_MODE=1` environment variable
- Explicit `allow` list for safe commands
- Comprehensive `deny` list blocking destructive operations
- Hooks for .claude/ directory protection, branch protection, dangerous patterns, SQL safety, pre-commit checks, and auto-formatting
