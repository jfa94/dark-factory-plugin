# Turn Budget Analysis

**Date:** 2026-04-12
**Plan:** 15-turn-budget-review (consolidated)
**Resolves:** 05-decisions.md Open Question #8

## Audit

### Data source

No production `audit.jsonl` data exists — the plugin has not run end-to-end yet. This analysis is purely structural, derived from `agents/pipeline-orchestrator.md` (361 lines) and cross-referenced with `bin/pipeline-circuit-breaker` (93 lines) and `03-components.md`.

### Spec discrepancy

`03-components.md:155` specifies `maxTurns: 200` for the orchestrator. The actual agent file (`agents/pipeline-orchestrator.md:3`) uses `maxTurns: 9999`. The 200-turn figure in Open Question #8 is based on the stale spec value. The operative limit is 9999 — effectively uncapped.

### Turn counting model

A "turn" is one orchestrator assistant message. Multiple tool calls in the same message count as one turn. **Subagent turns are independent** — each subagent runs in its own conversation context and its turns do not count against the parent orchestrator's budget ([Agent SDK: Subagents](https://code.claude.com/docs/en/agent-sdk/subagents)).

This means an `Agent()` call to spawn a task-executor (which may internally use 40-80 turns) costs the orchestrator exactly 2 turns: 1 to dispatch, 1 to process the returned result.

### Fixed overhead (per-run)

| Phase                           | Turns     | Lines   | Notes                                                |
| ------------------------------- | --------- | ------- | ---------------------------------------------------- |
| Startup                         | 1-2       | 26-28   | Read state + circuit breaker + optional resume-point |
| Spec S1 (fetch PRD)             | 1         | 35      | Single Bash call                                     |
| Spec S2 (spawn spec-generator)  | 2         | 36-45   | Agent dispatch + result                              |
| Spec S3 (resolve handoff)       | 2-3       | 47-70   | State reads + fetch + materialize + merge            |
| Spec S3b-S4 (commit + validate) | 1         | 72-80   | Batchable Bash calls                                 |
| Spec S5 (seed task state)       | 1-2       | 82-86   | N state writes, batchable                            |
| Spec S6 (human pause)           | 0-1       | 88      | Only if humanReviewLevel >= 3                        |
| Cleanup (summary + cleanup)     | 2         | 246-249 | Two Bash calls                                       |
| **Total fixed**                 | **10-14** |         |                                                      |

### Per-task turns (happy path)

| Step                | Turns  | Lines   | Notes                                                                                                                        |
| ------------------- | ------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Pre-flight       | 3      | 125-137 | Batch: circuit-breaker + deps + quota (1 turn), classify-task + classify-risk (1 turn), model-router + build-prompt (1 turn) |
| 2. Execute          | 1\*    | 139-153 | \*Amortized — 1 turn per batch of N concurrent Agent() calls                                                                 |
| 2b. Record result   | 1      | 142     | State write for worktree path                                                                                                |
| 3. Quality gate     | 1      | 155-162 | pipeline-quality-gate + pipeline-coverage-gate                                                                               |
| 4. Spawn reviewers  | 2      | 175-183 | Agent dispatch (N parallel) + process results                                                                                |
| 5. Parse verdicts   | 1      | 185-203 | Batch parse-review calls                                                                                                     |
| 6. Create PR & wait | 2      | 205-216 | Commit + create PR (1 turn), wait-pr + process (1 turn)                                                                      |
| 7. Finalize         | 1      | 218-220 | State write                                                                                                                  |
| **Total per task**  | **12** |         | Happy path, no retries                                                                                                       |

### Per-task turns by tier

The orchestrator does not vary its turn consumption by task tier. Tiers (simple/medium/complex/security) affect subagent configuration (`model` and `maxTurns` passed to task-executor) but the orchestrator's dispatch sequence is identical. Security tier adds reviewer spawns (lines 338-344) but those are additional Agent() calls in the same turn (+0 turns for dispatch, +0-1 for parsing additional verdicts).

| Tier     | Orchestrator turns | Subagent maxTurns | Notes                                 |
| -------- | ------------------ | ----------------- | ------------------------------------- |
| Simple   | 12                 | 40                | Same dispatch sequence                |
| Medium   | 12                 | 60                | Same dispatch sequence                |
| Complex  | 12                 | 80                | Same dispatch sequence                |
| Security | 12-13              | 80                | +1 for extra reviewer verdict parsing |

### Per-task turns with retries

| Retry type                  | Turns per retry | Max retries | Max additional turns | Lines   |
| --------------------------- | --------------- | ----------- | -------------------- | ------- |
| Quality gate                | 3               | 3           | 9                    | 164-173 |
| Review fix (back to step 2) | 5               | 3           | 15                   | 189-198 |
| CI fix                      | 3               | 2           | 6                    | 211-213 |
| Rate-limit wait             | 2               | unbounded   | unbounded            | 132-133 |

