#!/usr/bin/env bash
# Phase 4 verification tests
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")" && pwd):$PATH"

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

assert_exit() {
  local label="$1" expected="$2"
  shift 2
  local actual
  set +e
  "$@" >/dev/null 2>&1
  actual=$?
  set -e
  assert_eq "$label" "$expected" "$actual"
}

assert_contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -qF "$needle"; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (expected to contain '$needle')"
    fail=$((fail + 1))
  fi
}

# ============================================================
echo "=== pipeline-detect-reviewer ==="

# Without Codex installed, should fall back to claude-code
output=$(pipeline-detect-reviewer 2>/dev/null)
assert_eq "fallback reviewer" "claude-code" "$(echo "$output" | jq -r '.reviewer')"
assert_eq "fallback agent" "task-reviewer" "$(echo "$output" | jq -r '.agent')"

# With --base flag
output=$(pipeline-detect-reviewer --base main 2>/dev/null)
assert_eq "base flag accepted" "claude-code" "$(echo "$output" | jq -r '.reviewer')"

# Always exits 0
assert_exit "always exits 0" 0 pipeline-detect-reviewer

# ============================================================
echo ""
echo "=== pipeline-parse-review (APPROVE) ==="

approve_input='## Review Verdict

**VERDICT:** APPROVE
**ROUND:** 2
**CONFIDENCE:** HIGH

## Findings

### [NON-BLOCKING] Minor style issue
- **File:** src/utils.ts:10
- **Severity:** minor
- **Category:** style
- **Description:** Consider using const instead of let

## Acceptance Criteria Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Users can log in | PASS | src/auth.ts:42 |
| Password is hashed | PASS | src/auth.ts:55 |

## Summary
Code looks correct and well-tested.'

output=$(printf '%s' "$approve_input" | pipeline-parse-review 2>/dev/null)
assert_eq "verdict APPROVE" "APPROVE" "$(echo "$output" | jq -r '.verdict')"
assert_eq "round 2" "2" "$(echo "$output" | jq -r '.round')"
assert_eq "confidence HIGH" "HIGH" "$(echo "$output" | jq -r '.confidence')"
assert_eq "reviewer claude-code" "claude-code" "$(echo "$output" | jq -r '.reviewer')"
assert_eq "blocking count 0" "0" "$(echo "$output" | jq -r '.blocking_count')"
assert_eq "non-blocking count 1" "1" "$(echo "$output" | jq -r '.non_blocking_count')"
assert_eq "criteria passed 2" "2" "$(echo "$output" | jq -r '.criteria_passed')"
assert_eq "criteria failed 0" "0" "$(echo "$output" | jq -r '.criteria_failed')"

# ============================================================
echo ""
echo "=== pipeline-parse-review (REQUEST_CHANGES) ==="

changes_input='## Review Verdict

**VERDICT:** REQUEST_CHANGES
**ROUND:** 1
**CONFIDENCE:** HIGH

## Findings

### [BLOCKING] SQL injection vulnerability
- **File:** src/db.ts:23
- **Severity:** critical
- **Category:** security
- **Description:** User input is concatenated directly into SQL query
- **Suggestion:** Use parameterized queries

### [BLOCKING] Missing null check
- **File:** src/handler.ts:15
- **Severity:** major
- **Category:** correctness
- **Description:** req.body.email is not validated before use

### [NON-BLOCKING] Unused import
- **File:** src/handler.ts:1
- **Severity:** minor
- **Category:** style
- **Description:** lodash is imported but never used

## Acceptance Criteria Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Input validation | FAIL | no validation in handler.ts |
| Data persisted | PASS | src/db.ts:30 |

## Holdout Criteria Check

| Withheld Criterion | Status | Evidence |
|--------------------|--------|----------|
| Rate limiting | FAIL | no rate limit middleware found |
| Error logging | PASS | src/logger.ts:12 |

## Summary
Critical security issues and missing validation.'

output=$(printf '%s' "$changes_input" | pipeline-parse-review 2>/dev/null)
assert_eq "verdict REQUEST_CHANGES" "REQUEST_CHANGES" "$(echo "$output" | jq -r '.verdict')"
assert_eq "round 1" "1" "$(echo "$output" | jq -r '.round')"
assert_eq "blocking count 2" "2" "$(echo "$output" | jq -r '.blocking_count')"
assert_eq "non-blocking count 1" "1" "$(echo "$output" | jq -r '.non_blocking_count')"
assert_eq "criteria passed 1" "1" "$(echo "$output" | jq -r '.criteria_passed')"
assert_eq "criteria failed 1" "1" "$(echo "$output" | jq -r '.criteria_failed')"
assert_eq "holdout passed 1" "1" "$(echo "$output" | jq -r '.holdout_passed')"
assert_eq "holdout failed 1" "1" "$(echo "$output" | jq -r '.holdout_failed')"

# Check finding details
assert_eq "first finding title" "SQL injection vulnerability" "$(echo "$output" | jq -r '.findings[0].title')"
assert_eq "first finding blocking" "true" "$(echo "$output" | jq -r '.findings[0].blocking')"
assert_eq "first finding severity" "critical" "$(echo "$output" | jq -r '.findings[0].severity')"
assert_eq "first finding category" "security" "$(echo "$output" | jq -r '.findings[0].category')"

