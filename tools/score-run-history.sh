#!/usr/bin/env bash
# Print scores.jsonl as a table, sorted by ts descending.
set -euo pipefail

: "${CLAUDE_PLUGIN_DATA:=$HOME/.claude/plugins/data/factory-jfa94}"
history_file="${CLAUDE_PLUGIN_DATA}/scores.jsonl"

[[ -f "$history_file" ]] || { echo "no history at $history_file"; exit 0; }

printf "%-22s  %-8s  %-28s  %-12s  %-14s  %-9s  %-9s\n" \
  "ts" "version" "run_id" "bucket" "status" "anomalies" "full_ok"
jq -r '. | [.ts, .plugin_version, .run_id, .bucket, .status, (.anomalies|tostring), (.full_success|tostring)] | @tsv' "$history_file" \
  | awk -F'\t' '{ printf "%-22s  %-8s  %-28s  %-12s  %-14s  %-9s  %-9s\n", $1, $2, $3, $4, $5, $6, $7 }' \
  | sort -r
