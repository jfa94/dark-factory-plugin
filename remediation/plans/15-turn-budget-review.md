# Plan 15 — Turn Budget Review

**Priority:** P2 (analysis — unblocks an architectural decision, ships no code)
**Tasks:** `task_15_01` through `task_15_03`
**Findings:** 05-decisions.md Open Question #8, continuation of plan 12 findings

## Problem

`05-decisions.md` Open Question #8 asks whether the default 200-turn budget
is sufficient for a 20-task pipeline. The doc itself answers the question on
paper — "~16 turns/task × 20 tasks = 320 turns. Exceeds budget." — and lists
four mitigation options, but **no option is chosen and no measurement has been
taken against a real run.** That leaves a production-blocking unknown.

The orchestrator (Plan 12 research confirmed) intentionally avoids
`run_in_background: true` — it dispatches N `Agent()` calls in a single
assistant message and waits for all N returns in the same turn. That design
is correct for current Claude Code limitations (bugs #17147, #21048, #20679,
#7881 around background agents), but it means a single orchestrator session
must carry every task through spec → execute → quality-gate → review → PR →
finalize. The 200-turn ceiling therefore bounds how many tasks fit in one run.

Before we act on Option B or C from the plan 12 research (background-agent +
hook-driven state polling / webhook), we need empirical data on:

1. How many turns the current orchestrator actually consumes per task
2. Where the budget leaks (review retry loops, quality-gate retries, context
   reloads, per-task overhead vs per-group overhead)
3. Which of the four mitigations in Open Question #8 is the best fit for this
   codebase, and what it would cost to implement

## Scope

In:

- Instrument or retroactively reconstruct turn accounting from `audit.jsonl`
- Produce a quantitative breakdown by phase (spec, execute, review, finalize)
  and by task tier (simple / medium / complex / security)
- Enumerate the structural limits in `agents/pipeline-orchestrator.md` that
  consume turns (loops, retries, context reloads, preflight checks)
- Research and document industry/community patterns for multi-agent turn
  budget management — including how other Claude Code plugins handle
  long-running pipelines
- Propose a ranked shortlist of mitigations with cost/benefit and a
  recommendation

Out:

- Implementing any mitigation (that becomes its own plan once a decision is
  made)
- Re-opening the background-agent path — plan 12 research already showed that
  is blocked on upstream Claude Code bugs
- Rewriting the orchestrator

## Tasks

| task_id    | Title                                              |
| ---------- | -------------------------------------------------- |
| task_15_01 | Audit current turn consumption per phase and tier  |
| task_15_02 | Enumerate orchestrator structural turn consumers   |
| task_15_03 | Research best practices and recommend a mitigation |

## Execution Guidance

### task_15_01 — Audit current turn consumption

**Inputs:**

- `agents/pipeline-orchestrator.md` — current dispatch loop
- `bin/pipeline-state` — audit/metrics log format
- Any historical `audit.jsonl` files under `$CLAUDE_PLUGIN_DATA/runs/` from
  prior runs (if available)
- Plan 12 integration test fixtures — useful as a controlled source of truth

**Approach:**

1. Read the orchestrator end-to-end and build a model of the turn budget.
   For every loop, retry, and per-task action, count the minimum and maximum
   turns it can consume. Cite line numbers.
2. If real-run `audit.jsonl` data exists, parse it and reconstruct turn
   consumption. If not, document the absence and fall back to the structural
   model from step 1.
3. Produce a breakdown table:

   | Phase    | Min turns | Max turns | Variance driver           |
   | -------- | --------- | --------- | ------------------------- |
   | Spec     |           |           | spec review rounds        |
   | Execute  |           |           | task tier, parallel group |
   | Quality  |           |           | gate retries              |
   | Review   |           |           | reviewer verdict rounds   |
   | Finalize |           |           | PR wait + merge           |

4. Re-derive the 20-task / 320-turn estimate from Open Question #8 using real
   numbers from the audit. State whether the estimate was high, low, or right.

**Output:** A new file `remediation/analysis/15-turn-budget.md` containing
the table, the derivation, and the raw audit data (if any).

### task_15_02 — Enumerate structural turn consumers

**Approach:**

1. Read `agents/pipeline-orchestrator.md` and catalogue every place where a
   loop, retry, or conditional can add turns. For each entry note:
   - Line range
   - Trigger condition
   - Max possible iterations
   - Whether the iterations are budget-aware (i.e. does the orchestrator
     shorten its behavior as the budget tightens?)
2. Cross-reference with `bin/pipeline-circuit-breaker` — the circuit breaker
   caps runtime and failures, not turns. Does it need a turn-count cap?
3. Identify the top three turn sinks by expected contribution (highest max ×
   likeliest trigger rate).

**Output:** A section in `remediation/analysis/15-turn-budget.md` titled
"Structural turn consumers" with the catalogue and the ranked top three.

### task_15_03 — Research and recommend

**Approach:**

1. Research best practices for long-running multi-agent pipelines under a
   turn/message budget. Sources to check:
   - Official Claude Code and Claude Agent SDK docs
   - The `plugins-dev` skill family in this repo's plugin cache
   - Public Claude Code plugin repositories that run long pipelines
   - Anthropic engineering blog posts on cost-capped agent orchestration
2. For each of the four mitigation options in Open Question #8 — **phase
   orchestrators, raise maxTurns, batch operations, cap tasks per session** —
   score on:
   - Implementation cost (S/M/L)
   - Impact on the 320-turn estimate (quantitative)
   - Risk of regressing existing behavior
   - Whether it creates a new open question
3. Add a fifth option if research surfaces one (for example: a persistent
   orchestrator that hands off via state.json at turn N-20 and resumes via
   `resume-point`).
4. Recommend a single mitigation with a one-page rationale. The recommendation
   must either:
   - Justify that the current budget is fine (with the supporting data from
     task_15_01), or
   - Name the next plan's scope (file to create, tasks to add)

**Output:** A section titled "Research and recommendation" in
`remediation/analysis/15-turn-budget.md` closing with an explicit
"Recommendation:" line and, if the recommendation implies new code, a stub
`remediation/plans/16-...` entry in `remediation/README.md`'s plan list.

## Verification

1. `remediation/analysis/15-turn-budget.md` exists and contains three sections:
   "Audit", "Structural turn consumers", "Research and recommendation"
2. The audit table has concrete numbers in every cell (no "TBD")
3. The structural catalogue cites line numbers in `agents/pipeline-orchestrator.md`
4. The recommendation line is present and unambiguous
5. `05-decisions.md` Open Question #8 is updated with a pointer to this analysis
   (the task_14_02 docs-honesty work will formally move it out of "Open", but
   this task provides the resolution material)
6. No production code is modified — the plan ships docs only
