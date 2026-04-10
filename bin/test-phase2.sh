#!/usr/bin/env bash
# Phase 2 verification tests
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

# --- Mock gh for testing ---
# Create a mock gh script that simulates GitHub API responses
MOCK_DIR=$(mktemp -d)
cat > "$MOCK_DIR/gh" << 'MOCK_GH'
#!/usr/bin/env bash
case "$*" in
  "auth status")
    exit 0
    ;;
  "issue view 42 --json title,body,labels,assignees")
    cat <<'EOF'
{"title":"[PRD] Test feature","body":"# PRD\nBuild a test feature","labels":[{"name":"prd"}],"assignees":[{"login":"testuser"}]}
EOF
    ;;
  "issue view 99 --json title,body,labels,assignees")
    cat <<'EOF'
{"title":"No PRD marker","body":"Just a regular issue","labels":[{"name":"bug"}],"assignees":[]}
EOF
    ;;
  "issue view 404 --json title,body,labels,assignees")
    echo "Could not resolve to an Issue" >&2
    exit 1
    ;;
  "issue comment"*)
    exit 0
    ;;
  "issue edit"*)
    exit 0
    ;;
  "api "*"/comments "*"--jq "*)
    # Stateful mock: return an existing comment with the marker if the fixture file exists
    if [[ -f "${MOCK_GH_FIXTURE:-/dev/null}" ]]; then
      cat "$MOCK_GH_FIXTURE"
    else
      echo ""
    fi
    ;;
  "api "*"/comments "*)
    if [[ -f "${MOCK_GH_FIXTURE:-/dev/null}" ]]; then
      cat "$MOCK_GH_FIXTURE"
    else
      echo "[]"
    fi
    ;;
  "api "*"-X PATCH"*|"api "*"PATCH"*)
    exit 0
    ;;
  api*)
    echo "[]"
    ;;
  *)
    echo "mock gh: unhandled: $*" >&2
    exit 1
    ;;
esac
MOCK_GH
chmod +x "$MOCK_DIR/gh"
export PATH="$MOCK_DIR:$PATH"

echo "=== pipeline-fetch-prd ==="

# Fetch issue with [PRD] marker
output=$(pipeline-fetch-prd 42 2>/dev/null)
title=$(echo "$output" | jq -r '.title')
assert_eq "fetches issue title" "[PRD] Test feature" "$title"

issue_num=$(echo "$output" | jq -r '.issue_number')
assert_eq "captures issue number" "42" "$issue_num"

has_prd=$(echo "$output" | jq -r '.has_prd_marker')
assert_eq "detects [PRD] marker" "true" "$has_prd"

assignee=$(echo "$output" | jq -r '.assignees[0]')
assert_eq "captures assignees" "testuser" "$assignee"

# Fetch issue without [PRD] marker (should warn but succeed)
output=$(pipeline-fetch-prd 99 2>/dev/null)
has_prd=$(echo "$output" | jq -r '.has_prd_marker')
assert_eq "no [PRD] marker detected" "false" "$has_prd"

# Non-existent issue
assert_exit "rejects missing issue" 1 pipeline-fetch-prd 404

# Invalid issue number
assert_exit "rejects non-numeric issue" 1 pipeline-fetch-prd "abc"

# Missing argument
assert_exit "rejects missing argument" 1 pipeline-fetch-prd

echo ""
echo "=== pipeline-validate-spec (valid spec) ==="

# Create a valid spec directory
spec_dir=$(mktemp -d)
cat > "$spec_dir/spec.md" << 'EOF'
# Test Spec
This is a test specification.
EOF

cat > "$spec_dir/tasks.json" << 'EOF'
[
  {
    "task_id": "task_1",
    "title": "Setup auth",
    "description": "Implement JWT auth",
    "files": ["src/auth.ts"],
    "acceptance_criteria": ["Login returns JWT"],
    "tests_to_write": ["Test login"],
    "depends_on": []
  },
  {
    "task_id": "task_2",
    "title": "Add middleware",
    "description": "JWT validation middleware",
    "files": ["src/middleware.ts", "src/types.ts"],
    "acceptance_criteria": ["Blocks unauthorized"],
    "tests_to_write": ["Test unauthorized"],
    "depends_on": ["task_1"]
  }
]
EOF

output=$(pipeline-validate-spec "$spec_dir" 2>/dev/null)
valid=$(echo "$output" | jq -r '.valid')
assert_eq "valid spec passes" "true" "$valid"

task_count=$(echo "$output" | jq -r '.task_count')
assert_eq "task count correct" "2" "$task_count"

errors=$(echo "$output" | jq '.errors | length')
assert_eq "no errors on valid spec" "0" "$errors"

echo ""
echo "=== pipeline-validate-spec (invalid specs) ==="