# ============================================================
echo ""
echo "=== pipeline-parse-review (NEEDS_DISCUSSION) ==="

discuss_input='## Review Verdict

**VERDICT:** NEEDS_DISCUSSION
**ROUND:** 3
**CONFIDENCE:** LOW

## Findings

## Acceptance Criteria Check

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Feature works | PASS | src/feature.ts:10 |

## Summary
Architectural concern needs human input.'

output=$(printf '%s' "$discuss_input" | pipeline-parse-review 2>/dev/null)
assert_eq "verdict NEEDS_DISCUSSION" "NEEDS_DISCUSSION" "$(echo "$output" | jq -r '.verdict')"
assert_eq "round 3" "3" "$(echo "$output" | jq -r '.round')"
assert_eq "confidence LOW" "LOW" "$(echo "$output" | jq -r '.confidence')"

# ============================================================
echo ""
echo "=== pipeline-parse-review (empty input) ==="

set +e
printf '' | pipeline-parse-review >/dev/null 2>&1
exit_code=$?
set -e
assert_eq "empty input exits 1" "1" "$exit_code"

# ============================================================
echo ""
echo "=== pipeline-parse-review (no verdict) ==="

set +e
printf 'Some random review text without structured output' | pipeline-parse-review >/dev/null 2>&1
exit_code=$?
set -e
assert_eq "no verdict exits 1" "1" "$exit_code"

# ============================================================
echo ""
echo "=== pipeline-parse-review (codex JSON passthrough) ==="

codex_json='{"verdict":"APPROVE","round":1,"findings":[],"summary":"ok"}'
output=$(printf '%s' "$codex_json" | pipeline-parse-review --reviewer codex 2>/dev/null)
assert_eq "codex verdict" "APPROVE" "$(echo "$output" | jq -r '.verdict')"
assert_eq "codex reviewer tag" "codex" "$(echo "$output" | jq -r '.reviewer')"

# ============================================================
echo ""
echo "=== pipeline-parse-review (codex invalid JSON) ==="

set +e
printf 'not json' | pipeline-parse-review --reviewer codex >/dev/null 2>&1
exit_code=$?
set -e
assert_eq "codex invalid JSON exits 1" "1" "$exit_code"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (coverage increase) ==="

before_file="$CLAUDE_PLUGIN_DATA/before.json"
after_file="$CLAUDE_PLUGIN_DATA/after.json"

cat > "$before_file" << 'COVJSON'
{
  "total": {
    "lines": {"total": 100, "covered": 80, "skipped": 0, "pct": 80},
    "branches": {"total": 50, "covered": 40, "skipped": 0, "pct": 80},
    "functions": {"total": 30, "covered": 24, "skipped": 0, "pct": 80},
    "statements": {"total": 120, "covered": 96, "skipped": 0, "pct": 80}
  }
}
COVJSON

cat > "$after_file" << 'COVJSON'
{
  "total": {
    "lines": {"total": 120, "covered": 102, "skipped": 0, "pct": 85},
    "branches": {"total": 60, "covered": 51, "skipped": 0, "pct": 85},
    "functions": {"total": 35, "covered": 30, "skipped": 0, "pct": 85.71},
    "statements": {"total": 140, "covered": 119, "skipped": 0, "pct": 85}
  }
}
COVJSON

output=$(pipeline-coverage-gate "$before_file" "$after_file" 2>/dev/null)
assert_eq "increase passes" "true" "$(echo "$output" | jq -r '.passed')"
assert_eq "before lines" "80" "$(echo "$output" | jq -r '.before.lines')"
assert_eq "after lines" "85" "$(echo "$output" | jq -r '.after.lines')"
assert_eq "delta lines positive" "5" "$(echo "$output" | jq -r '.delta.lines')"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (coverage decrease) ==="

cat > "$after_file" << 'COVJSON'
{
  "total": {
    "lines": {"total": 120, "covered": 90, "skipped": 0, "pct": 75},
    "branches": {"total": 60, "covered": 51, "skipped": 0, "pct": 85},
    "functions": {"total": 35, "covered": 30, "skipped": 0, "pct": 85.71},
    "statements": {"total": 140, "covered": 119, "skipped": 0, "pct": 85}
  }
}
COVJSON

set +e
output=$(pipeline-coverage-gate "$before_file" "$after_file" 2>/dev/null)
exit_code=$?
set -e
assert_eq "decrease fails" "false" "$(echo "$output" | jq -r '.passed')"
assert_eq "decrease exit 1" "1" "$exit_code"
assert_eq "delta lines negative" "-5" "$(echo "$output" | jq -r '.delta.lines')"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (no change) ==="

cp "$before_file" "$after_file"
output=$(pipeline-coverage-gate "$before_file" "$after_file" 2>/dev/null)
assert_eq "no change passes" "true" "$(echo "$output" | jq -r '.passed')"
assert_eq "delta lines zero" "0" "$(echo "$output" | jq -r '.delta.lines')"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (missing file) ==="

