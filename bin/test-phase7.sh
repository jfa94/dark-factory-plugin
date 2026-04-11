#!/usr/bin/env bash
# Phase 7 verification tests
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")" && pwd):$PATH"

# Source pipeline-lib.sh up front so the window-math helper tests below can
# call its internal functions directly. Must come before any function that
# installs a RETURN trap, since RETURN traps fire on source completion.
source "$(cd "$(dirname "$0")" && pwd)/pipeline-lib.sh"

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
echo "=== pipeline-quota-check (auto fallback) ==="

# Without Keychain or claude CLI, auto should return safe defaults
output=$(pipeline-quota-check --method auto 2>/dev/null)
assert_eq "auto returns JSON" "0" "$(printf '%s' "$output" | jq -e . >/dev/null 2>&1; echo $?)"
assert_eq "auto has five_hour" "true" "$(printf '%s' "$output" | jq -e '.five_hour' >/dev/null 2>&1 && echo true || echo false)"
assert_eq "auto has seven_day" "true" "$(printf '%s' "$output" | jq -e '.seven_day' >/dev/null 2>&1 && echo true || echo false)"
assert_eq "auto has detection_method" "true" "$(printf '%s' "$output" | jq -e '.detection_method' >/dev/null 2>&1 && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-quota-check (invalid method) ==="

assert_exit "invalid method exits 1" 1 pipeline-quota-check --method bogus

# ============================================================
echo ""
echo "=== pipeline-quota-check (headers — no probe available) ==="

# After task_02_03 _check_headers is no longer a stub. With no last-headers.json
# AND no usable cold-start probe, the method must still exit 1. Isolate the
# environment so the test can't hit a real `claude` binary on the host.
# Subshell + EXIT trap so locals/traps don't leak past the function call.
_run_headers_no_probe() (
  empty_data=$(mktemp -d)
  probe_dir=$(mktemp -d)
  trap '[[ "$empty_data" == /tmp/* ]] && rm -rf "$empty_data"; [[ "$probe_dir" == /tmp/* ]] && rm -rf "$probe_dir"' EXIT
  cat > "$probe_dir/claude" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 1
MOCK_EOF
  chmod +x "$probe_dir/claude"
  env CLAUDE_PLUGIN_DATA="$empty_data" PATH="$probe_dir:$PATH" pipeline-quota-check --method headers
)

assert_exit "headers exits 1 when file missing and probe fails" 1 _run_headers_no_probe

# ============================================================
echo ""
echo "=== pipeline-model-router (within limits) ==="

quota='{"five_hour":{"utilization":30,"hourly_threshold":60,"over_threshold":false,"window_hour":3},"seven_day":{"utilization":40,"daily_threshold":57,"over_threshold":false,"window_day":4},"billing_mode":"subscription","detection_method":"oauth"}'

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
echo "=== pipeline-model-router (5h over, 7d within, no ollama) ==="

quota='{"five_hour":{"utilization":95,"hourly_threshold":60,"over_threshold":true,"window_hour":3},"seven_day":{"utilization":40,"daily_threshold":57,"over_threshold":false,"window_day":4},"billing_mode":"subscription","detection_method":"oauth"}'

output=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
assert_eq "5h over → wait" "wait" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "5h over trigger" "5h_over_no_ollama" "$(printf '%s' "$output" | jq -r '.trigger')"
assert_eq "wait has minutes" "true" "$(printf '%s' "$output" | jq -e '.wait_minutes' >/dev/null 2>&1 && echo true || echo false)"

# ============================================================
echo ""
echo "=== pipeline-model-router (7d over, no ollama) ==="

quota='{"five_hour":{"utilization":95,"hourly_threshold":60,"over_threshold":true,"window_hour":3},"seven_day":{"utilization":100,"daily_threshold":57,"over_threshold":true,"window_day":4},"billing_mode":"subscription","detection_method":"oauth"}'

output=$(pipeline-model-router --quota "$quota" --tier feature 2>/dev/null)
assert_eq "7d over → end_gracefully" "end_gracefully" "$(printf '%s' "$output" | jq -r '.action')"
assert_eq "7d over trigger" "7d_over_no_ollama" "$(printf '%s' "$output" | jq -r '.trigger')"

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
echo "=== pipeline-model-router (5h over with ollama enabled) ==="

# Write config that enables Ollama but Ollama is not running
mkdir -p "$CLAUDE_PLUGIN_DATA"
printf '{"localLlm":{"enabled":true,"ollamaUrl":"http://localhost:19999","model":"test-model"}}' > "$CLAUDE_PLUGIN_DATA/config.json"

