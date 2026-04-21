#!/usr/bin/env bash
# Backfill missing fields on old runs:
#   - .version (via git log on plugin.json or --assume-version)
#   - .final_pr_number / .tasks.*.pr_number (via gh pr list)
#   - Synthetic task.ci / run.ci metric events (via gh pr view)
#
# Usage:
#   tools/score-run-backfill.sh --run <run-id> [--assume-version X.Y.Z] [--repo OWNER/REPO] [--no-gh]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${CLAUDE_PLUGIN_DATA:=$HOME/.claude/plugins/data/factory-jfa94}"

run_id=""
assume_version=""
repo=""
use_gh=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --run) run_id="$2"; shift 2 ;;
    --assume-version) assume_version="$2"; shift 2 ;;
    --repo) repo="$2"; shift 2 ;;
    --no-gh) use_gh=false; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

[[ -z "$run_id" ]] && { echo "missing --run" >&2; exit 1; }

run_dir="${CLAUDE_PLUGIN_DATA}/runs/${run_id}"
state_file="$run_dir/state.json"
[[ -f "$state_file" ]] || { echo "state.json not found: $state_file" >&2; exit 1; }

# 1. Version backfill.
current_version=$(jq -r '.version // empty' "$state_file")
if [[ -z "$current_version" ]]; then
  resolved="$assume_version"
  if [[ -z "$resolved" ]]; then
    started_at=$(jq -r '.started_at' "$state_file")
    resolved=$(git -C "$REPO_ROOT" log --before="$started_at" -1 --format='%H' -- .claude-plugin/plugin.json 2>/dev/null \
      | xargs -I{} git -C "$REPO_ROOT" show {}:.claude-plugin/plugin.json 2>/dev/null \
      | jq -r '.version // empty')
  fi
  [[ -z "$resolved" ]] && { echo "could not resolve version; pass --assume-version" >&2; exit 1; }
  tmp=$(mktemp)
  jq --arg v "$resolved" '.version = $v' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
  echo "Stamped .version = $resolved"
fi

# 2. PR recovery (gh-dependent).
if [[ "$use_gh" != "true" ]]; then
  echo "Backfill complete (version only; --no-gh)."
  exit 0
fi

if [[ -z "$repo" ]]; then
  project_root=$(jq -r '.orchestrator.project_root // empty' "$state_file")
  if [[ -n "$project_root" && -d "$project_root/.git" ]]; then
    repo=$(git -C "$project_root" config --get remote.origin.url 2>/dev/null | sed -E 's#.*[:/]([^/:]+/[^/]+)\.git$#\1#')
  fi
fi

if [[ -z "$repo" ]]; then
  echo "warn: could not detect repo; skipping PR backfill" >&2
  echo "Backfill complete."
  exit 0
fi

mapfile -t tasks < <(jq -r '.tasks // {} | to_entries[] | select(.value.pr_number == null) | .key' "$state_file")
for t in "${tasks[@]}"; do
  [[ -z "$t" ]] && continue
  branch="task/$t"
  pr=$(gh pr list --repo "$repo" --state all --head "$branch" --json number -q '.[0].number' 2>/dev/null || echo "")
  if [[ -n "$pr" ]]; then
    tmp=$(mktemp)
    jq --arg t "$t" --argjson pr "$pr" '.tasks[$t].pr_number = $pr' "$state_file" > "$tmp" && mv "$tmp" "$state_file"
    conclusion=$(gh pr view "$pr" --repo "$repo" --json statusCheckRollup -q '.statusCheckRollup | map(.conclusion) | if length == 0 then "unknown" elif all(. == "SUCCESS") then "green" else "red" end' 2>/dev/null || echo "unknown")
    ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    printf '{"ts":"%s","run_id":"%s","event":"task.ci","pr_number":%s,"status":"%s","backfilled":true}\n' \
      "$ts" "$run_id" "$pr" "$conclusion" >> "$run_dir/metrics.jsonl"
    echo "Backfilled task $t → PR $pr ($conclusion)"
  fi
done

echo "Backfill complete."