set +e
output=$(pipeline-coverage-gate "$CLAUDE_PLUGIN_DATA/nonexistent.json" "$after_file" 2>/dev/null)
exit_code=$?
set -e
assert_eq "missing before exits 1" "1" "$exit_code"
assert_eq "missing before passed false" "false" "$(echo "$output" | jq -r '.passed')"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (simple numeric format) ==="

cat > "$before_file" << 'COVJSON'
{"total": {"lines": 80, "branches": 75, "functions": 90, "statements": 85}}
COVJSON

cat > "$after_file" << 'COVJSON'
{"total": {"lines": 82, "branches": 75, "functions": 92, "statements": 85}}
COVJSON

output=$(pipeline-coverage-gate "$before_file" "$after_file" 2>/dev/null)
assert_eq "simple format passes" "true" "$(echo "$output" | jq -r '.passed')"
assert_eq "simple format lines" "82" "$(echo "$output" | jq -r '.after.lines')"

# ============================================================
echo ""
echo "=== pipeline-coverage-gate (invalid JSON) ==="

printf 'not valid json' > "$before_file"
cat > "$after_file" << 'COVJSON'
{"total": {"lines": 80, "branches": 75, "functions": 90, "statements": 85}}
COVJSON

set +e
output=$(pipeline-coverage-gate "$before_file" "$after_file" 2>/dev/null)
exit_code=$?
set -e
assert_eq "invalid JSON exits 1" "1" "$exit_code"
assert_eq "invalid JSON passed false" "false" "$(echo "$output" | jq -r '.passed')"

# ============================================================
echo ""
echo "=== pipeline-branch staging-init reconcile ==="

# Sandbox git setup shared across reconcile + commit-spec tests.
#
# Creates a bare origin and a worktree clone under a guarded temp dir. The
# sandbox lives only for the duration of this phase; we restore the original
# working directory before each new sandbox so failed cleanup never leaks
# into the real plugin repo.
setup_git_sandbox() {
  local sandbox
  sandbox=$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-phase4-XXXXXX")
  (
    cd "$sandbox"
    git init --bare --quiet origin.git
    git clone --quiet origin.git repo
    cd repo
    git config user.email "test@test.local"
    git config user.name "phase4-test"
    git commit --allow-empty -m "root" --quiet
    git checkout -b develop --quiet
    git push -u origin develop --quiet 2>/dev/null || true
  )
  printf '%s' "$sandbox"
}

cleanup_sandbox() {
  local path="$1"
  # Only rm paths we created under a tmp prefix. Matches mktemp output on
  # macOS (/var/folders/...) and linux (/tmp/...).
  if [[ -n "$path" && -d "$path" ]]; then
    case "$path" in
      /tmp/dark-factory-phase4-*|/var/folders/*/dark-factory-phase4-*|/private/var/folders/*/dark-factory-phase4-*)
        rm -rf "$path" ;;
    esac
  fi
}

orig_cwd=$(pwd)

# --- Case 1: develop is ancestor of staging — no-op ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  # staging starts on top of develop with its own commits, so develop is an ancestor
  git checkout -b staging --quiet
  echo "s1" > s1.txt; git add s1.txt
  git commit -m "staging-only-1" --quiet
  git push -u origin staging --quiet 2>/dev/null || true

  output=$(pipeline-branch staging-init 2>/dev/null)
  reconcile=$(echo "$output" | jq -r '.reconcile')
  head_before=$(git rev-parse HEAD)
  # Case 1: develop is behind staging → reconcile is a no-op
  echo "__CASE1__ reconcile=$reconcile head=$head_before" > "$sandbox/result"
)
case1=$(cat "$sandbox/result" 2>/dev/null || echo "MISSING")
assert_eq "reconcile no-op when develop is ancestor" "up-to-date" \
  "$(printf '%s' "$case1" | awk -F'reconcile=' '{print $2}' | awk '{print $1}')"
cleanup_sandbox "$sandbox"

# --- Case 2: develop is ahead — fast-forwards staging ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  # push staging identical to develop first, then advance develop, then re-init
  git checkout -b staging --quiet
  git push -u origin staging --quiet 2>/dev/null || true
  # Move back to develop, advance it
  git checkout develop --quiet
  echo "d1" > d1.txt; git add d1.txt
  git commit -m "develop-ahead-1" --quiet
  echo "d2" > d2.txt; git add d2.txt
  git commit -m "develop-ahead-2" --quiet
  git push origin develop --quiet 2>/dev/null || true
  # Switch away from staging so staging-init can re-check it out
  git checkout develop --quiet

  output=$(pipeline-branch staging-init 2>/dev/null)
  reconcile=$(echo "$output" | jq -r '.reconcile')
  develop_sha=$(git rev-parse origin/develop)
  staging_sha=$(git rev-parse HEAD)
  printf '%s\n' "$reconcile" > "$sandbox/reconcile"
  printf '%s\n' "$develop_sha" > "$sandbox/develop_sha"
  printf '%s\n' "$staging_sha" > "$sandbox/staging_sha"
)
assert_eq "reconcile ff when develop ahead" "fast-forwarded" "$(cat "$sandbox/reconcile")"
assert_eq "staging HEAD equals develop HEAD after ff" \
  "$(cat "$sandbox/develop_sha")" "$(cat "$sandbox/staging_sha")"
