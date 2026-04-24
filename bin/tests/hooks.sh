#!/usr/bin/env bash
# hooks.sh — hooks.json wiring, branch-protection hook, run-tracker hook,
# stop-gate / subagent-stop-gate hooks, pipeline-quality-gate,
# pipeline-coverage-gate tolerance, log_metric retention.
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
HOOKS_DIR="$(cd "$(dirname "$0")/../../hooks" && pwd)"
BIN_DIR="$(cd "$(dirname "$0")/.." && pwd)"
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
assert_eq "has PreToolUse (Bash + Edit/Write/MultiEdit groups)" "2" "$(jq '.hooks.PreToolUse | length' "$hooks_json")"
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

assert_exit "subagent no run exits 0" 0 bash -c 'printf "{\"agent_type\":\"implementation-reviewer\"}" | '"$HOOKS_DIR/subagent-stop-gate.sh"

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

# implementation-reviewer with no review files
output=$(printf '{"agent_type":"implementation-reviewer"}' | "$HOOKS_DIR/subagent-stop-gate.sh" 2>&1)
assert_eq "warns no reviews" "true" "$(printf '%s' "$output" | grep -q 'no review files' && echo true || echo false)"

# ============================================================
echo ""
echo "=== subagent-stop-gate: no warning with review files present ==="

echo '{"verdict":"APPROVE"}' > "$run_dir/reviews/T1.json"
output=$(printf '{"agent_type":"implementation-reviewer"}' | "$HOOKS_DIR/subagent-stop-gate.sh" 2>&1)
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
    "test:coverage": "true"
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
    "test:coverage": "true"
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
echo "=== task_13_05: pipeline-coverage-gate tolerance ==="

cov_dir=$(mktemp -d)

# Helper to create coverage JSON
_cov_json() {
  local lines="$1" branches="$2" funcs="$3" stmts="$4"
  printf '{"total":{"lines":%s,"branches":%s,"functions":%s,"statements":%s}}' \
    "$lines" "$branches" "$funcs" "$stmts"
}

# Before: 80% across the board
echo "$(_cov_json 80 80 80 80)" > "$cov_dir/before.json"

# After: 0.3% decrease in lines → passes with default 0.5% tolerance
echo "$(_cov_json 79.7 80 80 80)" > "$cov_dir/after-small.json"
set +e
output=$("$BIN_DIR/pipeline-coverage-gate" "$cov_dir/before.json" "$cov_dir/after-small.json" 2>/dev/null)
exit_code=$?
set -e
assert_eq "0.3% decrease passes with default tolerance" "0" "$exit_code"
assert_eq "0.3% decrease passed=true" "true" "$(echo "$output" | jq -r '.passed')"
assert_eq "tolerance in output" "0.5" "$(echo "$output" | jq -r '.tolerance')"

# After: 1% decrease in lines → fails with default 0.5% tolerance
echo "$(_cov_json 79 80 80 80)" > "$cov_dir/after-big.json"
set +e
output=$("$BIN_DIR/pipeline-coverage-gate" "$cov_dir/before.json" "$cov_dir/after-big.json" 2>/dev/null)
exit_code=$?
set -e
assert_eq "1% decrease fails with default tolerance" "1" "$exit_code"
assert_eq "1% decrease passed=false" "false" "$(echo "$output" | jq -r '.passed')"

# --tolerance 2 allows 1.5% decrease
echo "$(_cov_json 78.5 80 80 80)" > "$cov_dir/after-med.json"
set +e
output=$("$BIN_DIR/pipeline-coverage-gate" "$cov_dir/before.json" "$cov_dir/after-med.json" --tolerance 2 2>/dev/null)
exit_code=$?
set -e
assert_eq "--tolerance 2 allows 1.5% decrease" "0" "$exit_code"
assert_eq "--tolerance 2 tolerance in output" "2" "$(echo "$output" | jq -r '.tolerance')"

rm -rf "$cov_dir"

# ============================================================
echo ""
echo "=== task_16_06: coverage-gate reads renamed config key ==="

cov_cfg_dir=$(mktemp -d)
echo "$(_cov_json 80 80 80 80)" > "$cov_cfg_dir/before.json"
# 0.2pp drop — passes at default tolerance 0.5, must fail at 0.1
echo "$(_cov_json 79.8 80 80 80)" > "$cov_cfg_dir/after.json"

# Write config in the canonical nested shape (configure.md uses setpath +
# split(".") so dotted keys become nested objects).
printf '{"quality":{"coverageRegressionTolerancePct":0.1}}' > "$CLAUDE_PLUGIN_DATA/config.json"
set +e
output=$("$BIN_DIR/pipeline-coverage-gate" "$cov_cfg_dir/before.json" "$cov_cfg_dir/after.json" 2>/dev/null)
exit_code=$?
set -e
assert_eq "coverage-gate reads coverageRegressionTolerancePct=0.1 and fails 0.2pp drop" "1" "$exit_code"
assert_eq "tolerance reported as 0.1" "0.1" "$(echo "$output" | jq -r '.tolerance')"

# Old key must NOT be recognized anymore — with only old key set, gate uses
# the 0.5 default and passes.
printf '{"quality":{"coverageTolerance":0.1}}' > "$CLAUDE_PLUGIN_DATA/config.json"
set +e
output=$("$BIN_DIR/pipeline-coverage-gate" "$cov_cfg_dir/before.json" "$cov_cfg_dir/after.json" 2>/dev/null)
exit_code=$?
set -e
assert_eq "old coverageTolerance key is ignored (gate uses default)" "0" "$exit_code"
assert_eq "default tolerance 0.5 used when new key absent" "0.5" "$(echo "$output" | jq -r '.tolerance')"

rm -f "$CLAUDE_PLUGIN_DATA/config.json"
rm -rf "$cov_cfg_dir"

# ============================================================
echo ""
echo "=== task_16_11: log_metric + retention trim ==="

# Build a minimal "current" run dir so log_metric can target it.
OBS_RUN_ID="obs-test-run"
obs_run_dir="$CLAUDE_PLUGIN_DATA/runs/$OBS_RUN_ID"
mkdir -p "$obs_run_dir"
touch "$obs_run_dir/metrics.jsonl"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$obs_run_dir" "$CLAUDE_PLUGIN_DATA/runs/current"

