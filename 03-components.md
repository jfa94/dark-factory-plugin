# Dark Factory Plugin — Component Inventory & File Tree

## Plugin File Tree

```
dark-factory-plugin/
├── .claude-plugin/
│   └── plugin.json                    # Manifest: name, version, description, userConfig schema
│
├── commands/
│   ├── run.md                         # /factory:run entry point
│   └── configure.md                   # /factory:configure — review/edit all plugin settings
│
├── agents/
│   ├── pipeline-orchestrator.md       # DAG iteration, subagent spawning, retry logic
│   ├── spec-generator.md              # PRD → spec + tasks.json via prd-to-spec skill
│   ├── task-executor.md               # Code generation + test writing in worktree
│   └── task-reviewer.md               # Fresh-context adversarial review w/ structured verdicts
│
├── skills/
│   └── review-protocol/
│       └── SKILL.md                   # Actor-Critic adversarial review methodology
│
├── hooks/
│   └── hooks.json                     # 4 hooks: branch-protection, run-tracker, stop-gate, subagent-stop-gate
│
├── bin/
│   ├── pipeline-lib.sh                # Shared functions (logging, slugify, temp files, config read)
│   ├── pipeline-validate              # Project precondition checks
│   ├── pipeline-fetch-prd             # Fetch PRD body from GitHub issue
│   ├── pipeline-validate-spec         # Validate spec output files
│   ├── pipeline-validate-tasks        # Field validation, cycle detection, topological sort
│   ├── pipeline-init                  # Create run state tracking files
│   ├── pipeline-branch                # Branch creation, worktree-aware operations
│   ├── pipeline-classify-task         # Complexity classification → model/turns config
│   ├── pipeline-classify-risk         # File-path heuristics → risk tier
│   ├── pipeline-build-prompt          # Template task metadata into structured prompt
│   ├── pipeline-circuit-breaker       # Check max runtime + consecutive failures thresholds
│   ├── pipeline-state                 # Read/write task status, dep satisfaction
│   ├── pipeline-wait-pr               # Poll gh pr view until merged
│   ├── pipeline-detect-reviewer       # Check Codex availability, return reviewer config
│   ├── pipeline-parse-review          # Extract structured verdict from reviewer output
│   ├── pipeline-model-router          # Rate limit check → proceed / wait / end_gracefully routing
│   ├── pipeline-quota-check           # API rate limit monitoring + exponential backoff
│   ├── pipeline-coverage-gate         # Compare coverage before/after, block if decreased
│   ├── pipeline-gh-comment            # Post comments + labels to GitHub issues
│   ├── pipeline-scaffold              # Create claude-progress.json, feature-status.json, init.sh
│   ├── pipeline-summary               # Aggregate run results into execution summary
│   ├── pipeline-cleanup               # Delete branches, close issues, restore worktree
│   └── pipeline-lock                  # Acquire/recover/release directory lock
│
├── .mcp.json                          # MCP server config for pipeline-metrics
├── servers/
│   └── pipeline-metrics/              # Metrics MCP server (token counts, durations, costs)
│       ├── package.json
│       └── index.js
│
├── settings.json                      # Default permission grants for plugin tools
│
└── templates/
    └── settings.autonomous.json           # Bundled autonomous settings (exact copy of ~/Projects/dark-factory/templates/settings.autonomous.json)
```

---

## Commands

### `/factory:run`

**File:** `commands/run.md`

**Purpose:** Single entry point for all pipeline invocations. Parses user intent, validates preconditions, dispatches to orchestrator agent.

**Frontmatter:**

```yaml
---
description: "Run the dark-factory autonomous coding pipeline"
arguments:
  - name: mode
    description: "Operating mode: discover (find [PRD] issues), prd (single issue), task (single task), resume (continue interrupted run)"
    required: false
    default: "discover"
  - name: issue
    description: "GitHub issue number (required for prd mode)"
    required: false
  - name: task-id
    description: "Task ID to execute (required for task mode)"
    required: false
  - name: spec-dir
    description: "Path to spec directory (required for task mode)"
    required: false
  - name: dry-run
    description: "Validate inputs and show execution plan without running"
    required: false
---
```

**Behavior:**

1. Check for autonomous settings: verify `FACTORY_AUTONOMOUS_MODE=1` env var (set by `templates/settings.autonomous.json`). If absent, print:
   > "Dark Factory requires autonomous settings. Relaunch with: `claude --settings <plugin-root>/templates/settings.autonomous.json`"
   > and exit.
2. Call `pipeline-validate` to check preconditions (git remote, required agents/skills exist)
3. Parse mode from arguments:
   - `discover` → orchestrator with `--discover` flag
   - `prd --issue N` → orchestrator with single issue
   - `task --task-id T --spec-dir D` → orchestrator with single task
   - `resume` → orchestrator reads interrupted run state
   - `--dry-run` → validate + show plan, don't execute
4. Call `pipeline-init` to create run state files in `${CLAUDE_PLUGIN_DATA}` and set up staging branch (see `pipeline-branch staging-init`)
5. Spawn `pipeline-orchestrator` agent with appropriate context

---

### `/factory:configure`

**File:** `commands/configure.md`

**Purpose:** Review and update all plugin settings interactively through a conversational agent.

**Behavior:**

1. Read all current `userConfig` values from `plugin.json`
2. Present grouped settings with current values:
   - **Autonomy:** `humanReviewLevel` (0–4)
   - **Execution:** `execution.defaultModel`, `execution.modelByTier.*`, `execution.maxTurns*`, `maxParallelTasks`
   - **Review:** `review.preferCodex`, round caps (`review.routineRounds`/`featureRounds`/`securityRounds`)
   - **Quality:** `quality.holdoutPercent`, `quality.holdoutPassRate`, `quality.mutationScoreTarget`, `quality.mutationTestingTiers`, `quality.coverageMustNotDecrease`, `quality.coverageRegressionTolerancePct`
   - **Circuit breaker:** `maxRuntimeMinutes`, `maxConsecutiveFailures`
   - **Safety:** `safety.writeBlockedPaths`, `safety.useTruffleHog`, `safety.allowedSecretPatterns`
   - **Dependencies:** `dependencies.prMergeTimeout`, `dependencies.pollInterval`
   - **Observability:** `observability.auditLog`, `observability.metricsExport`, `observability.metricsRetentionDays`
3. Ask user what to change
4. Validate changes (type checking, range checking for numeric fields)
5. Write updated config and confirm

> **Note:** Claude Code's Bash tool has no TTY access, so interactive TUI scripts are not possible from plugin commands. This command uses the agent's conversational interface instead.

---

## Agents

### 1. `pipeline-orchestrator`

**File:** `agents/pipeline-orchestrator.md`

**Purpose:** Central control loop. Iterates the task DAG, spawns subagents for each task, manages retries and adversarial review rounds. Delegates ALL deterministic work to bin/ scripts.

**Frontmatter:**

