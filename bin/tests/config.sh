#!/usr/bin/env bash
# config.sh — plugin.json userConfig schema, commands/configure.md,
# templates (settings.autonomous, stryker, dep-cruiser, package.scaffold),
# commands/run.md materialization, .mcp.json, pipeline-metrics server.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

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
  quality.coverageRegressionTolerancePct \
  execution.defaultModel \
  execution.modelByTier.simple \
  execution.modelByTier.medium \
  execution.modelByTier.complex \
  execution.maxTurnsSimple \
  execution.maxTurnsMedium \
  execution.maxTurnsComplex \
  localLlm.enabled \
  localLlm.ollamaUrl \
  localLlm.model \
  dependencies.prMergeTimeout \
  dependencies.pollInterval \
  observability.auditLog \
  observability.metricsExport \
  observability.metricsRetentionDays \
  safety.writeBlockedPaths \
  safety.useTruffleHog \
  safety.allowedSecretPatterns; do
  has=$(jq --arg k "$key" -r '.userConfig | has($k) | tostring' "$PLUGIN_JSON")
  assert_eq "userConfig has $key" "true" "$has"
done

# Removed in 0.2.0: maxTasks and execution.maxOrchestratorTurns circuit breakers.
# Long-running autonomous pipelines should only trip on consecutive failures or
# an opt-in wall-clock runtime cap — task/turn count caps fight that purpose.
for removed in 'maxTasks' 'execution.maxOrchestratorTurns'; do
  has=$(jq --arg k "$removed" -r '.userConfig | has($k) | tostring' "$PLUGIN_JSON")
  assert_eq "userConfig does NOT contain $removed" "false" "$has"
done

# 0.2.0 defaults: runtime unlimited (0 = no cap), failures raised to 5.
default_runtime=$(jq -r '.userConfig["maxRuntimeMinutes"].default' "$PLUGIN_JSON")
assert_eq "maxRuntimeMinutes default = 0 (unlimited)" "0" "$default_runtime"

min_runtime=$(jq -r '.userConfig["maxRuntimeMinutes"].min' "$PLUGIN_JSON")
assert_eq "maxRuntimeMinutes min = 0" "0" "$min_runtime"

default_failures=$(jq -r '.userConfig["maxConsecutiveFailures"].default' "$PLUGIN_JSON")
assert_eq "maxConsecutiveFailures default = 5" "5" "$default_failures"

plugin_version=$(jq -r '.version' "$PLUGIN_JSON")
assert_eq "plugin version = 0.2.0" "0.2.0" "$plugin_version"

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

# task_16_08: LiteLLM keys must be absent (feature was never implemented)
for stripped in localLlm.useLiteLlm localLlm.liteLlmUrl; do
  has=$(jq --arg k "$stripped" -r '.userConfig | has($k) | tostring' "$PLUGIN_JSON")
  assert_eq "userConfig does NOT contain $stripped" "false" "$has"
done

# task_16_01: write-protection hook registered for Edit/Write/MultiEdit
HOOKS_JSON="$PLUGIN_ROOT/hooks/hooks.json"
wp_registered=$(jq -r '[.hooks.PreToolUse[] | select(.matcher | test("Edit|Write|MultiEdit")) | .hooks[] | .command] | map(select(test("write-protection"))) | length' "$HOOKS_JSON")
assert_eq "hooks.json registers write-protection.sh on Edit/Write/MultiEdit" "1" "$wp_registered"

# task_16_01: default blocklist is an empty array
default_blocked=$(jq -rc '.userConfig["safety.writeBlockedPaths"].default' "$PLUGIN_JSON")
assert_eq "safety.writeBlockedPaths default is []" "[]" "$default_blocked"

# task_16_02: default secret-guard config (useTruffleHog=false, allowedSecretPatterns=[])
default_truffle=$(jq -r '.userConfig["safety.useTruffleHog"].default' "$PLUGIN_JSON")
assert_eq "safety.useTruffleHog default = false" "false" "$default_truffle"
default_allowed=$(jq -rc '.userConfig["safety.allowedSecretPatterns"].default' "$PLUGIN_JSON")
assert_eq "safety.allowedSecretPatterns default = []" "[]" "$default_allowed"

# task_16_12: scaffold slash command + --check mode
assert_eq "commands/scaffold.md exists" "true" \
  "$([[ -f "$PLUGIN_ROOT/commands/scaffold.md" ]] && echo true || echo false)"
