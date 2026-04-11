#!/usr/bin/env bash
# Phase 5 verification tests
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")" && pwd):$PATH"

# Mock gh for --close-issues tests and PR-state gating tests.
#
# PR-state responses are driven by an on-disk map $MOCK_DIR/pr-state/<N> so
# individual tests can override per-PR state without mutating the script.
# Defaults to MERGED when no file exists; missing state file = UNKNOWN.
MOCK_DIR=$(mktemp -d)
mkdir -p "$MOCK_DIR/pr-state"
cat > "$MOCK_DIR/gh" << MOCK_GH
#!/usr/bin/env bash
case "\$*" in
  "issue close 404")
    echo "Could not resolve issue" >&2
    exit 1
    ;;
  "issue close "*)
    exit 0
    ;;
  "auth status")
    exit 0
    ;;
  "pr view "*" --json state -q .state")
    pr_num=\$(printf '%s' "\$*" | awk '{print \$3}')
    state_file="$MOCK_DIR/pr-state/\$pr_num"
    if [[ -f "\$state_file" ]]; then
      cat "\$state_file"
    else
      echo MERGED
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
MOCK_GH
chmod +x "$MOCK_DIR/gh"
export PATH="$MOCK_DIR:$PATH"

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

assert_exit() {
  local label="$1" expected="$2"
  shift 2
  local actual
  set +e
  "$@" >/dev/null 2>&1
  actual=$?
  set -e
  assert_eq "$label" "$expected" "$actual"
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (expected to contain '$needle')"
    fail=$((fail + 1))
  fi
}

# Helper: create a test run with state
_create_test_run() {
  local run_id="$1"
  local run_dir="${CLAUDE_PLUGIN_DATA}/runs/${run_id}"
  mkdir -p "$run_dir"/{holdouts,reviews}
  printf '%s' "$2" > "$run_dir/state.json"
  touch "$run_dir/audit.jsonl"
  touch "$run_dir/metrics.jsonl"

  # Set current symlink
  rm -f "${CLAUDE_PLUGIN_DATA}/runs/current"
  ln -s "$run_dir" "${CLAUDE_PLUGIN_DATA}/runs/current"
}

# ============================================================
echo "=== pipeline-wait-pr (argument validation) ==="

assert_exit "missing PR number exits 1" 1 pipeline-wait-pr
assert_exit "invalid PR number exits 1" 1 pipeline-wait-pr "abc"

# ============================================================
echo ""
echo "=== pipeline-summary (all tasks done) ==="

_create_test_run "test-summary-1" '{
  "run_id": "test-summary-1",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:30:00Z",
  "updated_at": "2026-01-01T01:30:00Z",
  "input": {"issue_numbers": [42], "resumed_from": null},
  "spec": {"status": "done", "path": "specs/42", "review_iterations": 2, "review_score": 56},
  "tasks": {
    "T1": {"status": "done", "started_at": "2026-01-01T00:10:00Z", "ended_at": "2026-01-01T00:30:00Z", "pr_number": 100, "pr_status": "merged", "branch": "dark-factory/42/t1"},
    "T2": {"status": "done", "started_at": "2026-01-01T00:30:00Z", "ended_at": "2026-01-01T01:00:00Z", "pr_number": 101, "pr_status": "merged", "branch": "dark-factory/42/t2"},
    "T3": {"status": "done", "started_at": "2026-01-01T01:00:00Z", "ended_at": "2026-01-01T01:30:00Z", "pr_number": 102, "pr_status": "merged", "branch": "dark-factory/42/t3"}
  },
  "circuit_breaker": {"tasks_completed": 3, "consecutive_failures": 0, "runtime_minutes": 90},
  "cost": {"total_tokens": 50000, "estimated_usd": 1.5, "by_model": {"sonnet": 40000, "haiku": 10000}},
  "quality": {"coverage_delta": 5, "holdout_pass_rate": 100, "mutation_score": 85}
}'

