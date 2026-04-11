#!/usr/bin/env bash
# Integration tests — exercise multiple pipeline-* scripts together with only
# external systems (gh, claude, ollama, network) mocked. Plan 12 / tasks
# 12_01..12_04. Run: bash bin/test-integration.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-integration.XXXXXX")"
trap '_cleanup' EXIT INT TERM

OLLAMA_PID=""

_cleanup() {
  if [[ -n "$OLLAMA_PID" ]] && kill -0 "$OLLAMA_PID" 2>/dev/null; then
    kill "$OLLAMA_PID" 2>/dev/null || true
    wait "$OLLAMA_PID" 2>/dev/null || true
  fi
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
  final_done=$(pipeline-state read "$run_id" '.tasks | to_entries | map(select(.value.status == "done")) | length')
  assert_eq "final state has 3 done tasks" "3" "$final_done"
}

# ---------------------------------------------------------------------------
# task_12_03 — parallel agent spawn
# Two assertions:
#  (a) prompt-build emits N distinct prompts when an orchestrator iterates a
#      parallel group, each carrying its own task_id and content.
#  (b) the underlying spawn primitive (background processes) actually runs
#      concurrently — a 3x parallel sleep finishes in ~one sleep, not 3x.
# Note: a bash test cannot exercise the Claude Code Agent tool directly.
# Open Question #2 from 05-decisions.md is partially answered: the OS-level
# parallelism is verified; full Agent-tool concurrency must still be probed
# inside a real Claude Code session.
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
# task_12_04 — Ollama fallback flow
# Seed last-headers.json with a 5h-over-threshold value, run pipeline-quota-check,
# then pipeline-model-router. Cover three branches:
#  1. Ollama disabled → router emits action=wait.
#  2. Ollama enabled but unreachable → router emits action=wait.
#  3. Ollama enabled and reachable (mock python http server) → router emits
#     provider=ollama with base_url and review_cap.
# ---------------------------------------------------------------------------
test_ollama_fallback() {
  new_scenario "ollama-fallback"

  # Seed last-headers.json with utilization 0.95 and a 10-minute reset.
  local now reset_5h reset_7d
  now=$(date +%s)
  reset_5h=$(date -u -r $((now + 600)) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -d "@$((now + 600))" +%Y-%m-%dT%H:%M:%SZ)
  reset_7d=$(date -u -r $((now + 86400)) +%Y-%m-%dT%H:%M:%SZ 2>/dev/null \
    || date -u -d "@$((now + 86400))" +%Y-%m-%dT%H:%M:%SZ)

  jq -n \
    --arg reset_5h "$reset_5h" \
    --arg reset_7d "$reset_7d" \
    '{
      "anthropic-ratelimit-unified-5h-utilization": 0.95,
      "anthropic-ratelimit-unified-5h-reset": $reset_5h,
      "anthropic-ratelimit-unified-7d-utilization": 0.10,
      "anthropic-ratelimit-unified-7d-reset": $reset_7d,
      "is_using_overage": "false"
    }' > "$CLAUDE_PLUGIN_DATA/last-headers.json"

  local quota
  quota=$(pipeline-quota-check)
  assert_eq "quota detection_method=headers" "headers" \
    "$(printf '%s' "$quota" | jq -r '.detection_method')"
  assert_eq "five_hour utilization parsed to 95" "95" \
    "$(printf '%s' "$quota" | jq -r '.five_hour.utilization')"
  assert_eq "five_hour over_threshold true" "true" \
    "$(printf '%s' "$quota" | jq -r '.five_hour.over_threshold')"
  assert_eq "seven_day under_threshold" "false" \
    "$(printf '%s' "$quota" | jq -r '.seven_day.over_threshold')"

  # --- Branch 1: Ollama disabled → router waits.
  cat > "$CLAUDE_PLUGIN_DATA/config.json" <<'CFG'
{
  "localLlm": { "enabled": false },
  "review": {
    "routineRounds": 2,
    "featureRounds": 4,
    "securityRounds": 6
  }
}
CFG

  local route_disabled
  route_disabled=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
  assert_eq "ollama disabled → action=wait" "wait" \
    "$(printf '%s' "$route_disabled" | jq -r '.action')"
  assert_eq "ollama disabled → trigger=5h_over_no_ollama" "5h_over_no_ollama" \
    "$(printf '%s' "$route_disabled" | jq -r '.trigger')"

  # --- Branch 2: Ollama enabled but pointed at an unreachable port.
  cat > "$CLAUDE_PLUGIN_DATA/config.json" <<'CFG'
{
  "localLlm": {
    "enabled": true,
    "ollamaUrl": "http://127.0.0.1:1",
    "model": "qwen2.5-coder:14b"
  },
  "review": {
    "routineRounds": 2,
    "ollamaRoutineRounds": 15
  }
}
CFG

  local route_unreachable
  route_unreachable=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
  assert_eq "ollama unreachable → action=wait" "wait" \
    "$(printf '%s' "$route_unreachable" | jq -r '.action')"

  # --- Branch 3: Ollama enabled and reachable via mock HTTP server.
  if ! command -v python3 >/dev/null 2>&1; then
    printf '  SKIP  [%s] python3 not available — skipping reachable-ollama branch\n' \
      "$current_scenario"
    return 0
  fi

  local ollama_port=18434
  local server_script="$ROOT_TMP/mock-ollama.py"
  cat > "$server_script" <<'PY'
