#!/usr/bin/env bash
# PreToolUse guard for dark-factory pipeline invariants. Matcher: ^Bash$.
# Reads the tool_input command and the current run state; denies commands
# that violate pipeline invariants.
#
# Only fires when a pipeline run is active (${CLAUDE_PLUGIN_DATA}/runs/current
# present) — keeps normal user sessions unaffected even if this hook is ever
# registered outside the autonomous-mode template.
#
# Denials use the permissionDecision form (per Claude Code hooks docs):
#   {"hookSpecificOutput":{"hookEventName":"PreToolUse",
#     "permissionDecision":"deny","permissionDecisionReason":"..."}}
#
# Invariants enforced:
#   1. `gh pr create` for task $t requires .tasks.$t.quality_gate.ok == true.
#   2. `gh pr merge` for task $t requires .tasks.$t.pr_number and
#      .tasks.$t.ci_status == "green".
#   3. `pipeline-state task-status <run> <task> done` requires .worktree,
#      .quality_gate.ok, and .pr_number all set.
set -euo pipefail

input=$(cat 2>/dev/null || printf '{}')
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
[[ -z "$cmd" ]] && exit 0

current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" || ! -L "$current_link" ]]; then
  exit 0
fi
run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || exit 0

run_id=$(basename "$run_dir")

deny() {
  jq -cn --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

task_field() {
  jq -r --arg t "$1" --arg f "$2" '.tasks[$t][$f] // empty' "$state_file" 2>/dev/null
}

# Best-effort: derive task id from the FACTORY_TASK_ID env the orchestrator
# typically sets, or from heuristics on the command.
task_id="${FACTORY_TASK_ID:-}"
if [[ -z "$task_id" ]]; then
  # Heuristic: look for --head task/<id> in gh pr create, or positional task id
  if [[ "$cmd" =~ --head[[:space:]]+task/([a-zA-Z0-9_-]+) ]]; then
    task_id="${BASH_REMATCH[1]}"
  fi
fi

# --- 1. gh pr create ---
if [[ "$cmd" =~ ^[[:space:]]*gh[[:space:]]+pr[[:space:]]+create ]]; then
  [[ -z "$task_id" ]] && exit 0  # can't attribute — let it through
  qok=$(jq -r --arg t "$task_id" '.tasks[$t].quality_gate.ok // false' "$state_file")
  if [[ "$qok" != "true" ]]; then
    deny "pipeline invariant: gh pr create for task $task_id requires .tasks.$task_id.quality_gate.ok == true (current: $qok). Run pipeline-run-task \"$run_id\" $task_id --stage postexec first."
  fi
fi

# --- 2. gh pr merge ---
if [[ "$cmd" =~ ^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge ]]; then
  [[ -z "$task_id" ]] && exit 0
  pr=$(task_field "$task_id" pr_number)
  ci=$(task_field "$task_id" ci_status)
  if [[ -z "$pr" || "$ci" != "green" ]]; then
    deny "pipeline invariant: gh pr merge for task $task_id requires .tasks.$task_id.pr_number (got \"$pr\") and ci_status=\"green\" (got \"$ci\")."
  fi
fi

# --- 3. pipeline-state task-status <run> <task> done ---
# Matches: pipeline-state task-status <run-id> <task-id> done
if [[ "$cmd" =~ pipeline-state[[:space:]]+task-status[[:space:]]+([a-zA-Z0-9_-]+)[[:space:]]+([a-zA-Z0-9_-]+)[[:space:]]+done([[:space:]]|$) ]]; then
  cmd_run="${BASH_REMATCH[1]}"
  cmd_task="${BASH_REMATCH[2]}"
  if [[ "$cmd_run" == "$run_id" ]]; then
    wt=$(task_field "$cmd_task" worktree)
    qok=$(jq -r --arg t "$cmd_task" '.tasks[$t].quality_gate.ok // false' "$state_file")
    pr=$(task_field "$cmd_task" pr_number)
    missing=()
    [[ -z "$wt" ]] && missing+=("worktree")
    [[ "$qok" != "true" ]] && missing+=("quality_gate.ok")
    [[ -z "$pr" ]] && missing+=("pr_number")
    if (( ${#missing[@]} > 0 )); then
      deny "pipeline invariant: setting task $cmd_task status=done requires ${missing[*]} on .tasks.$cmd_task (let pipeline-run-task manage done transitions)."
    fi
  fi
fi

exit 0
