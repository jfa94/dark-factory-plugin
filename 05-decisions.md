# Dark Factory Plugin — Design Decisions & Open Questions

## Design Decisions

### Decision 1: Deterministic-First Architecture

**Choice:** ~3:1 ratio of deterministic components (bin scripts, hooks) to non-deterministic (agents). If a step CAN be a script, it MUST be a script.

**Alternatives considered:**

| Option                                       | Pros                                                            | Cons                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **A: Agent-heavy (7+ agents, 4+ skills)**    | Natural language flexibility, easier to write                   | Agent instructions followed ~70%, non-deterministic state management, hard to test                     |
| **B: Script-heavy (pure Bash orchestrator)** | 100% deterministic, testable, debuggable                        | Cannot spawn Claude Code agents (Agent tool only available to agents), loses plugin framework benefits |
| **C: Hybrid — deterministic-first (chosen)** | Scripts for reliability where needed, agents for judgment tasks | More components to maintain, two paradigms to reason about                                             |

**Evidence:**

- Concrete operational rules outperform abstract directives by 123% (research report)
- Agent instructions followed ~70% of the time; hooks/scripts enforce at 100%
- METR RCT: perception gap of 39pp between believed and actual AI productivity — unreliable self-assessment extends to agents

**Result:** 21 bin scripts, 4 plugin agents, 4 hooks, 8+ existing agents reused. Scripts handle validation, state, classification, parsing. Agents handle code generation, review, spec creation.

---

### Decision 2: Orchestrator-as-Agent with Script Delegation

**Choice:** The orchestrator is an agent (required to spawn subagents via Agent tool), but it delegates ALL deterministic work to bin/ scripts via Bash calls.

**Why not a pure script orchestrator?**
The Claude Code plugin system has no process manager primitive. Only agents can use the `Agent` tool to spawn subagents. A shell script cannot spawn `spec-generator`, `task-executor`, or `task-reviewer` agents.

**Why not pure agent orchestration?**
State management, circuit breakers, DAG traversal, and classification MUST be 100% reliable. Agent instructions for these would fail ~30% of the time — unacceptable for pipeline control flow.

**Risk:** The orchestrator itself is non-deterministic. It might not call bin scripts in the right order, might misinterpret their output, or might skip steps.

**Mitigations:**

1. **State persistence** — every state transition is written by a bin script. If the orchestrator crashes/misbehaves, state reflects reality.
2. **Circuit breakers** — deterministic limits prevent runaway execution regardless of orchestrator behavior.
3. **Idempotent scripts** — re-running a script with the same input produces the same output. Safe to retry.
4. **Resume capability** — interrupted runs recover from persisted state, not agent memory.
5. **Explicit instructions** — orchestrator instructions are operational and concrete, not abstract directives.

---

### Decision 3: Bundle All Pipeline Agents

**Choice:** All pipeline agents ship inside the plugin's `agents/` directory. No user agent setup required.

**Alternatives considered:**

- **Reuse by reference:** User improvements propagate automatically — but pipeline behavior becomes unpredictable when user modifies agent output format, and documented features silently degrade when agents are missing.
- **Bundle all agents (chosen):** Fixed interfaces, predictable behavior, zero setup. Plugin ships as a complete unit.

**Trade-off:** Bundled agents pin behavior to the plugin version. Mitigated by: output formats are spec-driven and enforced by the `review-protocol` skill and structured schemas.

---

### Decision 4: Separate task-reviewer from code-reviewer

**Choice:** Create a new `task-reviewer` agent in the plugin rather than reusing the existing `code-reviewer` directly.

**Why:**

1. `task-reviewer` adds acceptance-criteria validation (checking each criterion against code with PASS/FAIL evidence)
2. `task-reviewer` validates holdout criteria (criteria the executor never saw)
3. `task-reviewer` outputs machine-parseable structured format (parsed by `pipeline-parse-review`)
4. `task-reviewer` is round-aware (includes round number, focuses on previous findings in subsequent rounds)

**The existing `code-reviewer` is still used** as a fallback when Codex is unavailable AND `review-protocol` skill needs to be injected for adversarial posture.