quota='{"five_hour":{"utilization":95,"hourly_threshold":60,"over_threshold":true,"window_hour":3},"seven_day":{"utilization":40,"daily_threshold":57,"over_threshold":false,"window_day":4},"billing_mode":"subscription","detection_method":"oauth"}'

output=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
# Ollama unreachable → should fall back to wait
assert_eq "ollama unreachable → wait" "wait" "$(printf '%s' "$output" | jq -r '.action')"

# ============================================================
echo ""
echo "=== pipeline-quota-check (auto with safe defaults shape) ==="

# Verify the safe defaults have the correct shape
output=$(pipeline-quota-check --method auto 2>/dev/null)
assert_eq "five_hour.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.five_hour.over_threshold')"
assert_eq "seven_day.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.seven_day.over_threshold')"

# ============================================================
echo ""
echo "=== pipeline-quota-check (oauth arithmetic — no octal crash) ==="

# Regression: C3 / task_02_01. Bash arithmetic treated zero-padded hours
# (08, 09) as octal, crashing _check_oauth between 08:00-09:59 UTC.
# Mock date/security/curl so _check_oauth executes its arithmetic path
# with the problematic hour values.
_run_quota_check_with_fake_hour() {
  local fake_hour="$1"
  local mocks_dir
  mocks_dir=$(mktemp -d)
  trap '[[ -n "$mocks_dir" && "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' RETURN

  cat > "$mocks_dir/security" <<'MOCK_EOF'
#!/usr/bin/env bash
printf '{"access_token":"fake-token"}'
MOCK_EOF

  cat > "$mocks_dir/curl" <<'MOCK_EOF'
#!/usr/bin/env bash
printf '{"unified-5h-utilization":50,"unified-7d-utilization":50,"billing_mode":"subscription"}'
MOCK_EOF

  cat > "$mocks_dir/date" <<MOCK_EOF
#!/usr/bin/env bash
case "\$*" in
  "-u +%H") echo "$fake_hour" ;;
  "-u +%M") echo "00" ;;
  "-u +%u") echo "3" ;;
  "+%s") echo "1700000000" ;;
  *) exec /bin/date "\$@" ;;
esac
MOCK_EOF

  chmod +x "$mocks_dir"/security "$mocks_dir"/curl "$mocks_dir"/date

  PATH="$mocks_dir:$PATH" pipeline-quota-check --method oauth
  local rc=$?
  return $rc
}

set +e
_run_quota_check_with_fake_hour "08" >/dev/null 2>&1
rc_08=$?
_run_quota_check_with_fake_hour "09" >/dev/null 2>&1
rc_09=$?
set -e

assert_eq "oauth path succeeds with hour=08" "0" "$rc_08"
assert_eq "oauth path succeeds with hour=09" "0" "$rc_09"

# ============================================================
echo ""
echo "=== pipeline-lib window math helpers (task_02_02) ==="

# Window math helpers live in pipeline-lib.sh so both _check_oauth and the
# upcoming _check_headers implementation share a single source of truth.
# These tests pin pure-function behavior: no mocking, no I/O.
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
echo "=== pipeline-quota-check (oauth uses resets_at window math — task_02_02) ==="

# Regression: C9 / task_02_02. _check_oauth must compute window_hour/window_day
# from the resets_at fields in the API response, not from wall-clock hour/DOW.
# Mock curl to return a controlled resets_at, mock date +%s to return a known now,
# and assert the output JSON carries the expected window positions and thresholds.
_run_quota_check_with_resets() {
  local now_epoch="$1" resets_5h="$2" resets_7d="$3"
  local mocks_dir
  mocks_dir=$(mktemp -d)
  trap '[[ -n "$mocks_dir" && "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' RETURN

  cat > "$mocks_dir/security" <<'MOCK_EOF'
#!/usr/bin/env bash
printf '{"access_token":"fake-token"}'
MOCK_EOF

  # Mock curl: return a JSON body that includes both utilization and reset fields.
  cat > "$mocks_dir/curl" <<MOCK_EOF
#!/usr/bin/env bash
printf '%s' '{"unified-5h-utilization":50,"unified-7d-utilization":50,"unified-5h-reset":"$resets_5h","unified-7d-reset":"$resets_7d","billing_mode":"subscription"}'
MOCK_EOF

  # Mock date: intercept +%s plus the wall-clock helpers so the buggy
  # hour-of-day / day-of-week math (which this test is meant to catch)
  # produces predictably-WRONG answers. The new math uses resets_at, so
  # it must not depend on any of these.
  cat > "$mocks_dir/date" <<MOCK_EOF
#!/usr/bin/env bash
case "\$*" in
  "+%s") echo "$now_epoch" ;;
  "-u +%H") echo "14" ;;
  "-u +%M") echo "30" ;;
  "-u +%u") echo "7" ;;
  "-u +%d") echo "10" ;;
  *) exec /bin/date "\$@" ;;
