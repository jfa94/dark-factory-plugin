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

count=$(grep -c '"event":"task.ci"' "$metrics_file" || echo 0)
assert_eq "task.ci metric written" "1" "$count"

ci_line=$(grep '"event":"task.ci"' "$metrics_file")
event=$(printf '%s' "$ci_line" | jq -r '.event')
assert_eq "event name is task.ci" "task.ci" "$event"

status=$(printf '%s' "$ci_line" | jq -r '.status')
assert_eq "status field captured" "green" "$status"

pr_num=$(printf '%s' "$ci_line" | jq -r '.pr_number')
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
R8=$(printf '%s' "$out" | jq -r '.run_steps.R8_final_pr_opened.state')

assert_eq "R5 no_circuit_trip"      "pass"        "$R5"
assert_eq "R6 no_human_gate_pause"  "pass"        "$R6"
# Fixture: not all tasks done (interrupted) → scribe did not need to run.
assert_eq "R7 scribe_ran"           "skipped_na"  "$R7"
assert_eq "R8 final_pr_opened"      "skipped_na"  "$R8"

echo "=== run-level steps R9-R12 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R9=$(printf '%s' "$out" | jq -r '.run_steps.R9_final_pr_merged.state')
R10=$(printf '%s' "$out" | jq -r '.run_steps.R10_final_pr_ci_green.state')
R11=$(printf '%s' "$out" | jq -r '.run_steps.R11_no_escalation_comments.state')
R12=$(printf '%s' "$out" | jq -r '.run_steps.R12_terminal_status_done.state')

assert_eq "R9 final_pr_merged"             "skipped_na"  "$R9"
assert_eq "R10 final_pr_ci_green"          "skipped_na"  "$R10"
assert_eq "R11 no_escalation_comments"     "pass"        "$R11"
assert_eq "R12 terminal_status_done"       "fail"        "$R12"

echo "=== per-task steps T2-T5 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
T2_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T2_executor_spawned.pass')
T3_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T3_lint_pass.pass')
T4_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T4_typecheck_pass.pass')
T5_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T5_tests_pass.pass')

[[ "$T2_pass" -ge 1 ]] && { echo "  PASS: T2 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T2 pass count = $T2_pass"; fail=$((fail+1)); }
[[ "$T3_pass" -ge 1 ]] && { echo "  PASS: T3 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T3 pass count = $T3_pass"; fail=$((fail+1)); }
[[ "$T4_pass" -ge 1 ]] && { echo "  PASS: T4 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T4 pass count = $T4_pass"; fail=$((fail+1)); }
[[ "$T5_pass" -ge 1 ]] && { echo "  PASS: T5 has >=1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T5 pass count = $T5_pass"; fail=$((fail+1)); }

echo "=== per-task steps T7-T10 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T7_holdout_pass T8_mutation_pass T9_reviewer_approved_first_round T10_reviewer_approved_overall; do
  val=$(printf '%s' "$out" | jq -r ".task_steps_aggregate.$k.id // empty")
  assert_eq "$k present in aggregate" "$k" "$val"
done

echo "=== per-task steps T11-T14 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T11_pr_created T12_pr_ci_green T13_pr_merged T14_within_retry_budget; do
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

echo "=== T1_quota_checked pass when quota.check precedes task.start ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-t1-pass"
cat > "$CLAUDE_PLUGIN_DATA/runs/run-t1-pass/state.json" <<'JSON'
{
  "version":"9.9.9","mode":"task","status":"done",
  "started_at":"2026-04-21T00:00:00Z","ended_at":"2026-04-21T00:10:00Z",
  "tasks":{"t-1":{"status":"done","worktree":"/tmp/wt"}}
}
JSON
cat > "$CLAUDE_PLUGIN_DATA/runs/run-t1-pass/metrics.jsonl" <<'M'
{"ts":"2026-04-21T00:00:10Z","run_id":"run-t1-pass","event":"quota.check","task_id":"t-1","over_5h":0.42}
{"ts":"2026-04-21T00:00:20Z","run_id":"run-t1-pass","event":"task.start","task_id":"t-1"}
M
: > "$CLAUDE_PLUGIN_DATA/runs/run-t1-pass/audit.jsonl"
out=$(pipeline-score --run run-t1-pass --format json --no-gh --no-log)
v=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T1_quota_checked.pass')
assert_eq "T1_quota_checked pass case" "1" "$v"

echo "=== T1_quota_checked fail when no quota.check event ==="
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-t1-fail"
cat > "$CLAUDE_PLUGIN_DATA/runs/run-t1-fail/state.json" <<'JSON'
{
  "version":"9.9.9","mode":"task","status":"done",
  "started_at":"2026-04-21T00:00:00Z","ended_at":"2026-04-21T00:10:00Z",
  "tasks":{"t-1":{"status":"done","worktree":"/tmp/wt"}}
}
JSON
cat > "$CLAUDE_PLUGIN_DATA/runs/run-t1-fail/metrics.jsonl" <<'M'
{"ts":"2026-04-21T00:00:20Z","run_id":"run-t1-fail","event":"task.start","task_id":"t-1"}
M
: > "$CLAUDE_PLUGIN_DATA/runs/run-t1-fail/audit.jsonl"
out=$(pipeline-score --run run-t1-fail --format json --no-gh --no-log)
v=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T1_quota_checked.fail')
assert_eq "T1_quota_checked fail case" "1" "$v"

echo "=== T1_quota_checked is first field of task_steps_aggregate ==="
first=$(printf '%s' "$out" | jq -r '.task_steps_aggregate | keys_unsorted | .[0]')
assert_eq "T1 is first field" "T1_quota_checked" "$first"

