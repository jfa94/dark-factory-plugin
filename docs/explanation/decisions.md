# Design Decisions

This document explains key architectural choices and their rationale.

## Decision 1: Deterministic-First Architecture

**Choice:** Approximately 3:1 ratio of deterministic components (bin scripts, hooks) to non-deterministic (agents). If a step CAN be a script, it MUST be a script.

**Why:**

- Agent instructions are followed approximately 70% of the time
- Hooks and scripts enforce at 100%
- Concrete operational rules outperform abstract directives by 123% (research)

**Result:** 21 bin scripts, 4 plugin agents, 4 hooks. Scripts handle validation, state, classification, parsing. Agents handle code generation, review, spec creation.

---

## Decision 2: Orchestrator-as-Agent with Script Delegation

**Choice:** The orchestrator is an agent (required to spawn subagents via Agent tool), but it delegates ALL deterministic work to bin scripts via Bash calls.

**Why not a pure script orchestrator?**

Only agents can use the `Agent` tool to spawn subagents. A shell script cannot spawn `spec-generator`, `task-executor`, or `task-reviewer` agents.

**Why not pure agent orchestration?**

State management, circuit breakers, DAG traversal, and classification MUST be 100% reliable. Agent instructions for these would fail approximately 30% of the time.

**Mitigations:**

- State persistence: every state transition is written by a bin script
- Circuit breakers: deterministic limits prevent runaway execution
- Idempotent scripts: re-running produces the same output
- Resume capability: interrupted runs recover from persisted state

---

## Decision 3: Bundle All Pipeline Agents

**Choice:** All agents used by the pipeline are bundled inside the plugin's `agents/` directory. No user-provided agents are required.

**Why:**

- Documented behavior works out of the box — no missing-agent silent degradation
- Consistent output formats across all consumers; `pipeline-parse-review` never breaks
- Plugin ships as a complete unit; install = fully functional

**Trade-off:** Bundled agents pin behavior to the plugin version. User edits to plugin agents propagate to all pipeline runs from that project.

---

## Decision 4: Separate task-reviewer from code-reviewer

**Choice:** Create a new `task-reviewer` agent in the plugin rather than reusing the existing `code-reviewer` directly.

**Why:**

- `task-reviewer` adds acceptance-criteria validation
- `task-reviewer` validates holdout criteria (criteria the executor never saw)
- `task-reviewer` outputs machine-parseable structured format
- `task-reviewer` is round-aware (tracks review iteration)

The existing `code-reviewer` is still used as a fallback when Codex is unavailable.

---

## Decision 5: Holdout Specs in Plugin Data, Not Repo

**Choice:** Store withheld acceptance criteria in `${CLAUDE_PLUGIN_DATA}/holdouts/`, outside the git worktree.

**Why:**

- Task-executors run in isolated worktrees
- If holdouts were in the repo, executors could read them
- Plugin data directory is inaccessible from worktrees
- Maintains holdout integrity

---

## Decision 6: Three-Tier Component Model

**Choice:** Three distinct tiers with clear responsibility boundaries.

| Tier        | Reliability                | Responsibility                                 |
| ----------- | -------------------------- | ---------------------------------------------- |
| Hooks       | 100% enforcement           | Safety constraints that must never be violated |
| Bin scripts | 100% given valid input     | Logic with a single correct answer             |
| Agents      | ~70% instruction following | Tasks requiring judgment, creativity, NLU      |

**Why not just hooks + agents?**

Hooks fire on specific events. They cannot be called on-demand by the orchestrator. Scripts fill the gap: on-demand deterministic logic.

**Why not just scripts + agents?**

Hooks are un-bypassable. Even if the orchestrator ignores instructions, hooks still fire. Branch protection via hook blocks force-push regardless of agent behavior.

---

## Decision 7: No External State Server

**Choice:** JSON files in `${CLAUDE_PLUGIN_DATA}` for all state management.

**Why:**

- Human-readable, trivially inspectable with `jq`
- No dependencies
- Same pattern as the original Bash pipeline

**Exception:** The metrics MCP server uses SQLite because metrics queries benefit from SQL aggregation.

**Atomic writes:** All state writes use `write-to-temp + mv` pattern to prevent corruption.

---

## Decision 8: Worktree Isolation Replaces Directory Locking

**Choice:** Each task-executor runs in its own git worktree.

**Why:**

- True isolation: each executor has its own working directory and branch
- No possibility of git conflicts between concurrent tasks
- No deadlocks from held locks
- Native support via Claude Code's `isolation: "worktree"` frontmatter