**Result:** `task-reviewer` is the primary pipeline reviewer. `code-reviewer` is a fallback option. Both can receive `review-protocol` skill injection.

---

### Decision 5: Holdout Specs in Plugin Data, Not Repo

**Choice:** Store withheld acceptance criteria in `${CLAUDE_PLUGIN_DATA}/holdouts/`, outside the git worktree.

**Why:**

- The task-executor runs in an isolated worktree. If holdout criteria were in the repo, the executor could read them.
- `${CLAUDE_PLUGIN_DATA}` is a plugin-specific directory outside any git repo. Agents operating in worktrees cannot access it unless explicitly given the path.
- The `pipeline-build-prompt` script writes holdouts to this directory. The orchestrator passes holdout criteria to the task-reviewer separately.

**Trade-off:** Holdout criteria are not version-controlled. If a run is interrupted and resumed, holdouts must still exist in plugin data. Mitigated by: holdouts are stored per-run, and resume reads from the same run directory.

---

### Decision 6: Three-Tier Component Model (Hooks → Scripts → Agents)

**Choice:** Three distinct tiers of components with clear responsibility boundaries:

| Tier                            | Reliability                    | Responsibility                                                       | Example                                               |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------- |
| **Hooks** (un-bypassable)       | 100% enforcement               | Safety constraints that MUST never be violated                       | Branch protection, audit logging                      |
| **Bin scripts** (deterministic) | 100% correct given valid input | Logic that has a single correct answer                               | Validation, state management, classification, parsing |
| **Agents** (non-deterministic)  | ~70% instruction following     | Tasks requiring judgment, creativity, natural language understanding | Code generation, code review, spec creation           |

**Why not just hooks + agents?**
Hooks fire on specific events (PreToolUse, PostToolUse, Stop, SubagentStop). They cannot be called on-demand by the orchestrator. Bin scripts fill the gap: on-demand deterministic logic that agents call via Bash.

**Why not just scripts + agents?**
Hooks are un-bypassable. Even if the orchestrator agent ignores its instructions, hooks still fire. Branch protection via hook means force-push to main is blocked regardless of what any agent tries to do.

---

### Decision 7: No External State Server

**Choice:** JSON files in `${CLAUDE_PLUGIN_DATA}` for all state management.

**Alternatives considered:**

- **SQLite:** Better querying, atomic transactions. But adds dependency, harder to inspect, and the current pipeline uses JSON files successfully.
- **Redis/PostgreSQL:** Overkill for single-machine pipeline.
- **JSON files (chosen):** Same pattern as Bash pipeline. Human-readable, trivially inspectable with `jq`, no dependencies.

**Exception:** The metrics MCP server uses SQLite (`metrics.db`) because metrics queries benefit from SQL (aggregation, filtering, time ranges). State management stays JSON.

**Atomic writes:** All state writes use `write-to-temp + mv` pattern to prevent corruption from partial writes or interrupted sessions.

---

### Decision 8: Worktree Isolation Replaces Directory Locking

**Choice:** Each task-executor runs in its own git worktree. The `pipeline-lock` script is a secondary safety mechanism (prevents two orchestrators, not two executors).

**Why worktrees over locks:**

- **True isolation:** Each executor has its own working directory and branch. No possibility of git conflicts between concurrent tasks.
- **No deadlocks:** Lock-based concurrency can deadlock if a process dies holding a lock. Worktrees don't have this problem.
- **Native support:** Claude Code's `isolation: "worktree"` agent frontmatter creates and manages worktrees automatically.

**Lock still exists because:** Two orchestrator instances running simultaneously would cause state corruption. The lock prevents this edge case (e.g., user accidentally runs `/dark-factory:run` twice).

---

### Decision 9: Adversarial Review with Vendor Fallback

**Choice:** Use OpenAI Codex's adversarial review mode as primary reviewer when available; fall back to Claude Code's code-reviewer + review-protocol skill.

**Why Codex as primary:**

- Codex has a purpose-built `/codex:adversarial-review` command designed for threat-modeling code
- Using a DIFFERENT vendor for review than for implementation creates genuine independence (different model biases, different failure modes)
- Actor-Critic pattern is strongest when Actor and Critic are distinct systems

