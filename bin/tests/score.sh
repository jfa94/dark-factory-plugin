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

echo "=== pipeline-score skeleton ==="

fixture="$(cd "$(dirname "$0")/fixtures/score/outsidey-20260420" && pwd)"
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-fix-001"
cp -r "$fixture"/. "$CLAUDE_PLUGIN_DATA/runs/run-fix-001/"

out=$(pipeline-score --run run-fix-001 --format json --no-gh 2>/dev/null)
run_id=$(printf '%s' "$out" | jq -r '.run_id')
assert_eq "pipeline-score emits run_id" "run-fix-001" "$run_id"

version=$(printf '%s' "$out" | jq -r '.plugin_version')
assert_eq "pipeline-score emits plugin_version" "0.3.2" "$version"

echo "=== run-level steps R1-R4 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R1=$(printf '%s' "$out" | jq -r '.run_steps.R1_autonomy_ok.state')
R2=$(printf '%s' "$out" | jq -r '.run_steps.R2_spec_generated.state')
R3=$(printf '%s' "$out" | jq -r '.run_steps.R3_spec_reviewer_approved.state')
R4=$(printf '%s' "$out" | jq -r '.run_steps.R4_tasks_decomposed.state')

assert_eq "R1 autonomy_ok"           "pass"           "$R1"
assert_eq "R2 spec_generated"         "pass"           "$R2"
# Fixture lacks spec.review_score → not_performed is the correct reading.
assert_eq "R3 spec_reviewer_approved" "not_performed"  "$R3"
assert_eq "R4 tasks_decomposed"       "pass"           "$R4"

echo "=== run-level steps R5-R8 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R5=$(printf '%s' "$out" | jq -r '.run_steps.R5_no_circuit_trip.state')
R6=$(printf '%s' "$out" | jq -r '.run_steps.R6_no_human_gate_pause.state')
R7=$(printf '%s' "$out" | jq -r '.run_steps.R7_scribe_ran.state')
R8=$(printf '%s' "$out" | jq -r '.run_steps.R8_rollup_pr_opened.state')

assert_eq "R5 no_circuit_trip"      "pass"        "$R5"
assert_eq "R6 no_human_gate_pause"  "pass"        "$R6"
# Fixture: not all tasks done (interrupted) → scribe did not need to run.
assert_eq "R7 scribe_ran"           "skipped_na"  "$R7"
assert_eq "R8 rollup_pr_opened"     "skipped_na"  "$R8"

echo "=== run-level steps R9-R12 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R9=$(printf '%s' "$out" | jq -r '.run_steps.R9_rollup_pr_merged.state')
R10=$(printf '%s' "$out" | jq -r '.run_steps.R10_rollup_ci_green.state')
R11=$(printf '%s' "$out" | jq -r '.run_steps.R11_no_escalation_comments.state')
R12=$(printf '%s' "$out" | jq -r '.run_steps.R12_terminal_status_done.state')

assert_eq "R9 rollup_pr_merged"           "skipped_na"  "$R9"
assert_eq "R10 rollup_ci_green"            "skipped_na"  "$R10"
assert_eq "R11 no_escalation_comments"     "pass"        "$R11"
assert_eq "R12 terminal_status_done"       "fail"        "$R12"

echo "=== per-task steps T1-T5 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
T1_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T1_executor_spawned.pass')
T2_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T2_lint_pass.pass')
T3_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T3_typecheck_pass.pass')
T4_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T4_tests_pass.pass')

[[ "$T1_pass" -ge 1 ]] && { echo "  PASS: T1 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T1 pass count = $T1_pass"; fail=$((fail+1)); }
[[ "$T2_pass" -ge 1 ]] && { echo "  PASS: T2 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T2 pass count = $T2_pass"; fail=$((fail+1)); }
[[ "$T3_pass" -ge 1 ]] && { echo "  PASS: T3 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T3 pass count = $T3_pass"; fail=$((fail+1)); }
[[ "$T4_pass" -ge 1 ]] && { echo "  PASS: T4 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T4 pass count = $T4_pass"; fail=$((fail+1)); }

echo "=== per-task steps T6-T9 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T6_holdout_pass T7_mutation_pass T8_reviewer_approved_first_round T9_reviewer_approved_overall; do
  val=$(printf '%s' "$out" | jq -r ".task_steps_aggregate.$k.id // empty")
  assert_eq "$k present in aggregate" "$k" "$val"
done

echo "=== per-task steps T10-T14 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T10_pr_created T11_pr_ci_green T12_pr_merged T13_no_fix_loop_exhaustion T14_terminal_status_done; do
  val=$(printf '%s' "$out" | jq -r ".task_steps_aggregate.$k.id // empty")
  assert_eq "$k present in aggregate" "$k" "$val"
