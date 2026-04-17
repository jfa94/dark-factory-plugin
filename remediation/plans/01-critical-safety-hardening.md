# Plan 01 — Critical Safety & Injection Hardening

**Priority:** P0 (blocker — do not run the pipeline autonomously until these are fixed)
**Tasks:** `task_01_01` through `task_01_05`

## Problem

The autonomous pipeline runs with `Bash(*)` permissions and creates branches, pushes to GitHub, and mutates state. A review found several injection and path-traversal vulnerabilities where LLM-generated content (from `tasks.json`, PRD bodies, or agent arguments) flows into scripts that execute it without validation.

The threat model is: a crafted PRD or compromised state file steers the orchestrator — an LLM agent with ~70% instruction-following — into calling bin scripts with malicious arguments. These scripts currently trust their inputs.

## What's in scope

1. jq path injection in `bin/pipeline-state write` (denylist → allowlist)
2. JSON string concatenation in `bin/pipeline-validate-tasks` execution_order builder
3. Unrestricted `rm -rf` via `bin/pipeline-cleanup --spec-dir`
4. Missing numeric validation in `bin/pipeline-init --issue`
5. Caller-spoofable PID in `bin/pipeline-lock --pid`

## What's NOT in scope

- Broader refactoring of the state schema (separate work)
- OAuth/Keychain handling (plan 02)
- Settings template safety (plan 04)
- Branch-protection hook (plan 09)

## Background reading

- The review findings that motivated this plan — search the chat transcript for `C4`, `C7`, `C8`, `M21`, `M22`.
- `bin/pipeline-state` lines 47-75 (the `write` action)
- `bin/pipeline-validate-tasks` line 183 (the execution_order push)
- `bin/pipeline-cleanup` lines 142-160 (`--clean-spec` path)
- `bin/pipeline-init` lines 47-52 (issue arg handling)
- `bin/pipeline-lock` lines 13-22, 42-77 (PID handling)

## Approach guidance

For each task:

1. **Write the regression test first.** Add it to the corresponding `bin/test-phase*.sh`. Run the existing test suite — the new test should FAIL against the current buggy code.
2. **Apply the minimal fix.** Do not refactor surrounding code unless the fix requires it.
3. **Re-run the test suite.** The new test should pass. All existing tests must still pass.
4. **Update `remediation/tasks.json`** — set status to `done`, add a `notes` field summarizing the fix.
5. **Commit** with message: `fix(safety): <task-id> <short description>`.

## Task-specific guidance

### task_01_01 — jq path injection

The current denylist at `bin/pipeline-state:56-61` is incomplete. Switch to an allowlist approach. The cleanest fix is to require callers to pass dotted path expressions and parse them into an array of segments inside the script:

```bash
# Validate each segment against ^[a-zA-Z_][a-zA-Z0-9_]*$
# Build path array: ["tasks","task_1","status"]
# jq --argjson path "$path" --argjson v "$value" 'setpath($path; $v)'
```

Orchestrator callers pass `.tasks.task_1.status` as before — the script handles parsing internally. Reject any segment that doesn't match the identifier regex. Keep supporting numeric indices (e.g., `.tasks.task_1.review_rounds[0]`) via a second allowed pattern `^[0-9]+$` that's coerced to an integer index.

### task_01_02 — JSON concatenation in validate-tasks

Replace the string-built entries with jq-built JSON:

```bash
entry=$(jq -n --arg tid "$tid" --argjson group "$group" '{task_id:$tid,parallel_group:$group}')
execution_order+=("$entry")
```

Also add a pre-validation pass that rejects task*ids containing any character outside `^[a-zA-Z0-9*-]+$`. Task IDs from an LLM should be simple identifiers; exotic characters are either bugs or attacks.

### task_01_03 — path validation in cleanup

The safest approach is to require spec_dir to be a path underneath the current working directory (which should be the project root when the orchestrator runs):

```bash
project_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  log_error "not in a git repo"
  exit 1
}
spec_dir_abs=$(realpath -m "$spec_dir" 2>/dev/null) || {
  log_error "could not resolve spec dir: $spec_dir"
  exit 1
}
case "$spec_dir_abs" in
  "$project_root"/*) ;;
  *) log_error "spec dir must be inside project root: $spec_dir_abs"; exit 1 ;;
esac
```

Also reject `..` segments in the raw input before realpath resolution (defense in depth).

#### Test safety — MANDATORY

Do not implement the red-phase test by running `pipeline-cleanup` against real `/`, real `~`, real `$HOME`, or any path the test script did not itself create. The refuse-list is already in the binary (lines 154-198 of `bin/pipeline-cleanup`). Do NOT remove or bypass the guard to observe pre-fix behavior.

Use this pattern in `bin/test-phase5.sh`:

```bash
sandbox=$(mktemp -d)
trap '[[ -n "$sandbox" && "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"' EXIT
export CLAUDE_PLUGIN_DATA="$sandbox/data"
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/test-run"
printf '%s' '{"tasks":{"t1":{"status":"done"}}}' \
  > "$CLAUDE_PLUGIN_DATA/runs/test-run/state.json"

fake_project_root="$sandbox/proj"
mkdir -p "$fake_project_root"
outside="$sandbox/outside"; mkdir -p "$outside"

# Stub git so the guard checks against the sandbox, not the real repo.
# (add a fake `git` to the mocks dir already on PATH in test-phase5.sh)

# Expect rejection — NEVER substitute real / or ~ for "$outside"
pipeline-cleanup test-run --clean-spec --spec-dir "$outside" && fail=1
```

For the "valid in-project" case, create `$fake_project_root/spec` and assert it is removed. Only that directory — created by the test inside the sandbox — should ever be a legal `--spec-dir` argument.

### task_01_04 — numeric validation in pipeline-init

Simple fix — add a validation block before the `--argjson issues` line:

```bash
if [[ -n "$issue" ]] && ! [[ "$issue" =~ ^[0-9]+$ ]]; then
  log_error "invalid issue number (must be positive integer): $issue"
  exit 1
fi
```

### task_01_05 — pipeline-lock --pid

Cleanest fix is to remove the flag entirely and require callers to run as the process they want to represent. If the flag is needed for tests, replace it with an env var `FACTORY_LOCK_TEST_PID` that's documented as test-only. Alternatively: verify the passed PID is in the caller's process tree via `ps -o ppid= -p $LOCK_PID` walking up to `$$`.

## Completion checklist

- [ ] All 5 tasks have regression tests written
- [ ] All 5 tasks have their fix applied
- [ ] `bin/test-phase1.sh` passes (tasks 01_01, 01_04, 01_05)
- [ ] `bin/test-phase3.sh` passes (task 01_02)
- [ ] `bin/test-phase5.sh` passes (task 01_03)
- [ ] All phase suites `bin/test-phase*.sh` pass
- [ ] `tasks.json` updated with status=done for each completed task
- [ ] Commits landed with conventional commit prefix

## On completion

After all 5 tasks are done, the next plan to tackle is **Plan 02 — Quota & Rate Limiting**. Alternatively, work can proceed in parallel on Plan 03 (spec propagation) and Plan 04 (safety template) — neither depends on Plan 01's files.
