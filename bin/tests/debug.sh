#!/usr/bin/env bash
# debug.sh — bin/pipeline-debug-review and bin/pipeline-debug-escalate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
FIXTURES="$REPO_ROOT/bin/tests/fixtures/debug"
ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-debug.XXXXXX")"
STUB_DIR="$ROOT_TMP/stubs"
mkdir -p "$STUB_DIR"
trap 'rm -rf "$ROOT_TMP"' EXIT INT TERM

export PATH="$STUB_DIR:$BIN_DIR:$PATH"

passed=0; failed=0; current=""
pass() { passed=$((passed+1)); printf '  PASS [%s] %s\n' "$current" "$1"; }
fail() { failed=$((failed+1)); printf '  FAIL [%s] %s\n' "$current" "$1"; }
assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [[ "$want" == "$got" ]]; then pass "$desc"
  else fail "$desc (want=$want got=$got)"; fi
}

write_stub() {
  local name="$1"; shift
  printf '#!/usr/bin/env bash\n%s\n' "$*" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}

# --- pipeline-debug-review: severity filter -------------------------------

current="severity-filter"

# Stub the underlying reviewer to echo the fixture file
write_stub pipeline-detect-reviewer 'echo "{\"reviewer\":\"codex\"}"'
write_stub pipeline-codex-review "cat $FIXTURES/review-mixed.json"

run_filter() {
  local sev="$1"
  pipeline-debug-review --base HEAD --severity "$sev" --out-dir "$ROOT_TMP/out-$sev" 2>/dev/null
}

# critical → 1 blocking (F-crit)
got=$(run_filter critical | jq -r '.blocking_count')
assert_eq "critical level filters to {critical}" "1" "$got"

# high → 2 blocking (critical + high + important normalized)
got=$(run_filter high | jq -r '.blocking_count')
assert_eq "high level filters to {critical,high,important}" "3" "$got"

# medium (default) → 4 blocking
got=$(run_filter medium | jq -r '.blocking_count')
assert_eq "medium level filters to {critical,high,important,medium}" "4" "$got"

# all → 6 blocking
got=$(run_filter all | jq -r '.blocking_count')
assert_eq "all level filters to all" "6" "$got"

# Below-threshold count surfaced separately
got=$(run_filter critical | jq -r '.below_threshold_count')
assert_eq "below-threshold count when severity=critical" "5" "$got"

# Round file written to out-dir
out_dir="$ROOT_TMP/out-medium"
[[ -f "$out_dir/round-1.review.json" ]] && pass "round file written" \
  || fail "round file written (missing $out_dir/round-1.review.json)"

# --- summary --------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ $failed -eq 0 ]]
