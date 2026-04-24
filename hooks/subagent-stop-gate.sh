#!/usr/bin/env bash
# SubagentStop hook: verify expected artifacts exist when subagents complete.
# Checks vary by agent type (spec-generator, task-executor, implementation-reviewer).
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
    # Check commits on every executing task's worktree, not just the first.
    # Parallel task-executors run concurrently — the subagent-stop hook fires
    # per subagent return, but we still want to surface missing commits across
    # the whole fan-out so warnings are not lost.
    state_file="$run_dir/state.json"
    if [[ -f "$state_file" ]]; then
      while IFS= read -r tid; do
        [[ -z "$tid" ]] && continue
        branch=$(jq -r --arg t "$tid" '.tasks[$t].branch // empty' "$state_file" 2>/dev/null)
        worktree=$(jq -r --arg t "$tid" '.tasks[$t].worktree // empty' "$state_file" 2>/dev/null)
        if [[ -z "$branch" ]]; then
          continue
        fi
        # Prefer the task's own worktree for the git log check — cwd is the
        # orchestrator, which has no knowledge of the task branch.
        log_output=""
        if [[ -n "$worktree" && -d "$worktree" ]]; then
          log_output=$(git -C "$worktree" log --oneline "staging..$branch" 2>/dev/null || true)
        else
          log_output=$(git log --oneline "staging..$branch" 2>/dev/null || true)
        fi
        if [[ -z "$log_output" ]]; then
          warnings+=("no commits found on branch $branch for task $tid")
        fi
      done < <(jq -r '
        [.tasks | to_entries[] | select(.value.status == "executing") | .key] | .[]
      ' "$state_file" 2>/dev/null)
    fi
    ;;

  implementation-reviewer)
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

# Log warnings (never block) and persist them as a structured event so the
# orchestrator's run summary can surface missed commits / missing artifacts.
# stderr alone gets lost across subagent boundaries; the JSONL file is read
# back by pipeline-summary.
if (( ${#warnings[@]} > 0 )); then
  events_file="$run_dir/missed-artifacts.jsonl"
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  for w in "${warnings[@]}"; do
    echo "[subagent-stop-gate] WARNING: $w" >&2
    if command -v jq >/dev/null 2>&1; then
      jq -cn --arg ts "$ts" --arg agent_type "$agent_type" --arg warning "$w" \
        '{timestamp:$ts, agent_type:$agent_type, warning:$warning}' \
        >> "$events_file" 2>/dev/null || true
    fi
  done
fi

exit 0