Global cap: 4 total attempts per task (line 297), bounding the combined retry cost.

- **Typical task (1 retry):** 12 + 5 = 17 turns
- **Worst case (4 attempts):** 12 + 3 × 8 = 36 turns (theoretical max with mixed retry types)

### Pipeline estimates

For a 20-task pipeline with circuit breaker defaults (maxTasks=20):

| Scenario                 | Formula                         | Total turns |
| ------------------------ | ------------------------------- | ----------- |
| Best case (no retries)   | 12 + 20 × 12 + 2 = 254          | 254         |
| Typical (20% retry rate) | 12 + 16 × 12 + 4 × 17 + 2 = 274 | 274         |
| Moderate friction        | 12 + 20 × 16 + 2 = 334          | 334         |
| Heavy retries            | 12 + 20 × 25 + 2 = 514          | 514         |

### Verdict on the 320-turn estimate

The Open Question #8 estimate of "~16 turns/task × 20 tasks = 320 turns" is **approximately right** for a moderate-friction scenario. The structural model gives 12-17 turns/task depending on retry rate, plus ~14 turns fixed overhead. The estimate was correct in magnitude but:

1. **The premise was wrong** — it assumed `maxTurns: 200`, which is a stale spec value. The operative limit is 9999.
2. **Subagent isolation was not accounted for** — the estimate may have conflated orchestrator turns with total system turns (including subagent turns).

## Structural turn consumers

### Catalogue

| #   | Consumer             | Lines            | Trigger                                                | Max iterations                   | Budget-aware? |
| --- | -------------------- | ---------------- | ------------------------------------------------------ | -------------------------------- | ------------- |
| 1   | Rate-limit wait loop | 132-133, 309-325 | `model-router` returns `action=wait`                   | Unbounded                        | No            |
| 2   | Quality gate retry   | 164-173          | Non-zero exit from quality-gate or coverage-gate       | 3                                | No            |
| 3   | Review fix loop      | 189-198          | `REQUEST_CHANGES` verdict with `declared_blockers > 0` | 3                                | No            |
| 4   | CI fix loop          | 211-213          | `pipeline-wait-pr` exit 3 (CI failure)                 | 2                                | No            |
| 5   | Group iteration      | 100-117          | Sequential group processing                            | N groups (from spec)             | No            |
| 6   | Batch iteration      | 109              | Tasks per group > maxConcurrent                        | ceil(group_size / maxConcurrent) | No            |
| 7   | Human review pause   | 252-263          | humanReviewLevel thresholds                            | N/A (pipeline stops)             | N/A           |
| 8   | Spec review retry    | 39               | Validation failure in spec-generator                   | 5                                | No\*          |

\*Spec review retries happen inside the spec-generator subagent and consume 0 orchestrator turns.

### Circuit breaker gap

`bin/pipeline-circuit-breaker` (lines 49-62) enforces three thresholds:

| Threshold              | Config key                | Default |
| ---------------------- | ------------------------- | ------- |
| maxTasks               | `.maxTasks`               | 20      |
| maxRuntimeMinutes      | `.maxRuntimeMinutes`      | 360     |
| maxConsecutiveFailures | `.maxConsecutiveFailures` | 3       |

**It does not cap turns.** There is no turn counter in state, no turn-related config key, and no turn check in the circuit breaker logic. The orchestrator's `maxTurns: 9999` is the only turn limit, enforced by the Claude Code runtime.

### Top 3 turn sinks

1. **Review fix loop** — 3 retries × 5 turns = 15 turns per task worst case. Triggered on complex/security tasks where reviewers find blockers. Expected contribution: highest because review failures are common on non-trivial code.

2. **Quality gate retry loop** — 3 retries × 3 turns = 9 turns per task worst case. Triggered when lint/typecheck/tests fail. Expected contribution: medium, as quality gates catch common issues.

3. **Rate-limit wait loop** — unbounded iterations × 2 turns each. Triggered by API quota exhaustion. Expected contribution: low frequency but high per-event cost. The only consumer with no iteration cap.

### Budget awareness

**None of the structural consumers are budget-aware.** No loop checks remaining turns before iterating. If the orchestrator approaches its `maxTurns` limit mid-retry-loop, it will be interrupted by the runtime with `error_max_turns` rather than gracefully winding down. The resume capability (Decision 7, lines 277-284) handles this case — the orchestrator can restart and pick up from the first incomplete task.

## Research and recommendation

### External sources

