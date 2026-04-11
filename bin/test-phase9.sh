#!/usr/bin/env bash
# Phase 9 verification tests — configure command, templates, MCP server
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

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

assert_contains() {
  local label="$1" needle="$2" file="$3"
  if grep -qF "$needle" "$file"; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (file does not contain '$needle')"
    fail=$((fail + 1))
  fi
}

assert_file_exists() {
  local label="$1" file="$2"
  if [[ -f "$file" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label ('$file' does not exist)"
    fail=$((fail + 1))
  fi
}

assert_valid_json() {
  local label="$1" file="$2"
  if jq -e . "$file" >/dev/null 2>&1; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label ('$file' is not valid JSON)"
    fail=$((fail + 1))
  fi
}

# ============================================================
echo "=== .claude-plugin/plugin.json userConfig schema ==="

PLUGIN_JSON="$PLUGIN_ROOT/.claude-plugin/plugin.json"
assert_file_exists "plugin.json exists" "$PLUGIN_JSON"
assert_valid_json "plugin.json is valid JSON" "$PLUGIN_JSON"

# Every userConfig key documented in 02-quality-and-config.md must be present.
for key in \
  maxTasks \
  maxRuntimeMinutes \
  maxConsecutiveFailures \
  humanReviewLevel \
  maxParallelTasks \
  review.routineRounds \
  review.featureRounds \
  review.securityRounds \
  review.ollamaRoutineRounds \
  review.ollamaFeatureRounds \
  review.ollamaSecurityRounds \
  review.preferCodex \
  quality.holdoutPercent \
  quality.holdoutPassRate \
  quality.mutationScoreTarget \
  quality.mutationTestingTiers \
  quality.coverageMustNotDecrease \
  execution.defaultModel \
  execution.maxTurnsSimple \
  execution.maxTurnsMedium \
  execution.maxTurnsComplex \
  localLlm.enabled \
  localLlm.ollamaUrl \
  localLlm.model \
  localLlm.useLiteLlm \
  localLlm.liteLlmUrl \
  dependencies.prMergeTimeout \
  dependencies.pollInterval \
  observability.auditLog \
  observability.metricsExport \
  observability.metricsRetentionDays; do
  has=$(jq --arg k "$key" -r '.userConfig | has($k) | tostring' "$PLUGIN_JSON")
  assert_eq "userConfig has $key" "true" "$has"
done

# Each entry must declare a default value (even arrays/booleans/strings).
missing_default=$(jq -r '[.userConfig | to_entries[] | select(has("value") | not) | .key] as $_ | [.userConfig | to_entries[] | select(.value | has("default") | not) | .key] | join(",")' "$PLUGIN_JSON")
assert_eq "every userConfig entry has a default" "" "$missing_default"

# Defaults sourced from PRD must round-trip as the documented values.
default_holdout_pass_rate=$(jq -r '.userConfig["quality.holdoutPassRate"].default' "$PLUGIN_JSON")
assert_eq "quality.holdoutPassRate default = 80" "80" "$default_holdout_pass_rate"

default_default_model=$(jq -r '.userConfig["execution.defaultModel"].default' "$PLUGIN_JSON")
assert_eq "execution.defaultModel default = sonnet" "sonnet" "$default_default_model"

default_pr_merge_timeout=$(jq -r '.userConfig["dependencies.prMergeTimeout"].default' "$PLUGIN_JSON")
assert_eq "dependencies.prMergeTimeout default = 45" "45" "$default_pr_merge_timeout"

default_audit_log=$(jq -r '.userConfig["observability.auditLog"].default' "$PLUGIN_JSON")
assert_eq "observability.auditLog default = true" "true" "$default_audit_log"

default_mutation_tiers=$(jq -rc '.userConfig["quality.mutationTestingTiers"].default' "$PLUGIN_JSON")
assert_eq "quality.mutationTestingTiers default = [feature,security]" '["feature","security"]' "$default_mutation_tiers"

# ============================================================
echo "=== commands/configure.md ==="

CONFIGURE="$PLUGIN_ROOT/commands/configure.md"
assert_file_exists "configure.md exists" "$CONFIGURE"
assert_contains "has description" "description:" "$CONFIGURE"
assert_contains "has Step 1" "Step 1" "$CONFIGURE"
assert_contains "has Step 2" "Step 2" "$CONFIGURE"
assert_contains "writes to config.json" "config.json" "$CONFIGURE"
assert_contains "probes ollama" "ollama" "$CONFIGURE"

# ============================================================
echo ""
echo "=== templates/settings.autonomous.json ==="

TEMPLATE="$PLUGIN_ROOT/templates/settings.autonomous.json"
assert_file_exists "template exists" "$TEMPLATE"
assert_valid_json "template is valid JSON" "$TEMPLATE"

# env var is set
env_val=$(jq -r '.env.DARK_FACTORY_AUTONOMOUS_MODE' "$TEMPLATE")
assert_eq "DARK_FACTORY_AUTONOMOUS_MODE = 1" "1" "$env_val"

# pipeline permission
has_pipeline=$(jq -r '.permissions.allow | index("Bash(pipeline-*)") | if . != null then "yes" else "no" end' "$TEMPLATE")
assert_eq "permissions includes Bash(pipeline-*)" "yes" "$has_pipeline"

# --- Deny list: full set ported from old pipeline ---
deny_count=$(jq -r '.permissions.deny | length' "$TEMPLATE")
if [[ "$deny_count" -ge 20 ]]; then
  echo "  PASS: deny list has $deny_count entries (>= 20)"
  pass=$((pass + 1))
else
  echo "  FAIL: deny list too small ($deny_count entries, need >= 20)"
  fail=$((fail + 1))
fi

for pattern in \
  "Bash(rm -rf /*)" \
  "Bash(git push --force*)" \
  "Bash(*--no-verify*)" \
  "Bash(git reset --hard*)" \
  "Bash(find .claude*)" \
  "Write(.env)" \
  "Edit(.env)" \
  "Write(**/secrets/**)" \
  "Write(**/migrations/**)"; do
  match=$(jq --arg p "$pattern" -r '.permissions.deny | index($p) | if . != null then "yes" else "no" end' "$TEMPLATE")
  assert_eq "deny list contains $pattern" "yes" "$match"
done

# --- PreToolUse hooks: multiple, covering all old-pipeline guards ---
pretool_groups=$(jq -r '.hooks.PreToolUse | length' "$TEMPLATE")
if [[ "$pretool_groups" -ge 6 ]]; then
  echo "  PASS: has $pretool_groups PreToolUse matcher groups (>= 6)"
  pass=$((pass + 1))
else
  echo "  FAIL: PreToolUse has $pretool_groups matcher groups, need >= 6"
  fail=$((fail + 1))
fi

# .claude access block — matcher must cover Read/Glob/Grep/Edit/Write
dotclaude_block=$(jq -r '[.hooks.PreToolUse[] | select(.matcher | test("Glob|Grep|Read|Edit|Write")) | .hooks[] | .command] | map(select(test("\\.claude"))) | length' "$TEMPLATE")
if [[ "$dotclaude_block" -ge 1 ]]; then
  echo "  PASS: .claude access block hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: .claude access block hook missing"
  fail=$((fail + 1))
fi

# Branch protection via git branch --show-current (inline)
branch_protect=$(jq -r '[.. | .command? // empty] | map(select(test("git branch --show-current"))) | length' "$TEMPLATE")
if [[ "$branch_protect" -ge 1 ]]; then
  echo "  PASS: branch protection hook (git branch --show-current) present"
  pass=$((pass + 1))
else
  echo "  FAIL: branch protection hook missing"
  fail=$((fail + 1))
fi

# Protected-files hook (.env, secrets, migrations)
protected_files=$(jq -r '[.. | .command? // empty] | map(select(test("secrets") and test("migrations"))) | length' "$TEMPLATE")
if [[ "$protected_files" -ge 1 ]]; then
  echo "  PASS: protected-files (.env/secrets/migrations) hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: protected-files hook missing"
  fail=$((fail + 1))
fi

# SQL safety hook — matches Supabase execute_sql
sql_safety=$(jq -r '[.hooks.PreToolUse[] | select(.matcher | test("execute_sql"))] | length' "$TEMPLATE")
if [[ "$sql_safety" -ge 1 ]]; then
  echo "  PASS: SQL safety hook (execute_sql matcher) present"
  pass=$((pass + 1))
else
  echo "  FAIL: SQL safety hook missing"
  fail=$((fail + 1))
fi

# Dangerous Bash pattern hook
dangerous_bash=$(jq -r '[.. | .command? // empty] | map(select(test("Blocked dangerous command pattern"))) | length' "$TEMPLATE")
if [[ "$dangerous_bash" -ge 1 ]]; then
  echo "  PASS: dangerous Bash pattern hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: dangerous Bash pattern hook missing"
  fail=$((fail + 1))
fi

# pre-commit-check and pre-push-check from ~/.claude/hooks/
for script in pre-commit-check.sh pre-push-check.sh; do
  match=$(jq --arg s "$script" -r '[.. | .command? // empty] | map(select(test("~/.claude/hooks/" + $s))) | length' "$TEMPLATE")
  if [[ "$match" -ge 1 ]]; then
    echo "  PASS: $script hook present (user env path preserved)"
    pass=$((pass + 1))
  else
    echo "  FAIL: $script hook missing"
    fail=$((fail + 1))
  fi
done

# --- PostToolUse: prettier + related tests + audit log ---
prettier_hook=$(jq -r '[.. | .command? // empty] | map(select(test("prettier --write"))) | length' "$TEMPLATE")
if [[ "$prettier_hook" -ge 1 ]]; then
  echo "  PASS: PostToolUse prettier auto-format hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: prettier auto-format hook missing"
  fail=$((fail + 1))
fi

related_tests=$(jq -r '[.. | .command? // empty] | map(select(test("findRelatedTests"))) | length' "$TEMPLATE")
if [[ "$related_tests" -ge 1 ]]; then
  echo "  PASS: PostToolUse related-tests hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: related-tests hook missing"
  fail=$((fail + 1))
fi

audit_log=$(jq -r '[.. | .command? // empty] | map(select(test("tool-audit.jsonl"))) | length' "$TEMPLATE")
if [[ "$audit_log" -ge 1 ]]; then
  echo "  PASS: PostToolUse audit-log hook present"
  pass=$((pass + 1))
else
  echo "  FAIL: audit-log hook missing"
  fail=$((fail + 1))
fi

# --- Stop hook: vitest runner ---
stop_hook_count=$(jq -r '.hooks.Stop | length' "$TEMPLATE")
if [[ "$stop_hook_count" -ge 1 ]]; then
  echo "  PASS: Stop hook group present"
  pass=$((pass + 1))
else
  echo "  FAIL: Stop hook group missing"
  fail=$((fail + 1))
fi

vitest_stop=$(jq -r '[.hooks.Stop[].hooks[].command] | map(select(test("vitest run"))) | length' "$TEMPLATE")
if [[ "$vitest_stop" -ge 1 ]]; then
  echo "  PASS: Stop hook runs vitest suite"
  pass=$((pass + 1))
else
  echo "  FAIL: Stop hook does not run vitest"
  fail=$((fail + 1))
fi

# native-tool-nudge from ~/.claude/hooks/
nudge=$(jq -r '[.. | .command? // empty] | map(select(test("~/.claude/hooks/native-tool-nudge.sh"))) | length' "$TEMPLATE")
if [[ "$nudge" -ge 1 ]]; then
  echo "  PASS: native-tool-nudge.sh hook present (user env path preserved)"
  pass=$((pass + 1))
else
  echo "  FAIL: native-tool-nudge.sh hook missing"
  fail=$((fail + 1))
fi

# ============================================================
echo ""
echo "=== commands/run.md materialization (\${CLAUDE_PLUGIN_ROOT} substitution) ==="

RUN_MD="$PLUGIN_ROOT/commands/run.md"
assert_file_exists "run.md exists" "$RUN_MD"

# The materialization must use walk() + gsub — NOT a hardcoded PreToolUse[0] path.
# The old jq expression "PreToolUse[0].hooks[0].command = ..." would corrupt the
# new template's first hook (the .claude access block) by overwriting its inline
# shell with a stale branch-protection.sh reference.
if grep -q 'walk(' "$RUN_MD" && grep -q 'CLAUDE_PLUGIN_ROOT' "$RUN_MD"; then
  echo "  PASS: run.md materialization uses walk() + CLAUDE_PLUGIN_ROOT"
  pass=$((pass + 1))
else
  echo "  FAIL: run.md materialization does not use walk() + CLAUDE_PLUGIN_ROOT"
  fail=$((fail + 1))
fi

if grep -qF 'PreToolUse[0].hooks[0].command' "$RUN_MD"; then
  echo "  FAIL: run.md still references brittle PreToolUse[0].hooks[0].command path"
  fail=$((fail + 1))
else
  echo "  PASS: run.md does not use brittle PreToolUse[0].hooks[0].command path"
  pass=$((pass + 1))
fi

# Exercise the same jq expression against a synthetic fixture. The fixture mixes
# plugin-relative paths (with ${CLAUDE_PLUGIN_ROOT}) and user-env paths that must
# NOT be rewritten.
MATERIALIZE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/phase9-materialize-XXXXXX")
trap '[[ -n "${MATERIALIZE_DIR:-}" && "$MATERIALIZE_DIR" == "${TMPDIR:-/tmp}"/* ]] && rm -rf "$MATERIALIZE_DIR"' EXIT

FIXTURE="$MATERIALIZE_DIR/fixture.json"
cat > "$FIXTURE" <<'EOF'
{
  "env": {"DARK_FACTORY_AUTONOMOUS_MODE": "1"},
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/branch-protection.sh"},
          {"type": "command", "command": "~/.claude/hooks/pre-commit-check.sh"}
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {"type": "command", "command": "FILE=$(cat); echo inline"},
          {"type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/rm-guard.sh --strict"}
        ]
      }
    ]
  }
}
EOF

