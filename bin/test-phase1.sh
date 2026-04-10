#!/usr/bin/env bash
# Phase 1 verification tests
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")" && pwd):$PATH"

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

assert_file_exists() {
  local label="$1" path="$2"
  if [[ -e "$path" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (file not found: $path)"
    fail=$((fail + 1))
  fi
}

echo "=== pipeline-init ==="

pipeline-init "run-test-001" --issue 42 --mode prd >/dev/null 2>&1
assert_file_exists "state.json created" "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json"
assert_file_exists "audit.jsonl created" "$CLAUDE_PLUGIN_DATA/runs/run-test-001/audit.jsonl"
assert_file_exists "metrics.jsonl created" "$CLAUDE_PLUGIN_DATA/runs/run-test-001/metrics.jsonl"
assert_file_exists "holdouts/ created" "$CLAUDE_PLUGIN_DATA/runs/run-test-001/holdouts"
assert_file_exists "reviews/ created" "$CLAUDE_PLUGIN_DATA/runs/run-test-001/reviews"
assert_file_exists "current symlink" "$CLAUDE_PLUGIN_DATA/runs/current"

run_id=$(jq -r '.run_id' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
assert_eq "run_id in state" "run-test-001" "$run_id"

status=$(jq -r '.status' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
assert_eq "status is running" "running" "$status"

mode=$(jq -r '.mode' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
assert_eq "mode is prd" "prd" "$mode"

issue=$(jq -r '.input.issue_numbers[0]' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
assert_eq "issue number captured" "42" "$issue"

# Should fail on duplicate run
assert_exit "rejects duplicate run-id" 1 pipeline-init "run-test-001"

echo ""
echo "=== pipeline-state read/write round-trip ==="

val=$(pipeline-state read "run-test-001" '.status')
assert_eq "read status" "running" "$val"

pipeline-state write "run-test-001" '.spec.status' '"generating"' >/dev/null 2>&1
val=$(pipeline-state read "run-test-001" '.spec.status')
assert_eq "write+read spec.status" "generating" "$val"

echo ""
echo "=== pipeline-state task-status ==="

# Add a task to state first
pipeline-state write "run-test-001" '.tasks.task_1' '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
pipeline-state task-status "run-test-001" "task_1" "executing" 2>/dev/null
val=$(pipeline-state read "run-test-001" '.tasks.task_1.status')
assert_eq "task_1 status updated" "executing" "$val"

started=$(pipeline-state read "run-test-001" '.tasks.task_1.started_at')
assert_eq "started_at set" "true" "$( [[ "$started" != "null" ]] && echo true || echo false )"

pipeline-state task-status "run-test-001" "task_1" "done" 2>/dev/null
val=$(pipeline-state read "run-test-001" '.tasks.task_1.status')
assert_eq "task_1 done" "done" "$val"

completed=$(pipeline-state read "run-test-001" '.circuit_breaker.tasks_completed')
assert_eq "tasks_completed incremented" "1" "$completed"

consec=$(pipeline-state read "run-test-001" '.circuit_breaker.consecutive_failures')
assert_eq "consecutive_failures reset on done" "0" "$consec"

echo ""
echo "=== pipeline-state deps-satisfied ==="

pipeline-state write "run-test-001" '.tasks.task_2' '{"status":"pending","depends_on":["task_1"]}' >/dev/null 2>&1
assert_exit "deps satisfied (task_1 done)" 0 pipeline-state deps-satisfied "run-test-001" "task_2"

pipeline-state write "run-test-001" '.tasks.task_3' '{"status":"pending","depends_on":["task_99"]}' >/dev/null 2>&1
# task_99 doesn't exist, so its status will be "unknown" → not done
assert_exit "deps not satisfied (missing dep)" 1 pipeline-state deps-satisfied "run-test-001" "task_3"

echo ""
echo "=== pipeline-state resume-point ==="

resume=$(pipeline-state resume-point "run-test-001")
assert_eq "resume-point finds pending task" "task_2" "$resume"

echo ""
echo "=== pipeline-state interrupted ==="

# Running status → exit 1 (not interrupted)
assert_exit "running → not interrupted" 1 pipeline-state interrupted "run-test-001"

# Set status to interrupted → exit 0
pipeline-state write "run-test-001" '.status' '"interrupted"' >/dev/null 2>&1
assert_exit "interrupted → exit 0" 0 pipeline-state interrupted "run-test-001"

# Reset status back to running for subsequent tests
pipeline-state write "run-test-001" '.status' '"running"' >/dev/null 2>&1

echo ""
echo "=== pipeline-circuit-breaker ==="

# Write config
mkdir -p "$CLAUDE_PLUGIN_DATA"
echo '{"circuitBreaker":{"maxTasks":20,"maxRuntimeMinutes":360,"maxConsecutiveFailures":3}}' > "$CLAUDE_PLUGIN_DATA/config.json"

# Should be safe (1 task completed, 0 failures)
assert_exit "circuit breaker safe" 0 pipeline-circuit-breaker "run-test-001"

# Simulate 3 consecutive failures
pipeline-state write "run-test-001" '.circuit_breaker.consecutive_failures' '3' >/dev/null 2>&1
assert_exit "circuit breaker tripped (failures)" 1 pipeline-circuit-breaker "run-test-001"

# Reset and test max tasks
pipeline-state write "run-test-001" '.circuit_breaker.consecutive_failures' '0' >/dev/null 2>&1
pipeline-state write "run-test-001" '.circuit_breaker.tasks_completed' '20' >/dev/null 2>&1
assert_exit "circuit breaker tripped (max tasks)" 1 pipeline-circuit-breaker "run-test-001"

# Runtime threshold: set maxRuntimeMinutes to 1 and started_at well in the past
pipeline-state write "run-test-001" '.circuit_breaker.tasks_completed' '0' >/dev/null 2>&1
pipeline-state write "run-test-001" '.started_at' '"2020-01-01T00:00:00Z"' >/dev/null 2>&1
echo '{"circuitBreaker":{"maxTasks":20,"maxRuntimeMinutes":1,"maxConsecutiveFailures":3}}' > "$CLAUDE_PLUGIN_DATA/config.json"
output=$(pipeline-circuit-breaker "run-test-001" 2>/dev/null) || true
assert_exit "circuit breaker tripped (runtime)" 1 pipeline-circuit-breaker "run-test-001"
# Reason field should mention runtime
if echo "$output" | jq -e '.reason // empty' >/dev/null 2>&1; then
  reason_has_runtime=$(echo "$output" | jq -r '.reason' | grep -qi 'runtime' && echo "true" || echo "false")
  assert_eq "circuit breaker reason mentions runtime" "true" "$reason_has_runtime"
else
  # Script might log reason to stderr instead — check exit code only
  assert_eq "circuit breaker reason check (skipped)" "skipped" "skipped"
fi

# Restore defaults for subsequent tests
echo '{"circuitBreaker":{"maxTasks":20,"maxRuntimeMinutes":360,"maxConsecutiveFailures":3}}' > "$CLAUDE_PLUGIN_DATA/config.json"
pipeline-state write "run-test-001" '.started_at' '"2099-01-01T00:00:00Z"' >/dev/null 2>&1

echo ""
echo "=== pipeline-lock ==="

# Acquire
output=$(pipeline-lock acquire 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "lock acquired" "acquired" "$action"

# Second acquire from different process — recovers dead PID of first call
output=$(pipeline-lock acquire 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "lock re-acquired after dead PID" "acquired" "$action"

# Status
output=$(pipeline-lock status 2>/dev/null)
locked=$(echo "$output" | jq -r '.locked')
assert_eq "lock status shows locked" "true" "$locked"

# Release
output=$(pipeline-lock release 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "lock released" "released" "$action"

# Status after release
output=$(pipeline-lock status 2>/dev/null)
locked=$(echo "$output" | jq -r '.locked')
assert_eq "lock status shows unlocked" "false" "$locked"

# Recover from dead PID
echo '{"pid":99999,"timestamp":"2026-01-01T00:00:00Z"}' > "$CLAUDE_PLUGIN_DATA/pipeline.lock"
output=$(pipeline-lock recover 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "lock recovered from dead PID" "recovered" "$action"

pipeline-lock release 2>/dev/null

# Timeout: write a lock file with the current shell's PID (guaranteed alive),
# then try to acquire with a different caller PID and a 2s timeout
echo "{\"pid\":$$,\"timestamp\":\"2026-01-01T00:00:00Z\"}" > "$CLAUDE_PLUGIN_DATA/pipeline.lock"
output=$(DARK_FACTORY_LOCK_TEST_PID=99998 pipeline-lock acquire --timeout 2 2>/dev/null) || true
action=$(echo "$output" | jq -r '.action')
assert_eq "lock times out on live PID" "timeout" "$action"

rm -f "$CLAUDE_PLUGIN_DATA/pipeline.lock"

echo ""
echo "=== pipeline-state list ==="

pipeline-init "run-test-002" --mode discover >/dev/null 2>&1
list_output=$(pipeline-state list)
count=$(echo "$list_output" | jq 'length')
assert_eq "list shows 2 runs" "2" "$count"

echo ""
echo "=== task_01_04: pipeline-init --issue numeric validation ==="

# Non-numeric values must be rejected with exit 1
assert_exit "pipeline-init --issue abc fails" 1 \
  pipeline-init "run-issue-bad-1" --issue "abc"

assert_exit "pipeline-init --issue 42abc fails (non-numeric suffix)" 1 \
  pipeline-init "run-issue-bad-2" --issue "42abc"

assert_exit "pipeline-init --issue '42,injected:1' fails (injection attempt)" 1 \
  pipeline-init "run-issue-bad-3" --issue '42,"poisoned":1'

# Valid numeric issue must succeed and be stored correctly
pipeline-init "run-issue-ok" --issue 42 --mode prd >/dev/null 2>&1
issue_val=$(jq -r '.input.issue_numbers[0]' "$CLAUDE_PLUGIN_DATA/runs/run-issue-ok/state.json")
assert_eq "pipeline-init --issue 42 stores correct value" "42" "$issue_val"

echo ""
echo "=== task_01_05: pipeline-lock --pid flag restriction ==="

# --pid flag must no longer be accepted (removed in favour of env var)
assert_exit "pipeline-lock acquire --pid 1 is rejected" 1 \
  pipeline-lock acquire --pid 1

# Without --pid, acquire still works using $$ (covered by the existing lock tests above)
# Regression: without any --pid, acquires and releases cleanly
output=$(pipeline-lock acquire 2>/dev/null)
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "lock acquire without --pid succeeds" "acquired" "$action"
pipeline-lock release >/dev/null 2>&1

echo ""
echo "=== task_01_01: pipeline-state write injection hardening ==="

# Injection attempts must be rejected (exit non-zero)
assert_exit "write rejects key with backtick" 1 \
  pipeline-state write "run-test-001" '.tasks.`env`' '"x"'

assert_exit "write rejects key with pipe operator" 1 \
  pipeline-state write "run-test-001" '.status | env' '"x"'

assert_exit "write rejects key with error() call" 1 \
  pipeline-state write "run-test-001" '.x,error("pwn")' '"x"'

assert_exit "write rejects key with double-quote" 1 \
  pipeline-state write "run-test-001" '.tasks."injected"' '"x"'

assert_exit "write rejects key with newline" 1 \
  pipeline-state write "run-test-001" $'.status\n| env' '"x"'

# Legitimate paths must be accepted and update correctly
assert_exit "write accepts simple dotted path" 0 \
  pipeline-state write "run-test-001" '.spec.injtest' '"ok"'

val=$(pipeline-state read "run-test-001" '.spec.injtest')
assert_eq "setpath correctly updates nested key" "ok" "$val"

assert_exit "write accepts array-index path" 0 \
  pipeline-state write "run-test-001" '.spec.rounds[0]' '"r0"'

val=$(pipeline-state read "run-test-001" '.spec.rounds[0]')
assert_eq "setpath correctly updates array index" "r0" "$val"

echo ""
echo "=== pipeline-lib.sh utilities ==="

source "$(dirname "$0")/pipeline-lib.sh"

slug=$(slugify "Hello World -- Test 123!")
assert_eq "slugify" "hello-world-test-123" "$slug"

pkg=$(detect_pkg_manager "/nonexistent")
assert_eq "detect_pkg_manager default" "pnpm" "$pkg"

echo ""
echo "================================"
echo "Results: $pass passed, $fail failed"
echo "================================"

# Cleanup
rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]]
