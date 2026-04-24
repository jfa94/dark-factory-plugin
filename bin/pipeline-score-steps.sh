#!/usr/bin/env bash
# Step evaluators for pipeline-score. Evaluators read $state (JSON), $run_dir,
# $metrics_file, $audit_file closure variables set by the caller. Each prints
# one of: pass | fail | skipped_na | skipped_task_inactive | not_performed.

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

  local started_at ended_at
  started_at=$(printf '%s' "$json" | jq -r '.started_at // empty')
  ended_at=$(printf '%s'   "$json" | jq -r '.ended_at // empty')

  local duration="—"
  if [[ -n "$started_at" && -n "$ended_at" ]]; then
    local s e delta h m sec
    s=$(parse_iso8601_to_epoch "$started_at" 2>/dev/null || echo "")
    e=$(parse_iso8601_to_epoch "$ended_at"   2>/dev/null || echo "")
    if [[ "$s" =~ ^[0-9]+$ && "$e" =~ ^[0-9]+$ && "$e" -ge "$s" ]]; then
      delta=$((e - s))
      h=$((delta / 3600))
      m=$(( (delta % 3600) / 60 ))
      sec=$((delta % 60))
      duration=$(printf '%d:%02d:%02d' "$h" "$m" "$sec")
    fi
  fi

  printf "Run: %s   plugin-version: %s   mode: %s   status: %s   bucket: %s\n" \
    "$run_id" "$version" "$mode" "$status" "$bucket"
  printf "Started: %s   Ended: %s   Duration: %s\n" \
    "${started_at:-—}" "${ended_at:-—}" "$duration"
  printf "\nRUN-LEVEL STEPS\n"
  printf '%s' "$json" | jq -r '.run_steps | to_entries[] | "  \(.value.state | (. + "                      ")[0:22])  \(.key)"'
  printf "\nPER-TASK STEPS (aggregate)\n"
  printf "  %-35s  %5s  %5s  %7s  %10s  %8s  %s\n" \
    "step" "pass" "fail" "skip_na" "skip_inact" "not_perf" "compliance"
  printf '%s' "$json" | jq -r '.task_steps_aggregate | to_entries[] |
    .key as $k |
    .value as $v |
    (($v.pass) as $p | ($v.fail) as $f |
     ($v.not_performed) as $np | ($v.skipped_task_inactive) as $sti |
     ($p + $f + $np + $sti) as $denom |
     (if $denom == 0 then "--" else (($p * 100 / $denom) | floor | tostring + "%") end) as $pct |
     "  \(($k + (" " * 35))[0:35])  \(($p | tostring) + (" " * (5 - ($p | tostring | length))))  \(($f | tostring) + (" " * (5 - ($f | tostring | length))))  \(($v.skipped_na | tostring) + (" " * (7 - ($v.skipped_na | tostring | length))))  \(($sti | tostring) + (" " * (10 - ($sti | tostring | length))))  \(($np | tostring) + (" " * (8 - ($np | tostring | length))))  \($pct)")'
  printf "\nANOMALIES: %s step-instances marked not_performed\n" "$anomalies"
  printf "FULL SUCCESS: %s\n" "$full"
  printf "\nOBSERVABILITY\n"
  printf '%s' "$json" | jq -r '
    .observability as $o |
    "  reviewers   codex=\($o.reviewers.codex)  claude=\($o.reviewers.claude)  fallback_from_codex=\($o.reviewers.fallback_from_codex)",
    "  quota       checks=\($o.quota.checks)  waits=\($o.quota.waits)  pause_minutes=\($o.quota.pause_minutes)  first_hour_waits=\($o.quota.first_hour_waits)"
  '
}

