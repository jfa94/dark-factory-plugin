#!/usr/bin/env bash
# routing.sh — pipeline-quota-check (statusline capture),
# pipeline-model-router (limits, wait/end_gracefully, input validation),
# pipeline-lib window math helpers.
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")/.." && pwd):$PATH"

# Source pipeline-lib.sh up front so the window-math helper tests below can
# call its internal functions directly. Must come before any function that
# installs a RETURN trap, since RETURN traps fire on source completion.
source "$(cd "$(dirname "$0")/.." && pwd)/pipeline-lib.sh"

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

# ============================================================
echo "=== pipeline-quota-check (fail-closed sentinel) ==="

# Helpers: capture both exit code and stdout from a subshell
_run_quota_no_cache_sentinel() (
  empty_data=$(mktemp -d)
  trap '[[ "$empty_data" == /tmp/* ]] && rm -rf "$empty_data"' EXIT
  env CLAUDE_PLUGIN_DATA="$empty_data" pipeline-quota-check
)

_run_quota_bad_json_sentinel() (
  test_data=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"' EXIT
  printf 'not-json' > "$test_data/usage-cache.json"
  env CLAUDE_PLUGIN_DATA="$test_data" pipeline-quota-check
)

_run_quota_missing_fields_sentinel() (
  test_data=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"' EXIT
  printf '{"captured_at":1775822400}' > "$test_data/usage-cache.json"
  env CLAUDE_PLUGIN_DATA="$test_data" pipeline-quota-check
)

# (1) Missing cache → exits 0 with sentinel
assert_exit "missing cache exits 0 (sentinel)" 0 _run_quota_no_cache_sentinel
set +e; _out=$(_run_quota_no_cache_sentinel 2>/dev/null); set -e
assert_eq "missing cache: detection_method=unavailable" "unavailable" "$(printf '%s' "$_out" | jq -r '.detection_method')"
assert_eq "missing cache: reason" "usage-cache-missing" "$(printf '%s' "$_out" | jq -r '.reason')"
assert_eq "missing cache: five_hour.over_threshold=true" "true" "$(printf '%s' "$_out" | jq -r '.five_hour.over_threshold')"
assert_eq "missing cache: seven_day.over_threshold=true" "true" "$(printf '%s' "$_out" | jq -r '.seven_day.over_threshold')"

# (2) Invalid JSON → exits 0 with sentinel
assert_exit "invalid JSON exits 0 (sentinel)" 0 _run_quota_bad_json_sentinel
set +e; _out=$(_run_quota_bad_json_sentinel 2>/dev/null); set -e
assert_eq "bad JSON: detection_method=unavailable" "unavailable" "$(printf '%s' "$_out" | jq -r '.detection_method')"
assert_eq "bad JSON: reason=usage-cache-malformed" "usage-cache-malformed" "$(printf '%s' "$_out" | jq -r '.reason')"

# (3) Missing fields → exits 0 with sentinel
assert_exit "missing fields exits 0 (sentinel)" 0 _run_quota_missing_fields_sentinel
set +e; _out=$(_run_quota_missing_fields_sentinel 2>/dev/null); set -e
assert_eq "missing fields: detection_method=unavailable" "unavailable" "$(printf '%s' "$_out" | jq -r '.detection_method')"

# (4) --strict flag: missing cache → exits 1
_run_quota_no_cache_strict() (
  empty_data=$(mktemp -d)
  trap '[[ "$empty_data" == /tmp/* ]] && rm -rf "$empty_data"' EXIT
  env CLAUDE_PLUGIN_DATA="$empty_data" pipeline-quota-check --strict
)
assert_exit "missing cache with --strict exits 1" 1 _run_quota_no_cache_strict

# (5) --strict flag: invalid JSON → exits 1
_run_quota_bad_json_strict() (
  test_data=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"' EXIT
  printf 'not-json' > "$test_data/usage-cache.json"
  env CLAUDE_PLUGIN_DATA="$test_data" pipeline-quota-check --strict
)
assert_exit "invalid JSON with --strict exits 1" 1 _run_quota_bad_json_strict

# (4) Grep guard: legacy detection symbols must not appear in the script
_script="$(cd "$(dirname "$0")/.." && pwd)/pipeline-quota-check"
legacy_refs=$(grep -cE 'last-headers|_check_headers|_check_oauth|_check_cli|--method' "$_script" || true)
assert_eq "legacy detection symbols fully removed" "0" "$legacy_refs"