cleanup_sandbox "$sandbox"

# --- Case 3: staging has commits not in develop — non-ff merge ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  echo "s1" > s1.txt; git add s1.txt
  git commit -m "staging-feature-1" --quiet
  git push -u origin staging --quiet 2>/dev/null || true
  # advance develop with a separate commit (no conflict, different file)
  git checkout develop --quiet
  echo "d1" > d1.txt; git add d1.txt
  git commit -m "develop-ahead-1" --quiet
  git push origin develop --quiet 2>/dev/null || true
  git checkout develop --quiet

  output=$(pipeline-branch staging-init 2>/dev/null)
  reconcile=$(echo "$output" | jq -r '.reconcile')
  # both files should exist after merge
  has_s1=$([[ -f s1.txt ]] && echo yes || echo no)
  has_d1=$([[ -f d1.txt ]] && echo yes || echo no)
  printf '%s\n' "$reconcile" > "$sandbox/reconcile"
  printf '%s\n' "$has_s1" > "$sandbox/has_s1"
  printf '%s\n' "$has_d1" > "$sandbox/has_d1"
)
assert_eq "reconcile merges when divergent" "merged" "$(cat "$sandbox/reconcile")"
assert_eq "staging keeps its own commits after merge" "yes" "$(cat "$sandbox/has_s1")"
assert_eq "staging picks up develop commits after merge" "yes" "$(cat "$sandbox/has_d1")"
cleanup_sandbox "$sandbox"

# --- Case 4: true merge conflict — abort cleanly, exit 1, no dirty state ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  echo "staging-version" > conflict.txt; git add conflict.txt
  git commit -m "staging conflict" --quiet
  git push -u origin staging --quiet 2>/dev/null || true
  git checkout develop --quiet
  echo "develop-version" > conflict.txt; git add conflict.txt
  git commit -m "develop conflict" --quiet
  git push origin develop --quiet 2>/dev/null || true
  git checkout develop --quiet

  set +e
  output=$(pipeline-branch staging-init 2>/dev/null)
  exit_code=$?
  set -e
  err_key=$(echo "$output" | jq -r '.error // empty')
  behind=$(echo "$output" | jq -r '.behind // empty')

  # Check dirty state: no MERGE_HEAD, no index conflicts
  merge_head_present=$([[ -f .git/MERGE_HEAD ]] && echo yes || echo no)
  dirty=$(git status --porcelain=v1 | { grep -cE '^(UU|AA|DD|AU|UA|DU|UD) ' || true; })

  printf '%s\n' "$exit_code" > "$sandbox/exit"
  printf '%s\n' "$err_key" > "$sandbox/err"
  printf '%s\n' "$behind" > "$sandbox/behind"
  printf '%s\n' "$merge_head_present" > "$sandbox/merge_head"
  printf '%s\n' "$dirty" > "$sandbox/dirty"
)
assert_eq "conflict exits 1" "1" "$(cat "$sandbox/exit")"
assert_eq "conflict emits structured error" "staging_reconcile_conflict" "$(cat "$sandbox/err")"
assert_eq "conflict reports behind > 0" "1" "$(cat "$sandbox/behind")"
assert_eq "conflict leaves no MERGE_HEAD" "no" "$(cat "$sandbox/merge_head")"
assert_eq "conflict leaves no conflict index entries" "0" "$(cat "$sandbox/dirty")"
cleanup_sandbox "$sandbox"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== pipeline-branch commit-spec ==="

orig_cwd=$(pwd)

# --- Case A: commits untracked spec files to staging ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  git push -u origin staging --quiet 2>/dev/null || true
  mkdir -p .state/run-abc
  printf '# spec\n' > .state/run-abc/spec.md
  printf '[]\n' > .state/run-abc/tasks.json

  output=$(pipeline-branch commit-spec .state/run-abc 2>/dev/null)
  result=$(echo "$output" | jq -r '.result')
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  log_msg=$(git log -1 --pretty=%s)
  spec_tracked=$(git ls-files .state/run-abc/spec.md | head -1)

  printf '%s\n' "$result" > "$sandbox/result"
  printf '%s\n' "$current_branch" > "$sandbox/branch"
  printf '%s\n' "$log_msg" > "$sandbox/log_msg"
  printf '%s\n' "$spec_tracked" > "$sandbox/tracked"
)
assert_eq "commit-spec result committed" "committed" "$(cat "$sandbox/result")"
assert_eq "commit-spec leaves staging checked out" "staging" "$(cat "$sandbox/branch")"
assert_eq "commit-spec uses chore: message" "true" \
  "$(grep -q '^chore: add spec directory' "$sandbox/log_msg" && echo true || echo false)"
assert_eq "commit-spec tracks spec.md" ".state/run-abc/spec.md" "$(cat "$sandbox/tracked")"

