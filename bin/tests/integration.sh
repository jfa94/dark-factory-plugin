#!/usr/bin/env bash
# Integration tests — exercise multiple pipeline-* scripts together with only
# external systems (gh, claude, network) mocked. Plan 12 / tasks
# 12_01..12_04. Run: bash bin/tests/integration.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-integration.XXXXXX")"
trap '_cleanup' EXIT INT TERM

_cleanup() {
  rm -rf "$ROOT_TMP"
}

export PATH="$BIN_DIR:$PATH"

passed=0
failed=0
current_scenario=""

assert() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    passed=$((passed + 1))
    printf '  PASS  [%s] %s\n' "$current_scenario" "$desc"
  else
    failed=$((failed + 1))
    printf '  FAIL  [%s] %s\n' "$current_scenario" "$desc"
  fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    passed=$((passed + 1))
    printf '  PASS  [%s] %s\n' "$current_scenario" "$desc"
  else
    failed=$((failed + 1))
    printf '  FAIL  [%s] %s (expected=%q got=%q)\n' \
      "$current_scenario" "$desc" "$expected" "$actual"
  fi
}

new_scenario() {
  current_scenario="$1"
  local data_dir="$ROOT_TMP/$1-data"
  mkdir -p "$data_dir/runs"
  export CLAUDE_PLUGIN_DATA="$data_dir"
  printf '\n## Scenario: %s\n' "$1"
}

# ---------------------------------------------------------------------------
# task_12_01 — spec handoff end-to-end
# Spec generator writes spec.md + tasks.json into a fixture path, records
# .spec.path on state, then pipeline-build-prompt resolves the spec via state
# and embeds its content. validate-tasks succeeds against the generated file.
# ---------------------------------------------------------------------------
test_spec_handoff() {
  new_scenario "spec-handoff"

  local run_id="run-spec-01"
  pipeline-init "$run_id" --issue 7 --mode prd >/dev/null

  # Spec generator output (mocked claude). Writes a real spec dir under data.
  local spec_dir="$CLAUDE_PLUGIN_DATA/runs/$run_id/spec"
  mkdir -p "$spec_dir"
  cat > "$spec_dir/spec.md" <<'SPEC'
# Generated Spec

This document describes the generated work for run-spec-01.
SPEC
  cat > "$spec_dir/tasks.json" <<'TASKS'
[
  {
    "task_id": "T1",
    "title": "First task",
    "description": "do thing one",
    "files": ["src/a.ts"],
    "acceptance_criteria": ["thing one works"],
    "tests_to_write": ["a.test.ts: thing one"],
    "depends_on": []
  },
  {
    "task_id": "T2",
    "title": "Second task",
    "description": "do thing two",
    "files": ["src/b.ts"],
    "acceptance_criteria": ["thing two works"],
    "tests_to_write": ["b.test.ts: thing two"],
    "depends_on": ["T1"]
  }
]
TASKS

  # Orchestrator records spec path on state. Use string form so writer
  # rejects path-injection but accepts the legitimate filesystem path.
  pipeline-state write "$run_id" .spec.path "$spec_dir" >/dev/null
  pipeline-state write "$run_id" .spec.status ready >/dev/null

  # Round-trip: another script reads the path back via state.
  local resolved_path
  resolved_path=$(pipeline-state read "$run_id" .spec.path)
  assert_eq "spec.path round-trips through state" "$spec_dir" "$resolved_path"
  assert "spec.md exists at resolved spec.path" test -f "$resolved_path/spec.md"
  assert "tasks.json exists at resolved spec.path" test -f "$resolved_path/tasks.json"

  # validate-tasks runs against the file at .spec.path/tasks.json.
  local validate_out
  validate_out=$(pipeline-validate-tasks "$resolved_path/tasks.json")
  assert_eq "validate-tasks reports valid=true" "true" "$(printf '%s' "$validate_out" | jq -r '.valid')"
  assert_eq "validate-tasks reports task_count=2" "2" "$(printf '%s' "$validate_out" | jq -r '.task_count')"
  assert_eq "execution_order has T1 first" "T1" \
    "$(printf '%s' "$validate_out" | jq -r '.execution_order[0].task_id')"

  # task-executor prompt construction must surface the spec content. Pass the
  # spec dir explicitly via --spec-path so we don't rely on cwd-symlink magic.
  local task_json prompt
  task_json=$(jq -n '{
    task_id: "T1",
    title: "First task",
    description: "do thing one",
    files: ["src/a.ts"],
    acceptance_criteria: ["thing one works"],
    tests_to_write: ["a.test.ts: thing one"],
    depends_on: []
  }')
  prompt=$(pipeline-build-prompt "$task_json" --spec-path "$spec_dir" 2>/dev/null)
  assert "prompt references task_id T1" bash -c "printf '%s' \"\$1\" | grep -q 'T1'" _ "$prompt"
  assert "prompt embeds spec content" bash -c "printf '%s' \"\$1\" | grep -q 'Generated Spec'" _ "$prompt"
  # build-prompt resolves spec dir through `cd && pwd`, which on macOS rewrites
  # /var/folders/... → /private/var/folders/... — compare against realpath.
  local spec_dir_real
  spec_dir_real=$(cd "$spec_dir" && pwd)
  assert "prompt names spec location" bash -c "printf '%s' \"\$1\" | grep -qF \"\$2\"" _ "$prompt" "$spec_dir_real"
}

