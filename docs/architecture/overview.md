# System Overview

The dark-factory plugin implements a 9-stage autonomous coding pipeline that converts GitHub PRD issues into merged pull requests. This document describes the pipeline stages, component relationships, and data flow.

## Pipeline Stages

```
Stage A: Input & Discovery
    │
    ▼
Stage B: Spec Generation
    │
    ▼
Stage C: Task Decomposition
    │
    ▼
Stage D: Task Execution ◄──────┐
    │                          │
    ▼                          │
Stage E: Quality Gates ────────┤ (retry on failure)
    │                          │
    ▼                          │
Stage F: Adversarial Review ───┘
    │
    ▼
Stage G: PR Creation & Dependency Resolution
    │
    ▼
Stage H: Completion
```

### Stage A: Input & Discovery

- Parse operating mode from `/factory:run` arguments
- Validate preconditions (git remote, required agents, skills)
- Fetch PRD body from GitHub issue via `pipeline-fetch-prd`

### Stage B: Spec Generation

- Spawn `spec-generator` agent in isolated worktree
- Generate `spec.md` and `tasks.json` using `prd-to-spec` skill
- Validate output via `pipeline-validate-spec`
- Review via `spec-reviewer` agent (score >= 54/60)
- Handoff spec to staging branch via commit

### Stage C: Task Decomposition

- Validate task schema via `pipeline-validate-tasks`
- Detect dependency cycles (DFS)
- Topological sort via Kahn's algorithm
- Assign parallel groups for concurrent execution

### Stage D: Task Execution

For each task in execution order:

1. Check circuit breaker thresholds
2. Verify dependencies are satisfied
3. Check API rate limits via `pipeline-quota-check`
4. Classify complexity via `pipeline-classify-task`
5. Classify risk tier via `pipeline-classify-risk`
6. Route to appropriate model via `pipeline-model-router`
7. Build prompt via `pipeline-build-prompt` (with holdout criteria)
8. Spawn `task-executor` agent in isolated worktree

### Stage E: Quality Gates

5-layer stack, sequential:

1. **Static Analysis**: Pre-commit hooks (lint, format, type-check)
2. **Test Suite**: Run via existing Stop hook
3. **Coverage Regression**: `pipeline-coverage-gate` blocks decreases
4. **Holdout Validation**: Verify withheld criteria are satisfied
5. **Mutation Testing**: Target 80% mutation score for feature/security tiers

### Stage F: Adversarial Review

- Detect reviewer via `pipeline-detect-reviewer` (Codex preferred, Claude Code fallback)
- Spawn `implementation-reviewer` agent with `review-protocol` skill
- Multi-round loop: REQUEST_CHANGES triggers fix and re-review
- Security tier adds `security-reviewer` and `architecture-reviewer`
- Parse verdicts via `pipeline-parse-review`

### Stage G: PR Creation & Dependency Resolution

- Create PR targeting `staging` branch
- Poll for merge via `pipeline-wait-pr`
- Handle CI failures with automated fix attempts
- Handle merge conflicts with rebase attempt

### Stage H: Completion

- Generate summary via `pipeline-summary`
- Spawn `scribe` (bundled) as enforced final step to update `/docs`
- Clean up branches, worktrees, spec directory via `pipeline-cleanup`
- Close GitHub issue (if all tasks merged)

---

## Component Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                        /factory:run                             │
│              (Command body = main-session orchestrator)         │
│                                                                 │
│  Runs in the invoking Claude Code session. Control loop,        │
│  DAG iteration, retry logic, human escalation all happen here.  │
│  Step 6a creates .claude/worktrees/orchestrator-<run_id>/       │
│  and cd's in, so the user's primary checkout stays untouched.   │
│                                                                 │
│  Delegates to bin/ scripts ────────┬──── Spawns subagents       │
└────────────────────────────────────┼────────────────────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         │                           │                           │
         ▼                           ▼                           ▼
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Bin Scripts   │      │     Agents      │      │     Hooks       │
│ (Deterministic) │      │(Non-deterministic)     │ (Un-bypassable) │
├─────────────────┤      ├─────────────────┤      ├─────────────────┤
│ pipeline-*      │      │ spec-generator  │      │ branch-protection│
│ (21 scripts)    │      │ task-executor   │      │ run-tracker     │
│                 │      │ implementation-reviewer   │      │ stop-gate       │
│ Validation      │      │ quality-reviewer   │      │ subagent-stop   │
│ State mgmt      │      │ security-       │      │                 │
│ Classification  │      │   reviewer      │      │                 │
│ Parsing         │      │ architecture-   │      │                 │
│ Prompt building │      │   reviewer      │      │                 │
└─────────────────┘      │ test-writer     │      └─────────────────┘
                         │ scribe          │
                         │ spec-reviewer   │
                         └─────────────────┘