```yaml
---
model: opus
maxTurns: 9999
description: "Orchestrates the dark-factory pipeline: discovers PRDs, generates specs, executes tasks in dependency order, manages adversarial review, handles completion"
whenToUse: "When the user invokes /factory:run or needs to run the autonomous coding pipeline"
tools:
  - Bash
  - Read
  - Write
  - Grep
  - Glob
  - Agent
  - TodoWrite
---
```

**Key behaviors (agent instructions, not deterministic — these require judgment):**

- Interpret pipeline-state output to decide next action
- Choose whether to retry a failed task or skip it
- Decide when to escalate to human (after max review rounds)
- Handle unexpected states gracefully (e.g., missing worktree, partial PR)
- Route tasks to appropriate executor based on classify-task + classify-risk output

**Deterministic operations (delegated to bin/ scripts via Bash):**

- `pipeline-fetch-prd` → get issue body
- `pipeline-validate-tasks` → validate + topologically sort tasks
- `pipeline-circuit-breaker` → check thresholds before each task
- `pipeline-state read/write` → all state transitions
- `pipeline-branch` → create/switch feature branches
- `pipeline-classify-task` → get model/turns config
- `pipeline-classify-risk` → get risk tier
- `pipeline-build-prompt` → construct task prompt
- `pipeline-detect-reviewer` → choose reviewer (Codex vs Claude Code)
- `pipeline-model-router` → check rate limits, get model config
- `pipeline-wait-pr` → poll for PR merge
- `pipeline-summary` → generate run summary
- `pipeline-cleanup` → post-run cleanup

**Subagent spawning pattern:**

```
For each task in topological order:
  1. Bash: pipeline-circuit-breaker          (exit if tripped)
  2. Bash: pipeline-state read <task_id>     (skip if already done)
  3. Bash: pipeline-classify-task <task>      (get model/turns)
  4. Bash: pipeline-classify-risk <task>      (get risk tier)
  5. Bash: pipeline-model-router              (check rate limits)
  6. Bash: pipeline-build-prompt <task>       (construct prompt)
  7. Agent: task-executor (worktree, background if parallel group allows)
  8. Bash: pipeline-state write <task_id> executing
  9. [wait for executor completion]
  10. Bash: pipeline-detect-reviewer          (choose reviewer)
  11. Agent: task-reviewer (or Codex)         (adversarial review)
  12. Bash: pipeline-parse-review             (extract verdict)
  13. [if REQUEST_CHANGES and round < max: go to 7 with fix instructions]
  14. [if APPROVE: pipeline-state write <task_id> done]
  15. [if max rounds exhausted: escalate to human]
```

### 2. `spec-generator`

**File:** `agents/spec-generator.md`

**Purpose:** Converts a PRD (GitHub issue body) into a spec directory with spec files + `tasks.json`. Uses the existing `prd-to-spec` skill in autonomous mode (skips user quiz step).

**Frontmatter:**

```yaml
---
model: opus
maxTurns: 60
isolation: worktree
description: "Generates spec files and tasks.json from a PRD issue body using the prd-to-spec skill"
whenToUse: "When the pipeline needs to convert a PRD into a spec and task decomposition"
skills:
  - prd-to-spec
tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
---
```

**Key behaviors:**

- Receives PRD body + issue metadata as context from orchestrator
- Invokes prd-to-spec skill flow (7 steps: find PRD → explore codebase → identify durable decisions → draft vertical slices → SKIP quiz → write spec files → create tasks.json)
- Step 5 (quiz user) MUST be skipped — agent instructions: "You are running in autonomous mode. Skip step 5 (quiz the user) entirely. Make reasonable decisions based on codebase analysis."
- After spec generation, calls `pipeline-validate-spec` to verify output
- If validation fails, retries with error context (max 5 retries)
- Spawns existing `spec-reviewer` agent for quality validation (score ≥54/60)
- If spec-reviewer returns NEEDS_REVISION, incorporates feedback and regenerates (max 5 iterations)
- **Transient error retry:** On HTTP 500/502/503/529 from Claude API, retries up to 3 times with exponential backoff (15s × attempt number); counted separately from validation/review iteration budgets
- **Spec failure reporting:** If spec generation fails all retries or all review iterations, calls `bin/pipeline-gh-comment` to post a failure comment on the GitHub issue and adds the `needs-manual-spec` label

**Output:** Spec directory with:

- `spec.md` (architectural decisions, user stories, acceptance criteria, technical constraints)
- `tasks.json` (task_id, title, description, files [max 3], acceptance_criteria, tests_to_write, depends_on)

### 3. `task-executor`

**File:** `agents/task-executor.md`

**Purpose:** Implements a single task from the spec. Generates code, writes tests, runs quality checks. Operates in an isolated worktree.

**Frontmatter:**

```yaml
---
model: sonnet
maxTurns: 60
isolation: worktree
description: "Implements a single task: generates code, writes tests, ensures quality gates pass"
whenToUse: "When the pipeline needs to execute a coding task from the spec"
tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
---
```

**Note:** `model` and `maxTurns` are defaults. The orchestrator overrides these per-task based on `pipeline-classify-task` output:

- Simple (haiku-tier): `model: haiku, maxTurns: 40`
- Medium (sonnet-tier): `model: sonnet, maxTurns: 60`
- Complex (opus-tier): `model: opus, maxTurns: 80`

**Key behaviors:**

- Receives: task metadata (from tasks.json), spec context, acceptance criteria (possibly with holdout), codebase summary (from scout)
- Implements code changes in the worktree
- Writes tests covering acceptance criteria + edge cases
- Uses property-based testing where input domain is broad (fast-check/hypothesis)
- Runs test suite; if failures, analyzes and fixes (max 3 auto-fix attempts)
- Does NOT run adversarial review (that's the reviewer's job)
- Commits changes with descriptive message referencing task_id
- **Auto-fix pipeline:** After Claude completes, orchestrator runs `pnpm format` then `pnpm lint:fix`; non-fatal (failures logged, no retry triggered); only commits tracked files via `git add -u`
- **Prior work injection:** On resume/retry, `pipeline-build-prompt` detects commits already on the feature branch ahead of staging and appends a "Prior Work" section to the prompt to avoid duplicate effort
- **Failure-specific retry context:** Orchestrator sets `TASK_FAILURE_TYPE` env var before each retry; max 4 total retries:
  - `max_turns` — agent hit turn limit; prompt includes partial work context, encourages continuation
  - `quality_gate` — test/coverage/mutation gate failed; prompt includes full gate output
  - `agent_error` — non-zero exit code; prompt includes error details
  - `no_changes` — no diff produced; prompt explicitly requests code changes
  - `code_review` — reviewer rejected changes; prompt includes prior review findings

**Instructions include:**

- "Write tests for ALL acceptance criteria. Use property-based testing (fast-check) for functions with broad input domains."
- "Do NOT delete or modify existing tests to make them pass. Fix the implementation."
- "Do NOT add features beyond what the task specifies."
- "Do NOT hardcode return values to satisfy test inputs."

### 4. `task-reviewer`

**File:** `agents/task-reviewer.md`

