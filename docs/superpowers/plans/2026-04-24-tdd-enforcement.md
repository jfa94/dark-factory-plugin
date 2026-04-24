# TDD Enforcement + Reviewer Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce TDD in the dark-factory autonomous pipeline by porting the superpowers test-driven-development skill, adding a two-phase execution (test-writer RED → task-executor GREEN), a TDD commit-order quality gate, and restructuring/renaming reviewer agents to separate spec alignment from code quality.

**Architecture:** Two-phase per-task execution: test-writer authors failing tests from spec in the worktree (committing RED), then task-executor implements minimal code to turn tests green (committing GREEN). A new `bin/pipeline-tdd-gate` script validates commit order in postexec between `pipeline-quality-gate` and `pipeline-coverage-gate`. Reviewer slot splits into two parallel agents: `implementation-reviewer` (spec alignment) and `quality-reviewer` (adversarial code quality; Codex preferred, quality-reviewer agent as fallback). Both verdicts merged by the existing `pipeline-parse-review`.

**Tech Stack:** Bash (plugin scripts), jq, markdown (skills/agents), shellcheck-clean shell. No new language or runtime dependencies.

**Reference spec:** `docs/superpowers/specs/2026-04-24-tdd-enforcement-design.md`.

---

## File Structure

### New files

- `skills/test-driven-development/SKILL.md` — ported TDD skill (strip "human partner" language)
- `skills/test-driven-development/testing-anti-patterns.md` — already exists under `skills/testing-anti-patterns.md`; move into this skill directory
- `bin/pipeline-tdd-gate` — new quality gate script
- `bin/tests/tdd-gate.sh` — bats-free shell tests for the new gate
- `agents/implementation-reviewer.md` — rename target for `task-reviewer.md`
- `agents/quality-reviewer.md` — rename target for `code-reviewer.md`
- `skills/pipeline-orchestrator/prompts/implementation-reviewer.md` — rename target

### Modified files

- `agents/task-executor.md` — rewrite for GREEN phase with TDD framing (Iron Law, Red Flags, checklist, split commits)
- `agents/test-writer.md` — add `mode=pre-impl` branch; document dual-mode behavior
- `bin/pipeline-run-task` — add pre-impl test-writer spawn; add tdd-gate call; run implementation-reviewer + quality-reviewer in parallel
- `bin/pipeline-detect-reviewer` — fallback to `quality-reviewer` (not task-reviewer)
- `bin/pipeline-parse-review` — update agent-name string matches
- `bin/pipeline-holdout-validate`, `bin/pipeline-validate` — rename agent refs
- `hooks/subagent-stop-gate.sh`, `hooks/subagent-stop-transcript.sh` — rename agent refs
- `skills/pipeline-orchestrator/SKILL.md` and `reference/*.md` — rename agent refs
- `skills/run-pipeline/SKILL.md` — document two-phase flow + tdd-gate
- `commands/run.md` — document two-phase flow
- `templates/settings.autonomous.json` — rename agent refs
- `bin/tests/fixtures/score/compliant-smoke/metrics.jsonl` — update `agent_type` values
- `bin/tests/run-command.sh`, `bin/tests/branching.sh`, `bin/tests/hooks.sh` — rename string assertions
- `docs/getting-started.md`, `docs/architecture/*.md`, `docs/guides/configuration.md`, `docs/explanation/*.md`, `docs/reference/*.md` — rename agent refs
- `remediation/plans/07-orchestrator-prompt-flow.md`, `remediation/plans/11-validator-discovery.md` — rename agent refs
- `CLAUDE.md` (plugin root) — add TDD enforcement note + skill reference
- `.claude-plugin/plugin.json` — bump minor version (0.3.6 → 0.4.0; breaking rename)

### Deleted files

- `agents/task-reviewer.md` (replaced by implementation-reviewer.md)
- `agents/code-reviewer.md` (replaced by quality-reviewer.md)
- `skills/pipeline-orchestrator/prompts/task-reviewer.md` (replaced)
- `skills/testing-anti-patterns.md` — if moved into TDD skill directory; else leave and have TDD skill reference it

---

## Task 1: Port test-driven-development skill

**Files:**

- Create: `skills/test-driven-development/SKILL.md`
- Reference: `/Users/Javier/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/test-driven-development/SKILL.md`
- Keep: `skills/testing-anti-patterns.md` (leave at current path for now; skill references it by relative path)

- [ ] **Step 1: Copy the superpowers TDD skill verbatim**

```bash
mkdir -p skills/test-driven-development
cp "/Users/Javier/.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7/skills/test-driven-development/SKILL.md" \
   skills/test-driven-development/SKILL.md
```

- [ ] **Step 2: Strip "human partner" language**

Open `skills/test-driven-development/SKILL.md`. Replace every occurrence:

- "your human partner" → "the user"
- "your human partner's permission" → "user permission via `tdd_exempt: true` in the task spec"
- "Ask your human partner." → "Raise the question in the task's STATUS line."

Verify:

```bash
grep -n "human partner" skills/test-driven-development/SKILL.md
# expected: no output
```

