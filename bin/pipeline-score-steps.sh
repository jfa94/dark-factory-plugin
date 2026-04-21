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
