#!/usr/bin/env bash
# tdd-gate.sh — structural tests for bin/pipeline-tdd-gate.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$PLUGIN_ROOT/bin/pipeline-tdd-gate"

fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
pass() { printf 'PASS: %s\n' "$1"; }

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
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "test(x): failing [task-001]" "tests/x.test.ts"
  _commit "$repo" "feat(x): impl [task-001]"    "src/x.ts"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base staging )
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then fail "case1 expected exit 0, got $rc"; fi
  printf '%s' "$out" | jq -e '.ok == true' >/dev/null \
    || fail "case1 expected ok=true in JSON"
  pass "case1: test-before-impl passes gate"
}

# Test 2: fail case — impl commit without any preceding test-only commit.
case2() {
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "feat(x): impl [task-001]" "src/x.ts"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base staging )
  rc=$?
  set -e
  if [[ $rc -ne 1 ]]; then fail "case2 expected exit 1, got $rc"; fi
  printf '%s' "$out" | jq -e '.ok == false' >/dev/null \
    || fail "case2 expected ok=false in JSON"
  pass "case2: impl-without-test fails gate (exit 1, ok=false)"
}

# Test 3: skip case — diff is tests-only.
case3() {
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  _commit "$repo" "test(x): only tests [task-001]" "tests/x.test.ts"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base staging )
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then fail "case3 expected exit 0, got $rc"; fi
  printf '%s' "$out" | jq -e '.exempt == true' >/dev/null \
    || fail "case3 expected exempt=true in JSON"
  pass "case3: tests-only diff is exempt"
}

# Test 4: exempt case — tasks.json marks task as tdd_exempt.
case4() {
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  mkdir -p "$repo/specs/current"
  cat > "$repo/specs/current/tasks.json" <<JSON
{"tasks":[{"id":"task-001","tdd_exempt":true}]}
JSON
  ( cd "$repo" && git add specs && git -c user.email=t@t -c user.name=t commit -q -m "spec" )
  _commit "$repo" "feat(x): impl [task-001]" "src/x.ts"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base staging --spec-dir specs/current )
  rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then fail "case4 expected exit 0, got $rc"; fi
  printf '%s' "$out" | jq -e '.exempt == true' >/dev/null \
    || fail "case4 expected exempt=true in JSON"
  pass "case4: tdd_exempt flag respected"
}

case5() {
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  # Create a side branch, modify a file, then merge it into feat/task-001.
  ( cd "$repo"
    git checkout -q staging
    git checkout -q -b side
    printf 'y' > other.txt
    git add other.txt && git -c user.email=t@t -c user.name=t commit -q -m "side"
    git checkout -q feat/task-001
    git -c user.email=t@t -c user.name=t merge --no-ff -m "merge side [task-001]" side
  )
  _commit "$repo" "feat(x): impl [task-001]" "src/x.ts"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base staging )
  rc=$?
  set -e
  if [[ $rc -ne 1 ]]; then fail "case5 expected exit 1 (merge must not count as test-only), got $rc"; fi
  printf '%s' "$out" | jq -e '.ok == false' >/dev/null || fail "case5 expected ok=false"
  pass "case5: merge commit does not count as test-only"
}

case6() {
  local repo out rc; repo=$(mktemp -d); _mk_repo "$repo"
  set +e
  out=$( cd "$repo" && "$GATE" --task-id task-001 --base nonexistent-ref )
  rc=$?
  set -e
  if [[ $rc -ne 1 ]]; then fail "case6 expected exit 1 for missing base ref, got $rc"; fi
  printf '%s' "$out" | jq -e '.error == "base_ref_not_found"' >/dev/null \
    || fail "case6 expected error=base_ref_not_found"
  pass "case6: missing base ref errors with JSON"
}

case1; case2; case3; case4; case5; case6
printf 'all tdd-gate tests passed\n'
