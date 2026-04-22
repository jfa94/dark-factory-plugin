#!/usr/bin/env bash
# run-command.sh — structural validation of commands/run.md:
# frontmatter, required sections, script/agent references, spec-handoff
# contract, execution-loop shape, orchestrator-worktree bootstrap.
#
# commands/run.md is the main-session orchestrator: it runs inline in the
# session that invoked /factory:run and spawns all sub-agents via Agent() +
# isolation: worktree. There is no pipeline-orchestrator sub-agent anymore.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# commands/run.md is now a thin dispatcher into skills/run-pipeline. Any
# orchestrator-body assertion should accept content from either the command
# file or the skill body (including its reference/ subdir). RUN_CMD points
# at a concatenation written to a tmp file so existing grep assertions still
# work without rewriting every assert_contains call site.
_RUN_CMD_SRC="$PLUGIN_ROOT/commands/run.md"
_RUN_SKILL_DIR="$PLUGIN_ROOT/skills/run-pipeline"
RUN_CMD=$(mktemp "${TMPDIR:-/tmp}/run-cmd-concat.XXXXXX.md")
{
  cat "$_RUN_CMD_SRC"
  printf '\n\n---- skill body ----\n\n'
  [[ -f "$_RUN_SKILL_DIR/SKILL.md" ]] && cat "$_RUN_SKILL_DIR/SKILL.md"
  if [[ -d "$_RUN_SKILL_DIR/reference" ]]; then
    for f in "$_RUN_SKILL_DIR/reference"/*.md; do
      [[ -f "$f" ]] && { printf '\n---- %s ----\n' "$(basename "$f")"; cat "$f"; }
    done
  fi
  if [[ -d "$_RUN_SKILL_DIR/prompts" ]]; then
    for f in "$_RUN_SKILL_DIR/prompts"/*.md; do
      [[ -f "$f" ]] && { printf '\n---- %s ----\n' "$(basename "$f")"; cat "$f"; }
    done
  fi
} > "$RUN_CMD"
trap 'rm -f "$RUN_CMD"' EXIT
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

assert_not_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF "$needle" "$file"; then
    echo "  FAIL: $label (file unexpectedly contains '$needle')"
    fail=$((fail + 1))
  else
    echo "  PASS: $label"
    pass=$((pass + 1))
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

assert_file_absent() {
  local label="$1" file="$2"
  if [[ ! -e "$file" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label ('$file' still exists)"
    fail=$((fail + 1))
  fi
}

# ============================================================
echo "=== commands/run.md — file exists ==="

assert_file_exists "run.md file exists" "$RUN_CMD"

# The old pipeline-orchestrator sub-agent must be gone — its logic lives in
# commands/run.md now.
assert_file_absent "no pipeline-orchestrator.md sub-agent" \
  "$PLUGIN_ROOT/agents/pipeline-orchestrator.md"

# ============================================================
echo ""
echo "=== frontmatter validation ==="

# commands/run.md frontmatter must declare the supported modes and flags.
frontmatter=$(awk '/^---$/{c++; next} c==1{print}' "$RUN_CMD")

desc=$(printf '%s' "$frontmatter" | grep -E '^description:' || echo "")
assert_eq "description non-empty" "true" "$([[ -n "$desc" ]] && echo true || echo false)"

for arg in mode --issue --task-id --spec-dir --strict --dry-run; do
  if printf '%s' "$frontmatter" | grep -qE "name:\s*\"?${arg}\"?"; then
    echo "  PASS: arguments declares $arg"
    pass=$((pass + 1))
  else
    echo "  FAIL: arguments missing $arg"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== orchestrator-worktree bootstrap ==="

# Orchestrator worktree creation lives in the run-pipeline skill now.
assert_contains "uses pipeline-branch worktree-create" "pipeline-branch worktree-create" "$RUN_CMD"
assert_contains "worktree path under .claude/worktrees" ".claude/worktrees/orchestrator-" "$RUN_CMD"
assert_contains "records worktree path in state" ".orchestrator.worktree" "$RUN_CMD"
assert_contains "records project_root in state" ".orchestrator.project_root" "$RUN_CMD"
assert_contains "removes orchestrator worktree on cleanup" 'worktree-remove "$orchestrator_wt"' "$RUN_CMD"

# There must be no residual delegation to a pipeline-orchestrator sub-agent.
assert_not_contains "no orchestrator sub-agent spawn" 'subagent_type: "pipeline-orchestrator"' "$RUN_CMD"

# ============================================================
echo ""
echo "=== required sections (skill-era) ==="

# Sections now live across commands/run.md + skills/run-pipeline/SKILL.md.
# Assert the protocol milestones by keyword, not literal markdown heading.
sections=(
  "Autonomy check"
  "Preconditions"
  "Mode dispatch"
  "Run init"
  "Dry run"
  "Orchestrator worktree"
  "Startup"
  "Spec Generation"
  "Execution"
  "Finalize-run"
  "Human review levels"
  "Resume"
  "Failure handling"
)

for section in "${sections[@]}"; do
  if grep -qFi "$section" "$RUN_CMD"; then
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

# Every pipeline-* script the orchestrator drives directly must exist in bin/.
# pipeline-quota-check and pipeline-model-router are invoked indirectly via
# pipeline_quota_gate in pipeline-lib.sh; they do not need to be named by
# the skill body, so are omitted here.
scripts=(
  pipeline-state
  pipeline-circuit-breaker
  pipeline-fetch-prd
  pipeline-validate
  pipeline-validate-tasks
  pipeline-classify-task
  pipeline-classify-risk
  pipeline-build-prompt
  pipeline-quality-gate
  pipeline-coverage-gate
  pipeline-detect-reviewer
  pipeline-parse-review
  pipeline-gh-comment
  pipeline-wait-pr
  pipeline-summary
  pipeline-cleanup
  pipeline-branch
  pipeline-human-gate
  pipeline-holdout-validate
  pipeline-init
  pipeline-scaffold
)

for script in "${scripts[@]}"; do
  if grep -q "\b${script}\b" "$RUN_CMD"; then
    if [[ -f "$PLUGIN_ROOT/bin/$script" ]]; then
      echo "  PASS: $script referenced and exists"
      pass=$((pass + 1))
    else
      echo "  FAIL: $script referenced but not in bin/"
      fail=$((fail + 1))
    fi
  else
    echo "  FAIL: $script not referenced in run.md"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== agent references ==="

# Must reference the bundled agent types it spawns.
assert_contains "references task-executor" "task-executor" "$RUN_CMD"
assert_contains "references task-reviewer" "task-reviewer" "$RUN_CMD"
assert_contains "references spec-generator" "spec-generator" "$RUN_CMD"
assert_contains "references code-reviewer for security tier" "code-reviewer" "$RUN_CMD"
assert_contains "references security-reviewer for security tier" "security-reviewer" "$RUN_CMD"
assert_contains "references architecture-reviewer" "architecture-reviewer" "$RUN_CMD"
assert_contains "references scribe for docs update" "scribe" "$RUN_CMD"
assert_contains "references test-writer for mutation retries" "test-writer" "$RUN_CMD"

# Each agent file must exist in the plugin.
for agent in task-executor task-reviewer spec-generator code-reviewer \
             security-reviewer architecture-reviewer scribe test-writer spec-reviewer; do
  assert_file_exists "agent file $agent.md exists" "$PLUGIN_ROOT/agents/$agent.md"
done

# ============================================================
echo ""
echo "=== parallel execution semantics ==="

assert_contains "documents parallel Agent spawn" "parallel" "$RUN_CMD"
assert_contains "mentions Agent() fan-out" "Agent()" "$RUN_CMD"
assert_contains "references parallel_group" "parallel_group" "$RUN_CMD"
assert_contains "references execution_order" "execution_order" "$RUN_CMD"
assert_contains "references maxConcurrent" "maxConcurrent" "$RUN_CMD"

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

# run.md must reference the handoff mechanism explicitly (plan 03, task_03_02)
assert_contains "run.md references spec-handoff branch" "spec-handoff/" "$RUN_CMD"
assert_contains "run.md reads .spec.handoff_branch" ".spec.handoff_branch" "$RUN_CMD"
assert_contains "run.md reads .spec.handoff_ref" ".spec.handoff_ref" "$RUN_CMD"
assert_contains "run.md references commit-spec" "commit-spec" "$RUN_CMD"
assert_contains "run.md references .spec.path from state" ".spec.path" "$RUN_CMD"

# ============================================================
echo ""
echo "=== task_07_04: execution loop structure ==="

# Each numbered step heading must be present
for hdr in "Pre-flight" "Execute" "Quality Gate" "Spawn Reviewers" "Parse Verdicts" "Create PR & Wait" "Finalize"; do
  assert_contains "execution step '$hdr'" "$hdr" "$RUN_CMD"
done

# Quality-gate script must be referenced
assert_contains "references pipeline-quality-gate" "pipeline-quality-gate" "$RUN_CMD"

# Escalation transitions to needs_human_review must be referenced
assert_contains "references needs_human_review" "needs_human_review" "$RUN_CMD"

# Namespaced attempt counters
assert_contains "quality_attempts counter" "quality_attempts" "$RUN_CMD"
assert_contains "review_attempts counter" "review_attempts" "$RUN_CMD"

# Prior-work handoff into resume context
assert_contains "prior_work_dir handoff" "prior_work_dir" "$RUN_CMD"

# Layer 4 holdout validation orchestration must be wired
assert_contains "Layer 4 holdout step labelled 3b"     "Holdout Validation"        "$RUN_CMD"
assert_contains "calls pipeline-holdout-validate prompt" "pipeline-holdout-validate prompt" "$RUN_CMD"
assert_contains "calls pipeline-holdout-validate check"  "pipeline-holdout-validate check"  "$RUN_CMD"
assert_contains "tracks holdout_attempts retry counter"  "holdout_attempts"          "$RUN_CMD"

# review_attempts tracking lives inside pipeline-run-task now; the skill
# references the counter name rather than re-implementing it inline.
assert_contains "review_attempts tracking mentioned" "review_attempts" "$RUN_CMD"

# Final-rollup PR captured in state as .rollup.pr_number (was .final_pr_number
# before the stage-machine wrapper migration).
assert_contains "rollup PR number captured in state" ".rollup.pr_number" "$RUN_CMD"

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