# ============================================================
echo ""
echo "=== pipeline-quota-check (statusline — valid cache) ==="

# Helper: run pipeline-quota-check with an isolated CLAUDE_PLUGIN_DATA dir
# containing a usage-cache.json fixture and a stubbed `date +%s`.
# now_epoch (1775822400) = 2026-04-10T12:00:00Z
#
# Fixture values:
#   five_hour.used_percentage=15, resets_at=1775839800 (now+17400 → 10min elapsed → window_hour=1, threshold=20)
#   seven_day.used_percentage=40, resets_at=1776124800 (now+302400 → 3.5d elapsed → window_day=4, threshold=57)
#   captured_at=1775822390 (10s before now → fresh)
_valid_cache_fixture='{
  "five_hour": {"used_percentage": 15, "resets_at": 1775839800},
  "seven_day": {"used_percentage": 40, "resets_at": 1776124800},
  "captured_at": 1775822390
}'

_run_statusline_check() (
  fixture="${1:-}"
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  if [[ -n "$fixture" ]]; then
    printf '%s' "$fixture" > "$test_data/usage-cache.json"
  else
    printf '%s' "$_valid_cache_fixture" > "$test_data/usage-cache.json"
  fi

  cat > "$mocks_dir/date" <<'MOCK_EOF'
#!/usr/bin/env bash
case "$*" in
  "+%s") echo "1775822400" ;;
  *) exec /bin/date "$@" ;;
esac
MOCK_EOF
  chmod +x "$mocks_dir/date"

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" pipeline-quota-check
)

set +e
output=$(_run_statusline_check 2>/dev/null)
rc=$?
set -e
assert_eq "valid cache exits 0" "0" "$rc"
assert_eq "five_hour.utilization" "15" "$(printf '%s' "$output" | jq -r '.five_hour.utilization')"
assert_eq "five_hour.window_hour" "1" "$(printf '%s' "$output" | jq -r '.five_hour.window_hour')"
assert_eq "five_hour.hourly_threshold" "20" "$(printf '%s' "$output" | jq -r '.five_hour.hourly_threshold')"
assert_eq "five_hour.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.five_hour.over_threshold')"
assert_eq "five_hour.resets_at_epoch" "1775839800" "$(printf '%s' "$output" | jq -r '.five_hour.resets_at_epoch')"
assert_eq "seven_day.utilization" "40" "$(printf '%s' "$output" | jq -r '.seven_day.utilization')"
assert_eq "seven_day.window_day" "4" "$(printf '%s' "$output" | jq -r '.seven_day.window_day')"
assert_eq "seven_day.daily_threshold" "57" "$(printf '%s' "$output" | jq -r '.seven_day.daily_threshold')"
assert_eq "seven_day.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.seven_day.over_threshold')"
assert_eq "seven_day.resets_at_epoch" "1776124800" "$(printf '%s' "$output" | jq -r '.seven_day.resets_at_epoch')"
assert_eq "detection_method=statusline" "statusline" "$(printf '%s' "$output" | jq -r '.detection_method')"

# Over-threshold: five_hour.used_percentage=95 → 95 > 20 (window_hour=1) → over_threshold=true
_over_fixture='{
  "five_hour": {"used_percentage": 95, "resets_at": 1775839800},
  "seven_day": {"used_percentage": 10, "resets_at": 1776124800},
  "captured_at": 1775822390
}'
set +e
output=$(_run_statusline_check "$_over_fixture" 2>/dev/null)
set -e
assert_eq "five_hour over_threshold true (95>20)" "true" "$(printf '%s' "$output" | jq -r '.five_hour.over_threshold')"

# Float utilization is rounded to integer
_float_fixture='{
  "five_hour": {"used_percentage": 45.7, "resets_at": 1775839800},
  "seven_day": {"used_percentage": 20.3, "resets_at": 1776124800},
  "captured_at": 1775822390
}'
set +e
output=$(_run_statusline_check "$_float_fixture" 2>/dev/null)
set -e
assert_eq "float utilization rounded to integer" "46" "$(printf '%s' "$output" | jq -r '.five_hour.utilization')"

# ============================================================
echo ""
echo "=== pipeline-quota-check (statusline — stale cache) ==="

