#!/usr/bin/env bash
# orchestrator.sh — structural validation of agents/pipeline-orchestrator.md:
# frontmatter, required sections, script/agent references, spec-handoff
# contract, execution-loop shape.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ORCH="$PLUGIN_ROOT/agents/pipeline-orchestrator.md"
SPECGEN="$PLUGIN_ROOT/agents/spec-generator.md"

pass=0
fail=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

assert_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF "$needle" "$file"; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (file does not contain '$needle')"
    fail=$((fail + 1))
  fi
}

assert_file_exists() {
  local label="$1" file="$2"
  if [[ -f "$file" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label ('$file' does not exist)"
    fail=$((fail + 1))
  fi
}

# ============================================================
echo "=== pipeline-orchestrator.md — file exists ==="

assert_file_exists "orchestrator file exists" "$ORCH"

# ============================================================
echo ""
echo "=== frontmatter validation ==="

# Extract frontmatter (between first two --- lines)
frontmatter=$(awk '/^---$/{c++; next} c==1{print}' "$ORCH")

assert_contains "model: opus" "model: opus" "$ORCH"
assert_contains "maxTurns: 9999" "maxTurns: 9999" "$ORCH"

desc=$(printf '%s' "$frontmatter" | grep -E '^description:' || echo "")
assert_eq "description non-empty" "true" "$([[ -n "$desc" ]] && echo true || echo false)"

when=$(printf '%s' "$frontmatter" | grep -E '^whenToUse:' || echo "")
assert_eq "whenToUse non-empty" "true" "$([[ -n "$when" ]] && echo true || echo false)"

# tools list
for tool in Bash Read Write Edit Grep Glob Agent; do
  if printf '%s' "$frontmatter" | grep -q "^\s*-\s*${tool}\s*$"; then
    echo "  PASS: tools contains $tool"
    pass=$((pass + 1))
  else
    echo "  FAIL: tools missing $tool"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== required sections ==="

sections=(
  "## Core Principle"
  "## Startup"
  "## Spec Generation Phase"
  "## Execution Sequence"
  "## Human Review Levels"
  "## Parallel Execution"
  "## Resume"
  "## Failure Handling"
  "## Circuit Breaker"
  "## Rate Limit Recovery"
  "## Security Tier Extra Review"
  "## State Management"
  "## Rules"
)

for section in "${sections[@]}"; do
  if grep -qF "$section" "$ORCH"; then
    echo "  PASS: section $section"
    pass=$((pass + 1))
  else
    echo "  FAIL: missing section $section"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== script reference integrity ==="

# Every pipeline-* script mentioned in the orchestrator must exist in bin/
scripts=(
  pipeline-state
  pipeline-circuit-breaker
  pipeline-fetch-prd
  pipeline-validate-spec
  pipeline-validate-tasks
  pipeline-quota-check
  pipeline-classify-task
  pipeline-classify-risk
  pipeline-model-router
  pipeline-build-prompt
  pipeline-quality-gate
  pipeline-coverage-gate
  pipeline-detect-reviewer
  pipeline-parse-review
  pipeline-gh-comment
  pipeline-wait-pr
  pipeline-summary
  pipeline-cleanup
)

for script in "${scripts[@]}"; do
  if grep -q "\b${script}\b" "$ORCH"; then
    if [[ -f "$PLUGIN_ROOT/bin/$script" ]]; then
      echo "  PASS: $script referenced and exists"
      pass=$((pass + 1))
    else
      echo "  FAIL: $script referenced but not in bin/"
      fail=$((fail + 1))
    fi
  else
    echo "  FAIL: $script not referenced in orchestrator"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== agent references ==="

# Must reference the bundled reviewer agents
assert_contains "references task-executor" "task-executor" "$ORCH"
assert_contains "references task-reviewer" "task-reviewer" "$ORCH"
assert_contains "references spec-generator" "spec-generator" "$ORCH"
assert_contains "references code-reviewer for security tier" "code-reviewer" "$ORCH"

# Each agent file must exist in the plugin
for agent in task-executor task-reviewer spec-generator code-reviewer spec-reviewer; do
  assert_file_exists "agent file $agent.md exists" "$PLUGIN_ROOT/agents/$agent.md"
done

# ============================================================
echo ""
echo "=== parallel execution semantics ==="

# The orchestrator must describe emitting multiple Agent calls in a single message
assert_contains "documents parallel Agent spawn" "multiple Agent tool calls in a single" "$ORCH"
assert_contains "references parallel_group" "parallel_group" "$ORCH"
assert_contains "references execution_order" "execution_order" "$ORCH"
assert_contains "references maxConcurrent" "maxConcurrent" "$ORCH"

# ============================================================
echo ""
echo "=== spec handoff contract (plan 03) ==="

# spec-generator must document a worktree handoff protocol (plan 03, task_03_02)
assert_file_exists "spec-generator.md exists" "$SPECGEN"
assert_contains "spec-generator documents output path contract" "Output Path Contract" "$SPECGEN"
assert_contains "spec-generator has Handoff Protocol section" "## Handoff Protocol" "$SPECGEN"
assert_contains "spec-generator creates spec-handoff/<run_id> branch" "spec-handoff/" "$SPECGEN"
assert_contains "spec-generator writes .spec.handoff_branch" ".spec.handoff_branch" "$SPECGEN"
assert_contains "spec-generator writes .spec.handoff_ref" ".spec.handoff_ref" "$SPECGEN"
assert_contains "spec-generator writes .spec.path" ".spec.path" "$SPECGEN"
assert_contains "spec-generator mentions pipeline-state as cross-worktree channel" "pipeline-state" "$SPECGEN"

# Orchestrator must reference the handoff mechanism explicitly (plan 03, task_03_02)
assert_contains "orchestrator references spec-handoff branch" "spec-handoff/" "$ORCH"
assert_contains "orchestrator reads .spec.handoff_branch" ".spec.handoff_branch" "$ORCH"
assert_contains "orchestrator reads .spec.handoff_ref" ".spec.handoff_ref" "$ORCH"
assert_contains "orchestrator references commit-spec" "commit-spec" "$ORCH"
assert_contains "orchestrator references .spec.path from state" ".spec.path" "$ORCH"

# ============================================================
echo ""
echo "=== task_07_04: orchestrator execution loop structure ==="

# Each numbered step heading must be present
for hdr in "Pre-flight" "Execute" "Quality Gate" "Spawn Reviewers" "Parse Verdicts" "Create PR & Wait" "Finalize"; do
  assert_contains "execution step '$hdr'" "$hdr" "$ORCH"
done

# Quality-gate script must be referenced
assert_contains "references pipeline-quality-gate" "pipeline-quality-gate" "$ORCH"

# Escalation transitions to needs_human_review must be referenced
assert_contains "references needs_human_review" "needs_human_review" "$ORCH"

# Parallel spawn instruction must remain
assert_contains "instructs parallel Agent spawn" "one assistant message with N Agent calls" "$ORCH"

# Namespaced attempt counters
assert_contains "quality_attempts counter" "quality_attempts" "$ORCH"
assert_contains "review_attempts counter" "review_attempts" "$ORCH"

# Prior-work handoff into resume context
assert_contains "prior_work_dir handoff" "prior_work_dir" "$ORCH"

# Layer 4 holdout validation orchestration must be wired
assert_contains "Layer 4 holdout step labelled 3b"     "Holdout Validation"        "$ORCH"
assert_contains "calls pipeline-holdout-validate prompt" "pipeline-holdout-validate prompt" "$ORCH"
assert_contains "calls pipeline-holdout-validate check"  "pipeline-holdout-validate check"  "$ORCH"
assert_contains "tracks holdout_attempts retry counter"  "holdout_attempts"          "$ORCH"

# review_attempts must be read at the top of step 5 so first-pass
# NEEDS_DISCUSSION can reference it without a shell-level unset error.
assert_contains "review_attempts read before verdict branch" \
  'review_attempts=$(pipeline-state read $run_id ".tasks.$t.review_attempts // 0")' "$ORCH"

# Final-rollup PR step must capture an integer PR number, not the create URL.
assert_contains "final_pr_number captured via gh pr view" \
  'final_pr_number=$(gh pr view staging --json number -q .number)' "$ORCH"

# ============================================================
echo ""
echo "=== pipeline-metrics MCP server ==="

METRICS="$PLUGIN_ROOT/servers/pipeline-metrics/index.js"
assert_file_exists "metrics index.js exists" "$METRICS"

# Removed: model_switch is no longer a valid event type (Ollama routing
# was deleted in 0.3.0; the dispatcher should reject the legacy value).
if grep -q '"model_switch"' "$METRICS"; then
  echo "  FAIL: metrics still references removed event type 'model_switch'"
  fail=$((fail + 1))
else
  echo "  PASS: metrics no longer accepts removed event type 'model_switch'"
  pass=$((pass + 1))
fi

assert_contains "HandlerInputError class declared" "class HandlerInputError" "$METRICS"
assert_contains "_requireString validator declared" "function _requireString" "$METRICS"
assert_contains "_parseStoredData helper declared"  "function _parseStoredData" "$METRICS"
assert_contains "dispatcher try/catch wraps handlers" "if (err instanceof HandlerInputError)" "$METRICS"
assert_contains "input_validation kind surfaced"    "kind: \"input_validation\"" "$METRICS"
assert_contains "internal_error kind surfaced"      "kind: \"internal_error\""   "$METRICS"
assert_contains "isError propagated to MCP response" "isError: true,"            "$METRICS"

# Node syntax check — server is zero-dep, so --check is sufficient.
if node --check "$METRICS" >/dev/null 2>&1; then
  echo "  PASS: metrics index.js parses (node --check)"
  pass=$((pass + 1))
else
  echo "  FAIL: metrics index.js failed node --check"
  fail=$((fail + 1))
fi

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

[[ $fail -eq 0 ]] && exit 0 || exit 1