- [ ] **Step 3: Fix anti-patterns reference path**

In the skill body, the existing line reads `@testing-anti-patterns.md`. Change to:

```markdown
When adding mocks or test utilities, read `../testing-anti-patterns.md` to avoid common pitfalls:
```

- [ ] **Step 4: Commit**

```bash
git add skills/test-driven-development/SKILL.md
git commit -m "feat(skills): port test-driven-development skill from superpowers"
```

---

## Task 2: Write failing test for pipeline-tdd-gate (RED)

**Files:**

- Create: `bin/tests/tdd-gate.sh`

- [ ] **Step 1: Create the test script skeleton mirroring existing bin/tests style**

```bash
cat > bin/tests/tdd-gate.sh <<'EOF'
#!/usr/bin/env bash
# tdd-gate.sh — structural tests for bin/pipeline-tdd-gate.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$PLUGIN_ROOT/bin/pipeline-tdd-gate"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

# Set up a temp git repo simulating a task branch.
_mk_repo() {
  local dir="$1"
  mkdir -p "$dir"
  ( cd "$dir" && git init -q && git checkout -q -b staging
    mkdir src tests
    printf 'x' > src/.keep && printf 'x' > tests/.keep
    git add . && git -c user.email=t@t -c user.name=t commit -q -m "init"
    git checkout -q -b feat/task-001
  )
}
_commit() {
  local dir="$1" msg="$2"; shift 2
  ( cd "$dir"
    for f in "$@"; do mkdir -p "$(dirname "$f")"; printf 'x%s' "$RANDOM" >> "$f"; done
    git add -A && git -c user.email=t@t -c user.name=t commit -q -m "$msg"
  )
}

# Test 1: pass case — test-only commit precedes impl commit.
case1() {
  local repo; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "test(x): failing [task-001]" "tests/x.test.ts"
  _commit "$repo" "feat(x): impl [task-001]"    "src/x.ts"
  ( cd "$repo" && "$GATE" --task-id task-001 --base staging ) | jq -e '.ok == true' >/dev/null \
    || fail "case1 expected ok=true"
  pass "case1: test-before-impl passes gate"
}

# Test 2: fail case — impl commit without any preceding test-only commit.
case2() {
  local repo; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "feat(x): impl [task-001]" "src/x.ts"
  if ( cd "$repo" && "$GATE" --task-id task-001 --base staging ) | jq -e '.ok == false' >/dev/null; then
    pass "case2: impl-without-test fails gate"
  else
    fail "case2 expected ok=false"
  fi
}

# Test 3: skip case — diff is tests-only.
case3() {
  local repo; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "test(x): only tests [task-001]" "tests/x.test.ts"
  ( cd "$repo" && "$GATE" --task-id task-001 --base staging ) | jq -e '.exempt == true' >/dev/null \
    || fail "case3 expected exempt=true"
  pass "case3: tests-only diff is exempt"
}

# Test 4: exempt case — tasks.json marks task as tdd_exempt.
case4() {
  local repo; repo=$(mktemp -d); _mk_repo "$repo"
  mkdir -p "$repo/specs/current"
  cat > "$repo/specs/current/tasks.json" <<JSON
{"tasks":[{"id":"task-001","tdd_exempt":true}]}
JSON
  ( cd "$repo" && git add specs && git -c user.email=t@t -c user.name=t commit -q -m "spec" )
  _commit "$repo" "feat(x): impl [task-001]" "src/x.ts"
  ( cd "$repo" && "$GATE" --task-id task-001 --base staging --spec-dir specs/current ) \
    | jq -e '.exempt == true' >/dev/null \
    || fail "case4 expected exempt=true"
  pass "case4: tdd_exempt flag respected"
}

case1; case2; case3; case4
printf 'all tdd-gate tests passed\n'
EOF
chmod +x bin/tests/tdd-gate.sh
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
bin/tests/tdd-gate.sh
# Expected: FAIL with "pipeline-tdd-gate: command not found" or similar (script does not yet exist)
```

- [ ] **Step 3: Commit the failing test**

```bash
git add bin/tests/tdd-gate.sh
git commit -m "test(tdd-gate): failing tests for commit-order validation [tdd-gate]"
```

---

## Task 3: Implement pipeline-tdd-gate (GREEN)

**Files:**

- Create: `bin/pipeline-tdd-gate`

- [ ] **Step 1: Write minimal implementation**