**Purpose:** Fresh-context adversarial code review. Reviews task-executor output with zero knowledge of implementation process. Produces structured, machine-parseable verdicts.

**Frontmatter:**

```yaml
---
model: sonnet
maxTurns: 25
description: "Adversarial code review with structured verdicts. Reviews code changes against acceptance criteria with zero implementation context."
whenToUse: "When the pipeline needs to review code changes from a task executor"
skills:
  - review-protocol
tools:
  - Bash
  - Read
  - Grep
  - Glob
---
```

**Key behaviors:**

- Receives: diff of changes, acceptance criteria (full set including any holdout criteria for validation), task metadata
- Has NO context about how the code was written — fresh-context review
- Follows `review-protocol` skill (Actor-Critic methodology): assume adversarial posture, actively try to break code
- Reviews for: correctness, test quality, security, performance, maintainability, acceptance criteria satisfaction
- Checks for AI-specific anti-patterns: hallucinated APIs, over-abstraction, copy-paste drift, missing null checks, excessive I/O, dead code, sycophantic generation
- Validates holdout criteria satisfaction (if holdout criteria provided)

**Output format (structured, parsed by `pipeline-parse-review`):**

```
## Review Verdict

**VERDICT:** APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION
**ROUND:** N
**CONFIDENCE:** HIGH | MEDIUM | LOW

## Findings

### [BLOCKING] Finding title
- **File:** path/to/file.ts:42
- **Severity:** critical | major | minor
- **Category:** correctness | security | performance | test-quality | style
- **Description:** ...
- **Suggestion:** ...

### [NON-BLOCKING] Finding title
...

## Acceptance Criteria Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| criterion text | PASS/FAIL | file:line or explanation |

## Holdout Criteria Check (if applicable)

| Withheld Criterion | Status | Evidence |
|--------------------|--------|----------|
| criterion text | PASS/FAIL | file:line or explanation |

## Summary
One paragraph summary of overall assessment.
```

---

## Existing Agents Reused Directly

All pipeline agents are **bundled inside the plugin** (`agents/` directory). No user agent setup required.

| Agent                   | Spawned By     | Purpose in Pipeline                                                                                                                      | Config           |
| ----------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `spec-reviewer`         | spec-generator | Validates spec quality (score ≥54/60, PASS/NEEDS_REVISION). 6 dimensions: granularity, deps, criteria, tests, vertical slices, alignment | sonnet, 20 turns |
| `code-reviewer`         | orchestrator   | Fresh-context code review; evidence-first findings. Spawned for security-tier tasks alongside task-reviewer                              | sonnet, 25 turns |
| `architecture-reviewer` | orchestrator   | Extra review pass for feature/security-tier tasks. Module boundaries, coupling, AI anti-patterns                                         | sonnet, 20 turns |
| `security-reviewer`     | orchestrator   | Security-tier tasks only. OWASP Top 10, secrets exposure, AI-specific insecure defaults                                                  | sonnet, 20 turns |
| `test-writer`           | orchestrator   | Kills mutation testing survivors. Spawned when mutation score < 80% threshold                                                            | sonnet, 20 turns |
| `scribe`                | orchestrator   | Post-pipeline docs update. Enforced final step before pipeline-cleanup                                                                   | sonnet, varies   |

---

## Bin Scripts (Deterministic Core)

All scripts live in `bin/`. The plugin adds this directory to `$PATH`, so they're callable by agents via `Bash` tool without path prefix. All scripts:

- Source `pipeline-lib.sh` for shared functions
- Read config from `${CLAUDE_PLUGIN_DATA}/config.json` (populated from userConfig at init)
- Exit 0 on success, non-zero on failure
- Write structured output to stdout (JSON where applicable)
- Write logs to stderr

### `pipeline-lib.sh`

**Replaces:** `utils.sh`

Shared Bash library sourced by all other scripts. Not executable directly.

**Functions:**

| Function                             | Purpose                                                               |
| ------------------------------------ | --------------------------------------------------------------------- |
| `log_info`, `log_warn`, `log_error`  | Structured logging to stderr with timestamp + script name             |
| `slugify <string>`                   | Convert string to branch-safe slug (lowercase, hyphens, max 50 chars) |
| `read_config <key> [default]`        | Read from `${CLAUDE_PLUGIN_DATA}/config.json` via jq                  |
| `read_state <run_id> <key>`          | Shortcut for `pipeline-state read`                                    |
| `write_state <run_id> <key> <value>` | Shortcut for `pipeline-state write`                                   |
| `temp_file [suffix]`                 | Create temp file in `${CLAUDE_PLUGIN_DATA}/tmp/`, auto-cleaned        |
| `require_command <cmd>`              | Assert command exists, exit 1 with message if not                     |
| `json_output <key> <value> ...`      | Build JSON object from key-value pairs, write to stdout               |

### `pipeline-validate`

**Replaces:** `validator.sh`

**Usage:** `pipeline-validate [--strict]`

**Checks (exit 1 on first failure):**

1. Git remote configured (`git remote get-url origin`)
2. Clean working tree (no uncommitted changes, unless `--no-clean-check`)
3. `gh` CLI installed and authenticated (`gh auth status`)
4. Required skills exist in `.claude/skills/` (prd-to-spec)
5. `${CLAUDE_PLUGIN_DATA}` directory writable

**Output:** JSON `{"valid": true, "checks": [{"name": "...", "status": "pass|fail", "detail": "..."}]}`

### `pipeline-fetch-prd`

**Replaces:** part of `spec-gen.sh`

**Usage:** `pipeline-fetch-prd <issue-number>`

**Behavior:**

1. Call `gh issue view <issue-number> --json title,body,labels,assignees`
2. Validate issue has `[PRD]` in title or labels (warn if not, continue)
3. Output JSON: `{"issue_number": N, "title": "...", "body": "...", "labels": [...], "assignees": [...]}`

**Exit codes:** 0 = success, 1 = issue not found, 2 = gh not authenticated

### `pipeline-validate-spec`

**Replaces:** part of `spec-gen.sh`

**Usage:** `pipeline-validate-spec <spec-dir>`

**Checks:**

1. `<spec-dir>/spec.md` exists and is non-empty
2. `<spec-dir>/tasks.json` exists and is valid JSON
3. tasks.json is an array with ≥1 task
4. Each task has required fields: `task_id`, `title`, `description`, `files`, `acceptance_criteria`, `tests_to_write`, `depends_on`
5. `files` array length ≤ 3 per task

**Output:** JSON `{"valid": true|false, "errors": ["..."], "task_count": N}`

### `pipeline-validate-tasks`

**Replaces:** `task-validator.sh`

**Usage:** `pipeline-validate-tasks <tasks-json-path>`

**Behavior:**

1. Parse tasks.json
2. Validate required fields on each task (same as validate-spec task checks)
3. Build dependency graph
4. Detect dangling dependencies (reference to non-existent task_id)
5. Detect circular dependencies (DFS cycle detection)
6. Topological sort via Kahn's algorithm
7. Assign parallel groups (tasks with all deps satisfied in same group run concurrently)

