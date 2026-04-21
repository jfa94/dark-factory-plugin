#!/usr/bin/env bash
# Step evaluators for pipeline-score. Evaluators read $state (JSON), $run_dir,
# $metrics_file, $audit_file closure variables set by the caller. Each prints
# one of: pass | fail | skipped_ok | not_performed.

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
  printf '%s' "$json" | jq -r '.run_steps | to_entries[] | "  \(.value.state | (. + "            ")[0:12])  \(.key)"'
  printf "\nPER-TASK STEPS (aggregate)\n"
  printf "  %-35s  %5s  %5s  %7s  %8s  %s\n" "step" "pass" "fail" "skipped" "not_perf" "compliance"
  printf '%s' "$json" | jq -r '.task_steps_aggregate | to_entries[] |
    .key as $k |
    .value as $v |
    (($v.pass) as $p | ($v.fail) as $f |
      (if ($p + $f) == 0 then "--" else (($p * 100 / ($p + $f)) | floor | tostring + "%") end) as $pct |
      "  \(($k + (" " * 35))[0:35])  \(($p | tostring) + (" " * (5 - ($p | tostring | length))))  \(($f | tostring) + (" " * (5 - ($f | tostring | length))))  \(($v.skipped_ok | tostring) + (" " * (7 - ($v.skipped_ok | tostring | length))))  \(($v.not_performed | tostring) + (" " * (8 - ($v.not_performed | tostring | length))))  \($pct)")'
  printf "\nANOMALIES: %s step-instances marked not_performed\n" "$anomalies"
  printf "FULL SUCCESS: %s\n" "$full"
  printf "\nOBSERVABILITY\n"
  printf '%s' "$json" | jq -r '
    .observability as $o |
    "  reviewers   codex=\($o.reviewers.codex)  claude=\($o.reviewers.claude)  fallback_from_codex=\($o.reviewers.fallback_from_codex)",
    "  quota       checks=\($o.quota.checks)  waits=\($o.quota.waits)  pause_minutes=\($o.quota.pause_minutes)  first_hour_waits=\($o.quota.first_hour_waits)"
  '
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

eval_T6_holdout_pass() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_ok"; return; fi
  if [[ ! -f "$run_dir/holdouts/$t.json" ]]; then echo "skipped_ok"; return; fi
  local s; s=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].quality_gates.holdout // empty')
  case "$s" in
    pass)  echo "pass" ;;
    fail)  echo "fail" ;;
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
  local score target
  score=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].mutation_score // empty')
  target=$(read_config '.quality.mutationScoreTarget' '80')
  if [[ -z "$score" || "$score" == "null" ]]; then echo "not_performed"; return; fi
  if (( $(printf '%.0f' "$score") >= target )); then echo "pass"; else echo "fail"; fi
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

eval_T10_pr_created() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
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
  local ci=""
  if [[ -f "$metrics_file" ]]; then
    ci=$(grep "\"event\":\"task.ci\"" "$metrics_file" 2>/dev/null | jq -cr "select(.pr_number == $pr) | .status" 2>/dev/null | tail -1)
  fi
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
    conclusion=$(gh pr checks "$pr" --json state,conclusion 2>/dev/null | jq -r 'map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end' 2>/dev/null || echo "unknown")
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
    echo "pass"
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
    *) echo "not_performed" ;;
  esac
}

_observability_json() {
  # Emits the observability block for the current $metrics_file.
  # Note: `grep -c` exits 1 with output `0` when no matches; the `|| echo 0`
  # fallback would then append an extra line, breaking --argjson. Always
  # collapse to a single integer via `| head -1`.
  local codex_n claude_n fallback_n
  codex_n=0; claude_n=0; fallback_n=0
  if [[ -f "$metrics_file" ]]; then
    codex_n=$({ grep -c '"event":"task.review.provider".*"reviewer":"codex"' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
    claude_n=$({ grep -c '"event":"task.review.provider".*"reviewer":"claude"' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
    fallback_n=$({ grep -c '"event":"task.review.provider".*"reason":"fallback"' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
  fi

  local quota_checks quota_waits pause_minutes
  quota_checks=0; quota_waits=0; pause_minutes=0
  if [[ -f "$metrics_file" ]]; then
    quota_checks=$({ grep -c '"event":"quota.check"' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
    quota_waits=$({ grep -c '"event":"quota.wait"' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
    pause_minutes=$({ grep '"event":"quota.wait"' "$metrics_file" 2>/dev/null \
      | jq -s 'map(.minutes_slept // 0) | add // 0' 2>/dev/null || echo 0; } | head -1)
  fi

  # First-hour quota activity: events within 60m of run start.
  local started_at first_hour_waits
  started_at=$(printf '%s' "$state" | jq -r '.started_at // empty')
  first_hour_waits=0
  if [[ -n "$started_at" && -f "$metrics_file" ]]; then
    first_hour_waits=$({ jq -s --arg start "$started_at" '
      def parse_ts($s):
        ($s | sub("\\..*Z$"; "Z")) as $norm |
        try ($norm | fromdateiso8601) catch null;
      (parse_ts($start)) as $start_ep |
      if $start_ep == null then 0
      else
        [ .[] | select(.event == "quota.wait")
              | (parse_ts(.ts // "")) as $ep
              | select($ep != null and $ep <= $start_ep + 3600) ]
        | length
      end' "$metrics_file" 2>/dev/null || echo 0; } | head -1)
  fi

  jq -n \
    --argjson codex "$codex_n" \
    --argjson claude "$claude_n" \
    --argjson fb "$fallback_n" \
    --argjson checks "$quota_checks" \
    --argjson waits "$quota_waits" \
    --argjson pause "$pause_minutes" \
    --argjson fhw "$first_hour_waits" \
    '{
      reviewers: {codex: $codex, claude: $claude, fallback_from_codex: $fb},
      quota: {checks: $checks, waits: $waits, pause_minutes: $pause, first_hour_waits: $fhw}
    }'
}
