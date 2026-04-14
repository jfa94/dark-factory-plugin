#!/usr/bin/env bash
# Hook script tests — covers plan 09 (run-tracker seq lock + chained hash,
# branch-protection rewrite, env-migrations Bash guard).
#
# task_09_01: parallel bumps don't collide
# task_09_02: hash chain links every entry and verify_chain detects tampering
# task_09_03: branch-protection inspects repo state, not command substrings
# task_09_04: covered by templates/settings.autonomous.json (see test-phase9.sh)
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_TRACKER="$PLUGIN_ROOT/hooks/run-tracker.sh"
BRANCH_PROTECTION="$PLUGIN_ROOT/hooks/branch-protection.sh"

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

assert_exit_status() {
  local label="$1" expected="$2"; shift 2
  local actual=0
  set +e
  ( "$@" >/dev/null 2>&1 )
  actual=$?
  set -e
  assert_eq "$label" "$expected" "$actual"
}

# ===========================================================================
echo "=== task_09_01: run-tracker seq counter is serialized ==="

# Build a fake run dir so the hook will write to it.
TMPROOT=$(mktemp -d "${TMPDIR:-/tmp}/run-tracker-XXXXXX")
trap '[[ -n "${TMPROOT:-}" && ( "$TMPROOT" == /tmp/* || "$TMPROOT" == /var/folders/* ) ]] && rm -rf "$TMPROOT"' EXIT

export CLAUDE_PLUGIN_DATA="$TMPROOT/data"
mkdir -p "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01"
: > "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl"
ln -s "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01" "$CLAUDE_PLUGIN_DATA/runs/current"

# Sanity: 5 sequential invocations produce sequence numbers 1..5 in order.
for i in 1 2 3 4 5; do
  printf '{"tool_name":"Bash","tool_input":{"command":"echo seq-%d"}}' "$i" \
    | bash "$RUN_TRACKER"
done
serial_seqs=$(jq -r '.seq' "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" | tr '\n' ' ')
assert_eq "5 sequential bumps return 1 2 3 4 5" "1 2 3 4 5 " "$serial_seqs"

# Reset audit log for the parallel run.
: > "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl"

# Parallel: launch 10 PostToolUse calls in the background and wait. With the
# pre-fix `wc -l + 1` race we'd see duplicates and gaps. With the mkdir mutex
# we get exactly 1..10 (in some order).
for i in 1 2 3 4 5 6 7 8 9 10; do
  ( printf '{"tool_name":"Bash","tool_input":{"command":"echo par-%d"}}' "$i" \
    | bash "$RUN_TRACKER" ) &
done
wait

parallel_total=$(wc -l < "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" | tr -d ' ')
assert_eq "parallel bumps wrote 10 entries" "10" "$parallel_total"

distinct_seqs=$(jq -r '.seq' "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" | sort -n | uniq | wc -l | tr -d ' ')
assert_eq "parallel bumps produced 10 distinct seq numbers" "10" "$distinct_seqs"

sorted_seqs=$(jq -r '.seq' "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" | sort -n | tr '\n' ' ')
assert_eq "parallel seqs cover 1..10 with no gaps" "1 2 3 4 5 6 7 8 9 10 " "$sorted_seqs"

# Mutex must always be released — no leftover lock dir after a clean run.
if [[ -d "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/.run-tracker.lock" ]]; then
  echo "  FAIL: mutex lock dir leaked after run"
  fail=$((fail + 1))
else
  echo "  PASS: mutex lock dir cleaned up after run"
  pass=$((pass + 1))
fi

# ===========================================================================
echo ""
echo "=== task_09_02: prev_hash chain links every entry ==="

# Verify the parallel-write log forms a valid chain.
verify_out=$(bash "$RUN_TRACKER" --verify "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01")
verify_status=$(printf '%s' "$verify_out" | jq -r '.status')
assert_eq "verify_chain reports valid for clean log" "valid" "$verify_status"

