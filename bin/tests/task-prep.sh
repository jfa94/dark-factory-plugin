#!/usr/bin/env bash
# task-prep.sh — pipeline-classify-task, pipeline-classify-risk,
# pipeline-validate-tasks (DAG + cycles), pipeline-branch naming,
# pipeline-scaffold, pipeline-build-prompt.
set -euo pipefail

export CLAUDE_PLUGIN_DATA=$(mktemp -d)
export PATH="$(cd "$(dirname "$0")/.." && pwd):$PATH"

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

echo "=== pipeline-classify-task ==="

# Simple: 1 file, 0 deps
output=$(pipeline-classify-task '{"files":["a.ts"],"depends_on":[]}' 2>/dev/null)
assert_eq "simple tier (1 file, 0 deps)" "simple" "$(echo "$output" | jq -r '.tier')"
assert_eq "simple model" "haiku" "$(echo "$output" | jq -r '.model')"
assert_eq "simple maxTurns" "40" "$(echo "$output" | jq -r '.maxTurns')"

# Medium: 2 files
output=$(pipeline-classify-task '{"files":["a.ts","b.ts"],"depends_on":[]}' 2>/dev/null)
assert_eq "medium tier (2 files)" "medium" "$(echo "$output" | jq -r '.tier')"
assert_eq "medium model" "sonnet" "$(echo "$output" | jq -r '.model')"
assert_eq "medium maxTurns" "60" "$(echo "$output" | jq -r '.maxTurns')"

# Medium: 1 file, 2 deps
output=$(pipeline-classify-task '{"files":["a.ts"],"depends_on":["t1","t2"]}' 2>/dev/null)
assert_eq "medium tier (2 deps)" "medium" "$(echo "$output" | jq -r '.tier')"

# Complex: 3 files
output=$(pipeline-classify-task '{"files":["a.ts","b.ts","c.ts"],"depends_on":[]}' 2>/dev/null)
assert_eq "complex tier (3 files)" "complex" "$(echo "$output" | jq -r '.tier')"
assert_eq "complex model" "opus" "$(echo "$output" | jq -r '.model')"
assert_eq "complex maxTurns" "80" "$(echo "$output" | jq -r '.maxTurns')"

# Complex: 3+ deps wins
output=$(pipeline-classify-task '{"files":["a.ts"],"depends_on":["t1","t2","t3"]}' 2>/dev/null)
assert_eq "complex tier (3 deps)" "complex" "$(echo "$output" | jq -r '.tier')"

# Max wins: medium files + complex deps
output=$(pipeline-classify-task '{"files":["a.ts","b.ts"],"depends_on":["t1","t2","t3"]}' 2>/dev/null)
assert_eq "complex wins over medium" "complex" "$(echo "$output" | jq -r '.tier')"

# Empty = simple
output=$(pipeline-classify-task '{"files":[],"depends_on":[]}' 2>/dev/null)
assert_eq "empty = simple" "simple" "$(echo "$output" | jq -r '.tier')"

# Null fields default gracefully
output=$(pipeline-classify-task '{}' 2>/dev/null)
assert_eq "null fields = simple" "simple" "$(echo "$output" | jq -r '.tier')"

# task_16_09: config overrides the tier→model mapping and maxTurns
printf '%s' '{"execution":{"modelByTier":{"simple":"sonnet"},"maxTurnsSimple":20}}' \
  > "$CLAUDE_PLUGIN_DATA/config.json"
output=$(pipeline-classify-task '{"files":["a.ts"],"depends_on":[]}' 2>/dev/null)
assert_eq "modelByTier.simple override wins over default haiku" "sonnet" \
  "$(echo "$output" | jq -r '.model')"
assert_eq "maxTurnsSimple override honored" "20" \
  "$(echo "$output" | jq -r '.maxTurns')"

# Unset config → compiled-in defaults haiku/40
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
output=$(pipeline-classify-task '{"files":["a.ts"],"depends_on":[]}' 2>/dev/null)
assert_eq "default simple model is haiku" "haiku" "$(echo "$output" | jq -r '.model')"
assert_eq "default simple maxTurns is 40" "40" "$(echo "$output" | jq -r '.maxTurns')"

echo ""
echo "=== pipeline-classify-risk ==="

