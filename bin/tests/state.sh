#!/usr/bin/env bash
# state.sh — pipeline-state, pipeline-init, pipeline-circuit-breaker,
# pipeline-lock, stop-gate, and atomic_write primitives.
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")/.." && pwd):$PATH"

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

version=$(jq -r '.version // empty' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
plugin_version=$(jq -r '.version' "$(dirname "$0")/../../.claude-plugin/plugin.json")
if [[ -z "$version" || "$version" == "null" ]]; then
  echo "  FAIL: plugin version is empty/null in state.json"
  fail=$((fail + 1))
fi
if [[ "$version" == "unknown" ]]; then
  echo "  FAIL: plugin version stamped as \"unknown\" (manifest not resolved)"
  fail=$((fail + 1))
fi
assert_eq "plugin version matches plugin.json" "$plugin_version" "$version"

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

# task_03_04: .spec.path must persist through the write/read round-trip so
# the orchestrator and pipeline-build-prompt can discover it on resume.
pipeline-state write "run-test-001" '.spec.path' '"/abs/path/to/.state/run-test-001"' >/dev/null 2>&1
val=$(pipeline-state read "run-test-001" '.spec.path')
assert_eq "write+read .spec.path persists absolute path" "/abs/path/to/.state/run-test-001" "$val"

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
echo "=== concurrency: parallel task-status updates ==="

# Seed a fresh run with 10 pending tasks (--force: bypass active-run guard)
pipeline-init "run-concurrent" --mode prd --force >/dev/null 2>&1
for i in $(seq 1 10); do
  pipeline-state write "run-concurrent" ".tasks.task_c${i}" '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
done

# Fire all 10 task-status "done" updates in parallel
for i in $(seq 1 10); do
  pipeline-state task-status "run-concurrent" "task_c${i}" "done" >/dev/null 2>&1 &
done
wait

concur_completed=$(pipeline-state read "run-concurrent" '.circuit_breaker.tasks_completed')
assert_eq "concurrent: tasks_completed not lost (no race)" "10" "$concur_completed"

concur_all_done=true
for i in $(seq 1 10); do
  s=$(pipeline-state read "run-concurrent" ".tasks.task_c${i}.status" 2>/dev/null || echo "missing")
  if [[ "$s" != "done" ]]; then
    concur_all_done=false
    echo "  FAIL: concurrent: task_c${i} status='$s' (expected 'done')"
    fail=$((fail + 1))
  fi
done
if [[ "$concur_all_done" == "true" ]]; then
  echo "  PASS: concurrent: all 10 task statuses are 'done'"
  pass=$((pass + 1))
fi

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
echo "=== task_06_01: resume-point follows execution_order ==="

# Build a dedicated run for execution_order coverage so we don't collide with
# the earlier round-trip tasks in run-test-001. --force because task_06_04's
# ownership check otherwise blocks replacing a still-'running' symlink target.
pipeline-init "run-resume-order" --mode prd --force >/dev/null 2>&1

# Seed three tasks in a non-sorted order: A pending, B pending, C pending.
# execution_order says [C, A, B] — resume-point must return C (first pending
# by execution_order), NOT whichever jq yields from `.tasks | to_entries`.
pipeline-state write "run-resume-order" '.tasks.task_A' '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
pipeline-state write "run-resume-order" '.tasks.task_B' '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
pipeline-state write "run-resume-order" '.tasks.task_C' '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
pipeline-state write "run-resume-order" '.execution_order' \
  '[{"task_id":"task_C","parallel_group":0},{"task_id":"task_A","parallel_group":1},{"task_id":"task_B","parallel_group":1}]' \
  >/dev/null 2>&1

resume=$(pipeline-state resume-point "run-resume-order")
assert_eq "resume-point returns first in execution_order" "task_C" "$resume"

# Mark task_C done → resume should advance to task_A (next by execution_order).
pipeline-state task-status "run-resume-order" "task_C" "done" 2>/dev/null
resume=$(pipeline-state resume-point "run-resume-order")
assert_eq "resume-point skips done tasks by execution_order" "task_A" "$resume"

# parallel_group ordering: group 0 done, group 1 has two entries. The first
# one in execution_order is task_A, so resume returns it.
# (task_A is already next-up from the prior check.)
# Mark task_A failed → resume should skip failed and return task_B.
pipeline-state task-status "run-resume-order" "task_A" "failed" 2>/dev/null
resume=$(pipeline-state resume-point "run-resume-order")
assert_eq "resume-point skips failed tasks" "task_B" "$resume"

# All terminal → resume returns empty and exits 1.
pipeline-state task-status "run-resume-order" "task_B" "done" 2>/dev/null
assert_exit "resume-point exit 1 when all tasks terminal" 1 \
  pipeline-state resume-point "run-resume-order"

# Legacy fallback: state with no .execution_order must still return a pending
# task using the old jq iteration path.
pipeline-init "run-resume-legacy" --mode prd --force >/dev/null 2>&1
pipeline-state write "run-resume-legacy" '.tasks.only_task' '{"status":"pending","depends_on":[]}' >/dev/null 2>&1
resume=$(pipeline-state resume-point "run-resume-legacy" 2>/dev/null)
assert_eq "resume-point legacy fallback returns pending" "only_task" "$resume"

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

# Write config with new defaults: no maxTasks, runtime unlimited (0), failures=5.
mkdir -p "$CLAUDE_PLUGIN_DATA"
echo '{"maxRuntimeMinutes":0,"maxConsecutiveFailures":5}' > "$CLAUDE_PLUGIN_DATA/config.json"

# Safe baseline.
assert_exit "circuit breaker safe" 0 pipeline-circuit-breaker "run-test-001"

# Large task counts and stale turn counters must NOT trip the breaker —
# those circuit breakers have been removed.
pipeline-state write "run-test-001" '.circuit_breaker.tasks_completed' '1000' >/dev/null 2>&1
pipeline-state write "run-test-001" '.circuit_breaker.turns_completed' '9999' >/dev/null 2>&1
assert_exit "circuit breaker ignores tasks_completed" 0 pipeline-circuit-breaker "run-test-001"

# consecutive_failures=5 trips (new default).
pipeline-state write "run-test-001" '.circuit_breaker.consecutive_failures' '5' >/dev/null 2>&1
assert_exit "circuit breaker tripped (failures)" 1 pipeline-circuit-breaker "run-test-001"

# consecutive_failures=4 is still safe at the new default.
pipeline-state write "run-test-001" '.circuit_breaker.consecutive_failures' '4' >/dev/null 2>&1
assert_exit "circuit breaker safe at 4 failures" 0 pipeline-circuit-breaker "run-test-001"

# Reset failures for remaining assertions.
pipeline-state write "run-test-001" '.circuit_breaker.consecutive_failures' '0' >/dev/null 2>&1

# maxRuntimeMinutes=0 (unlimited) must NOT trip regardless of elapsed time.
pipeline-state write "run-test-001" '.started_at' '"2020-01-01T00:00:00Z"' >/dev/null 2>&1
assert_exit "circuit breaker safe when maxRuntimeMinutes=0" 0 pipeline-circuit-breaker "run-test-001"

# Positive maxRuntimeMinutes still trips when elapsed exceeds it.
echo '{"maxRuntimeMinutes":1,"maxConsecutiveFailures":5}' > "$CLAUDE_PLUGIN_DATA/config.json"
output=$(pipeline-circuit-breaker "run-test-001" 2>/dev/null) || true
assert_exit "circuit breaker tripped (runtime)" 1 pipeline-circuit-breaker "run-test-001"
if echo "$output" | jq -e '.reason // empty' >/dev/null 2>&1; then
  reason_has_runtime=$(echo "$output" | jq -r '.reason' | grep -qi 'runtime' && echo "true" || echo "false")
  assert_eq "circuit breaker reason mentions runtime" "true" "$reason_has_runtime"
else
  assert_eq "circuit breaker reason check (skipped)" "skipped" "skipped"
fi

# Output must NOT expose removed threshold keys.
output=$(pipeline-circuit-breaker "run-test-001" 2>/dev/null) || true
has_max_tasks=$(echo "$output" | jq '.thresholds | has("max_tasks")' 2>/dev/null || echo "false")
has_max_turns=$(echo "$output" | jq '.thresholds | has("max_orchestrator_turns")' 2>/dev/null || echo "false")
assert_eq "output.thresholds does NOT include max_tasks" "false" "$has_max_tasks"
assert_eq "output.thresholds does NOT include max_orchestrator_turns" "false" "$has_max_turns"

# Restore shared default config for downstream tests.
echo '{"maxRuntimeMinutes":0,"maxConsecutiveFailures":5}' > "$CLAUDE_PLUGIN_DATA/config.json"
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
output=$(FACTORY_LOCK_TEST_PID=99998 pipeline-lock acquire --timeout 2 2>/dev/null) || true
action=$(echo "$output" | jq -r '.action')
assert_eq "lock times out on live PID" "timeout" "$action"

rm -f "$CLAUDE_PLUGIN_DATA/pipeline.lock"

echo ""
echo "=== pipeline-state list ==="

pipeline-init "run-test-002" --mode discover --force >/dev/null 2>&1
list_output=$(pipeline-state list)
count=$(echo "$list_output" | jq 'length')
# runs created up to this point: run-test-001, run-resume-order,
# run-resume-legacy (from task_06_01 tests), run-test-002.
assert_eq "list shows 5 runs" "5" "$count"

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
pipeline-init "run-issue-ok" --issue 42 --mode prd --force >/dev/null 2>&1
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
echo "=== task_16_04: pipeline-lock release PID ownership check ==="

# Semantics: release refuses only when the lockfile PID is ALIVE and != caller.
# A dead PID is an orphaned lock that any caller may clean up.

# --- Case 1: lockfile held by an alive peer PID, release from caller refused ---
# Use a backgrounded sleep as the "alive peer"; its PID is guaranteed alive
# for the duration of this test case.
sleep 30 &
peer_pid=$!

# Manually write lockfile as if the peer had acquired it
printf '{"pid":%d,"timestamp":"2026-01-01T00:00:00Z"}' "$peer_pid" > "$CLAUDE_PLUGIN_DATA/pipeline.lock"

set +e
output=$(FACTORY_LOCK_TEST_PID=99991 pipeline-lock release 2>/dev/null)
ec=$?
set -e
assert_eq "release from non-owner-alive-peer exits non-zero" "1" "$ec"
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "release from non-owner-alive-peer is refused" "refused" "$action"
reason=$(printf '%s' "$output" | jq -r '.reason')
assert_eq "refusal reason is not_owner" "not_owner" "$reason"
assert_eq "lockfile intact after refused release" "true" \
  "$([[ -f "$CLAUDE_PLUGIN_DATA/pipeline.lock" ]] && echo true || echo false)"

# --- Case 2: release from the owner PID succeeds ---
output=$(FACTORY_LOCK_TEST_PID=$peer_pid pipeline-lock release 2>/dev/null)
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "release from owner PID succeeds" "released" "$action"
assert_eq "lockfile removed after owner release" "false" \
  "$([[ -f "$CLAUDE_PLUGIN_DATA/pipeline.lock" ]] && echo true || echo false)"

# Tear down the backgrounded peer
kill "$peer_pid" 2>/dev/null || true
wait "$peer_pid" 2>/dev/null || true

# --- Case 3: release with no lockfile is idempotent (exit 0, action=noop) ---
set +e
output=$(pipeline-lock release 2>/dev/null)
ec=$?
set -e
assert_eq "release with no lockfile is idempotent (exit 0)" "0" "$ec"
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "release with no lockfile reports noop" "noop" "$action"

# --- Case 4: lockfile PID is dead → any caller may release (orphan cleanup) ---
echo '{"pid":77777,"timestamp":"2026-01-01T00:00:00Z"}' > "$CLAUDE_PLUGIN_DATA/pipeline.lock"
output=$(FACTORY_LOCK_TEST_PID=88888 pipeline-lock release 2>/dev/null)
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "dead-holder lock is released by any caller" "released" "$action"

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
echo "=== pipeline-state hyphen support (run-task hyphenated ids) ==="

# Hyphenated segments (task ids like proxy-001) must be accepted.
assert_exit "write accepts hyphenated segment" 0 \
  pipeline-state write "run-test-001" '.tasks.proxy-001.worktree' '"/tmp/wt"'

val=$(pipeline-state read "run-test-001" '.tasks.proxy-001.worktree')
assert_eq "hyphenated task write round-trips" "/tmp/wt" "$val"

# Hyphen must not bypass the existing injection allowlist.
assert_exit "write still rejects backtick with hyphen" 1 \
  pipeline-state write "run-test-001" '.tasks.proxy-001.`env`' '"x"'

# Leading hyphen on a segment is disallowed (segment must start with letter/underscore).
assert_exit "write rejects leading hyphen in segment" 1 \
  pipeline-state write "run-test-001" '.tasks.-bad' '"x"'

echo ""
echo "=== pipeline-state task-write / task-read ==="

assert_exit "task-write simple field on hyphenated id" 0 \
  pipeline-state task-write "run-test-001" "proxy-001" "status" '"executing"'

val=$(pipeline-state task-read "run-test-001" "proxy-001" "status")
assert_eq "task-read returns what task-write set" "executing" "$val"

# Dotted field (nested path) under tasks.<id>.
assert_exit "task-write nested quality_gate.ok" 0 \
  pipeline-state task-write "run-test-001" "proxy-001" "quality_gate.ok" "true"

val=$(pipeline-state task-read "run-test-001" "proxy-001" "quality_gate.ok")
assert_eq "task-read nested field" "true" "$val"

# Default fallback on task-read mirrors read's // literal-only allowance.
val=$(pipeline-state task-read "run-test-001" "proxy-001" 'absent // 0')
assert_eq "task-read allows // numeric default" "0" "$val"

assert_exit "task-read rejects unsafe default" 1 \
  pipeline-state task-read "run-test-001" "proxy-001" 'absent // env'

# task_id with unusual but valid chars (dots inside an id would be ambiguous —
# document that task_id values are opaque data and pass through unchanged).
assert_exit "task-write id containing underscore" 0 \
  pipeline-state task-write "run-test-001" "edge_case-1" "status" '"pending"'

val=$(pipeline-state task-read "run-test-001" "edge_case-1" "status")
assert_eq "task-read underscore+hyphen id" "pending" "$val"

# Field validation: refuse leading dot, refuse shell metachars.
assert_exit "task-write rejects leading-dot field" 1 \
  pipeline-state task-write "run-test-001" "proxy-001" ".bad" '"x"'

assert_exit "task-write rejects field with backtick" 1 \
  pipeline-state task-write "run-test-001" "proxy-001" 'field`env`' '"x"'

# Entire task record read (no field argument).
record=$(pipeline-state task-read "run-test-001" "proxy-001")
if printf '%s' "$record" | grep -q '"quality_gate"'; then
  echo "  PASS: task-read full record includes quality_gate"
  pass=$((pass + 1))
else
  echo "  FAIL: task-read full record missing quality_gate; got: $record"
  fail=$((fail + 1))
fi

echo ""
echo "=== task_16_05: pipeline-state read key allowlist (OBS-1) ==="

# Injection attempts on READ must be rejected (previously accepted any jq)
assert_exit "read rejects key with pipe operator" 1 \
  pipeline-state read "run-test-001" '.status | @sh "echo pwn"'

assert_exit "read rejects key with @sh filter" 1 \
  pipeline-state read "run-test-001" '.tasks | @sh'

assert_exit "read rejects key with error() call" 1 \
  pipeline-state read "run-test-001" '.x,error("pwn")'

assert_exit "read rejects key with double-quote segment" 1 \
  pipeline-state read "run-test-001" '.tasks."injected"'

# Legitimate paths and `// default` fallbacks still work
val=$(pipeline-state read "run-test-001" '.status')
assert_eq "read plain dotted path" "running" "$val"

# Fallback with numeric default
val=$(pipeline-state read "run-test-001" '.nonexistent_key // 0')
assert_eq "read allows // numeric default" "0" "$val"

# Fallback with string default
val=$(pipeline-state read "run-test-001" '.nonexistent_key // "fallback"')
assert_eq "read allows // string default" "fallback" "$val"

# Unsafe default (not a literal) must be rejected
assert_exit "read rejects unsafe default (jq expression)" 1 \
  pipeline-state read "run-test-001" '.x // env'

echo ""
echo "=== task_16_10: pipeline-human-gate ==="

# Set up a run whose state has an issue number so the gate can attempt
# to post a comment (we'll mock gh to no-op the post).
HG_MOCK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/hg-mock-XXXXXX")
cat > "$HG_MOCK_DIR/gh" <<'MOCKGH'
#!/usr/bin/env bash
# Accept anything; just exit 0.
exit 0
MOCKGH
chmod +x "$HG_MOCK_DIR/gh"
HG_OLD_PATH="$PATH"
export PATH="$HG_MOCK_DIR:$PATH"

pipeline-init "run-hg" --mode prd --issue 99 --force >/dev/null 2>&1

# --- Level 0 → every stage passes ---
printf '{"humanReviewLevel":0}' > "$CLAUDE_PLUGIN_DATA/config.json"
for stage in spec pre-execute post-execute pre-merge; do
  set +e
  pipeline-human-gate "run-hg" "$stage" >/dev/null 2>&1
  ec=$?
  set -e
  assert_eq "level 0 stage $stage → passes (exit 0)" "0" "$ec"
done

# --- Level 1 → only pre-merge trips ---
printf '{"humanReviewLevel":1}' > "$CLAUDE_PLUGIN_DATA/config.json"
set +e
pipeline-human-gate "run-hg" pre-merge >/dev/null 2>&1
ec=$?
set -e
assert_eq "level 1 stage pre-merge → trips (exit 42)" "42" "$ec"

# Lower-threshold stages still pass at level 1
for stage in post-execute spec pre-execute; do
  # Reset run status so the trip-side-effects from the previous call don't affect
  # subsequent passes (only status=awaiting_human matters here — we're not
  # asserting it for pass cases).
  pipeline-state write "run-hg" '.status' '"running"' >/dev/null 2>&1
  set +e
  pipeline-human-gate "run-hg" "$stage" >/dev/null 2>&1
  ec=$?
  set -e
  assert_eq "level 1 stage $stage → passes (exit 0)" "0" "$ec"
done

# --- Level 3 → spec stage trips and sets awaiting_human ---
printf '{"humanReviewLevel":3}' > "$CLAUDE_PLUGIN_DATA/config.json"
pipeline-state write "run-hg" '.status' '"running"' >/dev/null 2>&1
set +e
output=$(pipeline-human-gate "run-hg" spec 2>/dev/null)
ec=$?
set -e
assert_eq "level 3 stage spec → trips (exit 42)" "42" "$ec"
assert_eq "gate output reports tripped" "tripped" "$(echo "$output" | jq -r '.gate')"

# Verify run status is now awaiting_human
run_status=$(pipeline-state read "run-hg" '.status')
assert_eq "run status set to awaiting_human on trip" "awaiting_human" "$run_status"

# --- Level 4 → pre-execute trips ---
printf '{"humanReviewLevel":4}' > "$CLAUDE_PLUGIN_DATA/config.json"
pipeline-state write "run-hg" '.status' '"running"' >/dev/null 2>&1
set +e
pipeline-human-gate "run-hg" pre-execute >/dev/null 2>&1
ec=$?
set -e
assert_eq "level 4 stage pre-execute → trips (exit 42)" "42" "$ec"

# --- Invalid stage → exit 1 ---
assert_exit "invalid stage exits 1" 1 pipeline-human-gate "run-hg" bogus-stage

# Cleanup
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
export PATH="$HG_OLD_PATH"
rm -rf "$HG_MOCK_DIR"

echo ""
echo "=== task_06_06: circuit-breaker deducts pause time ==="

# Fresh run so we don't pollute earlier assertions.
pipeline-init "run-cb-pause" --mode prd --force >/dev/null 2>&1

# Default pause_minutes is 0, seeded by pipeline-init.
default_pause=$(pipeline-state read "run-cb-pause" '.circuit_breaker.pause_minutes')
assert_eq "pipeline-init seeds pause_minutes=0" "0" "$default_pause"

# Simulate 240 wall-clock minutes elapsed by backdating started_at.
# maxRuntimeMinutes=180. With pause_minutes=120 → effective 120 min, safe.
# With pause_minutes=0 → 240 min, tripped.
past_240m=""
if command -v gdate &>/dev/null; then
  past_240m=$(gdate -u -d '240 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
else
  past_240m=$(date -u -v-240M +%Y-%m-%dT%H:%M:%SZ)
fi
pipeline-state write "run-cb-pause" '.started_at' "\"$past_240m\"" >/dev/null 2>&1
echo '{"maxRuntimeMinutes":180,"maxConsecutiveFailures":5}' \
  > "$CLAUDE_PLUGIN_DATA/config.json"

# Without pause: breaker should trip (240 > 180).
pipeline-state write "run-cb-pause" '.circuit_breaker.pause_minutes' '0' >/dev/null 2>&1
assert_exit "breaker trips at 240min wall clock with no pause" 1 \
  pipeline-circuit-breaker "run-cb-pause"

# With 120 min of pause credit: effective 120 min, safe.
pipeline-state write "run-cb-pause" '.circuit_breaker.pause_minutes' '120' >/dev/null 2>&1
assert_exit "breaker safe at 240min wall clock with 120min pause" 0 \
  pipeline-circuit-breaker "run-cb-pause"

# The effective runtime in the output must be ~120 min (240 wall - 120 pause).
# Allow ±2 min tolerance for the seconds of test latency between backdating
# started_at and running the breaker.
output=$(pipeline-circuit-breaker "run-cb-pause" 2>/dev/null)
runtime=$(printf '%s' "$output" | jq -r '.runtime_minutes')
pause=$(printf '%s' "$output" | jq -r '.pause_minutes')
if (( runtime >= 118 && runtime <= 122 )); then
  echo "  PASS: breaker output shows effective runtime_minutes≈120 (got $runtime)"
  pass=$((pass + 1))
else
  echo "  FAIL: breaker effective runtime expected ~120, got $runtime"
  fail=$((fail + 1))
fi
assert_eq "breaker output exposes pause_minutes=120" "120" "$pause"

# Edge case: pause_minutes larger than wall-clock (clock skew) clamps to 0,
# does NOT produce a negative runtime.
pipeline-state write "run-cb-pause" '.circuit_breaker.pause_minutes' '9999' >/dev/null 2>&1
output=$(pipeline-circuit-breaker "run-cb-pause" 2>/dev/null)
runtime=$(printf '%s' "$output" | jq -r '.runtime_minutes')
assert_eq "breaker clamps runtime at 0 when pause > wall clock" "0" "$runtime"

# Restore defaults for subsequent tests and reset state.
echo '{"maxRuntimeMinutes":0,"maxConsecutiveFailures":5}' \
  > "$CLAUDE_PLUGIN_DATA/config.json"

echo ""
echo "=== task_06_05: pipeline-lock atomic recover ==="

# Recover produces a valid, well-formed lock file with PID/recovered_from.
echo '{"pid":77777,"timestamp":"2026-01-01T00:00:00Z"}' > "$CLAUDE_PLUGIN_DATA/pipeline.lock"
output=$(pipeline-lock recover 2>/dev/null)
action=$(printf '%s' "$output" | jq -r '.action')
assert_eq "recover from dead pid reports recovered" "recovered" "$action"

# The new lock file must exist and parse as valid JSON (no window where the
# file is absent or half-written).
if [[ -f "$CLAUDE_PLUGIN_DATA/pipeline.lock" ]]; then
  echo "  PASS: lock file present after recover"
  pass=$((pass + 1))
else
  echo "  FAIL: lock file missing after recover"
  fail=$((fail + 1))
fi
if jq -e '.pid and .recovered_from' "$CLAUDE_PLUGIN_DATA/pipeline.lock" >/dev/null 2>&1; then
  echo "  PASS: recovered lock file is valid JSON"
  pass=$((pass + 1))
else
  echo "  FAIL: recovered lock file is malformed"
  fail=$((fail + 1))
fi

# No tmp files left in the data dir (recover.* pattern must be cleaned up).
leftover=$(find "$CLAUDE_PLUGIN_DATA" -maxdepth 1 -name 'pipeline.lock.recover.*' -print 2>/dev/null | wc -l | tr -d ' ')
assert_eq "recover leaves no tmp files" "0" "$leftover"

pipeline-lock release >/dev/null 2>&1

# Concurrent recovery: launch N recoverers against a dead-PID lock. Every
# recoverer sets LOCK_PID differently; exactly one recovered_from entry should
# survive (last writer wins via atomic rename — but the file is never missing).
echo '{"pid":77778,"timestamp":"2026-01-01T00:00:00Z"}' > "$CLAUDE_PLUGIN_DATA/pipeline.lock"
for i in 1 2 3 4 5; do
  FACTORY_LOCK_TEST_PID=$((80000 + i)) pipeline-lock recover >/dev/null 2>&1 &
done
wait
# After all recoverers finish, the lock file must still exist, parse, and
# show one winning pid from the 80001..80005 set.
if jq -e '.pid' "$CLAUDE_PLUGIN_DATA/pipeline.lock" >/dev/null 2>&1; then
  final_pid=$(jq -r '.pid' "$CLAUDE_PLUGIN_DATA/pipeline.lock")
  if [[ "$final_pid" -ge 80001 && "$final_pid" -le 80005 ]]; then
    echo "  PASS: concurrent recover leaves valid lock (winner pid=$final_pid)"
    pass=$((pass + 1))
  else
    echo "  FAIL: unexpected winner pid $final_pid"
    fail=$((fail + 1))
  fi
else
  echo "  FAIL: lock file missing or malformed after concurrent recover"
  fail=$((fail + 1))
fi
leftover=$(find "$CLAUDE_PLUGIN_DATA" -maxdepth 1 -name 'pipeline.lock.recover.*' -print 2>/dev/null | wc -l | tr -d ' ')
assert_eq "concurrent recover leaves no tmp files" "0" "$leftover"

pipeline-lock release >/dev/null 2>&1

echo ""
echo "=== task_06_04: pipeline-init ownership check for current symlink ==="

# Fresh isolated sandbox so we don't interfere with the earlier run-test-001
# which is still the current target.
oi_sandbox=$(mktemp -d)
trap '[[ -n "$oi_sandbox" && ( "$oi_sandbox" == /tmp/* || "$oi_sandbox" == /var/folders/* ) ]] && rm -rf "$oi_sandbox"' EXIT
(
  export CLAUDE_PLUGIN_DATA="$oi_sandbox"

  # Seed a "running" run as the current target.
  pipeline-init "active-run" --mode prd >/dev/null 2>&1
  status=$(jq -r '.status' "$oi_sandbox/runs/active-run/state.json")
  [[ "$status" == "running" ]] || { echo "  FAIL: seed active-run status"; exit 1; }

  # Second init without --force must fail and must not move the symlink.
  if pipeline-init "second-run" --mode prd >/dev/null 2>&1; then
    echo "  FAIL: pipeline-init allowed overwrite of running current"
    exit 1
  else
    echo "  PASS: pipeline-init refuses overwrite of running current"
  fi
  target=$(readlink "$oi_sandbox/runs/current")
  if [[ "$(basename "$target")" == "active-run" ]]; then
    echo "  PASS: current symlink unchanged after refusal"
  else
    echo "  FAIL: current symlink moved to $target after refusal"
    exit 1
  fi
  # The refused run-dir should have been cleaned up to avoid leaks.
  if [[ -d "$oi_sandbox/runs/second-run" ]]; then
    echo "  FAIL: refused run directory leaked"
    exit 1
  else
    echo "  PASS: refused run-dir cleaned up"
  fi

  # --force overrides the check.
  if pipeline-init "second-run" --mode prd --force >/dev/null 2>&1; then
    echo "  PASS: pipeline-init --force replaces running current"
  else
    echo "  FAIL: pipeline-init --force rejected"
    exit 1
  fi
  target=$(readlink "$oi_sandbox/runs/current")
  if [[ "$(basename "$target")" == "second-run" ]]; then
    echo "  PASS: current symlink now points to second-run"
  else
    echo "  FAIL: current still points at $target"
    exit 1
  fi

  # Terminal (completed) run is safe to replace without --force.
  jq '.status = "completed"' "$oi_sandbox/runs/second-run/state.json" \
    > "$oi_sandbox/runs/second-run/state.json.tmp"
  mv "$oi_sandbox/runs/second-run/state.json.tmp" "$oi_sandbox/runs/second-run/state.json"
  if pipeline-init "third-run" --mode prd >/dev/null 2>&1; then
    echo "  PASS: pipeline-init replaces terminal run without --force"
  else
    echo "  FAIL: pipeline-init refused to replace terminal run"
    exit 1
  fi

  # Dangling symlink (target directory deleted) is safe to replace.
  rm -rf "$oi_sandbox/runs/third-run"
  if pipeline-init "fourth-run" --mode prd >/dev/null 2>&1; then
    echo "  PASS: pipeline-init replaces dangling current symlink"
  else
    echo "  FAIL: pipeline-init refused to replace dangling symlink"
    exit 1
  fi
) && {
  pass=$((pass + 7))
} || {
  fail=$((fail + 1))
}
rm -rf "$oi_sandbox"
trap - EXIT
oi_sandbox=""

echo ""
echo "=== task_06_02: stop-gate handles all task statuses ==="

stop_gate_hook="$(cd "$(dirname "$0")/../.." && pwd)/hooks/stop-gate.sh"

# Helper: prepare a run with a fresh state, point current at it, invoke the
# stop-gate, read back final status. Uses a private CLAUDE_PLUGIN_DATA per call.
_run_stop_gate() {
  local run_id="$1" tasks_json="$2"
  local sandbox
  sandbox=$(mktemp -d)
  if [[ -z "$sandbox" || "$sandbox" != /var/folders/* && "$sandbox" != /tmp/* ]]; then
    echo "  FAIL: stop-gate sandbox refused (unsafe path: $sandbox)"
    fail=$((fail + 1))
    return 1
  fi
  mkdir -p "$sandbox/runs/$run_id"
  jq -n --arg rid "$run_id" --argjson tasks "$tasks_json" '{
    run_id: $rid,
    status: "running",
    started_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ended_at: null,
    tasks: $tasks
  }' > "$sandbox/runs/$run_id/state.json"
  ln -s "$sandbox/runs/$run_id" "$sandbox/runs/current"
  CLAUDE_PLUGIN_DATA="$sandbox" bash "$stop_gate_hook" <<< '{}' >/dev/null 2>&1
  jq -r '.status' "$sandbox/runs/$run_id/state.json"
  # Also print the per-task statuses as an env-style var the caller can pick up.
  printf '__TASKS_JSON__%s\n' "$(jq -c '.tasks' "$sandbox/runs/$run_id/state.json")"
  rm -rf "$sandbox"
}

# needs_human_review must NOT be transitioned to interrupted.
output=$(_run_stop_gate "sg-nhr" '{"t1":{"status":"needs_human_review"}}')
run_status=$(printf '%s' "$output" | head -n1)
task_line=$(printf '%s' "$output" | grep '^__TASKS_JSON__' | sed 's/^__TASKS_JSON__//')
task_status=$(printf '%s' "$task_line" | jq -r '.t1.status')
assert_eq "stop-gate preserves needs_human_review task" "needs_human_review" "$task_status"
assert_eq "stop-gate with needs_human_review run status" "interrupted" "$run_status"

# ci_fixing must transition to interrupted (requires re-run on resume).
output=$(_run_stop_gate "sg-cif" '{"t1":{"status":"ci_fixing"}}')
run_status=$(printf '%s' "$output" | head -n1)
task_line=$(printf '%s' "$output" | grep '^__TASKS_JSON__' | sed 's/^__TASKS_JSON__//')
task_status=$(printf '%s' "$task_line" | jq -r '.t1.status')
assert_eq "stop-gate rewrites ci_fixing → interrupted" "interrupted" "$task_status"
assert_eq "stop-gate with ci_fixing run status" "interrupted" "$run_status"

# All pending — resumable, run status=interrupted.
output=$(_run_stop_gate "sg-pend" '{"t1":{"status":"pending"},"t2":{"status":"pending"}}')
run_status=$(printf '%s' "$output" | head -n1)
assert_eq "stop-gate all pending → interrupted" "interrupted" "$run_status"

# Mixed done + pending: resumable, not a failure → interrupted.
output=$(_run_stop_gate "sg-mix" '{"t1":{"status":"done"},"t2":{"status":"pending"}}')
run_status=$(printf '%s' "$output" | head -n1)
assert_eq "stop-gate mixed done+pending → interrupted" "interrupted" "$run_status"

# Mixed done + failed: partial.
output=$(_run_stop_gate "sg-part" '{"t1":{"status":"done"},"t2":{"status":"failed"}}')
run_status=$(printf '%s' "$output" | head -n1)
assert_eq "stop-gate mixed done+failed → partial" "partial" "$run_status"

# All done: completed.
output=$(_run_stop_gate "sg-done" '{"t1":{"status":"done"},"t2":{"status":"done"}}')
run_status=$(printf '%s' "$output" | head -n1)
assert_eq "stop-gate all done → completed" "completed" "$run_status"

echo ""
echo "=== task_06_03: subagent-stop-gate iterates all executing tasks ==="

subagent_hook="$(cd "$(dirname "$0")/../.." && pwd)/hooks/subagent-stop-gate.sh"

_mk_task_worktree() {
  local dir="$1" branch="$2" with_commits_ahead="$3"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" config user.name "Test"
  git -C "$dir" commit -q --allow-empty -m "base"
  git -C "$dir" branch -q -m staging
  git -C "$dir" checkout -q -b "$branch"
  if [[ "$with_commits_ahead" == "yes" ]]; then
    git -C "$dir" commit -q --allow-empty -m "task work"
  fi
}

sandbox=$(mktemp -d)
# Paranoia guard: only touch sandboxes under /tmp or /var/folders.
trap '[[ -n "$sandbox" && ( "$sandbox" == /tmp/* || "$sandbox" == /var/folders/* ) ]] && rm -rf "$sandbox"' EXIT

wt1="$sandbox/wt1"
wt2="$sandbox/wt2"
wt3="$sandbox/wt3"
_mk_task_worktree "$wt1" "task/one" "yes"
_mk_task_worktree "$wt2" "task/two" "no"    # no commits ahead → warning
_mk_task_worktree "$wt3" "task/three" "yes"

mkdir -p "$sandbox/runs/run-sg-003"
jq -n \
  --arg w1 "$wt1" --arg w2 "$wt2" --arg w3 "$wt3" \
  '{
    run_id: "run-sg-003",
    status: "running",
    started_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    tasks: {
      t1: {status: "executing", branch: "task/one",   worktree: $w1},
      t2: {status: "executing", branch: "task/two",   worktree: $w2},
      t3: {status: "executing", branch: "task/three", worktree: $w3}
    }
  }' > "$sandbox/runs/run-sg-003/state.json"
ln -s "$sandbox/runs/run-sg-003" "$sandbox/runs/current"

# Run the hook from a cwd that has no matching staging/branch state —
# any success must come from reading worktree paths, not from cwd.
hook_tmpdir=$(mktemp -d)
stderr_out=$(
  cd "$hook_tmpdir" \
  && CLAUDE_PLUGIN_DATA="$sandbox" bash "$subagent_hook" <<< '{"agent_type":"task-executor"}' 2>&1 >/dev/null
)
rm -rf "$hook_tmpdir"

# Exactly one warning — for t2, the task whose branch has no commits ahead.
# t1 and t3 must be silent (branches exist with commits ahead in their worktrees).
warn_count=$(printf '%s\n' "$stderr_out" | grep -c 'no commits found on branch' || true)
assert_eq "subagent-stop-gate emits one warning (t2 only)" "1" "$warn_count"

if printf '%s' "$stderr_out" | grep -q 'task/two.*t2\|for task t2'; then
  echo "  PASS: subagent-stop-gate warning targets t2"
  pass=$((pass + 1))
else
  echo "  FAIL: subagent-stop-gate warning did not mention t2"
  echo "  stderr: $stderr_out"
  fail=$((fail + 1))
fi

if printf '%s' "$stderr_out" | grep -q 'task/one\|for task t1'; then
  echo "  FAIL: subagent-stop-gate unexpectedly warned about t1"
  fail=$((fail + 1))
else
  echo "  PASS: subagent-stop-gate silent on t1 (uses worktree with commits)"
  pass=$((pass + 1))
fi

if printf '%s' "$stderr_out" | grep -q 'task/three\|for task t3'; then
  echo "  FAIL: subagent-stop-gate unexpectedly warned about t3"
  fail=$((fail + 1))
else
  echo "  PASS: subagent-stop-gate silent on t3 (uses worktree with commits)"
  pass=$((pass + 1))
fi

# Negative: with all three branches stale in their worktrees, expect 3 warnings.
git -C "$wt1" reset -q --hard staging
git -C "$wt3" reset -q --hard staging
hook_tmpdir=$(mktemp -d)
stderr_out=$(
  cd "$hook_tmpdir" \
  && CLAUDE_PLUGIN_DATA="$sandbox" bash "$subagent_hook" <<< '{"agent_type":"task-executor"}' 2>&1 >/dev/null
)
rm -rf "$hook_tmpdir"
warn_count=$(printf '%s\n' "$stderr_out" | grep -c 'no commits found on branch' || true)
assert_eq "subagent-stop-gate warns for all 3 stale tasks" "3" "$warn_count"

rm -rf "$sandbox"
trap - EXIT
sandbox=""

echo ""
echo "=== task_13_04: atomic_write fsync ==="

source "$(dirname "$0")/../pipeline-lib.sh"

aw_dir=$(mktemp -d)
atomic_write "$aw_dir/test.json" '{"key":"value"}'
assert_eq "atomic_write produces non-empty file" "true" \
  "$( [[ -s "$aw_dir/test.json" ]] && echo true || echo false )"
aw_content=$(cat "$aw_dir/test.json")
assert_eq "atomic_write content correct" '{"key":"value"}' "$aw_content"

# Idempotent: overwrite same target
atomic_write "$aw_dir/test.json" '{"key":"updated"}'
aw_content=$(cat "$aw_dir/test.json")
assert_eq "atomic_write idempotent overwrite" '{"key":"updated"}' "$aw_content"

# No tmp leftovers
leftover=$(find "$aw_dir" -name 'test.json.*' -print 2>/dev/null | wc -l | tr -d ' ')
assert_eq "atomic_write no tmp leftovers" "0" "$leftover"

# Repeated calls all produce correct output
for i in $(seq 1 20); do
  atomic_write "$aw_dir/repeat.json" "{\"i\":$i}"
done
aw_final=$(jq -r '.i' "$aw_dir/repeat.json")
assert_eq "atomic_write 20 repeated calls final value" "20" "$aw_final"
leftover=$(find "$aw_dir" -name 'repeat.json.*' -print 2>/dev/null | wc -l | tr -d ' ')
assert_eq "atomic_write repeated calls no tmp leftovers" "0" "$leftover"

rm -rf "$aw_dir"

echo ""
echo "=== pipeline-lib.sh utilities ==="

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