verify_count=$(printf '%s' "$verify_out" | jq -r '.entries')
assert_eq "verify_chain counted 10 entries" "10" "$verify_count"

# First entry must descend from GENESIS.
first_prev=$(jq -r 'select(.seq == 1) | .prev_hash' "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl")
assert_eq "first chain entry has prev_hash=GENESIS" "GENESIS" "$first_prev"

# Each entry's prev_hash must equal the prior entry's hash, when ordered by seq.
# Re-index by .seq because parallel writes can land in any physical order.
chain_ok=true
prev="GENESIS"
while IFS= read -r row; do
  entry_prev=$(printf '%s' "$row" | jq -r '.prev_hash')
  entry_hash=$(printf '%s' "$row" | jq -r '.hash')
  if [[ "$entry_prev" != "$prev" ]]; then
    chain_ok=false
    break
  fi
  prev="$entry_hash"
done < <(
  while IFS= read -r line; do
    seq=$(printf '%s' "$line" | jq -r '.seq')
    printf '%s\t%s\n' "$seq" "$line"
  done < "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" | sort -n | cut -f2-
)
assert_eq "chain links every entry (prev_hash == prior .hash, ordered by seq)" "true" "$chain_ok"

# Tamper detection: rewrite a middle entry's hash to break the chain.
TAMPERED="$TMPROOT/tampered.jsonl"
cp "$CLAUDE_PLUGIN_DATA/runs/run-tracker-01/audit.jsonl" "$TAMPERED"
# Sort by seq, then mutate the middle line's hash so the next line's prev_hash
# no longer matches.
sorted_tampered="$TMPROOT/tampered.sorted.jsonl"
while IFS= read -r line; do
  seq=$(printf '%s' "$line" | jq -r '.seq')
  printf '%s\t%s\n' "$seq" "$line"
done < "$TAMPERED" | sort -n | cut -f2- > "$sorted_tampered"

awk 'NR==5 {sub(/"hash":"[^"]*"/, "\"hash\":\"deadbeef\"")} 1' "$sorted_tampered" > "$TAMPERED"
verify_tampered=$(bash "$RUN_TRACKER" --verify "$TAMPERED" || true)
tampered_status=$(printf '%s' "$verify_tampered" | jq -r '.status')
assert_eq "verify_chain reports broken for tampered log" "broken" "$tampered_status"

# Tamper detection: drop a middle entry entirely (re-ordering / deletion).
DROPPED="$TMPROOT/dropped.jsonl"
awk 'NR != 5' "$sorted_tampered" > "$DROPPED"
# Re-sort by seq just in case awk processed an unsorted file.
verify_dropped=$(bash "$RUN_TRACKER" --verify "$DROPPED" || true)
dropped_status=$(printf '%s' "$verify_dropped" | jq -r '.status')
assert_eq "verify_chain reports broken when an entry is dropped" "broken" "$dropped_status"

unset CLAUDE_PLUGIN_DATA

# ===========================================================================
echo ""
echo "=== task_09_03: branch-protection inspects repo state ==="

# Build a tiny repo so symbolic-ref returns a known branch.
REPO_FEATURE="$TMPROOT/repo-feature"
mkdir -p "$REPO_FEATURE"
git -C "$REPO_FEATURE" init -q -b feature-x
git -C "$REPO_FEATURE" -c user.email=t@test -c user.name=t commit -q --allow-empty -m "init"

# Helper: invoke the hook from a given cwd with a synthetic Bash command.
_call_protect() {
  local cwd="$1" cmd="$2"
  ( cd "$cwd" && printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg s "$cmd" '$s')" \
    | bash "$BRANCH_PROTECTION" >/dev/null 2>&1 )
  echo $?
}

# 1. Push to a feature branch from a feature branch → exit 0
status=$(_call_protect "$REPO_FEATURE" "git push origin feature-x")
assert_eq "push origin feature-x from feature branch → allow" "0" "$status"