```bash
cat > bin/pipeline-tdd-gate <<'EOF'
#!/usr/bin/env bash
# pipeline-tdd-gate — validate that each impl commit is preceded by a test-only
# commit with the same [task-id] tag. Writes structured JSON to stdout and
# (if state is available) to .tasks.<task-id>.quality_gates.tdd.
#
# Usage: pipeline-tdd-gate --task-id <id> [--base <ref>] [--run-id <id>] [--spec-dir <path>]
# Exit: 0 if ok or exempt; 1 on violation.
set -euo pipefail

_lib="$(dirname "$0")/pipeline-lib.sh"
[[ -f "$_lib" ]] && source "$_lib"
command -v jq >/dev/null || { echo "jq required" >&2; exit 1; }

base_ref="staging"
task_id=""
run_id=""
spec_dir=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)     base_ref="$2"; shift 2 ;;
    --task-id)  task_id="$2";  shift 2 ;;
    --run-id)   run_id="$2";   shift 2 ;;
    --spec-dir) spec_dir="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done
[[ -z "$task_id" ]] && { echo "--task-id required" >&2; exit 1; }

# Config-path patterns
_is_test_path() {
  case "$1" in
    *.test.*|*.spec.*|tests/*|*/__tests__/*) return 0 ;;
    *) return 1 ;;
  esac
}
_is_docs_path() {
  case "$1" in
    docs/*|*.md) return 0 ;;
    *) return 1 ;;
  esac
}
_is_config_path() {
  case "$1" in
    *.json|*.yml|*.yaml|*.toml|.gitignore) return 0 ;;
    *) return 1 ;;
  esac
}

# Per-task exemption via tasks.json
_task_exempt() {
  local tfile
  for tfile in "$spec_dir/tasks.json" specs/current/tasks.json; do
    [[ -f "$tfile" ]] || continue
    local flag
    flag=$(jq -r --arg id "$task_id" '.tasks[]? | select(.id==$id) | .tdd_exempt // false' "$tfile" 2>/dev/null)
    [[ "$flag" == "true" ]] && return 0
  done
  # Global exemption via package.json
  if [[ -f package.json ]]; then
    local g
    g=$(jq -r '.["dark-factory"].tddExempt // false' package.json 2>/dev/null)
    [[ "$g" == "true" ]] && return 0
  fi
  return 1
}

_emit() {
  local ok="$1" exempt="$2" violations="$3"
  local out
  out=$(jq -n --argjson ok "$ok" --argjson exempt "$exempt" --argjson v "$violations" \
    '{ok:$ok, exempt:$exempt, violations:$v}')
  printf '%s\n' "$out"
  if [[ -n "$run_id" ]] && command -v pipeline-state >/dev/null 2>&1; then
    pipeline-state task-write "$run_id" "$task_id" quality_gates.tdd "$out" >/dev/null 2>&1 || true
  fi
}

# Gather commits on current branch since base that reference this task_id.
commits=$(git log --format='%H' "${base_ref}..HEAD" 2>/dev/null \
  | while read -r sha; do
      msg=$(git log -1 --format='%s%n%b' "$sha")
      if printf '%s' "$msg" | grep -qF "[$task_id]"; then printf '%s\n' "$sha"; fi
    done)

if [[ -z "$commits" ]]; then
  _emit true true '[]'
  exit 0
fi

# Classify commits oldest-first.
commits_oldest=$(printf '%s\n' "$commits" | tac)
classes=()
while read -r sha; do
  [[ -z "$sha" ]] && continue
  files=$(git show --name-only --format= "$sha")
  kind="test-only"
  all_docs=1; all_cfg=1
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    _is_docs_path   "$f" || all_docs=0
    _is_config_path "$f" || all_cfg=0
    if ! _is_test_path "$f"; then
      if ! _is_docs_path "$f" && ! _is_config_path "$f"; then
        kind="impl"
      fi
    fi
  done <<<"$files"
  classes+=("$sha|$kind|$all_docs|$all_cfg")
done <<<"$commits_oldest"

# Check exemption: all commits are tests/docs/config only.
has_impl=0
for c in "${classes[@]}"; do
  IFS='|' read -r _ kind _ _ <<<"$c"
  [[ "$kind" == "impl" ]] && has_impl=1
done
if (( has_impl == 0 )); then _emit true true '[]'; exit 0; fi
if _task_exempt;       then _emit true true '[]'; exit 0; fi

# Validate: first impl commit preceded by at least one test-only commit.
seen_test_only=0
violations='[]'
for c in "${classes[@]}"; do
  IFS='|' read -r sha kind _ _ <<<"$c"
  if [[ "$kind" == "test-only" ]]; then
    seen_test_only=1
  elif [[ "$kind" == "impl" ]]; then
    if (( seen_test_only == 0 )); then
      violations=$(printf '%s' "$violations" | jq --arg s "$sha" '. + [{commit:$s, reason:"impl-without-preceding-test"}]')
    fi
  fi
done

if [[ "$violations" != '[]' ]]; then
  _emit false false "$violations"
  exit 1
fi
_emit true false '[]'
EOF
chmod +x bin/pipeline-tdd-gate
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
bin/tests/tdd-gate.sh
# Expected: all four cases PASS
```

- [ ] **Step 3: Run shellcheck**

