#!/usr/bin/env bash
# SessionStart hook (matcher: "resume"). Injects current run stage snapshot
# into the orchestrator session so /factory:run resume has immediate context
# without a fresh state read, and exports FACTORY_CURRENT_RUN via
# $CLAUDE_ENV_FILE so every subsequent Bash call has the run id.
#
# Only fires for source=resume sessions. Plugin-data-less sessions no-op.
#
# Stdin: JSON with source, session_id.
# Output: JSON {hookSpecificOutput:{hookEventName:"SessionStart",
#              additionalContext:"..."}} on stdout, exit 0.
set -euo pipefail

input=$(cat 2>/dev/null || printf '{}')
source_kind=$(printf '%s' "$input" | jq -r '.source // empty')
# Matcher gates on "resume" already; be defensive anyway.
[[ "$source_kind" != "resume" ]] && exit 0

current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" || ! -L "$current_link" ]]; then
  exit 0
fi
run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || exit 0
run_id=$(basename "$run_dir")

status=$(jq -r '.status // "unknown"' "$state_file")
# Abort if run is already terminal — nothing to resume.
case "$status" in
  done|completed|failed|partial) exit 0 ;;
esac

# Build per-task stage summary (task_id: status/stage).
summary=$(jq -r '
  (.tasks // {}) | to_entries
  | map("  - " + .key + ": " + (.value.status // "?") + " (stage=" + (.value.stage // "none") + ")")
  | .[]
' "$state_file" 2>/dev/null | head -30)

next_task=$(jq -r '
  [.tasks | to_entries[]
   | select(.value.status != "done" and .value.status != "failed" and .value.status != "needs_human_review")
   | .key] | first // "RUN"
' "$state_file" 2>/dev/null)

next_stage=$(jq -r --arg t "$next_task" '
  (.tasks[$t].stage // "preflight")
  | if . == "preflight_done"  then "postexec"
    elif . == "postexec_done" then "postreview"
    elif . == "postreview_done" then "ship"
    elif . == "ship_done"     then "finalize-run"
    else "preflight" end
' "$state_file" 2>/dev/null)

ctx=$(cat <<EOF
Resuming pipeline run $run_id (status=$status).

Per-task stage snapshot:
$summary

Next action:
  pipeline-run-task "$run_id" $next_task --stage $next_stage

Invariant: every stage is idempotent (the wrapper short-circuits via _already_past), so re-invoking a stage that already completed is safe.
EOF
)

# Export run id for subsequent Bash calls in this session.
if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
  printf 'export FACTORY_CURRENT_RUN=%q\n' "$run_id" >> "$CLAUDE_ENV_FILE" 2>/dev/null || true
fi

jq -cn --arg ctx "$ctx" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $ctx
  }
}'

exit 0
