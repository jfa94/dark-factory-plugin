# Dark Factory Plugin — PRD: Problem, Goals & Feature List

## Problem Statement

The [dark-factory](https://github.com/jfa94/dark-factory) autonomous coding pipeline (~3,700 lines, 17 Bash modules) converts GitHub PRD issues into merged pull requests with minimal human intervention. It works, but suffers from fundamental limitations inherent to a shell-based architecture:

**Shell fragility** — Bash lacks structured error handling, type safety, and composability. State management is ad-hoc (JSON files manipulated with `jq`), parallelism is limited to background processes with PID tracking, and recovery from partial failures requires manual intervention.

**No native Claude Code integration** — the pipeline invokes Claude Code as an external subprocess, losing access to the agent framework's native capabilities: worktree isolation, background agent execution, subagent spawning, skill injection, hook-based safety enforcement, and MCP server integration.

**Limited quality assurance** — the current pipeline has a single code review pass. Research evidence shows this is insufficient:

- AI-generated tests achieve 85-95% line coverage but only 30-40% mutation scores (tautological tests that assert what was written, not what should work)
- Veracode: AI code has 2.74x more vulnerabilities than human-written code
- LinearB: 67.3% of AI-generated PRs rejected vs 15.6% for human code
- DORA 2025: 90% AI adoption correlates with 154% PR size increase, 91% more review time, 9% bug rate climb

**No adversarial review** — the pipeline uses a single reviewer pass. Actor-Critic adversarial review (3-5 rounds) eliminates 90%+ issues at ~$0.20-$1.00/feature vs $50-$100/hr human review (Autonoma: 73% more issues caught, 71% fewer bugs, 42% less review time).

**Opportunity:** Claude Code's plugin system provides native primitives (agents, hooks, bin scripts, skills, commands, MCP servers) that map directly to pipeline concerns. A plugin re-implementation gains worktree isolation, background execution, un-bypassable hooks, skill injection, and persistent state — while maintaining the deterministic-first architecture that makes the Bash pipeline reliable.

---

## Goals

1. **Minimal-intervention PRD execution** — convert a PRD issue to merged PRs with a single command. Human touchpoints are explicit and by design:

   **One-time setup (per project):**
   - Install the plugin from the marketplace
   - Run `/factory:configure` to set project-specific thresholds (maxParallelTasks, review.featureRounds, quality.mutationScoreTarget, etc.)
   - Create a GitHub label `prd` for PRD issues (or use file-based PRDs)

   **Per run:**
   - Create a GitHub issue labeled `prd` describing the work
   - Run `/factory:run <issue_number>` (or omit the number to use the most-recently-updated prd-labeled issue)

   **During the run (intervention points):**
   - Tasks escalated to `needs_human_review` require human approval — these happen when:
     - Quality gates fail 3 times in a row on the same task
     - Code review verdicts return REQUEST_CHANGES 3 times in a row
     - Circuit breaker trips (runtime, cost, or failure caps exceeded)
     - A reviewer returns NEEDS_DISCUSSION
   - PRs that pass all automated checks merge without human action unless the project's GitHub branch protection rules require a human approver

   **Not autonomous by design:**
   - Merging PRs into `main` — the plugin merges into `staging`. A human (or separate release automation) promotes `staging` → `main`
   - Deleting branches on `main` or `master` — blocked by hooks
   - Modifying `.env*`, migrations, secrets — blocked by hooks

   Goal #1 is satisfied when a labeled PRD issue can be completed by running a single command and approving escalated tasks along the way.

2. **Deterministic-first architecture** — ~3:1 ratio of deterministic components (bin scripts, hooks) to non-deterministic (agents). Agent instructions are followed ~70%; hooks/scripts enforce at 100%. Concrete operational rules outperform abstract directives by 123%.
3. **Quality-first additions** from research:
   - 5-layer quality gate stack (static analysis → tests → coverage regression → holdout validation → mutation testing)
   - Adversarial code review (Actor-Critic, multi-round, Codex-first with Claude Code fallback)
   - Risk-based task classification (routine/feature/security → tiered review intensity)
   - Holdout validation (StrongDM Attractor pattern)
4. **All agents bundled** — all pipeline agents ship inside the plugin. No user agent setup required. Leverage existing hooks (pre-commit, pre-push, dangerous-patterns, etc.) that fire automatically.
5. **Observability and compliance** — tamper-evident audit logs, delegation chains, metrics (EU AI Act Aug 2026 readiness)
6. **Resume capability** — pipeline recovers from interruptions by reading persisted state

---

## Non-Goals

- **Not a general-purpose CI/CD system** — this is specifically an autonomous coding pipeline for converting PRD issues to merged PRs
- **Not replacing human architectural decisions** — the pipeline implements tasks from human-authored PRDs; it does not decide what to build
- **Not supporting non-GitHub platforms** — GitHub issues and PRs are the only supported input/output initially
- **Not a real-time system** — pipeline runs are batch operations; there is no streaming or event-driven architecture requirement

---

## User Personas

### Solo Developer (primary)

Runs the pipeline autonomously on personal projects. Wants to convert a PRD issue into a merged PR overnight. Values: speed, minimal supervision, cost efficiency.

### Team Lead

Configures the pipeline for team repositories. Sets human review levels (e.g., Level 1: PR approval required). Wants observability into what the pipeline did and why. Values: audit trails, configurable quality gates, team-safe defaults.

### Security-Conscious Developer

Works on repositories with auth, payment, or PII handling. Needs security-tier review (5 adversarial rounds + security-reviewer + architecture-reviewer). Wants tamper-evident logs for compliance. Values: defense in depth, zero silent failures.

---

## Feature Parity Summary

The plugin reimplements the bash pipeline with substantial enhancements. Of 71 features across 10 stages:

| Classification | Count | Description                                                     |
| -------------- | ----- | --------------------------------------------------------------- |
| Preserved      | 26    | Same behavior as bash pipeline                                  |
| Enhanced       | 15    | Same behavior + new capabilities                                |
| Rewritten      | 2     | Reimplemented with different mechanism                          |
| New            | 27    | No bash equivalent                                              |
| Deprecated     | 1     | Directory locking — replaced by worktree isolation (Decision 8) |

| Stage                     | Preserved | Enhanced | Rewritten | New | Deprecated |
| ------------------------- | --------- | -------- | --------- | --- | ---------- |
| A: Input & Discovery      | 4         | 1        | —         | —   | —          |
| B: Spec Generation        | 2         | 3        | —         | 2   | —          |
| C: Task Decomposition     | 4         | 1        | —         | —   | —          |
| D: Task Execution         | 3         | 3        | —         | 5   | —          |
| E: Quality Gates          | 2         | —        | —         | 4   | —          |
| F: Code Review            | —         | —        | 1         | 7   | —          |
| G: Dependency Resolution  | 3         | —        | —         | —   | —          |
| H: Completion             | 3         | 1        | —         | 3   | —          |
| I: Safety & Observability | 3         | 3        | 1         | 3   | 1          |
| J: Configuration          | 2         | 3        | —         | 3   | —          |

The deterministic-first ratio is 3.5:1 (21 bin scripts + 4 hooks vs 6 agents), exceeding the 3:1 target.

---

## Complete Feature Inventory

### Stage A: Input & Discovery

| Feature                 | Existing Behavior (Bash)                              | Plugin Primitive                                                | Enhancements                                                 |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------ |
| **Issue number intake** | CLI accepts issue numbers as arguments                | `/factory:run` command parses arguments                         | Same behavior, native slash command UX                       |
| **PRD tag detection**   | Searches for `[PRD]`-tagged open issues               | `pipeline-orchestrator` agent queries GitHub API via `gh`       | Same behavior                                                |
| **Multi-PRD batching**  | `multi-prd.sh` processes multiple issues sequentially | Orchestrator iterates issues, can parallelize independent specs | Parallel spec generation for independent PRDs                |
| **Issue body fetching** | `spec-gen.sh` calls `gh issue view`                   | `bin/pipeline-fetch-prd` script                                 | Deterministic, testable, same `gh` interface                 |
| **Input validation**    | `validator.sh` checks git remote, branch state        | `bin/pipeline-validate` script                                  | Adds plugin-specific checks (agents exist, skills available) |

### Stage B: Spec Generation

| Feature                    | Existing Behavior (Bash)                            | Plugin Primitive                                                                    | Enhancements                                                                                          |
| -------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **PRD → spec conversion**  | `spec-gen.sh` invokes Claude with prd-to-spec skill | `spec-generator` agent (opus, 40 turns, worktree) with `prd-to-spec` skill injected | Native skill injection; worktree isolation                                                            |
| **Autonomous mode**        | Skips interactive prompts                           | Skill step 5 (quiz user) skipped via agent instructions                             | Same behavior                                                                                         |
| **Spec output validation** | Basic file existence checks                         | `bin/pipeline-validate-spec` script                                                 | Structured validation (file exists, non-empty, valid format)                                          |
| **Spec review loop**       | Calls spec-reviewer, retries up to 5x               | Spawns bundled `spec-reviewer` agent (score ≥54/60, PASS/NEEDS_REVISION)            | Increased turns (40), threshold (90%), and retries (5)                                                |
| **tasks.json generation**  | Part of prd-to-spec output                          | Same — embedded in prd-to-spec skill                                                | Same behavior                                                                                         |
| **Transient error retry**  | Not in Bash pipeline                                | spec-generator agent retries on 500/502/503/529                                     | NEW: up to 3 attempts with exponential backoff (15s × attempt); separate from review iteration budget |
| **Spec failure reporting** | Not in Bash pipeline                                | `bin/pipeline-gh-comment` posts to GitHub issue                                     | NEW: on spec failure, post comment + add `needs-manual-spec` label to issue                           |

### Stage C: Task Decomposition

| Feature                    | Existing Behavior (Bash)                   | Plugin Primitive                                                | Enhancements                                                                                             |
| -------------------------- | ------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Field validation**       | `task-validator.sh` checks required fields | `bin/pipeline-validate-tasks` script                            | Same checks: task_id, title, description, files (max 3), acceptance_criteria, tests_to_write, depends_on |
| **Cycle detection**        | Detects circular dependencies              | `bin/pipeline-validate-tasks` script                            | Same algorithm                                                                                           |
| **Dangling dep detection** | Finds references to non-existent tasks     | `bin/pipeline-validate-tasks` script                            | Same check                                                                                               |
| **Topological sort**       | Kahn's algorithm for execution order       | `bin/pipeline-validate-tasks` script                            | Same algorithm, outputs JSON execution order                                                             |
| **Execution order output** | Flat list of tasks in dependency order     | Script stdout: `[{"task_id":"task_1","parallel_group":0}, ...]` | Adds parallel group info for concurrent execution                                                        |

### Stage D: Task Execution

| Feature                       | Existing Behavior (Bash)                  | Plugin Primitive                                             | Enhancements                                                                                                                                                                                                     |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Feature branch creation**   | `repository.sh` creates branches          | `bin/pipeline-branch` script                                 | Branches from `staging` (auto-created from develop/main if absent); same naming conventions; worktree-aware                                                                                                      |
| **Complexity classification** | `task-runner.sh` classifies by file count | `bin/pipeline-classify-task` script                          | Same heuristic: file count + dep count → haiku (simple, 40 turns) / sonnet (medium, 60 turns) / opus (complex, 80 turns)                                                                                         |
| **Risk classification**       | Not in Bash pipeline                      | `bin/pipeline-classify-risk` script                          | NEW: file-path heuristics → routine/feature/security tier. Auth/security/migration paths → security tier                                                                                                         |
| **Code generation**           | Claude subprocess in feature branch       | `task-executor` agent (worktree-isolated, background)        | Native worktree isolation, background execution, model/turns from classify-task                                                                                                                                  |
| **Test writing**              | Part of task execution                    | `task-executor` agent instructions                           | Adds property-based testing instructions (PGS framework: 15.7% improvement)                                                                                                                                      |
| **Auto-fix loop**             | Retry on test failure (max 3)             | `task-executor` retries internally                           | Same behavior                                                                                                                                                                                                    |
| **Parallel execution**        | Limited (background PIDs)                 | Background agents + worktrees, max 3 concurrent              | True parallel isolation via git worktrees                                                                                                                                                                        |
| **Prompt construction**       | `task-runner.sh` builds prompt            | `bin/pipeline-build-prompt` script                           | Adds `--holdout N%` flag to withhold acceptance criteria                                                                                                                                                         |
| **Failure-specific retry**    | Generic retry on failure                  | `task-executor` reads `TASK_FAILURE_TYPE` env var            | NEW: typed retries — `max_turns` (preserve partial work), `quality_gate` (include QG output), `agent_error` (non-zero exit), `no_changes` (no diff), `code_review` (include prior findings); max 4 total retries |
| **Prior work injection**      | Not in Bash pipeline                      | `bin/pipeline-build-prompt` detects commits ahead of staging | NEW: on resume, appends "Prior Work" section with existing commits to retry prompt; prevents duplicate effort                                                                                                    |
| **Auto-fix pipeline**         | Not in Bash pipeline                      | Runs `pnpm format` then `pnpm lint:fix` post-execution       | NEW: non-fatal — failures logged but don't block or trigger retries; only commits tracked files (`git add -u`)                                                                                                   |

### Stage E: Quality Gates

| Feature                          | Existing Behavior (Bash)                    | Plugin Primitive                                                         | Enhancements                                                                                                                                      |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer 1: Static analysis**     | Pre-commit hooks (lint, format, type check) | Existing user hooks fire automatically                                   | No change needed — hooks are un-bypassable                                                                                                        |
| **Layer 2: Test suite**          | Runs test suite                             | Existing Stop hook runs vitest                                           | No change needed                                                                                                                                  |
| **Layer 3: Coverage regression** | Not in Bash pipeline                        | `bin/pipeline-coverage-gate` script                                      | NEW: compare before/after coverage, must not decrease. Evidence: agents delete failing tests to improve metrics; coverage regression catches this |
| **Layer 4: Holdout validation**  | Not in Bash pipeline                        | `bin/pipeline-build-prompt --holdout 20%` + holdout-validator evaluation | NEW: withhold 20% of acceptance criteria, verify task still satisfies them. StrongDM Attractor: 6-7K NLSpec → 32K+ production code                |
| **Layer 5: Mutation testing**    | Not in Bash pipeline                        | `test-writer` agent (bundled) kills surviving mutants                    | NEW: target >80% mutation score. AI code has 15-25% higher mutation survival rates                                                                |
| **Anti-pattern detection**       | Not in Bash pipeline                        | `task-reviewer` instructions + existing hooks                            | NEW: hallucinated APIs, over-abstraction, copy-paste drift, dead code, excessive I/O, sycophantic generation                                      |

### Stage F: Code Review

| Feature                   | Existing Behavior (Bash)                        | Plugin Primitive                                              | Enhancements                                                                                                               |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Single review pass**    | `code-review.sh` runs one Claude review session | `task-reviewer` agent OR Codex adversarial review             | Upgraded to multi-round adversarial review                                                                                 |
| **Adversarial review**    | Not in Bash pipeline                            | `review-protocol` skill (Actor-Critic methodology)            | NEW: Critic reviews cold (zero implementation context), treats code as hostile artifact                                    |
| **Multi-round loop**      | Not in Bash pipeline                            | Orchestrator manages round loop (max configurable, default 3) | NEW: reviewer finds issues → executor fixes → re-review. Exit early on APPROVE.                                            |
| **Codex-first detection** | Not in Bash pipeline                            | `bin/pipeline-detect-reviewer` script                         | NEW: check Codex installed + authenticated → use `/codex:adversarial-review`; fallback to Claude Code                      |
| **Structured verdicts**   | Human-readable review output                    | `bin/pipeline-parse-review` normalizes to JSON                | NEW: `{"verdict":"APPROVE\|REQUEST_CHANGES\|NEEDS_DISCUSSION","findings":[...],"round":N}`                                 |
| **Risk-tiered intensity** | Same review for all tasks                       | Orchestrator selects rounds by risk tier                      | NEW: routine=2 rounds, feature=4 rounds, security=6 rounds + security-reviewer (bundled) + architecture-reviewer (bundled) |
| **Human escalation**      | Not in Bash pipeline                            | After max rounds with REQUEST_CHANGES → pause for human       | NEW: prevents infinite review loops                                                                                        |

### Stage G: Dependency Resolution

| Feature                     | Existing Behavior (Bash)             | Plugin Primitive                       | Enhancements                                                                   |
| --------------------------- | ------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------ |
| **PR merge polling**        | `orchestrator.sh` polls `gh pr view` | `bin/pipeline-wait-pr` script          | Same behavior, configurable timeout (default 45min) and interval (default 60s) |
| **Timeout handling**        | Fails after timeout                  | Script returns exit code 1             | Same behavior                                                                  |
| **Dependency satisfaction** | Checks task deps before execution    | `bin/pipeline-state` checks dep status | Same behavior, richer state tracking                                           |

### Stage H: Completion

| Feature                     | Existing Behavior (Bash)             | Plugin Primitive                                     | Enhancements                                                                                    |
| --------------------------- | ------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Issue closing**           | `completion.sh` closes GitHub issues | `bin/pipeline-cleanup --close-issues`                | Same `gh` interface                                                                             |
| **Branch cleanup**          | Deletes feature branches             | `bin/pipeline-cleanup --delete-branches`             | Only deletes branches for merged PRs; unmerged PR branches retained with warning in summary     |
| **Execution summary**       | Prints summary to stdout             | `bin/pipeline-summary` script                        | Richer output: per-task status, quality gate results, model usage, cost                         |
| **Docs update**             | `docs-update.sh` runs scribe         | Spawns bundled `scribe` agent as enforced final step | Bundled — no user setup required; runs before pipeline-cleanup                                  |
| **Spec dir cleanup**        | Not in Bash pipeline                 | `bin/pipeline-cleanup --clean-spec`                  | NEW: `git rm` spec directory after all tasks for the issue are merged; keeps repo history clean |
| **Partial failure summary** | Not in Bash pipeline                 | `bin/pipeline-summary` + `bin/pipeline-gh-comment`   | NEW: posts per-task breakdown to issue on partial runs; deduplicates comments on resume/retry   |
| **PR URL restoration**      | Not in Bash pipeline                 | `pipeline-state` preserves PR URLs                   | NEW: on resume, restores existing PR URLs to task state; prevents duplicate PR creation         |

### Stage I: Safety & Observability

| Feature                   | Existing Behavior (Bash)                   | Plugin Primitive                                                   | Enhancements                                                                                                  |
| ------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **Circuit breakers**      | 20 tasks / 360min / 3 consecutive failures | `bin/pipeline-circuit-breaker` script                              | Same thresholds, configurable via userConfig                                                                  |
| **Directory locking**     | SHA256 lock file (`lock.sh`)               | ELIMINATED — worktree isolation                                    | Better: true isolation vs mutual exclusion                                                                    |
| **5h usage pacing**       | 90% cap, polling                           | `bin/pipeline-quota-check` script                                  | Reads `unified-5h-utilization` header; hourly thresholds 20/40/60/80/90%; wait for window reset when exceeded |
| **7d budget enforcement** | Not in Bash pipeline                       | `bin/pipeline-quota-check` script                                  | NEW: reads `unified-7d-utilization` header; daily thresholds 14.2–95%; graceful exit when exceeded            |
| **Resume capability**     | Reads state files on restart               | `pipeline-state` + orchestrator `--resume` flag                    | Same pattern, richer state schema                                                                             |
| **Git safety**            | Branch protection checks                   | `branch-protection` hook (PreToolUse)                              | Un-bypassable hook vs agent instruction                                                                       |
| **Audit logging**         | Not in Bash pipeline                       | `run-tracker` hook (PostToolUse)                                   | NEW: every tool use logged to `audit.jsonl`. EU AI Act compliance.                                            |
| **Metrics collection**    | Not in Bash pipeline                       | `pipeline-metrics` MCP server                                      | NEW: token counts, durations, model usage, quality gate results, cost                                         |
| **Run state consistency** | Basic state checks                         | `stop-gate` hook (Stop) + `subagent-stop-gate` hook (SubagentStop) | NEW: validates state on session end, marks interrupted runs                                                   |

### Stage J: Configuration

| Feature                         | Existing Behavior (Bash)    | Plugin Primitive                               | Enhancements                                                                                                                                                                                                                                                              |
| ------------------------------- | --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pipeline settings**           | `settings.sh` + config file | `plugin.json` userConfig schema                | Native Claude Code configuration                                                                                                                                                                                                                                          |
| **Permission defaults**         | Manual setup                | `settings.json` in plugin                      | Automatic permission grants for plugin tools                                                                                                                                                                                                                              |
| **Plugin manifest**             | `config-deployer.sh`        | `.claude-plugin/plugin.json`                   | Native plugin metadata                                                                                                                                                                                                                                                    |
| **Interactive settings editor** | Not in Bash pipeline        | `/factory:configure` command (agent-based)     | NEW: review + update all userConfig settings conversationally                                                                                                                                                                                                             |
| **Autonomous settings**         | Not in Bash pipeline        | `templates/settings.autonomous.json` (bundled) | NEW: `Bash(*)` + safety hooks + deny-list; ported from dark-factory project file (stripped `enabledPlugins`/`effortLevel` for safe merge with user settings); detected via `FACTORY_AUTONOMOUS_MODE` env var; `/factory:run` prompts relaunch with `--settings` if absent |
| **Config deployment**           | `config-deployer.sh`        | `bin/pipeline-init --deploy-config`            | Deploys `.github/workflows/quality-gate.yml`, `.gitignore` entries, `package.json` scripts; idempotent                                                                                                                                                                    |
| **Project scaffolding**         | `project-init.sh`           | `bin/pipeline-init --scaffold`                 | Creates `claude-progress.json`, `feature-status.json`, `init.sh`; only on first run when files absent                                                                                                                                                                     |
| **GitIgnore management**        | Manual                      | `bin/pipeline-init --gitignore`                | Ensures plugin state dirs (`${PLUGIN_DATA}/*`) and lock files are in `.gitignore`                                                                                                                                                                                         |

---

## Autonomy Spectrum

The plugin supports operating modes from least to most autonomous. Controlled by `userConfig.humanReviewLevel`:

### Level 4: Full Supervision

Human approves at every stage: spec, task decomposition, each task execution, each review round, PR creation.
**Use case:** First run on a new codebase, learning the pipeline's behavior.

### Level 3: Spec Approval

Pipeline pauses after spec generation for human review. Once approved, executes autonomously through PR creation.
**Use case:** Team repos where architecture decisions need human sign-off.

### Level 2: Review Checkpoint

Pipeline runs through spec + execution autonomously. Pauses after adversarial code review for human sign-off before PR.
**Use case:** Solo dev who trusts spec generation but wants to review code.

### Level 1: PR Approval (default)

Pipeline runs end-to-end autonomously, creates PR. Human reviews and merges.
**Use case:** Standard autonomous workflow — overnight PR generation.

### Level 0: Full Autonomy

Pipeline creates PR, enables auto-merge. Human reviews merged code post-hoc.
**Use case:** Low-risk routine tasks, trusted codebase with strong test coverage.

### Single-Task Mode

Execute one task from an existing spec. Useful for retrying a failed task or running a specific task manually.
**Invocation:** `/factory:run --task <task_id> --spec <spec-dir>`

### Spec-to-PR Mode

Generate spec from PRD → execute all tasks → create single PR. No issue discovery or multi-PRD batching.
**Invocation:** `/factory:run --prd <issue-number>`

### Full Dark Factory Mode

Discover `[PRD]`-tagged issues → generate specs → execute → review → merge → close issues. The original autonomous pipeline.
**Invocation:** `/factory:run --discover`
