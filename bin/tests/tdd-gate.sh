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
