#!/usr/bin/env bash
# Phase 6 verification tests
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
HOOKS_DIR="$(cd "$(dirname "$0")/../hooks" && pwd)"
BIN_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$BIN_DIR:$PATH"

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
echo "=== hooks.json structure ==="

hooks_json="$HOOKS_DIR/hooks.json"
assert_eq "hooks.json exists" "true" "$([[ -f "$hooks_json" ]] && echo true || echo false)"
assert_eq "hooks.json valid JSON" "0" "$(jq empty "$hooks_json" 2>/dev/null; echo $?)"
assert_eq "has PreToolUse" "1" "$(jq '.hooks.PreToolUse | length' "$hooks_json")"
assert_eq "has PostToolUse" "1" "$(jq '.hooks.PostToolUse | length' "$hooks_json")"
assert_eq "has Stop" "1" "$(jq '.hooks.Stop | length' "$hooks_json")"
assert_eq "has SubagentStop" "1" "$(jq '.hooks.SubagentStop | length' "$hooks_json")"
assert_eq "PreToolUse matches Bash" "^Bash\$" "$(jq -r '.hooks.PreToolUse[0].matcher' "$hooks_json")"
assert_eq "PostToolUse matches multi" "^(Bash|Write|Edit)$" "$(jq -r '.hooks.PostToolUse[0].matcher' "$hooks_json")"

# ============================================================
echo ""
echo "=== branch-protection: blocks force-push to main ==="

