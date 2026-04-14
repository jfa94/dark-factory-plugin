# Dark Factory Plugin — Quality Gates, Review Gates & Configuration

## 5-Layer Quality Gate Stack

Every task-executor output passes through all 5 layers before review. Layers are sequential — a failure at any layer blocks progression to the next.

### Layer 1: Static Analysis

**Purpose:** Catch syntax errors, lint violations, type errors, formatting issues before tests run.

**Trigger:** Automatic — fires on every commit attempt via existing user hooks.

**Plugin component:** None needed. The user's existing `.claude/` hooks fire automatically for all plugin agents:

- `pre-commit-check` hook (60s timeout): lint, format, type check
- `dangerous-patterns-check`: blocks known dangerous code patterns
- `compound-check`: multi-rule validation
- Prettier PostToolUse hook: auto-formats after Edit/Write

**Pass criteria:** All hooks exit 0.

**Failure action:** task-executor receives hook error output, fixes the issue, retries commit. Max 3 internal retries.

**Why this works:** Hooks are un-bypassable. Agent instructions to "follow coding standards" are followed ~70% of the time; hooks enforce at 100%.

### Layer 2: Test Suite

**Purpose:** Verify implementation correctness against existing and new tests.

**Trigger:** Automatic — existing Stop hook runs vitest when agent session ends.

**Plugin component:** None needed. User's existing Stop hook handles this.

**Pass criteria:** All tests pass (exit 0).

**Failure action:** task-executor receives test output, fixes failing tests or implementation. Max 3 internal retries. CRITICAL: never modify existing tests to make them pass — fix the implementation.

**Evidence:** AI-generated code has 67.3% PR rejection rate (LinearB) — most failures are caught here.

### Layer 3: Coverage Regression

**Purpose:** Ensure new code doesn't decrease test coverage. Agents are known to delete failing tests to improve metrics — this catches that.

**Trigger:** After test suite passes. Called by orchestrator.

**Plugin component:** `bin/pipeline-coverage-gate` (deterministic script)

**Interface:**

```
pipeline-coverage-gate <before.json> <after.json>
  Exit 0: coverage maintained or increased
  Exit 1: coverage decreased (stdout: diff details)
```

**Pass criteria:** Line coverage, branch coverage, and function coverage must not decrease vs baseline.

**Failure action:** task-executor must add tests to restore coverage. Orchestrator re-runs coverage gate after fix.

**Evidence:** "Coverage as regression signal" — treat coverage as a floor, not an optimization target. Research shows AI agents delete failing tests rather than fixing implementations when under pressure.

### Layer 4: Holdout Validation

**Purpose:** Verify that the implementation genuinely satisfies the spec, not just the explicit instructions. Withhold a percentage of acceptance criteria from the task-executor, then check if those criteria are met anyway.

**Trigger:** After coverage gate passes. Called by orchestrator.

**Plugin components:**

- `bin/pipeline-build-prompt --holdout N%` — deterministically selects and withholds N% of acceptance criteria from the task prompt. Withheld criteria stored in `${CLAUDE_PLUGIN_DATA}/holdouts/{run_id}/{task_id}.json`
- Holdout evaluation — orchestrator (or dedicated subagent) reviews implementation against withheld criteria

**Pass criteria:** ≥80% of withheld criteria are satisfied without being explicitly requested. Threshold configurable via `userConfig.quality.holdoutPassRate`.

**Failure action:** If <80% holdout criteria met, the implementation is surface-level (satisfies letter but not spirit of spec). Task-executor receives the full spec (including previously withheld criteria) and re-implements. Holdout validation is NOT repeated on re-implementation (would be unfair).

**Evidence:** StrongDM Attractor pattern: 6-7K NLSpec → 32K+ production code. Holdout validation catches "teaching to the test" — implementations that literally do only what's asked without understanding the broader requirement.

### Layer 5: Mutation Testing

**Purpose:** Verify test quality by measuring mutation score. AI-generated tests often achieve high line coverage but low mutation scores (tautological tests that assert what was written, not what should work).

**Trigger:** After holdout validation passes. Called by orchestrator. ONLY for feature-tier and security-tier tasks (skip for routine).

