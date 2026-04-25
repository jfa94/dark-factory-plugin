#!/usr/bin/env bash
# Tests for pipeline-rescue-scan detectors.
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

# Install a fake 'gh' on PATH that prints canned responses based on args.
make_gh_mock() {
  local mock_dir="$1"
  mkdir -p "$mock_dir"
  cat > "$mock_dir/gh" <<'SHIM'
#!/usr/bin/env bash
case "$*" in
  "pr view 42 --json state,"*)
    cat <<'JSON'
{"state":"MERGED","mergedAt":"2026-04-20T10:00:00Z","mergeable":"MERGEABLE","statusCheckRollup":[],"baseRefName":"staging"}
JSON
    ;;
  "pr list --search [112] task( in:title --state all --json number,title,state,mergedAt,mergeable,headRefName,url")
    cat <<'JSON'
[{"number":42,"title":"[112] task(T1): add login","state":"MERGED","mergedAt":"2026-04-20T10:00:00Z","mergeable":"MERGEABLE","headRefName":"dark-factory/112/t1","url":"https://github.com/x/y/pull/42"}]
JSON
    ;;
  *)
    echo '{}'
    ;;
esac
SHIM
  chmod +x "$mock_dir/gh"
}

seed_run() {
  local run_id="${1:-R1}"
  local rundir="$CLAUDE_PLUGIN_DATA/runs/$run_id"
  mkdir -p "$rundir"
  cat > "$rundir/state.json" <<'JSON'
{
  "run_id": "R1",
  "status": "running",
  "input": {"issue_numbers": [112]},
  "tasks": {
    "T1": {"task_id": "T1", "title": "Add login", "description": "add login endpoint",
           "status": "executing", "stage": "postreview_done", "pr_number": 42, "pr_url": "https://github.com/x/y/pull/42"}
  }
}
JSON
  ln -sfn "$rundir" "$CLAUDE_PLUGIN_DATA/runs/current"
}