FAKE_ROOT="$MATERIALIZE_DIR/fake-plugin"
mkdir -p "$FAKE_ROOT/hooks"

MATERIALIZED="$MATERIALIZE_DIR/merged.json"
jq --arg root "$FAKE_ROOT" '
  walk(
    if type == "string" and test("\\$\\{CLAUDE_PLUGIN_ROOT\\}")
    then gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root)
    else . end
  )
' "$FIXTURE" > "$MATERIALIZED"

assert_valid_json "materialized fixture is valid JSON" "$MATERIALIZED"

# Plugin-relative ${CLAUDE_PLUGIN_ROOT} references replaced with $FAKE_ROOT
rewritten_branch=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$MATERIALIZED")
assert_eq "plugin-relative path rewritten to absolute" \
  "$FAKE_ROOT/hooks/branch-protection.sh" \
  "$rewritten_branch"

rewritten_rmguard=$(jq -r '.hooks.PreToolUse[1].hooks[1].command' "$MATERIALIZED")
assert_eq "nested plugin-relative path rewritten to absolute" \
  "$FAKE_ROOT/hooks/rm-guard.sh --strict" \
  "$rewritten_rmguard"

# User-env ~/.claude/hooks/* paths preserved verbatim
preserved_user_hook=$(jq -r '.hooks.PreToolUse[0].hooks[1].command' "$MATERIALIZED")
assert_eq "user-env ~/.claude/hooks path preserved verbatim" \
  "~/.claude/hooks/pre-commit-check.sh" \
  "$preserved_user_hook"

