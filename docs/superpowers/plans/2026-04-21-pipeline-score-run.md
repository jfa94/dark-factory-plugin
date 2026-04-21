# Pipeline Score-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a developer-only scorer that reads existing pipeline run artifacts and reports per-step compliance so plugin versions can be compared apples-to-apples.

**Architecture:** One deterministic bash analyzer (`bin/pipeline-score`) plus a thin interactive wrapper (`tools/score-run.sh`). All evaluators read `state.json` / `metrics.jsonl` / `audit.jsonl` / `reviews/` / `holdouts/`; CI outcomes are backfilled via `gh` CLI and emitted as metrics on future runs via new `task.ci` / `run.ci` events. History log at `${CLAUDE_PLUGIN_DATA}/scores.jsonl`.

**Tech Stack:** Bash, `jq`, `gh` CLI. No new runtime deps.

Spec: `docs/superpowers/specs/2026-04-21-pipeline-score-run-design.md`. Read before starting.

---

## File Structure

### New files

- `bin/pipeline-score` — core analyzer, reads run artifacts and emits score JSON or table. Exit 0 always except fatal errors.
- `bin/pipeline-score-steps.sh` — step-evaluator library (sourced by `pipeline-score`). One function per step: `eval_R1_autonomy_ok`, `eval_T1_executor_spawned`, etc. Each returns `pass|fail|skipped_ok|not_performed` via stdout.
- `tools/score-run.sh` — dev-only entry point. Interactive picker, filter flags, backfill subcommand, history subcommand.
- `bin/tests/score.sh` — unit tests for step evaluators + integration test against the outsidey fixture.
- `bin/tests/fixtures/score/` — fixture run dirs (`state.json` + `metrics.jsonl` + `audit.jsonl` + `reviews/` + `holdouts/`) for deterministic testing.

### Modified files

- `bin/pipeline-init` — stamp `.version` from `.claude-plugin/plugin.json` on state creation.
- `bin/pipeline-wait-pr` — emit `task.ci` metric with CI outcome on PR resolution.
- `commands/run.md` — emit `agent.scribe.end` after scribe returns; emit `run.ci` after rollup PR resolves.
- `bin/test` — register new `score` suite.
- `bin/tests/state.sh` — add assertion for `.version` field.

---

## Task 1: Stamp plugin version in pipeline-init

**Files:**

- Modify: `bin/pipeline-init:62-96` (state JSON construction)
- Test: `bin/tests/state.sh` (extend existing pipeline-init block)

- [ ] **Step 1: Write the failing test**

Append to `bin/tests/state.sh` after line 59 (the existing `status is running` assertion):

```bash
version=$(jq -r '.version // empty' "$CLAUDE_PLUGIN_DATA/runs/run-test-001/state.json")
assert_eq "plugin version stamped" "" "" # placeholder — updated next step
# Real assertion: read plugin.json at the repo root.
plugin_version=$(jq -r '.version' "$(dirname "$0")/../../.claude-plugin/plugin.json")
assert_eq "plugin version matches plugin.json" "$plugin_version" "$version"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/test state`
Expected: FAIL on "plugin version matches plugin.json" — `.version` field does not exist yet.

- [ ] **Step 3: Add version read in pipeline-init**

Modify `bin/pipeline-init` around line 37 (after `runs_dir` is defined, before state is built):

```bash
plugin_manifest="$(dirname "$0")/../.claude-plugin/plugin.json"
plugin_version=$(jq -r '.version // "unknown"' "$plugin_manifest" 2>/dev/null || echo "unknown")
```

Then in the `jq -n` call at line 62, add:

```bash
state=$(jq -n \
  --arg run_id "$run_id" \
  --arg mode "$mode" \
  --arg now "$now" \
  --arg version "$plugin_version" \
  --argjson issues "$issue_numbers" \
  '{
    run_id: $run_id,
    version: $version,
    status: "running",
    ...
```

