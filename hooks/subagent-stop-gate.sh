#!/usr/bin/env bash
# SubagentStop hook: verify expected artifacts exist when subagents complete.
# Checks vary by agent type (spec-generator, task-executor, task-reviewer).
#
# Stdin: JSON with agent_id, agent_type
# Exit: always 0 (logs warnings but never blocks)
set -euo pipefail

# Check for active run
current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]] || [[ ! -L "$current_link" ]]; then
  exit 0
fi

run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0

# Read hook input
input=$(cat)

agent_type=$(printf '%s' "$input" | jq -r '.agent_type // empty' 2>/dev/null)

if [[ -z "$agent_type" ]]; then
  exit 0
fi

warnings=()

case "$agent_type" in
  spec-generator)
    # Expect spec.md and tasks.json in the run
    state_file="$run_dir/state.json"
    if [[ -f "$state_file" ]]; then
      spec_path=$(jq -r '.spec.path // empty' "$state_file" 2>/dev/null)
      if [[ -n "$spec_path" ]]; then
        if [[ ! -f "$spec_path/spec.md" ]]; then
          warnings+=("spec.md not found at $spec_path")
        fi
        if [[ ! -f "$spec_path/tasks.json" ]]; then
          warnings+=("tasks.json not found at $spec_path")
        fi
      else
        warnings+=("spec path not set in state")
      fi
    fi
    ;;

  task-executor)
    # Expect commits on the task branch (check via state for branch name)
    state_file="$run_dir/state.json"
    if [[ -f "$state_file" ]]; then
      # Find executing tasks and check for branches
      executing=$(jq -r '
        [.tasks | to_entries[] | select(.value.status == "executing") | .key] | first // empty
      ' "$state_file" 2>/dev/null)

      if [[ -n "$executing" ]]; then
        branch=$(jq -r --arg tid "$executing" '.tasks[$tid].branch // empty' "$state_file" 2>/dev/null)
        if [[ -n "$branch" ]]; then
          # Check if branch has commits ahead of staging
          if ! git log --oneline "staging..$branch" 2>/dev/null | grep -q .; then
            warnings+=("no commits found on branch $branch for task $executing")
          fi
        fi
      fi
    fi
    ;;

  task-reviewer)
    # Expect a review verdict file
    state_file="$run_dir/state.json"
    if [[ -f "$state_file" ]]; then
      # Check if any review files were generated
      review_count=$(find "$run_dir/reviews" -name '*.json' -type f 2>/dev/null | wc -l | tr -d ' ')
      if [[ "$review_count" -eq 0 ]]; then
        warnings+=("no review files found in $run_dir/reviews")
      fi
    fi
    ;;
esac

# Log warnings (never block)
for w in "${warnings[@]+"${warnings[@]}"}"; do
  echo "[subagent-stop-gate] WARNING: $w" >&2
done

exit 0
