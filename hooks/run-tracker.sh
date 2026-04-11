#!/usr/bin/env bash
# PostToolUse hook: append-only audit logging during active pipeline runs.
# Only logs when an active run exists (${CLAUDE_PLUGIN_DATA}/runs/current).
#
# Stdin: JSON with tool name and input
# Exit: always 0 (never blocks)
#
# task_09_01: parallel PostToolUse hooks raced on the seq counter (`wc -l + 1`),
#   producing duplicate sequence numbers. We now serialize the entire
#   derive-seq → chain → append section behind a portable mkdir mutex on the
#   run dir, so concurrent invocations cannot interleave.
#
# task_09_02: the previous `params_hash` field was an independent SHA of the
#   tool input — calling it a "tamper-evident chain" was misleading. Each entry
#   now stores `prev_hash` (the previous entry's chain `hash`, or "GENESIS" for
#   the first) and `hash = sha256(prev_hash || params_hash)`. Re-ordering or
#   deletion is detectable via `verify_chain` because every prev_hash must
#   equal the previous entry's hash. Mutating a single entry's params is NOT
#   detectable here (we'd need to hash the canonical payload back, but raw
#   payloads aren't stored to keep the audit file small).
#
# Modes:
#   (default) — read hook input from stdin, append a chain entry
#   --verify <run_dir>  — walk audit.jsonl, return JSON status, exit 0 (valid)
#                         / 1 (broken) — used by tests and operators
set -euo pipefail

verify_chain() {
  local audit_file="$1"
  if [[ ! -f "$audit_file" ]]; then
    printf '{"status":"missing","file":"%s"}\n' "$audit_file"
    return 1
  fi

  local prev="GENESIS"
  local line_num=0
  local entry_prev entry_hash
  while IFS= read -r line; do
    line_num=$((line_num + 1))
    [[ -z "$line" ]] && continue
    entry_prev=$(printf '%s' "$line" | jq -r '.prev_hash // ""' 2>/dev/null)
    entry_hash=$(printf '%s' "$line" | jq -r '.hash // ""' 2>/dev/null)
    if [[ -z "$entry_prev" || -z "$entry_hash" ]]; then
      printf '{"status":"broken","reason":"missing_chain_field","line":%d}\n' "$line_num"
      return 1
    fi
    if [[ "$entry_prev" != "$prev" ]]; then
      printf '{"status":"broken","reason":"prev_hash_mismatch","line":%d,"expected":"%s","actual":"%s"}\n' \
        "$line_num" "$prev" "$entry_prev"
      return 1
    fi
    prev="$entry_hash"
  done < "$audit_file"

  printf '{"status":"valid","entries":%d}\n' "$line_num"
  return 0
}

# Verification entry point — used by tests and on-demand integrity checks.
if [[ "${1:-}" == "--verify" ]]; then
  shift
  target="${1:-}"
  if [[ -z "$target" ]]; then
    echo '{"error":"--verify requires a path to audit.jsonl or run dir"}' >&2
    exit 2
  fi
  if [[ -d "$target" ]]; then
    target="$target/audit.jsonl"
  fi
  verify_chain "$target"
  exit $?
fi

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

run_id=$(basename "$run_dir")
timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# task_09_01: Portable mutex around seq derivation + chain link + append.
# mkdir is atomic on POSIX filesystems (the directory either exists or not),
# which avoids the macOS-flock-not-installed problem. We never block tool
# execution — if the lock can't be acquired in ~10s we log and exit 0.
lock_dir="$run_dir/.run-tracker.lock"
attempts=0
while ! mkdir "$lock_dir" 2>/dev/null; do
  attempts=$((attempts + 1))
  if (( attempts >= 200 )); then
    echo "[run-tracker] ERROR: failed to acquire mutex after 200 attempts ($lock_dir)" >&2
    exit 0
  fi
  sleep 0.05
done
trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT

# Monotonic sequence number derived under the mutex (line count + 1)
seq_num=$(wc -l < "$audit_file" 2>/dev/null | tr -d ' ')
seq_num=$((seq_num + 1))

# task_09_02: read the previous chain hash from the last audit entry.
# Reading under the mutex guarantees we see the latest committed entry.
prev_hash=$(tail -n 1 "$audit_file" 2>/dev/null | jq -r '.hash // empty' 2>/dev/null)
if [[ -z "$prev_hash" ]]; then
  prev_hash="GENESIS"
fi

# Chain link: hash(prev_hash || params_hash). Using `||` as a separator avoids
# accidental ambiguity between (prev="ab", params="cd") and (prev="a", params="bcd").
chain_hash=$(printf '%s||%s' "$prev_hash" "$params_hash" | shasum -a 256 2>/dev/null | cut -d' ' -f1)
if [[ -z "$chain_hash" ]]; then
  chain_hash="unavailable"
fi

# Append the audit entry as a single JSONL line
jq -cn \
  --arg ts "$timestamp" \
  --arg tool "$tool" \
  --arg params_hash "$params_hash" \
  --arg prev_hash "$prev_hash" \
  --arg hash "$chain_hash" \
  --arg run_id "$run_id" \
  --argjson seq "$seq_num" \
  '{timestamp: $ts, tool: $tool, params_hash: $params_hash, prev_hash: $prev_hash, hash: $hash, run_id: $run_id, seq: $seq}' \
  >> "$audit_file"

rmdir "$lock_dir" 2>/dev/null || true
trap - EXIT
exit 0