1. **Claude Agent SDK — Subagents** ([code.claude.com/docs/en/agent-sdk/subagents](https://code.claude.com/docs/en/agent-sdk/subagents)): Each subagent runs in its own fresh conversation. Subagent transcripts persist independently of the main conversation. When the main conversation compacts, subagent transcripts are unaffected. Subagents can be resumed with full history via session ID + agent ID.

2. **Claude Agent SDK — Agent Loop** ([platform.claude.com/docs/en/agent-sdk/agent-loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop)): `max_turns` counts tool-use turns only. When the limit is hit, the SDK returns a `ResultMessage` with `error_max_turns`. The parameter is optional — when omitted, there is no hard turn limit (runtime defaults apply).

3. **LangGraph checkpointing** ([latenode.com — LangGraph vs AutoGen vs CrewAI](https://latenode.com/blog/platform-comparisons-alternatives/automation-platform-comparisons/langgraph-vs-autogen-vs-crewai-complete-ai-agent-framework-comparison-architecture-analysis-2025)): LangGraph provides built-in checkpointing with time-travel for long-running workflows. State is persisted at graph nodes, enabling resume from any checkpoint. This is analogous to the dark-factory pipeline's `pipeline-state` + `resume-point` mechanism.

4. **AutoGen turn scaling** ([galileo.ai — Mastering Agents](https://galileo.ai/blog/mastering-agents-langgraph-vs-autogen-vs-crew)): AutoGen's conversational patterns scale poorly — N agents × M rounds = N×M LLM calls. Production deployments must set conversation turn limits. The dark-factory orchestrator avoids this by using a hub-and-spoke model (orchestrator dispatches, subagents don't converse with each other).

5. **Anthropic cost-capped orchestration** ([mindstudio.ai — AI Agent Token Budget Management](https://www.mindstudio.ai/blog/ai-agent-token-budget-management-claude-code)): Claude Code enforces hard token limits, automatically compacts conversation history, and runs pre-execution budget checks. The Advisor Strategy (Opus as adviser, Haiku/Sonnet as executors) reduces costs by ~12% while maintaining quality on complex tasks — a pattern the dark-factory orchestrator already implements via tiered model selection.

### Mitigation scoring

| Option                 | Impl cost | Turn impact                                                             | Regression risk                                       | New open questions                                      |
| ---------------------- | --------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| A: Phase orchestrators | Medium    | Splits ~334 into ~14 (spec) + ~320 (exec); fresh context for exec phase | Medium — state handoff between phases adds complexity | How to pass spec artifacts between orchestrator phases? |
| B: Raise maxTurns      | Done (0)  | Already 9999                                                            | None                                                  | None — already implemented                              |
| C: Batch operations    | Small     | Saves ~1-2 turns/task (~20-40 total)                                    | Low                                                   | Minimal                                                 |
| D: Cap at ~12 tasks    | None (0)  | Caps at ~158 turns                                                      | Medium — limits pipeline capability                   | Conflicts with maxTasks=20 circuit breaker default      |

**Option E (surfaced by research): Checkpoint-resume with turn tracking.** Add a turn counter to `pipeline-state` and check it in the circuit breaker. When turns approach a configurable threshold (e.g., 80% of maxTurns), the orchestrator gracefully winds down: marks the run as `partial`, records `resume_point`, and exits. A subsequent `/dark-factory:run resume` picks up where it left off with a fresh context window. This is analogous to LangGraph's checkpointing and is already partially implemented via Decision 7.

| E: Checkpoint-resume + turn tracking | Small | Graceful degradation at any turn count | Low — builds on existing resume infra | Turn counting accuracy (does the orchestrator know its own turn count?) |

### Recommendation

**Close Open Question #8 as resolved. No immediate code changes needed.**

Rationale:

1. The 200-turn concern was based on a stale spec value. The actual orchestrator uses `maxTurns: 9999`.
2. Subagent turns don't count against the parent. The orchestrator's per-task cost is ~12 turns regardless of subagent complexity.
3. The circuit breaker's `maxTasks: 20` is the effective pipeline size limit, not turn count.
4. A 20-task pipeline consumes ~254-334 orchestrator turns — well within the 9999 limit.
5. Context compaction in the orchestrator doesn't affect subagent transcripts.
6. The resume capability (Decision 7) handles `error_max_turns` interruptions.

**For future scaling beyond 20 tasks:** implement Option E (checkpoint-resume with turn tracking) as a lightweight enhancement. This adds graceful degradation without the complexity of phase orchestrators (Option A). Stub plan file: `remediation/plans/15-turn-budget-impl.md`.

**Immediate doc fix:** update `03-components.md:155` from `maxTurns: 200` to `maxTurns: 9999` to match the actual agent file.