# 2. Push to main → exit 2
status=$(_call_protect "$REPO_FEATURE" "git push origin main")
assert_eq "push origin main → block" "2" "$status"

# 3. Push HEAD:main (colon refspec) → exit 2
status=$(_call_protect "$REPO_FEATURE" "git push origin HEAD:main")
assert_eq "push origin HEAD:main → block" "2" "$status"

# 4. Force-push +master via refspec → exit 2
status=$(_call_protect "$REPO_FEATURE" "git push origin +master")
assert_eq "push origin +master (force refspec) → block" "2" "$status"

# 5. From `main`, explicit push to a non-protected branch is allowed.
#    Commit 3e8b0cb narrowed Check 1 so it only blocks when the destination is
#    implicit (empty) or equals the current protected branch. Publishing
#    `some-feature` from a main checkout doesn't modify main, so it's safe.
REPO_MAIN="$TMPROOT/repo-main"
mkdir -p "$REPO_MAIN"
git -C "$REPO_MAIN" init -q -b main
git -C "$REPO_MAIN" -c user.email=t@test -c user.name=t commit -q --allow-empty -m "init"
status=$(_call_protect "$REPO_MAIN" "git push origin some-feature")
assert_eq "on main, explicit push to non-protected branch → allow" "0" "$status"

# 6. Decoy: branch named `mainly-fixes` must not match `main`.
status=$(_call_protect "$REPO_FEATURE" "git push origin mainly-fixes")
assert_eq "decoy branch 'mainly-fixes' → allow" "0" "$status"

# 7. Non-push command containing the literal "main" must allow.
status=$(_call_protect "$REPO_FEATURE" "git commit -am main")
assert_eq "git commit -am main (literal in message) → allow" "0" "$status"

# 8. --force-with-lease to a protected branch → block.
status=$(_call_protect "$REPO_FEATURE" "git push --force-with-lease origin main")
assert_eq "force-with-lease to main → block" "2" "$status"

# 9. git push with no args from a feature branch → allow (resolves to current).
status=$(_call_protect "$REPO_FEATURE" "git push")
assert_eq "git push (no args) from feature branch → allow" "0" "$status"

# 10. git push with no args from main → block (current branch is protected).
status=$(_call_protect "$REPO_MAIN" "git push")
assert_eq "git push (no args) from main → block" "2" "$status"

# 11. git push origin --delete main → block.
status=$(_call_protect "$REPO_FEATURE" "git push origin --delete main")
assert_eq "git push origin --delete main → block" "2" "$status"

# 12. git reset --hard origin/develop → block (strip remote prefix).
status=$(_call_protect "$REPO_FEATURE" "git reset --hard origin/develop")
assert_eq "git reset --hard origin/develop → block" "2" "$status"

# 13. git branch -D master → block.
status=$(_call_protect "$REPO_FEATURE" "git branch -D master")
assert_eq "git branch -D master → block" "2" "$status"

# 14. git branch -D some-feature → allow.
status=$(_call_protect "$REPO_FEATURE" "git branch -D some-feature")
assert_eq "git branch -D some-feature → allow" "0" "$status"

# 15. Empty / non-Bash input is allowed (no command field).
status=$( ( printf '{}' | bash "$BRANCH_PROTECTION" >/dev/null 2>&1 ); echo $? )
assert_eq "empty hook input → allow" "0" "$status"

# ===========================================================================
echo ""
echo "=== task_16_01: write-protection hook ==="

WP="$PLUGIN_ROOT/hooks/write-protection.sh"
export CLAUDE_PLUGIN_DATA="$TMPROOT/wp-data"
mkdir -p "$CLAUDE_PLUGIN_DATA"

_write_config() { printf '%s' "$1" > "$CLAUDE_PLUGIN_DATA/config.json"; }

