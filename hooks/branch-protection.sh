#!/usr/bin/env bash
# PreToolUse hook: block destructive git operations on protected branches.
# Protected: main, master, develop
# Allowed: staging, feature branches, dark-factory/* branches
#
# Stdin: JSON with tool_input.command
# Exit 0: allow, Exit 2: block (reason on stderr)
set -euo pipefail

PROTECTED_BRANCHES="main master develop"

# Read hook input from stdin
input=$(cat)

# Extract the bash command
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$command" ]]; then
  exit 0
fi

# Helper: check if a branch name is protected
_is_protected() {
  local branch="$1"
  for pb in $PROTECTED_BRANCHES; do
    if [[ "$branch" == "$pb" ]]; then
      return 0
    fi
  done
  return 1
}

# --- Check: git push --force / -f to protected branches ---
if printf '%s' "$command" | grep -qE 'git\s+push\s+.*(-f|--force|--force-with-lease)'; then
  for pb in $PROTECTED_BRANCHES; do
    if printf '%s' "$command" | grep -qw "$pb"; then
      echo "Blocked: force-push to protected branch '$pb'" >&2
      exit 2
    fi
  done
fi

# --- Check: git push +refspec force syntax (e.g., git push origin +main) ---
if printf '%s' "$command" | grep -qE 'git\s+push'; then
  for pb in $PROTECTED_BRANCHES; do
    if printf '%s' "$command" | grep -qE "(^|[[:space:]])\+$pb([[:space:]]|$)"; then
      echo "Blocked: force-push (+refspec) to protected branch '$pb'" >&2
      exit 2
    fi
    if printf '%s' "$command" | grep -qE "(^|[[:space:]])\+[^[:space:]]*:$pb([[:space:]]|$)"; then
      echo "Blocked: force-push (+refspec) to protected branch '$pb'" >&2
      exit 2
    fi
  done
fi

# --- Check: git reset --hard on protected branches ---
if printf '%s' "$command" | grep -qE 'git\s+reset\s+--hard'; then
  # Get current branch to check if it's protected
  # Since we can't run git here, check if the command targets a protected branch
  for pb in $PROTECTED_BRANCHES; do
    if printf '%s' "$command" | grep -qw "$pb"; then
      echo "Blocked: hard reset targeting protected branch '$pb'" >&2
      exit 2
    fi
  done
fi

# --- Check: git branch -D on protected branches ---
if printf '%s' "$command" | grep -qE 'git\s+branch\s+.*-[dD]'; then
  for pb in $PROTECTED_BRANCHES; do
    if printf '%s' "$command" | grep -qw "$pb"; then
      echo "Blocked: deletion of protected branch '$pb'" >&2
      exit 2
    fi
  done
fi

# --- Check: git push origin --delete on protected branches ---
if printf '%s' "$command" | grep -qE 'git\s+push\s+\S+\s+--delete'; then
  for pb in $PROTECTED_BRANCHES; do
    if printf '%s' "$command" | grep -qw "$pb"; then
      echo "Blocked: remote deletion of protected branch '$pb'" >&2
      exit 2
    fi
  done
fi

# All checks passed — allow
exit 0