```bash
shellcheck bin/pipeline-tdd-gate
# Expected: no output (clean)
```

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-tdd-gate
git commit -m "feat(tdd-gate): enforce test-before-impl commit order [tdd-gate]"
```

---

## Task 4: Rename task-reviewer → implementation-reviewer

**Files:**

- Move: `agents/task-reviewer.md` → `agents/implementation-reviewer.md`
- Move: `skills/pipeline-orchestrator/prompts/task-reviewer.md` → `skills/pipeline-orchestrator/prompts/implementation-reviewer.md`
- Modify (string refs): `bin/pipeline-run-task`, `bin/pipeline-detect-reviewer`, `bin/pipeline-holdout-validate`, `bin/pipeline-validate`, `bin/pipeline-parse-review`, `hooks/subagent-stop-gate.sh`, `hooks/subagent-stop-transcript.sh`, `skills/pipeline-orchestrator/SKILL.md` + `reference/*.md`, `templates/settings.autonomous.json`, `bin/tests/fixtures/score/compliant-smoke/metrics.jsonl`, `bin/tests/run-command.sh`, `bin/tests/branching.sh`, `bin/tests/hooks.sh`, `docs/**/*.md`, `remediation/plans/07-orchestrator-prompt-flow.md`, `remediation/plans/11-validator-discovery.md`

- [ ] **Step 1: Rename the agent file**

```bash
git mv agents/task-reviewer.md agents/implementation-reviewer.md
```

- [ ] **Step 2: Update the frontmatter name field and sharpen role description**

Open `agents/implementation-reviewer.md`. Change frontmatter:

```yaml
---
model: sonnet
maxTurns: 25
description: "Verifies the implementation satisfies the spec's intent, not merely that tests pass. Checks every acceptance criterion is genuinely addressed."
whenToUse: "When the pipeline needs to verify that task code actually implements the task spec (parallel with quality-reviewer)"
skills:
  - review-protocol
tools:
  - Read
  - Grep
  - Glob
---
```

Under the H1 heading change to `# Implementation Reviewer`. Leave the body content intact.

- [ ] **Step 3: Rename the prompt file**

```bash
git mv skills/pipeline-orchestrator/prompts/task-reviewer.md \
       skills/pipeline-orchestrator/prompts/implementation-reviewer.md
```

- [ ] **Step 4: Replace string references across the plugin (excluding the spec doc)**

```bash
# Replace the hyphenated form
grep -rl 'task-reviewer' . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir='docs/superpowers/specs' \
  --exclude-dir='docs/superpowers/plans' \
  | xargs sed -i '' -e 's/task-reviewer/implementation-reviewer/g'

# Replace the underscore form (state fields, if any)
grep -rln 'task_reviewer' . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  | xargs sed -i '' -e 's/task_reviewer/implementation_reviewer/g' 2>/dev/null || true
```

- [ ] **Step 5: Manually verify the fixture file**

```bash
grep agent_type bin/tests/fixtures/score/compliant-smoke/metrics.jsonl
# Expected: all lines show "agent_type":"implementation-reviewer" (no task-reviewer)
```

- [ ] **Step 6: Run the full test suite**

```bash
for t in bin/tests/*.sh; do bash "$t"; done
# Expected: all scripts exit 0; any assertion referencing the old name should now reference the new one and still pass
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename task-reviewer → implementation-reviewer"
```

---

## Task 5: Rename code-reviewer → quality-reviewer

**Files:**

- Move: `agents/code-reviewer.md` → `agents/quality-reviewer.md`
- Modify string refs: same file list as Task 4 minus the already-renamed ones

- [ ] **Step 1: Rename the agent file**

```bash
git mv agents/code-reviewer.md agents/quality-reviewer.md
```

- [ ] **Step 2: Update frontmatter**

Open `agents/quality-reviewer.md`. Change frontmatter `description` and `whenToUse` to:

```yaml
description: "Adversarial quality review — logic errors, security, test quality, AI anti-patterns. Acts as the fallback when Codex is unavailable."
whenToUse: "When the pipeline needs an adversarial code-quality review (default path if Codex is not installed/logged in)."
```

Change H1 to `# Quality Reviewer`. Leave the body content intact.

- [ ] **Step 3: Replace string references**

```bash
grep -rl 'code-reviewer' . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude-dir='docs/superpowers/specs' \
  --exclude-dir='docs/superpowers/plans' \
  | xargs sed -i '' -e 's/code-reviewer/quality-reviewer/g'

grep -rln 'code_reviewer' . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  | xargs sed -i '' -e 's/code_reviewer/quality_reviewer/g' 2>/dev/null || true
```

- [ ] **Step 4: Verify nothing still references the old name**

```bash
grep -rn 'task-reviewer\|code-reviewer' . \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude-dir='docs/superpowers/specs' \
  --exclude-dir='docs/superpowers/plans'
# Expected: no matches
```

- [ ] **Step 5: Run the full test suite**

```bash
for t in bin/tests/*.sh; do bash "$t"; done
# Expected: all green
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(agents): rename code-reviewer → quality-reviewer"
```

---

## Task 6: Fix pipeline-detect-reviewer fallback

**Files:**

- Modify: `bin/pipeline-detect-reviewer`

- [ ] **Step 1: Write failing test**

Append to `bin/tests/routing.sh`:

```bash
# Codex-unavailable fallback should select quality-reviewer (not implementation-reviewer).
( PATH="$PWD/bin:$PATH" pipeline-detect-reviewer ) \
  | jq -e '.agent == "quality-reviewer"' >/dev/null \
  || { echo "FAIL: fallback should be quality-reviewer"; exit 1; }
echo "PASS: fallback is quality-reviewer"
```