assert_contains "scaffold.md has frontmatter description" "description:" "$PLUGIN_ROOT/commands/scaffold.md"
assert_contains "scaffold.md mentions trufflehog" "trufflehog" "$PLUGIN_ROOT/commands/scaffold.md"

# pipeline-scaffold --check: empty tempdir → exit 1
scaffold_empty=$(mktemp -d)
set +e
"$PLUGIN_ROOT/bin/pipeline-scaffold" "$scaffold_empty" --check >/dev/null 2>&1
check_empty_ec=$?
set -e
assert_eq "pipeline-scaffold --check in unscaffolded dir → exit 1" "1" "$check_empty_ec"

# Run full scaffold then re-check
"$PLUGIN_ROOT/bin/pipeline-scaffold" "$scaffold_empty" >/dev/null 2>&1 || true
set +e
"$PLUGIN_ROOT/bin/pipeline-scaffold" "$scaffold_empty" --check >/dev/null 2>&1
check_full_ec=$?
set -e
assert_eq "pipeline-scaffold --check after scaffolding → exit 0" "0" "$check_full_ec"
rm -rf "$scaffold_empty"

# ============================================================
echo "=== commands/configure.md ==="

CONFIGURE="$PLUGIN_ROOT/commands/configure.md"
assert_file_exists "configure.md exists" "$CONFIGURE"
assert_contains "has description" "description:" "$CONFIGURE"
assert_contains "has Step 1" "Step 1" "$CONFIGURE"
assert_contains "has Step 2" "Step 2" "$CONFIGURE"
assert_contains "writes to config.json" "config.json" "$CONFIGURE"
assert_contains "probes ollama" "ollama" "$CONFIGURE"

# task_08_02: write step must use setpath with split(".") so dotted keys
# create nested objects, not flat keys with literal dots in their name.
assert_contains "configure.md uses setpath for nested keys" "setpath" "$CONFIGURE"
assert_contains "configure.md splits dotted key into path array" 'split(".")' "$CONFIGURE"
if grep -qE "jq[^']*'\.\[\\\$k\] = \\\$v'" "$CONFIGURE"; then
  echo "  FAIL: configure.md still uses flat-key write '.[\$k] = \$v'"
  fail=$((fail + 1))
else
  echo "  PASS: configure.md no longer uses flat-key write"
  pass=$((pass + 1))
fi

# Exercise the documented jq one-liner against a synthetic fixture to confirm
# that the dotted key produces a nested object (and not a flat top-level key).
# Cleanup is inline at the end of this block — the materialize section below
# installs its own EXIT trap and would overwrite anything set here.
CFG_DIR=$(mktemp -d "${TMPDIR:-/tmp}/phase9-configure-XXXXXX")
CFG_FILE="$CFG_DIR/config.json"
echo '{}' > "$CFG_FILE"

CFG_TMP=$(mktemp "$CFG_DIR/config.XXXXXX")
jq --arg k "review.routineRounds" --argjson v 3 \
  'setpath(($k | split(".")); $v)' \
  "$CFG_FILE" > "$CFG_TMP"
mv -f "$CFG_TMP" "$CFG_FILE"

nested_value=$(jq -r '.review.routineRounds // "missing"' "$CFG_FILE")
assert_eq "setpath creates nested review.routineRounds" "3" "$nested_value"

flat_value=$(jq -r '."review.routineRounds" // "missing"' "$CFG_FILE")
assert_eq "no flat key with literal dot in name" "missing" "$flat_value"

# Adding a sibling key under the same namespace must preserve the first.
CFG_TMP2=$(mktemp "$CFG_DIR/config.XXXXXX")
jq --arg k "review.featureRounds" --argjson v 5 \
  'setpath(($k | split(".")); $v)' \
  "$CFG_FILE" > "$CFG_TMP2"
mv -f "$CFG_TMP2" "$CFG_FILE"

sibling_first=$(jq -r '.review.routineRounds' "$CFG_FILE")
sibling_second=$(jq -r '.review.featureRounds' "$CFG_FILE")
assert_eq "sibling write preserves review.routineRounds" "3" "$sibling_first"
assert_eq "sibling write adds review.featureRounds" "5" "$sibling_second"

# task_08_03: string-typed settings must use --arg, not --argjson, because raw
# strings (e.g. URLs) are not valid JSON literals. Confirm both that the
# documented technique works at runtime AND that configure.md documents both
# variants.
CFG_TMP3=$(mktemp "$CFG_DIR/config.XXXXXX")
jq --arg k "localLlm.ollamaUrl" --arg v "http://192.168.1.50:11434" \
  'setpath(($k | split(".")); $v)' \
  "$CFG_FILE" > "$CFG_TMP3"
