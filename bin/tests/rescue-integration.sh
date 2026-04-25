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
  "pr view 43 --json state,"*)
    echo '{"state":"OPEN","mergedAt":null,"mergeable":"CONFLICTING","statusCheckRollup":[],"baseRefName":"staging"}' ;;
  "pr view 44 --json state,"*)
    echo '{"state":"OPEN","mergedAt":null,"mergeable":"CONFLICTING","statusCheckRollup":[],"baseRefName":"staging"}' ;;
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

# I-07 fixture builder: bare repo + seed clone + live worktree.
# Usage: _make_i07_fixture <dir> <conflict:0|1> → prints worktree path.
_make_i07_fixture() {
  local dir="$1" conflict="${2:-0}"
  local bare="$dir/bare.git" seed="$dir/seed" wt="$dir/wt"
  mkdir -p "$dir"
  git init --bare "$bare" -q
  git -C "$bare" symbolic-ref HEAD refs/heads/staging
  git clone "$bare" "$seed" -q 2>/dev/null
  git -C "$seed" config user.email "test@test.local"
  git -C "$seed" config user.name "Test"
  git -C "$seed" checkout -b staging -q
  printf 'line one\n' > "$seed/base.txt"
  git -C "$seed" add base.txt && git -C "$seed" commit -m "base" -q
  git -C "$seed" push origin staging -q
  git -C "$seed" checkout -b dark-factory/112/t3 -q
  if (( conflict )); then
    printf 'task version\n' > "$seed/base.txt"
    git -C "$seed" add base.txt && git -C "$seed" commit -m "task change" -q
  else
    printf 'task work\n' > "$seed/task.txt"
    git -C "$seed" add task.txt && git -C "$seed" commit -m "task work" -q
  fi
  git -C "$seed" push origin dark-factory/112/t3 -q
  git -C "$seed" checkout staging -q
  if (( conflict )); then
    printf 'staging version\n' > "$seed/base.txt"
    git -C "$seed" add base.txt && git -C "$seed" commit -m "staging advance" -q
  else
    printf 'other\n' > "$seed/other.txt"
    git -C "$seed" add other.txt && git -C "$seed" commit -m "staging advance" -q
  fi
  git -C "$seed" push origin staging -q
  git clone -b staging "$bare" "$wt" -q 2>/dev/null
  git -C "$wt" config user.email "test@test.local"
  git -C "$wt" config user.name "Test"
  git -C "$wt" checkout -b dark-factory/112/t3 origin/dark-factory/112/t3 -q
  printf '%s' "$wt"
}

# Phase 5: I-07 scan→apply, clean rebase succeeds (R2/T3/PR43)
fix_dir_a=$(mktemp -d "$CLAUDE_PLUGIN_DATA/i07a.XXXXXX")
wt_a=$(_make_i07_fixture "$fix_dir_a" 0)

mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R2"
cat > "$CLAUDE_PLUGIN_DATA/runs/R2/state.json" <<JSON
{
  "run_id": "R2",
  "status": "running",
  "input": {},
  "tasks": {
    "T3": {"task_id": "T3", "description": "clean rebase", "status": "executing", "stage": "postreview_done", "pr_number": 43, "pr_url": "https://x/43", "worktree": "$wt_a"}
  }
}
JSON

PATH="$mock_dir:$PATH" pipeline-rescue-scan R2 > "$CLAUDE_PLUGIN_DATA/report_i07a.json"
i07_a=$(jq '[.mechanical_issues[] | select(.id == "I-07" and .task_id == "T3" and .base == "staging")] | length' "$CLAUDE_PLUGIN_DATA/report_i07a.json")
assert_eq "Phase 5 scan: I-07 emitted with base=staging" "1" "$i07_a"

pipeline-rescue-apply --tier=risky --plan="$CLAUDE_PLUGIN_DATA/report_i07a.json" >/dev/null
t3_audit=$(pipeline-state read R2 '.rescue.applied_actions // []' | jq '[.[] | select(.issue_id == "I-07" and .task_id == "T3" and .action == "rebase_pr" and .result == "ok")] | length')
assert_eq "Phase 5 apply: rebase_pr ok in audit" "1" "$t3_audit"
t3_status=$(pipeline-state read R2 '.tasks.T3.status')
assert_eq "Phase 5: T3 status unchanged (executing)" "executing" "$t3_status"
rebase_done=0; [[ -f "$wt_a/other.txt" ]] && rebase_done=1
assert_eq "Phase 5: staging file present after rebase" "1" "$rebase_done"

# Phase 6: I-07 scan→apply, conflicting rebase escalates to I-13 (R3/T4/PR44)
fix_dir_b=$(mktemp -d "$CLAUDE_PLUGIN_DATA/i07b.XXXXXX")
wt_b=$(_make_i07_fixture "$fix_dir_b" 1)

mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R3"
cat > "$CLAUDE_PLUGIN_DATA/runs/R3/state.json" <<JSON
{
  "run_id": "R3",
  "status": "running",
  "input": {},
  "tasks": {
    "T4": {"task_id": "T4", "description": "conflict rebase", "status": "executing", "stage": "postreview_done", "pr_number": 44, "pr_url": "https://x/44", "worktree": "$wt_b"}
  }
}
JSON

