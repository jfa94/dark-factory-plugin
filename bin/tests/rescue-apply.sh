#!/usr/bin/env bash
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
trap 'rm -rf "$CLAUDE_PLUGIN_DATA"' EXIT
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

seed_run() {
  local run_id=R1
  mkdir -p "$CLAUDE_PLUGIN_DATA/runs/$run_id"
  cat > "$CLAUDE_PLUGIN_DATA/runs/$run_id/state.json" <<'JSON'
{
  "run_id": "R1",
  "status": "running",
  "input": {"issue_numbers": [112]},
  "tasks": {
    "T1": {"task_id": "T1", "status": "executing", "stage": "postreview_done", "pr_number": 42, "pr_url": "https://x/42"}
  }
}
JSON
  ln -sfn "$CLAUDE_PLUGIN_DATA/runs/$run_id" "$CLAUDE_PLUGIN_DATA/runs/current"
}

echo "=== tier-1 I-03: applies mark-pr-merged ==="
seed_run
report="$CLAUDE_PLUGIN_DATA/report.json"
cat > "$report" <<'JSON'
{"run_id":"R1","mechanical_issues":[{"id":"I-03","tier":1,"task_id":"T1","description":"pr merged"}]}
JSON
pipeline-rescue-apply --tier=safe --plan="$report" >/dev/null
status=$(pipeline-state read R1 '.tasks.T1.status')
assert_eq "I-03 sets status=done" 'done' "$status"
stage=$(pipeline-state read R1 '.tasks.T1.stage')
assert_eq "I-03 sets stage=ship_done" 'ship_done' "$stage"

echo "=== idempotency: second apply is no-op ==="
pipeline-rescue-apply --tier=safe --plan="$report" >/dev/null
status2=$(pipeline-state read R1 '.tasks.T1.status')
assert_eq "status unchanged" 'done' "$status2"

echo "=== audit trail ==="
count=$(pipeline-state read R1 '.rescue' | jq '.applied_actions | length')
if (( count >= 1 )); then
  echo "  PASS: audit trail has $count entries"
  pass=$((pass + 1))
else
  echo "  FAIL: audit trail empty"
  fail=$((fail + 1))
fi

echo
echo "Passed: $pass | Failed: $fail"
[[ $fail -eq 0 ]]