**Plugin component:** Orchestrator spawns existing `test-writer` agent to kill surviving mutants.

**Pass criteria:** Mutation score ≥80% (configurable via `userConfig.quality.mutationScoreTarget`).

**Failure action:** `test-writer` agent generates targeted tests for surviving mutants. Re-run mutation testing. Max 2 rounds of mutation test improvement.

**Evidence:** AI-generated tests: 85-95% line coverage but only 30-40% mutation scores. Industry target: >80%. AI code has 15-25% higher mutation survival rates than human code.

---

## Adversarial Code Review Design

**This is the most important step in the pipeline.** The review gate is the last defense before code reaches a pull request. It must be adversarial — actively trying to break code, not just validating it.

### Actor-Critic Pattern

The review follows the Actor-Critic adversarial pattern:

- **Actor (Builder)** = task-executor agent. Optimistic, fast implementation. Knows the spec, has implementation context.
- **Critic (Reviewer)** = task-reviewer agent or Codex. Paranoid adversary. Reviews COLD — zero knowledge of implementation process, zero ability to modify code to ease validation. Treats produced code as a hostile artifact.

The asymmetry is critical: the Critic has different incentives than the Actor. The Critic's job is to find ALL issues, not to be helpful or encouraging. This breaks the "echo chamber" where a single agent validates its own work.

### Multi-Round Review Loop

```
Round 1: Critic reviews → finds issues → REQUEST_CHANGES
Round 2: Actor fixes → Critic re-reviews → finds fewer issues → REQUEST_CHANGES
Round 3: Actor fixes → Critic re-reviews → APPROVE (or escalate)
```

**Round configuration by risk tier:**

| Risk Tier | Cloud Max Rounds | Ollama Max Rounds | Additional Reviewers                          | Cost Estimate (API/overage only) |
| --------- | ---------------- | ----------------- | --------------------------------------------- | -------------------------------- |
| Routine   | 2                | 15                | None                                          | ~$0.05-$0.10                     |
| Feature   | 4                | 20                | None                                          | ~$0.20-$0.50                     |
| Security  | 6                | 25                | `security-reviewer` + `architecture-reviewer` | ~$0.50-$1.00                     |

**Note:** Cost estimates apply only when billing via API key or extra usage overage. Subscription allowance users show $0 cost (pre-paid flat rate). Billing mode is auto-detected from response headers (`unified-*` = subscription, standard `ratelimit-*` = API).

**Exit conditions:**

- APPROVE → exit loop, proceed to PR
- REQUEST_CHANGES + rounds remaining → Actor fixes, re-review
- REQUEST_CHANGES + max rounds reached → escalate to human
- NEEDS_DISCUSSION → escalate to human immediately (ambiguity requires human judgment)

**Evidence:** Actor-Critic eliminates 90%+ issues in 3-5 rounds. Autonoma: 73% more issues caught, 71% fewer bugs, 42% less review time. Cost: ~$0.20-$1.00/feature vs $50-$100/hr human review (50-500x savings).

### Codex-First Detection

The pipeline checks for OpenAI Codex availability FIRST because Codex has a purpose-built adversarial review mode designed specifically for pressure-testing assumptions.

**Detection script:** `bin/pipeline-detect-reviewer` (deterministic)

```
pipeline-detect-reviewer
  Checks:
    1. command -v codex  → Codex CLI installed?
    2. codex status --auth → authenticated?
  Output (stdout JSON):
    If both pass:  {"reviewer": "codex", "command": "codex adversarial-review --base <ref> --wait"}
    If either fail: {"reviewer": "claude-code", "agent": "task-reviewer"}
  Exit 0 always (detection never fails, just selects fallback)
```

**Codex review invocation:**

- `/codex:adversarial-review --base <ref> --wait` (synchronous)
- `/codex:adversarial-review --base <ref> --background` (asynchronous)
- Codex adversarial mode specifically pressure-tests assumptions, checks for edge cases, and performs threat modeling

**Claude Code fallback:**

- Spawn `task-reviewer` agent with `review-protocol` skill injected
- OR spawn existing `code-reviewer` agent with `review-protocol` skill for non-pipeline reviews
- Both produce output normalized by `pipeline-parse-review`

