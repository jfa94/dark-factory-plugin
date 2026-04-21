#!/usr/bin/env bash
# Step evaluators for pipeline-score. Evaluators read $state (JSON), $run_dir,
# $metrics_file, $audit_file closure variables set by the caller. Each prints
# one of: pass | fail | skipped_ok | not_performed.

_render_table() {
  # Minimal passthrough — enhanced in Task 12.
  cat
}

eval_R1_autonomy_ok() {
  if [[ -f "$audit_file" ]] && grep -q '"event":"init.error"' "$audit_file" 2>/dev/null; then
    echo "fail"
  else
    echo "pass"
  fi
}

eval_R2_spec_generated() {
  local mode spec_path spec_committed
  mode=$(printf '%s' "$state" | jq -r '.mode')
  if [[ "$mode" == "task" ]]; then echo "skipped_ok"; return; fi
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
  if [[ -z "$score" || "$score" == "null" ]]; then echo "not_performed"; return; fi
  if (( $(printf '%.0f' "$score") >= 54 )); then echo "pass"; else echo "fail"; fi
}

eval_R4_tasks_decomposed() {
  local count
  count=$(printf '%s' "$state" | jq '.execution_order // [] | length')
  if [[ "$count" -ge 1 ]]; then echo "pass"; else echo "not_performed"; fi
}

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
  if ! _all_tasks_done; then echo "skipped_ok"; return; fi
  if [[ -f "$metrics_file" ]] && grep -q '"event":"agent.scribe.end"' "$metrics_file" 2>/dev/null; then
    echo "pass"
  else
    echo "not_performed"
  fi
}

eval_R8_rollup_pr_opened() {
  if ! _all_tasks_done; then echo "skipped_ok"; return; fi
  local pr; pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
  if [[ -n "$pr" ]]; then echo "pass"; else echo "not_performed"; fi
}

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
    if [[ -f "$metrics_file" ]] && grep -q "\"event\":\"run.ci\".*\"pr_number\":$pr" "$metrics_file" 2>/dev/null; then
      echo "pass"
    else
      echo "not_performed"
    fi
  fi
}

eval_R10_rollup_ci_green() {
  local pr; pr=$(printf '%s' "$state" | jq -r '.final_pr_number // empty')
  if [[ -z "$pr" ]]; then echo "skipped_ok"; return; fi
  local ci_status=""
  if [[ -f "$metrics_file" ]]; then
    ci_status=$(grep "\"event\":\"run.ci\"" "$metrics_file" 2>/dev/null | tail -1 | jq -r '.status // empty')
  fi
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
  local matches=0
  if [[ -f "$metrics_file" ]]; then
    matches=$(grep -cE '"event":"pipeline.comment".*"type":"(ci-escalation|review-escalation|conflict-escalated)"' "$metrics_file" 2>/dev/null) || matches=0
  fi
  [[ "$matches" -eq 0 ]] && echo "pass" || echo "fail"
}

eval_R12_terminal_status_done() {
  local s; s=$(printf '%s' "$state" | jq -r '.status')
  [[ "$s" == "done" ]] && echo "pass" || echo "fail"
}

_task_reached_executing() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // "pending"')
  [[ "$status" != "pending" ]]
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
    *)      echo "not_performed" ;;
  esac
}

eval_T1_executor_spawned() {
  local t="$1"
  local wt; wt=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].worktree // empty')
  [[ -n "$wt" && "$wt" != "null" ]] && echo "pass" || echo "not_performed"
}

eval_T2_lint_pass()      { _quality_check_step "$1" lint; }
eval_T3_typecheck_pass() { _quality_check_step "$1" typecheck; }
eval_T4_tests_pass()     { _quality_check_step "$1" test; }

eval_T5_coverage_non_regress() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  if [[ -f "$metrics_file" ]] && grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"pass\"" "$metrics_file" 2>/dev/null; then
    echo "pass"
  elif [[ -f "$metrics_file" ]] && grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"fail\"" "$metrics_file" 2>/dev/null; then
    echo "fail"
  else
    echo "not_performed"
  fi
}