PATH="$mock_dir:$PATH" pipeline-rescue-scan R3 > "$CLAUDE_PLUGIN_DATA/report_i07b.json"
i07_b=$(jq '[.mechanical_issues[] | select(.id == "I-07" and .task_id == "T4" and .base == "staging")] | length' "$CLAUDE_PLUGIN_DATA/report_i07b.json")
assert_eq "Phase 6 scan: I-07 emitted with base=staging" "1" "$i07_b"

pipeline-rescue-apply --tier=risky --plan="$CLAUDE_PLUGIN_DATA/report_i07b.json" >/dev/null
t4_audit=$(pipeline-state read R3 '.rescue.applied_actions // []' | jq '[.[] | select(.issue_id == "I-07" and .task_id == "T4" and .action == "rebase_pr" and .result == "error")] | length')
assert_eq "Phase 6 apply: rebase_pr error in audit" "1" "$t4_audit"
t4_status=$(pipeline-state read R3 '.tasks.T4.status')
assert_eq "Phase 6: T4 status=failed" "failed" "$t4_status"
t4_reason=$(pipeline-state read R3 '.tasks.T4.failure_reason')
assert_eq "Phase 6: T4 failure_reason I-13" "unresolvable merge conflict (I-13)" "$t4_reason"
rebase_clean=0; [[ ! -d "$wt_b/.git/rebase-merge" && ! -d "$wt_b/.git/rebase-apply" ]] && rebase_clean=1
assert_eq "Phase 6: rebase --abort cleaned up" "1" "$rebase_clean"

# Phase 7: rehydrate-archived-run restores archived state into runs/
mkdir -p "$CLAUDE_PLUGIN_DATA/archive/R4"
cat > "$CLAUDE_PLUGIN_DATA/archive/R4/state.json" <<'JSON'
{
  "run_id": "R4",
  "status": "running",
  "input": {"issue_numbers": [200]},
  "tasks": {
    "T5": {"task_id": "T5", "status": "done", "stage": "ship_done", "pr_number": 50}
  }
}
JSON

# Pre-existing current symlink should be left intact (only restored if absent)
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -sfn "$CLAUDE_PLUGIN_DATA/runs/R1" "$CLAUDE_PLUGIN_DATA/runs/current"

pipeline-rescue-apply --action=rehydrate-archived-run --run-id=R4 >/dev/null
exists=0; [[ -f "$CLAUDE_PLUGIN_DATA/runs/R4/state.json" ]] && exists=1
assert_eq "Phase 7: runs/R4 rehydrated" "1" "$exists"
archive_intact=0; [[ -f "$CLAUDE_PLUGIN_DATA/archive/R4/state.json" ]] && archive_intact=1
assert_eq "Phase 7: archive copy preserved" "1" "$archive_intact"
current_target=$(readlink "$CLAUDE_PLUGIN_DATA/runs/current")
assert_eq "Phase 7: existing current symlink not clobbered" "$CLAUDE_PLUGIN_DATA/runs/R1" "$current_target"
audit_ok=$(pipeline-state read R4 '.rescue.applied_actions // []' | jq '[.[] | select(.action == "rehydrate_archived_run" and .result == "ok")] | length')
assert_eq "Phase 7: rehydrate audit entry present" "1" "$audit_ok"

# Idempotency: second call refuses (run dir exists)
set +e
pipeline-rescue-apply --action=rehydrate-archived-run --run-id=R4 2>/dev/null
rc=$?
set -e
assert_eq "Phase 7: re-rehydrate refuses (exit 1)" "1" "$rc"

# current symlink restored when absent
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
mkdir -p "$CLAUDE_PLUGIN_DATA/archive/R5"
cat > "$CLAUDE_PLUGIN_DATA/archive/R5/state.json" <<'JSON'
{"run_id":"R5","status":"running","input":{},"tasks":{}}
JSON
pipeline-rescue-apply --action=rehydrate-archived-run --run-id=R5 >/dev/null
restored=$(readlink "$CLAUDE_PLUGIN_DATA/runs/current" 2>/dev/null || echo "")
assert_eq "Phase 7: current symlink restored when absent" "$CLAUDE_PLUGIN_DATA/runs/R5" "$restored"

# Phase 8: I-12 emitted for non-numeric pr_number (no gh call)
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R6"
cat > "$CLAUDE_PLUGIN_DATA/runs/R6/state.json" <<'JSON'
{
  "run_id": "R6",
  "status": "running",
  "input": {},
  "tasks": {
    "T6": {"task_id": "T6", "status": "executing", "stage": "ship", "pr_number": "interrupted"}
  }
}
JSON
PATH="$mock_dir:$PATH" pipeline-rescue-scan R6 > "$CLAUDE_PLUGIN_DATA/report_r6.json"
i12_count=$(jq '[.mechanical_issues[] | select(.id == "I-12" and .task_id == "T6")] | length' "$CLAUDE_PLUGIN_DATA/report_r6.json")
assert_eq "Phase 8: non-numeric pr_number emits I-12" "1" "$i12_count"

echo "Passed: $pass | Failed: $fail"
[[ $fail -eq 0 ]]
