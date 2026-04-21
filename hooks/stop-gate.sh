#!/usr/bin/env bash
# Stop hook: validate state consistency on session end.
# Marks interrupted runs and updates final status.
#
# Stdin: JSON with session_id
# Exit: always 0 (never blocks session end)
set -euo pipefail

# Check for active run
current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]] || [[ ! -L "$current_link" ]]; then
  exit 0
fi

run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
state_file="$run_dir/state.json"

if [[ ! -f "$state_file" ]]; then
  exit 0
fi

state=$(cat "$state_file")

# Validate JSON — corrupt state should not leave dangling symlink
if ! printf '%s' "$state" | jq -e . >/dev/null 2>&1; then
  echo "[stop-gate] ERROR: corrupt state.json, cleaning up symlink" >&2
  rm -f "$current_link"
  exit 0
fi

run_status=$(printf '%s' "$state" | jq -r '.status')

# Only act on running/executing runs
if [[ "$run_status" != "running" ]]; then
  exit 0
fi

# Autonomous-mode block: refuse to finish while run is live. Orchestrator
# must advance the stage machine (pipeline-run-task) or explicitly mark the
# run terminal. Escape hatch: FACTORY_ALLOW_STOP=1 lets the session end even
# with non-terminal tasks (for emergency recovery or debugging).
if [[ "${FACTORY_AUTONOMOUS_MODE:-0}" == "1" && "${FACTORY_ALLOW_STOP:-0}" != "1" ]]; then
  nonterm=$(printf '%s' "$state" | jq -r '
    [.tasks[]? | select(.status != "done" and .status != "failed" and .status != "needs_human_review")]
    | length
  ')
  if (( nonterm > 0 )); then
    run_id=$(basename "$run_dir")
    next_task=$(printf '%s' "$state" | jq -r '
      [.tasks | to_entries[] |
       select(.value.status != "done" and .value.status != "failed" and .value.status != "needs_human_review") |
       .key] | first // "RUN"
    ')
    reason="run $run_id has $nonterm non-terminal task(s); call pipeline-run-task \"$run_id\" $next_task --stage <stage> to advance (or finalize-run if all tasks are terminal). Set FACTORY_ALLOW_STOP=1 to bypass."
    jq -cn --arg reason "$reason" '{decision:"block", reason:$reason}'
    exit 0
  fi
fi

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Classify every task. Status set (from pipeline-state task-status validation):
#   pending executing reviewing done failed interrupted needs_human_review ci_fixing
#
# - executing / reviewing: in-flight work that the session abandoned → move to
#   interrupted so the next run resumes them.
# - ci_fixing: waiting on CI; session end abandons the in-flight fix. Same
#   treatment as executing (must be re-run on resume).
# - needs_human_review: blocked on external input. Must NOT become interrupted
#   — preserve the status so the human can address it on resume.
# - pending: not started; resume picks it up as-is.
# - interrupted: already terminal-for-resume; leave alone.
# - done / failed: terminal.
#
# Run-level status derivation:
#   - If any task ends up in executing/reviewing/ci_fixing (transitioned to
#     interrupted here) or in pending / interrupted / needs_human_review → run
#     is not fully terminal → "interrupted" (resumable) or "partial" (has failures).
#   - If all tasks done → "completed".
#   - If none done but any failed → "partial".
has_inflight=false
has_resumable=false
has_needs_human=false
all_done=true
any_failed=false
has_tasks=false

while IFS= read -r task_entry; do
  has_tasks=true
  task_status=$(printf '%s' "$task_entry" | jq -r '.value.status')
  case "$task_status" in
    executing|reviewing|ci_fixing)
      has_inflight=true
      all_done=false
      ;;
    pending|interrupted)
      has_resumable=true
      all_done=false
      ;;
    needs_human_review)
      has_needs_human=true
      all_done=false
      ;;
    done) ;;
    failed)
      any_failed=true
      all_done=false
      ;;
    *)
      # Unknown status — surface explicitly rather than silently coalescing.
      echo "[stop-gate] WARNING: unknown task status '$task_status'" >&2
      all_done=false
      ;;
  esac
done < <(printf '%s' "$state" | jq -c '.tasks | to_entries[]' 2>/dev/null)

# Transition in-flight tasks to interrupted (needs_human_review is preserved).
if [[ "$has_inflight" == "true" ]]; then
  state=$(printf '%s' "$state" | jq --arg now "$now" '
    .tasks |= with_entries(
      if .value.status == "executing"
         or .value.status == "reviewing"
         or .value.status == "ci_fixing" then
        .value.status = "interrupted" | .value.ended_at = $now
      else . end
    )
  ')
fi

# Determine run-level final status.
final_status="interrupted"
if [[ "$has_tasks" == "false" ]]; then
  final_status="interrupted"
elif [[ "$all_done" == "true" ]]; then
  final_status="completed"
elif [[ "$has_inflight" == "true" || "$has_resumable" == "true" || "$has_needs_human" == "true" ]]; then
  # Resumable: mixed state (some done, some not) but also some failures ⇒ partial.
  if [[ "$any_failed" == "true" ]]; then
    final_status="partial"
  else
    final_status="interrupted"
  fi
elif [[ "$any_failed" == "true" ]]; then
  final_status="partial"
fi

# Find resume point (first non-done/non-failed task)
resume_task=$(printf '%s' "$state" | jq -r '
  [.tasks | to_entries[] |
   select(.value.status != "done" and .value.status != "failed") |
   .key] | first // empty
')

# Update state
updated=$(printf '%s' "$state" | jq \
  --arg status "$final_status" \
  --arg now "$now" \
  --arg resume "$resume_task" '
  .status = $status |
  .ended_at = $now |
  .updated_at = $now |
  .resume_point = (if $resume != "" then $resume else null end)
')

# Atomic write
tmp=$(mktemp "${state_file}.XXXXXX")
printf '%s' "$updated" > "$tmp"
mv -f "$tmp" "$state_file"

# Remove current symlink
rm -f "$current_link"

# Log to stderr (visible in hook output)
echo "[stop-gate] run $(basename "$run_dir") → $final_status (resume: ${resume_task:-none})" >&2

exit 0