esac
MOCK_EOF

  chmod +x "$mocks_dir"/security "$mocks_dir"/curl "$mocks_dir"/date

  PATH="$mocks_dir:$PATH" pipeline-quota-check --method oauth
}

# now = 2026-04-10T12:00:00Z (epoch 1775822400)
# 5h window: resets 2026-04-10T16:50:00Z → 10 minutes in → window_hour=1, threshold=20
# 7d window: resets 2026-04-13T12:00:00Z → 4 days in → window_day=5, threshold=71
set +e
output=$(_run_quota_check_with_resets 1775822400 "2026-04-10T16:50:00Z" "2026-04-13T12:00:00Z" 2>/dev/null)
rc=$?
set -e
assert_eq "oauth with resets_at exits 0" "0" "$rc"
assert_eq "oauth five_hour.window_hour" "1" "$(printf '%s' "$output" | jq -r '.five_hour.window_hour')"
assert_eq "oauth five_hour.hourly_threshold" "20" "$(printf '%s' "$output" | jq -r '.five_hour.hourly_threshold')"
assert_eq "oauth seven_day.window_day" "5" "$(printf '%s' "$output" | jq -r '.seven_day.window_day')"
assert_eq "oauth seven_day.daily_threshold" "71" "$(printf '%s' "$output" | jq -r '.seven_day.daily_threshold')"

# ============================================================
echo ""
echo "=== pipeline-quota-check (_check_headers — task_02_03) ==="

# Helper: run pipeline-quota-check --method headers with an isolated
# CLAUDE_PLUGIN_DATA dir, optional last-headers.json fixture, and a
# stubbed `claude` cold-start probe. Pins `date +%s` so window math
# is deterministic. Runs in a subshell so locals/traps don't leak.
#
# now_epoch (1775822400) = 2026-04-10T12:00:00Z
_run_headers_check() (
  fixture="$1"
  probe_writes_file="${2:-1}"
  extra_env="${3:-}"
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  if [[ -n "$fixture" ]]; then
    printf '%s' "$fixture" > "$test_data/last-headers.json"
  fi

  # Stubbed `claude` cold-start probe. When probe_writes_file=1 the stub
  # populates last-headers.json with a known-good payload (simulating
  # whatever real layer would write the headers after the probe). When
  # probe_writes_file=0 the stub silently exits 0 without writing.
  if [[ "$probe_writes_file" == "1" ]]; then
    cat > "$mocks_dir/claude" <<MOCK_EOF
#!/usr/bin/env bash
cat > "$test_data/last-headers.json" <<'JSON_EOF'
{
  "anthropic-ratelimit-unified-5h-utilization": 10,
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": 20,
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "anthropic-ratelimit-unified-status": "ok",
  "is_using_overage": "false"
}
JSON_EOF
printf 'ok'
MOCK_EOF
  else
    cat > "$mocks_dir/claude" <<'MOCK_EOF'
#!/usr/bin/env bash
printf 'ok'
MOCK_EOF
  fi
  chmod +x "$mocks_dir/claude"

  cat > "$mocks_dir/date" <<'MOCK_EOF'
#!/usr/bin/env bash
case "$*" in
  "+%s") echo "1775822400" ;;
  *) exec /bin/date "$@" ;;
esac
MOCK_EOF
  chmod +x "$mocks_dir/date"

  # `extra_env` is a single space-separated string of KEY=VALUE pairs.
  env $extra_env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" \
    pipeline-quota-check --method headers
)

# Test 1 — valid subscription headers, deterministic window math.
# now=2026-04-10T12:00:00Z (1775822400)
# 5h resets 2026-04-10T16:50:00Z → 10m elapsed → window_hour=1, threshold=20
# 7d resets 2026-04-13T12:00:00Z → 4 days elapsed → window_day=5, threshold=71
_sub_fixture='{
  "anthropic-ratelimit-unified-5h-utilization": 15,
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": 40,
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "anthropic-ratelimit-unified-status": "ok",
  "is_using_overage": "false"
}'