# Security: auth
output=$(pipeline-classify-risk '{"files":["src/auth/handler.ts"]}' 2>/dev/null)
assert_eq "security (auth)" "security" "$(echo "$output" | jq -r '.tier')"
assert_eq "security rounds" "6" "$(echo "$output" | jq -r '.review_rounds')"
assert_eq "security reviewers count" "2" "$(echo "$output" | jq '.extra_reviewers | length')"

# Security: migration
output=$(pipeline-classify-risk '{"files":["db/migration/001.sql"]}' 2>/dev/null)
assert_eq "security (migration)" "security" "$(echo "$output" | jq -r '.tier')"

# Security: .env
output=$(pipeline-classify-risk '{"files":[".env.production"]}' 2>/dev/null)
assert_eq "security (.env)" "security" "$(echo "$output" | jq -r '.tier')"

# Security: payment
output=$(pipeline-classify-risk '{"files":["src/payment/stripe.ts"]}' 2>/dev/null)
assert_eq "security (payment)" "security" "$(echo "$output" | jq -r '.tier')"

# Feature: api
output=$(pipeline-classify-risk '{"files":["src/api/users.ts"]}' 2>/dev/null)
assert_eq "feature (api)" "feature" "$(echo "$output" | jq -r '.tier')"
assert_eq "feature rounds" "4" "$(echo "$output" | jq -r '.review_rounds')"

# Feature: routes
output=$(pipeline-classify-risk '{"files":["src/routes/index.ts"]}' 2>/dev/null)
assert_eq "feature (routes)" "feature" "$(echo "$output" | jq -r '.tier')"

# Feature: services
output=$(pipeline-classify-risk '{"files":["src/services/email.ts"]}' 2>/dev/null)
assert_eq "feature (services)" "feature" "$(echo "$output" | jq -r '.tier')"

# Routine: components
output=$(pipeline-classify-risk '{"files":["src/components/Button.tsx"]}' 2>/dev/null)
assert_eq "routine (components)" "routine" "$(echo "$output" | jq -r '.tier')"
assert_eq "routine rounds" "2" "$(echo "$output" | jq -r '.review_rounds')"

# Routine: empty
output=$(pipeline-classify-risk '{"files":[]}' 2>/dev/null)
assert_eq "routine (empty)" "routine" "$(echo "$output" | jq -r '.tier')"

# Security wins over feature in mixed
output=$(pipeline-classify-risk '{"files":["src/api/users.ts","src/auth/login.ts"]}' 2>/dev/null)
assert_eq "security wins mixed" "security" "$(echo "$output" | jq -r '.tier')"

# .env false positive: config.env.js should NOT be security
output=$(pipeline-classify-risk '{"files":["config.env.js"]}' 2>/dev/null)
assert_eq "config.env.js not security" "routine" "$(echo "$output" | jq -r '.tier')"

# .env true positive: .env.local IS security
output=$(pipeline-classify-risk '{"files":[".env.local"]}' 2>/dev/null)
assert_eq ".env.local is security" "security" "$(echo "$output" | jq -r '.tier')"

# .env true positive: nested .env
output=$(pipeline-classify-risk '{"files":["config/.env.production"]}' 2>/dev/null)
assert_eq "nested .env is security" "security" "$(echo "$output" | jq -r '.tier')"

echo ""
echo "=== task_13_01: pipeline-classify-risk reasoning accuracy ==="

# Routine file first, auth file second — reasoning must reference the auth file
output=$(pipeline-classify-risk '{"files":["src/components/Button.tsx","src/auth/handler.ts"]}' 2>/dev/null)
assert_eq "reasoning references auth file (not first file)" "true" \
  "$( echo "$output" | jq -r '.reasoning' | grep -q 'src/auth/handler.ts' && echo true || echo false )"
assert_eq "tier is security despite routine file first" "security" "$(echo "$output" | jq -r '.tier')"

# No matching patterns → reasoning says so
output=$(pipeline-classify-risk '{"files":["README.md"]}' 2>/dev/null)
assert_eq "no-match reasoning" "true" \
  "$( echo "$output" | jq -r '.reasoning' | grep -q 'no matching patterns' && echo true || echo false )"

echo ""
echo "=== task_13_07: classify-risk bare leading paths ==="

