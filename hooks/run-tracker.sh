#!/usr/bin/env bash
# PostToolUse hook: append-only audit logging during active pipeline runs.
# Only logs when an active run exists (${CLAUDE_PLUGIN_DATA}/runs/current).
#
# Stdin: JSON with tool name and input
# Exit: always 0 (never blocks)
set -euo pipefail

# Quick check: is there an active run?
current_link="${CLAUDE_PLUGIN_DATA:-}/runs/current"
if [[ -z "${CLAUDE_PLUGIN_DATA:-}" ]] || [[ ! -L "$current_link" ]]; then
  exit 0
fi

run_dir=$(readlink "$current_link" 2>/dev/null) || exit 0
audit_file="$run_dir/audit.jsonl"

if [[ ! -f "$audit_file" ]]; then
  echo "[run-tracker] WARNING: audit.jsonl missing for active run $(basename "$run_dir")" >&2
  exit 0
fi

# Read hook input
input=$(cat)

tool=$(printf '%s' "$input" | jq -r '.tool_name // "unknown"' 2>/dev/null)
tool_input=$(printf '%s' "$input" | jq -r '.tool_input // {} | tostring' 2>/dev/null)

# Hash the params for tamper-evidence (not storing raw params which could be large)
params_hash=$(printf '%s' "$tool_input" | shasum -a 256 2>/dev/null | cut -d' ' -f1)
if [[ -z "$params_hash" ]]; then
  params_hash="unavailable"
fi

# Get run_id from state
run_id=$(basename "$run_dir")

# Monotonic sequence number (line count + 1)
seq_num=$(wc -l < "$audit_file" 2>/dev/null | tr -d ' ')
seq_num=$((seq_num + 1))

timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Append audit entry as single JSONL line
jq -cn \
  --arg ts "$timestamp" \
  --arg tool "$tool" \
  --arg hash "$params_hash" \
  --arg run_id "$run_id" \
  --argjson seq "$seq_num" \
  '{timestamp: $ts, tool: $tool, params_hash: $hash, run_id: $run_id, seq: $seq}' \
  >> "$audit_file"

exit 0
