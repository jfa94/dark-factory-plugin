#!/usr/bin/env bash
# End-to-end: seeded run with mixed issues, run scan+safe-apply+risky-apply+plans,
# assert final state is clean enough for resume.
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")/.." && pwd):$PATH"

pass=0
fail=0
assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then echo "  PASS: $label"; pass=$((pass + 1));
  else echo "  FAIL: $label (expected '$expected', got '$actual')"; fail=$((fail + 1)); fi
}

# Gh mock: PR 42 MERGED but state says executing (I-03).
mock_dir=$(mktemp -d)
cat > "$mock_dir/gh" <<'SHIM'
#!/usr/bin/env bash
case "$*" in
  "pr view 42 --json state,"*)
    echo '{"state":"MERGED","mergedAt":"2026-04-20T10:00:00Z","mergeable":"MERGEABLE","statusCheckRollup":[{"conclusion":"SUCCESS"}],"baseRefName":"staging"}' ;;
  "pr list --search [112] task( in:title --state all --json number,title,state,mergedAt,mergeable,headRefName,url")
    echo '[{"number":42,"title":"[112] task(T1): add login","state":"MERGED","mergedAt":"2026-04-20T10:00:00Z","mergeable":"MERGEABLE","headRefName":"dark-factory/112/t1","url":"https://x/42"}]' ;;
  *) echo '{}' ;;
esac
SHIM
chmod +x "$mock_dir/gh"

mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R1"
cat > "$CLAUDE_PLUGIN_DATA/runs/R1/state.json" <<'JSON'
{
  "run_id": "R1",
  "status": "running",
  "input": {"issue_numbers": [112]},
  "tasks": {
    "T1": {"task_id": "T1", "description": "add login", "status": "executing", "stage": "postreview_done", "pr_number": 42, "pr_url": "https://x/42"},
    "T2": {"task_id": "T2", "description": "add logout", "status": "failed", "failure_reason": "flake"}
  }
}
JSON
ln -sfn "$CLAUDE_PLUGIN_DATA/runs/R1" "$CLAUDE_PLUGIN_DATA/runs/current"

# Phase 1: scan
PATH="$mock_dir:$PATH" pipeline-rescue-scan R1 > "$CLAUDE_PLUGIN_DATA/report.json"
i03=$(jq '[.mechanical_issues[] | select(.id == "I-03")] | length' "$CLAUDE_PLUGIN_DATA/report.json")
assert_eq "scan finds I-03" "1" "$i03"
i16=$(jq '[.investigation_flags[] | select(.id == "I-16")] | length' "$CLAUDE_PLUGIN_DATA/report.json")
assert_eq "scan flags I-16 for T2" "1" "$i16"

# Phase 2: safe apply
pipeline-rescue-apply --tier=safe --plan="$CLAUDE_PLUGIN_DATA/report.json" >/dev/null
t1_status=$(pipeline-state read R1 '.tasks.T1.status')
assert_eq "after safe: T1 done" "done" "$t1_status"

# Phase 3: canned investigation plan for T2
plans="$CLAUDE_PLUGIN_DATA/plans.json"
cat > "$plans" <<'JSON'
{"run_id":"R1","plans":[{"task_id":"T2","decision":"reset_pending","reason":"ci flake retry","evidence":[],"state_updates":{},"confidence":"high"}]}
JSON
pipeline-rescue-apply --plans="$plans" >/dev/null
t2_status=$(pipeline-state read R1 '.tasks.T2.status')
assert_eq "after plans: T2 pending" "pending" "$t2_status"

# Phase 4: re-scan; expect no tier-2/3 issues remaining
PATH="$mock_dir:$PATH" pipeline-rescue-scan R1 > "$CLAUDE_PLUGIN_DATA/report2.json"
tier23=$(jq '[.mechanical_issues[] | select(.tier >= 2)] | length' "$CLAUDE_PLUGIN_DATA/report2.json")
assert_eq "rescan: no tier-2/3 issues" "0" "$tier23"

echo "Passed: $pass | Failed: $fail"
[[ $fail -eq 0 ]]