set +e
output=$(_run_headers_check "$_sub_fixture" 2>/dev/null)
rc=$?
set -e
assert_eq "headers valid fixture exits 0" "0" "$rc"
assert_eq "headers five_hour.utilization" "15" "$(printf '%s' "$output" | jq -r '.five_hour.utilization')"
assert_eq "headers five_hour.window_hour" "1" "$(printf '%s' "$output" | jq -r '.five_hour.window_hour')"
assert_eq "headers five_hour.hourly_threshold" "20" "$(printf '%s' "$output" | jq -r '.five_hour.hourly_threshold')"
assert_eq "headers five_hour.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.five_hour.over_threshold')"
assert_eq "headers seven_day.utilization" "40" "$(printf '%s' "$output" | jq -r '.seven_day.utilization')"
assert_eq "headers seven_day.window_day" "5" "$(printf '%s' "$output" | jq -r '.seven_day.window_day')"
assert_eq "headers seven_day.daily_threshold" "71" "$(printf '%s' "$output" | jq -r '.seven_day.daily_threshold')"
assert_eq "headers seven_day.over_threshold" "false" "$(printf '%s' "$output" | jq -r '.seven_day.over_threshold')"
assert_eq "headers detection_method" "headers" "$(printf '%s' "$output" | jq -r '.detection_method')"

# Test 2 — utilization expressed as ratio (0.0-1.0) is normalized to percent.
_ratio_fixture='{
  "anthropic-ratelimit-unified-5h-utilization": "0.95",
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": "0.30",
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "is_using_overage": "false"
}'
set +e
output=$(_run_headers_check "$_ratio_fixture" 2>/dev/null)
rc=$?
set -e
assert_eq "headers ratio fixture exits 0" "0" "$rc"
assert_eq "headers ratio→percent five_hour.utilization" "95" "$(printf '%s' "$output" | jq -r '.five_hour.utilization')"
assert_eq "headers ratio over_threshold true (95>20)" "true" "$(printf '%s' "$output" | jq -r '.five_hour.over_threshold')"

# Test 3 — billing_mode=subscription
assert_eq "headers billing_mode=subscription" "subscription" \
  "$(set +e; _run_headers_check "$_sub_fixture" 2>/dev/null | jq -r '.billing_mode'; set -e)"

# Test 4 — billing_mode=overage when is_using_overage=true
_over_fixture='{
  "anthropic-ratelimit-unified-5h-utilization": 10,
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": 10,
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "is_using_overage": "true"
}'
assert_eq "headers billing_mode=overage" "overage" \
  "$(set +e; _run_headers_check "$_over_fixture" 2>/dev/null | jq -r '.billing_mode'; set -e)"

# Test 5 — billing_mode=api when no unified-* but ANTHROPIC_API_KEY is set
_api_fixture='{
  "anthropic-ratelimit-requests-remaining": 100,
  "anthropic-ratelimit-tokens-remaining": 50000
}'
assert_eq "headers billing_mode=api" "api" \
  "$(set +e; _run_headers_check "$_api_fixture" 1 "ANTHROPIC_API_KEY=sk-test" 2>/dev/null | jq -r '.billing_mode'; set -e)"

# Test 6 — cold start: file missing, probe stub writes a fixture, re-read succeeds
set +e
output=$(_run_headers_check "" 1 2>/dev/null)
rc=$?
set -e
assert_eq "headers cold-start exits 0" "0" "$rc"
assert_eq "headers cold-start detection_method=headers" "headers" "$(printf '%s' "$output" | jq -r '.detection_method')"
assert_eq "headers cold-start billing_mode=subscription" "subscription" "$(printf '%s' "$output" | jq -r '.billing_mode')"

# Test 7 — auto mode prefers headers over oauth/cli
_run_auto_with_headers() (
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  printf '%s' "$_sub_fixture" > "$test_data/last-headers.json"

  # Mock security/curl/claude so if oauth/cli were tried, we'd see it.
  # If headers wins, none of these get called and the JSON has detection_method=headers.
  cat > "$mocks_dir/security" <<'MOCK_EOF'
#!/usr/bin/env bash
printf '{"access_token":"fake-token"}'
MOCK_EOF
  cat > "$mocks_dir/curl" <<'MOCK_EOF'
#!/usr/bin/env bash
printf '{"unified-5h-utilization":99,"unified-7d-utilization":99,"billing_mode":"oauth-mode"}'
MOCK_EOF
  cat > "$mocks_dir/date" <<'MOCK_EOF'
#!/usr/bin/env bash
case "$*" in
  "+%s") echo "1775822400" ;;
  *) exec /bin/date "$@" ;;
esac
MOCK_EOF
  chmod +x "$mocks_dir"/security "$mocks_dir"/curl "$mocks_dir"/date

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" pipeline-quota-check --method auto
)

set +e
output=$(_run_auto_with_headers 2>/dev/null)
rc=$?
set -e
assert_eq "auto with headers exits 0" "0" "$rc"
assert_eq "auto prefers headers over oauth" "headers" "$(printf '%s' "$output" | jq -r '.detection_method')"
# Confirm we got the headers fixture's utilization (15) not the oauth mock's (99)
assert_eq "auto used headers fixture not oauth" "15" "$(printf '%s' "$output" | jq -r '.five_hour.utilization')"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