done

echo "=== totals + table render ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
anomalies=$(printf '%s' "$out" | jq -r '.anomalies')
full=$(printf '%s' "$out" | jq -r '.full_success')
[[ "$anomalies" -ge 0 ]] && { echo "  PASS: anomalies present"; pass=$((pass+1)); } || { echo "  FAIL: anomalies missing"; fail=$((fail+1)); }
assert_eq "full_success false on interrupted fixture" "false" "$full"

table=$(pipeline-score --run run-fix-001 --format table --no-gh)
echo "$table" | grep -q 'RUN-LEVEL STEPS' && { echo "  PASS: table renders header"; pass=$((pass+1)); } || { echo "  FAIL: table missing header"; fail=$((fail+1)); }

echo "=== scores.jsonl history append ==="

# Add assert_file_exists helper if not already present (copy from state.sh pattern)
type assert_file_exists >/dev/null 2>&1 || assert_file_exists() {
  local label="$1" path="$2"
  if [[ -e "$path" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (file not found: $path)"
    fail=$((fail + 1))
  fi
}

rm -f "$CLAUDE_PLUGIN_DATA/scores.jsonl"
pipeline-score --run run-fix-001 --format json --no-gh >/dev/null

assert_file_exists "scores.jsonl created" "$CLAUDE_PLUGIN_DATA/scores.jsonl"
lines=$(wc -l < "$CLAUDE_PLUGIN_DATA/scores.jsonl" | tr -d ' ')
assert_eq "one line per scoring" "1" "$lines"

pipeline-score --run run-fix-001 --format json --no-gh >/dev/null
lines=$(wc -l < "$CLAUDE_PLUGIN_DATA/scores.jsonl" | tr -d ' ')
assert_eq "second scoring appends" "2" "$lines"

pipeline-score --run run-fix-001 --format json --no-gh --no-log >/dev/null
lines=$(wc -l < "$CLAUDE_PLUGIN_DATA/scores.jsonl" | tr -d ' ')
assert_eq "--no-log suppresses append" "2" "$lines"

echo "=== tools/score-run.sh wrapper ==="

wrapper="$(cd "$(dirname "$0")/../../tools" && pwd)/score-run.sh"
out=$("$wrapper" --run run-fix-001 --format json --no-gh --no-log)
run_id=$(printf '%s' "$out" | jq -r '.run_id')
assert_eq "wrapper passes --run" "run-fix-001" "$run_id"

echo "=== backfill version stamping ==="

mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-no-version"
jq -n '{run_id: "run-no-version", status: "done", mode: "prd", started_at: "2026-03-15T10:00:00Z", tasks: {}}' > "$CLAUDE_PLUGIN_DATA/runs/run-no-version/state.json"
touch "$CLAUDE_PLUGIN_DATA/runs/run-no-version/metrics.jsonl"
touch "$CLAUDE_PLUGIN_DATA/runs/run-no-version/audit.jsonl"

"$(cd "$(dirname "$0")/../../tools" && pwd)/score-run.sh" backfill --run run-no-version --assume-version 0.3.2 --no-gh
version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/runs/run-no-version/state.json")
assert_eq "backfill stamps version" "0.3.2" "$version"

echo "=== quota.check + quota.wait metric emission ==="

pipeline-init "run-quota-001" --issue 1 --mode prd --force >/dev/null
(
  source "$(dirname "$0")/../pipeline-lib.sh"
  # Force a proceed outcome by making pipeline-quota-check return the sentinel
  # "over_threshold=true" — but we want proceed, so use a stub:
  pipeline-quota-check() { jq -n '{
    detection_method:"statusline",
    five_hour:{utilization:0.1,over_threshold:false},
    seven_day:{utilization:0.2,over_threshold:false},
    captured_at:"2026-04-21T08:00:00Z"
  }'; }
  pipeline-model-router() { jq -n '{action:"proceed"}'; }
  export -f pipeline-quota-check pipeline-model-router
  pipeline_quota_gate "run-quota-001" "feature" "test-gate-A" >/dev/null
)

metrics="$CLAUDE_PLUGIN_DATA/runs/run-quota-001/metrics.jsonl"
qc=$(grep -c '"event":"quota.check"' "$metrics" 2>/dev/null || echo 0)
assert_eq "quota.check emitted on proceed" "1" "$qc"

gate=$(grep '"event":"quota.check"' "$metrics" | tail -1 | jq -r '.gate')
assert_eq "gate label captured" "test-gate-A" "$gate"

action=$(grep '"event":"quota.check"' "$metrics" | tail -1 | jq -r '.action')
assert_eq "action captured" "proceed" "$action"

echo "=== observability section in score output ==="

# Synthesize a fixture run with two quota.check events and two review.provider events.
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-obs-001"
jq -n '{run_id:"run-obs-001", version:"0.3.4", status:"done", mode:"prd", tasks:{}}' \
  > "$CLAUDE_PLUGIN_DATA/runs/run-obs-001/state.json"
cat > "$CLAUDE_PLUGIN_DATA/runs/run-obs-001/metrics.jsonl" <<EOF
{"ts":"2026-04-21T00:00:01Z","run_id":"run-obs-001","event":"quota.check","gate":"A","action":"proceed","tier":"feature","over_5h":0.05,"over_7d":0.10}
{"ts":"2026-04-21T00:15:01Z","run_id":"run-obs-001","event":"quota.check","gate":"C","action":"wait","tier":"feature","over_5h":0.22,"over_7d":0.11}
{"ts":"2026-04-21T00:15:05Z","run_id":"run-obs-001","event":"quota.wait","gate":"C","tier":"feature","minutes_slept":9,"cumulative_pause_minutes":9,"cycle":1}
{"ts":"2026-04-21T00:00:20Z","run_id":"run-obs-001","event":"task.review.provider","task_id":"t1","reviewer":"codex","reason":"detected"}
{"ts":"2026-04-21T00:05:10Z","run_id":"run-obs-001","event":"task.review.provider","task_id":"t2","reviewer":"claude","reason":"fallback"}
EOF
touch "$CLAUDE_PLUGIN_DATA/runs/run-obs-001/audit.jsonl"

out=$(pipeline-score --run run-obs-001 --format json --no-gh --no-log)
obs=$(printf '%s' "$out" | jq -r '.observability')
[[ "$obs" != "null" ]] && { echo "  PASS: observability section present"; pass=$((pass+1)); } || { echo "  FAIL: no observability section"; fail=$((fail+1)); }

assert_eq "reviewers.codex count"      "1" "$(printf '%s' "$out" | jq -r '.observability.reviewers.codex')"
assert_eq "reviewers.claude count"     "1" "$(printf '%s' "$out" | jq -r '.observability.reviewers.claude')"
assert_eq "reviewers.fallback count"   "1" "$(printf '%s' "$out" | jq -r '.observability.reviewers.fallback_from_codex')"
assert_eq "quota.checks count"         "2" "$(printf '%s' "$out" | jq -r '.observability.quota.checks')"
assert_eq "quota.waits count"          "1" "$(printf '%s' "$out" | jq -r '.observability.quota.waits')"
assert_eq "quota.pause_minutes sum"    "9" "$(printf '%s' "$out" | jq -r '.observability.quota.pause_minutes')"

echo "=== header includes start/end/duration ==="

out=$(pipeline-score --run run-fix-001 --format table --no-gh --no-log)
if echo "$out" | grep -qE '^Started: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z   Ended: [0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z   Duration: [0-9]+:[0-9]{2}:[0-9]{2}$'; then
  echo "  PASS: header has Started/Ended/Duration"
  pass=$((pass + 1))
else
  echo "  FAIL: header missing timestamps"
  echo "$out"
  fail=$((fail + 1))
fi

echo "=== _gh_pr_ci_color all outcomes ==="

steps_path="$(cd "$(dirname "$0")/.." && pwd)/pipeline-score-steps.sh"

_run_color() {
  _FAKE_PR_VIEW="$1" bash -c "source '$steps_path'; _gh_pr_ci_color 42"
}

assert_eq "SUCCESS StatusContext → green" "green" \
  "$(_run_color '{"statusCheckRollup":[{"__typename":"StatusContext","state":"SUCCESS","conclusion":null}]}')"
assert_eq "FAILURE CheckRun → red" "red" \
  "$(_run_color '{"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"}]}')"
assert_eq "IN_PROGRESS CheckRun → pending" "pending" \
  "$(_run_color '{"statusCheckRollup":[{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":null}]}')"
assert_eq "StatusContext PENDING → pending" "pending" \
  "$(_run_color '{"statusCheckRollup":[{"__typename":"StatusContext","state":"PENDING","conclusion":null}]}')"
assert_eq "mixed success+in-flight → pending" "pending" \
  "$(_run_color '{"statusCheckRollup":[{"__typename":"StatusContext","state":"SUCCESS","conclusion":null},{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":null}]}')"
assert_eq "mixed success+failure → red" "red" \
  "$(_run_color '{"statusCheckRollup":[{"conclusion":"SUCCESS"},{"conclusion":"FAILURE"}]}')"
assert_eq "empty rollup → unknown" "unknown" \
  "$(_run_color '{"statusCheckRollup":[]}')"

echo ""
echo "=== RESULTS: ${pass} passed, ${fail} failed ==="
[[ $fail -eq 0 ]]