# Stale cache (>120s old): emits a warning on stderr but still exits 0
# and returns the cached data (most recent available during a long tool call).
_run_stale_check() (
  test_data=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"' EXIT
  stale_captured=$(( $(date +%s) - 200 ))
  printf '{"five_hour":{"used_percentage":10,"resets_at":9999999999},"seven_day":{"used_percentage":10,"resets_at":9999999999},"captured_at":'"$stale_captured"'}' \
    > "$test_data/usage-cache.json"
  env CLAUDE_PLUGIN_DATA="$test_data" pipeline-quota-check
)

assert_exit "stale cache exits 0 (data still used)" 0 _run_stale_check

set +e
stale_output=$(_run_stale_check 2>/dev/null)
set -e
assert_eq "stale cache still returns detection_method" "statusline" \
  "$(printf '%s' "$stale_output" | jq -r '.detection_method')"

# ============================================================
echo ""
echo "=== pipeline-model-router (within limits) ==="

quota='{"five_hour":{"utilization":30,"hourly_threshold":60,"over_threshold":false,"window_hour":3,"resets_at_epoch":9999999999},"seven_day":{"utilization":40,"daily_threshold":57,"over_threshold":false,"window_day":4,"resets_at_epoch":9999999999},"detection_method":"statusline"}'

output=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
assert_eq "within limits → proceed" "proceed" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "within limits → anthropic" "anthropic" "$(printf '%s' "$output" | jq -r '.provider')"
assert_eq "routine cap" "2" "$(printf '%s' "$output" | jq -r '.review_cap')"

output=$(pipeline-model-router --quota "$quota" --tier feature 2>/dev/null)
assert_eq "feature cap" "4" "$(printf '%s' "$output" | jq -r '.review_cap')"

output=$(pipeline-model-router --quota "$quota" --tier security 2>/dev/null)
assert_eq "security cap" "6" "$(printf '%s' "$output" | jq -r '.review_cap')"

# ============================================================
echo ""
echo "=== pipeline-model-router (5h over, 7d within) ==="

# resets_at_epoch = now + 3600 → ~60 min remaining
future_5h_epoch=$(( $(date +%s) + 3600 ))
quota='{"five_hour":{"utilization":95,"hourly_threshold":60,"over_threshold":true,"window_hour":3,"resets_at_epoch":'"$future_5h_epoch"'},"seven_day":{"utilization":40,"daily_threshold":57,"over_threshold":false,"window_day":4,"resets_at_epoch":9999999999},"detection_method":"statusline"}'

output=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
assert_eq "5h over → wait" "wait" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "5h over trigger" "5h_over" "$(printf '%s' "$output" | jq -r '.trigger')"
assert_eq "wait has positive minutes" "true" \
  "$(printf '%s' "$output" | jq -e '.wait_minutes > 0' >/dev/null 2>&1 && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-model-router (7d over) ==="

quota='{"five_hour":{"utilization":95,"hourly_threshold":60,"over_threshold":true,"window_hour":3,"resets_at_epoch":9999999999},"seven_day":{"utilization":100,"daily_threshold":57,"over_threshold":true,"window_day":4,"resets_at_epoch":9999999999},"detection_method":"statusline"}'

output=$(pipeline-model-router --quota "$quota" --tier feature 2>/dev/null)
assert_eq "7d over → end_gracefully" "end_gracefully" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "7d over trigger" "7d_over" "$(printf '%s' "$output" | jq -r '.trigger')"

# ============================================================
echo ""
echo "=== pipeline-model-router (unavailable sentinel) ==="

unavailable_quota='{"detection_method":"unavailable","reason":"usage-cache-missing","five_hour":{"over_threshold":true},"seven_day":{"over_threshold":true}}'

output=$(pipeline-model-router --quota "$unavailable_quota" --tier routine 2>/dev/null)
assert_eq "unavailable → end_gracefully" "end_gracefully" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "unavailable trigger" "quota_detection_failed" "$(printf '%s' "$output" | jq -r '.trigger')"
assert_eq "unavailable reason preserved" "usage-cache-missing" "$(printf '%s' "$output" | jq -r '.reason')"

# ============================================================
echo ""
echo "=== pipeline-model-router (missing quota) ==="

assert_exit "missing quota exits 1" 1 pipeline-model-router --tier routine

# ============================================================
echo ""
echo "=== pipeline-model-router (invalid tier) ==="

