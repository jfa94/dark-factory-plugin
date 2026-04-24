# Plan 11 — Validator & Discovery

**Priority:** P2 (polish — discovery gaps cause confusing failures on fresh installs)
**Tasks:** `task_11_01` through `task_11_03`
**Findings:** P2-validator

## Problem

Three discovery gaps in how the plugin finds its prerequisites:

1. **Validator doesn't check user-installed agents across locations.** `pipeline-validate` checks for agents at `.claude/agents/` (project-local) but the user may have them at `~/.claude/agents/` (global), `~/.dotfiles/.claude/agents/` (dotfile-managed), or in another loaded plugin's `agents/` directory. The validator reports "not found" when the agent actually exists and will be resolved at runtime.

2. **PRD marker detection is brittle.** `pipeline-fetch-prd` looks for a PRD by grepping GitHub issue titles for `[PRD]` or reading a file at `docs/prd.md`. It doesn't handle the canonical case of an issue labeled `prd` (GitHub label) or a GitHub Project item. Fresh projects with label-based PRD conventions get "PRD not found".

3. **Repo resolution fails in worktrees.** `pipeline-validate` uses `git rev-parse --show-toplevel` which returns the worktree root, not the main repo root. Some downstream scripts then mix worktree-local and main-repo paths and end up reading/writing to wrong places.

## Scope

In:

- Cross-location agent discovery in `pipeline-validate`
- Label-based and Project-based PRD detection in `pipeline-fetch-prd`
- Unified repo root resolution helper

Out: marketplace-based agent installation (out of scope for this plugin).

## Tasks

| task_id    | Title                          |
| ---------- | ------------------------------ |
| task_11_01 | Cross-location agent discovery |
| task_11_02 | Label-based PRD detection      |
| task_11_03 | Unified repo root resolution   |

## Execution Guidance

### task_11_01 — Cross-location agent discovery

File: `bin/pipeline-validate`

Current:

```bash
check_agent() {
  local name="$1"
  local path=".claude/agents/$name.md"
  if [[ ! -f "$path" ]]; then
    missing+=("$name")
  fi
}
```

Fix: search the full discovery chain that Claude Code actually uses:

```bash
find_agent() {
  local name="$1"
  local locations=(
    ".claude/agents/$name.md"                                      # project-local
    "$HOME/.claude/agents/$name.md"                                 # user-global
    "$HOME/.claude/plugins/cache/*/agents/$name.md"                 # any installed plugin
    "$PLUGIN_ROOT/agents/$name.md"                                  # this plugin
  )

  for loc in "${locations[@]}"; do
    # Expand globs
    for expanded in $loc; do
      if [[ -f "$expanded" ]]; then
        echo "$expanded"
        return 0
      fi
    done
  done

  return 1
}

check_agent() {
  local name="$1"
  local required="$2"  # "required" | "optional"

  if path=$(find_agent "$name"); then
    discovered_agents["$name"]="$path"
    return 0
  fi

  if [[ "$required" == "required" ]]; then
    missing_required+=("$name")
  else
    missing_optional+=("$name")
  fi
  return 1
}
```

In the validation main block:

```bash
check_agent "spec-generator" required
check_agent "task-executor" required
check_agent "implementation-reviewer" required
check_agent "spec-reviewer" required    # bundled (plan 01 follow-up)
check_agent "quality-reviewer" required    # bundled
check_agent "security-reviewer" optional
check_agent "architecture-reviewer" optional

if (( ${#missing_required[@]} > 0 )); then
  jq -n --argjson req "$(printf '%s\n' "${missing_required[@]}" | jq -R . | jq -s .)" \
    '{status:"failed", missing_required:$req}'
  exit 1
fi
```

Tests in `bin/test-phase2.sh` or `bin/test-validator.sh` (new):

1. Agent exists in `.claude/agents/` → found, returns that path
2. Agent exists only in `~/.claude/agents/` → found, returns global path
3. Agent exists only in plugin root → found
4. Agent doesn't exist anywhere + required → exit 1 with `missing_required` listing the name
5. Optional agent missing → exit 0, agent listed in `missing_optional` but non-fatal

### task_11_02 — Label-based PRD detection

File: `bin/pipeline-fetch-prd`

Current approaches:

- Grep issue title for `[PRD]`
- Read `docs/prd.md`

Add two more fallbacks in priority order:

```bash
fetch_prd() {
  local run_id="$1"
  local output_file=".state/$run_id/prd.md"

  # Priority 1: issue number passed explicitly
  if [[ -n "${PRD_ISSUE:-}" ]]; then
    gh issue view "$PRD_ISSUE" --json body -q .body > "$output_file"
    echo '{"source":"issue_explicit","issue":'"$PRD_ISSUE"'}'
    return 0
  fi

  # Priority 2: label-based lookup ("prd" label, most recently updated)
  local labeled_issue
  labeled_issue=$(gh issue list \
    --label prd \
    --state open \
    --json number,title,updatedAt \
    --limit 1 \
    -q '.[0].number' 2>/dev/null || echo "")

  if [[ -n "$labeled_issue" && "$labeled_issue" != "null" ]]; then
    gh issue view "$labeled_issue" --json body -q .body > "$output_file"
    echo "{\"source\":\"label\",\"issue\":$labeled_issue}"
    return 0
  fi

  # Priority 3: title grep (legacy)
  local title_issue
  title_issue=$(gh issue list \
    --search '"[PRD]" in:title' \
    --state open \
    --json number \
    --limit 1 \
    -q '.[0].number' 2>/dev/null || echo "")

  if [[ -n "$title_issue" && "$title_issue" != "null" ]]; then
    gh issue view "$title_issue" --json body -q .body > "$output_file"
    echo "{\"source\":\"title\",\"issue\":$title_issue}"
    return 0
  fi

  # Priority 4: file fallback
  local file_candidates=(
    "docs/prd.md"
    "docs/PRD.md"
    "PRD.md"
    ".github/PRD.md"
  )
  for f in "${file_candidates[@]}"; do
    if [[ -f "$f" ]]; then
      cp "$f" "$output_file"
      echo "{\"source\":\"file\",\"path\":\"$f\"}"
      return 0
    fi
  done

  echo '{"error":"prd_not_found","tried":["label","title","file"]}'
  return 1
}
```

Tests in `bin/test-phase2.sh` — extend the `gh` mock to support `issue list --label prd`:

1. Mock has issue #42 labeled `prd` → fetched, source=`label`
2. No labeled issue but `docs/prd.md` exists → fetched, source=`file`
3. Explicit `PRD_ISSUE=99` env var → uses that, ignores others
4. Nothing exists → error output, exit 1

### task_11_03 — Unified repo root

File: `bin/pipeline-repo-root` (NEW) + callers

Create a single source of truth for repo root resolution:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Returns the main repo root — not the worktree root — so downstream
# scripts read/write to a consistent location regardless of whether
# they're running inside a worktree.

if ! command -v git >/dev/null 2>&1; then
  echo '{"error":"git_not_installed"}' >&2
  exit 1
fi

# git rev-parse --path-format=absolute --git-common-dir returns the
# main .git directory even from inside a linked worktree. The parent
# of that directory is the main repo root.

if ! git_common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
  echo '{"error":"not_in_git_repo"}' >&2
  exit 1
fi

# Strip trailing /.git to get the main repo root
main_root="$(dirname "$git_common")"
echo "$main_root"
```

Update `pipeline-validate`, `pipeline-state`, and any other script that calls `git rev-parse --show-toplevel` — switch them to `pipeline-repo-root`:

```bash
# Before
REPO_ROOT=$(git rev-parse --show-toplevel)

# After
REPO_ROOT=$(pipeline-repo-root)
```

Exception: scripts that specifically need the worktree root (not the main repo) should keep `--show-toplevel` and add a comment explaining why.

Test in `bin/test-phase1.sh` or a new test file:

1. From main repo root → returns main root
2. From subdirectory of main repo → returns main root (not subdir)
3. From linked worktree → returns main repo root, NOT the worktree path
4. From non-git directory → exit 1 with `not_in_git_repo`

## Verification

1. `bin/pipeline-repo-root` exists and executable
2. Grep `bin/` for `rev-parse --show-toplevel` — only in documented exceptions, or zero
3. Grep `bin/pipeline-validate` for `find_agent` — present
4. Grep `bin/pipeline-fetch-prd` for `--label prd` — present
5. `bash bin/test-phase2.sh` — extended gh-mock tests pass
6. `bash bin/test-validator.sh` (or phase1/phase2) — cross-location discovery tests pass