output=$(pipeline-summary "test-summary-1" 2>/dev/null)
assert_eq "summary run_id" "test-summary-1" "$(printf '%s' "$output" | jq -r '.run_id')"
assert_eq "summary status" "completed" "$(printf '%s' "$output" | jq -r '.status')"
assert_eq "summary mode" "prd" "$(printf '%s' "$output" | jq -r '.mode')"
assert_eq "summary tasks total" "3" "$(printf '%s' "$output" | jq -r '.tasks.total')"
assert_eq "summary tasks done" "3" "$(printf '%s' "$output" | jq -r '.tasks.done')"
assert_eq "summary tasks failed" "0" "$(printf '%s' "$output" | jq -r '.tasks.failed')"
assert_eq "summary issue" "42" "$(printf '%s' "$output" | jq -r '.issues[0]')"
assert_eq "summary cost tokens" "50000" "$(printf '%s' "$output" | jq -r '.cost.total_tokens')"
assert_eq "summary prs count" "3" "$(printf '%s' "$output" | jq -r '.prs | length')"
assert_eq "summary pr1 number" "100" "$(printf '%s' "$output" | jq -r '.prs[0].pr_number')"
assert_eq "summary quality coverage" "5" "$(printf '%s' "$output" | jq -r '.quality.coverage_delta')"
assert_eq "summary quality holdout" "100" "$(printf '%s' "$output" | jq -r '.quality.holdout_pass_rate')"
assert_eq "summary quality mutation" "85" "$(printf '%s' "$output" | jq -r '.quality.mutation_score')"
assert_eq "summary started_at" "2026-01-01T00:00:00Z" "$(printf '%s' "$output" | jq -r '.started_at')"

# ============================================================
echo ""
echo "=== pipeline-summary (partial run with failures) ==="

_create_test_run "test-summary-2" '{
  "run_id": "test-summary-2",
  "status": "partial",
  "mode": "task",
  "started_at": "2026-02-01T10:00:00Z",
  "ended_at": null,
  "updated_at": "2026-02-01T11:00:00Z",
  "input": {"issue_numbers": [99], "resumed_from": null},
  "spec": {"status": "done", "path": null, "review_iterations": 0, "review_score": null},
  "tasks": {
    "T1": {"status": "done", "pr_number": 200, "pr_status": "merged"},
    "T2": {"status": "failed"},
    "T3": {"status": "pending"},
    "T4": {"status": "needs_human_review"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 1, "runtime_minutes": 60},
  "cost": {"total_tokens": 20000, "estimated_usd": 0.5, "by_model": {"opus": 20000}}
}'

output=$(pipeline-summary "test-summary-2" 2>/dev/null)
assert_eq "partial tasks total" "4" "$(printf '%s' "$output" | jq -r '.tasks.total')"
assert_eq "partial tasks done" "1" "$(printf '%s' "$output" | jq -r '.tasks.done')"
assert_eq "partial tasks failed" "1" "$(printf '%s' "$output" | jq -r '.tasks.failed')"
assert_eq "partial tasks skipped" "1" "$(printf '%s' "$output" | jq -r '.tasks.skipped')"
assert_eq "partial tasks needs_human" "1" "$(printf '%s' "$output" | jq -r '.tasks.needs_human')"
assert_eq "partial status" "partial" "$(printf '%s' "$output" | jq -r '.status')"
assert_eq "partial ended_at null" "null" "$(printf '%s' "$output" | jq -r '.ended_at')"
assert_eq "partial prs count" "1" "$(printf '%s' "$output" | jq -r '.prs | length')"

# ============================================================
echo ""
echo "=== pipeline-summary (missing state file) ==="

assert_exit "missing state exits 1" 1 pipeline-summary "nonexistent-run"

# ============================================================
echo ""
echo "=== pipeline-summary (empty tasks) ==="

_create_test_run "test-summary-3" '{
  "run_id": "test-summary-3",
  "status": "running",
  "mode": "discover",
  "started_at": "2026-03-01T00:00:00Z",
  "ended_at": null,
  "updated_at": "2026-03-01T00:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "spec": {"status": "pending"},
  "tasks": {},
  "circuit_breaker": {"tasks_completed": 0, "consecutive_failures": 0, "runtime_minutes": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0, "by_model": {}}
}'

