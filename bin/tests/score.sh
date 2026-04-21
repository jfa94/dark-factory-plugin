#!/usr/bin/env bash
# score.sh — pipeline-score analyzer + metric emission tests.
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

echo "=== task.ci metric ==="
pipeline-init "run-ci-001" --issue 1 --mode prd >/dev/null
run_dir="$CLAUDE_PLUGIN_DATA/runs/run-ci-001"
metrics_file="$run_dir/metrics.jsonl"

(
  source "$(dirname "$0")/../pipeline-lib.sh"
  emit_ci_metric "task" "42" "green" '["lint","test"]'
)

count=$(wc -l < "$metrics_file" | tr -d ' ')
assert_eq "task.ci metric written" "1" "$count"

event=$(jq -r '.event' "$metrics_file")
assert_eq "event name is task.ci" "task.ci" "$event"

status=$(jq -r '.status' "$metrics_file")
assert_eq "status field captured" "green" "$status"

pr_num=$(jq -r '.pr_number' "$metrics_file")
assert_eq "pr_number captured" "42" "$pr_num"

echo ""
echo "=== RESULTS: ${pass} passed, ${fail} failed ==="
[[ $fail -eq 0 ]]