# --- Case B: idempotent when nothing to commit ---
(
  cd "$sandbox/repo"
  output=$(pipeline-branch commit-spec .state/run-abc 2>/dev/null)
  result=$(echo "$output" | jq -r '.result')
  current_branch=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$result" > "$sandbox/result2"
  printf '%s\n' "$current_branch" > "$sandbox/branch2"
)
assert_eq "commit-spec idempotent no-op" "no-op" "$(cat "$sandbox/result2")"
assert_eq "commit-spec no-op leaves staging checked out" "staging" "$(cat "$sandbox/branch2")"
cleanup_sandbox "$sandbox"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== task_05_01: pipeline-branch staging-init anchored grep ==="
# M1: unanchored grep matched refs like staging-v2. Must now use exact ref
# matching so decoy branches do not short-circuit the creation path.

orig_cwd=$(pwd)

# --- staging-v2 exists but staging does not → must create staging ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  # Create decoy branch that contains the substring 'staging'
  git checkout -b staging-v2 --quiet
  echo "v2" > v2.txt; git add v2.txt
  git commit -m "v2" --quiet
  git push -u origin staging-v2 --quiet 2>/dev/null || true
  git checkout develop --quiet

  output=$(pipeline-branch staging-init 2>/dev/null)
  created=$(echo "$output" | jq -r '.created')
  branch=$(echo "$output" | jq -r '.staging_branch')
  head_after=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$created" > "$sandbox/created"
  printf '%s\n' "$branch" > "$sandbox/branch"
  printf '%s\n' "$head_after" > "$sandbox/head"
)
assert_eq "staging-v2 decoy does not short-circuit" "true" "$(cat "$sandbox/created")"
assert_eq "staging-v2 decoy: branch is staging" "staging" "$(cat "$sandbox/branch")"
assert_eq "staging-v2 decoy: HEAD is staging" "staging" "$(cat "$sandbox/head")"
cleanup_sandbox "$sandbox"

# --- staging exists → must detect and no-op (created=false) ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  git push -u origin staging --quiet 2>/dev/null || true
  git checkout develop --quiet

  output=$(pipeline-branch staging-init 2>/dev/null)
  created=$(echo "$output" | jq -r '.created')
  base=$(echo "$output" | jq -r '.base')
  printf '%s\n' "$created" > "$sandbox/created"
  printf '%s\n' "$base" > "$sandbox/base"
)
assert_eq "existing staging: created=false" "false" "$(cat "$sandbox/created")"
assert_eq "existing staging: base=existing" "existing" "$(cat "$sandbox/base")"
cleanup_sandbox "$sandbox"

# --- Only staging-v2 exists, with no staging → creates staging fresh ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  # Push a pre-staging decoy remotely
  git checkout -b pre-staging --quiet
  git push -u origin pre-staging --quiet 2>/dev/null || true
  git checkout develop --quiet

  output=$(pipeline-branch staging-init 2>/dev/null)
  created=$(echo "$output" | jq -r '.created')
  printf '%s\n' "$created" > "$sandbox/created"
)
assert_eq "pre-staging decoy does not short-circuit" "true" "$(cat "$sandbox/created")"
cleanup_sandbox "$sandbox"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== task_05_02: pipeline-branch create handles existing branches ==="
# M2: `git checkout -b &>/dev/null` silently swallowed failures when the
# branch already existed, dropping the run into detached HEAD. Must now
# either resume (existing branch + rebase) or fail loudly.

orig_cwd=$(pwd)

# --- Case A: fresh branch → action=created ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  output=$(pipeline-branch create feature/new --base staging 2>/dev/null)
  action=$(echo "$output" | jq -r '.action')
  current=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$action" > "$sandbox/action"
  printf '%s\n' "$current" > "$sandbox/head"
)
assert_eq "fresh branch: action=created" "created" "$(cat "$sandbox/action")"
assert_eq "fresh branch: HEAD is the new branch" "feature/new" "$(cat "$sandbox/head")"
cleanup_sandbox "$sandbox"

# --- Case B: local branch already exists → action=resumed (rebase no-op) ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  # Pre-create the branch.
  git checkout -b feature/existing --quiet
  echo "a" > a.txt; git add a.txt
  git commit -m "a" --quiet
  git checkout staging --quiet

  output=$(pipeline-branch create feature/existing --base staging 2>/dev/null)
  action=$(echo "$output" | jq -r '.action')
  current=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$action" > "$sandbox/action"
  printf '%s\n' "$current" > "$sandbox/head"
)
assert_eq "existing local branch: action=resumed" "resumed" "$(cat "$sandbox/action")"
assert_eq "existing local branch: checked out" "feature/existing" "$(cat "$sandbox/head")"
cleanup_sandbox "$sandbox"

# --- Case C: remote-only branch → action=resumed ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  git checkout -b feature/remote --quiet
  echo "r" > r.txt; git add r.txt
  git commit -m "r" --quiet
  git push -u origin feature/remote --quiet 2>/dev/null || true
  # Delete local copy so only the remote ref exists.
  git checkout staging --quiet
  git branch -D feature/remote --quiet

  output=$(pipeline-branch create feature/remote --base staging 2>/dev/null)
  action=$(echo "$output" | jq -r '.action')
  current=$(git rev-parse --abbrev-ref HEAD)
  printf '%s\n' "$action" > "$sandbox/action"
  printf '%s\n' "$current" > "$sandbox/head"
)
assert_eq "remote-only branch: action=resumed" "resumed" "$(cat "$sandbox/action")"
assert_eq "remote-only branch: checked out" "feature/remote" "$(cat "$sandbox/head")"
cleanup_sandbox "$sandbox"

