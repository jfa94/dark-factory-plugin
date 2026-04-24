#!/usr/bin/env bash
# SubagentStop hook: parse the subagent's STATUS line and transcript and
# write channelled artifacts (worktree, review files, four-status) into
# pipeline state. Complements hooks/subagent-stop-gate.sh (which emits
# warnings); this one owns the orchestrator-facing hand-off.
#
# Matcher (in templates/settings.autonomous.json):
#   "^(task-executor|implementation-reviewer|code-reviewer|security-reviewer|architecture-reviewer|scribe|spec-generator|spec-reviewer)$"
#
# Stdin: JSON with agent_type, last_assistant_message, agent_transcript_path,
# session_id, and (optionally) agent task_id in tool/context.
#
# Writes:
#   .tasks.$t.executor_status   (task-executor)
#   .tasks.$t.reviewer_status   (reviewer roles)
#   .tasks.$t.worktree          (first executor worktree seen)
#   .tasks.$t.review_files      (array of per-reviewer output file paths)
#   .scribe.status              (scribe)
# Emits metric: pipeline.subagent.end agent_type=... status=...
#
# Exit: always 0; non-fatal on parse errors.
set -euo pipefail

current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" || ! -L "$current_link" ]]; then
  exit 0
fi
run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || exit 0
run_id=$(basename "$run_dir")

input=$(cat 2>/dev/null || printf '{}')
agent_type=$(printf '%s' "$input" | jq -r '.agent_type // .subagent_type // empty')
last_msg=$(printf '%s' "$input" | jq -r '.last_assistant_message // empty')
transcript=$(printf '%s' "$input" | jq -r '.agent_transcript_path // .transcript_path // empty')
[[ -z "$agent_type" ]] && exit 0

# --- 1. Parse STATUS line ---
# grep returns 1 on no-match; `set -euo pipefail` would abort the script, so
# swallow failures explicitly.
status=""
if [[ -n "$last_msg" ]]; then
  status=$(printf '%s' "$last_msg" \
    | { grep -oE 'STATUS:[[:space:]]+(DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT)' || true; } \
    | tail -1 | awk '{print $2}')
fi
[[ -z "$status" ]] && status="BLOCKED"  # missing STATUS line => treat as blocked

# --- 2. Derive task_id ---
# Priority: explicit FACTORY_TASK_ID, then prompt file in transcript, then
# worktree path pattern in transcript.
task_id="${FACTORY_TASK_ID:-}"

if [[ -z "$task_id" && -f "$transcript" ]]; then
  # Look for `<run-id>/<task-id>.<role>-prompt.md` reference in transcript.
  task_id=$({ grep -oE "\.state/${run_id}/[a-zA-Z0-9_-]+\.(executor|executor-fix|executor-ci-fix|reviewer|holdout)-prompt\.md" "$transcript" 2>/dev/null || true; } \
    | head -1 \
    | sed -E "s|.*\.state/${run_id}/([a-zA-Z0-9_-]+)\..*|\1|")
fi

if [[ -z "$task_id" && "$agent_type" == "scribe" ]]; then
  task_id="RUN"
fi

# --- 3. Extract worktree from transcript ---
# For task-executor: scan transcript for `cwd` entries under the plugin's
# ephemeral worktree root (.claude/worktrees/). First match wins.
worktree=""
if [[ "$agent_type" == "task-executor" && -f "$transcript" ]]; then
  worktree=$({ grep -oE '"cwd":[[:space:]]*"[^"]*\.claude/worktrees/[^"]+"' "$transcript" 2>/dev/null || true; } \
    | head -1 \
    | sed -E 's/.*"cwd":[[:space:]]*"([^"]+)".*/\1/')
fi

# --- 4. Write review file (reviewer roles) ---
review_path=""
case "$agent_type" in
  implementation-reviewer|code-reviewer|security-reviewer|architecture-reviewer)
    if [[ -n "$task_id" && "$task_id" != "RUN" ]]; then
      mkdir -p "$run_dir/.state/$run_id"
      review_path="$run_dir/.state/$run_id/$task_id.review.$agent_type.md"
      printf '%s' "$last_msg" > "$review_path"
    fi
    ;;
esac

# --- 5. State writes ---
if [[ -n "$task_id" && "$task_id" != "RUN" ]]; then
  case "$agent_type" in
    task-executor)
      pipeline-state task-write "$run_id" "$task_id" executor_status "\"$status\"" >/dev/null 2>&1 || true
      if [[ -n "$worktree" ]]; then
        pipeline-state task-write "$run_id" "$task_id" worktree "\"$worktree\"" >/dev/null 2>&1 || true
      fi
      ;;
    implementation-reviewer|code-reviewer|security-reviewer|architecture-reviewer)
      pipeline-state task-write "$run_id" "$task_id" reviewer_status "\"$status\"" >/dev/null 2>&1 || true
      if [[ -n "$review_path" ]]; then
        cur=$(jq -c --arg t "$task_id" '.tasks[$t].review_files // []' "$state_file" 2>/dev/null || printf '[]')
        new=$(printf '%s' "$cur" | jq -c --arg p "$review_path" '. + [$p] | unique')
        pipeline-state task-write "$run_id" "$task_id" review_files "$new" >/dev/null 2>&1 || true
      fi
      ;;
  esac
fi

if [[ "$agent_type" == "scribe" ]]; then
  pipeline-state write "$run_id" '.scribe.status' "\"$( [[ "$status" == "DONE" || "$status" == "DONE_WITH_CONCERNS" ]] && echo done || echo failed )\"" >/dev/null 2>&1 || true
fi

# --- 6. Emit metric ---
lib="${CLAUDE_PLUGIN_ROOT:-}/bin/pipeline-lib.sh"
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "$lib" ]]; then
  # shellcheck disable=SC1090
  source "$lib" 2>/dev/null || true
  if command -v log_metric >/dev/null 2>&1; then
    log_metric "pipeline.subagent.end" \
      "agent_type=\"$agent_type\"" \
      "status=\"$status\"" \
      "task_id=\"${task_id:-}\"" 2>/dev/null || true
  fi
fi

exit 0