**Output:** JSON:

```json
{
  "valid": true,
  "task_count": 8,
  "execution_order": [
    { "task_id": "task_1", "parallel_group": 0 },
    { "task_id": "task_2", "parallel_group": 0 },
    { "task_id": "task_3", "parallel_group": 1 },
    { "task_id": "task_4", "parallel_group": 1 },
    { "task_id": "task_5", "parallel_group": 2 }
  ],
  "errors": []
}
```

**Exit codes:** 0 = valid, 1 = validation errors (errors in output)

### `pipeline-init`

**Replaces:** `scaffolding.sh`

**Usage:** `pipeline-init <run-id> [--issue <N>] [--mode <mode>]`

**Behavior:**

1. Create directory structure in `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/`
2. Initialize `state.json` with run metadata
3. Create empty `audit.jsonl`, `metrics.jsonl`

**Creates:**

```
${CLAUDE_PLUGIN_DATA}/runs/<run-id>/
├── state.json          # Run state (status, tasks, timestamps)
├── audit.jsonl         # Append-only audit log
├── metrics.jsonl       # Append-only metrics log
├── holdouts/           # Withheld acceptance criteria
└── reviews/            # Review verdicts per task per round
```

**Output:** JSON `{"run_id": "...", "state_path": "...", "created": true}`

### `pipeline-branch`

**Replaces:** `repository.sh`

**Usage:** `pipeline-branch <action> [options]`

**Actions:**

| Action            | Usage                                           | Behavior                                                                                                  |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `staging-init`    | `pipeline-branch staging-init`                  | Check for `staging` branch on remote; if absent, create from `develop` (or `main` if no develop) and push |
| `create`          | `pipeline-branch create <name> [--base <ref>]`  | Create branch from `staging` HEAD (default base); checkout                                                |
| `worktree-create` | `pipeline-branch worktree-create <name> <path>` | Create git worktree at path with new branch from `staging`                                                |
| `worktree-remove` | `pipeline-branch worktree-remove <path>`        | Remove worktree, optionally delete branch                                                                 |
| `exists`          | `pipeline-branch exists <name>`                 | Check if branch exists (exit 0/1)                                                                         |
| `naming`          | `pipeline-branch naming <task-id> <issue>`      | Generate branch name: `dark-factory/<issue>/<slugified-task-id>`                                          |

**`staging-init` behavior:**

1. `git ls-remote --heads origin staging` — branch exists on remote?
2. If exists: `git fetch origin staging && git checkout staging && git pull` — ensure up-to-date
3. If absent:
   a. Check for `develop`: `git ls-remote --heads origin develop`
   b. If develop exists: `git checkout -b staging origin/develop`
   c. Else: `git checkout -b staging origin/main`
   d. Push: `git push -u origin staging`
4. Output: `{"staging_branch": "staging", "base": "develop|main", "created": true|false}`

**Branch creation for tasks:** All `create` and `worktree-create` calls default `--base` to the current `staging` HEAD. For tasks with dependencies, the orchestrator only calls `pipeline-branch create` after the dependency's PR has merged into `staging` (via `pipeline-wait-pr`), ensuring dependent worktrees always start from staging's latest state.

**Auto-safe rebase:** When `pipeline-wait-pr` resolves a merge conflict via `git rebase`, the following files are resolved automatically without human review:

| File pattern                                  | Resolution strategy                                 |
| --------------------------------------------- | --------------------------------------------------- |
| `package.json`                                | 3-way merge (both-sides changes accepted)           |
| `pnpm-lock.yaml`                              | `ours` strategy (regenerated by pnpm post-merge)    |
| `claude-progress.json`, `feature-status.json` | `ours` strategy (pipeline tracking state, not code) |
| `.gitignore`                                  | `union` strategy (both sets of additions kept)      |

All other files require manual resolution — rebase aborts and `pipeline-wait-pr` returns exit code 4 (`conflict-escalated`). The rebase loop runs up to 30 rounds to handle multi-commit rebases.

### `pipeline-classify-task`

**Replaces:** part of `task-runner.sh`

**Usage:** `pipeline-classify-task <task-json>`

**Input:** Single task object as JSON string (from tasks.json)

**Heuristic:**

| Metric             | Simple | Medium | Complex |
| ------------------ | ------ | ------ | ------- |
| File count         | 1      | 2      | 3       |
| Dependency count   | 0      | 1-2    | 3+      |
| Has tests_to_write | any    | any    | any     |

Tier = max(file_tier, dep_tier). Ties broken upward.

**Output:**

```json
{
  "tier": "simple|medium|complex",
  "model": "haiku|sonnet|opus",
  "maxTurns": 40|60|80,
  "reasoning": "2 files, 1 dep → medium"
}
```

### `pipeline-classify-risk`

**Replaces:** NEW (from research)

**Usage:** `pipeline-classify-risk <task-json>`

**Heuristic (file-path based):**

| Risk Tier  | Path Patterns                                                                                                          | Review Rounds | Extra Reviewers                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| `security` | `**/auth/**`, `**/security/**`, `**/migration/**`, `**/payment/**`, `**/crypto/**`, `**/*.env*`, `**/middleware/auth*` | 6             | security-reviewer + architecture-reviewer (both bundled) |
| `feature`  | `**/api/**`, `**/routes/**`, `**/models/**`, `**/services/**`, `**/hooks/**`                                           | 4             | architecture-reviewer (bundled)                          |
| `routine`  | Everything else (`**/components/**`, `**/utils/**`, `**/docs/**`, `**/tests/**`, `**/styles/**`)                       | 2             | None                                                     |

**Output:**

```json
{
  "tier": "routine|feature|security",
  "review_rounds": 2|4|6,
  "extra_reviewers": [],
  "matched_patterns": ["**/auth/**"],
  "reasoning": "files include src/auth/handler.ts → security tier"
}
```

### `pipeline-build-prompt`

**Replaces:** part of `task-runner.sh`

**Usage:** `pipeline-build-prompt <task-json> <spec-path> [--holdout <percent>] [--fix-instructions <json>]`

**Behavior:**

1. Read task metadata from JSON
2. Read spec context from spec-path
3. If `--holdout N%`: randomly select N% of acceptance_criteria, write to `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/holdouts/<task-id>.json`, remove from prompt
4. If `--fix-instructions`: append review feedback for fix-and-retry round
5. Template into structured prompt

**Output:** Complete prompt string to stdout. Holdout criteria saved separately.

### `pipeline-circuit-breaker`

**Replaces:** part of `orchestrator.sh`

**Usage:** `pipeline-circuit-breaker <run-id>`

**Checks against state:**

| Threshold                | Default       | Configurable via                    |
| ------------------------ | ------------- | ----------------------------------- |
| Max runtime              | 0 (unlimited) | `userConfig.maxRuntimeMinutes`      |
| Max consecutive failures | 5             | `userConfig.maxConsecutiveFailures` |

`maxRuntimeMinutes=0` disables the wall-clock cap entirely. Only the consecutive-failures check runs.