**Why Claude Code as fallback:**

- Codex may not be installed or authenticated
- Fallback must be fully functional, not degraded
- `review-protocol` skill injects adversarial posture into any reviewer
- The existing `code-reviewer` agent already has a strong review methodology

**Detection is deterministic:** `pipeline-detect-reviewer` checks Codex availability via `command -v codex && codex status --auth`. No agent judgment involved.

**Trade-off:** External dependency on Codex (npm package, OpenAI auth). Mitigated: detection is fast, fallback is automatic, and the fallback reviewer is fully capable.

---

### Decision 10: Dual Usage Checks — Separate 5h and 7d Behaviors

**Choice:** Run two independent usage checks before each task spawn — a 5-hour burst window check and a 7-day rolling window check — with distinct behaviors when exceeded.

**Why not coalesce into a single "effective" metric?**
The original bash pipeline took whichever utilization was higher (5h or 7d) and applied one behavior (wait). This is wrong: the 5-hour limit is a burst constraint (temporary, reset every 5 hours — appropriate to wait it out), while the 7-day limit is a budget constraint (indicates sustained over-consumption — not appropriate to wait, pipeline should stop and let the budget recover).

**5-hour check behavior:**

- Hourly thresholds: 20% / 40% / 60% / 80% / 90% across hours 1–5, derived from `resets_at - 5h`
- Over threshold → wait until 5h window resets (wait_minutes from `resets_at_epoch`, session-anchored)
- After wait, re-check quota and retry

**7-day check behavior:**

- Daily thresholds: 14% / 29% / 43% / 57% / 71% / 86% / 95% across days 1–7, derived from `resets_at - 7d`
- Final threshold is 95% (not 100%) to preserve a 5% buffer
- Over threshold → end gracefully: stop spawning, drain in-flight tasks, mark run `partial`, persist state for resume

