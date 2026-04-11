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
echo "=== pipeline-quota-check (oauth removed — task_02_04) ==="

# Regression: C2b / task_02_04. OAuth/Keychain detection was removed entirely
# (Decision 10). The old code parsed `.access_token` but the Keychain format
# actually nests the token under `.claudeAiOauth.accessToken`, so the path was
# silently broken. Rather than fix a cross-platform-hostile code path, the
# entire method was deleted. These tests pin the removal.

# (1) --method oauth must be rejected as an unknown method
assert_exit "--method oauth rejected (removed)" 1 pipeline-quota-check --method oauth

# (2) Auto mode must NEVER invoke `security find-generic-password`. We stub
# `security` with a tripwire that writes a marker file if it runs; the marker
# must not exist after auto completes. CLI probe fallback is still allowed
# until task_02_05 removes it too.
_run_auto_without_oauth_probe() (
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  # Provide a valid headers fixture so _check_headers succeeds and auto exits
  # before reaching any fallback. This proves the headers path is still first.
  cat > "$test_data/last-headers.json" <<'JSON_EOF'
{
  "anthropic-ratelimit-unified-5h-utilization": 10,
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": 10,
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "is_using_overage": "false"
}
JSON_EOF

  # Tripwire: if this runs, the marker file appears.
  cat > "$mocks_dir/security" <<MOCK_EOF
#!/usr/bin/env bash
touch "$test_data/security_was_called"
exit 0
MOCK_EOF
  chmod +x "$mocks_dir/security"

  cat > "$mocks_dir/date" <<'MOCK_EOF'
#!/usr/bin/env bash
case "$*" in
  "+%s") echo "1775822400" ;;
  *) exec /bin/date "$@" ;;
esac
MOCK_EOF
  chmod +x "$mocks_dir/date"

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" \
    pipeline-quota-check --method auto >/dev/null

  if [[ -e "$test_data/security_was_called" ]]; then
    return 2
  fi
  return 0
)

assert_exit "auto mode does not invoke security command" 0 _run_auto_without_oauth_probe

# (3) Grep guard: _check_oauth function name must not appear in the script
# anywhere except inside the removal-rationale comment block at the top.
_script="$(cd "$(dirname "$0")" && pwd)/pipeline-quota-check"
oauth_refs=$(grep -c '_check_oauth' "$_script" || true)
assert_eq "_check_oauth symbol fully removed" "0" "$oauth_refs"

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
echo "=== pipeline-quota-check (cli probe removed — task_02_05) ==="

# Regression: C2b / task_02_05. The CLI-probe fallback (_check_cli) was
# deleted. Auto mode is now headers-only: on a cache hit it never invokes
# `claude`, and on failure it exits 1 with operator instructions instead
# of emitting silent safe-default zeros that masked broken detection.

# (1) auto mode must NOT invoke `claude` when last-headers.json is present.
# Tripwire: stub `claude` with a binary that writes a marker file; after the
# run, the marker file must not exist — the headers path returned before any
# probe/fallback could fire.
_run_auto_no_claude_invocation() (
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  cat > "$test_data/last-headers.json" <<'JSON_EOF'
{
  "anthropic-ratelimit-unified-5h-utilization": 10,
  "anthropic-ratelimit-unified-5h-reset": "2026-04-10T16:50:00Z",
  "anthropic-ratelimit-unified-7d-utilization": 10,
  "anthropic-ratelimit-unified-7d-reset": "2026-04-13T12:00:00Z",
  "is_using_overage": "false"
}
JSON_EOF

  cat > "$mocks_dir/claude" <<MOCK_EOF
#!/usr/bin/env bash
touch "$test_data/claude_was_called"
exit 0
MOCK_EOF
  chmod +x "$mocks_dir/claude"

  cat > "$mocks_dir/date" <<'MOCK_EOF'
#!/usr/bin/env bash
case "$*" in
  "+%s") echo "1775822400" ;;
  *) exec /bin/date "$@" ;;
esac
MOCK_EOF
  chmod +x "$mocks_dir/date"

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" \
    pipeline-quota-check --method auto >/dev/null || return 3

  if [[ -e "$test_data/claude_was_called" ]]; then
    return 2
  fi
  return 0
)

assert_exit "auto does not invoke claude when headers file exists" 0 _run_auto_no_claude_invocation

# (2) auto mode must return an explicit error (exit 1) when header detection
# fails entirely. Old code emitted safe-default zeros and exited 0; this is
# a regression guard against that silent-failure re-appearing.
_run_auto_fails_explicit() (
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  # No fixture. Stub claude as a no-op — cold-start probe won't populate
  # the file, so _check_headers fails and auto must exit 1.
  cat > "$mocks_dir/claude" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 0
MOCK_EOF
  chmod +x "$mocks_dir/claude"

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" \
    pipeline-quota-check --method auto
)

assert_exit "auto returns explicit error when header detection fails" 1 _run_auto_fails_explicit

# (3) The explicit error path must emit no stdout JSON. Old behavior printed
# a "safe defaults" JSON blob to stdout while exiting 0; the new contract is
# exit 1 with the error on stderr and nothing on stdout.
_run_auto_stdout_on_failure() (
  test_data=$(mktemp -d)
  mocks_dir=$(mktemp -d)
  trap '[[ "$test_data" == /tmp/* ]] && rm -rf "$test_data"; [[ "$mocks_dir" == /tmp/* ]] && rm -rf "$mocks_dir"' EXIT

  cat > "$mocks_dir/claude" <<'MOCK_EOF'
#!/usr/bin/env bash
exit 0
MOCK_EOF
  chmod +x "$mocks_dir/claude"

  env CLAUDE_PLUGIN_DATA="$test_data" PATH="$mocks_dir:$PATH" \
    pipeline-quota-check --method auto 2>/dev/null
)

set +e
stdout=$(_run_auto_stdout_on_failure)
set -e
assert_eq "auto failure produces no stdout JSON" "" "$stdout"

# (4) --method cli must now be rejected (CLI probe method removed entirely).
assert_exit "--method cli rejected (removed)" 1 pipeline-quota-check --method cli

# (5) Grep guard: the _check_cli symbol must not reappear in the script.
_script="$(cd "$(dirname "$0")" && pwd)/pipeline-quota-check"
cli_refs=$(grep -c '_check_cli' "$_script" || true)
assert_eq "_check_cli symbol fully removed" "0" "$cli_refs"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