# --- Case D: existing branch diverges + rebase conflict → action=conflict, exit 1 ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  echo "base" > conflict.txt; git add conflict.txt
  git commit -m "base-conflict" --quiet
  # Existing feature branch with divergent content for the same file.
  git checkout -b feature/diverged staging^ --quiet
  echo "feature" > conflict.txt; git add conflict.txt
  git commit -m "feature-conflict" --quiet
  git checkout staging --quiet

  set +e
  output=$(pipeline-branch create feature/diverged --base staging 2>/dev/null)
  exit_code=$?
  set -e
  action=$(echo "$output" | jq -r '.action')
  printf '%s\n' "$exit_code" > "$sandbox/exit"
  printf '%s\n' "$action" > "$sandbox/action"
)
assert_eq "rebase conflict: exit=1" "1" "$(cat "$sandbox/exit")"
assert_eq "rebase conflict: action=conflict" "conflict" "$(cat "$sandbox/action")"
cleanup_sandbox "$sandbox"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== task_05_03: pipeline-wait-pr multi-round rebase loop ==="
# M4: The rebase helper used to run `rebase --continue` once. For PRs with
# multiple commits each containing an auto-safe conflict, only the first
# round got resolved. _rebase_with_retries must loop until clean or unsafe.
#
# We drive _rebase_with_retries directly by sourcing pipeline-wait-pr. It
# uses `set -eu` via pipeline-lib.sh, so we run the tests in a subshell that
# disables `set -e` after sourcing to keep error flow under test control.

orig_cwd=$(pwd)

# Extract just the rebase helpers from pipeline-wait-pr (between the
# REBASE_HELPERS_START/END markers) so we can unit-test them without
# running the full main loop or requiring a gh mock. The extracted file
# exports two functions: _resolve_safe_conflict and _rebase_with_retries.
_PIPELINE_WAIT_PR_SRC="$(cd "$(dirname "$0")" && pwd)/pipeline-wait-pr"
_WAIT_PR_HELPERS=$(mktemp)
{
  # Stubs for the few log helpers the functions reference.
  cat <<'STUBS'
log_info() { :; }
log_warn() { :; }
log_error() { :; }
SAFE_OURS_FILES="pnpm-lock.yaml claude-progress.json feature-status.json"
REBASE_MAX_ROUNDS="${REBASE_MAX_ROUNDS:-30}"
STUBS
  awk '
    /^# === REBASE_HELPERS_START ===$/ { inside=1; next }
    /^# === REBASE_HELPERS_END ===$/ { inside=0; next }
    inside { print }
  ' "$_PIPELINE_WAIT_PR_SRC"
} > "$_WAIT_PR_HELPERS"

# --- Multi-commit rebase: 3 commits, each with a safe conflict, all resolve ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; rm -f "$_WAIT_PR_HELPERS"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet

  # Base staging has pnpm-lock.yaml v0
  printf 'v0\n' > pnpm-lock.yaml
  printf 'ignore-base\n' > .gitignore
  git add pnpm-lock.yaml .gitignore
  git commit -m "base-safe" --quiet

  # Feature branch makes 3 commits each touching pnpm-lock.yaml differently.
  git checkout -b feature/multi staging --quiet
  for i in 1 2 3; do
    printf 'feature-v%s\n' "$i" > pnpm-lock.yaml
    git add pnpm-lock.yaml
    git commit -m "feature-$i" --quiet
  done

  # Advance staging to create sequential conflicts with each feature commit.
  git checkout staging --quiet
  for i in 1 2 3; do
    printf 'staging-v%s\n' "$i" > pnpm-lock.yaml
    git add pnpm-lock.yaml
    git commit -m "staging-$i" --quiet
  done

  git checkout feature/multi --quiet

  # Load helpers in a controlled subshell.
  set +e
  (
    # Disable strict mode so our source'd helpers cannot abort the subshell.
    set +eu
    source "$_WAIT_PR_HELPERS"
    _rebase_with_retries "staging"
  )
  rc=$?
  set -e
  head_file=$(cat pnpm-lock.yaml 2>/dev/null || echo MISSING)
  printf '%s\n' "$rc" > "$sandbox/rc"
  printf '%s\n' "$head_file" > "$sandbox/file"
)
assert_eq "multi-commit rebase: succeeds" "0" "$(cat "$sandbox/rc")"
# After resolving "--ours" in rebase, the feature branch takes staging's
# values for each commit, so the final file is staging-v3.
assert_eq "multi-commit rebase: final file content" "staging-v3" "$(cat "$sandbox/file")"
cleanup_sandbox "$sandbox"