mv -f "$CFG_TMP3" "$CFG_FILE"

string_value=$(jq -r '.localLlm.ollamaUrl // "missing"' "$CFG_FILE")
assert_eq "setpath with --arg writes string localLlm.ollamaUrl" \
  "http://192.168.1.50:11434" "$string_value"

# Sanity-check: --argjson on the same raw string SHOULD fail, proving why we
# need the string/number distinction in the first place.
CFG_TMP4=$(mktemp "$CFG_DIR/config.XXXXXX")
if jq --arg k "localLlm.ollamaUrl" --argjson v "http://192.168.1.50:11434" \
  'setpath(($k | split(".")); $v)' \
  "$CFG_FILE" > "$CFG_TMP4" 2>/dev/null; then
  echo "  FAIL: --argjson unexpectedly accepted a raw URL string"
  fail=$((fail + 1))
else
  echo "  PASS: --argjson rejects raw URL string (proves --arg is required for strings)"
  pass=$((pass + 1))
fi
rm -f "$CFG_TMP4"

[[ -n "${CFG_DIR:-}" && "$CFG_DIR" == "${TMPDIR:-/tmp}"/* ]] && rm -rf "$CFG_DIR"
unset CFG_DIR CFG_FILE CFG_TMP CFG_TMP2 CFG_TMP3 CFG_TMP4

# task_08_03: configure.md must document the --arg vs --argjson distinction.
# Note: grep -qF would interpret a leading "--" as an option terminator, so the
# assertions search for unambiguous substrings of the documented examples.
assert_contains "configure.md documents argjson for numbers/booleans" \
  'argjson v 3' "$CONFIGURE"
assert_contains "configure.md documents arg for strings" \
  'arg v "http://192.168.1.50:11434"' "$CONFIGURE"
assert_contains "configure.md gives a string-valued example (localLlm.ollamaUrl)" \
  'localLlm.ollamaUrl' "$CONFIGURE"
assert_contains "configure.md gives a numeric example (review.routineRounds)" \
  'review.routineRounds' "$CONFIGURE"

# task_08_04: plugin.json keys must match the canonical names used in the PRD.
# Both directions: every key in plugin.json must appear in 02-quality-and-config.md,
# and every key documented in the PRD must exist in plugin.json. (We restrict to
# the user-config schema section, not prose mentions.)
PRD="$PLUGIN_ROOT/02-quality-and-config.md"
assert_file_exists "PRD 02-quality-and-config.md exists" "$PRD"

while IFS= read -r key; do
  if grep -qF "$key:" "$PRD"; then
    echo "  PASS: PRD documents userConfig key $key"
    pass=$((pass + 1))
  else
    echo "  FAIL: PRD missing userConfig key $key"
    fail=$((fail + 1))
  fi
done < <(jq -r '.userConfig | keys[]' "$PLUGIN_JSON")

# task_08_04: legacy key names must not appear in code or docs that the plugin
# actually reads at runtime (excludes remediation/ history and the plan files
# describing the migration itself).
for legacy in 'circuitBreaker.maxTasks' 'parallel.maxConcurrent' 'holdout.percent' 'mutationTesting.scoreThreshold'; do
  hits=$(grep -RIl --exclude-dir=remediation --exclude-dir=.git \
    --exclude='03-components.md' --exclude='01-prd.md' \
    --exclude-dir=node_modules \
    -F "$legacy" "$PLUGIN_ROOT" 2>/dev/null | grep -v 'tests/config.sh' || true)
  if [[ -z "$hits" ]]; then
    echo "  PASS: no live reference to legacy key $legacy"
    pass=$((pass + 1))
  else
    echo "  FAIL: legacy key $legacy still referenced in: $hits"
    fail=$((fail + 1))
  fi
done

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

# task_13_02: schema versioning
assert_contains "index.js declares user_version" "user_version" "$INDEX"
assert_contains "index.js has CURRENT_SCHEMA_VERSION" "CURRENT_SCHEMA_VERSION" "$INDEX"

# task_13_03: pagination offset support
assert_contains "index.js supports offset parameter" "offset" "$INDEX"

# ============================================================
echo ""
echo "=== pipeline-scaffold quality-gate.yml — dynamic package manager (task_10_01) ==="

SCAFFOLD="$PLUGIN_ROOT/bin/pipeline-scaffold"
assert_file_exists "pipeline-scaffold exists" "$SCAFFOLD"

SCAFFOLD_DIR=$(mktemp -d "${TMPDIR:-/tmp}/phase9-scaffold-XXXXXX")
trap '[[ -n "${SCAFFOLD_DIR:-}" && "$SCAFFOLD_DIR" == "${TMPDIR:-/tmp}"/* ]] && rm -rf "$SCAFFOLD_DIR"' EXIT

_scaffold_with_lockfile() {
  local fixture="$1" lockfile="$2"
  mkdir -p "$SCAFFOLD_DIR/$fixture"
  [[ -n "$lockfile" ]] && : > "$SCAFFOLD_DIR/$fixture/$lockfile"
  "$SCAFFOLD" "$SCAFFOLD_DIR/$fixture" >/dev/null
}

# --- pnpm ---
_scaffold_with_lockfile pnpm-proj pnpm-lock.yaml
PNPM_YML="$SCAFFOLD_DIR/pnpm-proj/.github/workflows/quality-gate.yml"
assert_file_exists "pnpm scaffold generated quality-gate.yml" "$PNPM_YML"
assert_contains "pnpm workflow uses pnpm/action-setup" "pnpm/action-setup" "$PNPM_YML"
assert_contains "pnpm workflow caches pnpm" "cache: pnpm" "$PNPM_YML"
assert_contains "pnpm workflow uses pnpm install --frozen-lockfile" "pnpm install --frozen-lockfile" "$PNPM_YML"
if grep -qE '^\s*- run: (yarn|bun|npm) ' "$PNPM_YML"; then
  echo "  FAIL: pnpm workflow leaks non-pnpm run commands"
  fail=$((fail + 1))
else
  echo "  PASS: pnpm workflow has no non-pnpm run commands"
  pass=$((pass + 1))
fi

# --- yarn ---
_scaffold_with_lockfile yarn-proj yarn.lock
YARN_YML="$SCAFFOLD_DIR/yarn-proj/.github/workflows/quality-gate.yml"
assert_file_exists "yarn scaffold generated quality-gate.yml" "$YARN_YML"
assert_contains "yarn workflow caches yarn" "cache: yarn" "$YARN_YML"
assert_contains "yarn workflow uses yarn install --immutable" "yarn install --immutable" "$YARN_YML"
if grep -q 'pnpm/action-setup' "$YARN_YML"; then
  echo "  FAIL: yarn workflow still references pnpm/action-setup"
  fail=$((fail + 1))
else
  echo "  PASS: yarn workflow has no pnpm/action-setup"
  pass=$((pass + 1))
fi

# --- bun ---
_scaffold_with_lockfile bun-proj bun.lockb
BUN_YML="$SCAFFOLD_DIR/bun-proj/.github/workflows/quality-gate.yml"
assert_file_exists "bun scaffold generated quality-gate.yml" "$BUN_YML"
assert_contains "bun workflow uses oven-sh/setup-bun" "oven-sh/setup-bun" "$BUN_YML"
assert_contains "bun workflow uses bun install --frozen-lockfile" "bun install --frozen-lockfile" "$BUN_YML"
if grep -q 'pnpm/action-setup' "$BUN_YML"; then
  echo "  FAIL: bun workflow still references pnpm/action-setup"
  fail=$((fail + 1))
else
  echo "  PASS: bun workflow has no pnpm/action-setup"
  pass=$((pass + 1))
fi

# Also accept the newer text-format bun.lock
_scaffold_with_lockfile bun-text-proj bun.lock
BUN_TEXT_YML="$SCAFFOLD_DIR/bun-text-proj/.github/workflows/quality-gate.yml"
assert_contains "bun.lock (text) also selects bun workflow" "oven-sh/setup-bun" "$BUN_TEXT_YML"

# --- npm ---
_scaffold_with_lockfile npm-proj package-lock.json
NPM_YML="$SCAFFOLD_DIR/npm-proj/.github/workflows/quality-gate.yml"
assert_file_exists "npm scaffold generated quality-gate.yml" "$NPM_YML"
assert_contains "npm workflow caches npm" "cache: npm" "$NPM_YML"
assert_contains "npm workflow uses npm ci" "npm ci" "$NPM_YML"
if grep -q 'pnpm/action-setup' "$NPM_YML"; then
  echo "  FAIL: npm workflow still references pnpm/action-setup"
  fail=$((fail + 1))
else
  echo "  PASS: npm workflow has no pnpm/action-setup"
  pass=$((pass + 1))
fi

# --- no-lockfile fallback ---
_scaffold_with_lockfile bare-proj ""
BARE_YML="$SCAFFOLD_DIR/bare-proj/.github/workflows/quality-gate.yml"
assert_contains "no-lockfile fallback uses npm ci" "npm ci" "$BARE_YML"

# ============================================================
echo ""
echo "=== templates: stryker + dep-cruiser + package.scaffold (task_10_02/03) ==="

STRYKER_TMPL="$PLUGIN_ROOT/templates/.stryker.config.json"
DEPCRUISE_TMPL="$PLUGIN_ROOT/templates/.dependency-cruiser.cjs"
PKG_SCAFFOLD_TMPL="$PLUGIN_ROOT/templates/package.scaffold.json"

assert_file_exists "templates/.stryker.config.json exists" "$STRYKER_TMPL"
assert_valid_json "templates/.stryker.config.json is valid JSON" "$STRYKER_TMPL"
assert_file_exists "templates/.dependency-cruiser.cjs exists" "$DEPCRUISE_TMPL"
assert_file_exists "templates/package.scaffold.json exists" "$PKG_SCAFFOLD_TMPL"
assert_valid_json "templates/package.scaffold.json is valid JSON" "$PKG_SCAFFOLD_TMPL"

# Sanity-check template contents
stryker_runner=$(jq -r '.testRunner' "$STRYKER_TMPL")
assert_eq "stryker template uses vitest runner" "vitest" "$stryker_runner"
assert_contains "dep-cruiser template exports config" "module.exports" "$DEPCRUISE_TMPL"

scaffold_has_testmut=$(jq -r '.scripts["test:mutation"] // empty' "$PKG_SCAFFOLD_TMPL")
assert_eq "package.scaffold.json defines test:mutation script" "stryker run" "$scaffold_has_testmut"
scaffold_has_stryker_dep=$(jq -r '.devDependencies["@stryker-mutator/core"] // empty' "$PKG_SCAFFOLD_TMPL")
if [[ -n "$scaffold_has_stryker_dep" ]]; then
  echo "  PASS: package.scaffold.json declares @stryker-mutator/core devDependency"
  pass=$((pass + 1))
else
  echo "  FAIL: package.scaffold.json missing @stryker-mutator/core"
  fail=$((fail + 1))
fi

# --- task_10_02: scaffold deploys stryker + depcruise when package.json exists ---
NODE_PROJ="$SCAFFOLD_DIR/node-proj"
mkdir -p "$NODE_PROJ"
printf '{"name":"user-proj","version":"1.0.0"}\n' > "$NODE_PROJ/package.json"
"$SCAFFOLD" "$NODE_PROJ" >/dev/null

assert_file_exists "scaffold deploys .stryker.config.json when package.json present" \
  "$NODE_PROJ/.stryker.config.json"
assert_file_exists "scaffold deploys .dependency-cruiser.cjs when package.json present" \
  "$NODE_PROJ/.dependency-cruiser.cjs"

# Byte-identical to template (copy, not mutate)
if diff -q "$STRYKER_TMPL" "$NODE_PROJ/.stryker.config.json" >/dev/null 2>&1; then
  echo "  PASS: deployed .stryker.config.json matches template byte-for-byte"
  pass=$((pass + 1))
else
  echo "  FAIL: deployed .stryker.config.json differs from template"
  fail=$((fail + 1))
fi

# --- Idempotency: second run must not overwrite user customizations ---
printf '{"mutate": ["custom/**"]}\n' > "$NODE_PROJ/.stryker.config.json"
"$SCAFFOLD" "$NODE_PROJ" >/dev/null
custom_mutate=$(jq -rc '.mutate' "$NODE_PROJ/.stryker.config.json")
assert_eq "scaffold does not overwrite existing stryker config" '["custom/**"]' "$custom_mutate"

# --- task_10_02: no package.json → no node-specific templates deployed ---
NO_PKG_PROJ="$SCAFFOLD_DIR/no-pkg-proj"
mkdir -p "$NO_PKG_PROJ"
"$SCAFFOLD" "$NO_PKG_PROJ" >/dev/null
if [[ -f "$NO_PKG_PROJ/.stryker.config.json" ]]; then
  echo "  FAIL: scaffold deployed stryker config without package.json"
  fail=$((fail + 1))
else
  echo "  PASS: scaffold skips stryker config when package.json absent"
  pass=$((pass + 1))
fi
if [[ -f "$NO_PKG_PROJ/.dependency-cruiser.cjs" ]]; then
  echo "  FAIL: scaffold deployed dep-cruiser config without package.json"
  fail=$((fail + 1))
else
  echo "  PASS: scaffold skips dep-cruiser config when package.json absent"
  pass=$((pass + 1))
fi

# --- task_10_03: --merge-package-json flag merges scripts and devDependencies ---
MERGE_PROJ="$SCAFFOLD_DIR/merge-proj"
mkdir -p "$MERGE_PROJ"
cat > "$MERGE_PROJ/package.json" <<'PKG'
{
  "name": "merge-proj",
  "version": "2.3.4",
  "scripts": {
    "start": "node ./server.js",
    "test": "jest"
  },
  "devDependencies": {
    "vitest": "^3.0.0"
  }
}
PKG
"$SCAFFOLD" "$MERGE_PROJ" --merge-package-json >/dev/null

# Scaffold scripts added
added_test_mutation=$(jq -r '.scripts["test:mutation"] // empty' "$MERGE_PROJ/package.json")
assert_eq "merge adds scaffold test:mutation script" "stryker run" "$added_test_mutation"
added_lint=$(jq -r '.scripts.lint // empty' "$MERGE_PROJ/package.json")
assert_eq "merge adds scaffold lint script" "eslint . --max-warnings 0" "$added_lint"

# User scripts preserved
preserved_start=$(jq -r '.scripts.start // empty' "$MERGE_PROJ/package.json")
assert_eq "merge preserves user start script" "node ./server.js" "$preserved_start"
preserved_test=$(jq -r '.scripts.test // empty' "$MERGE_PROJ/package.json")
assert_eq "merge preserves user test script (user wins over scaffold)" "jest" "$preserved_test"

# User's other top-level fields preserved
preserved_name=$(jq -r '.name' "$MERGE_PROJ/package.json")
assert_eq "merge preserves user top-level name" "merge-proj" "$preserved_name"
preserved_version=$(jq -r '.version' "$MERGE_PROJ/package.json")
assert_eq "merge preserves user top-level version" "2.3.4" "$preserved_version"

# User devDependency version wins, new ones are added
preserved_vitest=$(jq -r '.devDependencies.vitest' "$MERGE_PROJ/package.json")
assert_eq "merge preserves user vitest version" "^3.0.0" "$preserved_vitest"
added_depcruise=$(jq -r '.devDependencies["dependency-cruiser"] // empty' "$MERGE_PROJ/package.json")
if [[ -n "$added_depcruise" ]]; then
  echo "  PASS: merge adds scaffold dependency-cruiser devDependency"
  pass=$((pass + 1))
else
  echo "  FAIL: merge did not add dependency-cruiser devDependency"
  fail=$((fail + 1))
fi

# --- task_10_03: second run is a no-op (scaffold scripts already present) ---
before_second=$(jq -S . "$MERGE_PROJ/package.json")
"$SCAFFOLD" "$MERGE_PROJ" --merge-package-json >/dev/null
after_second=$(jq -S . "$MERGE_PROJ/package.json")
if [[ "$before_second" == "$after_second" ]]; then
  echo "  PASS: second --merge-package-json run is a no-op"
  pass=$((pass + 1))
else
  echo "  FAIL: second --merge-package-json run mutated package.json"
  fail=$((fail + 1))
fi

# --- task_10_03: default scaffold (no flag) does NOT mutate package.json ---
NOFLAG_PROJ="$SCAFFOLD_DIR/noflag-proj"
mkdir -p "$NOFLAG_PROJ"
cat > "$NOFLAG_PROJ/package.json" <<'PKG'
{"name":"noflag","scripts":{"only":"echo ok"}}
PKG
original=$(jq -S . "$NOFLAG_PROJ/package.json")
"$SCAFFOLD" "$NOFLAG_PROJ" >/dev/null
after=$(jq -S . "$NOFLAG_PROJ/package.json")
if [[ "$original" == "$after" ]]; then
  echo "  PASS: default scaffold does not merge package.json without flag"
  pass=$((pass + 1))
else
  echo "  FAIL: default scaffold mutated package.json without flag"
  fail=$((fail + 1))
fi

# ============================================================
echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

[[ $fail -eq 0 ]] && exit 0 || exit 1
