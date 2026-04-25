#!/usr/bin/env bash
# SubagentStop hook: verify expected artifacts exist when subagents complete.
# Checks vary by agent type (spec-generator, task-executor, implementation-reviewer).
#
# Stdin: JSON with agent_type, last_assistant_message, agent_transcript_path
# Exit:
#   0 — pass (or non-autonomous warn-only mode)
#   1 — blocked (autonomous mode only, missing STATUS or zero commits)
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
  if [[ -n "$input" ]]; then
    echo "[subagent-stop-gate] Warning: non-empty stdin but agent_type could not be parsed; passing through" >&2
  fi
  exit 0
fi

# Derive the task_id that owns this stopped subagent.
# Prompt preambles always start with [task:<id>] for executor/test-writer/reviewer agents.
# This is the only reliable per-agent identity: env vars don't propagate across Task boundaries.
_derive_task_id_from_transcript() {
  local transcript_path="$1"
  local state_file="$2"
  local tid=""
  if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    tid=$(grep -oE '\[task:[^]]+\]' "$transcript_path" 2>/dev/null | head -1 | grep -oE '[^[task:][^]]+' || true)
  fi
  # grep pattern above extracts the id from [task:<id>]; use sed for clarity
  if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    tid=$(grep -oE '\[task:[^]]+\]' "$transcript_path" 2>/dev/null | head -1 | sed 's/\[task:\([^]]*\)\]/\1/' || true)
  fi
  if [[ -z "$tid" ]]; then
    # Fallback: use FACTORY_TASK_ID if set, or first executing task only when exactly 1 is executing
    tid="${FACTORY_TASK_ID:-}"
    if [[ -z "$tid" && -f "${state_file:-}" ]]; then
      local executing_count
      executing_count=$(jq -r '[.tasks | to_entries[] | select(.value.status == "executing")] | length' "$state_file" 2>/dev/null || printf '0')
      if (( executing_count == 1 )); then
        tid=$(jq -r '[.tasks | to_entries[] | select(.value.status == "executing") | .key] | first // empty' "$state_file" 2>/dev/null || true)
      fi
    fi
  fi
  printf '%s' "$tid"
}

autonomous="${FACTORY_AUTONOMOUS_MODE:-0}"
warnings=()
block_reason=""

