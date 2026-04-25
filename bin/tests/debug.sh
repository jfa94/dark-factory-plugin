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

# --- pipeline-debug-escalate ---------------------------------------------

current="escalate"

esc_run="esc-001"
esc_dir="$ROOT_TMP/data/debug/$esc_run"
mkdir -p "$esc_dir"
export CLAUDE_PLUGIN_DATA="$ROOT_TMP/data"

cat > "$esc_dir/findings.json" <<'EOF'
[{"file":"x.ts","line":10,"severity":"critical","description":"d","verbatim_line":"let x"}]
EOF

cat > "$esc_dir/executor-msg.txt" <<'EOF'
The ConnectionPool singleton can't accept a configurable timeout without redesigning the pool ownership model.
STATUS: BLOCKED — escalate: ConnectionPool singleton needs ownership rework
EOF

stdout=$(pipeline-debug-escalate \
  --run-id "$esc_run" \
  --reason "ConnectionPool singleton needs ownership rework" \
  --base "HEAD~1" \
  --severity "medium" \
  --findings "$esc_dir/findings.json" \
  --executor-msg "$esc_dir/executor-msg.txt")

# Stdout exact format
case "$stdout" in
  "ESCALATED path=$esc_dir/escalation.md") pass "stdout format" ;;
  *) fail "stdout format (got: $stdout)" ;;
esac

# Escalation file exists and includes key fields
[[ -f "$esc_dir/escalation.md" ]] && pass "escalation file written" \
  || fail "escalation file written (missing)"

grep -q "ConnectionPool singleton needs ownership rework" "$esc_dir/escalation.md" \
  && pass "escalation file contains reason" \
  || fail "escalation file contains reason"

grep -q '"severity": "critical"' "$esc_dir/escalation.md" \
  || grep -q '"severity":"critical"' "$esc_dir/escalation.md" \
  && pass "escalation file embeds findings JSON" \
  || fail "escalation file embeds findings JSON"

grep -q "STATUS: BLOCKED — escalate" "$esc_dir/escalation.md" \
  && pass "escalation file embeds executor message" \
  || fail "escalation file embeds executor message"

# --- skill loop smoke test (bin scripts only) ----------------------------

current="loop-smoke"

loop_run="loop-001"
loop_dir="$ROOT_TMP/data/debug/$loop_run"
export CLAUDE_PLUGIN_DATA="$ROOT_TMP/data"

# Round 1: reviewer returns one critical finding
write_stub pipeline-codex-review "cat $FIXTURES/review-mixed.json"

result=$(pipeline-debug-review --base HEAD --severity critical --out-dir "$loop_dir" --round 1)
got=$(printf '%s' "$result" | jq -r '.blocking_count')
assert_eq "round 1 produces blocking findings" "1" "$got"

[[ -f "$loop_dir/round-1.review.json" ]] && pass "round 1 artifact persisted" \
  || fail "round 1 artifact persisted"

# Simulate executor escalation
cat > "$loop_dir/round-1.executor.log" <<'EOF'
Findings analysis complete.
STATUS: BLOCKED — escalate: ConnectionPool singleton ownership rework needed
EOF

# Skill calls escalate when STATUS line matches the escalate pattern.
findings_path=$(printf '%s' "$result" | jq -r '.review_file')
esc_stdout=$(pipeline-debug-escalate \
  --run-id "$loop_run" \
  --reason "ConnectionPool singleton ownership rework needed" \
  --base "HEAD~1" \
  --severity "critical" \
  --findings "$findings_path" \
  --executor-msg "$loop_dir/round-1.executor.log")

# The stdout marker the skill must surface verbatim
case "$esc_stdout" in
  "ESCALATED path=$loop_dir/escalation.md") pass "escalate stdout marker matches loop dir" ;;
  *) fail "escalate stdout marker (got: $esc_stdout)" ;;
esac

[[ -f "$loop_dir/escalation.md" ]] && pass "escalation.md present in loop dir" \
  || fail "escalation.md present in loop dir"

# --- summary --------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ $failed -eq 0 ]]