(Insert `version: $version,` immediately after `run_id: $run_id,`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bin/test state`
Expected: PASS "plugin version matches plugin.json".

- [ ] **Step 5: Commit**

```bash
git add bin/pipeline-init bin/tests/state.sh
git commit -m "feat(state): stamp plugin version on pipeline-init"
```

---

## Task 2: Emit task.ci metric in pipeline-wait-pr

**Files:**

- Modify: `bin/pipeline-wait-pr` (terminal return points)
- Test: `bin/tests/score.sh` (new file — smoke test only; full coverage in later tasks)

- [ ] **Step 1: Create the new test file skeleton**

Create `bin/tests/score.sh`:

```bash
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
# Placeholder: filled in Task 2 Step 3.

echo ""
echo "=== RESULTS: ${pass} passed, ${fail} failed ==="
[[ $fail -eq 0 ]]
```

Make executable: `chmod +x bin/tests/score.sh`

- [ ] **Step 2: Write the failing test for task.ci emission**

Replace the placeholder in `bin/tests/score.sh` with:

```bash
# Set up a fake run
pipeline-init "run-ci-001" --issue 1 --mode prd >/dev/null
run_dir="$CLAUDE_PLUGIN_DATA/runs/run-ci-001"
metrics_file="$run_dir/metrics.jsonl"

# Simulate pipeline-wait-pr emitting a green result.
# We cannot call the real gh; we call the helper that emits the metric.
# The helper lives in pipeline-lib.sh as `emit_ci_metric` (new in Task 2).
(
  source "$(dirname "$0")/../pipeline-lib.sh"
  FACTORY_CURRENT_RUN_ID="run-ci-001" emit_ci_metric "task" "42" "green" '["lint","test"]'
)

count=$(wc -l < "$metrics_file" | tr -d ' ')
assert_eq "task.ci metric written" "1" "$count"

event=$(jq -r '.event' "$metrics_file")
assert_eq "event name is task.ci" "task.ci" "$event"

status=$(jq -r '.status' "$metrics_file")
assert_eq "status field captured" "green" "$status"

pr_num=$(jq -r '.pr_number' "$metrics_file")
assert_eq "pr_number captured" "42" "$pr_num"
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL on "task.ci metric written" — `emit_ci_metric` helper doesn't exist.

- [ ] **Step 4: Add helper to pipeline-lib.sh**

Append to `bin/pipeline-lib.sh` (after `log_metric`):

```bash
# Emit a structured CI-outcome metric.
# Usage: emit_ci_metric <kind: task|run> <pr_number> <status: green|red|timeout> <checks_json>
emit_ci_metric() {
  local kind="$1" pr="$2" status="$3" checks="${4:-[]}"
  local event
  case "$kind" in
    task) event="task.ci" ;;
    run)  event="run.ci" ;;
    *) log_error "emit_ci_metric: invalid kind: $kind"; return 1 ;;
  esac
  log_metric "$event" "pr_number=$pr" "status=\"$status\"" "checks=$checks"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 4 assertions.

- [ ] **Step 6: Wire into pipeline-wait-pr**

Locate the four exit paths in `bin/pipeline-wait-pr` (merged, CI failed, conflict, timeout). Immediately before each `exit N`, add:

```bash
emit_ci_metric task "$pr" "green" "$(_gh_checks_json 2>/dev/null || echo '[]')"   # before exit 0
emit_ci_metric task "$pr" "red"   "$(_gh_checks_json 2>/dev/null || echo '[]')"   # before exit 3
emit_ci_metric task "$pr" "red"   '[]'                                             # before exit 4
emit_ci_metric task "$pr" "timeout" '[]'                                           # before exit 1
```

Define `_gh_checks_json` near the top of the script:

```bash
_gh_checks_json() {
  gh pr checks "$pr" --json name,state,conclusion 2>/dev/null || echo '[]'
}
```

- [ ] **Step 7: Commit**

```bash
git add bin/pipeline-lib.sh bin/pipeline-wait-pr bin/tests/score.sh
git commit -m "feat(metrics): emit task.ci on PR resolution"
```

---

## Task 3: Emit run.ci metric and scribe.end metric from run.md

**Files:**

- Modify: `commands/run.md` sections "After all groups complete" and "Final staging → develop PR"

No test here — `run.md` is a prompt, not code. Manual verification via the next pipeline run.

- [ ] **Step 1: Add scribe.end emission**

In `commands/run.md`, locate the `Agent({ subagent_type: "scribe", ... })` call in the "After all groups complete" section. Immediately after (in the bash that follows the Agent call), add:

```bash
( source "$(dirname "$(which pipeline-lib.sh 2>/dev/null || echo bin/pipeline-lib.sh)")"
  log_metric "agent.scribe.end" "status=\"completed\""
)
```

- [ ] **Step 2: Add run.ci emission after rollup PR resolves**

In the "Final staging → develop PR" section, after `final_pr_number=$(gh pr view staging --json number -q .number)` and after CI completes (i.e., after auto-merge fires or after the human closes the loop), add:

```bash
ci_state=$(gh pr view "$final_pr_number" --json statusCheckRollup -q '.statusCheckRollup | map(.conclusion) | if all(. == "SUCCESS") then "green" else "red" end' 2>/dev/null || echo "timeout")
ci_checks=$(gh pr view "$final_pr_number" --json statusCheckRollup -q '.statusCheckRollup' 2>/dev/null || echo '[]')
emit_ci_metric run "$final_pr_number" "$ci_state" "$ci_checks"
```

- [ ] **Step 3: Commit**

```bash
git add commands/run.md
git commit -m "feat(observability): emit scribe.end + run.ci metrics from orchestrator"
```

---

## Task 4: Build the golden fixture — outsidey run-20260420-141621

**Files:**

- Create: `bin/tests/fixtures/score/outsidey-20260420/state.json`
- Create: `bin/tests/fixtures/score/outsidey-20260420/metrics.jsonl`
- Create: `bin/tests/fixtures/score/outsidey-20260420/audit.jsonl`
- Create: `bin/tests/fixtures/score/outsidey-20260420/reviews/.gitkeep`
- Create: `bin/tests/fixtures/score/outsidey-20260420/holdouts/*.json` (copy subset)

- [ ] **Step 1: Create fixture dir**

```bash
mkdir -p bin/tests/fixtures/score/outsidey-20260420/{reviews,holdouts}
```

- [ ] **Step 2: Copy state.json, metrics.jsonl, audit.jsonl, reviews/, holdouts/ from the live run**

```bash
src=~/.claude/plugins/data/factory-jfa94/runs/run-20260420-141621
dst=bin/tests/fixtures/score/outsidey-20260420

cp "$src/state.json" "$dst/state.json"
cp "$src/metrics.jsonl" "$dst/metrics.jsonl" 2>/dev/null || touch "$dst/metrics.jsonl"
cp "$src/audit.jsonl"  "$dst/audit.jsonl"  2>/dev/null || touch "$dst/audit.jsonl"
cp -r "$src/reviews"/. "$dst/reviews/" 2>/dev/null || true
cp -r "$src/holdouts"/. "$dst/holdouts/" 2>/dev/null || true
```

- [ ] **Step 3: Scrub identifying info**

Open `$dst/state.json` in an editor. Replace:

- any absolute paths containing `/Users/Javier/` with `/FIXTURE/`
- `.orchestrator.project_root` with `/FIXTURE/outsidey`
- Any auth tokens or URLs with unique identifiers → leave GitHub org/repo refs intact for backfill testing

(This fixture should be readable by anyone.)

- [ ] **Step 4: Stamp .version manually on the fixture**

```bash
jq '.version = "0.3.2"' "$dst/state.json" > "$dst/state.json.tmp" && mv "$dst/state.json.tmp" "$dst/state.json"
```

- [ ] **Step 5: Commit the fixture**

```bash
git add bin/tests/fixtures/score/outsidey-20260420
git commit -m "test(score): add outsidey-20260420 fixture for score analyzer"
```

---

## Task 5: Build bin/pipeline-score skeleton

**Files:**

- Create: `bin/pipeline-score`
- Create: `bin/pipeline-score-steps.sh`
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write the failing test**

Append to `bin/tests/score.sh`:

```bash
echo "=== pipeline-score skeleton ==="

fixture="$(cd "$(dirname "$0")/fixtures/score/outsidey-20260420" && pwd)"
# Seed fixture into a fresh CLAUDE_PLUGIN_DATA
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-fix-001"
cp -r "$fixture"/. "$CLAUDE_PLUGIN_DATA/runs/run-fix-001/"

out=$(pipeline-score --run run-fix-001 --format json --no-gh 2>/dev/null)
run_id=$(printf '%s' "$out" | jq -r '.run_id')
assert_eq "pipeline-score emits run_id" "run-fix-001" "$run_id"

version=$(printf '%s' "$out" | jq -r '.plugin_version')
assert_eq "pipeline-score emits plugin_version" "0.3.2" "$version"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — `pipeline-score` script doesn't exist.

- [ ] **Step 3: Create bin/pipeline-score skeleton**

Create `bin/pipeline-score`:

```bash
#!/usr/bin/env bash
# Score a pipeline run against the expected-steps checklist.
# Usage: pipeline-score --run <run-id> [--format json|table] [--no-gh]
#
# Output: structured JSON (default) or a terminal table (--format table).
# Appends one-line record to ${CLAUDE_PLUGIN_DATA}/scores.jsonl unless --no-log.
set -euo pipefail

source "$(dirname "$0")/pipeline-lib.sh"
source "$(dirname "$0")/pipeline-score-steps.sh"
require_command jq

run_id=""
format="json"
use_gh=true
log_history=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) run_id="$2"; shift 2 ;;
    --format) format="$2"; shift 2 ;;
    --no-gh) use_gh=false; shift ;;
    --no-log) log_history=false; shift ;;
    *) log_error "unknown flag: $1"; exit 1 ;;
  esac
done

[[ -z "$run_id" ]] && { log_error "missing --run"; exit 1; }

run_dir="${CLAUDE_PLUGIN_DATA}/runs/${run_id}"
[[ -f "$run_dir/state.json" ]] || { log_error "state.json not found: $run_dir"; exit 1; }

state=$(cat "$run_dir/state.json")
metrics_file="$run_dir/metrics.jsonl"
audit_file="$run_dir/audit.jsonl"

plugin_version=$(printf '%s' "$state" | jq -r '.version // "unknown"')
mode=$(printf '%s' "$state" | jq -r '.mode')
status=$(printf '%s' "$state" | jq -r '.status')

# Bucketing.
final_pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
bucket="terminated"
case "$status" in
  interrupted|partial)
    [[ -z "$final_pr" ]] && bucket="incomplete"
    ;;
esac

# Placeholder scoring — replaced in Tasks 6-11.
run_steps='{}'
task_steps='{}'
anomalies=0

result=$(jq -n \
  --arg run_id "$run_id" \
  --arg plugin_version "$plugin_version" \
  --arg mode "$mode" \
  --arg status "$status" \
  --arg bucket "$bucket" \
  --argjson run_steps "$run_steps" \
  --argjson task_steps "$task_steps" \
  --argjson anomalies "$anomalies" \
  '{
    run_id: $run_id,
    plugin_version: $plugin_version,
    mode: $mode,
    status: $status,
    bucket: $bucket,
    run_steps: $run_steps,
    task_steps: $task_steps,
    anomalies: $anomalies
  }')

case "$format" in
  json) printf '%s\n' "$result" ;;
  table) printf '%s\n' "$result" | _render_table ;;
  *) log_error "invalid format: $format"; exit 1 ;;
esac
```

Make executable: `chmod +x bin/pipeline-score`

- [ ] **Step 4: Create bin/pipeline-score-steps.sh stub**

Create `bin/pipeline-score-steps.sh`:

```bash
#!/usr/bin/env bash
# Step evaluators for pipeline-score. Each function takes state / metrics /
# audit / reviews / holdouts inputs (via closure variables set by the caller)
# and prints one of: pass, fail, skipped_ok, not_performed.

_render_table() {
  # Minimal passthrough — enhanced in Task 12.
  cat
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS both assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): add pipeline-score skeleton + fixture smoke test"
```

---

## Task 6: Implement run-level evaluators R1–R4 (autonomy, spec, decomposition)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (wire into `run_steps`)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== run-level steps R1-R4 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R1=$(printf '%s' "$out" | jq -r '.run_steps.R1_autonomy_ok.state')
R2=$(printf '%s' "$out" | jq -r '.run_steps.R2_spec_generated.state')
R3=$(printf '%s' "$out" | jq -r '.run_steps.R3_spec_reviewer_approved.state')
R4=$(printf '%s' "$out" | jq -r '.run_steps.R4_tasks_decomposed.state')

assert_eq "R1 autonomy_ok is pass"          "pass" "$R1"
assert_eq "R2 spec_generated is pass"        "pass" "$R2"
assert_eq "R3 spec_reviewer_approved"        "pass" "$R3"
assert_eq "R4 tasks_decomposed is pass"      "pass" "$R4"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — evaluators not implemented.

- [ ] **Step 3: Implement evaluators R1–R4**

Append to `bin/pipeline-score-steps.sh`:

```bash
# Inputs available via caller closure: $state (json), $metrics_file, $audit_file, $run_dir.

eval_R1_autonomy_ok() {
  # state.json exists is implicit (already checked). Look for init.error in audit.
  if [[ -f "$audit_file" ]] && grep -q '"event":"init.error"' "$audit_file" 2>/dev/null; then
    echo "fail"
  else
    echo "pass"
  fi
}

eval_R2_spec_generated() {
  local mode spec_path spec_committed
  mode=$(printf '%s' "$state" | jq -r '.mode')
  if [[ "$mode" == "task" ]]; then
    echo "skipped_ok"
    return
  fi
  spec_path=$(printf '%s' "$state" | jq -r '.spec.path // empty')
  spec_committed=$(printf '%s' "$state" | jq -r '.spec.committed // false')
  if [[ -n "$spec_path" && "$spec_committed" == "true" ]]; then
    echo "pass"
  elif [[ -z "$spec_path" ]]; then
    echo "not_performed"
  else
    echo "fail"
  fi
}

eval_R3_spec_reviewer_approved() {
  local mode score
  mode=$(printf '%s' "$state" | jq -r '.mode')
  [[ "$mode" == "task" ]] && { echo "skipped_ok"; return; }
  score=$(printf '%s' "$state" | jq -r '.spec.review_score // empty')
  if [[ -z "$score" || "$score" == "null" ]]; then
    echo "not_performed"
  elif (( score >= 54 )); then
    echo "pass"
  else
    echo "fail"
  fi
}

eval_R4_tasks_decomposed() {
  local count
  count=$(printf '%s' "$state" | jq '.execution_order // [] | length')
  if [[ "$count" -ge 1 ]]; then
    echo "pass"
  else
    echo "not_performed"
  fi
}
```

- [ ] **Step 4: Wire into pipeline-score**

In `bin/pipeline-score`, replace `run_steps='{}'` with:

```bash
_score_run_step() {
  local id="$1" label="$2" fn="$3"
  local state_out; state_out=$($fn)
  jq -n --arg id "$id" --arg label "$label" --arg state "$state_out" \
    '{id: $id, label: $label, state: $state}'
}

run_steps=$(jq -n \
  --argjson R1 "$(_score_run_step R1_autonomy_ok          autonomy_ok          eval_R1_autonomy_ok)" \
  --argjson R2 "$(_score_run_step R2_spec_generated       spec_generated       eval_R2_spec_generated)" \
  --argjson R3 "$(_score_run_step R3_spec_reviewer_approved spec_reviewer_approved eval_R3_spec_reviewer_approved)" \
  --argjson R4 "$(_score_run_step R4_tasks_decomposed     tasks_decomposed     eval_R4_tasks_decomposed)" \
  '{R1_autonomy_ok: $R1, R2_spec_generated: $R2, R3_spec_reviewer_approved: $R3, R4_tasks_decomposed: $R4}')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 4 assertions.

Note: the outsidey fixture may not have `.spec.review_score` populated. If R3 evaluates to `not_performed`, update the test assertion to `not_performed` — that's the _correct_ reading of that fixture's data, and surfaces a real observability gap to track.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement run-level evaluators R1-R4"
```

---

## Task 7: Implement run-level evaluators R5–R8 (circuit, pauses, scribe, rollup-opened)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (add to `run_steps`)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== run-level steps R5-R8 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R5=$(printf '%s' "$out" | jq -r '.run_steps.R5_no_circuit_trip.state')
R6=$(printf '%s' "$out" | jq -r '.run_steps.R6_no_human_gate_pause.state')
R7=$(printf '%s' "$out" | jq -r '.run_steps.R7_scribe_ran.state')
R8=$(printf '%s' "$out" | jq -r '.run_steps.R8_rollup_pr_opened.state')

assert_eq "R5 no_circuit_trip is pass"        "pass"          "$R5"
assert_eq "R6 no_human_gate_pause"            "pass"          "$R6"
# The outsidey fixture never finalized; scribe should not have been required.
# Because not-all-tasks-done, R7 applies=no and should render as skipped_ok.
assert_eq "R7 scribe_ran skipped_ok"           "skipped_ok"    "$R7"
assert_eq "R8 rollup_pr_opened skipped_ok"    "skipped_ok"    "$R8"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — evaluators not defined.

- [ ] **Step 3: Implement evaluators R5–R8**

Append to `bin/pipeline-score-steps.sh`:

```bash
eval_R5_no_circuit_trip() {
  if [[ -f "$metrics_file" ]] && grep -q '"event":"circuit_breaker"' "$metrics_file" 2>/dev/null; then
    echo "fail"
  else
    echo "pass"
  fi
}

eval_R6_no_human_gate_pause() {
  if [[ -f "$audit_file" ]] && grep -q '"status":"awaiting_human"' "$audit_file" 2>/dev/null; then
    echo "fail"
  else
    echo "pass"
  fi
}

_all_tasks_done() {
  local cnt
  cnt=$(printf '%s' "$state" | jq '[.tasks // {} | to_entries[] | select(.value.status != "done")] | length')
  [[ "$cnt" -eq 0 ]]
}

eval_R7_scribe_ran() {
  if ! _all_tasks_done; then
    echo "skipped_ok"
    return
  fi
  if [[ -f "$metrics_file" ]] && grep -q '"event":"agent.scribe.end"' "$metrics_file" 2>/dev/null; then
    echo "pass"
  else
    echo "not_performed"
  fi
}

eval_R8_rollup_pr_opened() {
  if ! _all_tasks_done; then
    echo "skipped_ok"
    return
  fi
  local pr; pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
  if [[ -n "$pr" ]]; then echo "pass"; else echo "not_performed"; fi
}
```

- [ ] **Step 4: Wire into pipeline-score**

Extend the `run_steps=$(jq -n ...)` block to include R5–R8:

```bash
run_steps=$(jq -n \
  --argjson R1 "$(_score_run_step R1_autonomy_ok autonomy_ok eval_R1_autonomy_ok)" \
  --argjson R2 "$(_score_run_step R2_spec_generated spec_generated eval_R2_spec_generated)" \
  --argjson R3 "$(_score_run_step R3_spec_reviewer_approved spec_reviewer_approved eval_R3_spec_reviewer_approved)" \
  --argjson R4 "$(_score_run_step R4_tasks_decomposed tasks_decomposed eval_R4_tasks_decomposed)" \
  --argjson R5 "$(_score_run_step R5_no_circuit_trip no_circuit_trip eval_R5_no_circuit_trip)" \
  --argjson R6 "$(_score_run_step R6_no_human_gate_pause no_human_gate_pause eval_R6_no_human_gate_pause)" \
  --argjson R7 "$(_score_run_step R7_scribe_ran scribe_ran eval_R7_scribe_ran)" \
  --argjson R8 "$(_score_run_step R8_rollup_pr_opened rollup_pr_opened eval_R8_rollup_pr_opened)" \
  '{R1_autonomy_ok: $R1, R2_spec_generated: $R2, R3_spec_reviewer_approved: $R3, R4_tasks_decomposed: $R4, R5_no_circuit_trip: $R5, R6_no_human_gate_pause: $R6, R7_scribe_ran: $R7, R8_rollup_pr_opened: $R8}')
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 4 assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement run-level evaluators R5-R8"
```

---

## Task 8: Implement run-level evaluators R9–R12 (rollup merged, rollup CI, escalations, terminal status)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (add to `run_steps`)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== run-level steps R9-R12 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
R9=$(printf '%s' "$out" | jq -r '.run_steps.R9_rollup_pr_merged.state')
R10=$(printf '%s' "$out" | jq -r '.run_steps.R10_rollup_ci_green.state')
R11=$(printf '%s' "$out" | jq -r '.run_steps.R11_no_escalation_comments.state')
R12=$(printf '%s' "$out" | jq -r '.run_steps.R12_terminal_status_done.state')

assert_eq "R9 rollup_pr_merged skipped_ok"     "skipped_ok"    "$R9"
assert_eq "R10 rollup_ci_green skipped_ok"     "skipped_ok"    "$R10"
assert_eq "R11 no_escalation_comments pass"    "pass"          "$R11"
# outsidey fixture status == interrupted.
assert_eq "R12 terminal_status_done fail"      "fail"          "$R12"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — evaluators not defined.

- [ ] **Step 3: Implement evaluators R9–R12**

Append to `bin/pipeline-score-steps.sh`:

```bash
eval_R9_rollup_pr_merged() {
  local pr; pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
  if [[ -z "$pr" ]]; then echo "skipped_ok"; return; fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local merged
    merged=$(gh pr view "$pr" --json merged -q '.merged' 2>/dev/null || echo "unknown")
    case "$merged" in
      true)  echo "pass" ;;
      false) echo "fail" ;;
      *)     echo "not_performed" ;;
    esac
  else
    # Metric fallback.
    if grep -q "\"event\":\"run.ci\".*\"pr_number\":$pr" "$metrics_file" 2>/dev/null; then
      echo "pass"
    else
      echo "not_performed"
    fi
  fi
}

eval_R10_rollup_ci_green() {
  local pr; pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
  if [[ -z "$pr" ]]; then echo "skipped_ok"; return; fi
  # Prefer metric, fallback gh.
  local ci_status
  ci_status=$(grep "\"event\":\"run.ci\"" "$metrics_file" 2>/dev/null | tail -1 | jq -r '.status // empty')
  if [[ -n "$ci_status" ]]; then
    [[ "$ci_status" == "green" ]] && echo "pass" || echo "fail"
    return
  fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local conclusion
    conclusion=$(gh pr view "$pr" --json statusCheckRollup -q '.statusCheckRollup | map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end' 2>/dev/null || echo "unknown")
    case "$conclusion" in
      green) echo "pass" ;;
      red)   echo "fail" ;;
      *)     echo "not_performed" ;;
    esac
  else
    echo "not_performed"
  fi
}

eval_R11_no_escalation_comments() {
  local matches
  matches=$(grep -cE '"event":"pipeline.comment".*"type":"(ci-escalation|review-escalation|conflict-escalated)"' "$metrics_file" 2>/dev/null || echo 0)
  [[ "$matches" -eq 0 ]] && echo "pass" || echo "fail"
}

eval_R12_terminal_status_done() {
  local s; s=$(printf '%s' "$state" | jq -r '.status')
  [[ "$s" == "done" ]] && echo "pass" || echo "fail"
}
```

- [ ] **Step 4: Wire into pipeline-score**

Extend the `run_steps=$(jq -n ...)` block to include R9–R12 — same pattern as Task 7 Step 4.

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 4 assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement run-level evaluators R9-R12"
```

---

## Task 9: Per-task evaluators T1–T5 (spawn, quality checks, coverage)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (build `task_steps` map)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== per-task steps T1-T5 (aggregate) ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
T1_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T1_executor_spawned.pass')
T2_lint_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T2_lint_pass.pass')
T3_type_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T3_typecheck_pass.pass')
T4_tests_pass=$(printf '%s' "$out" | jq -r '.task_steps_aggregate.T4_tests_pass.pass')

# Exact values depend on fixture; assert >=1 for every step that applies.
[[ "$T1_pass" -ge 1 ]] && { echo "  PASS: T1 has ≥1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T1 pass count = $T1_pass"; fail=$((fail+1)); }
[[ "$T2_lint_pass" -ge 1 ]] && { echo "  PASS: T2 has ≥1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T2 pass count = $T2_lint_pass"; fail=$((fail+1)); }
[[ "$T3_type_pass" -ge 1 ]] && { echo "  PASS: T3 has ≥1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T3 pass count = $T3_type_pass"; fail=$((fail+1)); }
[[ "$T4_tests_pass" -ge 1 ]] && { echo "  PASS: T4 has ≥1 pass"; pass=$((pass+1)); } || { echo "  FAIL: T4 pass count = $T4_tests_pass"; fail=$((fail+1)); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — `.task_steps_aggregate` not populated.

- [ ] **Step 3: Implement per-task evaluators**

Append to `bin/pipeline-score-steps.sh`:

```bash
# Per-task evaluators take the task id via argument; read $state closure.

eval_T1_executor_spawned() {
  local t="$1"
  local wt; wt=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].worktree // empty')
  [[ -n "$wt" ]] && echo "pass" || echo "not_performed"
}

_task_reached_executing() {
  # True if the task ever entered `executing` or later states.
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // "pending"')
  case "$status" in
    pending) return 1 ;;
    *) return 0 ;;
  esac
}

_quality_check_status() {
  local t="$1" cmd="$2"
  printf '%s' "$state" | jq -r --arg t "$t" --arg c "$cmd" \
    '.tasks[$t].quality_gate.checks // [] | map(select(.command == $c)) | .[0].status // empty'
}

_quality_check_step() {
  local t="$1" cmd="$2"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  local s; s=$(_quality_check_status "$t" "$cmd")
  case "$s" in
    passed) echo "pass" ;;
    failed) echo "fail" ;;
    "")     echo "not_performed" ;;
    *)      echo "not_performed" ;;
  esac
}

eval_T2_lint_pass()      { _quality_check_step "$1" lint; }
eval_T3_typecheck_pass() { _quality_check_step "$1" typecheck; }
eval_T4_tests_pass()     { _quality_check_step "$1" test; }

eval_T5_coverage_non_regress() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  if grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"pass\"" "$metrics_file" 2>/dev/null; then
    echo "pass"
  elif grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"fail\"" "$metrics_file" 2>/dev/null; then
    echo "fail"
  else
    echo "not_performed"
  fi
}
```

- [ ] **Step 4: Build task_steps aggregator in pipeline-score**

In `bin/pipeline-score`, replace `task_steps='{}'` with:

```bash
_task_ids() {
  printf '%s' "$state" | jq -r '.tasks // {} | keys[]'
}

_aggregate_step() {
  local id="$1" fn="$2"
  local p=0 f=0 s=0 np=0
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    local r; r=$($fn "$t")
    case "$r" in
      pass)           p=$((p+1)) ;;
      fail)           f=$((f+1)) ;;
      skipped_ok)     s=$((s+1)) ;;
      not_performed)  np=$((np+1)) ;;
    esac
  done < <(_task_ids)
  jq -n --arg id "$id" --argjson p "$p" --argjson f "$f" --argjson s "$s" --argjson np "$np" \
    '{id: $id, pass: $p, fail: $f, skipped_ok: $s, not_performed: $np}'
}

task_steps_aggregate=$(jq -n \
  --argjson T1 "$(_aggregate_step T1_executor_spawned        eval_T1_executor_spawned)" \
  --argjson T2 "$(_aggregate_step T2_lint_pass               eval_T2_lint_pass)" \
  --argjson T3 "$(_aggregate_step T3_typecheck_pass          eval_T3_typecheck_pass)" \
  --argjson T4 "$(_aggregate_step T4_tests_pass              eval_T4_tests_pass)" \
  --argjson T5 "$(_aggregate_step T5_coverage_non_regress    eval_T5_coverage_non_regress)" \
  '{T1_executor_spawned: $T1, T2_lint_pass: $T2, T3_typecheck_pass: $T3, T4_tests_pass: $T4, T5_coverage_non_regress: $T5}')
```

Update the final `jq -n` result construction to emit `task_steps_aggregate` instead of `task_steps` (rename the key). Update the smoke test earlier in `bin/tests/score.sh` if it referenced `.task_steps` — change to `.task_steps_aggregate`.

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all new assertions + no regression on existing ones.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement per-task evaluators T1-T5"
```

---

## Task 10: Per-task evaluators T6–T9 (holdout, mutation, reviewer)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (extend aggregate map)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== per-task steps T6-T9 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T6_holdout_pass T7_mutation_pass T8_reviewer_approved_first_round T9_reviewer_approved_overall; do
  val=$(printf '%s' "$out" | jq -r ".task_steps_aggregate.$k.id // empty")
  assert_eq "$k present in aggregate" "$k" "$val"
done
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — 4 missing keys.

- [ ] **Step 3: Implement evaluators**

Append to `bin/pipeline-score-steps.sh`:

```bash
eval_T6_holdout_pass() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  if [[ ! -f "$run_dir/holdouts/$t.json" ]]; then
    echo "skipped_ok"; return
  fi
  local s; s=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].quality_gates.holdout // empty')
  case "$s" in
    pass)  echo "pass" ;;
    fail)  echo "fail" ;;
    "")    echo "not_performed" ;;
    *)     echo "not_performed" ;;
  esac
}

eval_T7_mutation_pass() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  local risk; risk=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].risk_tier // empty')
  case "$risk" in
    feature|security) ;;
    *) echo "skipped_ok"; return ;;
  esac
  local score; score=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].mutation_score // empty')
  local target; target=$(read_config '.quality.mutationScoreTarget' '80')
  if [[ -z "$score" ]]; then echo "not_performed"; return; fi
  (( $(printf '%.0f' "$score") >= target )) && echo "pass" || echo "fail"
}

eval_T8_reviewer_approved_first_round() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  local attempts status
  attempts=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].review_attempts // 0')
  status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  if [[ "$status" != "done" ]]; then echo "not_performed"; return; fi
  [[ "$attempts" -eq 0 ]] && echo "pass" || echo "fail"
}

eval_T9_reviewer_approved_overall() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  case "$status" in
    done) echo "pass" ;;
    needs_human_review|failed) echo "fail" ;;
    *) echo "not_performed" ;;
  esac
}
```

- [ ] **Step 4: Extend task_steps_aggregate in pipeline-score**

Add the four new evaluators to the `task_steps_aggregate=$(jq -n ...)` block — same pattern as Task 9 Step 4.

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 4 assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement per-task evaluators T6-T9"
```

---

## Task 11: Per-task evaluators T10–T14 (PR, CI, merge, exhaustion, status)

**Files:**

- Modify: `bin/pipeline-score-steps.sh`
- Modify: `bin/pipeline-score` (extend aggregate)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing tests**

Append to `bin/tests/score.sh`:

```bash
echo "=== per-task steps T10-T14 ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
for k in T10_pr_created T11_pr_ci_green T12_pr_merged T13_no_fix_loop_exhaustion T14_terminal_status_done; do
  val=$(printf '%s' "$out" | jq -r ".task_steps_aggregate.$k.id // empty")
  assert_eq "$k present in aggregate" "$k" "$val"
done
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — 5 missing keys.

- [ ] **Step 3: Implement evaluators**

Append to `bin/pipeline-score-steps.sh`:

```bash
eval_T10_pr_created() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  # Only applies once the task reached post-review.
  case "$status" in
    reviewing|done|ci_fixing) ;;
    *) echo "skipped_ok"; return ;;
  esac
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -n "$pr" && "$pr" != "null" ]]; then echo "pass"; else echo "not_performed"; fi
}

eval_T11_pr_ci_green() {
  local t="$1"
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -z "$pr" || "$pr" == "null" ]]; then echo "skipped_ok"; return; fi
  # Prefer task.ci metric.
  local ci
  ci=$(grep "\"event\":\"task.ci\"" "$metrics_file" 2>/dev/null | jq -cr "select(.pr_number == $pr) | .status" | tail -1)
  if [[ -n "$ci" ]]; then
    case "$ci" in
      green) echo "pass" ;;
      red|timeout) echo "fail" ;;
      *) echo "not_performed" ;;
    esac
    return
  fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local conclusion
    conclusion=$(gh pr checks "$pr" --json state,conclusion 2>/dev/null | jq -r 'map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end')
    case "$conclusion" in
      green) echo "pass" ;;
      red) echo "fail" ;;
      *) echo "not_performed" ;;
    esac
  else
    echo "not_performed"
  fi
}

eval_T12_pr_merged() {
  local t="$1"
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -z "$pr" || "$pr" == "null" ]]; then echo "skipped_ok"; return; fi
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  if [[ "$status" != "done" ]]; then echo "fail"; return; fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local merged
    merged=$(gh pr view "$pr" --json merged -q '.merged' 2>/dev/null || echo "unknown")
    [[ "$merged" == "true" ]] && echo "pass" || echo "fail"
  else
    echo "pass"  # state done + --no-gh: trust state
  fi
}

eval_T13_no_fix_loop_exhaustion() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  local qa ra
  qa=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].quality_attempts // 0')
  ra=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].review_attempts // 0')
  if (( qa >= 3 )) || (( ra >= 3 )); then echo "fail"; else echo "pass"; fi
}

eval_T14_terminal_status_done() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  case "$status" in
    done) echo "pass" ;;
    failed|needs_human_review) echo "fail" ;;
    interrupted|pending|executing|reviewing|ci_fixing) echo "not_performed" ;;
    *) echo "not_performed" ;;
  esac
}
```

- [ ] **Step 4: Extend task_steps_aggregate**

Add T10–T14 to the `task_steps_aggregate=$(jq -n ...)` block.

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 5 assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): implement per-task evaluators T10-T14"
```

---

## Task 12: Table renderer + anomaly totals + full_success flag

**Files:**

- Modify: `bin/pipeline-score-steps.sh` (flesh out `_render_table`)
- Modify: `bin/pipeline-score` (compute `anomalies`, `full_success`)
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing test**

Append to `bin/tests/score.sh`:

```bash
echo "=== totals + table render ==="

out=$(pipeline-score --run run-fix-001 --format json --no-gh)
anomalies=$(printf '%s' "$out" | jq -r '.anomalies')
full=$(printf '%s' "$out" | jq -r '.full_success')
[[ "$anomalies" -ge 0 ]] && { echo "  PASS: anomalies present"; pass=$((pass+1)); } || { echo "  FAIL: anomalies missing"; fail=$((fail+1)); }
assert_eq "full_success false on interrupted fixture" "false" "$full"

table=$(pipeline-score --run run-fix-001 --format table --no-gh)
echo "$table" | grep -q 'RUN-LEVEL STEPS' && { echo "  PASS: table renders header"; pass=$((pass+1)); } || { echo "  FAIL: table missing header"; fail=$((fail+1)); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — `.anomalies` and `.full_success` fields missing, table doesn't render.

- [ ] **Step 3: Add anomaly + full_success computation**

In `bin/pipeline-score`, after the aggregate steps are built, compute totals. Replace the final `result=$(jq -n ...)` block with:

```bash
# Sum not_performed across all steps.
anomalies=$(jq -n \
  --argjson rs "$run_steps" \
  --argjson ts "$task_steps_aggregate" \
  '
    def count_run:
      [ .[] | select(.state == "not_performed") ] | length;
    def count_tasks:
      [ .[] | .not_performed ] | add // 0;
    ($rs | count_run) + ($ts | count_tasks)
  ')

# full_success = every run step is pass, every task step has pass > 0 and fail == 0, and not_performed is 0.
full_success=$(jq -n \
  --argjson rs "$run_steps" \
  --argjson ts "$task_steps_aggregate" \
  '
    def all_run_pass:
      [ .[] | select(.state != "pass" and .state != "skipped_ok") ] | length == 0;
    def all_task_clean:
      [ .[] | select(.fail > 0 or .not_performed > 0) ] | length == 0;
    ($rs | all_run_pass) and ($ts | all_task_clean)
  ')

result=$(jq -n \
  --arg run_id "$run_id" \
  --arg plugin_version "$plugin_version" \
  --arg mode "$mode" \
  --arg status "$status" \
  --arg bucket "$bucket" \
  --argjson run_steps "$run_steps" \
  --argjson task_steps_aggregate "$task_steps_aggregate" \
  --argjson anomalies "$anomalies" \
  --argjson full_success "$full_success" \
  '{
    run_id: $run_id,
    plugin_version: $plugin_version,
    mode: $mode,
    status: $status,
    bucket: $bucket,
    run_steps: $run_steps,
    task_steps_aggregate: $task_steps_aggregate,
    anomalies: $anomalies,
    full_success: $full_success
  }')
```

- [ ] **Step 4: Implement `_render_table`**

Replace `_render_table` in `bin/pipeline-score-steps.sh` with:

```bash
_render_table() {
  local json; json=$(cat)
  local run_id version mode status bucket anomalies full
  run_id=$(printf '%s' "$json" | jq -r '.run_id')
  version=$(printf '%s' "$json" | jq -r '.plugin_version')
  mode=$(printf '%s' "$json" | jq -r '.mode')
  status=$(printf '%s' "$json" | jq -r '.status')
  bucket=$(printf '%s' "$json" | jq -r '.bucket')
  anomalies=$(printf '%s' "$json" | jq -r '.anomalies')
  full=$(printf '%s' "$json" | jq -r '.full_success')

  printf "Run: %s   plugin-version: %s   mode: %s   status: %s   bucket: %s\n" \
    "$run_id" "$version" "$mode" "$status" "$bucket"
  printf "\nRUN-LEVEL STEPS\n"
  printf '%s' "$json" | jq -r '.run_steps | to_entries[] | "  \(.value.state | .[0:12] | .+ (" " * (12 - length)))  \(.key)"'
  printf "\nPER-TASK STEPS (aggregate)\n"
  printf "  %-35s  %5s  %5s  %7s  %8s  %s\n" "step" "pass" "fail" "skipped" "not_perf" "compliance"
  printf '%s' "$json" | jq -r '.task_steps_aggregate | to_entries[] |
    .key as $k |
    .value as $v |
    (($v.pass) as $p | ($v.fail) as $f |
      (if ($p + $f) == 0 then "—" else (($p * 100 / ($p + $f)) | floor | tostring + "%") end) as $pct |
      "  \($k | .[0:35] | .+ (" " * (35 - length)))  \($p | tostring | .+ (" " * (5 - length)))  \($f | tostring | .+ (" " * (5 - length)))  \($v.skipped_ok | tostring | .+ (" " * (7 - length)))  \($v.not_performed | tostring | .+ (" " * (8 - length)))  \($pct)")'
  printf "\nANOMALIES: %s step-instances marked not_performed\n" "$anomalies"
  printf "FULL SUCCESS: %s\n" "$full"
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 3 assertions.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): anomaly total + full_success flag + table render"
```

---

## Task 13: Append score record to scores.jsonl

**Files:**

- Modify: `bin/pipeline-score`
- Test: `bin/tests/score.sh`

- [ ] **Step 1: Write failing test**

Append to `bin/tests/score.sh`:

```bash
echo "=== scores.jsonl history append ==="

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
```

Also re-add `assert_file_exists` helper to `bin/tests/score.sh` (copy from `state.sh:34-43`).

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — scores.jsonl not written.

- [ ] **Step 3: Implement history append**

In `bin/pipeline-score`, after the `result=$(jq -n …)` construction and before the `case "$format"` switch, add:

```bash
if [[ "$log_history" == "true" ]]; then
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  history_line=$(printf '%s' "$result" | jq -c --arg ts "$ts" '. + {ts: $ts}')
  history_file="${CLAUDE_PLUGIN_DATA}/scores.jsonl"
  printf '%s\n' "$history_line" >> "$history_file"
fi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS all 3 assertions.

- [ ] **Step 5: Commit**

```bash
git add bin/pipeline-score bin/tests/score.sh
git commit -m "feat(score): append score record to scores.jsonl history log"
```

---

## Task 14: tools/score-run.sh wrapper (interactive picker + filters)

**Files:**

- Create: `tools/score-run.sh`
- Test: `bin/tests/score.sh` (non-interactive path only — interactive mode manually verified)

- [ ] **Step 1: Write failing test for --run passthrough**

Append to `bin/tests/score.sh`:

```bash
echo "=== tools/score-run.sh wrapper ==="

wrapper="$(cd "$(dirname "$0")/../../tools" && pwd)/score-run.sh"
out=$("$wrapper" --run run-fix-001 --format json --no-gh --no-log)
run_id=$(printf '%s' "$out" | jq -r '.run_id')
assert_eq "wrapper passes --run" "run-fix-001" "$run_id"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — wrapper missing.

- [ ] **Step 3: Create tools/score-run.sh**

```bash
#!/usr/bin/env bash
# Dev-only wrapper around pipeline-score. Interactive picker by default.
# Usage:
#   tools/score-run.sh                      # pick from 5 most recent runs
#   tools/score-run.sh --run <run-id>
#   tools/score-run.sh --since <ISO date>
#   tools/score-run.sh --versions v1,v2
#   tools/score-run.sh --format json|table
#   tools/score-run.sh backfill <run-id>
#   tools/score-run.sh history
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$REPO_ROOT/bin:$PATH"

# Resolve CLAUDE_PLUGIN_DATA if unset.
: "${CLAUDE_PLUGIN_DATA:=$HOME/.claude/plugins/data/factory-jfa94}"
export CLAUDE_PLUGIN_DATA

# Subcommand dispatch.
sub="${1:-pick}"
case "$sub" in
  backfill) shift; exec "$REPO_ROOT/tools/score-run-backfill.sh" "$@" ;;
  history)  shift; exec "$REPO_ROOT/tools/score-run-history.sh" "$@" ;;
esac

# Parse flags — if present, go straight to pipeline-score.
for arg in "$@"; do
  if [[ "$arg" == "--run" || "$arg" == "--since" || "$arg" == "--versions" ]]; then
    exec pipeline-score "$@"
  fi
done

# Interactive picker: list 5 most recent runs by started_at.
runs_dir="${CLAUDE_PLUGIN_DATA}/runs"
mapfile -t candidates < <(ls -1t "$runs_dir" 2>/dev/null | grep -v '^current$' | head -5)

if [[ ${#candidates[@]} -eq 0 ]]; then
  echo "No runs found under $runs_dir"
  exit 1
fi

echo "Recent runs:"
for i in "${!candidates[@]}"; do
  r="${candidates[$i]}"
  state_file="$runs_dir/$r/state.json"
  if [[ -f "$state_file" ]]; then
    status=$(jq -r '.status' "$state_file")
    mode=$(jq -r '.mode' "$state_file")
    version=$(jq -r '.version // "?"' "$state_file")
    echo "  [$((i+1))] $r  (v$version, mode=$mode, status=$status)"
  else
    echo "  [$((i+1))] $r  (no state.json)"
  fi
done

read -r -p "Select run [1-${#candidates[@]}]: " sel
if ! [[ "$sel" =~ ^[1-9][0-9]*$ ]] || (( sel < 1 || sel > ${#candidates[@]} )); then
  echo "invalid selection"; exit 1
fi
run_id="${candidates[$((sel-1))]}"

pipeline-score --run "$run_id" --format table
```

Make executable: `chmod +x tools/score-run.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/score-run.sh bin/tests/score.sh
git commit -m "feat(score): tools/score-run.sh wrapper + interactive picker"
```

---

## Task 15: Backfill subcommand (version + PR recovery)

**Files:**

- Create: `tools/score-run-backfill.sh`
- Test: `bin/tests/score.sh` (version-backfill case only; PR backfill requires real gh + is manually verified)

- [ ] **Step 1: Write failing test**

Append to `bin/tests/score.sh`:

```bash
echo "=== backfill version stamping ==="

mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-no-version"
jq -n '{run_id: "run-no-version", status: "done", mode: "prd", started_at: "2026-03-15T10:00:00Z", tasks: {}}' > "$CLAUDE_PLUGIN_DATA/runs/run-no-version/state.json"
touch "$CLAUDE_PLUGIN_DATA/runs/run-no-version/metrics.jsonl"
touch "$CLAUDE_PLUGIN_DATA/runs/run-no-version/audit.jsonl"

"$(cd "$(dirname "$0")/../../tools" && pwd)/score-run.sh" backfill --run run-no-version --assume-version 0.3.2
version=$(jq -r '.version' "$CLAUDE_PLUGIN_DATA/runs/run-no-version/state.json")
assert_eq "backfill stamps version" "0.3.2" "$version"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bin/tests/score.sh`
Expected: FAIL — backfill script missing.

- [ ] **Step 3: Create tools/score-run-backfill.sh**

```bash
#!/usr/bin/env bash
# Backfill missing fields on old runs:
#   - .version (via git log on .claude-plugin/plugin.json or --assume-version)
#   - .final_pr_number / .tasks.*.pr_number (via gh pr list)
#   - Synthetic task.ci / run.ci metric events (via gh pr view)
#
# Usage:
#   tools/score-run-backfill.sh --run <run-id> [--assume-version X.Y.Z] [--repo OWNER/REPO] [--no-gh]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${CLAUDE_PLUGIN_DATA:=$HOME/.claude/plugins/data/factory-jfa94}"

run_id=""
assume_version=""
repo=""
use_gh=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) run_id="$2"; shift 2 ;;
    --assume-version) assume_version="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --no-gh) use_gh=false; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$run_id" ]] && { echo "missing --run" >&2; exit 1; }

run_dir="${CLAUDE_PLUGIN_DATA}/runs/${run_id}"
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || { echo "state.json not found: $state_file" >&2; exit 1; }

# 1. Version backfill.
current_version=$(jq -r '.version // empty' "$state_file")
if [[ -z "$current_version" ]]; then
  resolved="$assume_version"
  if [[ -z "$resolved" ]]; then
    started_at=$(jq -r '.started_at' "$state_file")
    # Find the plugin.json commit active at that timestamp.
    resolved=$(git -C "$REPO_ROOT" log --before="$started_at" -1 --format='%H' -- .claude-plugin/plugin.json 2>/dev/null \
      | xargs -I{} git -C "$REPO_ROOT" show {}:.claude-plugin/plugin.json 2>/dev/null \
      | jq -r '.version // empty')
  fi
  [[ -z "$resolved" ]] && { echo "could not resolve version; pass --assume-version" >&2; exit 1; }
  tmp=$(mktemp)
  jq --arg v "$resolved" '.version = $v' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "Stamped .version = $resolved"
fi

# 2. PR recovery — only if --no-gh is not set.
if [[ "$use_gh" == "true" ]]; then
  # Detect repo from orchestrator.project_root + git remote.
  if [[ -z "$repo" ]]; then
    project_root=$(jq -r '.orchestrator.project_root // empty' "$state_file")
    if [[ -n "$project_root" && -d "$project_root/.git" ]]; then
      repo=$(git -C "$project_root" config --get remote.origin.url 2>/dev/null | sed -E 's#.*[:/]([^/:]+/[^/]+)\.git$#\1#')
    fi
  fi
  if [[ -z "$repo" ]]; then
    echo "warn: could not detect repo; skipping PR backfill" >&2
  else
    # For each task with no pr_number, search for its branch.
    mapfile -t tasks < <(jq -r '.tasks // {} | to_entries[] | select(.value.pr_number == null) | .key' "$state_file")
    for t in "${tasks[@]}"; do
      [[ -z "$t" ]] && continue
      branch="task/$t"
      pr=$(gh pr list --repo "$repo" --state all --head "$branch" --json number -q '.[0].number' 2>/dev/null || echo "")
      if [[ -n "$pr" ]]; then
        tmp=$(mktemp)
        jq --arg t "$t" --argjson pr "$pr" '.tasks[$t].pr_number = $pr' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
        # Emit synthetic task.ci.
        conclusion=$(gh pr view "$pr" --repo "$repo" --json statusCheckRollup -q '.statusCheckRollup | map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end' 2>/dev/null || echo "unknown")
        ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        printf '{"ts":"%s","run_id":"%s","event":"task.ci","pr_number":%s,"status":"%s","backfilled":true}\n' \
          "$ts" "$run_id" "$pr" "$conclusion" >> "$run_dir/metrics.jsonl"
        echo "Backfilled task $t → PR $pr ($conclusion)"
      fi
    done
  fi
fi

echo "Backfill complete."
```

Make executable: `chmod +x tools/score-run-backfill.sh`

- [ ] **Step 4: Run test to verify it passes**

Run: `bin/tests/score.sh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/score-run-backfill.sh bin/tests/score.sh
git commit -m "feat(score): backfill subcommand — version + PR recovery"
```

---

## Task 16: History subcommand + register score suite

**Files:**

- Create: `tools/score-run-history.sh`
- Modify: `bin/test` (register `score` in `SUITES`)

- [ ] **Step 1: Create tools/score-run-history.sh**

```bash
#!/usr/bin/env bash
# Print scores.jsonl as a table, sorted by ts descending.
set -euo pipefail

: "${CLAUDE_PLUGIN_DATA:=$HOME/.claude/plugins/data/factory-jfa94}"
history_file="${CLAUDE_PLUGIN_DATA}/scores.jsonl"

[[ -f "$history_file" ]] || { echo "no history at $history_file"; exit 0; }

printf "%-22s  %-8s  %-24s  %-8s  %-12s  %-9s  %-9s\n" \
  "ts" "version" "run_id" "bucket" "status" "anomalies" "full_ok"
jq -r '. | [.ts, .plugin_version, .run_id, .bucket, .status, (.anomalies|tostring), (.full_success|tostring)] | @tsv' "$history_file" \
  | awk -F'\t' '{ printf "%-22s  %-8s  %-24s  %-8s  %-12s  %-9s  %-9s\n", $1, $2, $3, $4, $5, $6, $7 }' \
  | sort -r
```

Make executable: `chmod +x tools/score-run-history.sh`

- [ ] **Step 2: Register suite in bin/test**

Edit `bin/test`, inside the `SUITES=(...)` array, add `score` after `integration`:

```bash
SUITES=(
  state
  spec-intake
  task-prep
  branching
  cleanup
  hooks
  audit-hooks
  routing
  quota-gate
  run-command
  config
  integration
  score
)
```

- [ ] **Step 3: Run full suite to verify no regressions**

Run: `bin/test`
Expected: all suites PASS, including `score`.

- [ ] **Step 4: Commit**

```bash
git add tools/score-run-history.sh bin/test
git commit -m "feat(score): history subcommand + register score test suite"
```

---

## Task 17: Backfill the two local runs + commit baseline scores

**Files:** No new code. This is a manual verification step plus a history-log commit.

- [ ] **Step 1: Backfill the two existing runs**

```bash
tools/score-run-backfill.sh --run run-20260420-113817 --assume-version 0.3.2 --repo jfa94/outsidey
tools/score-run-backfill.sh --run run-20260420-141621 --assume-version 0.3.2 --repo jfa94/outsidey
```

- [ ] **Step 2: Score both**

```bash
tools/score-run.sh --run run-20260420-113817
tools/score-run.sh --run run-20260420-141621
```

Confirm tables render cleanly and `scores.jsonl` contains two new lines.

- [ ] **Step 3: Copy scores.jsonl to repo as baseline (OPTIONAL — skip if containing sensitive data)**

```bash
cp "$CLAUDE_PLUGIN_DATA/scores.jsonl" docs/superpowers/specs/baselines/2026-04-21-scores.jsonl
git add docs/superpowers/specs/baselines/2026-04-21-scores.jsonl
git commit -m "docs(score): capture 2026-04-21 scoring baseline"
```

(If the file contains anything sensitive after scrubbing, skip this step and note the values in the spec instead.)

---

## Self-Review Checklist

Spec coverage:

- ✅ Step model (pass/fail/skipped_ok/not_performed): implemented via each evaluator's return value; aggregated in Task 12.
- ✅ Run-level steps R1–R12: Tasks 6, 7, 8.
- ✅ Per-task steps T1–T14: Tasks 9, 10, 11.
- ✅ Incompleteness bucket: Task 5 (`bucket` field in skeleton).
- ✅ Plugin changes (version stamp, CI metrics, scribe metric): Tasks 1, 2, 3.
- ✅ Backfill script: Task 15.
- ✅ CLI: Tasks 14 + 16.
- ✅ Output: Task 12 (table), Task 13 (JSONL log).
- ✅ Testing: `bin/tests/score.sh` grows task-by-task with TDD.
- ✅ Rollout: Task 17.

Placeholder scan: no TBD/TODO; every step has code or command.

Type consistency: `_score_run_step`, `_aggregate_step`, `_render_table`, `eval_*` names consistent across tasks. `task_steps_aggregate` key name settled in Task 9 Step 4.

Open items (not blockers, listed as "Open Risks" in spec):

- `audit.jsonl` schema drift tolerance: evaluators use `grep -q` with simple patterns and fall through to `not_performed` rather than crashing — acceptable.
- Scribe metric lag: Task 3 lands the emission, but runs predating Task 3 will show `scribe_ran = not_performed`. This is flagged in the spec.