The lock (`pipeline-lock`) exists only to prevent two orchestrator instances from running simultaneously.

---

## Decision 9: Adversarial Review with Vendor Fallback

**Choice:** Use OpenAI Codex's adversarial review mode as primary reviewer when available; fall back to Claude Code's task-reviewer.

**Why Codex as primary:**

- Purpose-built adversarial review command
- Different vendor creates genuine independence (different biases, failure modes)
- Actor-Critic pattern is strongest when Actor and Critic are distinct systems

**Why Claude Code as fallback:**

- Codex may not be installed or authenticated
- Fallback must be fully functional
- `review-protocol` skill injects adversarial posture

Detection is deterministic: `pipeline-detect-reviewer` checks Codex availability via CLI commands.

---

## Decision 10: Dual Usage Checks (5h and 7d)

**Choice:** Run two independent usage checks before each task spawn with distinct behaviors.

**Why not coalesce into a single metric?**

- 5-hour limit is a burst constraint (temporary, appropriate to wait)
- 7-day limit is a budget constraint (indicates sustained over-consumption, should stop)

**5-hour behavior:**

- Over threshold: wait until reset

**7-day behavior:**

- Over threshold: end gracefully, mark partial

**Why source from statusline?**

Claude Code's statusline JSON includes `rate_limits` data. The `statusline-wrapper.sh` script captures this to `usage-cache.json` on every statusline update — no API calls, no token cost, real-time data.

---

## Decision 11: Existing User Hooks Fire Automatically

**Choice:** Do NOT duplicate the user's existing hooks in the plugin.

**Why:**

- User's hooks fire for ALL agent sessions including plugin agents
- Duplicating would cause double-execution
- User customizations should be inherited, not overridden

Plugin-specific hooks (branch-protection, run-tracker, stop-gate) cover pipeline-specific concerns only.

---

## Decision 12: Staging Branch as Integration Point

**Choice:** All task worktrees branch from `staging`, and all task PRs target `staging`.

**Why:**

- `main` and `develop` are protected branches
- Multiple concurrent tasks modifying protected branches would conflict
- `staging` provides an integration layer without touching `main`
- Humans retain explicit control over what moves to `main`

**Dependent task ordering:**

Task B waits for Task A's PR to merge into `staging` before starting. Sequential execution for dependent tasks, parallel for independent.

---

## Decision 13: Bundled Autonomous Settings

**Choice:** The plugin ships `templates/settings.autonomous.json`. The `/factory:run` command detects whether the session was launched with these settings.

**Detection:** The settings file sets `FACTORY_AUTONOMOUS_MODE=1`. The command checks for this env var.

**Why not hook-based swap?**

The session must start with correct settings. Subagents inherit parent session settings. A swap approach risks leaving autonomous settings in place if the pipeline crashes.

---

## Decision 14: CI Integration and Conflict Handling

**Choice:** `pipeline-wait-pr` polls both PR merge status AND CI checks. On CI failure, attempt up to 2 automated fixes. On merge conflicts, attempt one rebase.

**CI failure retry limit (2):**

CI failures from pipeline output should be rare (quality gates run first). Two attempts handle transient issues. Beyond that, human judgment is needed.

**Rebase-once strategy:**

One rebase resolves most simple conflicts. If it still fails, the conflict is likely semantic and requires human review.

---

## Decision 15: Project Scaffolding

**Choice:** `pipeline-scaffold` creates project files on first run. Files only created if absent (idempotent).

**Why scaffold instead of bundled templates?**

Scaffolding files are project-specific artifacts. They belong in the user's repository, versioned and visible to teammates.

**Why idempotent?**

Users may customize files after first run. Overwriting would destroy customizations.

---

## Plugin System Constraints

### Agents Cannot Use Hooks Per-Agent

All hooks in `hooks.json` fire for all agents. Hook scripts check context to decide whether to act.

### Agents Cannot Use mcpServers Per-Agent

MCP servers declared in `.mcp.json` are available to all plugin agents.

### Agents Cannot Use permissionMode

Cannot set per-agent permissions (e.g., read-only for reviewers). Reviewer agents are instructed to only use read tools; enforcement is ~70% reliable.

### No Process Manager Primitive

Solved by orchestrator-as-agent pattern. The agent IS the control loop.

### Concurrent Agent Results

The orchestrator emits multiple `Agent()` calls in one message. Claude Code invokes them in parallel natively. All results return in the same turn.

---

## Open Questions

### Codex Plugin Availability

Is the Codex Claude Code plugin stable and publicly available?

**Status:** Unvalidated. Fallback via Claude Code reviewer is fully functional.