# auth/foo.ts (no prefix) must match security
output=$(pipeline-classify-risk '{"files":["auth/foo.ts"]}' 2>/dev/null)
assert_eq "bare auth/ → security" "security" "$(echo "$output" | jq -r '.tier')"

# api/routes.ts (no prefix) must match feature
output=$(pipeline-classify-risk '{"files":["api/routes.ts"]}' 2>/dev/null)
assert_eq "bare api/ → feature" "feature" "$(echo "$output" | jq -r '.tier')"

# Deep nested still works
output=$(pipeline-classify-risk '{"files":["a/b/c/auth/x.ts"]}' 2>/dev/null)
assert_eq "deep nested auth → security" "security" "$(echo "$output" | jq -r '.tier')"

echo ""
echo "=== pipeline-validate-tasks (valid DAG) ==="

tasks_dir=$(mktemp -d)
cat > "$tasks_dir/tasks.json" << 'EOF'
[
  {"task_id":"t1","title":"Setup","description":"Init","files":["a.ts"],"acceptance_criteria":["works"],"tests_to_write":["test1"],"depends_on":[]},
  {"task_id":"t2","title":"Build B","description":"Build B","files":["b.ts"],"acceptance_criteria":["works"],"tests_to_write":["test2"],"depends_on":["t1"]},
  {"task_id":"t3","title":"Build C","description":"Build C","files":["c.ts"],"acceptance_criteria":["works"],"tests_to_write":["test3"],"depends_on":["t1"]},
  {"task_id":"t4","title":"Integrate","description":"Wire up","files":["d.ts"],"acceptance_criteria":["works"],"tests_to_write":["test4"],"depends_on":["t2","t3"]}
]
EOF

output=$(pipeline-validate-tasks "$tasks_dir/tasks.json" 2>/dev/null)
assert_eq "valid tasks" "true" "$(echo "$output" | jq -r '.valid')"
assert_eq "task count" "4" "$(echo "$output" | jq -r '.task_count')"

# t1 in group 0
t1_group=$(echo "$output" | jq '[.execution_order[] | select(.task_id == "t1")] | .[0].parallel_group')
assert_eq "t1 group 0" "0" "$t1_group"

# t2 and t3 in same group (both depend only on t1)
t2_group=$(echo "$output" | jq '[.execution_order[] | select(.task_id == "t2")] | .[0].parallel_group')
t3_group=$(echo "$output" | jq '[.execution_order[] | select(.task_id == "t3")] | .[0].parallel_group')
assert_eq "t2 t3 same group" "$t2_group" "$t3_group"

# t4 after t2/t3
t4_group=$(echo "$output" | jq '[.execution_order[] | select(.task_id == "t4")] | .[0].parallel_group')
assert_eq "t4 after t2/t3" "true" "$( [[ "$t4_group" -gt "$t2_group" ]] && echo true || echo false )"

# Single task (no deps)
cat > "$tasks_dir/single.json" << 'EOF'
[{"task_id":"solo","title":"Solo","description":"Solo task","files":["x.ts"],"acceptance_criteria":["done"],"tests_to_write":["t"],"depends_on":[]}]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/single.json" 2>/dev/null)
assert_eq "single task valid" "true" "$(echo "$output" | jq -r '.valid')"
assert_eq "single task group 0" "0" "$(echo "$output" | jq '.execution_order[0].parallel_group')"

echo ""
echo "=== pipeline-validate-tasks (cycles) ==="