assert_exit "invalid tier exits 1" 1 pipeline-model-router --quota '{}' --tier bogus

# ============================================================
echo ""
echo "=== pipeline-model-router (unknown flag) ==="

assert_exit "unknown flag exits 1" 1 pipeline-model-router --bogus

# ============================================================
echo ""
echo "=== pipeline-lib window math helpers (task_02_02) ==="

# Window math helpers live in pipeline-lib.sh so both pipeline-quota-check and
# any future callers share a single source of truth. These tests pin pure-
# function behavior: no mocking, no I/O.
# (pipeline-lib.sh is sourced at the top of this file.)

# Fixed reference epoch (2026-04-10T12:00:00Z). The specific value doesn't
# matter — we construct resets_at relative to it.
_now=1775822400

# 5-hour window (18000s).
# 10 minutes (600s) elapsed → resets_at = now + (18000 - 600) = now + 17400
_resets=$((_now + 17400))
assert_eq "window_hour=1 when 10m into the window" "1" "$(compute_window_hour "$_resets" "$_now")"

# 4.5 hours (16200s) elapsed → resets_at = now + (18000 - 16200) = now + 1800
_resets=$((_now + 1800))
assert_eq "window_hour=5 when 4.5h into the window" "5" "$(compute_window_hour "$_resets" "$_now")"

# Exactly at window boundary: 0s elapsed → resets_at = now + 18000
_resets=$((_now + 18000))
assert_eq "window_hour=1 at window start" "1" "$(compute_window_hour "$_resets" "$_now")"

# Clamp: resets_at far in the future (caller bug) → clamp to 1
_resets=$((_now + 99999))
assert_eq "window_hour clamps to 1 when resets_at beyond 5h" "1" "$(compute_window_hour "$_resets" "$_now")"

# Clamp: resets_at in the past → clamp to 5
_resets=$((_now - 3600))
assert_eq "window_hour clamps to 5 when resets_at in past" "5" "$(compute_window_hour "$_resets" "$_now")"

# 7-day window (604800s).
# 3.5 days (302400s) elapsed → resets_at = now + (604800 - 302400) = now + 302400
_resets=$((_now + 302400))
assert_eq "window_day=4 when 3.5d into a 7d window" "4" "$(compute_window_day "$_resets" "$_now")"

# Exactly at window start
_resets=$((_now + 604800))
assert_eq "window_day=1 at 7d window start" "1" "$(compute_window_day "$_resets" "$_now")"

# Just before 7d window closes (6.9 days in)
_resets=$((_now + 8640))
assert_eq "window_day=7 near 7d window end" "7" "$(compute_window_day "$_resets" "$_now")"

# Hourly thresholds: linear up to cap.
assert_eq "hourly_threshold window_hour=1" "20" "$(compute_hourly_threshold 1)"
assert_eq "hourly_threshold window_hour=2" "40" "$(compute_hourly_threshold 2)"
assert_eq "hourly_threshold window_hour=3" "60" "$(compute_hourly_threshold 3)"
assert_eq "hourly_threshold window_hour=4" "80" "$(compute_hourly_threshold 4)"
assert_eq "hourly_threshold caps at 90 for window_hour=5" "90" "$(compute_hourly_threshold 5)"

# Daily thresholds: explicit array [14, 29, 43, 57, 71, 86, 95].
# Critical: day 7 must be 95, NOT 100 (leaves headroom for burst-in-final-day).
assert_eq "daily_threshold day 1" "14" "$(compute_daily_threshold 1)"
assert_eq "daily_threshold day 2" "29" "$(compute_daily_threshold 2)"
assert_eq "daily_threshold day 3" "43" "$(compute_daily_threshold 3)"
assert_eq "daily_threshold day 4" "57" "$(compute_daily_threshold 4)"
assert_eq "daily_threshold day 5" "71" "$(compute_daily_threshold 5)"
assert_eq "daily_threshold day 6" "86" "$(compute_daily_threshold 6)"
assert_eq "daily_threshold day 7 is 95 not 100" "95" "$(compute_daily_threshold 7)"

# parse_iso8601_to_epoch round-trips a known UTC ISO timestamp.
# 2026-04-10T12:00:00Z = 1775822400
assert_eq "parse_iso8601_to_epoch 2026-04-10T12:00:00Z" "1775822400" "$(parse_iso8601_to_epoch "2026-04-10T12:00:00Z")"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
