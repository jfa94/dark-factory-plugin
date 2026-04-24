#!/usr/bin/env bash
# PostToolUse asyncRewake hook (matcher: ^Bash$, async: true, asyncRewake: true).
# After `gh pr create` fires for a pipeline task, poll the PR's CI status in
# the background until terminal. Write the outcome to state, emit task.ci,
# and exit 2 with a stderr reminder to wake Claude — the wake payload tells
# the orchestrator to re-invoke pipeline-run-task --stage ship --ci-status.
#
# Compatibility: asyncRewake was introduced in a recent Claude Code release.
# bin/pipeline-scaffold omits this hook entry from merged-settings.json when
# the installed Claude Code version is below the supported minimum; this
# script is a defensive second layer — if CLAUDE_VERSION is absent or too
# low, warn once and exit 0 (no-op).
#
# Stdin: PostToolUse JSON with tool_input.command + tool_response.
# Env:   CLAUDE_PLUGIN_DATA, CLAUDE_VERSION (optional).
set -euo pipefail

min_major=2
min_minor=1
min_patch=116

ver="${CLAUDE_VERSION:-}"
if [[ -n "$ver" ]]; then
  # Parse "x.y.z" (or "claude-code/x.y.z"); tolerate extra suffixes.
  clean=$(printf '%s' "$ver" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
  if [[ -n "$clean" ]]; then
    IFS=. read -r v1 v2 v3 <<< "$clean"
    if (( v1 < min_major )) \
       || (( v1 == min_major && v2 < min_minor )) \
       || (( v1 == min_major && v2 == min_minor && v3 < min_patch )); then
      echo "[asyncrewake-ci] warn: Claude Code $ver below $min_major.$min_minor.$min_patch; asyncRewake may not fire" >&2
      exit 0
    fi
  fi
fi

input=$(cat 2>/dev/null || printf '{}')
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')
# Fire only on successful `gh pr create`.
[[ "$cmd" =~ ^[[:space:]]*gh[[:space:]]+pr[[:space:]]+create ]] || exit 0

current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" || ! -L "$current_link" ]]; then
  exit 0
fi
run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || exit 0
run_id=$(basename "$run_dir")

# Find the most recently created PR for this run. The tool_response usually
# contains the URL (e.g., https://github.com/org/repo/pull/1234).
resp=$(printf '%s' "$input" | jq -r '.tool_response.stdout // .tool_response // ""' 2>/dev/null)
pr_url=$(printf '%s' "$resp" | grep -oE 'https://github\.com/[^[:space:]]+/pull/[0-9]+' | head -1)
pr_number=$(printf '%s' "$pr_url" | grep -oE '[0-9]+$' || printf '')
[[ -z "$pr_number" ]] && exit 0

# Derive task_id: the task whose pr_number just got written.
task_id=$(jq -r --arg n "$pr_number" '
  [.tasks | to_entries[]
   | select((.value.pr_number // "" | tostring) == $n)
   | .key] | first // empty
' "$state_file")
[[ -z "$task_id" ]] && exit 0

# Phase 1: Poll CI checks. max 60m total @ 30s interval = 120 iterations.
max_iter=${ASYNCREWAKE_CI_MAX:-120}
sleep_s=${ASYNCREWAKE_CI_SLEEP:-30}
ci_conclusion="timeout"
for _ in $(seq 1 $max_iter); do
  sleep "$sleep_s"
  rollup=$(gh pr view "$pr_number" --json statusCheckRollup 2>/dev/null || printf '{}')
  decision=$(printf '%s' "$rollup" | jq -r '
    .statusCheckRollup // []
    | map(.conclusion)
    | if length == 0 then "pending"
      elif all(. != null and . != "") and all(. == "SUCCESS" or . == "NEUTRAL" or . == "SKIPPED") then "green"
      elif any(. == "FAILURE" or . == "CANCELLED" or . == "TIMED_OUT") then "red"
      else "pending" end
  ')
  case "$decision" in
    green|red) ci_conclusion="$decision"; break ;;
    pending)   continue ;;
  esac
done

# Phase 2: If CI passed, wait for auto-merge to land. max 5m @ 10s = 30 polls.
state="$ci_conclusion"
if [[ "$ci_conclusion" == "green" ]]; then
  merge_max=${ASYNCREWAKE_MERGE_MAX:-30}
  merge_sleep=${ASYNCREWAKE_MERGE_SLEEP:-10}
  merged=false
  for _ in $(seq 1 $merge_max); do
    sleep "$merge_sleep"
    pr_state=$(gh pr view "$pr_number" --json state,mergedAt 2>/dev/null \
      | jq -r 'if .state == "MERGED" or (.mergedAt != null and .mergedAt != "") then "merged" else "open" end')
    if [[ "$pr_state" == "merged" ]]; then
      merged=true
      break
    fi
  done
  if [[ "$merged" != "true" ]]; then
    state="red"
    printf '[asyncrewake-ci] CI green but auto-merge stalled on PR %s after %ss — treating as red\n' \
      "$pr_number" "$((merge_max * merge_sleep))" >&2
  fi
fi

# Write to state + emit metric.
pipeline-state task-write "$run_id" "$task_id" ci_status "\"$state\"" >/dev/null 2>&1 || true
lib="${CLAUDE_PLUGIN_ROOT:-}/bin/pipeline-lib.sh"
if [[ -n "${CLAUDE_PLUGIN_ROOT:-}" && -f "$lib" ]]; then
  # shellcheck disable=SC1090
  source "$lib" 2>/dev/null || true
  if command -v emit_ci_metric >/dev/null 2>&1; then
    emit_ci_metric task "$pr_number" "$state" 2>/dev/null || true
  fi
fi

# Wake Claude via exit 2 + stderr reminder.
printf 'CI terminal for task %s (pr %s): %s — call pipeline-run-task %s %s --stage ship --ci-status %s to finalize.\n' \
  "$task_id" "$pr_number" "$state" "$run_id" "$task_id" "$state" >&2
exit 2