Run:

```bash
bin/tests/routing.sh
# Expected: FAIL: fallback should be quality-reviewer (current code hardcodes implementation-reviewer after Task 4)
```

- [ ] **Step 2: Update the fallback**

Edit `bin/pipeline-detect-reviewer` lines 30-34 so the fallback JSON uses `quality-reviewer`:

```bash
# Fallback to Claude Code quality-reviewer agent
jq -n \
  --arg reviewer "claude-code" \
  --arg agent "quality-reviewer" \
  '{reviewer: $reviewer, agent: $agent}'
```

- [ ] **Step 3: Run the test to verify pass**

```bash
bin/tests/routing.sh
# Expected: PASS: fallback is quality-reviewer
```

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-detect-reviewer bin/tests/routing.sh
git commit -m "fix(reviewer): Codex fallback is quality-reviewer, not implementation-reviewer"
```

---

## Task 7: Add mode=pre-impl to test-writer agent

**Files:**

- Modify: `agents/test-writer.md`

- [ ] **Step 1: Add mode handling to the agent prompt**

At the top of `agents/test-writer.md` body (after frontmatter), insert a new section:

```markdown
## Modes

You run in one of two modes, passed via the `mode` field in the input prompt:

- `mode: pre-impl` — the task has NOT been implemented yet. Your job is to author failing tests derived purely from the task's acceptance criteria and spec. Commit them. DO NOT read or reference any implementation file for the task.
- `mode: coverage-gap` — the task IS implemented. Fill coverage gaps or kill mutation survivors (existing behavior).

Default: `coverage-gap` (for backward compatibility).

### pre-impl mode — additional rules