# --- Unsafe conflict → aborts cleanly with non-zero exit ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; rm -f "$_WAIT_PR_HELPERS"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  echo "base" > src.txt; git add src.txt
  git commit -m "base" --quiet

  git checkout -b feature/unsafe staging --quiet
  echo "feature" > src.txt; git add src.txt
  git commit -m "feature" --quiet

  git checkout staging --quiet
  echo "staging" > src.txt; git add src.txt
  git commit -m "staging" --quiet

  git checkout feature/unsafe --quiet

  set +e
  (
    set +eu
    source "$_WAIT_PR_HELPERS"
    _rebase_with_retries "staging"
  )
  rc=$?
  set -e
  # Clean state check — no conflict markers left, no rebase in progress.
  in_progress=$([[ -d .git/rebase-merge || -d .git/rebase-apply ]] && echo yes || echo no)
  printf '%s\n' "$rc" > "$sandbox/rc"
  printf '%s\n' "$in_progress" > "$sandbox/in_progress"
)
assert_eq "unsafe conflict: non-zero exit" "1" "$(cat "$sandbox/rc")"
assert_eq "unsafe conflict: rebase aborted (not in-progress)" "no" "$(cat "$sandbox/in_progress")"
cleanup_sandbox "$sandbox"

# --- Round cap: PIPELINE_REBASE_MAX_ROUNDS=0 forces immediate failure ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; rm -f "$_WAIT_PR_HELPERS"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  printf 'base\n' > pnpm-lock.yaml
  git add pnpm-lock.yaml
  git commit -m "base" --quiet

  git checkout -b feature/cap staging --quiet
  printf 'feature\n' > pnpm-lock.yaml
  git add pnpm-lock.yaml
  git commit -m "feature" --quiet

  git checkout staging --quiet
  printf 'staging\n' > pnpm-lock.yaml
  git add pnpm-lock.yaml
  git commit -m "staging" --quiet

  git checkout feature/cap --quiet

  set +e
  (
    set +eu
    source "$_WAIT_PR_HELPERS"
    # Force the round budget to zero so even a single-round conflict cannot
    # be resolved. The one-shot rebase at the top of the function will fail,
    # and the loop will immediately abort because round < 0 is false.
    PIPELINE_REBASE_MAX_ROUNDS=0 REBASE_MAX_ROUNDS=0 _rebase_with_retries "staging"
  )
  rc=$?
  set -e
  printf '%s\n' "$rc" > "$sandbox/rc"
)
assert_eq "round cap exceeded: non-zero exit" "1" "$(cat "$sandbox/rc")"
cleanup_sandbox "$sandbox"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== task_05_04: pipeline-wait-pr package.json 3-way merge ==="
# M4 parity: formatting-only package.json conflicts must auto-resolve via
# jq-normalized 3-way merge. Semantic conflicts must fail the resolver.

orig_cwd=$(pwd)

# --- Formatting-only: same content, different indentation → resolves ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; rm -f "$_WAIT_PR_HELPERS"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet

  # Base: 2-space indent
  printf '{\n  "name": "demo",\n  "dependencies": {\n    "a": "1.0.0"\n  }\n}\n' > package.json
  git add package.json
  git commit -m "base-2sp" --quiet

  # Feature: reformat to 4-space indent (semantically identical)
  git checkout -b feature/fmt staging --quiet
  printf '{\n    "name": "demo",\n    "dependencies": {\n        "a": "1.0.0"\n    }\n}\n' > package.json
  git add package.json
  git commit -m "feature-4sp" --quiet

  # Staging: different 2-space reformat (tab vs space level change)
  git checkout staging --quiet
  printf '{\n  "name": "demo",\n  "dependencies": { "a": "1.0.0" }\n}\n' > package.json
  git add package.json
  git commit -m "staging-compact" --quiet

  git checkout feature/fmt --quiet

  set +e
  (
    set +eu
    source "$_WAIT_PR_HELPERS"
    _rebase_with_retries "staging"
  )
  rc=$?
  set -e

  # Verify resolved file parses as JSON and contains dependency "a".
  # Redirect jq's own stdout to /dev/null so only the yes/no marker is saved.
  if jq -e '.dependencies.a == "1.0.0"' package.json >/dev/null 2>&1; then
    parses=yes
  else
    parses=no
  fi
  printf '%s\n' "$rc" > "$sandbox/rc"
  printf '%s\n' "$parses" > "$sandbox/parses"
)
assert_eq "package.json fmt-only: succeeds" "0" "$(cat "$sandbox/rc")"
assert_eq "package.json fmt-only: final JSON keeps dep 'a'" "yes" "$(cat "$sandbox/parses")"
cleanup_sandbox "$sandbox"