```

### Three-Tier Reliability Model

| Tier            | Components       | Reliability                | Responsibility                                 |
| --------------- | ---------------- | -------------------------- | ---------------------------------------------- |
| **Hooks**       | `hooks.json`     | 100% enforcement           | Safety constraints that must never be violated |
| **Bin Scripts** | `bin/pipeline-*` | 100% given valid input     | Logic with a single correct answer             |
| **Agents**      | `agents/*.md`    | ~70% instruction following | Tasks requiring judgment, creativity, NLU      |

---

## Data Flow

### Run Initialization

```
/factory:run prd --issue 42
        │
        ▼
pipeline-validate
        │ (checks git, gh, agents, skills)
        ▼
pipeline-init run-20260413-140000 --issue 42 --mode prd
        │
        ▼
Creates: ${CLAUDE_PLUGIN_DATA}/runs/run-20260413-140000/
         ├── state.json
         ├── audit.jsonl
         └── holdouts/
```

### Spec Handoff (Cross-Worktree)

```
spec-generator (isolated worktree)
        │
        ├── Writes: spec.md, tasks.json
        ├── Commits to: spec-handoff/<run-id> branch
        └── Records via pipeline-state:
            .spec.handoff_branch
            .spec.handoff_ref
            .spec.path
        │
        ▼
orchestrator (in .claude/worktrees/orchestrator-<run_id>/)
        │
        ├── Reads handoff metadata from state.json
        ├── Fetches spec-handoff/<run-id> branch
        ├── Materializes spec at .state/<run-id>/
        └── Merges onto staging branch
```

### Task Execution Loop

```
For each parallel_group:
  For each task in group (up to maxConcurrent):
    │
    ├── pipeline-circuit-breaker
    ├── pipeline-state deps-satisfied
    ├── pipeline-quota-check
    ├── pipeline-classify-task
    ├── pipeline-classify-risk
    ├── pipeline-model-router
    ├── pipeline-build-prompt --holdout 20%
    │
    └── Spawn task-executor (worktree, concurrent)
            │
            ├── Implement code
            ├── Write tests
            ├── Commit changes
            │
            └── Return to orchestrator
                    │
                    ├── Quality gates
                    ├── Adversarial review
                    └── PR creation
```

### State Persistence

All state transitions flow through `pipeline-state` using atomic writes:

```
pipeline-state write <run-id> <key> <value>
        │
        ├── Write to temp file
        ├── fsync
        └── mv to target (atomic)
```

State is JSON, human-readable, and queryable with `jq`.

---

## Isolation Model

### Git Worktrees

Each `task-executor` agent runs in an isolated git worktree:

- Created from `staging` branch HEAD
- No conflicts between concurrent tasks
- Changes merge via PR, not local git merge
- Worktrees cleaned up after PR merge

### Plugin Data Directory

Pipeline state lives outside the git repository:

```
${CLAUDE_PLUGIN_DATA}/
├── config.json           # User configuration
├── usage-cache.json      # Rate limit data from statusline wrapper
├── metrics.jsonl         # JSONL metrics log (MCP server)
└── runs/
    ├── current -> run-.../ # Symlink to active run
    └── run-YYYYMMDD-HHMMSS/
        ├── state.json
        ├── audit.jsonl
        ├── holdouts/
        └── reviews/
```

### Holdout Criteria Isolation

Acceptance criteria withheld from task-executor are stored in `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/holdouts/<task-id>.json`. Since task-executor runs in a worktree and holdouts live in plugin data, the executor cannot access criteria it was not meant to see.