# ---------------------------------------------------------------------------
# task_12_02 — resume after interruption
# Multi-task pipeline: T1 done, T2 interrupted, T3 pending. resume-point must
# return T2 (not T3 — T3 has unmet deps). After T2 completes, resume-point
# returns T3. Final state mirrors a clean run.
# ---------------------------------------------------------------------------
test_resume_after_crash() {
  new_scenario "resume-after-crash"

  local run_id="run-resume-02"
  pipeline-init "$run_id" --mode prd >/dev/null

  # Seed a 3-task execution order with the validated topo-sort shape.
  pipeline-state write "$run_id" .execution_order '[
    {"task_id":"T1","parallel_group":0},
    {"task_id":"T2","parallel_group":1},
    {"task_id":"T3","parallel_group":2}
  ]' >/dev/null
  pipeline-state write "$run_id" .tasks '{
    "T1":{"status":"done","depends_on":[]},
    "T2":{"status":"executing","depends_on":["T1"]},
    "T3":{"status":"pending","depends_on":["T2"]}
  }' >/dev/null

  # Simulate crash mid-T2: stop-gate marks task interrupted and run interrupted.
  pipeline-state write "$run_id" .tasks.T2.status interrupted >/dev/null
  pipeline-state write "$run_id" .status interrupted >/dev/null

  assert "run is marked interrupted" pipeline-state interrupted "$run_id"
  assert_eq "T1 status=done after crash" "done" \
    "$(pipeline-state read "$run_id" .tasks.T1.status)"
  assert_eq "T2 status=interrupted after crash" "interrupted" \
    "$(pipeline-state read "$run_id" .tasks.T2.status)"

  local resume
  resume=$(pipeline-state resume-point "$run_id")
  assert_eq "resume-point returns T2 (interrupted task with met deps)" "T2" "$resume"

  # Resume: T2 completes, run continues.
  pipeline-state write "$run_id" .tasks.T2.status done >/dev/null
  pipeline-state write "$run_id" .status running >/dev/null

  resume=$(pipeline-state resume-point "$run_id")
  assert_eq "after T2 done, resume-point is T3" "T3" "$resume"

  # Final clean-run state: all done, no incomplete tasks.
  pipeline-state write "$run_id" .tasks.T3.status done >/dev/null
  set +e
  pipeline-state resume-point "$run_id" >/dev/null 2>&1
  local rc=$?
  set -e
  assert_eq "resume-point exits non-zero when no incomplete tasks remain" "1" "$rc"

  local final_done
  # pipeline-state read enforces an allowlist on the key (task_16_05 / OBS-1),
  # so we fetch full state and pipe through jq for the aggregate query.
  final_done=$(pipeline-state read "$run_id" | jq '[.tasks | to_entries[] | select(.value.status == "done")] | length')
  assert_eq "final state has 3 done tasks" "3" "$final_done"
}