import http.server, json, sys
port = int(sys.argv[1])
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/tags':
            body = json.dumps({"models":[{"name":"qwen2.5-coder:14b"}]}).encode()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.send_header('Content-Length',str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a, **kw): pass
http.server.HTTPServer(('127.0.0.1', port), H).serve_forever()
PY
  python3 "$server_script" "$ollama_port" >/dev/null 2>&1 &
  OLLAMA_PID=$!

  # Wait for the mock server to come up (max ~3s).
  local up=0 i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf --connect-timeout 1 "http://127.0.0.1:$ollama_port/api/tags" >/dev/null 2>&1; then
      up=1; break
    fi
    sleep 0.3
  done
  if [[ "$up" -ne 1 ]]; then
    failed=$((failed + 1))
    printf '  FAIL  [%s] mock ollama server did not come up\n' "$current_scenario"
    return 0
  fi

  cat > "$CLAUDE_PLUGIN_DATA/config.json" <<CFG
{
  "localLlm": {
    "enabled": true,
    "ollamaUrl": "http://127.0.0.1:$ollama_port",
    "model": "qwen2.5-coder:14b"
  },
  "review": {
    "routineRounds": 2,
    "ollamaRoutineRounds": 15
  }
}
CFG

  local route_ollama
  route_ollama=$(pipeline-model-router --quota "$quota" --tier routine 2>/dev/null)
  assert_eq "ollama reachable → provider=ollama" "ollama" \
    "$(printf '%s' "$route_ollama" | jq -r '.provider')"
  assert_eq "ollama reachable → model echoed" "qwen2.5-coder:14b" \
    "$(printf '%s' "$route_ollama" | jq -r '.model')"
  assert_eq "ollama reachable → base_url echoed" "http://127.0.0.1:$ollama_port" \
    "$(printf '%s' "$route_ollama" | jq -r '.base_url')"
  assert_eq "ollama reachable → review_cap elevated" "15" \
    "$(printf '%s' "$route_ollama" | jq -r '.review_cap')"
  assert_eq "ollama reachable → trigger=rate_limit_fallback" "rate_limit_fallback" \
    "$(printf '%s' "$route_ollama" | jq -r '.trigger')"

  # Verify mock /api/tags advertises the configured model (sanity check).
  local tags_body
  tags_body=$(curl -sf "http://127.0.0.1:$ollama_port/api/tags")
  assert_eq "mock /api/tags advertises configured model" "qwen2.5-coder:14b" \
    "$(printf '%s' "$tags_body" | jq -r '.models[0].name')"

  kill "$OLLAMA_PID" 2>/dev/null || true
  wait "$OLLAMA_PID" 2>/dev/null || true
  OLLAMA_PID=""
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
test_spec_handoff
test_resume_after_crash
test_parallel_spawn
test_ollama_fallback

printf '\n%d passed, %d failed\n' "$passed" "$failed"
exit $(( failed > 0 ? 1 : 0 ))