# Inline shell snippets preserved verbatim
preserved_inline=$(jq -r '.hooks.PreToolUse[1].hooks[0].command' "$MATERIALIZED")
assert_eq "inline shell command preserved verbatim" \
  'FILE=$(cat); echo inline' \
  "$preserved_inline"

# No ${CLAUDE_PLUGIN_ROOT} tokens remain anywhere
remaining=$(grep -c 'CLAUDE_PLUGIN_ROOT' "$MATERIALIZED" || true)
assert_eq "no \${CLAUDE_PLUGIN_ROOT} tokens remain in materialized output" "0" "$remaining"

# Idempotency: re-running the same substitution produces byte-identical output
MATERIALIZED2="$MATERIALIZE_DIR/merged2.json"
jq --arg root "$FAKE_ROOT" '
  walk(
    if type == "string" and test("\\$\\{CLAUDE_PLUGIN_ROOT\\}")
    then gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root)
    else . end
  )
' "$MATERIALIZED" > "$MATERIALIZED2"

if diff -q "$MATERIALIZED" "$MATERIALIZED2" >/dev/null 2>&1; then
  echo "  PASS: materialization is idempotent"
  pass=$((pass + 1))
else
  echo "  FAIL: materialization is not idempotent"
  fail=$((fail + 1))