cat > "$tasks_dir/cyclic.json" << 'EOF'
[
  {"task_id":"a","title":"A","description":"A","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["b"]},
  {"task_id":"b","title":"B","description":"B","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["a"]}
]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/cyclic.json" 2>/dev/null) || true
assert_eq "detects cycle" "false" "$(echo "$output" | jq -r '.valid')"
assert_eq "cycle error present" "true" "$(echo "$output" | jq '[.errors[] | select(test("circular"))] | length > 0')"

# 3-node cycle
cat > "$tasks_dir/cycle3.json" << 'EOF'
[
  {"task_id":"a","title":"A","description":"A","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["c"]},
  {"task_id":"b","title":"B","description":"B","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["a"]},
  {"task_id":"c","title":"C","description":"C","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["b"]}
]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/cycle3.json" 2>/dev/null) || true
assert_eq "detects 3-node cycle" "false" "$(echo "$output" | jq -r '.valid')"

echo ""
echo "=== pipeline-validate-tasks (dangling deps) ==="

cat > "$tasks_dir/dangling.json" << 'EOF'
[{"task_id":"a","title":"A","description":"A","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["nonexistent"]}]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/dangling.json" 2>/dev/null) || true
assert_eq "detects dangling" "false" "$(echo "$output" | jq -r '.valid')"

echo ""
echo "=== pipeline-validate-tasks (missing fields) ==="

cat > "$tasks_dir/missing.json" << 'EOF'
[{"task_id":"a","title":"A"}]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/missing.json" 2>/dev/null) || true
assert_eq "detects missing fields" "false" "$(echo "$output" | jq -r '.valid')"

echo ""
echo "=== pipeline-validate-tasks (duplicate IDs) ==="

cat > "$tasks_dir/dups.json" << 'EOF'
[
  {"task_id":"a","title":"A","description":"A","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]},
  {"task_id":"a","title":"B","description":"B","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}
]
EOF
output=$(pipeline-validate-tasks "$tasks_dir/dups.json" 2>/dev/null) || true
assert_eq "detects duplicates" "false" "$(echo "$output" | jq -r '.valid')"

echo ""
echo "=== pipeline-branch naming ==="

name=$(pipeline-branch naming "setup-auth-system" "42" 2>/dev/null)
assert_eq "branch naming" "dark-factory/42/setup-auth-system" "$name"

name=$(pipeline-branch naming "Hello World -- Test" "99" 2>/dev/null)
assert_eq "branch naming slugified" "dark-factory/99/hello-world-test" "$name"

echo ""
echo "=== pipeline-branch (git operations) ==="

test_repo=$(mktemp -d)
bare_repo=$(mktemp -d)/bare.git

cd "$test_repo"
git init -q
git checkout -q -b main 2>/dev/null || true
git commit -q --allow-empty -m "init"
git clone -q --bare "$test_repo" "$bare_repo"
git remote add origin "$bare_repo"
git push -q -u origin main

# staging-init
output=$(pipeline-branch staging-init 2>/dev/null)
assert_eq "staging created" "true" "$(echo "$output" | jq -r '.created')"
assert_eq "staging base=main" "main" "$(echo "$output" | jq -r '.base')"

# exists
assert_exit "staging exists" 0 pipeline-branch exists staging

# create
output=$(pipeline-branch create "test-feature" 2>/dev/null)
assert_eq "feature branch created" "test-feature" "$(echo "$output" | jq -r '.branch')"
current=$(git rev-parse --abbrev-ref HEAD)
assert_eq "on feature branch" "test-feature" "$current"

# exists (new branch)
assert_exit "feature branch exists" 0 pipeline-branch exists test-feature

# non-existent branch
assert_exit "missing branch fails" 1 pipeline-branch exists "no-such-branch"

echo ""
echo "=== pipeline-scaffold ==="

scaffold_dir=$(mktemp -d)
output=$(pipeline-scaffold "$scaffold_dir" 2>/dev/null)
count=$(echo "$output" | jq -r '.count')
assert_eq "scaffold creates files" "true" "$( [[ "$count" -gt 0 ]] && echo true || echo false )"

# Verify files
assert_eq "claude-progress.json" "true" "$( [[ -f "$scaffold_dir/claude-progress.json" ]] && echo true || echo false )"
assert_eq "feature-status.json" "true" "$( [[ -f "$scaffold_dir/feature-status.json" ]] && echo true || echo false )"
assert_eq "init.sh" "true" "$( [[ -f "$scaffold_dir/init.sh" ]] && echo true || echo false )"
assert_eq "init.sh executable" "true" "$( [[ -x "$scaffold_dir/init.sh" ]] && echo true || echo false )"
assert_eq "quality-gate.yml" "true" "$( [[ -f "$scaffold_dir/.github/workflows/quality-gate.yml" ]] && echo true || echo false )"
assert_eq ".gitignore" "true" "$( [[ -f "$scaffold_dir/.gitignore" ]] && echo true || echo false )"

# Idempotent
output=$(pipeline-scaffold "$scaffold_dir" 2>/dev/null)
assert_eq "scaffold idempotent" "0" "$(echo "$output" | jq -r '.count')"

# --force re-creates
output=$(pipeline-scaffold "$scaffold_dir" --force 2>/dev/null)
assert_eq "scaffold --force recreates" "true" "$( [[ "$(echo "$output" | jq -r '.count')" -gt 0 ]] && echo true || echo false )"

echo ""
echo "=== pipeline-build-prompt ==="

# Init run for holdout
pipeline-init "run-prompt-test" --issue 42 --mode prd >/dev/null 2>&1

spec_dir=$(mktemp -d)
printf '# Test Spec\nThis is the spec context.' > "$spec_dir/spec.md"

task='{"task_id":"t1","title":"Add login","description":"Implement login flow","files":["src/auth.ts"],"acceptance_criteria":["Users can log in","Sessions persist","Errors shown","Rate limited"],"tests_to_write":["Test login flow","Test session handling"],"depends_on":[]}'

# Basic prompt
output=$(pipeline-build-prompt "$task" "$spec_dir" 2>/dev/null)
assert_eq "prompt has title" "true" "$( echo "$output" | grep -q "Add login" && echo true || echo false )"
assert_eq "prompt has task_id" "true" "$( echo "$output" | grep -q "t1" && echo true || echo false )"
assert_eq "prompt has criteria" "true" "$( echo "$output" | grep -q "Users can log in" && echo true || echo false )"
assert_eq "prompt has spec" "true" "$( echo "$output" | grep -q "Test Spec" && echo true || echo false )"
assert_eq "prompt has tests" "true" "$( echo "$output" | grep -q "Test login flow" && echo true || echo false )"

# Holdout
output=$(pipeline-build-prompt "$task" "$spec_dir" --holdout 50 2>/dev/null)
holdout_file="${CLAUDE_PLUGIN_DATA}/runs/run-prompt-test/holdouts/t1.json"
assert_eq "holdout file created" "true" "$( [[ -f "$holdout_file" ]] && echo true || echo false )"
withheld=$(jq -r '.withheld_count' "$holdout_file")
assert_eq "holdout withheld >0" "true" "$( [[ "$withheld" -gt 0 ]] && echo true || echo false )"
assert_eq "holdout total correct" "4" "$(jq -r '.total_criteria' "$holdout_file")"

# Fix instructions
fix='{"findings":[{"severity":"critical","title":"Missing null check","description":"No null check on auth"}]}'
output=$(pipeline-build-prompt "$task" "$spec_dir" --fix-instructions "$fix" 2>/dev/null)
assert_eq "fix instructions present" "true" "$( echo "$output" | grep -q "Review Feedback" && echo true || echo false )"
assert_eq "fix finding present" "true" "$( echo "$output" | grep -q "Missing null check" && echo true || echo false )"

# task_13_06: --seed flag for deterministic holdout
echo ""
echo "=== task_13_06: build-prompt --seed determinism ==="

seed_task='{"task_id":"seed1","title":"Seed test","description":"D","files":["a.ts"],"acceptance_criteria":["c1","c2","c3","c4","c5","c6"],"tests_to_write":["t"],"depends_on":[]}'

pipeline-build-prompt "$seed_task" --holdout 50 --seed 42 2>/dev/null >/dev/null
h1=$(jq -Sc '.withheld_criteria' "${CLAUDE_PLUGIN_DATA}/runs/run-prompt-test/holdouts/seed1.json")
pipeline-build-prompt "$seed_task" --holdout 50 --seed 42 2>/dev/null >/dev/null
h2=$(jq -Sc '.withheld_criteria' "${CLAUDE_PLUGIN_DATA}/runs/run-prompt-test/holdouts/seed1.json")
assert_eq "same seed produces same holdout" "$h1" "$h2"

pipeline-build-prompt "$seed_task" --holdout 50 --seed 99 2>/dev/null >/dev/null
h3=$(jq -Sc '.withheld_criteria' "${CLAUDE_PLUGIN_DATA}/runs/run-prompt-test/holdouts/seed1.json")
if [[ "$h1" != "$h3" ]]; then
  echo "  PASS: different seeds produce different holdouts"
  pass=$((pass + 1))
else
  echo "  FAIL: different seeds produced same holdout (unlikely)"
  fail=$((fail + 1))
fi

# task_03_04: spec path propagation via state
# When --spec-path is not given, build-prompt reads .spec.path from state.
state_spec_dir=$(mktemp -d)
printf '# State Spec\nResolved via .spec.path' > "$state_spec_dir/spec.md"
pipeline-state write "run-prompt-test" '.spec.path' "\"$state_spec_dir\"" >/dev/null 2>&1

output=$(pipeline-build-prompt "$task" 2>/dev/null)
assert_eq "build-prompt reads .spec.path from state when --spec-path omitted" "true" \
  "$( echo "$output" | grep -q "Resolved via .spec.path" && echo true || echo false )"

# Prompt output must contain an absolute spec path so task-executors running
# in a different worktree know where to look.
assert_eq "prompt contains absolute spec path" "true" \
  "$( echo "$output" | grep -qF "$state_spec_dir" && echo true || echo false )"

# --spec-path flag overrides state
override_dir=$(mktemp -d)
printf '# Override Spec\nFrom flag' > "$override_dir/spec.md"
output=$(pipeline-build-prompt "$task" --spec-path "$override_dir" 2>/dev/null)
assert_eq "--spec-path flag overrides state" "true" \
  "$( echo "$output" | grep -q "From flag" && echo true || echo false )"

# task_07_01: Resume Context block from prior-work fields in state
echo ""
echo "=== task_07_01: pipeline-build-prompt resume context ==="

# Activate run-prompt-test as the current run for prior-work lookup
rm -f "$CLAUDE_PLUGIN_DATA/runs/current"
ln -s "$CLAUDE_PLUGIN_DATA/runs/run-prompt-test" "$CLAUDE_PLUGIN_DATA/runs/current"

# Seed task t1 in state so prior-work fields can be written under it
pipeline-state write "run-prompt-test" '.tasks.t1' '{"status":"interrupted"}' >/dev/null 2>&1

# Without prior-work fields → no Resume Context block
output=$(pipeline-build-prompt "$task" --spec-path "$spec_dir" 2>/dev/null)
assert_eq "no resume context when fields absent" "false" \
  "$( echo "$output" | grep -q '## Resume Context' && echo true || echo false )"

# With prior-work fields set → Resume Context block present with values
pipeline-state write "run-prompt-test" '.tasks.t1.prior_work_dir' '"/tmp/prior-worktree-xyz"' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_branch' '"task/t1"' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_commit' '"abc123def"' >/dev/null 2>&1

output=$(pipeline-build-prompt "$task" --spec-path "$spec_dir" 2>/dev/null)
assert_eq "resume context present" "true" \
  "$( echo "$output" | grep -q '## Resume Context' && echo true || echo false )"
assert_eq "resume context has prior_work_dir" "true" \
  "$( echo "$output" | grep -qF '/tmp/prior-worktree-xyz' && echo true || echo false )"
assert_eq "resume context has prior_branch" "true" \
  "$( echo "$output" | grep -qF 'task/t1' && echo true || echo false )"
assert_eq "resume context has prior_commit" "true" \
  "$( echo "$output" | grep -qF 'abc123def' && echo true || echo false )"

# Special characters in prior-work fields render literally (no shell expansion,
# no injection) — values containing $, ", and embedded text must appear verbatim.
pipeline-state write "run-prompt-test" '.tasks.t1.prior_work_dir' '"/tmp/with$dollar/and_underscores"' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_branch' '"task/t1-quote_branch"' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_commit' '"deadbeefcafe1234"' >/dev/null 2>&1

output=$(pipeline-build-prompt "$task" --spec-path "$spec_dir" 2>/dev/null)
assert_eq "special-char prior_work_dir literal" "true" \
  "$( echo "$output" | grep -qF '/tmp/with$dollar/and_underscores' && echo true || echo false )"
assert_eq "special-char prior_branch literal" "true" \
  "$( echo "$output" | grep -qF 'task/t1-quote_branch' && echo true || echo false )"

# Restore: clear prior-work fields so other tests below see clean state
pipeline-state write "run-prompt-test" '.tasks.t1.prior_work_dir' '""' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_branch' '""' >/dev/null 2>&1
pipeline-state write "run-prompt-test" '.tasks.t1.prior_commit' '""' >/dev/null 2>&1

echo ""
echo "=== task_01_02: pipeline-validate-tasks task_id injection hardening ==="

# task_id with embedded double quote — must be rejected (valid=false or exit 1)
cat > "$tasks_dir/bad-quote.json" << 'BEOF'
[{"task_id":"t1\"injected","title":"X","description":"X","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}]
BEOF
output=$(pipeline-validate-tasks "$tasks_dir/bad-quote.json" 2>/dev/null) || true
assert_eq "rejects task_id with double quote" "false" "$(echo "$output" | jq -r '.valid')"

# task_id with embedded newline (written via printf to avoid shell interpretation)
printf '[{"task_id":"t1\ninjected","title":"X","description":"X","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}]\n' \
  > "$tasks_dir/bad-newline.json"
output=$(pipeline-validate-tasks "$tasks_dir/bad-newline.json" 2>/dev/null) || true
assert_eq "rejects task_id with newline" "false" "$(echo "$output" | jq -r '.valid')"

# task_id with semicolon (shell-injection attempt)
cat > "$tasks_dir/bad-semi.json" << 'BEOF'
[{"task_id":"t1;rm -rf /","title":"X","description":"X","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}]
BEOF
output=$(pipeline-validate-tasks "$tasks_dir/bad-semi.json" 2>/dev/null) || true
assert_eq "rejects task_id with semicolon" "false" "$(echo "$output" | jq -r '.valid')"

# Valid task IDs produce valid JSON execution_order
cat > "$tasks_dir/valid-ids.json" << 'BEOF'
[
  {"task_id":"task-1","title":"T1","description":"D","files":["a.ts"],"acceptance_criteria":["ok"],"tests_to_write":["t"],"depends_on":[]},
  {"task_id":"task_2","title":"T2","description":"D","files":["b.ts"],"acceptance_criteria":["ok"],"tests_to_write":["t"],"depends_on":["task-1"]}
]
BEOF
output=$(pipeline-validate-tasks "$tasks_dir/valid-ids.json" 2>/dev/null)
assert_eq "valid IDs accepted" "true" "$(echo "$output" | jq -r '.valid')"
# Verify the execution_order is valid JSON with jq-safe task_id values
eo_valid=$(echo "$output" | jq '.execution_order | map(.task_id) | all(type == "string")' 2>/dev/null || echo "false")
assert_eq "execution_order task_ids are JSON strings" "true" "$eo_valid"

echo ""
echo "=== pipeline-holdout-validate ==="

# Seed a holdout file as pipeline-build-prompt would have.
holdout_dir="$CLAUDE_PLUGIN_DATA/runs/r-holdout/holdouts"
mkdir -p "$holdout_dir"
cat > "$holdout_dir/t1.json" <<'EOF'
{"task_id":"t1","withheld_criteria":["criterion alpha","criterion beta"],"total_criteria":5,"withheld_count":2}
EOF

# prompt subcommand: emits the focused reviewer prompt
prompt_out=$(pipeline-holdout-validate prompt r-holdout t1 2>/dev/null)
assert_eq "holdout prompt mentions task id" "true" "$(printf '%s' "$prompt_out" | grep -q 't1' && echo true || echo false)"
assert_eq "holdout prompt lists alpha"     "true" "$(printf '%s' "$prompt_out" | grep -q 'criterion alpha' && echo true || echo false)"
assert_eq "holdout prompt lists beta"      "true" "$(printf '%s' "$prompt_out" | grep -q 'criterion beta'  && echo true || echo false)"

# prompt: missing holdout file → exit 2
assert_exit "holdout prompt missing file → 2" 2 pipeline-holdout-validate prompt r-holdout no-such-task

# Seed a config so the gate uses the documented default threshold (80) rather
# than skipping the read entirely. The check subcommand reads
# .quality.holdoutPassRate via read_config.
cat > "$CLAUDE_PLUGIN_DATA/config.json" <<'EOF'
{"quality.holdoutPassRate": 80}
EOF

# check: 2/2 satisfied → pass, exit 0
cat > "$holdout_dir/../resp-pass.json" <<'EOF'
{"criteria":[{"criterion":"criterion alpha","satisfied":true,"evidence":"src/a.ts:1"},{"criterion":"criterion beta","satisfied":true,"evidence":"src/b.ts:2"}]}
EOF
out=$(pipeline-holdout-validate check r-holdout t1 "$holdout_dir/../resp-pass.json" 2>/dev/null)
rc=$?
assert_eq "holdout pass status" "pass" "$(printf '%s' "$out" | jq -r '.status')"
assert_eq "holdout pass exit"   "0"    "$rc"
assert_eq "holdout pass pct"    "100"  "$(printf '%s' "$out" | jq -r '.pass_pct')"

# check: 1/2 satisfied (50% < 80%) → fail, exit 1
cat > "$holdout_dir/../resp-fail.json" <<'EOF'
{"criteria":[{"criterion":"criterion alpha","satisfied":true,"evidence":"src/a.ts:1"},{"criterion":"criterion beta","satisfied":false,"evidence":"missing"}]}
EOF
set +e
out=$(pipeline-holdout-validate check r-holdout t1 "$holdout_dir/../resp-fail.json" 2>/dev/null)
rc=$?
set -e
assert_eq "holdout fail status" "fail" "$(printf '%s' "$out" | jq -r '.status')"
assert_eq "holdout fail exit"   "1"    "$rc"
assert_eq "holdout fail pct"    "50"   "$(printf '%s' "$out" | jq -r '.pass_pct')"

# check: missing entries treated as failures (only first criterion answered)
cat > "$holdout_dir/../resp-partial.json" <<'EOF'
{"criteria":[{"criterion":"criterion alpha","satisfied":true,"evidence":"src/a.ts:1"}]}
EOF
set +e
out=$(pipeline-holdout-validate check r-holdout t1 "$holdout_dir/../resp-partial.json" 2>/dev/null)
rc=$?
set -e
assert_eq "holdout partial counts as fail (status)" "fail" "$(printf '%s' "$out" | jq -r '.status')"
assert_eq "holdout partial counts as fail (exit)"   "1"    "$rc"
assert_eq "holdout partial criteria.len"            "2"    "$(printf '%s' "$out" | jq -r '.criteria | length')"
assert_eq "holdout partial second is unsatisfied"   "false" "$(printf '%s' "$out" | jq -r '.criteria[1].satisfied')"

# check: malformed reviewer JSON → exit 2
echo "this is not json" > "$holdout_dir/../resp-bad.json"
assert_exit "holdout malformed JSON → 2" 2 pipeline-holdout-validate check r-holdout t1 "$holdout_dir/../resp-bad.json"

# check: ```json ... ``` fenced block is unwrapped
cat > "$holdout_dir/../resp-fenced.json" <<'EOF'
Sure, here is my analysis:

```json
{"criteria":[{"criterion":"criterion alpha","satisfied":true,"evidence":"src/a.ts:1"},{"criterion":"criterion beta","satisfied":true,"evidence":"src/b.ts:2"}]}
```

Hope that helps.
EOF
out=$(pipeline-holdout-validate check r-holdout t1 "$holdout_dir/../resp-fenced.json" 2>/dev/null)
rc=$?
assert_eq "holdout fenced JSON parsed" "pass" "$(printf '%s' "$out" | jq -r '.status')"
assert_eq "holdout fenced JSON exit"   "0"    "$rc"

# check: zero withheld_count → defensive 100% pass, exit 0
cat > "$holdout_dir/empty.json" <<'EOF'
{"task_id":"empty","withheld_criteria":[],"total_criteria":3,"withheld_count":0}
EOF
echo '{"criteria":[]}' > "$holdout_dir/../resp-empty.json"
out=$(pipeline-holdout-validate check r-holdout empty "$holdout_dir/../resp-empty.json" 2>/dev/null)
rc=$?
assert_eq "holdout zero-withheld status" "pass" "$(printf '%s' "$out" | jq -r '.status')"
assert_eq "holdout zero-withheld exit"   "0"    "$rc"

# Unknown subcommand → exit 2
assert_exit "holdout unknown subcommand → 2" 2 pipeline-holdout-validate frob r-holdout t1

echo ""
echo "================================"
echo "Results: $pass passed, $fail failed"
echo "================================"

# Cleanup
rm -rf "$CLAUDE_PLUGIN_DATA" "$tasks_dir" "$scaffold_dir" "$spec_dir" "$test_repo" "$bare_repo"

[[ $fail -eq 0 ]]