# ---------------------------------------------------------------------------
# task_12_03 — parallel agent spawn
# Two assertions:
#  (a) prompt-build emits N distinct prompts when an orchestrator iterates a
#      parallel group, each carrying its own task_id and content.
#  (b) the underlying spawn primitive (background processes) actually runs
#      concurrently — a 3x parallel sleep finishes in ~one sleep, not 3x.
# Note: a bash test cannot exercise the Claude Code Agent tool directly. OS-
# level parallelism is verified here; full Agent-tool concurrency must still be
# probed inside a real Claude Code session.
# ---------------------------------------------------------------------------
test_parallel_spawn() {
  new_scenario "parallel-spawn"

  local run_id="run-parallel-03"
  pipeline-init "$run_id" --mode prd >/dev/null

  local spec_dir="$CLAUDE_PLUGIN_DATA/runs/$run_id/spec"
  mkdir -p "$spec_dir"
  echo "# Spec for parallel run" > "$spec_dir/spec.md"
  pipeline-state write "$run_id" .spec.path "$spec_dir" >/dev/null

  local p1 p2 p3
  p1=$(pipeline-build-prompt '{
    "task_id":"PT1","title":"alpha","description":"first parallel task",
    "files":["a.ts"],"acceptance_criteria":["a"],"tests_to_write":["t1"],
    "depends_on":[]
  }' --spec-path "$spec_dir" 2>/dev/null)
  p2=$(pipeline-build-prompt '{
    "task_id":"PT2","title":"beta","description":"second parallel task",
    "files":["b.ts"],"acceptance_criteria":["b"],"tests_to_write":["t2"],
    "depends_on":[]
  }' --spec-path "$spec_dir" 2>/dev/null)
  p3=$(pipeline-build-prompt '{
    "task_id":"PT3","title":"gamma","description":"third parallel task",
    "files":["c.ts"],"acceptance_criteria":["c"],"tests_to_write":["t3"],
    "depends_on":[]
  }' --spec-path "$spec_dir" 2>/dev/null)

  assert "prompt 1 mentions PT1" bash -c "printf '%s' \"\$1\" | grep -q 'PT1'" _ "$p1"
  assert "prompt 2 mentions PT2" bash -c "printf '%s' \"\$1\" | grep -q 'PT2'" _ "$p2"
  assert "prompt 3 mentions PT3" bash -c "printf '%s' \"\$1\" | grep -q 'PT3'" _ "$p3"
  assert "prompt 1 differs from prompt 2" test "$p1" != "$p2"
  assert "prompt 2 differs from prompt 3" test "$p2" != "$p3"
  assert "prompt 1 differs from prompt 3" test "$p1" != "$p3"

  # OS-level parallelism check. Spawn three background mocks that each sleep
  # for SLEEP seconds and write a sentinel with start+end timestamps. If they
  # ran sequentially, total wall clock would be ~3*SLEEP; in parallel ~SLEEP.
  local sentinel_dir="$ROOT_TMP/parallel-sentinels"
  mkdir -p "$sentinel_dir"
  local sleep_s=2

  _mock_executor() {
    local id="$1"
    local out="$sentinel_dir/$id.json"
    local started ended
    started=$(date +%s.%N)
    sleep "$sleep_s"
    ended=$(date +%s.%N)
    printf '{"task_id":"%s","started":%s,"ended":%s}\n' "$id" "$started" "$ended" > "$out"
  }
  export -f _mock_executor
  export sleep_s sentinel_dir

  local t0 t1 elapsed_int
  t0=$(date +%s)
  bash -c '_mock_executor PT1' &
  local p_a=$!
  bash -c '_mock_executor PT2' &
  local p_b=$!
  bash -c '_mock_executor PT3' &
  local p_c=$!
  wait "$p_a" "$p_b" "$p_c"
  t1=$(date +%s)
  elapsed_int=$(( t1 - t0 ))

  assert "PT1 sentinel exists" test -f "$sentinel_dir/PT1.json"
  assert "PT2 sentinel exists" test -f "$sentinel_dir/PT2.json"
  assert "PT3 sentinel exists" test -f "$sentinel_dir/PT3.json"

  # 3 * sleep_s = 6s sequential, 1 * sleep_s = 2s parallel. Allow 4s ceiling
  # for filesystem + fork overhead while still failing loudly on a sequential
  # regression.
  if [[ "$elapsed_int" -le 4 ]]; then
    passed=$((passed + 1))
    printf '  PASS  [%s] 3 mock executors finished in %ds (parallel)\n' \
      "$current_scenario" "$elapsed_int"
  else
    failed=$((failed + 1))
    printf '  FAIL  [%s] 3 mock executors took %ds (expected <=4s; sleep=%ds)\n' \
      "$current_scenario" "$elapsed_int" "$sleep_s"
  fi

  # Start-time overlap: every executor's start should be within 1s of the
  # earliest start, i.e. they were dispatched concurrently rather than serialised.
  local min_start max_start spread
  min_start=$(jq -s 'map(.started) | min' "$sentinel_dir"/PT*.json)
  max_start=$(jq -s 'map(.started) | max' "$sentinel_dir"/PT*.json)
  spread=$(awk -v a="$max_start" -v b="$min_start" 'BEGIN { printf "%d", (a - b) }')
  if [[ "$spread" -le 1 ]]; then
    passed=$((passed + 1))
    printf '  PASS  [%s] start-time spread is %ss (within 1s)\n' \
      "$current_scenario" "$spread"
  else
    failed=$((failed + 1))
    printf '  FAIL  [%s] start-time spread is %ss (expected <=1s)\n' \
      "$current_scenario" "$spread"
  fi
}

