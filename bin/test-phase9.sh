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

# PreToolUse hook present
has_hook=$(jq -r '.hooks.PreToolUse | length' "$TEMPLATE")
assert_eq "has PreToolUse hook" "1" "$has_hook"

# Hook command path references branch-protection.sh
hook_cmd=$(jq -r '.hooks.PreToolUse[0].hooks[0].command' "$TEMPLATE")
if printf '%s' "$hook_cmd" | grep -q 'branch-protection.sh'; then
  echo "  PASS: hook command references branch-protection.sh"
  pass=$((pass + 1))
else
  echo "  FAIL: hook command does not reference branch-protection.sh (got: $hook_cmd)"
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