**Exit codes:** 0 = safe to proceed, 1 = circuit breaker tripped (reason on stderr)

**Output:** JSON `{"tripped": false, "runtime_minutes": 45, "consecutive_failures": 0}`

### `pipeline-state`

**Replaces:** part of `orchestrator.sh` + `completion.sh`

**Usage:** `pipeline-state <action> <run-id> [key] [value]`

**Actions:**

| Action           | Usage                                                    | Behavior                                                     |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| `read`           | `pipeline-state read <run-id> [key]`                     | Read full state or specific key                              |
| `write`          | `pipeline-state write <run-id> <key> <value>`            | Write key to state (atomic: write tmp + mv)                  |
| `task-status`    | `pipeline-state task-status <run-id> <task-id> <status>` | Update task status (pending/executing/reviewing/done/failed) |
| `deps-satisfied` | `pipeline-state deps-satisfied <run-id> <task-id>`       | Check if all deps are done (exit 0/1)                        |
| `interrupted`    | `pipeline-state interrupted <run-id>`                    | Check if run was interrupted (exit 0/1)                      |
| `resume-point`   | `pipeline-state resume-point <run-id>`                   | Find first incomplete task in execution order                |

### `pipeline-wait-pr`

**Replaces:** part of `orchestrator.sh`

**Usage:** `pipeline-wait-pr <pr-number> [--timeout <minutes>] [--interval <seconds>]`

**Defaults:** timeout=45min, interval=60s

**Behavior:**

1. Poll `gh pr view <pr-number> --json state,mergedAt,mergeable` until merged or timeout
2. On each poll, also check CI status: `gh pr checks <pr-number> --json name,status,conclusion`
   - If any required check is in `failure` state: exit 3 (CI failed) with failure details on stdout
   - Caller (orchestrator) fetches failure log via `gh run view --log-failed`, spawns task-executor with fix instructions, force-pushes, then re-invokes pipeline-wait-pr (max 2 CI fix attempts before escalating)
3. On `state == CLOSED` (close-without-merge): exit 2. Orchestrator inspects `mergeable` field:
   - If `CONFLICTING`: attempt rebase (`git rebase staging`), force-push, re-invoke pipeline-wait-pr once. If conflict persists, exit 4 (unresolvable conflict) → mark task as `conflict-escalated`, notify user.
   - Otherwise: mark task as `rejected`.

**Exit codes:** 0 = merged, 1 = timeout, 2 = closed without merge (non-conflict), 3 = CI failed (with details), 4 = unresolvable merge conflict

### `pipeline-detect-reviewer`

**Replaces:** NEW (adversarial review)

**Usage:** `pipeline-detect-reviewer`

**Detection logic:**

1. Check if `codex` command exists: `command -v codex`
2. If exists, check auth: `codex status --auth` (exit 0 = authenticated)
3. If Codex available + authenticated → return Codex config
4. Fallback → return Claude Code reviewer config

**Output:**

```json
{
  "reviewer": "codex|claude-code",
  "command": "codex:adversarial-review|task-reviewer",
  "available": true,
  "detection": {
    "codex_installed": true|false,
    "codex_authenticated": true|false
  }
}
```

### `pipeline-parse-review`

**Replaces:** part of `code-review.sh`

**Usage:** `pipeline-parse-review <review-output-path>`

**Behavior:** Parse the structured review output (from task-reviewer or Codex) into machine-readable JSON.

**Output:**

```json
{
  "verdict": "APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION",
  "round": 1,
  "confidence": "HIGH|MEDIUM|LOW",
  "blocking_findings": 2,
  "non_blocking_findings": 5,
  "criteria_passed": 8,
  "criteria_failed": 1,
  "holdout_passed": 2,
  "holdout_failed": 0,
  "findings": [
    {
      "blocking": true,
      "title": "...",
      "file": "...",
      "line": 42,
      "severity": "critical|major|minor",
      "category": "correctness|security|performance|test-quality|style",
      "description": "...",
      "suggestion": "..."
    }
  ]
}
```

### `pipeline-quota-check`

**Replaces:** `usage.sh`

**Usage:** `pipeline-quota-check`

**Behavior:**

1. Read `${CLAUDE_PLUGIN_DATA}/usage-cache.json` (written by `bin/statusline-wrapper.sh`)
2. Freshness check: if `captured_at` is >120s old, log warning but continue
3. Calculate 5h position using `five_hour.used_percentage` + `five_hour.resets_at`:
   - `window_hour = floor((now - (resets_at - 5h)) / 3600) + 1` [1–5]
   - `hourly_threshold = min(window_hour * 20, 90)`
4. Calculate 7d position using `seven_day.used_percentage` + `seven_day.resets_at`:
   - `window_day = floor((now - (resets_at - 7d)) / 86400) + 1` [1–7]
   - `daily_threshold = [14, 29, 43, 57, 71, 86, 95][window_day - 1]`
5. Exit 0 with JSON output (caller decides action based on over_threshold flags)

**Setup:** One-time user step — set `statusLine.command` in `~/.claude/settings.json`
to `bin/statusline-wrapper.sh`. The wrapper captures `rate_limits` from Claude Code's
statusline JSON and writes it to `usage-cache.json`. No cold-start probe needed.

**Output:**

```json
{
  "five_hour": {
    "utilization": 45,
    "hourly_threshold": 60,
    "over_threshold": false,
    "window_hour": 3,
    "resets_at_epoch": 1776329771
  },
  "seven_day": {
    "utilization": 52,
    "daily_threshold": 57,
    "over_threshold": false,
    "window_day": 4,
    "resets_at_epoch": 1776900000
  },
  "detection_method": "statusline"
}
```

### `pipeline-model-router`

**Replaces:** NEW (rate-limit response routing)

**Usage:** `pipeline-model-router --quota <pipeline-quota-check-output> --tier <routine|feature|security>`

**Behavior:**

1. Parse `pipeline-quota-check` output (`five_hour` and `seven_day` over-threshold flags)
2. Apply composed decision logic:
   - Both within limits → `action: proceed` with tier-appropriate review cap
   - 5h over, 7d within → `action: wait` with `wait_minutes` computed from the 5h `resets_at_epoch`
   - 7d over (regardless of 5h) → `action: end_gracefully` (cannot wait out the 7-day window mid-run)
3. Review cap comes from standard cloud caps (`review.routineRounds`/`featureRounds`/`securityRounds`)