# ---------------------------------------------------------------------------
# task_12_04 — Statusline wait flow
# Seed usage-cache.json with a 5h-over-threshold value, run pipeline-quota-check,
# then pipeline-model-router. Exercises the full quota-check → router integration
# using the statusline data source.
# ---------------------------------------------------------------------------
test_statusline_wait_flow() {
  new_scenario "statusline-wait-flow"

  # Seed usage-cache.json with utilization 95% and a reset 10 minutes out.
  local now resets_5h_epoch resets_7d_epoch
  now=$(date +%s)
  resets_5h_epoch=$(( now + 600 ))
  resets_7d_epoch=$(( now + 86400 ))

  jq -n \
    --argjson resets_5h "$resets_5h_epoch" \
    --argjson resets_7d "$resets_7d_epoch" \
    --argjson now "$now" \
    '{
      "five_hour": {"used_percentage": 95, "resets_at": $resets_5h},
      "seven_day": {"used_percentage": 10, "resets_at": $resets_7d},
      "captured_at": $now
    }' > "$CLAUDE_PLUGIN_DATA/usage-cache.json"

  local quota
  quota=$(pipeline-quota-check)
  assert_eq "quota detection_method=statusline" "statusline" \
    "$(printf '%s' "$quota" | jq -r '.detection_method')"
  assert_eq "five_hour utilization=95" "95" \
    "$(printf '%s' "$quota" | jq -r '.five_hour.utilization')"
  assert_eq "five_hour over_threshold true" "true" \
    "$(printf '%s' "$quota" | jq -r '.five_hour.over_threshold')"
  assert_eq "seven_day under_threshold" "false" \
    "$(printf '%s' "$quota" | jq -r '.seven_day.over_threshold')"
  assert_eq "resets_at_epoch present" "true" \
    "$(printf '%s' "$quota" | jq -e '.five_hour.resets_at_epoch > 0' >/dev/null 2>&1 && echo true || echo false)"

  # 5h over → router emits action=wait with session-anchored wait_minutes.
  local route_5h_over
  route_5h_over=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
  assert_eq "5h over → action=wait" "wait" \
    "$(printf '%s' "$route_5h_over" | jq -r '.action')"
  assert_eq "5h over → trigger=5h_over" "5h_over" \
    "$(printf '%s' "$route_5h_over" | jq -r '.trigger')"
  assert_eq "wait_minutes positive" "true" \
    "$(printf '%s' "$route_5h_over" | jq -e '.wait_minutes > 0' >/dev/null 2>&1 && echo true || echo false)"

  # 7d over → router emits action=end_gracefully.
  local quota_7d_over
  quota_7d_over=$(printf '%s' "$quota" | jq '.seven_day.over_threshold = true | .seven_day.utilization = 100')
  local route_7d_over
  route_7d_over=$(pipeline-model-router --quota "$quota_7d_over" --tier feature 2>/dev/null)
  assert_eq "7d over → action=end_gracefully" "end_gracefully" \
    "$(printf '%s' "$route_7d_over" | jq -r '.action')"
  assert_eq "7d over → trigger=7d_over" "7d_over" \
    "$(printf '%s' "$route_7d_over" | jq -r '.trigger')"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
test_spec_handoff
test_resume_after_crash
test_parallel_spawn
test_statusline_wait_flow

printf '\n%d passed, %d failed\n' "$passed" "$failed"
exit $(( failed > 0 ? 1 : 0 ))