fi

# Materializing the real template yields valid JSON (even though it currently
# contains no ${CLAUDE_PLUGIN_ROOT} placeholders — this locks in the walk()
# contract: a no-op substitution must still produce a valid, loadable file).
REAL_MATERIALIZED="$MATERIALIZE_DIR/real-merged.json"
jq --arg root "$FAKE_ROOT" '
  walk(
    if type == "string" and test("\\$\\{CLAUDE_PLUGIN_ROOT\\}")
    then gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root)
    else . end
  )
' "$TEMPLATE" > "$REAL_MATERIALIZED"
assert_valid_json "materialized real template is valid JSON" "$REAL_MATERIALIZED"

# Preserve ~/.claude/hooks paths in the real template
real_user_hooks=$(jq -r '[.. | .command? // empty] | map(select(test("~/.claude/hooks/"))) | length' "$REAL_MATERIALIZED")
if [[ "$real_user_hooks" -ge 1 ]]; then
  echo "  PASS: real template materialization preserves ~/.claude/hooks/* paths"
  pass=$((pass + 1))
else
  echo "  FAIL: real template materialization dropped ~/.claude/hooks/* paths"
  fail=$((fail + 1))
fi

# ============================================================
echo ""
echo "=== hooks/hooks.json uses \${CLAUDE_PLUGIN_ROOT} ==="

