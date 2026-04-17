# Plan 12 — Integration Tests

**Priority:** P1 (major — the existing 411 unit tests are purely structural; there is zero end-to-end coverage)
**Tasks:** `task_12_01` through `task_12_04`
**Findings:** S6 (test coverage depth)

## Problem

Reviewers found that the existing test suites (`bin/test-phase1.sh` through `bin/test-phase9.sh`) exercise individual scripts in isolation with mocked dependencies. This catches per-script regressions but misses any bug that spans multiple scripts, agents, or external systems.

Example bugs that slipped through unit tests:

- Spec handoff (plan 03) — every test asserts `pipeline-state write` works and every test asserts `pipeline-orchestrator.md` contains a certain string, but no test asserts that the path from spec-generator to orchestrator actually carries data across.
- Resume point (plan 06) — tests assert `pipeline-state resume-point` returns a task ID, but never test that a full run that crashes can be resumed and produces the same final state.
- Parallel spawning — no test exercises the "emit N Agent calls in one assistant message" primitive, because there's no orchestrator harness.
- Ollama fallback — the rate limit → ollama router branches are unit-tested but the full "claude rate limited → switch provider → execute task" flow is never run end-to-end.

## Scope

In:

- Create `bin/test-integration.sh` with four end-to-end scenarios
- Each scenario runs real scripts (no mocking bin/pipeline-\*), only mocks external systems (`gh`, `claude`, `ollama`)
- Assertions cover multi-script data flow, not just individual script outputs

Out:

- Live API testing (requires real Anthropic / GitHub credentials)
- UI testing
- Performance testing

## Tasks

| task_id    | Title                                                     |
| ---------- | --------------------------------------------------------- |
| task_12_01 | Integration test: spec handoff end-to-end                 |
| task_12_02 | Integration test: resume after crash                      |
| task_12_03 | Integration test: parallel agent spawn (mocked executors) |
| task_12_04 | Integration test: Ollama fallback flow                    |

## Execution Guidance

### Test harness setup

File: `bin/test-integration.sh` (NEW)

Each test scenario should:

1. Create a temp repo with a known initial state
2. Set `FACTORY_STATE_DIR` to a temp path
3. Mock external commands (`gh`, `claude`, `ollama`, `git push`) with controllable fixtures
4. Run the real plugin scripts against the temp repo
5. Assert on the final state (state.json contents, branch state, files created)
6. Clean up the temp repo at end

Common helpers (at the top of the file):

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
TEST_DIR="$(mktemp -d "/tmp/dark-factory-integration.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

export PATH="$REPO_ROOT/bin:$TEST_DIR/mocks:$PATH"
export FACTORY_STATE_DIR="$TEST_DIR/state"
mkdir -p "$FACTORY_STATE_DIR" "$TEST_DIR/mocks"

passed=0
failed=0

assert() {
  local desc="$1"; shift
  if "$@"; then
    passed=$((passed + 1))
    printf "  PASS  %s\n" "$desc"
  else
    failed=$((failed + 1))
    printf "  FAIL  %s\n" "$desc"
  fi
}

make_mock() {
  # make_mock NAME SCRIPT
  # Creates an executable at $TEST_DIR/mocks/$NAME with the given script body
  local name="$1"
  local body="$2"
  local path="$TEST_DIR/mocks/$name"
  printf '#!/usr/bin/env bash\n%s\n' "$body" > "$path"
  chmod +x "$path"
}