output=$(pipeline-summary "test-summary-3" 2>/dev/null)
assert_eq "empty tasks total" "0" "$(printf '%s' "$output" | jq -r '.tasks.total')"
assert_eq "empty tasks done" "0" "$(printf '%s' "$output" | jq -r '.tasks.done')"
assert_eq "empty prs" "0" "$(printf '%s' "$output" | jq -r '.prs | length')"
assert_eq "empty issues" "0" "$(printf '%s' "$output" | jq -r '.issues | length')"

# ============================================================
echo ""
echo "=== pipeline-summary (review files counted) ==="

# Add review files to the run directory
mkdir -p "${CLAUDE_PLUGIN_DATA}/runs/test-summary-1/reviews"
echo '{}' > "${CLAUDE_PLUGIN_DATA}/runs/test-summary-1/reviews/T1-round1.json"
echo '{}' > "${CLAUDE_PLUGIN_DATA}/runs/test-summary-1/reviews/T1-round2.json"
echo '{}' > "${CLAUDE_PLUGIN_DATA}/runs/test-summary-1/reviews/T2-round1.json"

output=$(pipeline-summary "test-summary-1" 2>/dev/null)
assert_eq "review rounds counted" "3" "$(printf '%s' "$output" | jq -r '.review_rounds')"

# ============================================================
echo ""
echo "=== pipeline-cleanup (archive run state) ==="

_create_test_run "test-cleanup-1" '{
  "run_id": "test-cleanup-1",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [50], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "branch": "dark-factory/50/t1"},
    "T2": {"status": "done", "branch": "dark-factory/50/t2"}
  },
  "circuit_breaker": {"tasks_completed": 2, "consecutive_failures": 0},
  "cost": {"total_tokens": 1000, "estimated_usd": 0.1}
}'

# Add some review and holdout files
echo '{"verdict": "APPROVE"}' > "${CLAUDE_PLUGIN_DATA}/runs/test-cleanup-1/reviews/T1.json"
echo '{"criteria": ["test"]}' > "${CLAUDE_PLUGIN_DATA}/runs/test-cleanup-1/holdouts/T1.json"

output=$(pipeline-cleanup "test-cleanup-1" 2>/dev/null)
assert_eq "cleanup run_id" "test-cleanup-1" "$(printf '%s' "$output" | jq -r '.run_id')"

# Verify archive was created
assert_eq "archive state exists" "true" \
  "$([[ -f "${CLAUDE_PLUGIN_DATA}/archive/test-cleanup-1/state.json" ]] && echo true || echo false)"
assert_eq "archive audit exists" "true" \
  "$([[ -f "${CLAUDE_PLUGIN_DATA}/archive/test-cleanup-1/audit.jsonl" ]] && echo true || echo false)"
assert_eq "archive reviews exists" "true" \
  "$([[ -f "${CLAUDE_PLUGIN_DATA}/archive/test-cleanup-1/reviews/T1.json" ]] && echo true || echo false)"
assert_eq "archive holdouts exists" "true" \
  "$([[ -f "${CLAUDE_PLUGIN_DATA}/archive/test-cleanup-1/holdouts/T1.json" ]] && echo true || echo false)"

# Verify run dir was removed
assert_eq "run dir removed" "false" \
  "$([[ -d "${CLAUDE_PLUGIN_DATA}/runs/test-cleanup-1" ]] && echo true || echo false)"

# Verify current symlink removed
assert_eq "current symlink removed" "false" \
  "$([[ -L "${CLAUDE_PLUGIN_DATA}/runs/current" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-cleanup (skip unmerged branches) ==="

_create_test_run "test-cleanup-2" '{
  "run_id": "test-cleanup-2",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "pr_number": 1001, "branch": "dark-factory/test/t1"},
    "T2": {"status": "failed", "branch": "dark-factory/test/t2"},
    "T3": {"status": "needs_human_review", "branch": "dark-factory/test/t3"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 1},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

# Default PR mock returns MERGED, so T1 is eligible for deletion (push/branch
# -d silently fail since branches don't actually exist). T2/T3 are skipped
# because their task status is not 'done'.
output=$(pipeline-cleanup "test-cleanup-2" --delete-branches 2>/dev/null)
assert_eq "cleanup branches_skipped" "2" "$(printf '%s' "$output" | jq -r '.branches_skipped')"