# 1. No config.json → exit 0 (fast path, opt-in only)
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
status=$( ( printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.env"}}' | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: no config.json → allow" "0" "$status"

# 2. Empty blocklist → allow
_write_config '{"safety.writeBlockedPaths":[]}'
status=$( ( printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x.env"}}' | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: empty blocklist → allow" "0" "$status"

# 3. .env* blocks an Edit on .env.local
WP_SANDBOX=$(mktemp -d "${TMPDIR:-/tmp}/wp-sandbox-XXXXXX")
_write_config '{"safety.writeBlockedPaths":[".env*"]}'
set +e
wp_block_output=$(printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/.env.local"}}' "$WP_SANDBOX" | bash "$WP" 2>&1 >/dev/null)
wp_ec=$?
set -e
assert_eq "write-protection: .env* blocks Edit on .env.local" "2" "$wp_ec"
assert_eq "write-protection: block JSON reason is write_blocked" "write_blocked" \
  "$(printf '%s' "$wp_block_output" | jq -r '.reason' 2>/dev/null)"

# 4. Same config, unrelated path → allowed
status=$( ( printf '{"tool_name":"Edit","tool_input":{"file_path":"%s/src/config.ts"}}' "$WP_SANDBOX" | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: .env* allows src/config.ts" "0" "$status"

# 5. **/migrations/** blocks a nested SQL migration
_write_config '{"safety.writeBlockedPaths":["**/migrations/**"]}'
mkdir -p "$WP_SANDBOX/supabase/migrations"
status=$( ( printf '{"tool_name":"Write","tool_input":{"file_path":"%s/supabase/migrations/001_init.sql"}}' "$WP_SANDBOX" | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: **/migrations/** blocks nested SQL" "2" "$status"

# 6. MultiEdit with nested edits[].file_path under the blocked glob
status=$( ( printf '{"tool_name":"MultiEdit","tool_input":{"edits":[{"file_path":"%s/supabase/migrations/002.sql"}]}}' "$WP_SANDBOX" | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: MultiEdit edits[] blocked" "2" "$status"

# 7. Non-write tool (Bash) passes through
status=$( ( printf '{"tool_name":"Bash","tool_input":{"command":"ls .env"}}' | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: Bash tool passes through" "0" "$status"

# 8. Basename glob matches regardless of directory depth
_write_config '{"safety.writeBlockedPaths":["credentials.json"]}'
mkdir -p "$WP_SANDBOX/app"
status=$( ( printf '{"tool_name":"Write","tool_input":{"file_path":"%s/app/credentials.json"}}' "$WP_SANDBOX" | bash "$WP" >/dev/null 2>&1 ); echo $? )
assert_eq "write-protection: basename glob matches nested file" "2" "$status"

rm -rf "$WP_SANDBOX"
unset CLAUDE_PLUGIN_DATA

# ===========================================================================
echo ""
echo "=== task_16_02: secret-commit-guard hook ==="

SCG="$PLUGIN_ROOT/hooks/secret-commit-guard.sh"
export CLAUDE_PLUGIN_DATA="$TMPROOT/scg-data"
mkdir -p "$CLAUDE_PLUGIN_DATA"
_scg_write_config() { printf '%s' "$1" > "$CLAUDE_PLUGIN_DATA/config.json"; }

_scg_sandbox() {
  local d
  d=$(mktemp -d "${TMPDIR:-/tmp}/scg-XXXXXX")
  git -C "$d" init -q
  git -C "$d" config user.email "t@t"
  git -C "$d" config user.name "t"
  printf '%s' "$d"
}

_scg_exit() {
  # $1 = cwd, $2 = command; emit the hook's exit code only.
  local cwd="$1" cmd="$2"
  ( cd "$cwd" && printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg s "$cmd" '$s')" \
    | bash "$SCG" >/dev/null 2>&1 ); echo $?
}

# 1. Non-commit command → allow (fast path)
S1=$(_scg_sandbox)
assert_eq "scg: non-commit command → allow" "0" "$(_scg_exit "$S1" "ls -la")"

# 2. git push is explicitly NOT covered → allow
assert_eq "scg: git push not covered → allow" "0" "$(_scg_exit "$S1" "git push origin main")"

# 3. git commit with nothing staged → allow
assert_eq "scg: empty staged diff → allow" "0" "$(_scg_exit "$S1" "git commit -m nothing")"

# 4. Staged .env file → blocked by path rule
S2=$(_scg_sandbox)
printf 'SECRET=foo\n' > "$S2/.env"
git -C "$S2" add .env
assert_eq "scg: staging .env → block" "2" "$(_scg_exit "$S2" "git commit -m pwn")"

# 5. Source file with AWS key → blocked by content regex
S3=$(_scg_sandbox)
printf 'const aws_key = "AKIAIOSFODNN7EXAMPLE";\n' > "$S3/config.ts"
git -C "$S3" add config.ts
assert_eq "scg: AWS key in diff → block" "2" "$(_scg_exit "$S3" "git commit -m feat")"

# 6. Same AWS key in allowlist → pass through
_scg_write_config '{"safety.allowedSecretPatterns":["AKIAIOSFODNN7EXAMPLE"]}'
assert_eq "scg: allowlist filters content hit → allow" "0" "$(_scg_exit "$S3" "git commit -m feat")"

# 7. Clean source file → allow
rm -f "$CLAUDE_PLUGIN_DATA/config.json"
S4=$(_scg_sandbox)
printf 'const greeting = "hello";\n' > "$S4/hello.ts"
git -C "$S4" add hello.ts
assert_eq "scg: clean diff → allow" "0" "$(_scg_exit "$S4" "git commit -m feat")"

# 8. TruffleHog enabled but not installed → warn + regex-only (no false block)
_scg_write_config '{"safety.useTruffleHog":true}'
SCG_NOTRUF=$(mktemp -d "${TMPDIR:-/tmp}/scg-notruf-XXXXXX")
SCG_OLD_PATH="$PATH"
export PATH="$SCG_NOTRUF:/usr/bin:/bin"
assert_eq "scg: trufflehog enabled + not installed + clean → allow" "0" "$(_scg_exit "$S4" "git commit -m feat")"
export PATH="$SCG_OLD_PATH"
rm -rf "$SCG_NOTRUF"

# 9. TruffleHog enabled + mock returns a finding → block
SCG_TRUF=$(mktemp -d "${TMPDIR:-/tmp}/scg-truf-XXXXXX")
cat > "$SCG_TRUF/trufflehog" <<'MOCKEOF'
#!/usr/bin/env bash
printf '{"Raw":"AKIA1234567890FAKE","SourceMetadata":{"Data":{"Filesystem":{"file":"/x"}}}}\n'
MOCKEOF
chmod +x "$SCG_TRUF/trufflehog"
export PATH="$SCG_TRUF:$PATH"
_scg_write_config '{"safety.useTruffleHog":true}'
assert_eq "scg: trufflehog mock finding → block" "2" "$(_scg_exit "$S4" "git commit -m feat")"

# 10. TruffleHog finding matched by allowlist → filtered, allow
_scg_write_config '{"safety.useTruffleHog":true,"safety.allowedSecretPatterns":["AKIA1234567890FAKE"]}'
assert_eq "scg: trufflehog finding in allowlist → allow" "0" "$(_scg_exit "$S4" "git commit -m feat")"

export PATH="$SCG_OLD_PATH"
rm -rf "$SCG_TRUF" "$S1" "$S2" "$S3" "$S4"
unset CLAUDE_PLUGIN_DATA

echo ""
echo "================================"
echo "Hook tests: $pass passed, $fail failed"
echo "================================"

[[ -n "${TMPROOT:-}" && ( "$TMPROOT" == /tmp/* || "$TMPROOT" == /var/folders/* ) ]] && rm -rf "$TMPROOT"
trap - EXIT

[[ $fail -eq 0 ]]