_gh_pr_ci_color() {
  local pr="$1" repo_arg="" payload
  if [[ -n "${2:-}" ]]; then repo_arg="--repo $2"; fi
  if [[ -n "${_FAKE_PR_VIEW:-}" ]]; then
    payload="$_FAKE_PR_VIEW"
  else
    payload=$(gh pr view "$pr" $repo_arg --json statusCheckRollup 2>/dev/null) || {
      echo "unknown"; return
    }
  fi
  printf '%s' "$payload" | jq -r '
    # Classify one rollup entry into pass | fail | pending | unknown.
    def classify:
      (.status // "" | ascii_upcase) as $st |
      (.state  // "" | ascii_upcase) as $se |
      (.conclusion // "" | ascii_upcase) as $c |
      if ($st == "QUEUED" or $st == "IN_PROGRESS" or $st == "WAITING" or $st == "PENDING"
          or $se == "PENDING" or $se == "EXPECTED"
          or ($st == "COMPLETED" and $c == "")) then "pending"
      else
        (if $c != "" then $c else $se end) as $o |
        if ["SUCCESS","SKIPPED","NEUTRAL"] | index($o) then "pass"
        elif ["FAILURE","TIMED_OUT","CANCELLED","STARTUP_FAILURE","ACTION_REQUIRED","ERROR"] | index($o) then "fail"
        else "unknown"
        end
      end;
    (.statusCheckRollup // []) as $r |
    if ($r | length) == 0 then "unknown"
    else
      ($r | map(classify)) as $cls |
      if   ($cls | any(. == "fail"))    then "red"
      elif ($cls | any(. == "pending")) then "pending"
      elif ($cls | all(. == "pass"))    then "green"
      else "unknown"
      end
    end'
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
  if [[ "$mode" == "task" ]]; then echo "skipped_na"; return; fi
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
  [[ "$mode" == "task" ]] && { echo "skipped_na"; return; }
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
  if ! _all_tasks_done; then echo "skipped_na"; return; fi
  local scribe_state; scribe_state=$(printf '%s' "$state" | jq -r '.scribe.status // empty')
  if [[ "$scribe_state" == "done" ]]; then echo "pass"; return; fi
  if [[ -f "$metrics_file" ]] && grep -q '"event":"agent.scribe.end"' "$metrics_file" 2>/dev/null; then
    echo "pass"
  else
    echo "not_performed"
  fi
}

eval_R8_final_pr_opened() {
  if ! _all_tasks_done; then echo "skipped_na"; return; fi
  local pr; pr=$(printf '%s' "$state" | jq -r '(.final_pr.pr_number // .rollup.pr_number // .final_pr_number) // empty')
  if [[ -n "$pr" ]]; then echo "pass"; else echo "not_performed"; fi
}

eval_R9_final_pr_merged() {
  local pr; pr=$(printf '%s' "$state" | jq -r '(.final_pr.pr_number // .rollup.pr_number // .final_pr_number) // empty')
  if [[ -z "$pr" ]]; then echo "skipped_na"; return; fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local pr_state _repo_arg=()
    [[ -n "${gh_repo:-}" ]] && _repo_arg=(--repo "$gh_repo")
    pr_state=$(gh pr view "$pr" "${_repo_arg[@]}" --json state -q '.state' 2>/dev/null || echo "unknown")
    case "$pr_state" in
      MERGED) echo "pass" ;;
      OPEN)   echo "fail" ;;
      *)      echo "not_performed" ;;
    esac
  else
    if [[ -f "$metrics_file" ]] && grep -q "\"event\":\"run.ci\".*\"pr_number\":$pr" "$metrics_file" 2>/dev/null; then
      echo "pass"
    else
      echo "not_performed"
    fi
  fi
}

eval_R10_final_pr_ci_green() {
  local pr; pr=$(printf '%s' "$state" | jq -r '(.final_pr.pr_number // .rollup.pr_number // .final_pr_number) // empty')
  if [[ -z "$pr" ]]; then echo "skipped_na"; return; fi
  local ci_status=""
  if [[ -f "$metrics_file" ]]; then
    ci_status=$(grep "\"event\":\"run.ci\"" "$metrics_file" 2>/dev/null | tail -1 | jq -r '.status // empty')
  fi
  if [[ -n "$ci_status" ]]; then
    [[ "$ci_status" == "green" ]] && echo "pass" || echo "fail"
    return
  fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local color
    color=$(_gh_pr_ci_color "$pr" "${gh_repo:-}")
    case "$color" in
      green)   echo "pass" ;;
      red)     echo "fail" ;;
      pending) echo "not_performed" ;;
      *)       echo "not_performed" ;;
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
  [[ "$s" == "done" ]] && echo "pass" && return
  # Heuristic: orchestrator may exit before flushing status=done.
  # Infer done when all tasks terminal, scribe done, and final PR exists.
  if [[ "$s" == "running" ]] && _all_tasks_done; then
    local scribe_s final_pr
    scribe_s=$(printf '%s' "$state" | jq -r '.scribe.status // empty')
    final_pr=$(printf '%s' "$state" | jq -r '(.final_pr.pr_number // .rollup.pr_number // .final_pr_number) // empty')
    if [[ "$scribe_s" == "done" && -n "$final_pr" ]]; then
      echo "pass"; return
    fi
  fi
  echo "fail"
}

_task_reached_executing() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // "pending"')
  [[ "$status" != "pending" ]]
}

_quality_check_status() {
  local t="$1" cmd="$2"
  printf '%s' "$state" | jq -r --arg t "$t" --arg c "$cmd" \
    '.tasks[$t].quality_gate.checks // [] | map(select(.command == $c or (.command | startswith($c + ":")))) | .[0].status // empty'
}

_quality_check_step() {
  local t="$1" cmd="$2"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local s; s=$(_quality_check_status "$t" "$cmd")
  case "$s" in
    passed) echo "pass" ;;
    failed) echo "fail" ;;
    *)      echo "not_performed" ;;
  esac
}