output=$(printf '{"tool_input":{"command":"git push --force origin main"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "force-push main blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: blocks force-push to master ==="

output=$(printf '{"tool_input":{"command":"git push -f origin master"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "force-push master blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: blocks force-push to develop ==="

output=$(printf '{"tool_input":{"command":"git push --force origin develop"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "force-push develop blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: allows push to staging ==="

assert_exit "push staging allowed" 0 bash -c 'printf "{\"tool_input\":{\"command\":\"git push origin staging\"}}" | '"$HOOKS_DIR/branch-protection.sh"

# ============================================================
echo ""
echo "=== branch-protection: allows force-push to feature branch ==="

assert_exit "force-push feature allowed" 0 bash -c 'printf "{\"tool_input\":{\"command\":\"git push --force-with-lease origin dark-factory/42/task-1\"}}" | '"$HOOKS_DIR/branch-protection.sh"

# ============================================================
echo ""
echo "=== branch-protection: blocks +refspec force-push ==="

output=$(printf '{"tool_input":{"command":"git push origin +main"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "+refspec main blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

output=$(printf '{"tool_input":{"command":"git push origin +HEAD:develop"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "+refspec HEAD:develop blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

assert_exit "+refspec feature allowed" 0 bash -c 'printf "{\"tool_input\":{\"command\":\"git push origin +feature-branch\"}}" | '"$HOOKS_DIR/branch-protection.sh"

# ============================================================
echo ""
echo "=== branch-protection: blocks hard reset on main ==="

output=$(printf '{"tool_input":{"command":"git reset --hard main"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "hard reset main blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: blocks branch -D main ==="

output=$(printf '{"tool_input":{"command":"git branch -D main"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "branch -D main blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: blocks remote delete of develop ==="

output=$(printf '{"tool_input":{"command":"git push origin --delete develop"}}' | "$HOOKS_DIR/branch-protection.sh" 2>&1; echo "EXIT:$?")
assert_eq "remote delete develop blocked" "EXIT:2" "$(printf '%s' "$output" | grep -o 'EXIT:[0-9]*')"

# ============================================================
echo ""
echo "=== branch-protection: allows non-git commands ==="

assert_exit "ls allowed" 0 bash -c 'printf "{\"tool_input\":{\"command\":\"ls -la\"}}" | '"$HOOKS_DIR/branch-protection.sh"

# ============================================================
echo ""
echo "=== branch-protection: allows empty command ==="

assert_exit "empty command allowed" 0 bash -c 'printf "{\"tool_input\":{}}" | '"$HOOKS_DIR/branch-protection.sh"

# ============================================================
echo ""
echo "=== run-tracker: no-op without active run ==="

# No active run, should exit 0 silently
assert_exit "no run exits 0" 0 bash -c 'printf "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls\"}}" | '"$HOOKS_DIR/run-tracker.sh"

# ============================================================
echo ""
echo "=== run-tracker: logs during active run ==="

# Set up active run
run_dir="$CLAUDE_PLUGIN_DATA/runs/test-tracker"
mkdir -p "$run_dir"
touch "$run_dir/audit.jsonl"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

printf '{"tool_name":"Bash","tool_input":{"command":"pnpm test"}}' | "$HOOKS_DIR/run-tracker.sh" 2>/dev/null

assert_eq "audit entry written" "1" "$(wc -l < "$run_dir/audit.jsonl" | tr -d ' ')"
assert_eq "audit tool" "Bash" "$(head -1 "$run_dir/audit.jsonl" | jq -r '.tool')"
assert_eq "audit run_id" "test-tracker" "$(head -1 "$run_dir/audit.jsonl" | jq -r '.run_id')"
assert_eq "audit seq" "1" "$(head -1 "$run_dir/audit.jsonl" | jq -r '.seq')"
assert_eq "audit has hash" "true" "$(head -1 "$run_dir/audit.jsonl" | jq -r 'if .params_hash != "" then "true" else "false" end')"
assert_eq "audit has timestamp" "true" "$(head -1 "$run_dir/audit.jsonl" | jq -r 'if .timestamp != "" then "true" else "false" end')"

# Second entry should have seq=2
printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/test.txt"}}' | "$HOOKS_DIR/run-tracker.sh" 2>/dev/null
assert_eq "second entry seq" "2" "$(tail -1 "$run_dir/audit.jsonl" | jq -r '.seq')"
assert_eq "second entry tool" "Write" "$(tail -1 "$run_dir/audit.jsonl" | jq -r '.tool')"

# ============================================================
echo ""
echo "=== stop-gate: marks running run as interrupted ==="

run_dir="$CLAUDE_PLUGIN_DATA/runs/test-stop-1"
mkdir -p "$run_dir"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

printf '%s' '{
  "run_id": "test-stop-1",
  "status": "running",
  "started_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z",
  "ended_at": null,
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "executing"},
    "T3": {"status": "pending"}
  }
}' > "$run_dir/state.json"

printf '{"session_id":"test"}' | "$HOOKS_DIR/stop-gate.sh" 2>/dev/null

state=$(cat "$run_dir/state.json")
assert_eq "run status interrupted" "interrupted" "$(printf '%s' "$state" | jq -r '.status')"
assert_eq "T2 marked interrupted" "interrupted" "$(printf '%s' "$state" | jq -r '.tasks.T2.status')"
assert_eq "T1 still done" "done" "$(printf '%s' "$state" | jq -r '.tasks.T1.status')"
assert_eq "T3 still pending" "pending" "$(printf '%s' "$state" | jq -r '.tasks.T3.status')"
assert_eq "ended_at set" "true" "$(printf '%s' "$state" | jq -r 'if .ended_at != null then "true" else "false" end')"
assert_eq "resume_point set" "T2" "$(printf '%s' "$state" | jq -r '.resume_point')"
assert_eq "current symlink removed" "false" "$([[ -L "$CLAUDE_PLUGIN_DATA/runs/current" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== stop-gate: marks all-done run as completed ==="

run_dir="$CLAUDE_PLUGIN_DATA/runs/test-stop-2"
mkdir -p "$run_dir"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

printf '%s' '{
  "run_id": "test-stop-2",
  "status": "running",
  "started_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z",
  "ended_at": null,
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "done"}
  }
}' > "$run_dir/state.json"

printf '{"session_id":"test"}' | "$HOOKS_DIR/stop-gate.sh" 2>/dev/null

assert_eq "all-done → completed" "completed" "$(jq -r '.status' "$run_dir/state.json")"

# ============================================================
echo ""
echo "=== stop-gate: marks partial run ==="

run_dir="$CLAUDE_PLUGIN_DATA/runs/test-stop-3"
mkdir -p "$run_dir"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

printf '%s' '{
  "run_id": "test-stop-3",
  "status": "running",
  "started_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z",
  "ended_at": null,
  "tasks": {
    "T1": {"status": "done"},
    "T2": {"status": "failed"}
  }
}' > "$run_dir/state.json"

printf '{"session_id":"test"}' | "$HOOKS_DIR/stop-gate.sh" 2>/dev/null

assert_eq "partial → partial" "partial" "$(jq -r '.status' "$run_dir/state.json")"

# ============================================================
echo ""
echo "=== stop-gate: no-op for non-running status ==="

run_dir="$CLAUDE_PLUGIN_DATA/runs/test-stop-4"
mkdir -p "$run_dir"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

printf '%s' '{
  "run_id": "test-stop-4",
  "status": "completed",
  "started_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T01:00:00Z",
  "tasks": {"T1": {"status": "done"}}
}' > "$run_dir/state.json"

printf '{"session_id":"test"}' | "$HOOKS_DIR/stop-gate.sh" 2>/dev/null

assert_eq "completed unchanged" "completed" "$(jq -r '.status' "$run_dir/state.json")"

# ============================================================
echo ""
echo "=== stop-gate: no-op without active run ==="

rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
assert_exit "no run exits 0" 0 bash -c 'printf "{\"session_id\":\"test\"}" | '"$HOOKS_DIR/stop-gate.sh"

# ============================================================
echo ""
echo "=== subagent-stop-gate: no-op without active run ==="

assert_exit "subagent no run exits 0" 0 bash -c 'printf "{\"agent_type\":\"task-reviewer\"}" | '"$HOOKS_DIR/subagent-stop-gate.sh"

# ============================================================
echo ""
echo "=== subagent-stop-gate: no-op for unknown agent type ==="

run_dir="$CLAUDE_PLUGIN_DATA/runs/test-subagent"
mkdir -p "$run_dir/reviews"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"
printf '{"run_id":"test-subagent","status":"running","tasks":{}}' > "$run_dir/state.json"

assert_exit "unknown agent exits 0" 0 bash -c 'printf "{\"agent_type\":\"unknown-agent\"}" | '"$HOOKS_DIR/subagent-stop-gate.sh"

# ============================================================
echo ""
echo "=== subagent-stop-gate: warns on missing review files ==="

# task-reviewer with no review files
output=$(printf '{"agent_type":"task-reviewer"}' | "$HOOKS_DIR/subagent-stop-gate.sh" 2>&1)
assert_eq "warns no reviews" "true" "$(printf '%s' "$output" | grep -q 'no review files' && echo true || echo false)"

# ============================================================
echo ""
echo "=== subagent-stop-gate: no warning with review files present ==="

echo '{"verdict":"APPROVE"}' > "$run_dir/reviews/T1.json"
output=$(printf '{"agent_type":"task-reviewer"}' | "$HOOKS_DIR/subagent-stop-gate.sh" 2>&1)
assert_eq "no warning with reviews" "false" "$(printf '%s' "$output" | grep -q 'WARNING' && echo true || echo false)"

# ============================================================
echo ""
echo "=== task_07_02: pipeline-parse-review verdict anchor ==="

# Review with anti-verdict prose in body but APPROVE in the anchored block.
# The parser must extract APPROVE from the block, not REQUEST_CHANGES from prose.
prose_input='## Findings

I do not approve of this naming choice — but it is non-blocking so I am letting
it through. The author would say "REQUEST_CHANGES is too harsh here" and I agree.

## Acceptance Criteria Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Logs in | PASS | src/auth.ts:42 |

## Summary
Looks fine despite the naming nit.

## Verdict

VERDICT: APPROVE
CONFIDENCE: HIGH
BLOCKERS: 0
ROUND: 1'

output=$(printf '%s' "$prose_input" | "$BIN_DIR/pipeline-parse-review" 2>/dev/null)
assert_eq "verdict anchored APPROVE (not prose REQUEST_CHANGES)" "APPROVE" "$(echo "$output" | jq -r '.verdict')"
assert_eq "confidence from block" "HIGH" "$(echo "$output" | jq -r '.confidence')"
assert_eq "declared_blockers from block" "0" "$(echo "$output" | jq -r '.declared_blockers')"

# Review missing the entire `## Verdict` block — must fail with non-zero exit
no_block_input='## Findings

### [BLOCKING] Something
- **File:** a.ts:1
- **Severity:** critical
- **Category:** correctness
- **Description:** broken

## Summary
no anchor block here'

set +e
printf '%s' "$no_block_input" | "$BIN_DIR/pipeline-parse-review" >/dev/null 2>&1
exit_code=$?
set -e
assert_eq "missing verdict block exits 1" "1" "$exit_code"

# Review with VERDICT: MAYBE inside the block — invalid value, must exit 1
invalid_verdict_input='## Findings

## Summary
asdf

## Verdict

VERDICT: MAYBE
CONFIDENCE: HIGH
BLOCKERS: 0
ROUND: 1'

set +e
printf '%s' "$invalid_verdict_input" | "$BIN_DIR/pipeline-parse-review" >/dev/null 2>&1
exit_code=$?
set -e
assert_eq "invalid VERDICT exits 1" "1" "$exit_code"

# Review with valid block, BLOCKERS: 3 — declared_blockers must be 3
blockers_input='## Findings

### [BLOCKING] One
- **File:** a.ts:1
- **Severity:** critical
- **Category:** security
- **Description:** sql injection

### [BLOCKING] Two
- **File:** b.ts:2
- **Severity:** major
- **Category:** correctness
- **Description:** missing null check

### [BLOCKING] Three
- **File:** c.ts:3
- **Severity:** critical
- **Category:** security
- **Description:** xss

## Summary
multiple issues

## Verdict

VERDICT: REQUEST_CHANGES
CONFIDENCE: HIGH
BLOCKERS: 3
ROUND: 1'