HOOKS_JSON="$PLUGIN_ROOT/hooks/hooks.json"
assert_file_exists "hooks.json exists" "$HOOKS_JSON"
assert_valid_json "hooks.json is valid JSON" "$HOOKS_JSON"

# All 4 hook script references should use CLAUDE_PLUGIN_ROOT
for hook in branch-protection run-tracker stop-gate subagent-stop-gate; do
  if grep -qF "\${CLAUDE_PLUGIN_ROOT}/hooks/${hook}.sh" "$HOOKS_JSON"; then
    echo "  PASS: $hook uses CLAUDE_PLUGIN_ROOT"
    pass=$((pass + 1))
  else
    echo "  FAIL: $hook does not use CLAUDE_PLUGIN_ROOT"
    fail=$((fail + 1))
  fi
done

# ============================================================
echo ""
echo "=== .mcp.json ==="

MCP_JSON="$PLUGIN_ROOT/.mcp.json"
assert_file_exists ".mcp.json exists" "$MCP_JSON"
assert_valid_json ".mcp.json is valid JSON" "$MCP_JSON"

cmd=$(jq -r '.mcpServers["pipeline-metrics"].command' "$MCP_JSON")
assert_eq "mcp server command = node" "node" "$cmd"

disabled=$(jq -r '.mcpServers["pipeline-metrics"].disabled' "$MCP_JSON")
assert_eq "mcp server disabled by default" "true" "$disabled"

db_env=$(jq -r '.mcpServers["pipeline-metrics"].env.METRICS_DB' "$MCP_JSON")
if printf '%s' "$db_env" | grep -q 'CLAUDE_PLUGIN_DATA'; then
  echo "  PASS: METRICS_DB uses CLAUDE_PLUGIN_DATA"
  pass=$((pass + 1))
else
  echo "  FAIL: METRICS_DB does not reference CLAUDE_PLUGIN_DATA"
  fail=$((fail + 1))
fi

# ============================================================
echo ""
echo "=== servers/pipeline-metrics/package.json ==="

PKG="$PLUGIN_ROOT/servers/pipeline-metrics/package.json"
assert_file_exists "package.json exists" "$PKG"
assert_valid_json "package.json is valid JSON" "$PKG"

pkg_type=$(jq -r '.type' "$PKG")
assert_eq "type = module" "module" "$pkg_type"

engines=$(jq -r '.engines.node // empty' "$PKG")
assert_eq "engines.node non-empty" "true" "$([[ -n "$engines" ]] && echo true || echo false)"

has_sdk=$(jq -r '.dependencies["@modelcontextprotocol/sdk"] // empty' "$PKG")
assert_eq "dep @modelcontextprotocol/sdk" "true" "$([[ -n "$has_sdk" ]] && echo true || echo false)"

has_sqlite=$(jq -r '.dependencies["better-sqlite3"] // empty' "$PKG")
assert_eq "dep better-sqlite3" "true" "$([[ -n "$has_sqlite" ]] && echo true || echo false)"

# ============================================================
echo ""
echo "=== servers/pipeline-metrics/index.js ==="

INDEX="$PLUGIN_ROOT/servers/pipeline-metrics/index.js"
assert_file_exists "index.js exists" "$INDEX"

# Syntax check (no deps required for --check)
if node --check "$INDEX" 2>/dev/null; then
  echo "  PASS: index.js syntax check passes"
  pass=$((pass + 1))
else
  echo "  FAIL: index.js syntax check failed"
  fail=$((fail + 1))
fi

# 4 tool names present
for tool in metrics_record metrics_query metrics_summary metrics_export; do
  assert_contains "tool $tool defined" "$tool" "$INDEX"
done

# 8 event types defined
for event in task_start task_end review_round quality_gate model_switch circuit_breaker run_start run_end; do
  assert_contains "event type $event defined" "$event" "$INDEX"
done

# mkdirSync for DB parent directory
assert_contains "mkdirSync for DB dir" "mkdirSync" "$INDEX"

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

[[ $fail -eq 0 ]] && exit 0 || exit 1