echo "=== I-03: PR merged, state says executing ==="
run_id="R1"
seed_run "$run_id"
mock_dir="$CLAUDE_PLUGIN_DATA/mock"
mkdir -p "$mock_dir"
make_gh_mock "$mock_dir"
PATH="$mock_dir:$PATH" pipeline-rescue-scan "$run_id" > "$CLAUDE_PLUGIN_DATA/scan.json"
issue_count=$(jq '[.mechanical_issues[] | select(.id == "I-03")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-03 detected once" "1" "$issue_count"
task_id=$(jq -r '.mechanical_issues[] | select(.id == "I-03") | .task_id' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-03 task_id" "T1" "$task_id"

echo "=== I-01: stale state lock ==="
lock_dir="$CLAUDE_PLUGIN_DATA/runs/$run_id/state.lock"
mkdir -p "$lock_dir"
echo 99999999 > "$lock_dir/pid"  # Non-existent PID
PATH="$mock_dir:$PATH" pipeline-rescue-scan "$run_id" > "$CLAUDE_PLUGIN_DATA/scan.json"
i01=$(jq '[.mechanical_issues[] | select(.id == "I-01")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-01 stale lock detected" "1" "$i01"
rm -rf "$lock_dir"

echo "=== tier_1 ids are tagged tier 1 ==="
seed_run "$run_id"
PATH="$mock_dir:$PATH" pipeline-rescue-scan "$run_id" > "$CLAUDE_PLUGIN_DATA/scan.json"
tier=$(jq -r '.mechanical_issues[] | select(.id == "I-03") | .tier' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-03 tier" "1" "$tier"

echo "=== I-02: orphan worktree ==="
repo="$CLAUDE_PLUGIN_DATA/repo"
mkdir -p "$repo"
(
  cd "$repo"
  git init --quiet
  git config user.email test@local
  git config user.name test
  git commit --allow-empty -m root --quiet
  git worktree add --detach "$repo/wt" >/dev/null 2>&1
  # Point the worktree HEAD to a branch that does not exist
  echo "ref: refs/heads/orphan-branch" > "$repo/.git/worktrees/wt/HEAD"
)
seed_run "$run_id"
(
  cd "$repo"
  PATH="$mock_dir:$PATH" pipeline-rescue-scan "$run_id" > "$CLAUDE_PLUGIN_DATA/scan.json"
)
i02=$(jq '[.mechanical_issues[] | select(.id == "I-02")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-02 detected" "1" "$i02"

echo "=== I-04: PR on GitHub but state.pr_url empty ==="
run_id_i04="R2"
rundir_i04="$CLAUDE_PLUGIN_DATA/runs/$run_id_i04"
mkdir -p "$rundir_i04"
cat > "$rundir_i04/state.json" <<'JSON'
{
  "run_id": "R2",
  "status": "running",
  "input": {"issue_numbers": [112]},
  "tasks": {
    "T1": {"task_id": "T1", "title": "Add login", "description": "add login endpoint",
           "status": "executing", "stage": "review"}
  }
}
JSON
PATH="$mock_dir:$PATH" pipeline-rescue-scan "$run_id_i04" > "$CLAUDE_PLUGIN_DATA/scan_i04.json"
i04=$(jq '[.mechanical_issues[] | select(.id == "I-04")] | length' "$CLAUDE_PLUGIN_DATA/scan_i04.json")
assert_eq "I-04 detected" "1" "$i04"
i04_task=$(jq -r '.mechanical_issues[] | select(.id == "I-04") | .task_id' "$CLAUDE_PLUGIN_DATA/scan_i04.json")
assert_eq "I-04 task_id" "T1" "$i04_task"

echo "=== I-07: PR merge conflict ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/mock2"
cat > "$CLAUDE_PLUGIN_DATA/mock2/gh" <<'SHIM'
#!/usr/bin/env bash
case "$*" in
  "pr view 42 --json state,"*)
    echo '{"state":"OPEN","mergedAt":null,"mergeable":"CONFLICTING","statusCheckRollup":[],"baseRefName":"staging"}' ;;
  "pr list --search [112] task( in:title --state all --json number,title,state,mergedAt,mergeable,headRefName,url")
    echo '[{"number":42,"title":"[112] task(T1): add login","state":"OPEN","mergedAt":null,"mergeable":"CONFLICTING","headRefName":"dark-factory/112/t1","url":"https://x/42"}]' ;;
  *) echo '{}' ;;
esac
SHIM
chmod +x "$CLAUDE_PLUGIN_DATA/mock2/gh"
seed_run R1
PATH="$CLAUDE_PLUGIN_DATA/mock2:$PATH" pipeline-rescue-scan R1 > "$CLAUDE_PLUGIN_DATA/scan.json"
i07=$(jq '[.mechanical_issues[] | select(.id == "I-07")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-07 detected" "1" "$i07"
i07_tier=$(jq -r '[.mechanical_issues[] | select(.id == "I-07")][0].tier' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-07 tier" "2" "$i07_tier"

echo "=== I-15: duplicate PRs for same branch ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/mock3"
cat > "$CLAUDE_PLUGIN_DATA/mock3/gh" <<'SHIM'
#!/usr/bin/env bash
case "$*" in
  "pr view 42 --json state,"*)
    echo '{"state":"OPEN","mergedAt":null,"mergeable":"MERGEABLE","statusCheckRollup":[],"baseRefName":"staging"}' ;;
  "pr list --search [112] task( in:title --state all --json number,title,state,mergedAt,mergeable,headRefName,url")
    printf '[{"number":41,"title":"[112] task(T1): first","state":"OPEN","mergedAt":null,"mergeable":"MERGEABLE","headRefName":"dark-factory/112/t1","url":"https://x/41"},{"number":42,"title":"[112] task(T1): add login","state":"OPEN","mergedAt":null,"mergeable":"MERGEABLE","headRefName":"dark-factory/112/t1","url":"https://x/42"}]\n' ;;
  *) echo '{}' ;;
esac
SHIM
chmod +x "$CLAUDE_PLUGIN_DATA/mock3/gh"
seed_run R1
PATH="$CLAUDE_PLUGIN_DATA/mock3:$PATH" pipeline-rescue-scan R1 > "$CLAUDE_PLUGIN_DATA/scan.json"
i15=$(jq '[.mechanical_issues[] | select(.id == "I-15")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-15 detected" "1" "$i15"

echo "=== I-16: failed task is flagged for investigation ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R1"
cat > "$CLAUDE_PLUGIN_DATA/runs/R1/state.json" <<'JSON'
{
  "run_id": "R1",
  "status": "running",
  "input": {"issue_numbers": [112]},
  "tasks": {
    "T1": {"task_id": "T1", "status": "failed", "failure_reason": "something"}
  }
}
JSON
ln -sfn "$CLAUDE_PLUGIN_DATA/runs/R1" "$CLAUDE_PLUGIN_DATA/runs/current"
PATH="$CLAUDE_PLUGIN_DATA/mock:$PATH" pipeline-rescue-scan R1 > "$CLAUDE_PLUGIN_DATA/scan.json"
i16=$(jq '[.investigation_flags[] | select(.id == "I-16")] | length' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-16 flagged" "1" "$i16"
i16_task=$(jq -r '[.investigation_flags[] | select(.id == "I-16")][0].task_id' "$CLAUDE_PLUGIN_DATA/scan.json")
assert_eq "I-16 task_id" "T1" "$i16_task"

echo "=== I-12: malformed state.json exits 0 with I-12 in report ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/R_BAD"
echo 'NOT { valid JSON' > "$CLAUDE_PLUGIN_DATA/runs/R_BAD/state.json"
scan_out=$(pipeline-rescue-scan R_BAD 2>/dev/null)
i12=$(jq '[.mechanical_issues[] | select(.id == "I-12")] | length' <<<"$scan_out")
assert_eq "I-12 detected on malformed state" "1" "$i12"
null_summary=$(jq '.state_summary == null' <<<"$scan_out")
assert_eq "state_summary is null on malformed state" "true" "$null_summary"

echo "=== I-04 scan: pr_url field contains GitHub URL (not description prose) ==="
PATH="$mock_dir:$PATH" pipeline-rescue-scan R2 > "$CLAUDE_PLUGIN_DATA/scan_i04b.json"
i04_url=$(jq -r '.mechanical_issues[] | select(.id == "I-04") | .pr_url' "$CLAUDE_PLUGIN_DATA/scan_i04b.json")
assert_eq "I-04 pr_url is GitHub URL" "https://github.com/x/y/pull/42" "$i04_url"

echo
echo "Passed: $pass | Failed: $fail"
[[ $fail -eq 0 ]]
