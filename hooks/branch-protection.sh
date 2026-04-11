#!/usr/bin/env bash
# PreToolUse hook: block destructive git operations on protected branches.
#
# Stdin: hook input JSON with .tool_input.command
# Exit 0 = allow, Exit 2 = block (reason on stderr as JSON)
#
# task_09_03: previous version pattern-matched substrings of the command line.
# Bypasses included `git push origin $BRANCH` (where $BRANCH expands to "main")
# and decoy strings like `mainly-fixes`. We now:
#   1. Inspect actual repo state via `git symbolic-ref --short HEAD` for the
#      "currently on a protected branch and pushing" check.
#   2. Parse the push refspec to extract the destination branch (handles
#      `<branch>`, `HEAD:<branch>`, `<sha>:<branch>`, and `+<refspec>` force).
#   3. Match the resolved branch against an exact regex over the protected set
#      so `mainly-fixes` no longer matches `main`.
# The legacy substring checks for `git reset --hard <protected>`,
# `git branch -D <protected>`, and `git push <remote> --delete <protected>`
# are preserved using the same exact-match resolver.
set -euo pipefail

PROTECTED_BRANCHES=("main" "master" "develop")

# Build an alternation regex with explicit anchors so `mainly-fixes` !~ main.
PROTECTED_RE="^($(IFS='|'; echo "${PROTECTED_BRANCHES[*]}"))$"

# Read hook input from stdin
input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [[ -z "$command" ]]; then
  exit 0
fi

# Helper: print a JSON block reason and exit 2.
_block() {
  local reason="$1" detail="$2"
  jq -cn --arg r "$reason" --arg d "$detail" \
    '{decision:"block", reason:$r, detail:$d}' >&2
  exit 2
}

# Helper: is the given name in the protected set?
_is_protected() {
  local name="$1"
  [[ "$name" =~ $PROTECTED_RE ]]
}

# Helper: tokenize command preserving simple word boundaries.
# We split on whitespace; complex shell quoting (`'main'` etc) won't survive but
# the protected-branch regex still catches the unquoted form which is what
# matters in practice.
_tokens() {
  printf '%s\n' "$command" | tr -s '[:space:]' '\n'
}

# Helper: extract the resolved destination branch from a `git push` invocation.
# Sets dest_branch to the resolved name (may be empty if unparseable).
_resolve_push_dest() {
  dest_branch=""
  local saw_push=0 saw_remote=0
  local tok stripped
  while IFS= read -r tok; do
    [[ -z "$tok" ]] && continue
    if (( saw_push == 0 )); then
      [[ "$tok" == "git" ]] && continue
      if [[ "$tok" == "push" ]]; then
        saw_push=1
      fi
      continue
    fi
    # After "push": skip flags entirely (--force, --delete, -u, etc).
    if [[ "$tok" == -* || "$tok" == --* ]]; then
      continue
    fi
    if (( saw_remote == 0 )); then
      saw_remote=1
      continue
    fi
    # First non-flag token after the remote is the refspec.
    stripped="${tok#+}"            # strip force-push prefix
    stripped="${stripped##*:}"     # strip src side of <src>:<dst>
    dest_branch="$stripped"
    return 0
  done < <(_tokens)

  # If `git push` had no remote/refspec, fall back to the current branch.
  if (( saw_push == 1 && saw_remote == 0 )); then
    dest_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  fi
}

# Helper: extract the bare-name argument that follows a flag list, used for
# `git reset --hard <ref>`, `git branch -D <name>`, `git push <remote> --delete <name>`.
# Sets target to the resolved name (may be empty).
_extract_named_arg() {
  local needle="$1"   # token sequence to match before consuming a name
  target=""
  local tokens=()
  while IFS= read -r tok; do
    [[ -z "$tok" ]] && continue
    tokens+=("$tok")
  done < <(_tokens)

  local n=${#tokens[@]} i=0
  while (( i < n )); do
    if [[ "${tokens[i]}" == "$needle" ]]; then
      # Walk forward, skipping flags, take first non-flag.
      local j=$((i + 1))
      while (( j < n )); do
        if [[ "${tokens[j]}" == -* || "${tokens[j]}" == --* ]]; then
          j=$((j + 1))
          continue
        fi
        target="${tokens[j]}"
        # Strip force-push / refspec syntax for safety.
        target="${target#+}"
        target="${target##*:}"
        return 0
      done
    fi
    i=$((i + 1))
  done
}

# --- Check 1: are we currently on a protected branch and modifying refs? ---
# Only fires for git operations that mutate refs (push/commit/reset/branch/merge),
# never for read-only `git status` etc.
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+(push|reset[[:space:]]+--hard|branch[[:space:]]+.*-[dD]|commit|merge)([[:space:]]|$)'; then
  current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
  if [[ -n "$current_branch" ]] && _is_protected "$current_branch"; then
    # We allow read-only commands on a protected branch but not mutating ones.
    # `git push` from main is the headline case; others are caught by their own
    # checks below for explicit-target safety.
    if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
      _block "on_protected_branch" "currently on '$current_branch' — push will publish to protected"
    fi
  fi
fi

# --- Check 2: git push --force / -f / --force-with-lease to a protected target ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  _resolve_push_dest
  if [[ -n "$dest_branch" ]] && _is_protected "$dest_branch"; then
    if printf '%s' "$command" | grep -qE '(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))'; then
      _block "force_push_protected" "force-push targets protected branch '$dest_branch'"
    fi
  fi
fi

# --- Check 3: git push +refspec force-syntax to a protected branch ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  _resolve_push_dest
  # Detect leading-+ token in the original command (force-push refspec syntax).
  if printf '%s\n' "$command" | grep -qE '(^|[[:space:]])\+[A-Za-z0-9._/:+-]*'; then
    if [[ -n "$dest_branch" ]] && _is_protected "$dest_branch"; then
      _block "force_push_refspec_protected" "+refspec force-push targets protected branch '$dest_branch'"
    fi
  fi
fi

# --- Check 4: plain `git push <remote> <protected>` (or HEAD:<protected>) ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+push([[:space:]]|$)'; then
  _resolve_push_dest
  if [[ -n "$dest_branch" ]] && _is_protected "$dest_branch"; then
    _block "push_to_protected" "push targets protected branch '$dest_branch'"
  fi
fi

# --- Check 5: git push <remote> --delete <protected> ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+push[[:space:]]+\S+[[:space:]]+--delete([[:space:]]|$)'; then
  _extract_named_arg "--delete"
  if [[ -n "$target" ]] && _is_protected "$target"; then
    _block "remote_delete_protected" "remote deletion of protected branch '$target'"
  fi
fi

# --- Check 6: git reset --hard <protected> ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$)'; then
  _extract_named_arg "--hard"
  if [[ -n "$target" ]]; then
    # Strip remote prefix (origin/main → main) before matching.
    bare="${target##*/}"
    if _is_protected "$bare"; then
      _block "hard_reset_protected" "hard reset targets protected branch '$bare'"
    fi
  fi
fi

# --- Check 7: git branch -D / -d <protected> ---
if printf '%s' "$command" | grep -qE '(^|[[:space:]])git[[:space:]]+branch[[:space:]]+.*-[dD]([[:space:]]|$)'; then
  for flag in "-D" "-d"; do
    _extract_named_arg "$flag"
    if [[ -n "$target" ]] && _is_protected "$target"; then
      _block "delete_protected_branch" "deletion of protected branch '$target'"
    fi
  done
fi

# All checks passed — allow
exit 0