# --- Case A: log_metric with auditLog=true writes a JSONL line ---
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
( source "$(dirname "$0")/../pipeline-lib.sh"; log_metric "task.start" "task_id=\"t_01\"" "rank=2" )
line_count=$(wc -l < "$obs_run_dir/metrics.jsonl" | tr -d ' ')
assert_eq "log_metric writes 1 line when auditLog default (true)" "1" "$line_count"
event=$(head -1 "$obs_run_dir/metrics.jsonl" | jq -r '.event')
assert_eq "log_metric event captured" "task.start" "$event"
tid=$(head -1 "$obs_run_dir/metrics.jsonl" | jq -r '.task_id')
assert_eq "log_metric string k=v captured" "t_01" "$tid"
rank=$(head -1 "$obs_run_dir/metrics.jsonl" | jq -r '.rank')
assert_eq "log_metric numeric k=v parsed as JSON number" "2" "$rank"

# --- Case B: auditLog=false → no new lines ---
printf '{"observability":{"auditLog":false}}' > "$CLAUDE_PLUGIN_DATA/config.json"
before=$(wc -l < "$obs_run_dir/metrics.jsonl" | tr -d ' ')
( source "$(dirname "$0")/../pipeline-lib.sh"; log_metric "task.end" "status=\"done\"" )
after=$(wc -l < "$obs_run_dir/metrics.jsonl" | tr -d ' ')
assert_eq "auditLog=false disables log_metric" "$before" "$after"

# --- Case C: retention trim drops old lines ---
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
# Write a metric dated 200 days ago and another dated now.
old_ts=$(date -u -v-200d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "200 days ago" +%Y-%m-%dT%H:%M:%SZ)
: > "$obs_run_dir/metrics.jsonl"
printf '{"ts":"%s","run_id":"obs-test-run","event":"old.event"}\n' "$old_ts" >> "$obs_run_dir/metrics.jsonl"
printf '{"ts":"%s","run_id":"obs-test-run","event":"new.event"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$obs_run_dir/metrics.jsonl"

# Configure retention to 90 days. Populate tasks so cleanup archives the run.
cat > "$obs_run_dir/state.json" <<EOF
{
  "run_id": "$OBS_RUN_ID",
  "status": "completed",
  "mode": "prd",
  "started_at": "2026-01-01T00:00:00Z",
  "ended_at": "2026-01-01T00:30:00Z",
  "tasks": {"t1": {"status": "done"}},
  "input": {"issue_numbers": [1]},
  "spec": {"path": null}
}
EOF

printf '{"observability":{"metricsRetentionDays":90}}' > "$CLAUDE_PLUGIN_DATA/config.json"

pipeline-cleanup "$OBS_RUN_ID" >/dev/null 2>&1 || true

# After cleanup, the run dir is archived. Retention trim runs on all
# audit/metrics files under CLAUDE_PLUGIN_DATA — the archive copy should
# have the old line removed.
archive_metrics="$CLAUDE_PLUGIN_DATA/archive/$OBS_RUN_ID/metrics.jsonl"
if [[ -f "$archive_metrics" ]]; then
  # Use awk to avoid grep -c's non-zero exit when count is zero.
  old_survived=$(awk '/old\.event/{c++} END{print c+0}' "$archive_metrics")
  new_survived=$(awk '/new\.event/{c++} END{print c+0}' "$archive_metrics")
  assert_eq "retention trim removes line older than 90 days" "0" "$old_survived"
  assert_eq "retention trim keeps recent line" "1" "$new_survived"
else
  echo "  FAIL: archive metrics file not found at $archive_metrics"
  fail=$((fail + 1))
fi

rm -f "$CLAUDE_PLUGIN_DATA/config.json"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

# ============================================================
# Layer-2 autonomous-mode hooks
# ============================================================

# Helper: seed a run dir with state.json + current symlink.
_seed_run() {
  local run_id="$1" state_json="$2"
  local dir="$CLAUDE_PLUGIN_DATA/runs/$run_id"
  mkdir -p "$dir"
  printf '%s' "$state_json" > "$dir/state.json"
  ln -sfn "$dir" "$CLAUDE_PLUGIN_DATA/runs/current"
}

# ============================================================
echo ""
echo "=== stop-gate: autonomous mode blocks on non-terminal tasks ==="

_seed_run "run-stop-block" '{"status":"running","tasks":{"alpha-001":{"status":"executing"}}}'
set +e
out=$(FACTORY_AUTONOMOUS_MODE=1 bash "$HOOKS_DIR/stop-gate.sh" < /dev/null 2>/dev/null)
rc=$?
set -e
assert_eq "stop-gate block exit 0"      "0" "$rc"
assert_eq "stop-gate emits decision=block" "block" "$(printf '%s' "$out" | jq -r '.decision // empty')"
# state must NOT be auto-marked interrupted when blocked
state_after=$(jq -r '.tasks."alpha-001".status' "$CLAUDE_PLUGIN_DATA/runs/run-stop-block/state.json")
assert_eq "stop-gate preserves executing on block" "executing" "$state_after"
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

echo ""
echo "=== stop-gate: FACTORY_ALLOW_STOP bypass marks interrupted ==="

_seed_run "run-stop-allow" '{"status":"running","tasks":{"beta-001":{"status":"executing"}}}'
set +e
FACTORY_AUTONOMOUS_MODE=1 FACTORY_ALLOW_STOP=1 bash "$HOOKS_DIR/stop-gate.sh" < /dev/null >/dev/null 2>&1
rc=$?
set -e
assert_eq "stop-gate allow-stop exit 0" "0" "$rc"
state_after=$(jq -r '.tasks."beta-001".status' "$CLAUDE_PLUGIN_DATA/runs/run-stop-allow/state.json")
assert_eq "stop-gate marks executing → interrupted" "interrupted" "$state_after"

echo ""
echo "=== stop-gate: non-autonomous session preserves legacy behavior ==="

