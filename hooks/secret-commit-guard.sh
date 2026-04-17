#!/usr/bin/env bash
# PreToolUse Bash hook: block `git commit` when staged changes contain
# recognisable secrets. Scans the staged diff and file paths with a baked-in
# blocklist; optionally shells out to `trufflehog` when safety.useTruffleHog
# is enabled. Findings matching safety.allowedSecretPatterns are filtered out
# before the block decision. `git push` commands are intentionally not
# covered — block-at-commit is the chosen chokepoint.
#
# Stdin: hook input JSON with .tool_input.command
# Exit 0 = allow, Exit 2 = block (JSON reason on stderr)
set -euo pipefail

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
[[ -z "$command" ]] && exit 0

# Does this command run a `git commit`? Be permissive in recognising it:
# leading `git commit`, plus `git -C <dir> commit`, plus chained forms like
# `cd foo && git commit ...` that include the literal tokens. False positives
# are tolerable — false negatives (missed scans) are not.
if ! printf '%s' "$command" | grep -qE '(^|[[:space:]]|&|;)git([[:space:]]+-[^[:space:]]+[[:space:]]+[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

# --- Built-in path blocklist (file names that should never be committed) ---
# Globs matched against basename + relative path; any match triggers a block
# unless the raw filename also matches safety.allowedSecretPatterns.
PATH_BLOCKLIST=(
  '.env'             '.env.*'        '.env*'
  '*.pem'            '*.key'
  'id_rsa*'          'id_ed25519*'   'id_ecdsa*'   'id_dsa*'
  'credentials.json' 'credentials.yaml' 'credentials.yml'
  '*.keystore'       '*.p12'         '*.pfx'       '*.jks'
  'service-account*.json'
  '.netrc'           '*.crt'
)

# --- Built-in content-regex patterns ---
CONTENT_PATTERNS=(
  'AKIA[0-9A-Z]{16}'
  'ghp_[A-Za-z0-9]{36}'
  'ghs_[A-Za-z0-9]{36}'
  'gho_[A-Za-z0-9]{36}'
  'ghr_[A-Za-z0-9]{36}'
  'sk-[A-Za-z0-9]{20,}'
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
)

# Load user allowlist of safe patterns (regex). Absent config → empty list.
allowed_patterns=()
config_file="${CLAUDE_PLUGIN_DATA:-}/config.json"
if [[ -f "$config_file" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && allowed_patterns+=("$line")
  done < <(jq -r '.["safety.allowedSecretPatterns"] // [] | .[]' "$config_file" 2>/dev/null || true)
fi

# Return 0 if $1 matches any allowed regex, else 1.
_is_allowed() {
  local candidate="$1" pat
  for pat in "${allowed_patterns[@]}"; do
    [[ -z "$pat" ]] && continue
    if printf '%s' "$candidate" | grep -Eq "$pat"; then
      return 0
    fi
  done
  return 1
}

# Redact a raw secret-looking string for the error output (first 4 chars + ****).
_redact() {
  local s="$1"
  local prefix="${s:0:4}"
  printf '%s****' "$prefix"
}

blocks=()

# Resolve where the commit is happening. For `git -C <dir> commit ...` use that
# directory; otherwise use the caller's cwd. Fall back to pwd if parsing fails.
commit_dir="$PWD"
# shellcheck disable=SC2016
commit_c=$(printf '%s' "$command" | grep -oE 'git[[:space:]]+-C[[:space:]]+[^[:space:]]+' | head -1 | awk '{print $NF}' || true)
if [[ -n "$commit_c" ]] && [[ -d "$commit_c" ]]; then
  commit_dir="$commit_c"
fi

# If the commit dir isn't actually a git repo, we can't scan — fail open
# (allow). The commit itself will fail downstream.
if ! git -C "$commit_dir" rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# --- Path scan ---
while IFS= read -r staged_path; do
  [[ -z "$staged_path" ]] && continue
  base=$(basename "$staged_path")
  for glob in "${PATH_BLOCKLIST[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$base" == $glob || "$staged_path" == $glob ]]; then
      if ! _is_allowed "$staged_path"; then
        blocks+=("path:$staged_path (matched $glob)")
      fi
      break
    fi
  done
done < <(git -C "$commit_dir" diff --cached --name-only 2>/dev/null || true)

# --- Content-regex scan (on the staged diff, unified=0) ---
staged_diff=$(git -C "$commit_dir" diff --cached -U0 2>/dev/null || true)
if [[ -n "$staged_diff" ]]; then
  for pat in "${CONTENT_PATTERNS[@]}"; do
    while IFS= read -r hit; do
      [[ -z "$hit" ]] && continue
      if ! _is_allowed "$hit"; then
        blocks+=("content:$(_redact "$hit") (matched /$pat/)")
      fi
    done < <(printf '%s' "$staged_diff" | grep -Eo "$pat" 2>/dev/null || true)
  done
fi

# --- Optional TruffleHog scan ---
use_trufflehog="false"
if [[ -f "$config_file" ]]; then
  use_trufflehog=$(jq -r '.["safety.useTruffleHog"] // false | tostring' "$config_file" 2>/dev/null || printf 'false')
fi
if [[ "$use_trufflehog" == "true" ]]; then
  if command -v trufflehog >/dev/null 2>&1; then
    # Scan the commit dir; --only-verified reduces false positives. JSON mode
    # emits one object per finding.
    th_err=$(mktemp)
    set +e
    trufflehog_output=$(trufflehog filesystem --directory "$commit_dir" --only-verified --no-update --json 2>"$th_err")
    th_rc=$?
    set -e
    if (( th_rc != 0 )); then
      th_stderr=$(<"$th_err")
      printf '%s\n' "secret-commit-guard: trufflehog exited $th_rc — falling back to regex-only scan; stderr: ${th_stderr:0:300}" >&2
    fi
    rm -f "$th_err"
    if [[ -n "$trufflehog_output" ]]; then
      while IFS= read -r finding; do
        [[ -z "$finding" ]] && continue
        raw=$(printf '%s' "$finding" | jq -r '.Raw // empty' 2>/dev/null)
        [[ -z "$raw" ]] && continue
        if ! _is_allowed "$raw"; then
          blocks+=("trufflehog:$(_redact "$raw")")
        fi
      done <<< "$trufflehog_output"
    fi
  else
    # Warn once but do not block.
    printf '%s\n' "secret-commit-guard: trufflehog enabled in safety.useTruffleHog but not installed; falling back to regex-only" >&2
  fi
fi

if (( ${#blocks[@]} > 0 )); then
  # Emit structured block reason on stderr with raw secrets redacted.
  jq -cn --argjson blocks "$(printf '%s\n' "${blocks[@]}" | jq -Rn '[inputs]')" \
    '{decision:"block", reason:"secret_detected", detail:$blocks}' >&2
  exit 2
fi

exit 0