echo "=== compliant-smoke fixture: full_success ==="
compliant="$(cd "$(dirname "$0")/fixtures/score/compliant-smoke" && pwd)"
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-compliant-smoke"
cp -r "$compliant"/. "$CLAUDE_PLUGIN_DATA/runs/run-compliant-smoke/"
smoke=$(pipeline-score --run run-compliant-smoke --format json --no-gh --no-log)
assert_eq "compliant-smoke full_success"   "true" "$(printf '%s' "$smoke" | jq -r '.full_success')"
for r in R1_autonomy_ok R2_spec_generated R3_spec_reviewer_approved R4_tasks_decomposed \
         R5_no_circuit_trip R6_no_human_gate_pause R7_scribe_ran R8_final_pr_opened \
         R9_final_pr_merged R10_final_pr_ci_green R11_no_escalation_comments R12_terminal_status_done; do
  v=$(printf '%s' "$smoke" | jq -r --arg k "$r" '.run_steps[$k].state')
  assert_eq "compliant-smoke $r pass" "pass" "$v"
done
for t in T1_quota_checked T2_executor_spawned T3_lint_pass T4_typecheck_pass T5_tests_pass \
         T6_coverage_non_regress T9_reviewer_approved_first_round T10_reviewer_approved_overall \
         T11_pr_created T12_pr_ci_green T13_pr_merged T14_within_retry_budget; do
  p=$(printf '%s' "$smoke" | jq -r --arg k "$t" '.task_steps_aggregate[$k].pass')
  f=$(printf '%s' "$smoke" | jq -r --arg k "$t" '.task_steps_aggregate[$k].fail + .task_steps_aggregate[$k].not_performed + .task_steps_aggregate[$k].skipped_task_inactive')
  assert_eq "compliant-smoke $t pass=3"    "3" "$p"
  assert_eq "compliant-smoke $t clean"     "0" "$f"
done
# T7/T8 skipped_na only (no holdouts, routine tier)
for t in T7_holdout_pass T8_mutation_pass; do
  sna=$(printf '%s' "$smoke" | jq -r --arg k "$t" '.task_steps_aggregate[$k].skipped_na')
  assert_eq "compliant-smoke $t skipped_na=3" "3" "$sna"
done
# Observability sanity
assert_eq "compliant-smoke observability.quota.checks"           "3" "$(printf '%s' "$smoke" | jq -r '.observability.quota.checks')"
assert_eq "compliant-smoke observability.reviewers.claude"       "2" "$(printf '%s' "$smoke" | jq -r '.observability.reviewers.claude')"
assert_eq "compliant-smoke observability.reviewers.codex"        "1" "$(printf '%s' "$smoke" | jq -r '.observability.reviewers.codex')"

echo "=== legacy-rollup fixture: R8/R9/R10 evaluate via .rollup.* fallback ==="
legacy_dir="$CLAUDE_PLUGIN_DATA/runs/run-legacy-rollup"
mkdir -p "$legacy_dir"
# Build a minimal done run with only the old .rollup.* key
jq -n '{
  "run_id": "run-legacy-rollup",
  "version": "0.3.5",
  "status": "done",
  "mode": "prd",
  "started_at": "2026-04-20T08:00:00Z",
  "ended_at": "2026-04-20T10:00:00Z",
  "updated_at": "2026-04-20T10:00:00Z",
  "spec": {"status":"done","review_iterations":1,"review_score":55,"committed":true,"handoff_ref":"abc"},
  "scribe": {"status":"done"},
  "rollup": {"pr_url":"https://github.com/acme/repo/pull/8888","pr_number":8888},
  "execution_order": [{"task_id":"t1","parallel_group":0}],
  "tasks": {
    "t1": {
      "task_id":"t1","status":"done","depends_on":[],"files":["src/x.ts"],
      "acceptance_criteria":["ok"],"tests_to_write":["t"],"risk_tier":"routine",
      "stage":"ship_done","pr_number":77,"pr_url":"https://github.com/acme/repo/pull/77",
      "ci_status":"green","review_attempts":0,"quality_attempts":0,"ci_fix_attempts":0,
      "executor_status":"DONE","reviewer_status":"DONE",
      "quality_gate":{"ok":true,"checks":[
        {"command":"lint","status":"passed"},
        {"command":"typecheck","status":"passed"},
        {"command":"test","status":"passed"}
      ]},
      "started_at":"2026-04-20T08:05:00Z","ended_at":"2026-04-20T09:00:00Z"
    }
  }
}' > "$legacy_dir/state.json"
cp "$(dirname "$0")/fixtures/score/compliant-smoke/metrics.jsonl" "$legacy_dir/metrics.jsonl" 2>/dev/null || printf '' > "$legacy_dir/metrics.jsonl"
cp "$(dirname "$0")/fixtures/score/compliant-smoke/audit.jsonl"   "$legacy_dir/audit.jsonl"   2>/dev/null || printf '' > "$legacy_dir/audit.jsonl"
legacy=$(pipeline-score --run run-legacy-rollup --format json --no-gh --no-log)
R8l=$(printf '%s' "$legacy" | jq -r '.run_steps.R8_final_pr_opened.state')
R9l=$(printf '%s' "$legacy" | jq -r '.run_steps.R9_final_pr_merged.state')
assert_eq "legacy-rollup R8 reads .rollup fallback (pass or skipped_na)" "pass" "$R8l"
assert_eq "legacy-rollup R9 reads .rollup fallback (not fail)" "false" \
  "$([ "$R9l" == "fail" ] && echo true || echo false)"

echo ""
echo "=== RESULTS: ${pass} passed, ${fail} failed ==="
[[ $fail -eq 0 ]]
