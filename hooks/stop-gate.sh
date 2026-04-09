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

now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Check task states to determine final status
has_executing=false
all_done=true
any_failed=false

while IFS= read -r task_entry; do
  task_status=$(printf '%s' "$task_entry" | jq -r '.value.status')
  case "$task_status" in
    executing|reviewing)
      has_executing=true
      all_done=false
      ;;
    done) ;;
    failed)
      any_failed=true
      all_done=false
      ;;
    *)
      all_done=false
      ;;
  esac
done < <(printf '%s' "$state" | jq -c '.tasks | to_entries[]' 2>/dev/null)

# Determine final status
final_status="interrupted"
if [[ "$has_executing" == "true" ]]; then
  # Mark executing tasks as interrupted
  state=$(printf '%s' "$state" | jq --arg now "$now" '
    .tasks |= with_entries(
      if .value.status == "executing" or .value.status == "reviewing" then
        .value.status = "interrupted" | .value.ended_at = $now
      else . end
    )
  ')
  final_status="interrupted"
elif [[ "$all_done" == "true" ]]; then
  total=$(printf '%s' "$state" | jq '.tasks | length')
  if [[ "$total" -gt 0 ]]; then
    final_status="completed"
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