- You MUST read the spec at the path provided in the prompt.
- You MUST NOT read any file under `src/` that matches the task's acceptance-criteria scope. Violation = start over.
- Write one test per acceptance criterion (more if edge cases demand).
- Run the project's test command and confirm tests FAIL. If any pass on first run, the test does not test anything new — rewrite it.
- Stage test files only. Commit with message: `test(<scope>): failing tests for <task_id> [<task_id>]`.
- End with `STATUS: RED_READY` on success, `STATUS: BLOCKED — <reason>` on failure.
```

- [ ] **Step 2: Commit**

```bash
git add agents/test-writer.md
git commit -m "feat(test-writer): add mode=pre-impl for TDD RED phase"
```

---

## Task 8: Rewrite task-executor for GREEN phase

**Files:**

- Modify: `agents/task-executor.md`

- [ ] **Step 1: Replace the body with TDD-enforcing content**

Keep existing frontmatter unchanged. Replace the body (everything after the `---` closing frontmatter) with:

````markdown
# Task Executor — GREEN Phase

You are the GREEN phase of a TDD cycle in the dark-factory pipeline. A prior `test-writer` subagent has already committed failing tests for this task in the worktree. Your job is to write the minimal implementation that turns them green.

<EXTREMELY-IMPORTANT>
## Iron Law

NO NEW TESTS. NO PRODUCTION CODE WITHOUT A FAILING TEST ALREADY IN THE WORKTREE.

Tests were written in a prior phase. You DO NOT author the initial tests for this task. You ONLY write minimal implementation to satisfy the existing failing tests.

Violating the letter of this rule violates the spirit. No exceptions.
</EXTREMELY-IMPORTANT>

## Red Flags — STOP and re-read this prompt

| Thought                                       | Reality                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| "I'll add a better test while I'm here"       | Forbidden. REFACTOR after green only.                                            |
| "The existing test is wrong, let me fix it"   | Report it. `STATUS: BLOCKED — test requires revision: <reason>`. Do NOT edit it. |
| "I'll write code first and tests will follow" | Tests already exist. Implement against them.                                     |
| "This is trivial, skip running the tests"     | Run tests. Always.                                                               |
| "I'll commit tests and impl together"         | No. Commit impl separately from test changes.                                    |

## Input

You receive a structured prompt containing:

- **Task ID** and metadata
- **Description** of what to implement
- **Files to modify** (max 3)
- **Acceptance criteria** to satisfy
- **Spec context** for architectural understanding
- **Prior work** (if resuming — do NOT redo existing commits)
- **Review feedback** (if fixing from a previous review round)

## Execution Steps

1. Read the spec and task context.
2. Run the project's test command. Confirm the tests committed by `test-writer` actually fail, and note the exact failure messages.
3. Explore the codebase around the files to modify — existing patterns, imports, types.
4. Implement the minimal code that makes the failing tests pass. Do NOT add scope beyond what the tests demand.
5. Run tests again. Confirm pass. If any other tests fail, fix your code (not the tests).
6. REFACTOR if necessary, keeping tests green. Separate commit from the GREEN commit.
7. Commit. Message format: `feat(<scope>): <description> [<task_id>]` or `fix(<scope>): <description> [<task_id>]`.

## Rules

- Do NOT modify test files from the RED commit. Exception: REFACTOR commit that keeps tests green and only renames / re-homes tests, after initial GREEN.
- Do NOT add features beyond what the acceptance criteria require.
- Do NOT hardcode return values to satisfy specific test inputs.
- Do NOT write fallback code that silently degrades functionality.
- Tests must be independent — no shared mutable state.

## On Failure

`TASK_FAILURE_TYPE` environment variable:

- `max_turns` — focus on completing remaining work efficiently.
- `quality_gate` — read the gate output and fix the specific issue.
- `tdd_gate` — commit order violation. Re-examine your commit history; ensure impl commits follow test commits.
- `agent_error` — read the error details and address root cause.
- `no_changes` — you MUST make code changes. Check you're editing the right files.
- `code_review` — address ALL blocking findings.

## Post-Execution

After you finish, the orchestrator will:

1. Run `<pkg-manager> format` and `<pkg-manager> lint:fix` (auto-committed).
2. Run quality gates: `pipeline-quality-gate`, `pipeline-tdd-gate`, `pipeline-coverage-gate`, holdout, mutation.
3. Spawn two adversarial reviewers in parallel: `implementation-reviewer` (spec alignment) and `quality-reviewer` (code quality; via Codex when available).

## Verification Checklist (MUST pass before STATUS: DONE)

- [ ] Ran tests before writing any code and observed the RED tests fail
- [ ] Wrote the minimum code to make RED tests pass
- [ ] Ran tests after implementation and confirmed pass
- [ ] Did NOT modify any test files from the RED commit (unless doing a REFACTOR commit after GREEN)
- [ ] Output pristine (no warnings / errors)
- [ ] Committed impl with `[<task_id>]` tag
- [ ] Every acceptance criterion is genuinely addressed (not just test-passing)

Can't check every box? STATUS: BLOCKED with the reason.

## Final Status Block (REQUIRED)

End your final assistant message with exactly one of these four lines:

```
STATUS: DONE
STATUS: DONE_WITH_CONCERNS — <1-line concern>
STATUS: BLOCKED — <1-line reason>
STATUS: NEEDS_CONTEXT — <1-line question>
```
````

- [ ] **Step 2: Commit**

```bash
git add agents/task-executor.md
git commit -m "refactor(task-executor): rewrite for GREEN phase with TDD enforcement"
```

---

## Task 9: Wire pre-impl test-writer phase into pipeline-run-task

**Files:**

- Modify: `bin/pipeline-run-task`

- [ ] **Step 1: Locate the preexec block**

```bash
grep -n 'preexec\|quota_gate\|spawn.*executor' bin/pipeline-run-task | head
```

Identify the function/block that spawns `task-executor`. Immediately above that spawn, insert a new helper call `_pipeline_spawn_test_writer_pre_impl` and a branch that checks whether the task already has a `test(...) [<task_id>]` commit (idempotent on resume).

- [ ] **Step 2: Add the helper function**

Add near the other helpers (e.g., after `_emit_manifest`):

```bash
# Spawn test-writer in pre-impl mode. Blocks task-executor if it returns BLOCKED.
_pipeline_spawn_test_writer_pre_impl() {
  local run_id="$1" task_id="$2" wt="$3"
  # Skip if a test(...) [task_id] commit already exists (resume).
  if ( cd "$wt" && git log --format=%s staging..HEAD 2>/dev/null \
         | grep -qE "^test\(.*\).*\[${task_id}\]" ); then
    log_info "test-writer pre-impl already complete for $task_id (resume)"
    return 0
  fi
  _ensure_prompt_dir
  local pf; pf=$(_prompt_path test-writer-pre-impl)
  {
    printf 'mode: pre-impl\n'
    printf 'task_id: %s\n' "$task_id"
    printf 'worktree: %s\n' "$wt"
    printf 'Write failing tests derived purely from the spec. Commit with message:\n'
    printf '  test(<scope>): failing tests for %s [%s]\n' "$task_id" "$task_id"
    printf 'End with STATUS: RED_READY or STATUS: BLOCKED.\n'
  } > "$pf"
  local agents_json
  agents_json=$(jq -c -n --arg pf "$pf" \
    '[{subagent_type:"test-writer", isolation:"worktree", model:"opus", effort:"medium", maxTurns:25, prompt_file:$pf}]')
  _emit_manifest preexec_tests "$agents_json"
}
```

- [ ] **Step 3: Call it in the orchestrator flow**

In the stage-dispatch block (where stages like `preexec`, `exec`, `postexec` are routed), add a new stage `preexec_tests` that runs `_pipeline_spawn_test_writer_pre_impl` before `exec`. Update the stage transitions:

- `preexec` → `preexec_tests` (new)
- `preexec_tests` → `exec` when the spawned test-writer returns `STATUS: RED_READY`
- `preexec_tests` → `failed` when it returns `STATUS: BLOCKED`

Refer to `skills/pipeline-orchestrator/reference/stage-taxonomy.md` after renames to confirm stage-name conventions.

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-run-task
git commit -m "feat(pipeline): add pre-impl test-writer phase before task-executor"
```

---

## Task 10: Wire tdd-gate into postexec

**Files:**