output=$(printf '%s' "$blockers_input" | "$BIN_DIR/pipeline-parse-review" 2>/dev/null)
assert_eq "BLOCKERS: 3 parsed" "3" "$(echo "$output" | jq -r '.declared_blockers')"
assert_eq "REQUEST_CHANGES verdict" "REQUEST_CHANGES" "$(echo "$output" | jq -r '.verdict')"
assert_eq "blocking_count tally agrees" "3" "$(echo "$output" | jq -r '.blocking_count')"

# ============================================================
echo ""
echo "=== task_07_03: pipeline-quality-gate ==="

QG="$BIN_DIR/pipeline-quality-gate"
assert_eq "pipeline-quality-gate exists" "true" "$([[ -f "$QG" ]] && echo true || echo false)"
assert_eq "pipeline-quality-gate executable" "true" "$([[ -x "$QG" ]] && echo true || echo false)"

# Set up a fixture run so the script has somewhere to write logs/state.
qg_run="qg-test-run"
qg_run_dir="$CLAUDE_PLUGIN_DATA/runs/$qg_run"
mkdir -p "$qg_run_dir"
printf '{"run_id":"%s","status":"running","tasks":{"qt1":{"status":"executing"}}}' "$qg_run" > "$qg_run_dir/state.json"

# Fixture 1: all-pass project
qg_proj1=$(mktemp -d)
cat > "$qg_proj1/package.json" << 'PJSON'
{
  "name": "qg-pass",
  "scripts": {
    "lint": "true",
    "typecheck": "true",
    "test": "true"
  }
}
PJSON

set +e
output=$("$QG" "$qg_run" "qt1" "$qg_proj1" 2>/dev/null)
exit_code=$?
set -e
assert_eq "all-pass exit 0" "0" "$exit_code"
assert_eq "all-pass ok=true" "true" "$(echo "$output" | jq -r '.ok')"
assert_eq "all-pass 3 checks" "3" "$(echo "$output" | jq -r '.checks | length')"
assert_eq "state.quality_gate.ok=true" "true" \
  "$(jq -r '.tasks.qt1.quality_gate.ok' "$qg_run_dir/state.json")"

# Fixture 2: lint failing
qg_proj2=$(mktemp -d)
cat > "$qg_proj2/package.json" << 'PJSON'
{
  "name": "qg-fail",
  "scripts": {
    "lint": "false",
    "typecheck": "true",
    "test": "true"
  }
}
PJSON

set +e
output=$("$QG" "$qg_run" "qt1" "$qg_proj2" 2>/dev/null)
exit_code=$?
set -e
assert_eq "lint-fail exit 1" "1" "$exit_code"
assert_eq "lint-fail ok=false" "false" "$(echo "$output" | jq -r '.ok')"
lint_status=$(echo "$output" | jq -r '.checks[] | select(.command=="lint") | .status')
assert_eq "lint check failed" "failed" "$lint_status"

# Fixture 3: dark-factory.quality override — only run lint
qg_proj3=$(mktemp -d)
cat > "$qg_proj3/package.json" << 'PJSON'
{
  "name": "qg-override",
  "scripts": {
    "lint": "true",
    "typecheck": "false",
    "test": "false"
  },
  "dark-factory": {
    "quality": ["lint"]
  }
}
PJSON

set +e
output=$("$QG" "$qg_run" "qt1" "$qg_proj3" 2>/dev/null)
exit_code=$?
set -e
assert_eq "override exit 0" "0" "$exit_code"
assert_eq "override 1 check" "1" "$(echo "$output" | jq -r '.checks | length')"
assert_eq "override only lint" "lint" "$(echo "$output" | jq -r '.checks[0].command')"

# Fixture 4: missing package.json — graceful error
qg_proj4=$(mktemp -d)
set +e
output=$("$QG" "$qg_run" "qt1" "$qg_proj4" 2>/dev/null)
exit_code=$?
set -e
assert_eq "no package.json exit 1" "1" "$exit_code"
assert_eq "no package.json ok=false" "false" "$(echo "$output" | jq -r '.ok')"

# ============================================================
echo ""
echo "=== All hook scripts are executable ==="

assert_eq "branch-protection executable" "true" "$([[ -x "$HOOKS_DIR/branch-protection.sh" ]] && echo true || echo false)"
assert_eq "run-tracker executable" "true" "$([[ -x "$HOOKS_DIR/run-tracker.sh" ]] && echo true || echo false)"
assert_eq "stop-gate executable" "true" "$([[ -x "$HOOKS_DIR/stop-gate.sh" ]] && echo true || echo false)"
assert_eq "subagent-stop-gate executable" "true" "$([[ -x "$HOOKS_DIR/subagent-stop-gate.sh" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