**Why source from Claude Code's statusline, not response headers?**
Response headers require a layer to capture and write `last-headers.json` after each API call — but no such layer existed in the plugin (Agent() subagents don't expose response headers to the orchestrator). The Claude Code process already provides real-time `rate_limits` data in its statusline JSON (updated near-continuously). A wrapper script captures this to `usage-cache.json` with zero token cost and no API calls needed.

---

### Decision 11: Ollama Configuration, Remote Support & Auto-Pull

**Choice:** Remote Ollama is supported via `localLlm.ollamaUrl` (existing key). Model validation and auto-pull are integrated into `pipeline-model-router`. Configuration uses a conversational `/dark-factory:configure` agent command covering all settings.

**Default model:** `qwen2.5-coder:14b` — 9GB disk, ~10-12GB VRAM at Q4_K_M quantization. **16GB minimum GPU** to allow headroom for KV cache and OS overhead. The "14B model needs 16GB" concern conflates unquantized weight size (~28GB at FP16) with the actual Q4_K_M size. Ollama uses Q4_K_M by default; the model fits comfortably on 16GB without a context cap.

**Why auto-pull is in `pipeline-model-router`, not a separate script:**
Model validation is part of the routing decision — if the model isn't available, Ollama effectively isn't available. Bundling the check in the router keeps the logic in one place and avoids an extra bin script.

**Why auto-pull fires on the server (even for remote):**
`POST /api/pull` triggers download on the Ollama server, not the client. This is correct behavior for remote setups — the client machine doesn't need 9GB of disk space. Documented explicitly to avoid confusion.

**Why `configure` is conversational, not a TUI:**
Claude Code's Bash tool has no TTY access — interactive scripts (gum, fzf, dialog) cannot receive keyboard input when invoked by an agent. A standalone TUI script would require the user to run it outside Claude Code. The conversational approach works natively within the plugin without extra dependencies, and covers all `userConfig` settings, not just localLlm.

**Security for remote Ollama:**
Ollama has no built-in auth. The plugin documents LAN-only exposure and recommends a reverse proxy for access control if needed. No attempt is made to abstract this — it's the user's infrastructure concern.

---

### Decision 12: Existing User Hooks Fire Automatically

**Choice:** Do NOT duplicate any of the user's existing hooks in the plugin. They fire automatically for all plugin agents.

**Why:**

- The user's `.claude/settings.json` defines hooks for pre-commit, pre-push, dangerous patterns, SQL safety, etc.
- These hooks fire for ALL agent sessions, including plugin agents
- Duplicating them in the plugin's `hooks.json` would cause double-execution
- The user may customize these hooks — the plugin should inherit, not override

**Plugin-specific hooks** (branch-protection, run-tracker, stop-gate, subagent-stop-gate) cover pipeline-specific concerns that the user's hooks don't address.

---

### Decision 13: Staging Branch as Integration Point

**Choice:** All task worktrees branch from a `staging` branch, and all task PRs target `staging` rather than `main` or `develop`. The pipeline auto-creates `staging` if it doesn't exist.

**Branching hierarchy:**

1. Pipeline runs `pipeline-branch staging-init` at the start of every run
2. Checks remote for `staging` branch
3. If absent: creates from `develop` (if it exists) or `main`, pushes to remote
4. All task branches: `dark-factory/<issue>/<task-id>` created from `staging` HEAD
5. All PRs target `staging`
6. The `staging` branch is NOT auto-merged into `main`/`develop` — that's a deliberate human gate

**Why not branch directly from main/develop?**

- `main` and `develop` are protected branches. The autonomous settings hook blocks writes to them.
- Multiple concurrent tasks modifying the same protected branch would create conflicts.
- `staging` provides an integration layer where concurrent feature branches can merge safely without touching `main`.
- Humans retain explicit control over what moves from `staging` → `main`.

**Dependent task ordering:**

Task B (depends on task A) waits for A's PR to merge into `staging` via `pipeline-wait-pr`. Only after A is merged does the orchestrator call `pipeline-branch create` for B. This guarantees B's worktree starts from `staging` + A's changes — sequential execution for dependent tasks, parallel execution for independent ones.

**Security:** The `settings.autonomous.json` branch-protection hook blocks writes to `main`, `master`, and `develop`. `staging` is intentionally NOT in this list — task PRs must be able to merge there.

---

### Decision 14: Bundled Autonomous Settings with CLI Flag Detection

**Decided: 2026-04-08** (via Plan 04, task_04_01)

**Choice:** The plugin ships `templates/settings.autonomous.json` ported from the existing `~/Projects/dark-factory/templates/settings.autonomous.json` with `enabledPlugins` and `effortLevel` stripped so the template merges safely with user settings. The `/dark-factory:run` command detects whether the session was launched with these settings, and if not, prompts the user to relaunch.

**Detection mechanism:** `settings.autonomous.json` sets an environment variable `DARK_FACTORY_AUTONOMOUS_MODE=1` in its `env` config. The `/dark-factory:run` command checks for this env var as its first step. If absent, it exits with a clear message:

> "Dark Factory requires autonomous settings. Relaunch with: `claude --settings <plugin-root>/templates/settings.autonomous.json`"

**Why port nearly everything (not trim aggressively)?**

The autonomous settings have been carefully considered in the existing dark-factory project — `Bash(*)` with an explicit deny-list, safety hooks (branch protection, SQL safety, dangerous patterns, audit logging, test runner), and full MCP tool permissions. Only `enabledPlugins` and `effortLevel` were stripped (they conflict with user-level settings); all safety-relevant entries are preserved. Users can customize via `/dark-factory:configure` after install; the bundled file is the safe default.

**Why not hook-based swap/restore?**

The session must start with the correct settings — subagents inherit the parent session's settings, not settings that are swapped mid-session. A hook-based approach could swap `settings.json` before the session starts, but this risks leaving autonomous settings in place if the pipeline crashes before the stop-gate fires. The `--settings` flag approach is stateless: if the session crashes, the next session starts fresh with whatever settings the user specifies.

**Why not prompt per-run?**

Repeatedly asking the user to re-launch adds friction. The environment variable check is a one-time detection on `/dark-factory:run`. Once the user has set up their launcher (alias, script, or shell config), subsequent runs are seamless.

---

### Decision 15: CI Integration and Merge Conflict Handling

**Choice:** `pipeline-wait-pr` polls both PR merge status AND GitHub Actions CI checks. On CI failure, the orchestrator attempts up to 2 automated fixes before escalating. On merge conflicts, it attempts one rebase before escalating.

**Why integrate with dark-factory's GitHub Actions CI?**

The plugin's 5-layer quality gate runs before PR creation. However, the CI workflow in the dark-factory project runs independently on the PR branch — it may catch issues the quality gate missed (environment differences, integration tests, etc.). Ignoring CI failures and merging anyway would defeat the purpose of the CI workflow.

**CI failure retry limit (2):**

Conservative — CI failures from the pipeline's own output should be rare (quality gates run first). If the first fix attempt doesn't resolve the issue, the second is a safety net. Beyond 2 attempts, the failure is likely structural (environment issue, spec ambiguity, external dependency) and requires human judgment.

**Merge conflict rebase-once strategy:**

Merge conflicts happen when two tasks modify the same files concurrently. The pipeline's worktree isolation prevents conflicts during execution, but post-merge conflicts can occur if two PRs (targeting the same `staging` branch) both modify overlapping files. One rebase attempt resolves most simple conflicts (pure divergence). If a rebase still fails, the conflict is likely a genuine semantic collision requiring human review.

**Exit code 4 (unresolvable conflict) vs exit code 2 (closed without merge):**

The distinction matters for the orchestrator's response: a closed-without-merge PR from a human reviewer is different from a closed-due-to-conflict PR from auto-merge failure. Exit code 4 triggers a rebase attempt; exit code 2 does not.

**Auto-safe rebase file list:**

Some files can be resolved mechanically during rebase without human review:

- `package.json`: 3-way merge (both dependency additions are valid; conflicts here indicate intentional version disagreements which should be rare)
- `pnpm-lock.yaml`: always take `ours` — the lockfile is deterministically regenerated by `pnpm install` post-merge, so the rebase value is throwaway
- `claude-progress.json`, `feature-status.json`: pipeline tracking state, not code; the currently-executing task's view is authoritative (`ours`)
- `.gitignore`: union strategy — both sets of ignore entries should be kept

All other file conflicts require human review. The rebase loop runs up to 30 rounds to handle multi-commit rebases (where each round may surface a new conflict in a different commit).

---

### Decision 16: Project Scaffolding and Config Deployment

**Choice:** `pipeline-scaffold` and `pipeline-init --deploy-config` create project scaffolding files and CI/CD config on first run. Files are only created if absent (idempotent).

**Why scaffold files instead of bundled templates?**

The scaffolding files (`claude-progress.json`, `feature-status.json`, `init.sh`, `quality-gate.yml`) are project-specific artifacts, not plugin metadata. They belong in the user's repository (versioned, visible to teammates), not in the plugin directory.

**Why idempotent creation (not overwrite)?**

Users may customize their `quality-gate.yml` after the first run (add steps, adjust thresholds). Overwriting on every run would destroy those customizations. Idempotency means: if the file exists, trust the user's version.

**Why `.gitignore` management?**

Plugin state directories (`${CLAUDE_PLUGIN_DATA}/*`) contain ephemeral run state, not project code. Committing them would pollute the repository and cause merge conflicts across multiple machines. The pipeline automates this to prevent "accidentally committed pipeline state" issues that would otherwise require manual cleanup.

**Why spec directory cleanup post-merge?**

The spec directory is scaffolding for the pipeline's execution, not a permanent artifact. After all tasks for an issue are merged, the spec has served its purpose. Leaving it in the repository would accumulate spec files for every PRD ever processed, creating noise. Removal is committed so the deletion is in git history (recoverable) rather than silently deleted.

---

## Plugin System Constraints & Workarounds

### Constraint: Agents Cannot Use Hooks

**Impact:** Plugin agents cannot have per-agent hook configurations. All hooks in `hooks.json` fire for all agents.

**Workaround:** Hook scripts check context to decide whether to act:

- `run-tracker` checks if `${CLAUDE_PLUGIN_DATA}/runs/current` exists (only logs during active pipeline runs)
- `branch-protection` checks the target branch (applies universally — this is desirable)

### Constraint: Agents Cannot Use mcpServers

**Impact:** Individual agents cannot declare MCP server dependencies in their frontmatter.

**Workaround:** MCP servers are declared in `.mcp.json` at the plugin root. They're available to all agents in the plugin. The `pipeline-metrics` MCP server tools are accessible from the orchestrator agent.

### Constraint: Agents Cannot Use permissionMode

**Impact:** Cannot set per-agent permission modes (e.g., read-only for reviewers).

**Workaround:** `settings.json` at plugin root defines default permissions. Reviewer agents are instructed to only use Read/Grep/Glob/Bash (no Write/Edit). This is an instruction (~70% reliable), not enforcement. Mitigated: reviewers don't need to write files; if they accidentally do, it's in a worktree that gets cleaned up.

### Constraint: No Process Manager Primitive

**Impact:** Cannot define a Bash-like pipeline orchestration flow declaratively.

**Workaround:** Orchestrator-as-agent pattern (Decision 2). The agent IS the control loop, delegating deterministic work to scripts.

### Constraint: Concurrent Agent Result Reading

**Impact:** The orchestrator needs results from multiple task-executor agents running in parallel.

**Solution (validated 2026-04-10, Plan 12):** The orchestrator emits multiple `Agent()` tool calls in a single assistant message. Claude Code invokes them in parallel natively — all results return in the same turn. Background agents (`run_in_background: true`) are intentionally avoided due to upstream bugs (#17147, #21048, #20679, #7881). The SubagentStop hook exists as a safety net for artifact validation, not for result reading.

### Constraint: Turn Budget

**Status:** Resolved (Plan 15 analysis, 2026-04-12). See `remediation/analysis/15-turn-budget.md`.

**Finding:** The 200-turn concern was based on a stale spec value. The actual orchestrator uses `maxTurns: 9999`. Subagent turns don't count against the parent — each Agent() call costs ~2 orchestrator turns regardless of subagent complexity. A 20-task pipeline consumes ~254-334 orchestrator turns, well within the 9999 limit. The circuit breaker's `maxTasks: 20` is the effective pipeline size limit, not turn count. Resume capability (Decision 7) handles any interruption.

---

## Validated Assumptions

The following questions were raised during design and confirmed through implementation and integration testing.

### 1. Cross-Boundary Agent Spawning

**Validated: 2026-04-08** (Plan 03, spec propagation testing)

Plugin agents can spawn agents by name via the Agent tool's `subagent_type` parameter. Claude Code resolves names against plugin-local `agents/` first. All pipeline agents are bundled — spawning by name resolves to plugin-local files without user setup. See Decision 3.

### 2. Background Agent Result Reading

**Validated: 2026-04-10** (Plan 12, task_12_03)

The orchestrator does NOT use `run_in_background: true`. It spawns concurrent task-executor agents by emitting multiple `Agent()` tool calls in a single assistant message. Claude Code invokes them in parallel natively — all results return in the same turn. See "Concurrent Agent Result Reading" constraint above.

### 3. Hook Context Scoping

**Validated: 2026-04-10** (Plan 12, hook integration testing)

Hooks detect pipeline runs by checking `[[ -L "${CLAUDE_PLUGIN_DATA}/runs/current" ]]`. The `${CLAUDE_PLUGIN_DATA}` environment variable is injected by the plugin system into hook scripts (verified across 179 occurrences in 22 bin files). The well-known path fallback is unnecessary.

### 4. Bin Script Environment Variables

**Validated: 2026-04-10** (Plan 12, integration testing)

Both `${CLAUDE_PLUGIN_DATA}` and `${CLAUDE_PLUGIN_ROOT}` are injected by the plugin system into all plugin components (bin scripts, hooks, agents). Scripts source `pipeline-lib.sh` which reads config from `${CLAUDE_PLUGIN_DATA}/config.json`. No argument-passing fallback needed.

---

## Open Questions

> An open question is a commitment to defer a decision. It should have a timeline and an owner. Open questions older than 6 months should be either decided or removed.

### 5. Codex Plugin Availability

**Status:** Unvalidated — requires external dependency check

**Question:** Is the Codex Claude Code plugin stable and publicly available? Do `/codex:setup` and `/codex:adversarial-review` commands exist?

- Options considered: (A) Codex as primary reviewer, (B) Claude Code reviewer only
- Current lean: A with automatic fallback to B
- Blocker for: None — fallback via `code-reviewer` + `review-protocol` skill is fully functional (Decision 9)

**Mitigation:** `pipeline-detect-reviewer` checks Codex availability at runtime. If unavailable, Claude Code's reviewer with adversarial posture is used. No pipeline functionality depends exclusively on Codex.

### 6. Ollama Model Routing via Environment Variables

**Status:** Design validated, runtime untested

**Question:** Can `ANTHROPIC_BASE_URL` be overridden per-subagent spawn, or is it process-global?

- Options considered: (A) Per-spawn env override, (B) LiteLLM proxy as intermediary
- Current lean: A — `pipeline-model-router` outputs `base_url` for the orchestrator to pass when spawning task-executor
- Blocker for: Local LLM fallback (Stage J). Without per-spawn override, LiteLLM proxy is required

**Mitigation:** LiteLLM proxy fallback documented in Decision 11. Auto-pull and availability checking work regardless of routing mechanism.

### 7. Local Model Tool-Use Compatibility

**Status:** Untested — requires live Claude Code + Ollama session

**Question:** Does Claude Code's agent framework work correctly with Ollama models (non-Anthropic tool-use format)?

- Options considered: (A) Full agent compatibility via OpenAI-format tool-use, (B) Bash-only invocation for local models
- Current lean: A — Ollama's OpenAI-compatible API supports function calling for Qwen 2.5+ and Llama 3.1+
- Blocker for: Local LLM fallback quality. Without tool-use, local models limited to generation tasks

**Mitigation:** Quality gates apply identically regardless of model provider. Even without tool-use, code generation tasks can proceed; review and validation remain on Claude.

### 8. Turn Budget Sufficiency

**Resolved: 2026-04-12** (Plan 15, consolidated analysis)

The 200-turn concern was based on a stale spec value (`03-components.md` said 200; actual orchestrator uses `maxTurns: 9999`). Subagent turns don't count against the parent orchestrator. A 20-task pipeline consumes ~254-334 orchestrator turns — well within 9999. The circuit breaker's `maxTasks: 20` is the effective pipeline size limit.

Full analysis: `remediation/analysis/15-turn-budget.md`. Future scaling (>20 tasks): checkpoint-resume with turn tracking (Option E in analysis).

---

## Risk Assessment

| Risk                                                | Likelihood | Impact                                         | Mitigation                                                |
| --------------------------------------------------- | ---------- | ---------------------------------------------- | --------------------------------------------------------- |
| Orchestrator ignores script delegation instructions | Medium     | High — unreliable state                        | Circuit breakers + state persistence + resume             |
| Turn budget exceeded for large pipelines            | Low        | Medium — pipeline stops mid-run                | maxTurns: 9999 + resume capability (OQ#8 resolved)        |
| Codex plugin not available/stable                   | Medium     | Low — fallback is fully functional             | Claude Code reviewer with review-protocol skill           |
| Ollama model quality insufficient                   | Medium     | Low — quality gates catch bad output           | Tier restrictions + unchanged quality gates               |
| Cross-boundary agent spawning doesn't work          | Low        | High — must copy all agents into plugin        | Test early; fallback: copy agent definitions              |
| Rate limit detection via headers unreliable         | Low        | Medium — reactive (429) instead of proactive   | Catch 429 errors as secondary detection                   |
| User modifies existing agent breaking pipeline      | Low        | Medium — parse-review or spec validation fails | Best-effort parsing with fallback patterns                |
| Worktree cleanup fails leaving orphans              | Medium     | Low — disk space waste                         | pipeline-cleanup + manual `git worktree prune`            |
| State file corruption from concurrent writes        | Low        | High — pipeline state lost                     | Atomic writes (tmp + mv) + lock for orchestrator          |
| EU AI Act compliance gaps in audit log              | Low        | High — legal exposure                          | Tamper-evident sequence numbers + log completeness checks |