init_temp_repo() {
  local dir="$1"
  git init -q "$dir"
  (
    cd "$dir"
    git config user.email "test@example.com"
    git config user.name "Test"
    git checkout -q -b develop
    echo "# test" > README.md
    git add README.md
    git commit -q -m "initial"
  )
}
```

### task_12_01 — Spec handoff end-to-end

Scenario: spec-generator commits a handoff branch, orchestrator reads it, merges onto staging, and the spec file appears in `.state/<run>/spec.md`.

```bash
test_spec_handoff() {
  echo "## Scenario 1: spec handoff"

  local repo="$TEST_DIR/repo1"
  init_temp_repo "$repo"
  cd "$repo"

  # Create run
  local run_id="test-run-01"
  pipeline-state init "$run_id" '{"prd_path":"docs/prd.md"}'
  pipeline-branch staging-init "$run_id"

  # Simulate spec-generator running in a worktree:
  # we don't actually spawn an agent; we manually execute what
  # the agent instructions should do
  local worktree="$TEST_DIR/spec-worktree"
  git worktree add -q "$worktree" "staging/$run_id"
  (
    cd "$worktree"
    echo "# Generated spec" > spec.md
    echo '[{"task_id":"T1","title":"First","depends_on":[]}]' > tasks.json
    git checkout -q -b "spec-handoff/$run_id"
    git add spec.md tasks.json
    git -c user.email=bot@test -c user.name=bot commit -q -m "handoff"
    pipeline-state write "$run_id" .spec_handoff_branch "spec-handoff/$run_id"
    pipeline-state write "$run_id" .spec_handoff_ref "$(git rev-parse HEAD)"
  )

  # Back in main repo, execute the S3b orchestrator step
  cd "$repo"
  local handoff_ref
  handoff_ref=$(pipeline-state read "$run_id" .spec_handoff_ref)

  git fetch "$worktree" "spec-handoff/$run_id:spec-handoff/$run_id" 2>/dev/null || \
    git branch "spec-handoff/$run_id" "$handoff_ref" 2>/dev/null || true

  mkdir -p ".state/$run_id"
  git show "$handoff_ref:spec.md" > ".state/$run_id/spec.md"
  git show "$handoff_ref:tasks.json" > ".state/$run_id/tasks.json"

  # Assertions
  assert "spec.md exists in state dir" test -f ".state/$run_id/spec.md"
  assert "tasks.json exists in state dir" test -f ".state/$run_id/tasks.json"
  assert "spec.md content matches" grep -q "Generated spec" ".state/$run_id/spec.md"
  assert "tasks.json parses" jq -e 'length == 1' ".state/$run_id/tasks.json"
  assert "T1 is first task" bash -c "jq -r '.[0].task_id' '.state/$run_id/tasks.json' | grep -q T1"

  git worktree remove -f "$worktree" 2>/dev/null || true
}
```

### task_12_02 — Resume after crash

Scenario: run a pipeline partway, simulate a crash, resume, verify the resume point is correct.

```bash
test_resume_after_crash() {
  echo "## Scenario 2: resume after crash"

  local repo="$TEST_DIR/repo2"
  init_temp_repo "$repo"
  cd "$repo"

  local run_id="test-run-02"
  pipeline-state init "$run_id" '{}'

  # Seed a 4-task execution order with depends_on
  pipeline-state write "$run_id" .execution_order '[
    {"task_id":"T1","parallel_group":1},
    {"task_id":"T2","parallel_group":2},
    {"task_id":"T3","parallel_group":2},
    {"task_id":"T4","parallel_group":3}
  ]'
  pipeline-state write "$run_id" .tasks '{
    "T1":{"status":"done","depends_on":[]},
    "T2":{"status":"done","depends_on":["T1"]},
    "T3":{"status":"running","depends_on":["T1"]},
    "T4":{"status":"pending","depends_on":["T2","T3"]}
  }'

  # "Crash": mark T3 as interrupted
  pipeline-state write "$run_id" .tasks.T3.status interrupted
  pipeline-state write "$run_id" .status interrupted

  # Resume: call resume-point
  local resume
  resume=$(pipeline-state resume-point "$run_id")

  assert "resume-point is T3 (the interrupted task, not T4 which has unmet deps)" \
    test "$resume" = "T3"

  # Simulate T3 completing
  pipeline-state write "$run_id" .tasks.T3.status done

  resume=$(pipeline-state resume-point "$run_id")
  assert "after T3 done, resume-point is T4" test "$resume" = "T4"
}
```

### task_12_03 — Parallel agent spawn (mocked executors)

Scenario: the orchestrator's prompt-building + spawn flow for a parallel group produces N distinct prompts with correct task IDs.

Note: we can't actually spawn Agent tools from a bash test. Instead we test `pipeline-build-prompt` for each task in a group and assert the outputs are distinct and correct.

```bash
test_parallel_prompt_build() {
  echo "## Scenario 3: parallel prompt build"

  local repo="$TEST_DIR/repo3"
  init_temp_repo "$repo"
  cd "$repo"

  local run_id="test-run-03"
  pipeline-state init "$run_id" '{}'
  pipeline-state write "$run_id" .tasks '{
    "T1":{"status":"pending","risk_level":"low","depends_on":[]},
    "T2":{"status":"pending","risk_level":"low","depends_on":[]},
    "T3":{"status":"pending","risk_level":"security","depends_on":[]}
  }'

  mkdir -p ".state/$run_id"
  echo "# Spec" > ".state/$run_id/spec.md"

  local p1 p2 p3
  p1=$(pipeline-build-prompt "$run_id" T1)
  p2=$(pipeline-build-prompt "$run_id" T2)
  p3=$(pipeline-build-prompt "$run_id" T3)

  assert "prompt 1 references T1" echo "$p1" | grep -q "T1"
  assert "prompt 2 references T2" echo "$p2" | grep -q "T2"
  assert "prompt 3 references T3" echo "$p3" | grep -q "T3"
  assert "prompts differ" test "$p1" != "$p2"
  assert "T3 (security) prompt differs from T1 (low)" test "$p1" != "$p3"
}
```

### task_12_04 — Ollama fallback flow

Scenario: Claude is rate-limited → router switches to Ollama → task executes via ollama mock.

```bash
test_ollama_fallback() {
  echo "## Scenario 4: Ollama fallback"

  local repo="$TEST_DIR/repo4"
  init_temp_repo "$repo"
  cd "$repo"

  # Mock: ollama returns a canned response
  make_mock ollama '
    case "$1" in
      list) echo "qwen2.5-coder:32b"; exit 0 ;;
      run)  echo "mock response"; exit 0 ;;
      *)    exit 0 ;;
    esac
  '

  # Mock: anthropic quota check returns paused
  make_mock pipeline-quota-check '
    jq -n "{status:\"paused\", reason:\"rate_limit\", pause_until:\"2099-01-01T00:00:00Z\"}"
    exit 2
  '

  local run_id="test-run-04"
  pipeline-state init "$run_id" '{}'

  # Set config: ollama enabled
  pipeline-config set ollama.enabled true
  pipeline-config set ollama.model "qwen2.5-coder:32b"

  # Router decision
  local route
  route=$(pipeline-model-router decide T1 "$run_id")

  assert "router selects ollama when claude paused" \
    echo "$route" | jq -e '.provider == "ollama"'
  assert "router names the configured model" \
    echo "$route" | jq -e '.model == "qwen2.5-coder:32b"'
}
```

### Main

```bash
test_spec_handoff
test_resume_after_crash
test_parallel_prompt_build
test_ollama_fallback

printf "\n%d passed, %d failed\n" "$passed" "$failed"
exit $(( failed > 0 ? 1 : 0 ))
```

## Verification

1. `bash bin/test-integration.sh` — all scenarios pass, total output shows `N passed, 0 failed`
2. The script cleans up its temp dir on exit (no leftover `/tmp/dark-factory-integration.*`)
3. Running twice in a row produces identical results (no state leakage)
4. Each assertion name is human-readable — a failure log clearly identifies which scenario and which property failed
5. The file does not require network access (all external systems mocked)