### review-protocol Skill

The `review-protocol` skill injects Actor-Critic methodology into whichever reviewer is selected. It provides consistent review behavior regardless of vendor.

**Skill instructions include:**

1. **Adversarial posture** — treat code as a hostile artifact. Assume it's wrong until proven correct.
2. **Security audit** — check for injection, XSS, auth bypass, secret exposure, OWASP Top 10
3. **Acceptance criteria verification** — check every criterion is genuinely satisfied (not just superficially)
4. **AI anti-pattern detection:**
   - Hallucinated APIs (calling functions/methods that don't exist)
   - Over-abstraction (premature helpers, unnecessary indirection)
   - Copy-paste drift (similar but subtly different code blocks)
   - Dead code (unused imports, unreachable branches)
   - Excessive I/O (unnecessary file reads, redundant API calls)
   - Sycophantic generation (code that looks good but doesn't work)
   - Infinite code problem (unbounded growth without convergence)
5. **Structured verdict output** — must output APPROVE, REQUEST_CHANGES, or NEEDS_DISCUSSION with specific findings

### Verdict Normalization

`bin/pipeline-parse-review` (deterministic script) normalizes output from both Codex and Claude Code reviewers:

```
pipeline-parse-review
  Input: stdin (raw reviewer output — Codex JSON or Claude Code text)
  Output: stdout JSON
    {
      "verdict": "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION",
      "findings": [
        {
          "severity": "critical" | "major" | "minor" | "suggestion",
          "file": "src/auth.ts",
          "line": 42,
          "description": "SQL injection via unsanitized user input",
          "category": "security" | "correctness" | "performance" | "style" | "anti-pattern"
        }
      ],
      "round": 1,
      "reviewer": "codex" | "claude-code",
      "summary": "..."
    }
  Exit 0: parsed successfully
  Exit 1: parse failure (raw output preserved in state for debugging)
```

---

## Human Review Gate Design

Configurable levels of human oversight, controlled by `userConfig.humanReviewLevel`:

### Level 0: Full Autonomy

Pipeline creates PR and enables auto-merge. Human reviews merged code post-hoc.

- Adversarial review must APPROVE
- All quality gates must pass
- **Risk:** bugs reach main branch before human review
- **Use case:** low-risk routine tasks, strong test coverage, trusted codebase

### Level 1: PR Approval (default)

Pipeline runs end-to-end, creates PR. Human reviews and merges.

- Pipeline provides: diff, review summary, quality gate results, metrics
- Human decides: merge, request changes, or close
- **Use case:** standard autonomous workflow

### Level 2: Review Checkpoint

Pipeline pauses after adversarial code review, before PR creation. Human signs off on the reviewed code.

- Human sees: code diff + all review round results + quality gate results
- Human decides: proceed to PR, request more changes, or abort
- **Use case:** solo dev who trusts spec but wants to see code before PR

### Level 3: Spec Approval

Pipeline pauses after spec generation. Human reviews spec + tasks.json before execution begins.

- Human sees: spec document + task decomposition + dependency graph
- Human decides: approve spec (execution begins), revise spec, or abort
- **Use case:** team repos where architecture decisions need sign-off

### Level 4: Full Supervision

Human approves at every stage: spec review, task decomposition, each task execution, each review round, PR creation.

- Pipeline pauses at each gate, presents results, waits for human
- **Use case:** first run on a new codebase, learning the pipeline's behavior

---

## `userConfig` Schema

Complete schema for all tunables in `plugin.json`. These are user-configurable values that control pipeline behavior.

```yaml
userConfig:
  # === Pipeline Behavior ===
  maxTasks:
    type: number
    default: 20
    min: 1
    max: 100
    description: "Maximum tasks per run (circuit breaker threshold)"

  maxRuntimeMinutes:
    type: number
    default: 360
    min: 10
    max: 1440
    description: "Maximum pipeline runtime in minutes before circuit breaker trips"

  maxConsecutiveFailures:
    type: number
    default: 3
    min: 1
    max: 10
    description: "Consecutive task failures before pipeline aborts"

  humanReviewLevel:
    type: number
    default: 1
    min: 0
    max: 4
    description: "Human oversight level (0=full autonomy, 1=PR approval, 2=review checkpoint, 3=spec approval, 4=full supervision)"

  maxParallelTasks:
    type: number
    default: 3
    min: 1
    max: 10
    description: "Maximum concurrent task-executor agents"

  # === Code Review ===
  review.routineRounds:
    type: number
    default: 2
    min: 1
    max: 5
    description: "Review rounds for routine-tier tasks (cloud)"

  review.featureRounds:
    type: number
    default: 4
    min: 1
    max: 10
    description: "Maximum adversarial review rounds for feature-tier tasks (cloud)"

  review.securityRounds:
    type: number
    default: 6
    min: 1
    max: 10
    description: "Maximum adversarial review rounds for security-tier tasks (cloud)"

  review.ollamaRoutineRounds:
    type: number
    default: 15
    min: 5
    max: 50
    description: "Review rounds for routine-tier tasks when running on Ollama"

  review.ollamaFeatureRounds:
    type: number
    default: 20
    min: 5
    max: 50
    description: "Review rounds for feature-tier tasks when running on Ollama"

  review.ollamaSecurityRounds:
    type: number
    default: 25
    min: 5
    max: 50
    description: "Review rounds for security-tier tasks when running on Ollama"

  review.preferCodex:
    type: boolean
    default: true
    description: "Use Codex adversarial review when available, fall back to Claude Code"

  # === Quality Gates ===
  quality.holdoutPercent:
    type: number
    default: 20
    min: 0
    max: 50
    description: "Percentage of acceptance criteria to withhold for holdout validation"

  quality.holdoutPassRate:
    type: number
    default: 80
    min: 50
    max: 100
    description: "Minimum % of withheld criteria that must be satisfied"

  quality.mutationScoreTarget:
    type: number
    default: 80
    min: 50
    max: 100
    description: "Minimum mutation score percentage"

  quality.mutationTestingTiers:
    type: array
    default: ["feature", "security"]
    description: "Risk tiers that require mutation testing (skip for routine)"

  quality.coverageMustNotDecrease:
    type: boolean
    default: true
    description: "Block tasks that decrease test coverage"

  quality.coverageRegressionTolerancePct:
    type: number
    default: 0.5
    min: 0
    max: 10
    description: "Max coverage drop (percentage points) before the regression gate fails. Default 0.5 absorbs measurement noise from branch/line count shifts. Not a minimum-coverage floor."

  # === Task Execution ===
  execution.defaultModel:
    type: string
    default: "sonnet"
    enum: ["haiku", "sonnet", "opus"]
    description: "Default model for task execution (overridden by complexity classification)"

  execution.modelByTier.simple:
    type: string
    default: "haiku"
    enum: ["haiku", "sonnet", "opus"]
    description: "Model used for tasks classified as simple tier"

  execution.modelByTier.medium:
    type: string
    default: "sonnet"
    enum: ["haiku", "sonnet", "opus"]
    description: "Model used for tasks classified as medium tier"

  execution.modelByTier.complex:
    type: string
    default: "opus"
    enum: ["haiku", "sonnet", "opus"]
    description: "Model used for tasks classified as complex tier"

  execution.maxTurnsSimple:
    type: number
    default: 40
    min: 10
    max: 200
    description: "Max turns for simple/haiku-tier tasks"

  execution.maxTurnsComplex:
    type: number
    default: 80
    min: 20
    max: 200
    description: "Max turns for complex/opus-tier tasks"

  execution.maxTurnsMedium:
    type: number
    default: 60
    min: 20
    max: 200
    description: "Max turns for medium/sonnet-tier tasks"

  execution.maxOrchestratorTurns:
    type: number
    default: 500
    min: 50
    max: 9999
    description: "Circuit-breaker threshold on orchestrator assistant turns. Enables graceful wind-down before the runtime maxTurns cap; default 500 = ~50% headroom over the 334-turn moderate-friction estimate for a 20-task pipeline."

  # === Local LLM Fallback ===
  localLlm.enabled:
    type: boolean
    default: false
    description: "Enable Ollama fallback when Anthropic rate limits approach"

  localLlm.ollamaUrl:
    type: string
    default: "http://localhost:11434"
    description: "Ollama server URL — local or remote (e.g., http://192.168.1.50:11434)"

  localLlm.model:
    type: string
    default: "qwen2.5-coder:14b"
    description: "Ollama model tag (auto-pulled on first use if not present on server)"

  localLlm.useLiteLlm:
    type: boolean
    default: false
    description: "Use LiteLLM proxy for unified routing instead of direct Ollama"

  localLlm.liteLlmUrl:
    type: string
    default: "http://localhost:4000"
    description: "LiteLLM proxy URL (only used if useLiteLlm is true)"

  # === Dependencies ===
  dependencies.prMergeTimeout:
    type: number
    default: 45
    min: 5
    max: 180
    description: "Minutes to wait for dependency PR to merge"

  dependencies.pollInterval:
    type: number
    default: 60
    min: 10
    max: 300
    description: "Seconds between merge status polls"

  # === Observability ===
  observability.auditLog:
    type: boolean
    default: true
    description: "Enable tamper-evident audit logging of all tool uses"

  observability.metricsExport:
    type: string
    default: "json"
    enum: ["json", "sqlite"]
    description: "Metrics storage format"

  observability.metricsRetentionDays:
    type: number
    default: 90
    min: 7
    max: 365
    description: "Days to retain metrics data"

  # === Safety ===
  safety.writeBlockedPaths:
    type: array
    default: []
    description: "Glob patterns (bash globstar + extglob) that the PreToolUse write-protection hook must refuse. Empty by default — opt in per project by adding entries like `**/migrations/**` or `.env*`."

  safety.useTruffleHog:
    type: boolean
    default: false
    description: "When true, the secret-commit-guard hook runs `trufflehog filesystem --only-verified` before every `git commit` in addition to the built-in path + regex scans. Findings are filtered through safety.allowedSecretPatterns. If trufflehog is not installed the hook warns and continues with regex-only scanning."

  safety.allowedSecretPatterns:
    type: array
    default: []
    description: "Regex patterns for known-safe secret-like strings (e.g. Supabase anon keys). Path matches, content-regex hits, and TruffleHog findings whose raw value matches any pattern are filtered out before deciding whether to block a commit."
```

---

## Local LLM Fallback Configuration

### Detection Flow

Usage data comes from `unified-*` response headers saved to `${CLAUDE_PLUGIN_DATA}/last-headers.json` after each Claude API call. No separate OAuth API call is needed.

**Header sources:**

- Subscription users (Pro/Max): `anthropic-ratelimit-unified-5h-utilization`, `anthropic-ratelimit-unified-7d-utilization`, `anthropic-ratelimit-unified-status`, `is_using_overage`
- API key users: standard `anthropic-ratelimit-*` headers — 5h pacing only, no 7d tracking

**Cold start** (no `last-headers.json`): run a minimal probe (`claude -p "ok" --max-turns 1 --model haiku`) to populate initial headers before the first task.

```
Before each task-executor spawn:
  1. pipeline-quota-check
     → Read: ${CLAUDE_PLUGIN_DATA}/last-headers.json
     → Parse unified-* headers (subscription) OR ratelimit-* headers (API)
     → Calculate 5h position: window_hour = floor((now - (resets_at_5h - 5h)) / 3600) + 1  [1-5]
                               hourly_threshold = min(window_hour * 0.20, 0.90)
     → Calculate 7d position: window_day = floor((now - (resets_at_7d - 7d)) / 86400) + 1  [1-7]
                               thresholds = [0.142, 0.286, 0.429, 0.571, 0.714, 0.857, 0.95]
                               daily_threshold = thresholds[window_day - 1]
     → Detect billing mode: unified-* present + is_using_overage=false → "subscription"
                             unified-* present + is_using_overage=true  → "overage"
                             ANTHROPIC_API_KEY set (no unified-* headers) → "api"
     → Output: {
         "five_hour":  { "utilization": N, "hourly_threshold": T, "over_threshold": bool,
                         "resets_at": "...", "window_hour": N },
         "seven_day":  { "utilization": N, "daily_threshold": T, "over_threshold": bool,
                         "resets_at": "...", "window_day": N },
         "billing_mode": "subscription|overage|api"
       }

  2. pipeline-model-router --quota <quota-check-output> --task-tier <tier>
     → Reads pipeline-quota-check output
     → Composes 5h and 7d results (both checked independently):

       CASE: both within limits
         → provider: anthropic (normal path)

       CASE: 5h over threshold, 7d within limits
         → If localLlm.enabled AND Ollama available:
              provider: ollama (elevated review caps apply: routine=15, feature=20, security=25)
              (Ollama continues until 5h window resets)
              If Ollama exhausts max rounds without passing review:
                → wait for 5h reset, then retry on Claude
         → If localLlm.disabled OR Ollama unavailable:
              → wait (sleep until next hour boundary, max-wait configurable)
              → retry with Claude

       CASE: 7d over threshold (regardless of 5h)
         → If localLlm.enabled AND Ollama available:
              provider: ollama (elevated review caps apply: routine=15, feature=20, security=25)
              (Ollama continues until next daily threshold)
              If Ollama exhausts max rounds without passing review:
                → end gracefully (see graceful exit below)
         → If localLlm.disabled OR Ollama unavailable:
              → end gracefully (see graceful exit below)

       CASE: both over threshold
         → 7d behavior takes precedence
         → If localLlm.enabled AND Ollama available: → ollama (elevated caps)
         → Else: → end gracefully

  3. If provider = ollama:
     → Check: curl -sf ${ollamaUrl}/api/tags → model available?
     → Check: curl -sf ${ollamaUrl}/api/ps → model loaded?
     → Spawn task-executor with env overrides:
          ANTHROPIC_BASE_URL=http://localhost:11434/v1
          ANTHROPIC_AUTH_TOKEN=dummy
     → Use tier-specific review cap (not cloud cap)

  4. Graceful exit (7d limit with no Ollama fallback, or Ollama failed):
     → Stop spawning new tasks
     → Let in-flight tasks complete
     → Mark run status as "partial"
     → Update state.json with resume-point so /dark-factory:run resume can continue
        when the next daily threshold allows cloud model usage
     → Print summary to user: utilization, next threshold, expected reset time
```

### Model Recommendations

| VRAM  | Model                            | Disk  | Quality                    | Use Case                                          |
| ----- | -------------------------------- | ----- | -------------------------- | ------------------------------------------------- |
| 8GB   | Qwen 2.5-Coder 7B                | 4.7GB | Good for simple tasks      | Routine-tier: rename, config changes, simple CRUD |
| 16GB+ | Qwen 2.5-Coder 14B **(default)** | 9GB   | Good for code gen + review | Routine + feature tasks                           |
| 24GB+ | Qwen 2.5-Coder 32B               | 20GB  | Near cloud-quality         | Most routine and some feature tasks               |

All sizes shown are Q4_K_M quantization (Ollama default). The 14B model uses ~10-12GB VRAM at inference — **16GB minimum** to allow headroom for KV cache and OS overhead. Configured via `localLlm.model`.

### Remote Ollama Support

To run Ollama on a separate machine on the same network:

**Server-side** (on the remote machine):

```bash
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

**Client-side** (in plugin userConfig):

```yaml
localLlm.ollamaUrl: "http://192.168.1.50:11434" # replace with server IP
```

Verify connectivity: `curl http://<server-ip>:11434/api/tags`

> **Security:** Ollama has no built-in auth. Only expose on a trusted LAN. Firewall the port to LAN-only or add a reverse proxy (nginx/caddy) with auth if needed.

Auto-pull works identically on remote — `POST /api/pull` triggers the download on the server. The plugin does not download to the local machine.

### Quality Constraints

- Ollama fallback is **limit-triggered only** — it activates when the 5h or 7d threshold is exceeded, not by user configuration
- All risk tiers (routine, feature, security) may run on Ollama when limits are triggered
- Local model quality is lower — compensated by elevated review caps per tier (routine=15, feature=20, security=25 rounds)
- Quality gate thresholds remain IDENTICAL regardless of model provider
- Local model output passes through the same 5-layer quality stack
- If Ollama exhausts its elevated review cap without passing: 5h trigger → wait for cloud; 7d trigger → end gracefully
- There are no user-configurable tier restrictions for Ollama; `localLlm.enabled` is the sole toggle
- On first use, `pipeline-model-router` validates Ollama connectivity and auto-pulls the configured model if not present

### Advanced: LiteLLM Proxy

Optional unified gateway for multi-provider routing:

- Install: `pip install litellm`
- Run: `litellm --config litellm_config.yaml`
- Config: fallback chain `["anthropic/claude-sonnet-4-20250514", "ollama/qwen2.5-coder:32b"]`
- Benefits: automatic fallback, cost tracking, latency logging, model-level observability
- Point Claude Code at `http://localhost:4000` instead of direct Ollama
- Trade-off: adds a dependency. Only recommended for teams or heavy usage.

---

## Observability & Metrics

### Audit Logging

**Hook:** `run-tracker` (PostToolUse on Bash|Write|Edit)

Every tool use by every agent in the pipeline is logged to `${CLAUDE_PLUGIN_DATA}/runs/{run_id}/audit.jsonl`. One JSON object per line:

```json
{
  "timestamp": "2026-04-06T03:14:15.926Z",
  "run_id": "run_abc123",
  "agent": "task-executor",
  "task_id": "task_3",
  "tool": "Write",
  "file": "src/auth.ts",
  "action": "create",
  "model": "sonnet",
  "provider": "anthropic",
  "tokens_in": 1500,
  "tokens_out": 800
}
```

**Tamper-evidence:** Each entry includes a SHA256 hash of the previous entry (hash chain). The first entry's hash is derived from the run_id + start timestamp. Any modification to historical entries breaks the chain.

**EU AI Act compliance (Aug 2026):**

- Tamper-evident logs ✓ (hash chain)
- Delegation chains ✓ (agent → subagent → tool traced)
- Model provenance ✓ (model + provider logged per action)
- Human oversight records ✓ (human review level + approval timestamps)

### Metrics MCP Server

**Server:** `pipeline-metrics` (defined in `.mcp.json`)

**Storage:** Local SQLite or JSON (configurable via `observability.metricsExport`)

**Tools exposed:**

- `record` — write a metric event
- `query` — read metrics with filters (run_id, task_id, date range, event_type)
- `export` — dump all metrics for a run as JSON

**Metric schema:**

```json
{
  "run_id": "run_abc123",
  "task_id": "task_3",
  "timestamp": "2026-04-06T03:14:15.926Z",
  "event_type": "task_completed" | "review_round" | "quality_gate" | "model_switch" | "circuit_breaker",
  "model": "sonnet",
  "provider": "anthropic" | "ollama",
  "tokens_in": 15000,
  "tokens_out": 8000,
  "duration_ms": 45000,
  "cost_usd": 0.023,
  "verdict": "APPROVE",
  "quality_scores": {
    "coverage_delta": "+2.3%",
    "holdout_pass_rate": 0.85,
    "mutation_score": 0.82
  }
}
```

---

## Success Criteria

| Criterion                        | Target                                          | Measurement                                                   |
| -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| Feature parity                   | 100% of Bash pipeline features reproduced       | Checklist against 17 module feature inventory                 |
| Mutation score                   | >80% on generated code                          | Mutation testing framework output                             |
| Holdout pass rate                | >90% of runs pass holdout validation            | Metrics query over 10+ runs                                   |
| Adversarial review effectiveness | >70% of issues caught before human review       | Compare review findings vs post-merge bugs                    |
| Resume reliability               | 100% of interrupted runs resume correctly       | Test: kill pipeline mid-run, restart, verify completion       |
| Audit completeness               | 100% of tool uses logged                        | Compare audit.jsonl entry count vs actual tool calls          |
| Rate limit resilience            | <5min stall on rate limit (with Ollama enabled) | Measure time between rate limit detection and task resumption |
| Deterministic ratio              | ≥3:1 scripts-to-agents                          | Count component types in plugin                               |