Subagent-based architecture means per-spawn provider routing is not possible (claude-code#38698), so this router does not attempt to switch providers when quota is exhausted — it either waits for the session to refresh or ends the run gracefully.

**Output:**

```json
{
  "provider": "anthropic",
  "action": "proceed|wait|end_gracefully",
  "trigger": "5h_over|7d_over",
  "review_cap": 4,
  "tier": "feature",
  "wait_minutes": 150
}
```

### `pipeline-coverage-gate`

**Replaces:** NEW (from research)

**Usage:** `pipeline-coverage-gate <before-report> <after-report>`

**Behavior:**

1. Parse coverage reports (supports lcov, istanbul JSON, cobertura XML)
2. Compare line coverage, branch coverage, function coverage
3. If any metric decreased → exit 1

**Output:**

```json
{
  "passed": true|false,
  "before": {"lines": 85.2, "branches": 72.1, "functions": 90.0},
  "after": {"lines": 86.1, "branches": 73.5, "functions": 90.0},
  "delta": {"lines": 0.9, "branches": 1.4, "functions": 0.0}
}
```

### `pipeline-summary`

**Replaces:** `completion.sh`

**Usage:** `pipeline-summary <run-id>`

**Output:** JSON summary of run:

```json
{
  "run_id": "...",
  "status": "completed|partial|failed",
  "duration_minutes": 45,
  "tasks": {
    "total": 8,
    "completed": 7,
    "failed": 1,
    "skipped": 0
  },
  "reviews": {
    "total_rounds": 12,
    "approvals": 7,
    "revisions": 5
  },
  "quality": {
    "coverage_before": 85.2,
    "coverage_after": 87.1,
    "mutation_score": 82.5,
    "holdout_pass_rate": 100
  },
  "cost": {
    "total_tokens": 450000,
    "estimated_usd": 2.35,
    "models_used": { "opus": 2, "sonnet": 5, "haiku": 1 }
  },
  "prs_created": ["#123", "#124", "#125"],
  "partial_tasks": ["task_3"],
  "warnings": ["Branch dark-factory/123/task-3 retained (PR #126 not merged)"]
}
```

**Partial failure comments:** On runs with `status: partial`, `pipeline-summary` calls `bin/pipeline-gh-comment` to post a per-task breakdown comment to the GitHub issue. On resume/retry, the comment is updated (deduplicated by checking for existing pipeline-summary comment before posting).

### `pipeline-gh-comment`

**New script** (no Bash equivalent)

**Usage:** `pipeline-gh-comment <issue-number> <comment-type> [--update] [data...]`

**Comment types:**

| Type                 | Trigger                             | Content                                              |
| -------------------- | ----------------------------------- | ---------------------------------------------------- |
| `spec-failure`       | spec-generator exhausts retries     | Failure reason + `needs-manual-spec` label added     |
| `run-summary`        | partial or failed run               | Per-task status table, warnings, resume instructions |
| `ci-escalation`      | CI fails after 2 auto-fix retries   | CI failure log excerpt + instructions for manual fix |
| `conflict-escalated` | merge conflict after rebase attempt | Conflicting files list + resolution instructions     |

**`--update` flag:** Before posting, checks for existing comment from `github-actions[bot]` or pipeline bot with matching type marker. If found, edits in place instead of posting a new comment (prevents duplicate comments on resume).

### `pipeline-scaffold`

**New script** (replaces `project-init.sh`)

**Usage:** `pipeline-scaffold <project-root> [--force]`

**Behavior:** Creates project scaffolding files if absent (idempotent without `--force`):

| File                                 | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `claude-progress.json`               | Per-issue run state (tasks, statuses, PR URLs)          |
| `feature-status.json`                | Aggregated feature status across issues                 |
| `init.sh`                            | Project bootstrap script (installs deps, sets env vars) |
| `.github/workflows/quality-gate.yml` | CI workflow: lint, type-check, test, coverage           |

**`.gitignore` management:** Appends plugin state dirs (`${CLAUDE_PLUGIN_DATA}/*`, `*.worktree`) if not already present. Also adds `*.lock` patterns for pipeline lock files.

### `pipeline-cleanup`

**Replaces:** `completion.sh`

**Usage:** `pipeline-cleanup <run-id> [--close-issues] [--delete-branches] [--remove-worktrees]`

**Behavior:**

1. `--close-issues`: close GitHub issues referenced in run state via `gh issue close` (only if all tasks for that issue are merged)
2. `--delete-branches`: for each task branch, check PR status via `gh pr view <pr-number> --json state,mergedAt`. Delete local (`git branch -d`) + remote (`git push origin --delete`) only for merged PRs. Branches with unmerged or open PRs are left intact and listed in the cleanup summary with a warning.
3. `--remove-worktrees`: remove worktrees for merged tasks only via `git worktree remove`. Worktrees for unmerged tasks are left intact.
4. `--clean-spec`: `git rm -r` the spec directory (e.g., `spec/issue-123/`) after all tasks for the issue are merged. Committed so the removal is in history. Only runs if all tasks for the issue are in `merged` state.
5. Archive run state to `${CLAUDE_PLUGIN_DATA}/archive/<run-id>/`

### `pipeline-lock`

**Replaces:** `lock.sh`

**Usage:** `pipeline-lock <action> [--timeout <seconds>]`

**Actions:**

| Action    | Behavior                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `acquire` | Create lock file in `${CLAUDE_PLUGIN_DATA}/pipeline.lock` with PID + timestamp. Wait up to timeout if locked. |
| `release` | Remove lock file if owned by current process                                                                  |
| `recover` | Check if lock holder PID still alive. If dead, take ownership.                                                |
| `status`  | Report lock status (locked/unlocked, holder PID, age)                                                         |

**Note:** Lock is a secondary safety mechanism. Primary isolation is via worktrees. Lock prevents two orchestrator instances from running simultaneously.

---

## Skill

### `review-protocol`

**File:** `skills/review-protocol/SKILL.md`

**Purpose:** Injects Actor-Critic adversarial review methodology into any reviewer agent. This skill is listed in the `skills:` frontmatter of `task-reviewer` and can be injected into the existing `code-reviewer` agent when used as fallback.

**Content (injected into reviewer's context):**

The skill instructs the reviewer to:

1. **Assume adversarial posture** — treat the code as a hostile artifact. Your job is to break it, not validate it.
2. **Zero implementation context** — you have not seen how this code was written. Review only what's in front of you.
3. **Structured output format** — ALWAYS output in the specified verdict format (VERDICT, ROUND, CONFIDENCE, Findings, Acceptance Criteria Check, Summary).
4. **Severity classification** — every finding MUST be classified as BLOCKING or NON-BLOCKING. Only BLOCKING findings trigger REQUEST_CHANGES.
5. **AI-specific anti-pattern checklist** — explicitly check for:
   - Hallucinated APIs (imports/calls that don't exist in project dependencies)
   - Over-abstraction (unnecessary indirection, premature generalization)
   - Copy-paste drift (similar but subtly different code blocks)
   - Missing null/undefined checks at system boundaries
   - Excessive I/O (reading files in loops, redundant API calls)
   - Dead code (unreachable branches, unused exports)
   - Sycophantic generation (code that looks impressive but doesn't work)
   - Tautological tests (tests that assert what was written, not what should work)
6. **Acceptance criteria validation** — check every criterion against actual code. Each criterion gets PASS or FAIL with evidence (file:line reference).
7. **Holdout criteria validation** (if provided) — same check for withheld criteria that the implementer never saw.
8. **Round awareness** — include the current review round number. If round > 1, focus on whether previous findings were properly addressed.

**Triggering effectiveness:** Skill is triggered when any reviewer agent is spawned during a dark-factory pipeline run. The skill name appears in the agent's `skills:` frontmatter, causing Claude Code to inject SKILL.md content into the agent's system context.

---

## Hooks

**File:** `hooks/hooks.json`

All hooks are defined in a single JSON file. Each hook fires automatically for all agents spawned by the plugin.

### Hook 1: `branch-protection`

**Event:** `PreToolUse` (fires before Bash tool execution)
**Type:** `command`

**Purpose:** Block destructive git operations on protected branches. Prevents force-push, hard reset, and branch deletion on main/master/develop.

**Configuration:**

```json
{
  "event": "PreToolUse",
  "tool": "Bash",
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/branch-protection.sh"
}
```

**Script behavior (`hooks/branch-protection.sh`):**

1. Parse the Bash command from hook input (stdin JSON: `{"tool": "Bash", "params": {"command": "..."}}`)
2. Check command against blocked patterns:
   - `git push --force` or `git push -f` to `main|master|develop`
   - `git reset --hard` on `main|master|develop`
   - `git branch -D main|master|develop`
   - `git push origin --delete main|master|develop`
3. If blocked → exit with `{"decision": "block", "reason": "Force push to protected branch blocked"}`
4. If safe → exit with `{"decision": "allow"}`

### Hook 2: `run-tracker`

**Event:** `PostToolUse` (fires after Bash, Write, Edit tool execution)
**Type:** `command`

**Purpose:** Append-only audit log for EU AI Act compliance. Logs every tool use during a pipeline run to `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/audit.jsonl`.

**Configuration:**

```json
{
  "event": "PostToolUse",
  "tool": ["Bash", "Write", "Edit"],
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/run-tracker.sh"
}
```

**Script behavior (`hooks/run-tracker.sh`):**

1. Check if a pipeline run is active: test existence of `${CLAUDE_PLUGIN_DATA}/runs/current`
2. If no active run → exit silently (don't log non-pipeline activity)
3. Parse tool use from stdin JSON
4. Append JSONL entry:

```json
{
  "timestamp": "2026-04-07T12:34:56Z",
  "tool": "Bash",
  "params_hash": "sha256:abc123...",
  "agent": "task-executor",
  "run_id": "run-20260407-123456",
  "sequence": 42
}
```

5. Sequence number is monotonically increasing per run (tamper-evidence)

### Hook 3: `stop-gate`

**Event:** `Stop` (fires when main agent session ends)
**Type:** `command`

**Purpose:** Validate run state consistency when a session ends. Marks interrupted runs for resume. Prevents orphaned state.

**Configuration:**

```json
{
  "event": "Stop",
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop-gate.sh"
}
```

**Script behavior (`hooks/stop-gate.sh`):**

1. Check if a pipeline run is active
2. If active run has tasks in `executing` state → mark as `interrupted`, record resume point
3. If all tasks are `done` or `failed` → mark run as `completed` or `partial`
4. Write final state to `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/state.json`
5. Remove `${CLAUDE_PLUGIN_DATA}/runs/current` symlink

### Hook 4: `subagent-stop-gate`

**Event:** `SubagentStop` (fires when a subagent completes)
**Type:** `command`

**Purpose:** Validate task completion artifacts when a subagent (task-executor, task-reviewer, spec-generator) finishes. Ensures expected outputs exist before marking task as done.

**Configuration:**

```json
{
  "event": "SubagentStop",
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop-gate.sh"
}
```

**Script behavior (`hooks/subagent-stop-gate.sh`):**

1. Parse subagent type from stdin JSON
2. Based on agent type, verify expected artifacts:
   - `spec-generator`: spec.md and tasks.json exist in output directory
   - `task-executor`: at least one commit on feature branch, tests pass
   - `task-reviewer`: review output file exists with valid verdict format
3. If artifacts missing → log warning to audit.jsonl, write `incomplete` status
4. If artifacts valid → write success status

---

## MCP Server

### `pipeline-metrics`

**Config file:** `.mcp.json`

**Purpose:** Observability metrics collection and querying. Records token counts, task durations, model usage, quality gate results, and cost estimates. Persists to local SQLite database in `${CLAUDE_PLUGIN_DATA}/metrics.db`.

**MCP configuration:**

```json
{
  "mcpServers": {
    "pipeline-metrics": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/servers/pipeline-metrics/index.js"],
      "env": {
        "METRICS_DB": "${CLAUDE_PLUGIN_DATA}/metrics.db"
      }
    }
  }
}
```

**Tools exposed:**

| Tool              | Parameters                                                            | Purpose                                                                                         |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `metrics_record`  | `run_id`, `event_type`, `data` (JSON)                                 | Record a metric event (task_start, task_end, review_round, quality_gate, circuit_breaker, etc.) |
| `metrics_query`   | `run_id` (optional), `event_type` (optional), `since` (ISO timestamp) | Query recorded metrics with filters                                                             |
| `metrics_summary` | `run_id`                                                              | Aggregate summary: total tokens, cost, duration, model breakdown                                |
| `metrics_export`  | `run_id`, `format` (`json`\|`csv`)                                    | Export metrics for external analysis                                                            |

**Event types:**

| Event             | Recorded Fields                                                          |
| ----------------- | ------------------------------------------------------------------------ |
| `task_start`      | run_id, task_id, model, tier, risk_tier, timestamp                       |
| `task_end`        | run_id, task_id, status, duration_ms, tokens_used, model                 |
| `review_round`    | run_id, task_id, round, reviewer (codex/claude), verdict, findings_count |
| `quality_gate`    | run_id, task_id, gate (coverage/mutation/holdout), passed, details       |
| `circuit_breaker` | run_id, reason (max_runtime/max_failures), values                        |
| `run_start`       | run_id, mode, issue_numbers, timestamp                                   |
| `run_end`         | run_id, status, duration_ms, total_tokens, total_cost_usd                |

---

## Plugin Manifest

**File:** `.claude-plugin/plugin.json`

Canonical schema (flat dotted keys, matching the on-disk `.claude-plugin/plugin.json`).
The PRD `02-quality-and-config.md` is the source of truth for defaults and ranges.

```json
{
  "name": "factory",
  "version": "0.3.0",
  "description": "Autonomous coding pipeline: converts GitHub PRD issues into merged pull requests with quality-first review gates",
  "userConfig": {
    "humanReviewLevel": { "type": "number", "default": 0 },
    "maxRuntimeMinutes": { "type": "number", "default": 0 },
    "maxConsecutiveFailures": { "type": "number", "default": 5 },
    "maxParallelTasks": { "type": "number", "default": 3 },
    "review.preferCodex": { "type": "boolean", "default": true },
    "review.routineRounds": { "type": "number", "default": 2 },
    "review.featureRounds": { "type": "number", "default": 4 },
    "review.securityRounds": { "type": "number", "default": 6 },
    "quality.holdoutPercent": { "type": "number", "default": 20 },
    "quality.holdoutPassRate": { "type": "number", "default": 80 },
    "quality.mutationScoreTarget": { "type": "number", "default": 80 },
    "quality.mutationTestingTiers": {
      "type": "array",
      "default": ["feature", "security"]
    },
    "quality.coverageMustNotDecrease": { "type": "boolean", "default": true },
    "quality.coverageRegressionTolerancePct": {
      "type": "number",
      "default": 0.5
    },
    "execution.defaultModel": { "type": "string", "default": "sonnet" },
    "execution.modelByTier.simple": { "type": "string", "default": "haiku" },
    "execution.modelByTier.medium": { "type": "string", "default": "sonnet" },
    "execution.modelByTier.complex": { "type": "string", "default": "opus" },
    "execution.maxTurnsSimple": { "type": "number", "default": 40 },
    "execution.maxTurnsMedium": { "type": "number", "default": 60 },
    "execution.maxTurnsComplex": { "type": "number", "default": 80 },
    "dependencies.prMergeTimeout": { "type": "number", "default": 45 },
    "dependencies.pollInterval": { "type": "number", "default": 60 },
    "observability.auditLog": { "type": "boolean", "default": true },
    "observability.metricsExport": { "type": "string", "default": "json" },
    "observability.metricsRetentionDays": { "type": "number", "default": 90 },
    "safety.writeBlockedPaths": { "type": "array", "default": [] },
    "safety.useTruffleHog": { "type": "boolean", "default": false },
    "safety.allowedSecretPatterns": { "type": "array", "default": [] }
  }
}
```

---

## Settings

**File:** `settings.json`

Default permission grants so the plugin's agents can operate without manual approval for each tool call:

```json
{
  "permissions": {
    "allow": [
      "Bash(pipeline-*)",
      "Bash(git *)",
      "Bash(gh *)",
      "Bash(npm test*)",
      "Bash(npx vitest*)",
      "Read",
      "Write",
      "Edit",
      "Grep",
      "Glob",
      "Agent"
    ]
  }
}
```

---

## Bash Module → Plugin Component Mapping

Complete mapping of every dark-factory Bash module to its plugin equivalent(s):

| Bash Module                 | Plugin Component(s)                                                               | Type                       | Notes                                               |
| --------------------------- | --------------------------------------------------------------------------------- | -------------------------- | --------------------------------------------------- |
| `cli.sh`                    | `commands/run.md`                                                                 | Command                    | Native slash command replaces CLI parsing           |
| `spec-gen.sh`               | `agents/spec-generator.md` + reused `prd-to-spec` skill                           | Agent + Skill              | Skill injection replaces prompt templating          |
| `spec-gen.sh` (validate)    | `bin/pipeline-validate-spec`                                                      | Bin script                 | Extracted from agent to deterministic script        |
| `task-validator.sh`         | `bin/pipeline-validate-tasks`                                                     | Bin script                 | Same Kahn's algorithm, adds parallel groups         |
| `task-runner.sh` (classify) | `bin/pipeline-classify-task` + `bin/pipeline-classify-risk`                       | Bin scripts                | Risk classification is new (from research)          |
| `task-runner.sh` (prompt)   | `bin/pipeline-build-prompt`                                                       | Bin script                 | Adds holdout support                                |
| `task-runner.sh` (execute)  | `agents/task-executor.md`                                                         | Agent                      | Worktree isolation, model override                  |
| `code-review.sh`            | `agents/task-reviewer.md` + `review-protocol` skill + `bin/pipeline-parse-review` | Agent + Skill + Bin script | Adversarial multi-round replaces single pass        |
| `orchestrator.sh`           | `agents/pipeline-orchestrator.md` + all bin scripts                               | Agent + Bin scripts        | Agent for judgment, scripts for deterministic ops   |
| `completion.sh` (summary)   | `bin/pipeline-summary`                                                            | Bin script                 | Richer output with quality metrics + cost           |
| `completion.sh` (cleanup)   | `bin/pipeline-cleanup`                                                            | Bin script                 | Same behavior, adds worktree cleanup                |
| `repository.sh`             | `bin/pipeline-branch` + `branch-protection` hook                                  | Bin script + Hook          | Hook replaces agent-instruction branch protection   |
| `multi-prd.sh`              | `bin/pipeline-fetch-prd` + orchestrator agent                                     | Bin script + Agent         | Script fetches, agent discovers issues              |
| `lock.sh`                   | `bin/pipeline-lock` (secondary) + worktree isolation (primary)                    | Bin script + native        | Worktree isolation is the primary mechanism         |
| `usage.sh`                  | `bin/pipeline-quota-check` + `bin/pipeline-model-router`                          | Bin scripts                | Quota-aware wait / graceful-exit routing            |
| `utils.sh`                  | `bin/pipeline-lib.sh`                                                             | Bin script (shared lib)    | Same utility functions, adapted for plugin env vars |
| `validator.sh`              | `bin/pipeline-validate`                                                           | Bin script                 | Adds plugin-specific checks                         |
| `scaffolding.sh`            | `bin/pipeline-init`                                                               | Bin script                 | Creates richer state structure                      |
| `config-deployer.sh`        | `.claude-plugin/plugin.json` + `settings.json`                                    | Plugin manifest            | Native plugin config replaces custom deployer       |
| `docs-update.sh`            | Bundled `scribe` agent                                                            | Bundled agent              | Enforced final step before pipeline-cleanup         |
| `settings.sh`               | `plugin.json` userConfig                                                          | Plugin manifest            | Native userConfig replaces custom settings          |

---

## Existing `.claude/` Integration

### Hooks (fire automatically)

The user's existing hooks in `.claude/settings.json` fire automatically for ALL plugin agents. No duplication needed:

| Existing Hook                    | Effect on Pipeline                           |
| -------------------------------- | -------------------------------------------- |
| `claude-dir-check`               | Ensures .claude/ directory integrity         |
| `protected-files-check`          | Prevents modification of protected files     |
| `sql-readonly-check`             | Blocks destructive SQL in Bash commands      |
| `compound-check`                 | Validates compound Bash commands             |
| `dangerous-patterns-check`       | Blocks rm -rf, chmod 777, etc.               |
| `native-tool-nudge`              | Reminds agents to use native tools over Bash |
| `pre-commit-check` (60s timeout) | Runs lint, format, type-check on commit      |
| `pre-push-check` (900s timeout)  | Full test suite on push                      |
| PostToolUse: Prettier            | Auto-formats after Edit/Write                |
| Stop: vitest                     | Runs vitest suite on session end             |

### Skills (injected via frontmatter)

| Existing Skill | Used By                | Injection                                                              |
| -------------- | ---------------------- | ---------------------------------------------------------------------- |
| `prd-to-spec`  | `spec-generator` agent | Listed in `skills:` frontmatter → SKILL.md injected into agent context |

### Agents (spawned by reference)

All existing agents listed in the "Existing Agents Reused Directly" section above are spawned via the `Agent` tool by name. The orchestrator and spec-generator agents include these in their `tools:` list which includes `Agent`.