- Modify: `bin/pipeline-run-task`

- [ ] **Step 1: Locate the quality-gate call**

```bash
grep -n 'pipeline-quality-gate\|pipeline-coverage-gate' bin/pipeline-run-task
# Expected: lines ~231 and ~241
```

- [ ] **Step 2: Insert the tdd-gate call between them**

Between `pipeline-quality-gate` call and `pipeline-coverage-gate` call, add:

```bash
# TDD commit-order gate
if ! ( cd "$wt" && pipeline-tdd-gate --task-id "$task_id" --run-id "$run_id" --base staging ) >/dev/null; then
  log_warn "tdd gate failed for $task_id"
  t1=$(_now_ms)
  log_step_end "postexec" "failed" "$((t1-t0))" "task_id=\"$task_id\"" "reason=\"tdd\""
  return 30
fi
```

- [ ] **Step 3: Run the pipeline tests**

```bash
bash bin/tests/run-command.sh
bash bin/tests/integration.sh
# Expected: all pass
```

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-run-task
git commit -m "feat(pipeline): wire tdd-gate into postexec between quality and coverage gates"
```

---

## Task 11: Run implementation-reviewer + quality-reviewer in parallel

**Files:**

- Modify: `bin/pipeline-run-task`

- [ ] **Step 1: Locate the reviewer spawn block**

The current block (around lines 274-326) branches on `$provider`: if `codex`, spawn Codex; else spawn `implementation-reviewer` with risk-tier additions (`architecture-reviewer`, security reviewers).

- [ ] **Step 2: Replace the branch so both reviewers always run**

Rewrite the block to always spawn `implementation-reviewer` (Claude Code agent), and in parallel spawn the quality reviewer (Codex if available, else `quality-reviewer` agent). Risk-tier additions remain:

```bash
# --- reviewer spawn (always two slots: implementation + quality) ---
local tier; tier=$(_task_field risk_tier)
tier=$(printf '%s' "$tier" | sed -e 's/^"//' -e 's/"$//'); [[ -z "$tier" ]] && tier="routine"

_ensure_prompt_dir
local pf; pf=$(_prompt_path reviewer)
{
  printf 'Review task %s in the worktree at %s.\n' "$task_id" "$wt"
  printf 'End your response with exactly one of:\n'
  printf '  STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT\n'
} > "$pf"

# Slot 1: implementation-reviewer (spec alignment)
local agents_json
agents_json=$(jq -c -n --arg pf "$pf" \
  '[{subagent_type:"implementation-reviewer", isolation:"worktree", model:"sonnet", maxTurns:30, prompt_file:$pf}]')

# Slot 2: quality reviewer — Codex preferred
if [[ "$provider" == "codex" ]]; then
  local review_file="$run_dir/.state/$run_id/$task_id.review.codex.json"
  local spec_path; spec_path=$(pipeline-state read "$run_id" '.spec.path // ""' 2>/dev/null || printf '')
  local cargs=(--base staging --task-id "$task_id"); [[ -n "$spec_path" ]] && cargs+=(--spec-dir "$spec_path")
  if ! pipeline-codex-review "${cargs[@]}" > "$review_file"; then
    log_warn "codex review failed for $task_id"
    t1=$(_now_ms); log_step_end "postexec" "failed" "$((t1-t0))" "task_id=\"$task_id\"" "reason=\"codex\""
    return 30
  fi
  _task_write review_files "$(jq -n --arg f "$review_file" '[$f]')"
else
  agents_json=$(printf '%s' "$agents_json" | jq -c --arg pf "$pf" \
    '. + [{subagent_type:"quality-reviewer", isolation:"worktree", model:"sonnet", maxTurns:30, prompt_file:$pf}]')
fi

# Risk-tier additions
case "$tier" in
  feature)  agents_json=$(printf '%s' "$agents_json" | jq -c \
              --arg pf "$pf" '. + [{subagent_type:"architecture-reviewer", isolation:"worktree", model:"sonnet", maxTurns:30, prompt_file:$pf}]') ;;
  security) agents_json=$(printf '%s' "$agents_json" | jq -c \
              --arg pf "$pf" '. + [{subagent_type:"security-reviewer", isolation:"worktree", model:"sonnet", maxTurns:30, prompt_file:$pf},
                                   {subagent_type:"architecture-reviewer", isolation:"worktree", model:"sonnet", maxTurns:30, prompt_file:$pf}]') ;;
esac