_seed_run "run-stop-legacy" '{"status":"running","tasks":{"c-001":{"status":"executing"}}}'
set +e
bash "$HOOKS_DIR/stop-gate.sh" < /dev/null >/dev/null 2>&1
rc=$?
set -e
assert_eq "stop-gate legacy exit 0" "0" "$rc"
state_after=$(jq -r '.tasks."c-001".status' "$CLAUDE_PLUGIN_DATA/runs/run-stop-legacy/state.json")
assert_eq "stop-gate legacy marks interrupted" "interrupted" "$state_after"

echo ""
echo "=== stop-gate: status=done = no-op ==="

_seed_run "run-stop-done" '{"status":"done","tasks":{"d-001":{"status":"done"}}}'
set +e
bash "$HOOKS_DIR/stop-gate.sh" < /dev/null >/dev/null 2>&1
rc=$?
set -e
assert_eq "stop-gate done noop exit 0" "0" "$rc"

# ============================================================
echo ""
echo "=== pretooluse-pipeline-guards: denies gh pr create without quality_gate.ok ==="

_seed_run "run-guards" '{"status":"running","tasks":{"alpha-001":{"status":"reviewing","quality_gate":{"ok":false}}}}'
input='{"tool_input":{"command":"gh pr create --head task/alpha-001 --base staging"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=alpha-001 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "guards pr-create-bad exit 0" "0" "$rc"
decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
assert_eq "guards pr-create-bad denies"   "deny" "$decision"

echo ""
echo "=== pretooluse-pipeline-guards: allows gh pr create when quality_gate.ok=true ==="

_seed_run "run-guards-ok" '{"status":"running","tasks":{"alpha-001":{"status":"reviewing","quality_gate":{"ok":true}}}}'
input='{"tool_input":{"command":"gh pr create --head task/alpha-001 --base staging"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=alpha-001 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "guards pr-create-ok exit 0"    "0" "$rc"
assert_eq "guards pr-create-ok no output" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: denies task-status done without preconditions ==="