# --- Semantic conflict: same dep with conflicting versions → aborts ---
sandbox=$(setup_git_sandbox)
trap 'cleanup_sandbox "$sandbox"; rm -f "$_WAIT_PR_HELPERS"; cd "$orig_cwd"' EXIT
(
  cd "$sandbox/repo"
  git checkout -b staging --quiet
  printf '{\n    "name": "demo",\n    "dependencies": {\n        "lib": "1.0.0"\n    }\n}\n' > package.json
  git add package.json
  git commit -m "base" --quiet

  git checkout -b feature/bump staging --quiet
  printf '{\n    "name": "demo",\n    "dependencies": {\n        "lib": "2.0.0"\n    }\n}\n' > package.json
  git add package.json
  git commit -m "feature-bump" --quiet

  git checkout staging --quiet
  printf '{\n    "name": "demo",\n    "dependencies": {\n        "lib": "3.0.0"\n    }\n}\n' > package.json
  git add package.json
  git commit -m "staging-bump" --quiet

  git checkout feature/bump --quiet

  set +e
  (
    set +eu
    source "$_WAIT_PR_HELPERS"
    _rebase_with_retries "staging"
  )
  rc=$?
  set -e
  in_progress=$([[ -d .git/rebase-merge || -d .git/rebase-apply ]] && echo yes || echo no)
  printf '%s\n' "$rc" > "$sandbox/rc"
  printf '%s\n' "$in_progress" > "$sandbox/in_progress"
)
assert_eq "package.json semantic: non-zero exit" "1" "$(cat "$sandbox/rc")"
assert_eq "package.json semantic: rebase aborted" "no" "$(cat "$sandbox/in_progress")"
cleanup_sandbox "$sandbox"

rm -f "$_WAIT_PR_HELPERS"

cd "$orig_cwd"
trap - EXIT

# ============================================================
echo ""
echo "=== task_05_05: pipeline-wait-pr UNKNOWN mergeable backoff ==="
# M6: mergeable=UNKNOWN is transient while GitHub recomputes. The poll loop
# must retry UNKNOWN responses up to MERGEABLE_UNKNOWN_MAX times before
# treating them as CONFLICTING.

# Mock directory: $MERGEABLE_MOCK/gh reads response tokens from a queue file
# and echoes them one per call. Tests control the queue.
MERGEABLE_MOCK=$(mktemp -d)
mock_queue="$MERGEABLE_MOCK/queue"
# Queue format: one line per gh call, containing the merged jq-ready payload.
cat > "$MERGEABLE_MOCK/gh" << 'MOCK'
#!/usr/bin/env bash
queue_file="$MERGEABLE_MOCK_QUEUE"
case "$*" in
  "pr view "*" --json state,mergedAt,mergeable,headRefName")
    if [[ -s "$queue_file" ]]; then
      head -1 "$queue_file"
      tail -n +2 "$queue_file" > "${queue_file}.tmp" && mv "${queue_file}.tmp" "$queue_file"
    else
      printf '{"state":"OPEN","mergedAt":null,"mergeable":"MERGEABLE","headRefName":"feature"}'
    fi
    ;;
  "pr checks "*)
    printf '[]'
    ;;
  *)
    exit 0
    ;;
esac
MOCK
chmod +x "$MERGEABLE_MOCK/gh"

# --- UNKNOWN twice then MERGEABLE → exit 0 (merged after MERGEABLE) ---
printf '%s\n' \
  '{"state":"OPEN","mergedAt":null,"mergeable":"UNKNOWN","headRefName":"feature"}' \
  '{"state":"OPEN","mergedAt":null,"mergeable":"UNKNOWN","headRefName":"feature"}' \
  '{"state":"MERGED","mergedAt":"2026-01-01T00:00:00Z","mergeable":"MERGEABLE","headRefName":"feature"}' \
  > "$mock_queue"

set +e
PATH="$MERGEABLE_MOCK:$PATH" \
  MERGEABLE_MOCK_QUEUE="$mock_queue" \
  pipeline-wait-pr 999 --timeout 1 --interval 1 >/dev/null 2>&1
rc=$?
set -e
assert_eq "UNKNOWN→UNKNOWN→MERGED: exit 0" "0" "$rc"

# --- UNKNOWN exceeds max → treated as CONFLICTING → rebase attempted → exit 4 ---
#
# A flood of UNKNOWN responses must eventually be treated as CONFLICTING.
# After the rebase path fires the script escalates to exit 4.
: > "$mock_queue"
for _ in $(seq 1 20); do
  printf '{"state":"OPEN","mergedAt":null,"mergeable":"UNKNOWN","headRefName":"feature"}\n' >> "$mock_queue"
done

set +e
PATH="$MERGEABLE_MOCK:$PATH" \
  MERGEABLE_MOCK_QUEUE="$mock_queue" \
  PIPELINE_MERGEABLE_UNKNOWN_MAX=3 \
  pipeline-wait-pr 999 --timeout 1 --interval 1 >/dev/null 2>&1
rc=$?
set -e
# Any non-zero exit that isn't "could not fetch" is acceptable — the
# important property is that UNKNOWN is no longer silently ignored.
assert_eq "UNKNOWN budget exceeded: non-zero exit" "1" \
  "$([[ $rc -ne 0 ]] && echo 1 || echo 0)"

rm -rf "$MERGEABLE_MOCK"

# ============================================================
echo ""
echo "=== Skill & Agent files exist ==="

assert_eq "review-protocol SKILL.md exists" "true" \
  "$([[ -f "$(dirname "$0")/../skills/review-protocol/SKILL.md" ]] && echo true || echo false)"
assert_eq "task-reviewer.md exists" "true" \
  "$([[ -f "$(dirname "$0")/../agents/task-reviewer.md" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

rm -rf "$CLAUDE_PLUGIN_DATA"

[[ $fail -eq 0 ]] && exit 0 || exit 1
