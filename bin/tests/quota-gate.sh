#!/usr/bin/env bash
# quota-gate.sh — pipeline_quota_gate (pipeline-lib.sh) behavior across
# proceed / wait_retry / end_gracefully outcomes, stuck-cache guard, and
# pause_minutes accounting.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$PLUGIN_ROOT/bin:$PATH"

# Isolated plugin data dir (real pipeline-state will use this).
TEST_ROOT=$(mktemp -d)
trap '[[ "$TEST_ROOT" == /tmp/* ]] && rm -rf "$TEST_ROOT"' EXIT
export CLAUDE_PLUGIN_DATA="$TEST_ROOT/plugin-data"
mkdir -p "$CLAUDE_PLUGIN_DATA"

# Fast-path sleep cap (1s) so wait-branch tests don't block.
export FACTORY_QUOTA_GATE_SLEEP_CAP_SEC=1

source "$PLUGIN_ROOT/bin/pipeline-lib.sh"

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

# Per-test scratch: fresh mocks dir on PATH, fresh run dir.
_reset_scratch() {
  local run_id="$1"
  MOCKS=$(mktemp -d)
  export PATH="$MOCKS:$PLUGIN_ROOT/bin:$(echo "$PATH" | sed "s|$MOCKS:||g")"
  rm -rf "$CLAUDE_PLUGIN_DATA/runs/$run_id"
  mkdir -p "$CLAUDE_PLUGIN_DATA/runs/$run_id"
  printf '{"circuit_breaker":{}}' > "$CLAUDE_PLUGIN_DATA/runs/$run_id/state.json"
}

# Stub quota-check: returns pre-canned fixture for N calls. Args: <fixture-json>...
_stub_quota_check_sequence() {
  local i=1
  for fixture in "$@"; do
    printf '%s\n' "$fixture" > "$MOCKS/_quota_fixture_$i"
    i=$(( i + 1 ))
  done
  cat > "$MOCKS/pipeline-quota-check" <<'STUB'
#!/usr/bin/env bash
mocks_dir="$(dirname "$0")"
counter_file="$mocks_dir/_quota_counter"
n=$(cat "$counter_file" 2>/dev/null || echo 0)
n=$(( n + 1 ))
echo "$n" > "$counter_file"
cat "$mocks_dir/_quota_fixture_$n"
STUB
  chmod +x "$MOCKS/pipeline-quota-check"
  : > "$MOCKS/_quota_counter"
}

# Stub model-router: returns pre-canned fixture for N calls.
_stub_router_sequence() {
  local i=1
  for fixture in "$@"; do
    printf '%s\n' "$fixture" > "$MOCKS/_router_fixture_$i"
    i=$(( i + 1 ))
  done
  cat > "$MOCKS/pipeline-model-router" <<'STUB'
#!/usr/bin/env bash
mocks_dir="$(dirname "$0")"
counter_file="$mocks_dir/_router_counter"
n=$(cat "$counter_file" 2>/dev/null || echo 0)
n=$(( n + 1 ))
echo "$n" > "$counter_file"
cat "$mocks_dir/_router_fixture_$n"
STUB
  chmod +x "$MOCKS/pipeline-model-router"
  : > "$MOCKS/_router_counter"
}

# ============================================================
echo "=== pipeline_quota_gate: proceed ==="

_reset_scratch run-1
_stub_quota_check_sequence '{"detection_method":"statusline"}'
_stub_router_sequence '{"action":"proceed","provider":"anthropic"}'
# Pre-set wait cycles to verify reset-on-proceed.
pipeline-state write run-1 '.circuit_breaker.quota_wait_cycles' '5' >/dev/null
set +e; pipeline_quota_gate run-1 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "proceed → exit 0" "0" "$rc"
cycles=$(pipeline-state read run-1 '.circuit_breaker.quota_wait_cycles' 2>/dev/null)
assert_eq "proceed resets quota_wait_cycles to 0" "0" "$cycles"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: end_gracefully direct ==="

_reset_scratch run-2
_stub_quota_check_sequence '{"detection_method":"unavailable","reason":"usage-cache-missing"}'
_stub_router_sequence '{"action":"end_gracefully","trigger":"quota_detection_failed"}'
set +e; pipeline_quota_gate run-2 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "end_gracefully → exit 2" "2" "$rc"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: wait then proceed ==="

_reset_scratch run-3
_stub_quota_check_sequence '{"first":1}' '{"second":1}'
_stub_router_sequence \
  '{"action":"wait","wait_minutes":1,"trigger":"5h_over"}' \
  '{"action":"proceed"}'
set +e; pipeline_quota_gate run-3 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "wait→proceed → exit 0" "0" "$rc"
# Sleep cap is 1s; slept_min = ceil(1/60) = 1
pause=$(pipeline-state read run-3 '.circuit_breaker.pause_minutes' 2>/dev/null)
assert_eq "pause_minutes recorded" "1" "$pause"
cycles=$(pipeline-state read run-3 '.circuit_breaker.quota_wait_cycles' 2>/dev/null)
assert_eq "proceed-after-wait resets quota_wait_cycles" "0" "$cycles"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: wait then still wait → yield (exit 3) ==="

_reset_scratch run-4
_stub_quota_check_sequence '{"first":1}' '{"second":1}'
_stub_router_sequence \
  '{"action":"wait","wait_minutes":1,"trigger":"5h_over"}' \
  '{"action":"wait","wait_minutes":60,"trigger":"5h_over"}'
set +e; pipeline_quota_gate run-4 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "wait→wait → exit 3 (wait_retry)" "3" "$rc"
cycles=$(pipeline-state read run-4 '.circuit_breaker.quota_wait_cycles' 2>/dev/null)
assert_eq "quota_wait_cycles incremented on yield" "1" "$cycles"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: stuck-cache cap ==="

_reset_scratch run-5
export FACTORY_QUOTA_GATE_MAX_CYCLES=3
pipeline-state write run-5 '.circuit_breaker.quota_wait_cycles' '3' >/dev/null
# Stubs shouldn't even get called — cap checked first.
_stub_quota_check_sequence '{"never":"called"}'
_stub_router_sequence '{"action":"proceed"}'
set +e; pipeline_quota_gate run-5 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "cycles==cap → exit 2" "2" "$rc"
unset FACTORY_QUOTA_GATE_MAX_CYCLES

# ============================================================
echo ""
echo "=== pipeline_quota_gate: wait with no wait_minutes ==="

_reset_scratch run-6
_stub_quota_check_sequence '{"first":1}'
_stub_router_sequence '{"action":"wait","trigger":"5h_over"}'
set +e; pipeline_quota_gate run-6 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "wait with no wait_minutes → exit 2" "2" "$rc"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: empty run_id ==="

_reset_scratch run-7
set +e; pipeline_quota_gate "" feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "empty run_id → exit 2" "2" "$rc"

# ============================================================
echo ""
echo "=== pipeline_quota_gate: unknown router action ==="

_reset_scratch run-8
_stub_quota_check_sequence '{"detection_method":"statusline"}'
_stub_router_sequence '{"action":"whatever"}'
set +e; pipeline_quota_gate run-8 feature gate-A >/dev/null 2>&1; rc=$?; set -e
assert_eq "unknown action → exit 2" "2" "$rc"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

[[ $fail -eq 0 ]] && exit 0 || exit 1