# ----------------------------------------------------------------
# Autonomous-mode blocking checks
# ----------------------------------------------------------------
if [[ "$autonomous" == "1" ]]; then

  # --- 1. STATUS line check ---
  last_msg=$(printf '%s' "$input" | jq -r '.last_assistant_message // empty' 2>/dev/null)
  status_val=""
  if [[ -n "$last_msg" ]]; then
    status_val=$(printf '%s' "$last_msg" \
      | { grep -oE 'STATUS:[[:space:]]+(DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT|RED_READY|NO_WORK|SKIP)' || true; } \
      | tail -1 \
      | awk '{print $2}')
  fi

  if [[ -z "$status_val" ]]; then
    # No STATUS line found
    block_reason="Missing STATUS line — re-attempt and emit STATUS: <value>"
  elif [[ "$status_val" == "NO_WORK" || "$status_val" == "SKIP" ]]; then
    # Legitimate no-op exit — don't block, don't warn
    :
  fi

  # --- 2. Zero-commits check (task-executor and test-writer only) ---
  # Scoped to the stopping subagent's own task via transcript marker.
  if [[ -z "$block_reason" ]] && \
     [[ "$agent_type" == "task-executor" || "$agent_type" == "test-writer" ]]; then
    state_file="$run_dir/state.json"
    transcript_path=$(printf '%s' "$input" | jq -r '.agent_transcript_path // empty' 2>/dev/null)
    scoped_task_id=$(_derive_task_id_from_transcript "$transcript_path" "$state_file")
    if [[ -z "$scoped_task_id" ]]; then
      echo "[subagent-stop-gate] Warning: cannot identify stopping agent's task_id; skipping zero-commit block to avoid poisoning unrelated tasks" >&2
    elif [[ -f "$state_file" ]]; then
      branch=$(jq -r --arg t "$scoped_task_id" '.tasks[$t].branch // empty' "$state_file" 2>/dev/null)
      worktree=$(jq -r --arg t "$scoped_task_id" '.tasks[$t].worktree // empty' "$state_file" 2>/dev/null)
      if [[ -n "$branch" ]]; then
        log_output=""
        git_dir="${worktree:-}"
        if [[ -n "$git_dir" && -d "$git_dir" ]]; then
          base_ref=""
          if git -C "$git_dir" rev-parse --verify staging >/dev/null 2>&1; then
            base_ref="staging"
          elif git -C "$git_dir" rev-parse --verify origin/staging >/dev/null 2>&1; then
            base_ref="origin/staging"
          fi
          if [[ -n "$base_ref" ]]; then
            log_output=$(git -C "$git_dir" log --oneline "$base_ref..$branch" 2>/dev/null || true)
          else
            block_reason="Cannot verify commits: neither local staging nor origin/staging exists. Fetch staging or create it before running the pipeline."
          fi
        else
          base_ref=""
          if git rev-parse --verify staging >/dev/null 2>&1; then
            base_ref="staging"
          elif git rev-parse --verify origin/staging >/dev/null 2>&1; then
            base_ref="origin/staging"
          fi
          if [[ -n "$base_ref" ]]; then
            log_output=$(git log --oneline "$base_ref..$branch" 2>/dev/null || true)
          else
            block_reason="Cannot verify commits: neither local staging nor origin/staging exists. Fetch staging or create it before running the pipeline."
          fi
        fi
        if [[ -z "$block_reason" ]] && [[ -z "$log_output" ]]; then
          block_reason="No commits detected — complete the implementation and commit before finishing the turn."
        fi
      fi
    fi
  fi

  # --- 3. Retry budget & block/BLOCKED logic ---
  if [[ -n "$block_reason" ]]; then
    state_file="${state_file:-$run_dir/state.json}"
    transcript_path="${transcript_path:-$(printf '%s' "$input" | jq -r '.agent_transcript_path // empty' 2>/dev/null)}"
    task_id=$(_derive_task_id_from_transcript "$transcript_path" "$state_file")

    retry_file="$run_dir/.subagent_retries.${task_id:-unknown}"
    retries=0
    if [[ -f "$retry_file" ]]; then
      retries=$(cat "$retry_file" 2>/dev/null || echo 0)
    fi
    retries=$(( retries + 1 ))
    printf '%s' "$retries" > "$retry_file"

    # Budget: 1 retry (2 attempts total). On 2nd block, write BLOCKED to the
    # correct per-agent status field so downstream stages detect exhaustion.
    if (( retries >= 2 )); then
      if [[ -n "$task_id" ]] && [[ -f "$run_dir/state.json" ]] && command -v pipeline-state >/dev/null 2>&1; then
        run_id=$(basename "$run_dir")
        status_field=""
        case "$agent_type" in
          test-writer)   status_field="test_writer_status" ;;
          task-executor) status_field="executor_status" ;;
          *)             status_field="" ;;
        esac
        if [[ -n "$status_field" ]]; then
          pipeline-state task-write "$run_id" "$task_id" "$status_field" '"BLOCKED"' >/dev/null 2>&1 || true
        fi
      fi
    fi

    # Always emit block JSON and exit 1 when there's a reason to block
    jq -cn --arg reason "$block_reason" '{decision:"block", reason:$reason}'
    exit 1
  fi

  # No block — clean up the retry sidecar for this agent's task
  state_file="${state_file:-$run_dir/state.json}"
  transcript_path="${transcript_path:-$(printf '%s' "$input" | jq -r '.agent_transcript_path // empty' 2>/dev/null)}"
  task_id_for_cleanup=$(_derive_task_id_from_transcript "$transcript_path" "$state_file")
  if [[ -n "$task_id_for_cleanup" ]]; then
    retry_file_cleanup="$run_dir/.subagent_retries.${task_id_for_cleanup}"
    [[ -f "$retry_file_cleanup" ]] && rm -f "$retry_file_cleanup"
  fi
fi

# ----------------------------------------------------------------
# Non-blocking artifact checks (warn-only, all modes)
# ----------------------------------------------------------------

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
        git_dir_warn="${worktree:-}"
        if [[ -n "$git_dir_warn" && -d "$git_dir_warn" ]]; then
          base_ref_warn=""
          if git -C "$git_dir_warn" rev-parse --verify staging >/dev/null 2>&1; then
            base_ref_warn="staging"
          elif git -C "$git_dir_warn" rev-parse --verify origin/staging >/dev/null 2>&1; then
            base_ref_warn="origin/staging"
          fi
          if [[ -n "$base_ref_warn" ]]; then
            log_output=$(git -C "$git_dir_warn" log --oneline "$base_ref_warn..$branch" 2>/dev/null || true)
          elif git -C "$git_dir_warn" rev-parse --verify "$branch" >/dev/null 2>&1; then
            echo "[subagent-stop-gate] Warning: neither staging nor origin/staging found in $git_dir_warn; skipping commit check" >&2
            continue
          else
            log_output=""
          fi
        else
          base_ref_warn=""
          if git rev-parse --verify staging >/dev/null 2>&1; then
            base_ref_warn="staging"
          elif git rev-parse --verify origin/staging >/dev/null 2>&1; then
            base_ref_warn="origin/staging"
          fi
          if [[ -n "$base_ref_warn" ]]; then
            log_output=$(git log --oneline "$base_ref_warn..$branch" 2>/dev/null || true)
          elif git rev-parse --verify "$branch" >/dev/null 2>&1; then
            echo "[subagent-stop-gate] Warning: neither staging nor origin/staging found; skipping commit check" >&2
            continue
          else
            log_output=""
          fi
        fi
        if [[ -z "$log_output" ]]; then
          warnings+=("no commits found on branch $branch for task $tid")
        fi
      done < <(jq -r '
        [.tasks | to_entries[] | select(.value.status == "executing") | .key] | .[]
      ' "$state_file" 2>/dev/null)
    fi
    ;;

  implementation-reviewer|quality-reviewer)
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