_seed_run "run-guards-done" '{"status":"running","tasks":{"alpha-001":{"status":"executing"}}}'
input='{"tool_input":{"command":"pipeline-state task-status run-guards-done alpha-001 done"}}'
set +e
out=$(printf '%s' "$input" | bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "guards task-status-done exit 0" "0" "$rc"
assert_eq "guards task-status-done denies" "deny" "$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')"

echo ""
echo "=== pretooluse-pipeline-guards: no-op when no pipeline run ==="

rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
input='{"tool_input":{"command":"gh pr create --head feat --base main"}}'
set +e
out=$(printf '%s' "$input" | bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "guards no-run exit 0"    "0" "$rc"
assert_eq "guards no-run no output" "" "$out"

# ============================================================
echo ""
echo "=== pretooluse-pipeline-guards: path-scope — blocks impl file during preexec_tests ==="

_seed_run "run-pathscope-block" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope block src/foo.ts exit 0" "0" "$rc"
decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
assert_eq "pathscope block src/foo.ts denies" "deny" "$decision"
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
assert_eq "pathscope block reason mentions path" "true" \
  "$(printf '%s' "$reason" | grep -q 'src/foo.ts' && echo true || echo false)"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows *.test.* during preexec_tests ==="

_seed_run "run-pathscope-test" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.test.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow src/foo.test.ts exit 0" "0" "$rc"
assert_eq "pathscope allow src/foo.test.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows tests/ dir during preexec_tests ==="

_seed_run "run-pathscope-testsdir" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"tests/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow tests/foo.ts exit 0" "0" "$rc"
assert_eq "pathscope allow tests/foo.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows fixtures/ during preexec_tests ==="

_seed_run "run-pathscope-fixtures" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"fixtures/data.json"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow fixtures/data.json exit 0" "0" "$rc"
assert_eq "pathscope allow fixtures/data.json no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows *.spec.* during preexec_tests ==="

_seed_run "run-pathscope-spec" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.spec.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow src/foo.spec.ts exit 0" "0" "$rc"
assert_eq "pathscope allow src/foo.spec.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows __tests__/ dir during preexec_tests ==="

_seed_run "run-pathscope-dunder-tests" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"__tests__/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow __tests__/foo.ts exit 0" "0" "$rc"
assert_eq "pathscope allow __tests__/foo.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows *.test-helpers.* during preexec_tests ==="

_seed_run "run-pathscope-test-helpers" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.test-helpers.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow src/foo.test-helpers.ts exit 0" "0" "$rc"
assert_eq "pathscope allow src/foo.test-helpers.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — allows *.test-utils.* during preexec_tests ==="

_seed_run "run-pathscope-test-utils" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"preexec_tests"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.test-utils.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope allow src/foo.test-utils.ts exit 0" "0" "$rc"
assert_eq "pathscope allow src/foo.test-utils.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — not triggered in postexec stage ==="

_seed_run "run-pathscope-postexec" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"postexec"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope postexec src/foo.ts exit 0" "0" "$rc"
assert_eq "pathscope postexec src/foo.ts no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: path-scope — not triggered when no active run ==="

rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t1 bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "pathscope no-run exit 0" "0" "$rc"
assert_eq "pathscope no-run no deny" "" "$out"

# ============================================================
echo ""
echo "=== subagent-stop-transcript: parses STATUS line + worktree ==="

_seed_run "run-sag" '{"status":"running","tasks":{"alpha-001":{"status":"executing"}}}'
transcript="$CLAUDE_PLUGIN_DATA/runs/run-sag/transcript.jsonl"
cat > "$transcript" <<EOF
{"role":"user","content":[{"type":"text","text":"see .state/run-sag/alpha-001.executor-prompt.md"}]}
{"tool_use":{"input":{"cwd":"/tmp/fake/.claude/worktrees/agent-zzz"}}}
EOF
input=$(jq -cn --arg t "$transcript" --arg msg "Done.
STATUS: DONE" '{agent_type:"task-executor", last_assistant_message:$msg, agent_transcript_path:$t}')
set +e
printf '%s' "$input" | bash "$HOOKS_DIR/subagent-stop-transcript.sh" >/dev/null 2>&1
rc=$?
set -e
assert_eq "subagent-stop exit 0" "0" "$rc"
exec_status=$(jq -r '.tasks."alpha-001".executor_status // empty' "$CLAUDE_PLUGIN_DATA/runs/run-sag/state.json")
assert_eq "subagent-stop writes executor_status" "DONE" "$exec_status"
wt=$(jq -r '.tasks."alpha-001".worktree // empty' "$CLAUDE_PLUGIN_DATA/runs/run-sag/state.json")
assert_eq "subagent-stop writes worktree" "/tmp/fake/.claude/worktrees/agent-zzz" "$wt"

echo ""
echo "=== subagent-stop-transcript: missing STATUS -> BLOCKED ==="

_seed_run "run-sag-missing" '{"status":"running","tasks":{"alpha-001":{"status":"executing"}}}'
transcript="$CLAUDE_PLUGIN_DATA/runs/run-sag-missing/transcript.jsonl"
printf '{"content":".state/run-sag-missing/alpha-001.executor-prompt.md"}\n' > "$transcript"
input=$(jq -cn --arg t "$transcript" '{agent_type:"task-executor", last_assistant_message:"No status marker", agent_transcript_path:$t}')
set +e
printf '%s' "$input" | bash "$HOOKS_DIR/subagent-stop-transcript.sh" >/dev/null 2>&1
set -e
exec_status=$(jq -r '.tasks."alpha-001".executor_status // empty' "$CLAUDE_PLUGIN_DATA/runs/run-sag-missing/state.json")
assert_eq "subagent-stop missing STATUS = BLOCKED" "BLOCKED" "$exec_status"

echo ""
echo "=== subagent-stop-transcript: reviewer writes review_files ==="

_seed_run "run-sag-rev" '{"status":"running","tasks":{"alpha-001":{"status":"reviewing"}}}'
transcript="$CLAUDE_PLUGIN_DATA/runs/run-sag-rev/transcript.jsonl"
printf '{"content":".state/run-sag-rev/alpha-001.reviewer-prompt.md"}\n' > "$transcript"
msg='{"decision":"APPROVE","blockers":[],"concerns":[]}
STATUS: DONE'
input=$(jq -cn --arg t "$transcript" --arg msg "$msg" '{agent_type:"implementation-reviewer", last_assistant_message:$msg, agent_transcript_path:$t}')
set +e
printf '%s' "$input" | bash "$HOOKS_DIR/subagent-stop-transcript.sh" >/dev/null 2>&1
set -e
rev_files=$(jq -r '.tasks."alpha-001".review_files // [] | length' "$CLAUDE_PLUGIN_DATA/runs/run-sag-rev/state.json")
assert_eq "subagent-stop writes 1 review_file" "1" "$rev_files"
first=$(jq -r '.tasks."alpha-001".review_files[0] // empty' "$CLAUDE_PLUGIN_DATA/runs/run-sag-rev/state.json")
assert_eq "review_file exists on disk" "true" "$([[ -f "$first" ]] && echo true || echo false)"

echo ""
echo "=== subagent-stop-transcript: scribe writes .scribe.status ==="

_seed_run "run-sag-scribe" '{"status":"running","tasks":{}}'
input=$(jq -cn '{agent_type:"scribe", last_assistant_message:"Updated 3 docs.\nSTATUS: DONE", agent_transcript_path:""}')
set +e
printf '%s' "$input" | bash "$HOOKS_DIR/subagent-stop-transcript.sh" >/dev/null 2>&1
set -e
scribe_status=$(jq -r '.scribe.status // empty' "$CLAUDE_PLUGIN_DATA/runs/run-sag-scribe/state.json")
assert_eq "subagent-stop sets .scribe.status=done" "done" "$scribe_status"

# ============================================================
echo ""
echo "=== session-start (Iron Laws): emits valid JSON with Iron Laws digest ==="

set +e
out=$(bash "$HOOKS_DIR/session-start" 2>/dev/null)
rc=$?
set -e
assert_eq "session-start Iron Laws exit 0" "0" "$rc"
event=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName // empty')
assert_eq "session-start Iron Laws event name" "SessionStart" "$event"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" == *"FACTORY_HARNESS_REMINDER"* ]] && { echo "  PASS: session-start ctx has harness reminder tag"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing FACTORY_HARNESS_REMINDER tag"; fail=$((fail+1)); }
[[ "$ctx" == *"Iron Laws"* ]] && { echo "  PASS: session-start ctx contains Iron Laws"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing Iron Laws"; fail=$((fail+1)); }
[[ "$ctx" == *"Red Flags"* ]] && { echo "  PASS: session-start ctx contains Red Flags"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing Red Flags"; fail=$((fail+1)); }
[[ "$ctx" == *"pipeline-run-task"* ]] && { echo "  PASS: session-start ctx mentions wrapper"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing wrapper reference"; fail=$((fail+1)); }

echo ""
echo "=== session-start (Iron Laws): appends stage-state when active run exists ==="

_seed_run "run-laws-active" '{"status":"running","tasks":{"task-1":{"status":"executing","stage":"preflight_done"}}}'
set +e
out=$(bash "$HOOKS_DIR/session-start" 2>/dev/null)
rc=$?
set -e
assert_eq "session-start active run exit 0" "0" "$rc"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" == *"run-laws-active"* ]] && { echo "  PASS: session-start ctx contains run id"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing run id"; fail=$((fail+1)); }
[[ "$ctx" == *"pipeline-run-task"* ]] && { echo "  PASS: session-start ctx has resume command"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing resume command"; fail=$((fail+1)); }
[[ "$ctx" == *"--stage preexec_tests"* ]] && { echo "  PASS: session-start recommends --stage preexec_tests"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing --stage preexec_tests"; fail=$((fail+1)); }
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

echo ""
echo "=== session-start (Iron Laws): interrupted run shows stage summary (resumable) ==="

_seed_run "run-laws-interrupted" '{"status":"interrupted","tasks":{"task-1":{"status":"interrupted","stage":"preexec_tests_done"}}}'
set +e
out=$(bash "$HOOKS_DIR/session-start" 2>/dev/null)
rc=$?
set -e
assert_eq "session-start interrupted run exit 0" "0" "$rc"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" == *"run-laws-interrupted"* ]] && { echo "  PASS: session-start interrupted run shows run id (resumable)"; pass=$((pass+1)); } || { echo "  FAIL: session-start interrupted run should show run id"; fail=$((fail+1)); }
[[ "$ctx" == *"--stage postexec"* ]] && { echo "  PASS: session-start interrupted maps preexec_tests_done → postexec"; pass=$((pass+1)); } || { echo "  FAIL: session-start interrupted stage transition wrong"; fail=$((fail+1)); }
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

echo ""
echo "=== session-start (Iron Laws): no active run still emits digest ==="

set +e
out=$(bash "$HOOKS_DIR/session-start" 2>/dev/null)
rc=$?
set -e
assert_eq "session-start no run exit 0" "0" "$rc"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" == *"Iron Laws"* ]] && { echo "  PASS: session-start no-run ctx still has Iron Laws"; pass=$((pass+1)); } || { echo "  FAIL: session-start no-run ctx missing Iron Laws"; fail=$((fail+1)); }

echo ""
echo "=== session-start (Iron Laws): terminal run omits stage summary ==="

_seed_run "run-laws-done" '{"status":"done","tasks":{"t1":{"status":"done"}}}'
set +e
out=$(bash "$HOOKS_DIR/session-start" 2>/dev/null)
rc=$?
set -e
assert_eq "session-start terminal run exit 0" "0" "$rc"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" != *"run-laws-done"* ]] && { echo "  PASS: session-start terminal run omits run id from stage summary"; pass=$((pass+1)); } || { echo "  FAIL: session-start terminal run should not show run id"; fail=$((fail+1)); }
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

# ============================================================
echo ""
echo "=== session-start-resume: injects additionalContext ==="

_seed_run "run-resume" '{"status":"running","tasks":{"alpha-001":{"status":"executing","stage":"preflight_done"},"alpha-002":{"status":"pending"}}}'
export CLAUDE_ENV_FILE=$(mktemp)
set +e
out=$(printf '{"source":"resume"}' | bash "$HOOKS_DIR/session-start-resume.sh")
rc=$?
set -e
assert_eq "session-start exit 0" "0" "$rc"
event=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.hookEventName // empty')
assert_eq "session-start event name" "SessionStart" "$event"
ctx=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.additionalContext // empty')
[[ "$ctx" == *"Resuming pipeline run"* ]] && { echo "  PASS: session-start ctx contains resume header"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing header"; fail=$((fail+1)); }
[[ "$ctx" == *"pipeline-run-task"* ]] && { echo "  PASS: session-start ctx names wrapper"; pass=$((pass+1)); } || { echo "  FAIL: session-start ctx missing wrapper reference"; fail=$((fail+1)); }
env_contents=$(cat "$CLAUDE_ENV_FILE" 2>/dev/null)
[[ "$env_contents" == *"FACTORY_CURRENT_RUN"* ]] && { echo "  PASS: session-start exports FACTORY_CURRENT_RUN"; pass=$((pass+1)); } || { echo "  FAIL: FACTORY_CURRENT_RUN not exported"; fail=$((fail+1)); }
rm -f "$CLAUDE_ENV_FILE"
unset CLAUDE_ENV_FILE

echo ""
echo "=== session-start-resume: non-resume source no-ops ==="

set +e
out=$(printf '{"source":"startup"}' | bash "$HOOKS_DIR/session-start-resume.sh")
rc=$?
set -e
assert_eq "session-start non-resume exit 0" "0" "$rc"
assert_eq "session-start non-resume no output" "" "$out"

echo ""
echo "=== session-start-resume: terminal run no-ops ==="

_seed_run "run-resume-done" '{"status":"done","tasks":{"x":{"status":"done"}}}'
set +e
out=$(printf '{"source":"resume"}' | bash "$HOOKS_DIR/session-start-resume.sh")
set -e
assert_eq "session-start terminal no output" "" "$out"

# ============================================================
echo ""
echo "=== asyncrewake-ci: no-op when Claude version below minimum ==="

set +e
out=$(printf '{"tool_input":{"command":"gh pr create"}}' | CLAUDE_VERSION=1.5.0 bash "$HOOKS_DIR/asyncrewake-ci.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "asyncrewake old-version exit 0" "0" "$rc"
assert_eq "asyncrewake old-version no output" "" "$out"

echo ""
echo "=== asyncrewake-ci: no-op for non-pr-create commands ==="

set +e
printf '{"tool_input":{"command":"ls"}}' | bash "$HOOKS_DIR/asyncrewake-ci.sh" >/dev/null 2>&1
rc=$?
set -e
assert_eq "asyncrewake non-pr exit 0" "0" "$rc"

# ============================================================
echo ""
echo "=== settings.autonomous.json registers Layer-2 hooks ==="

autonom="$(cd "$(dirname "$0")/../../templates" && pwd)/settings.autonomous.json"
assert_eq "template has SubagentStop"        "1" "$(jq '.hooks.SubagentStop | length' "$autonom")"
assert_eq "template has SessionStart"        "2" "$(jq '.hooks.SessionStart | length' "$autonom")"
assert_eq "template PostToolUse has asyncRewake" "1" "$(jq '[.hooks.PostToolUse[].hooks[]? | select(.asyncRewake == true)] | length' "$autonom")"
assert_eq "template PreToolUse has pipeline-guards" "1" "$(jq '[.hooks.PreToolUse[].hooks[]? | select(.command | test("pretooluse-pipeline-guards"))] | length' "$autonom")"
assert_eq "template allows Bash(codex *)"     "true" "$(jq '[.permissions.allow[] | select(. == "Bash(codex *)")] | length > 0' "$autonom")"

rm -f "$CLAUDE_PLUGIN_DATA/runs/current"

# ============================================================
echo ""
echo "=== asyncrewake-ci: merge polling — CI green + merged quickly → exit 2 ==="

ARW_DATA=$(mktemp -d)
ARW_STUBS=$(mktemp -d)
ARW_PR=9876

cat > "$ARW_STUBS/pipeline-state" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$ARW_STUBS/pipeline-state"

# gh: statusCheckRollup → green, state,mergedAt → MERGED
cat > "$ARW_STUBS/gh" <<'SH'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"statusCheckRollup"* ]]; then
  printf '{"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","state":null}]}'
elif [[ "$args" == *"state,mergedAt"* ]]; then
  printf '{"state":"MERGED","mergedAt":"2026-04-21T08:00:00Z"}'
fi
exit 0
SH
chmod +x "$ARW_STUBS/gh"

mkdir -p "$ARW_DATA/runs/run-mock-merge"
ln -sf "$ARW_DATA/runs/run-mock-merge" "$ARW_DATA/runs/current"
printf '{"tasks":{"task-1":{"task_id":"task-1","status":"executing","pr_number":%s}}}' \
  "$ARW_PR" > "$ARW_DATA/runs/run-mock-merge/state.json"

ARW_INPUT=$(jq -n --arg pr "https://github.com/acme/repo/pull/$ARW_PR" \
  '{"tool_input":{"command":"gh pr create"},"tool_response":{"stdout":$pr}}')

set +e
ASYNCREWAKE_CI_MAX=1 ASYNCREWAKE_CI_SLEEP=0 \
ASYNCREWAKE_MERGE_MAX=2 ASYNCREWAKE_MERGE_SLEEP=0 \
CLAUDE_PLUGIN_DATA="$ARW_DATA" CLAUDE_VERSION=99.0.0 \
PATH="$ARW_STUBS:$PATH" \
bash "$HOOKS_DIR/asyncrewake-ci.sh" <<< "$ARW_INPUT" >/dev/null 2>/dev/null
ARW_RC=$?
set -e
assert_eq "asyncrewake merge poll: exit 2 (wake orchestrator)" "2" "$ARW_RC"
rm -rf "$ARW_DATA" "$ARW_STUBS"

# ============================================================
echo ""
echo "=== asyncrewake-ci: merge polling — CI green + stalled → exit 2 + stderr ==="

ARW_DATA=$(mktemp -d)
ARW_STUBS=$(mktemp -d)
ARW_PR=9877

cat > "$ARW_STUBS/pipeline-state" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod +x "$ARW_STUBS/pipeline-state"

# gh: CI green, PR stays OPEN (stalled auto-merge)
cat > "$ARW_STUBS/gh" <<'SH'
#!/usr/bin/env bash
args="$*"
if [[ "$args" == *"statusCheckRollup"* ]]; then
  printf '{"statusCheckRollup":[{"status":"COMPLETED","conclusion":"SUCCESS","state":null}]}'
elif [[ "$args" == *"state,mergedAt"* ]]; then
  printf '{"state":"OPEN","mergedAt":null}'
fi
exit 0
SH
chmod +x "$ARW_STUBS/gh"

mkdir -p "$ARW_DATA/runs/run-mock-stall"
ln -sf "$ARW_DATA/runs/run-mock-stall" "$ARW_DATA/runs/current"
printf '{"tasks":{"task-1":{"task_id":"task-1","status":"executing","pr_number":%s}}}' \
  "$ARW_PR" > "$ARW_DATA/runs/run-mock-stall/state.json"

ARW_INPUT=$(jq -n --arg pr "https://github.com/acme/repo/pull/$ARW_PR" \
  '{"tool_input":{"command":"gh pr create"},"tool_response":{"stdout":$pr}}')

set +e
ARW_ERR=$(ASYNCREWAKE_CI_MAX=1 ASYNCREWAKE_CI_SLEEP=0 \
          ASYNCREWAKE_MERGE_MAX=2 ASYNCREWAKE_MERGE_SLEEP=0 \
          CLAUDE_PLUGIN_DATA="$ARW_DATA" CLAUDE_VERSION=99.0.0 \
          PATH="$ARW_STUBS:$PATH" \
          bash "$HOOKS_DIR/asyncrewake-ci.sh" <<< "$ARW_INPUT" 2>&1 >/dev/null)
ARW_RC=$?
set -e
assert_eq "asyncrewake stalled: exit 2" "2" "$ARW_RC"
ARW_STALL_COUNT=$(printf '%s' "$ARW_ERR" | grep -c "stalled" || true)
[[ "$ARW_STALL_COUNT" -ge 1 ]] \
  && { echo "  PASS: asyncrewake stalled: stderr mentions stalled"; pass=$((pass+1)); } \
  || { echo "  FAIL: asyncrewake stalled: stderr missing 'stalled' (got: $ARW_ERR)"; fail=$((fail+1)); }
rm -rf "$ARW_DATA" "$ARW_STUBS"

# ============================================================
# subagent-stop-gate: autonomous blocking tests
# ============================================================

echo ""
echo "=== subagent-stop-gate: non-autonomous mode passes even with missing STATUS ==="

_seed_run "run-ssg-noauto" '{"status":"running","tasks":{"t1":{"status":"executing","branch":"feat/t1"}}}'
set +e
out=$(printf '{"agent_type":"task-executor","last_assistant_message":"I did some work."}' \
  | bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "non-autonomous missing STATUS exit 0" "0" "$rc"
assert_eq "non-autonomous no block output" "" "$out"

echo ""
echo "=== subagent-stop-gate: autonomous mode blocks on missing STATUS ==="

_seed_run "run-ssg-block-status" '{"status":"running","tasks":{"t1":{"status":"executing","branch":"feat/t1"}}}'
set +e
out=$(printf '{"agent_type":"task-executor","last_assistant_message":"I finished the work but forgot the status line."}' \
  | FACTORY_AUTONOMOUS_MODE=1 bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "autonomous missing STATUS exit 1" "1" "$rc"
assert_eq "autonomous missing STATUS decision=block" "block" "$(printf '%s' "$out" | jq -r '.decision // empty')"
assert_eq "autonomous missing STATUS reason mentions STATUS" "true" \
  "$(printf '%s' "$out" | jq -r '.reason' | grep -q 'STATUS' && echo true || echo false)"

echo ""
echo "=== subagent-stop-gate: autonomous mode passes on STATUS: DONE ==="

# Use implementation-reviewer which doesn't check commits, to isolate STATUS parsing
_seed_run "run-ssg-reviewer-done" '{"status":"running","tasks":{}}'
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-ssg-reviewer-done/reviews"
set +e
out=$(jq -cn '{agent_type:"implementation-reviewer", last_assistant_message:"Looks good.\nSTATUS: DONE"}' \
  | FACTORY_AUTONOMOUS_MODE=1 bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "autonomous STATUS: DONE reviewer exit 0" "0" "$rc"
assert_eq "autonomous STATUS: DONE no block output" "" "$out"

echo ""
echo "=== subagent-stop-gate: autonomous mode passes on STATUS: NO_WORK ==="

_seed_run "run-ssg-nowork" '{"status":"running","tasks":{}}'
set +e
out=$(jq -cn '{agent_type:"task-executor", last_assistant_message:"Nothing to do.\nSTATUS: NO_WORK"}' \
  | FACTORY_AUTONOMOUS_MODE=1 bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "autonomous STATUS: NO_WORK exit 0" "0" "$rc"
assert_eq "autonomous STATUS: NO_WORK no block" "" "$out"

echo ""
echo "=== subagent-stop-gate: autonomous mode passes on STATUS: SKIP ==="

_seed_run "run-ssg-skip" '{"status":"running","tasks":{}}'
set +e
out=$(jq -cn '{agent_type:"task-executor", last_assistant_message:"Skipping.\nSTATUS: SKIP"}' \
  | FACTORY_AUTONOMOUS_MODE=1 bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "autonomous STATUS: SKIP exit 0" "0" "$rc"
assert_eq "autonomous STATUS: SKIP no block" "" "$out"

echo ""
echo "=== subagent-stop-gate: autonomous mode blocks on zero commits for executor ==="

# Seed a run with a task that has a branch, but no commits on it vs staging
# Use a branch name that won't exist so git log returns empty
_seed_run "run-ssg-nocommit" '{"status":"running","tasks":{"t2":{"status":"executing","branch":"dark-factory/test-nonexistent-branch-xyz"}}}'
set +e
out=$(jq -cn '{agent_type:"task-executor", last_assistant_message:"Done!\nSTATUS: DONE"}' \
  | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t2 bash "$HOOKS_DIR/subagent-stop-gate.sh" 2>/dev/null)
rc=$?
set -e
assert_eq "autonomous zero-commits exit 1" "1" "$rc"
assert_eq "autonomous zero-commits decision=block" "block" "$(printf '%s' "$out" | jq -r '.decision // empty')"
assert_eq "autonomous zero-commits reason mentions commits" "true" \
  "$(printf '%s' "$out" | jq -r '.reason' | grep -qi 'commit' && echo true || echo false)"

echo ""
echo "=== subagent-stop-gate: retry counter increments and writes BLOCKED on 2nd block ==="

_seed_run "run-ssg-retry" '{"status":"running","tasks":{"t3":{"status":"executing","branch":"dark-factory/test-nonexistent-branch-xyz"}}}'
retry_dir="$CLAUDE_PLUGIN_DATA/runs/run-ssg-retry"

# Stub pipeline-state so the BLOCKED write inside the hook succeeds in the test harness
retry_stubs=$(mktemp -d)
cat > "$retry_stubs/pipeline-state" <<'SH'
#!/usr/bin/env bash
# Stub: pipeline-state task-write <run_id> <task_id> <field> <value>
# Writes the field directly to state.json via jq.
run_id="$2"; task_id="$3"; field="$4"; value="$5"
state="$CLAUDE_PLUGIN_DATA/runs/$run_id/state.json"
[[ -f "$state" ]] || exit 0
tmp=$(mktemp)
jq --arg t "$task_id" --arg f "$field" --argjson v "$value" \
  '.tasks[$t][$f] = $v' "$state" > "$tmp" && mv "$tmp" "$state"
SH
chmod +x "$retry_stubs/pipeline-state"

# First block attempt
set +e
jq -cn '{agent_type:"task-executor", last_assistant_message:"No status."}' \
  | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t3 PATH="$retry_stubs:$PATH" bash "$HOOKS_DIR/subagent-stop-gate.sh" >/dev/null 2>/dev/null
set -e
retry_count=$(cat "$retry_dir/.subagent_retries.t3" 2>/dev/null || echo 0)
assert_eq "retry file = 1 after first block" "1" "$retry_count"

# Second block attempt — should write BLOCKED to state
set +e
jq -cn '{agent_type:"task-executor", last_assistant_message:"No status."}' \
  | FACTORY_AUTONOMOUS_MODE=1 FACTORY_TASK_ID=t3 PATH="$retry_stubs:$PATH" bash "$HOOKS_DIR/subagent-stop-gate.sh" >/dev/null 2>/dev/null
set -e
retry_count=$(cat "$retry_dir/.subagent_retries.t3" 2>/dev/null || echo 0)
assert_eq "retry file = 2 after second block" "2" "$retry_count"

# Verify BLOCKED written to state.json after 2nd block
executor_status_after=$(jq -r '.tasks.t3.executor_status // empty' "$retry_dir/state.json" 2>/dev/null || true)
assert_eq "executor_status=BLOCKED written to state after 2nd block" "BLOCKED" "$executor_status_after"
rm -rf "$retry_stubs"

# ============================================================
# Scribe path-scope guard tests
# ============================================================

echo ""
echo "=== pretooluse-pipeline-guards: scribe — blocks write to src/foo.ts ==="

_seed_run "run-scribe-block" '{"status":"running","tasks":{}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_SUBAGENT_ROLE=scribe bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "scribe block src/foo.ts exit 0" "0" "$rc"
decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
assert_eq "scribe block src/foo.ts denies" "deny" "$decision"
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
assert_eq "scribe block src/foo.ts reason mentions path" "true" \
  "$(printf '%s' "$reason" | grep -q 'src/foo.ts' && echo true || echo false)"

echo ""
echo "=== pretooluse-pipeline-guards: scribe — allows write to docs/api.md ==="

_seed_run "run-scribe-allow-docs" '{"status":"running","tasks":{}}'
input='{"tool_name":"Write","tool_input":{"file_path":"docs/api.md"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_SUBAGENT_ROLE=scribe bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "scribe allow docs/api.md exit 0" "0" "$rc"
assert_eq "scribe allow docs/api.md no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: scribe — allows write to docs/foo/bar.md ==="

_seed_run "run-scribe-allow-nested" '{"status":"running","tasks":{}}'
input='{"tool_name":"Write","tool_input":{"file_path":"docs/foo/bar.md"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_SUBAGENT_ROLE=scribe bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "scribe allow docs/foo/bar.md exit 0" "0" "$rc"
assert_eq "scribe allow docs/foo/bar.md no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: scribe guard skipped for non-scribe role ==="

_seed_run "run-scribe-nonscribe" '{"status":"running","tasks":{"t1":{"status":"executing","stage":"postexec"}}}'
input='{"tool_name":"Write","tool_input":{"file_path":"src/foo.ts"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_SUBAGENT_ROLE=task-executor bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "non-scribe src/foo.ts exit 0" "0" "$rc"
assert_eq "non-scribe src/foo.ts no deny" "" "$out"

# ============================================================
# Ship checklist guard tests
# ============================================================

echo ""
echo "=== pretooluse-pipeline-guards: ship checklist — PR allowed when full checklist ok ==="

_seed_run "run-checklist-ok" '{"status":"running","tasks":{"task-sc":{"status":"reviewing","stage":"postreview_done","quality_gate":{"ok":true},"quality_gates":{"tdd":{"ok":true,"exempt":false},"coverage":"ok"}}}}'
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-checklist-ok/.tasks"
jq -n '{
  task_id:"task-sc", tdd_gate:"ok", coverage_gate:"ok",
  quality_gate:"ok", review_blockers_resolved:true,
  ci_status:"pending", generated_at:"2026-04-24T00:00:00Z"
}' > "$CLAUDE_PLUGIN_DATA/runs/run-checklist-ok/.tasks/task-sc.ship_checklist.json"
input='{"tool_input":{"command":"gh pr create --base staging --title foo"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=task-sc bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "checklist-ok exit 0" "0" "$rc"
assert_eq "checklist-ok no deny" "" "$out"

echo ""
echo "=== pretooluse-pipeline-guards: ship checklist — PR blocked when tdd_gate=fail ==="

_seed_run "run-checklist-tdd-fail" '{"status":"running","tasks":{"task-sc":{"status":"reviewing","quality_gate":{"ok":true}}}}'
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-checklist-tdd-fail/.tasks"
jq -n '{
  task_id:"task-sc", tdd_gate:"fail", coverage_gate:"ok",
  quality_gate:"ok", review_blockers_resolved:true,
  ci_status:"pending", generated_at:"2026-04-24T00:00:00Z"
}' > "$CLAUDE_PLUGIN_DATA/runs/run-checklist-tdd-fail/.tasks/task-sc.ship_checklist.json"
input='{"tool_input":{"command":"gh pr create --base staging --title foo"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=task-sc bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "checklist-tdd-fail exit 0" "0" "$rc"
decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
assert_eq "checklist-tdd-fail denies" "deny" "$decision"
reason=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason // empty')
assert_eq "checklist-tdd-fail reason mentions tdd_gate" "true" \
  "$(printf '%s' "$reason" | grep -q 'tdd_gate' && echo true || echo false)"

echo ""
echo "=== pretooluse-pipeline-guards: ship checklist — PR blocked when checklist missing + quality_gate not ok ==="

_seed_run "run-checklist-missing-bad" '{"status":"running","tasks":{"task-sc":{"status":"reviewing","quality_gate":{"ok":false}}}}'
# No checklist file — backwards compat path
input='{"tool_input":{"command":"gh pr create --base staging --title foo"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=task-sc bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "checklist-missing-bad exit 0" "0" "$rc"
decision=$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // empty')
assert_eq "checklist-missing-bad denies" "deny" "$decision"

echo ""
echo "=== pretooluse-pipeline-guards: ship checklist — PR allowed when checklist missing but quality_gate ok ==="

_seed_run "run-checklist-missing-ok" '{"status":"running","tasks":{"task-sc":{"status":"reviewing","quality_gate":{"ok":true}}}}'
# No checklist file — backwards compat: falls through to quality_gate check
input='{"tool_input":{"command":"gh pr create --base staging --title foo"}}'
set +e
out=$(printf '%s' "$input" | FACTORY_TASK_ID=task-sc bash "$HOOKS_DIR/pretooluse-pipeline-guards.sh")
rc=$?
set -e
assert_eq "checklist-missing-ok exit 0" "0" "$rc"
assert_eq "checklist-missing-ok no deny" "" "$out"

# ============================================================
echo ""
echo "=== All hook scripts are executable ==="

assert_eq "branch-protection executable" "true" "$([[ -x "$HOOKS_DIR/branch-protection.sh" ]] && echo true || echo false)"
assert_eq "run-tracker executable" "true" "$([[ -x "$HOOKS_DIR/run-tracker.sh" ]] && echo true || echo false)"
assert_eq "stop-gate executable" "true" "$([[ -x "$HOOKS_DIR/stop-gate.sh" ]] && echo true || echo false)"
assert_eq "subagent-stop-gate executable" "true" "$([[ -x "$HOOKS_DIR/subagent-stop-gate.sh" ]] && echo true || echo false)"
assert_eq "pretooluse-pipeline-guards executable" "true" "$([[ -x "$HOOKS_DIR/pretooluse-pipeline-guards.sh" ]] && echo true || echo false)"
assert_eq "subagent-stop-transcript executable" "true" "$([[ -x "$HOOKS_DIR/subagent-stop-transcript.sh" ]] && echo true || echo false)"
assert_eq "session-start-resume executable" "true" "$([[ -x "$HOOKS_DIR/session-start-resume.sh" ]] && echo true || echo false)"
assert_eq "session-start executable" "true" "$([[ -x "$HOOKS_DIR/session-start" ]] && echo true || echo false)"
assert_eq "asyncrewake-ci executable" "true" "$([[ -x "$HOOKS_DIR/asyncrewake-ci.sh" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