# ============================================================
echo ""
echo "=== pipeline-cleanup (missing state file) ==="

assert_exit "cleanup missing state exits 1" 1 pipeline-cleanup "nonexistent-run"

# ============================================================
echo ""
echo "=== pipeline-cleanup (spec cleanup gated on all tasks done) ==="

# The spec-cleanup path calls `git rev-parse --show-toplevel` to confine rm -rf
# to the project root. We stub git so tests run in a fully isolated sandbox.
spec_sandbox=$(mktemp -d)
fake_proj="$spec_sandbox/proj"
mkdir -p "$fake_proj"

SPEC_MOCK_DIR=$(mktemp -d)
cat > "$SPEC_MOCK_DIR/git" << GITEOF
#!/usr/bin/env bash
if [[ "\$1" == "rev-parse" && "\$2" == "--show-toplevel" ]]; then
  printf '%s' "$fake_proj"
  exit 0
fi
exec /usr/bin/git "\$@"
GITEOF
chmod +x "$SPEC_MOCK_DIR/git"
export PATH="$SPEC_MOCK_DIR:$PATH"

_create_test_run "test-cleanup-3" '{
  "run_id": "test-cleanup-3",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": null,
  "updated_at": "2026-01-01T00:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "failed"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 1},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

# spec_dir is OUTSIDE the fake project root — partial run so guard is not reached
outside_spec="$spec_sandbox/outside-spec"
mkdir -p "$outside_spec"
echo "spec content" > "$outside_spec/spec.md"

output=$(pipeline-cleanup "test-cleanup-3" --clean-spec --spec-dir "$outside_spec" 2>/dev/null)
assert_eq "spec not cleaned (partial)" "false" "$(printf '%s' "$output" | jq -r '.spec_cleaned')"
assert_eq "spec dir still exists" "true" \
  "$([[ -d "$outside_spec" ]] && echo true || echo false)"

# Now test with all tasks done — spec dir must be inside fake_proj for guard to allow it
spec_dir="$fake_proj/spec"
mkdir -p "$spec_dir"
echo "spec content" > "$spec_dir/spec.md"