_emit_manifest postreview "$agents_json"
t1=$(_now_ms)
log_step_end "postexec" "spawn" "$((t1-t0))" "task_id=\"$task_id\"" "reviewers=\"implementation+quality\""
return 10
```

- [ ] **Step 3: Run the pipeline tests**

```bash
for t in bin/tests/*.sh; do bash "$t"; done
# Expected: all pass
```

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-run-task
git commit -m "feat(pipeline): run implementation-reviewer and quality-reviewer in parallel"
```

---

## Task 12: Update skills/pipeline-orchestrator and skills/run-pipeline

**Files:**

- Modify: `skills/pipeline-orchestrator/SKILL.md`
- Modify: `skills/pipeline-orchestrator/reference/stage-taxonomy.md`
- Modify: `skills/run-pipeline/SKILL.md`
- Modify: `commands/run.md`

- [ ] **Step 1: Add two-phase flow documentation to run-pipeline skill**

In `skills/run-pipeline/SKILL.md`, locate the per-task flow section. Insert:

```markdown
### Per-task execution flow

Each task runs through these stages in order:

1. `preexec` — quota check, state write
2. `preexec_tests` — **test-writer** (mode=pre-impl) writes failing tests from spec and commits RED
3. `exec` — **task-executor** writes minimal impl that turns tests green and commits GREEN
4. `postexec` — format + lint, then quality gates in order:
   - `pipeline-quality-gate` — project lint/typecheck/test commands
   - `pipeline-tdd-gate` — test-before-impl commit-order validation
   - `pipeline-coverage-gate` — coverage delta
   - holdout (if applicable) and mutation (if configured)
5. `postreview` — two reviewers run in parallel:
   - **implementation-reviewer** verifies the code satisfies spec intent
   - **quality-reviewer** (Codex preferred; fallback to the `quality-reviewer` agent) adversarial code quality review
6. `ship` — merge / PR
```

- [ ] **Step 2: Update stage taxonomy**

Add `preexec_tests` to the canonical stage list in `skills/pipeline-orchestrator/reference/stage-taxonomy.md`.

- [ ] **Step 3: Update command doc**

In `commands/run.md`, locate the stage-list section and add `preexec_tests` between `preexec` and `exec`.

- [ ] **Step 4: Run orchestrator tests**

```bash
bash bin/tests/run-command.sh
# Expected: pass
```

- [ ] **Step 5: Commit**

```bash
git add skills/run-pipeline skills/pipeline-orchestrator commands/run.md
git commit -m "docs(pipeline): document two-phase TDD flow + tdd-gate + parallel reviewers"
```

---

## Task 13: Update plugin root CLAUDE.md + version bump

**Files:**

- Modify: `CLAUDE.md` (plugin root)
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Append TDD section to CLAUDE.md**

If the file does not exist, create it. Append:

```markdown
## Testing Discipline

This plugin enforces test-driven development (TDD) at the harness layer:

- Tasks run through two phases: `test-writer` commits failing tests first, then `task-executor` commits the minimal implementation.
- `pipeline-tdd-gate` enforces test-before-impl commit ordering. Violations block the task.
- See `skills/test-driven-development/SKILL.md` for the full discipline.
- Opt-out per task via `tdd_exempt: true` in the spec's `tasks.json`; globally via `package.json.dark-factory.tddExempt`.

Reviewer roles:

- `implementation-reviewer` — spec alignment: does the code address the spec, not just pass tests?
- `quality-reviewer` — adversarial code quality; Codex is the preferred executor when available.
```

- [ ] **Step 2: Bump version**

In `.claude-plugin/plugin.json`, change `"version": "0.3.6"` to `"version": "0.4.0"`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md .claude-plugin/plugin.json
git commit -m "docs: document TDD enforcement and reviewer split; bump to 0.4.0"
```

---

## Task 14: Full regression pass

- [ ] **Step 1: Run every shell test**

```bash
set -e
for t in bin/tests/*.sh; do
  printf '\n=== %s ===\n' "$t"
  bash "$t"
done
```

Expected: all pass.

- [ ] **Step 2: Shellcheck all bin/ scripts**

```bash
shellcheck bin/pipeline-* bin/tests/*.sh hooks/*.sh
# Expected: no output
```

- [ ] **Step 3: Final grep sanity**

```bash
grep -rn 'task-reviewer\|code-reviewer\|task_reviewer\|code_reviewer' . \
  --exclude-dir=.git --exclude-dir=node_modules \
  --exclude-dir='docs/superpowers/specs' \
  --exclude-dir='docs/superpowers/plans'
# Expected: no matches
```

- [ ] **Step 4: Commit any stragglers**

```bash
git status
# If anything is still uncommitted, commit it in this task with a descriptive message.
```

---

## Self-Review Results

- **Spec coverage:** every section of the design doc is covered by a task (skill port → T1; two-phase execution → T7/T8/T9; tdd-gate → T2/T3/T10; reviewer rename → T4/T5; reviewer routing → T6/T11; wiring/docs → T12/T13; model config captured in T9 prompt file and T7 body).
- **Placeholder scan:** no TBD / TODO / "implement later" left in the plan body; every code block is runnable.
- **Type consistency:** agent names (`implementation-reviewer`, `quality-reviewer`) are used consistently from T4 onward; stage name `preexec_tests` is used identically across T9 and T12; commit-tag format `[<task_id>]` matches the gate's grep pattern in T3.
- **Risk:** Task 9's stage-transition edit depends on orchestrator internals that may have evolved. If the stage machine lives in `skills/pipeline-orchestrator/reference/legacy-per-task-protocol.md` or elsewhere, the executing agent must find the actual dispatch and wire the new stage there — the plan gives the shape, not the exact lines.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-24-tdd-enforcement.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