# Missing spec.md
empty_dir=$(mktemp -d)
cat > "$empty_dir/tasks.json" << 'EOF'
[{"task_id":"t1","title":"x","description":"x","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}]
EOF
output=$(pipeline-validate-spec "$empty_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects missing spec.md" "false" "$valid"

# Empty spec.md
touch "$empty_dir/spec.md"
output=$(pipeline-validate-spec "$empty_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects empty spec.md" "false" "$valid"

# Invalid JSON in tasks.json
bad_json_dir=$(mktemp -d)
echo "# Spec" > "$bad_json_dir/spec.md"
echo "not json" > "$bad_json_dir/tasks.json"
output=$(pipeline-validate-spec "$bad_json_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects invalid JSON" "false" "$valid"

# Empty tasks array
empty_tasks_dir=$(mktemp -d)
echo "# Spec" > "$empty_tasks_dir/spec.md"
echo "[]" > "$empty_tasks_dir/tasks.json"
output=$(pipeline-validate-spec "$empty_tasks_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects empty tasks array" "false" "$valid"

# Missing required field
missing_field_dir=$(mktemp -d)
echo "# Spec" > "$missing_field_dir/spec.md"
cat > "$missing_field_dir/tasks.json" << 'EOF'
[{"task_id":"t1","title":"x"}]
EOF
output=$(pipeline-validate-spec "$missing_field_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects missing required fields" "false" "$valid"

# Files array > 3
too_many_files_dir=$(mktemp -d)
echo "# Spec" > "$too_many_files_dir/spec.md"
cat > "$too_many_files_dir/tasks.json" << 'EOF'
[{"task_id":"t1","title":"x","description":"x","files":["a","b","c","d"],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}]
EOF
output=$(pipeline-validate-spec "$too_many_files_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects files > 3" "false" "$valid"

# Duplicate task_ids
dup_dir=$(mktemp -d)
echo "# Spec" > "$dup_dir/spec.md"
cat > "$dup_dir/tasks.json" << 'EOF'
[
  {"task_id":"t1","title":"x","description":"x","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]},
  {"task_id":"t1","title":"y","description":"y","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":[]}
]
EOF
output=$(pipeline-validate-spec "$dup_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects duplicate task_ids" "false" "$valid"

# Dangling depends_on
dangling_dir=$(mktemp -d)
echo "# Spec" > "$dangling_dir/spec.md"
cat > "$dangling_dir/tasks.json" << 'EOF'
[{"task_id":"t1","title":"x","description":"x","files":[],"acceptance_criteria":[],"tests_to_write":[],"depends_on":["t99"]}]
EOF
output=$(pipeline-validate-spec "$dangling_dir" 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "rejects dangling depends_on" "false" "$valid"

echo ""
echo "=== pipeline-validate ==="

# Create minimal project structure for validation
test_project=$(mktemp -d)
cd "$test_project"
git init -q
git remote add origin "https://github.com/test/test.git"
mkdir -p .claude/skills/prd-to-spec
echo "# prd-to-spec" > .claude/skills/prd-to-spec/SKILL.md
git add -A && git commit -q -m "init"

output=$(pipeline-validate 2>/dev/null)
valid=$(echo "$output" | jq -r '.valid')
assert_eq "valid project passes" "true" "$valid"

# Check count: git_remote, clean_tree, gh_cli, skill_prd_to_spec, plugin_data = 5
check_count=$(echo "$output" | jq '.checks | length')
assert_eq "has expected check count" "5" "$check_count"

# Missing skill
rm -rf .claude/skills/prd-to-spec
output=$(pipeline-validate 2>/dev/null) || true
valid=$(echo "$output" | jq -r '.valid')
assert_eq "fails on missing skill" "false" "$valid"

# Restore and test strict mode
mkdir -p .claude/skills/prd-to-spec
echo "# prd-to-spec" > .claude/skills/prd-to-spec/SKILL.md
git add -A
git diff --cached --quiet || git commit -q -m "restore"
output=$(pipeline-validate --strict --no-clean-check 2>/dev/null)
check_count=$(echo "$output" | jq '.checks | length')
# 5 base + 5 optional agents = 10
assert_eq "strict mode adds optional checks" "10" "$check_count"

echo ""
echo "=== pipeline-gh-comment ==="

# Test spec-failure comment (with mock gh)
output=$(pipeline-gh-comment 42 spec-failure --data '{"reason":"validation failed","run_id":"run-001"}' 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "spec-failure comment posted" "created" "$action"
type=$(echo "$output" | jq -r '.type')
assert_eq "comment type correct" "spec-failure" "$type"

# Test run-summary comment
output=$(pipeline-gh-comment 42 run-summary --data '{"summary":"2 tasks done","status":"partial","tasks_done":2,"tasks_total":5}' 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "run-summary comment posted" "created" "$action"

# Test invalid comment type
assert_exit "rejects invalid comment type" 1 pipeline-gh-comment 42 "invalid-type"

# --- --update path ---

# Case 1: existing comment found → action == "updated"
export MOCK_GH_FIXTURE=$(mktemp)
cat > "$MOCK_GH_FIXTURE" <<'FIXTURE'
12345
FIXTURE
output=$(pipeline-gh-comment 42 spec-failure --update --data '{"reason":"retry","run_id":"run-002"}' 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "update path finds existing comment" "updated" "$action"
comment_id=$(echo "$output" | jq -r '.comment_id')
assert_eq "update returns comment_id" "12345" "$comment_id"

# Case 2: --update with no existing comment → falls through to create
rm -f "$MOCK_GH_FIXTURE"
unset MOCK_GH_FIXTURE
output=$(pipeline-gh-comment 42 spec-failure --update --data '{"reason":"first time","run_id":"run-003"}' 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "update falls through to create" "created" "$action"

# Case 3: ci-escalation comment type
output=$(pipeline-gh-comment 42 ci-escalation --data '{"log_excerpt":"build failed","pr_number":123,"attempts":2}' 2>/dev/null)
action=$(echo "$output" | jq -r '.action')
assert_eq "ci-escalation comment posted" "created" "$action"
type=$(echo "$output" | jq -r '.type')
assert_eq "ci-escalation type correct" "ci-escalation" "$type"

echo ""
echo "================================"
echo "Results: $pass passed, $fail failed"
echo "================================"

# Cleanup
rm -rf "$CLAUDE_PLUGIN_DATA" "$MOCK_DIR" "$spec_dir" "$empty_dir" "$bad_json_dir" \
  "$empty_tasks_dir" "$missing_field_dir" "$too_many_files_dir" "$dup_dir" "$dangling_dir" "$test_project"

[[ $fail -eq 0 ]]