_create_test_run "test-cleanup-4" '{
  "run_id": "test-cleanup-4",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "done"}
  },
  "circuit_breaker": {"tasks_completed": 2, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

output=$(pipeline-cleanup "test-cleanup-4" --clean-spec --spec-dir "$spec_dir" 2>/dev/null)
assert_eq "spec cleaned (all done)" "true" "$(printf '%s' "$output" | jq -r '.spec_cleaned')"
assert_eq "spec dir removed" "false" \
  "$([[ -d "$spec_dir" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-cleanup (no spec-dir with --clean-spec) ==="

_create_test_run "test-cleanup-5" '{
  "run_id": "test-cleanup-5",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {"T1": {"status": "done"}},
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

output=$(pipeline-cleanup "test-cleanup-5" --clean-spec 2>/dev/null)
assert_eq "no spec-dir graceful" "false" "$(printf '%s' "$output" | jq -r '.spec_cleaned')"

# ============================================================
echo ""
echo "=== task_01_03: pipeline-cleanup --spec-dir path guard ==="
# The guard (already implemented in bin/pipeline-cleanup lines 154-198) must
# reject spec dirs that resolve outside the git project root.
# All paths here are children of spec_sandbox — never real / or ~.

_create_test_run "test-specguard-1" '{
  "run_id": "test-specguard-1",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {"T1": {"status": "done"}},
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

# 1. Outside the sandbox project root → rejected
outside_dir="$spec_sandbox/outside"
mkdir -p "$outside_dir"
set +e
pipeline-cleanup "test-specguard-1" --clean-spec --spec-dir "$outside_dir" >/dev/null 2>&1
_rc=$?
set -e
assert_eq "spec-dir outside project root is rejected" "1" "$_rc"

# 2. Symlink whose target is outside the sandbox project root → rejected
symlink_dir="$fake_proj/symlink-spec"
ln -sf "$outside_dir" "$symlink_dir"
set +e
pipeline-cleanup "test-specguard-1" --clean-spec --spec-dir "$symlink_dir" >/dev/null 2>&1
_rc=$?
set -e
assert_eq "symlink to outside project root is rejected" "1" "$_rc"
rm -f "$symlink_dir"

# 3. Path with ".." that escapes the project root → rejected
mkdir -p "$fake_proj/subdir"
dotdot_path="$fake_proj/subdir/../../outside"
mkdir -p "$spec_sandbox/outside"
set +e
pipeline-cleanup "test-specguard-1" --clean-spec --spec-dir "$dotdot_path" >/dev/null 2>&1
_rc=$?
set -e
assert_eq "dotdot path escaping project root is rejected" "1" "$_rc"

# 4. Empty spec-dir → treated as "not specified" (warn + skip, spec_cleaned=false)
output=$(pipeline-cleanup "test-specguard-1" --clean-spec --spec-dir "" 2>/dev/null)
assert_eq "empty spec-dir skips gracefully" "false" "$(printf '%s' "$output" | jq -r '.spec_cleaned')"

# 5. In-project spec dir → accepted (spec is removed)
# Re-create the run — test 4 (empty spec-dir) runs the full cleanup including archive.
_create_test_run "test-specguard-2" '{
  "run_id": "test-specguard-2",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {"T1": {"status": "done"}},
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
valid_spec="$fake_proj/valid-spec"
mkdir -p "$valid_spec"
echo "content" > "$valid_spec/spec.md"
output=$(pipeline-cleanup "test-specguard-2" --clean-spec --spec-dir "$valid_spec" 2>/dev/null)
assert_eq "in-project spec-dir is accepted" "true" "$(printf '%s' "$output" | jq -r '.spec_cleaned')"
assert_eq "in-project spec-dir is removed" "false" \
  "$([[ -d "$valid_spec" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-cleanup (--remove-worktrees) ==="

_create_test_run "test-worktrees-1" '{
  "run_id": "test-worktrees-1",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "worktree": "/nonexistent/path/t1"},
    "T2": {"status": "failed", "worktree": "/nonexistent/path/t2"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 1},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'

# Worktree dir does not exist → graceful skip (existing code: if [[ -d "$worktree" ]])
output=$(pipeline-cleanup "test-worktrees-1" --remove-worktrees 2>/dev/null)
assert_eq "nonexistent worktree skipped" "0" "$(printf '%s' "$output" | jq -r '.worktrees_removed')"

# Failed task worktree must be skipped regardless of existence
_create_test_run "test-worktrees-2" '{
  "run_id": "test-worktrees-2",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "failed", "worktree": "/tmp/some-worktree"}
  },
  "circuit_breaker": {"tasks_completed": 0, "consecutive_failures": 1},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-worktrees-2" --remove-worktrees 2>/dev/null)
assert_eq "failed task worktree skipped" "0" "$(printf '%s' "$output" | jq -r '.worktrees_removed')"

# ============================================================
echo ""
echo "=== pipeline-cleanup (--close-issues) ==="

# Case 1: all tasks done + issue_numbers populated → issues_closed == 1
_create_test_run "test-close-1" '{
  "run_id": "test-close-1",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [42], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "done"}
  },
  "circuit_breaker": {"tasks_completed": 2, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-close-1" --close-issues 2>/dev/null)
assert_eq "all done → issue closed" "1" "$(printf '%s' "$output" | jq -r '.issues_closed')"

# Case 2: partial tasks → no close
_create_test_run "test-close-2" '{
  "run_id": "test-close-2",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [42], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "failed"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 1},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-close-2" --close-issues 2>/dev/null)
assert_eq "partial → no close" "0" "$(printf '%s' "$output" | jq -r '.issues_closed')"

# Case 3: gh fails on a specific issue → issues_closed == 0
_create_test_run "test-close-3" '{
  "run_id": "test-close-3",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [404], "resumed_from": null},
  "tasks": {"T1": {"status": "done"}},
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-close-3" --close-issues 2>/dev/null)
assert_eq "gh fail → no close" "0" "$(printf '%s' "$output" | jq -r '.issues_closed')"