eval_T1_quota_checked() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  [[ -f "$metrics_file" ]] || { echo "fail"; return; }
  local start_ts check_ts
  start_ts=$(grep '"event":"task.start"' "$metrics_file" 2>/dev/null \
    | jq -cr --arg t "$t" 'select(.task_id == $t) | .ts' | head -1)
  check_ts=$(grep '"event":"quota.check"' "$metrics_file" 2>/dev/null \
    | jq -cr --arg t "$t" 'select(.task_id == $t) | .ts' | head -1)
  if [[ -n "$check_ts" && ( -z "$start_ts" || "$check_ts" < "$start_ts" || "$check_ts" == "$start_ts" ) ]]; then
    echo "pass"
  else
    echo "fail"
  fi
}

eval_T2_executor_spawned() {
  local t="$1"
  local wt; wt=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].worktree // empty')
  [[ -n "$wt" && "$wt" != "null" ]] && echo "pass" || echo "not_performed"
}

eval_T3_lint_pass()      { _quality_check_step "$1" lint; }
eval_T4_typecheck_pass() { _quality_check_step "$1" typecheck; }
eval_T5_tests_pass()     { _quality_check_step "$1" test; }

eval_T6_coverage_non_regress() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  if [[ -f "$metrics_file" ]] && grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"pass\"" "$metrics_file" 2>/dev/null; then
    echo "pass"
  elif [[ -f "$metrics_file" ]] && grep -q "\"event\":\"task.gate.coverage\".*\"task_id\":\"$t\".*\"status\":\"fail\"" "$metrics_file" 2>/dev/null; then
    echo "fail"
  else
    echo "not_performed"
  fi
}

eval_T7_holdout_pass() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  if [[ ! -f "$run_dir/holdouts/$t.json" ]]; then echo "skipped_na"; return; fi
  local s; s=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].quality_gates.holdout // empty')
  case "$s" in
    pass)    echo "pass" ;;
    fail)    echo "fail" ;;
    skipped) echo "skipped_na" ;;
    *)       echo "not_performed" ;;
  esac
}

eval_T8_mutation_pass() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local risk; risk=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].risk_tier // empty')
  case "$risk" in
    feature|security) ;;
    *) echo "skipped_na"; return ;;
  esac
  local score target
  score=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].mutation_score // empty')
  target=$(read_config '.quality.mutationScoreTarget' '80')
  if [[ -z "$score" || "$score" == "null" ]]; then echo "not_performed"; return; fi
  if (( $(printf '%.0f' "$score") >= target )); then echo "pass"; else echo "fail"; fi
}

eval_T9_reviewer_approved_first_round() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local attempts status
  attempts=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].review_attempts // 0')
  status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  if [[ "$status" != "done" ]]; then echo "not_performed"; return; fi
  [[ "$attempts" -eq 0 ]] && echo "pass" || echo "fail"
}

eval_T10_reviewer_approved_overall() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  case "$status" in
    done) echo "pass" ;;
    needs_human_review|failed) echo "fail" ;;
    *) echo "not_performed" ;;
  esac
}

eval_T11_pr_created() {
  local t="$1"
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  case "$status" in
    reviewing|done|ci_fixing) ;;
    *) echo "skipped_na"; return ;;
  esac
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -n "$pr" && "$pr" != "null" ]]; then echo "pass"; else echo "not_performed"; fi
}

eval_T12_pr_ci_green() {
  local t="$1"
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -z "$pr" || "$pr" == "null" ]]; then echo "skipped_na"; return; fi
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
    local color
    color=$(_gh_pr_ci_color "$pr" "${gh_repo:-}")
    case "$color" in
      green)   echo "pass" ;;
      red)     echo "fail" ;;
      pending) echo "not_performed" ;;
      *)       echo "not_performed" ;;
    esac
  else
    echo "not_performed"
  fi
}

eval_T13_pr_merged() {
  local t="$1"
  local pr; pr=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].pr_number // empty')
  if [[ -z "$pr" || "$pr" == "null" ]]; then echo "skipped_na"; return; fi
  local status; status=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].status // empty')
  if [[ "$status" != "done" ]]; then echo "fail"; return; fi
  if [[ "${use_gh:-true}" == "true" ]]; then
    local pr_state _repo_arg=()
    [[ -n "${gh_repo:-}" ]] && _repo_arg=(--repo "$gh_repo")
    pr_state=$(gh pr view "$pr" "${_repo_arg[@]}" --json state -q '.state' 2>/dev/null || echo "unknown")
    case "$pr_state" in
      MERGED)  echo "pass" ;;
      OPEN)    echo "fail" ;;
      CLOSED)  echo "fail" ;;
      *)       echo "fail" ;;
    esac
  else
    echo "pass"
  fi
}

eval_T14_within_retry_budget() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local qa ra
  qa=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].quality_attempts // 0')
  ra=$(printf '%s' "$state" | jq -r --arg t "$t" '.tasks[$t].review_attempts // 0')
  if (( qa >= 3 )) || (( ra >= 3 )); then echo "fail"; else echo "pass"; fi
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