# ============================================================
echo ""
echo "=== task_05_06: pipeline-cleanup --delete-branches gates on PR state ==="
# M19: 'done' means "task approved", not "PR merged". --delete-branches
# must only delete branches whose PR is actually MERGED, otherwise the PR
# review gets wiped out.
#
# The gh mock reads PR state from $MOCK_DIR/pr-state/<pr_num>. Defaults to
# MERGED when no override file exists.

# --- Case 1: open PR → skipped with warning ---
printf 'OPEN' > "$MOCK_DIR/pr-state/7001"
_create_test_run "test-delete-open" '{
  "run_id": "test-delete-open",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "pr_number": 7001, "branch": "dark-factory/test/open-pr"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-delete-open" --delete-branches 2>/dev/null)
assert_eq "open PR: branches_deleted=0" "0" "$(printf '%s' "$output" | jq -r '.branches_deleted')"
assert_eq "open PR: branches_skipped=1" "1" "$(printf '%s' "$output" | jq -r '.branches_skipped')"
assert_eq "open PR: warnings array non-empty" "1" \
  "$(printf '%s' "$output" | jq -r '.warnings | length')"
# Warning message mentions the OPEN state.
assert_contains "open PR: warning mentions state=OPEN" "state=OPEN" \
  "$(printf '%s' "$output" | jq -r '.warnings[0]')"
rm -f "$MOCK_DIR/pr-state/7001"

# --- Case 2: merged PR → branch deleted (push/branch -d silently fail) ---
printf 'MERGED' > "$MOCK_DIR/pr-state/7002"
_create_test_run "test-delete-merged" '{
  "run_id": "test-delete-merged",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "pr_number": 7002, "branch": "dark-factory/test/merged-pr"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-delete-merged" --delete-branches 2>/dev/null)
assert_eq "merged PR: branches_skipped=0" "0" "$(printf '%s' "$output" | jq -r '.branches_skipped')"
assert_eq "merged PR: warnings empty" "0" \
  "$(printf '%s' "$output" | jq -r '.warnings | length')"
rm -f "$MOCK_DIR/pr-state/7002"

# --- Case 3: closed unmerged PR → skipped ---
printf 'CLOSED' > "$MOCK_DIR/pr-state/7003"
_create_test_run "test-delete-closed" '{
  "run_id": "test-delete-closed",
  "status": "partial",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "pr_number": 7003, "branch": "dark-factory/test/closed-pr"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-delete-closed" --delete-branches 2>/dev/null)
assert_eq "closed PR: branches_skipped=1" "1" "$(printf '%s' "$output" | jq -r '.branches_skipped')"
assert_contains "closed PR: warning mentions state=CLOSED" "state=CLOSED" \
  "$(printf '%s' "$output" | jq -r '.warnings[0]')"
rm -f "$MOCK_DIR/pr-state/7003"

# --- Case 4: task done with no PR number → skipped with no_pr reason ---
_create_test_run "test-delete-nopr" '{
  "run_id": "test-delete-nopr",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "updated_at": "2026-01-01T01:00:00Z",
  "input": {"issue_numbers": [], "resumed_from": null},
  "tasks": {
    "T1": {"status": "done", "branch": "dark-factory/test/orphan"}
  },
  "circuit_breaker": {"tasks_completed": 1, "consecutive_failures": 0},
  "cost": {"total_tokens": 0, "estimated_usd": 0}
}'
output=$(pipeline-cleanup "test-delete-nopr" --delete-branches 2>/dev/null)
assert_eq "no PR: branches_skipped=1" "1" "$(printf '%s' "$output" | jq -r '.branches_skipped')"
assert_contains "no PR: warning mentions no_pr" "reason=no_pr" \
  "$(printf '%s' "$output" | jq -r '.warnings[0]')"

# ============================================================
echo ""
echo "=== pipeline-wait-pr (help/flags) ==="

# Test unknown flag
assert_exit "unknown flag exits 1" 1 pipeline-wait-pr 123 --bogus

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA" "$MOCK_DIR" "$spec_sandbox" "$SPEC_MOCK_DIR"

[[ $fail -eq 0 ]] && exit 0 || exit 1
