#!/usr/bin/env bash
# Shared library sourced by all pipeline-* scripts. Not executable directly.
# Usage: source "$(dirname "$0")/pipeline-lib.sh"

set -euo pipefail

# --- Logging ---

_SCRIPT_NAME="${0##*/}"

log_info() { printf '[%s] [INFO] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_SCRIPT_NAME" "$*" >&2; }
log_warn() { printf '[%s] [WARN] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_SCRIPT_NAME" "$*" >&2; }
log_error() { printf '[%s] [ERROR] %s: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$_SCRIPT_NAME" "$*" >&2; }

# --- Config ---

# Read a value from the plugin config file.
# Usage: read_config <jq-key> [default]
read_config() {
  local key="$1" default="${2:-}"
  local config_file="${CLAUDE_PLUGIN_DATA}/config.json"
  if [[ ! -f "$config_file" ]]; then
    printf '%s' "$default"
    return
  fi
  local val
  val=$(jq -r "$key // empty" "$config_file" 2>/dev/null) || true
  printf '%s' "${val:-$default}"
}

# --- State shortcuts ---

# Read state (delegates to pipeline-state)
# Usage: read_state <run_id> [key]
read_state() { pipeline-state read "$@"; }

# Write state (delegates to pipeline-state)
# Usage: write_state <run_id> <key> <value>
write_state() { pipeline-state write "$@"; }

# --- Utilities ---

# Convert string to branch-safe slug: lowercase, hyphens, max 50 chars
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g' \
    | sed 's/--*/-/g' \
    | sed 's/^-//;s/-$//' \
    | head -c 50
}

# Create a temp file in plugin data dir
# Usage: temp_file [suffix]
temp_file() {
  local suffix="${1:-.tmp}"
  local tmp_dir="${CLAUDE_PLUGIN_DATA}/tmp"
  mkdir -p "$tmp_dir"
  mktemp "${tmp_dir}/pipeline-XXXXXX${suffix}"
}

# Assert a command exists, exit 1 if not
require_command() {
  local cmd="$1"
  if ! command -v "$cmd" &>/dev/null; then
    log_error "required command not found: $cmd"
    exit 1
  fi
}

# Build a JSON object from key-value pairs and write to stdout
# Usage: json_output key1 value1 key2 value2 ...
json_output() {
  local args=()
  while [[ $# -ge 2 ]]; do
    args+=("--arg" "$1" "$2")
    shift 2
  done
  jq -n "${args[@]}" '
    reduce ($ARGS.named | to_entries[]) as $e ({}; . + {($e.key): ($e.value)})
  '
}

# Detect package manager from lockfile in current directory (or given path)
# Usage: detect_pkg_manager [project-root]
detect_pkg_manager() {
  local root="${1:-.}"
  if [[ -f "$root/pnpm-lock.yaml" ]]; then
    printf 'pnpm'
  elif [[ -f "$root/bun.lockb" ]] || [[ -f "$root/bun.lock" ]]; then
    printf 'bun'
  elif [[ -f "$root/yarn.lock" ]]; then
    printf 'yarn'
  elif [[ -f "$root/package-lock.json" ]]; then
    printf 'npm'
  else
    printf 'pnpm'
  fi
}

# Atomic write: write to temp file, fsync, then mv (prevents partial reads)
# Usage: atomic_write <target-path> <content>
atomic_write() {
  local target="$1" content="$2"
  local tmp
  tmp=$(mktemp "${target}.XXXXXX")
  printf '%s' "$content" > "$tmp"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "
import os, sys
f = open(sys.argv[1], 'rb')
os.fsync(f.fileno())
f.close()
" "$tmp" 2>/dev/null || true
  fi
  mv -f "$tmp" "$target"
}

# Get the current run directory (via 'current' symlink)
current_run_dir() {
  local current="${CLAUDE_PLUGIN_DATA}/runs/current"
  if [[ -L "$current" ]]; then
    readlink "$current"
  else
    return 1
  fi
}

# Get the current run ID from the symlink target
current_run_id() {
  local dir
  dir=$(current_run_dir) || return 1
  basename "$dir"
}

# --- Observability ---

# Append a structured JSONL metric line to the current run's metrics.jsonl.
# No-op when observability.auditLog is false or the current run dir is missing.
# Usage: log_metric <event> [key1=val1 key2=val2 ...]
# Values that parse as JSON (numbers, booleans, arrays) pass through verbatim;
# anything else is embedded as a JSON string.
log_metric() {
  local event="$1"; shift || true
  [[ -z "$event" ]] && return 0

  # Read the boolean directly. jq's `//` coalescing would swallow a configured
  # `false` (false // true → true), so handle null separately via `if`.
  local audit_enabled="true"
  local config_file="${CLAUDE_PLUGIN_DATA}/config.json"
  if [[ -f "$config_file" ]]; then
    audit_enabled=$(jq -r '.observability.auditLog | if . == null then "true" else tostring end' "$config_file" 2>/dev/null || printf 'true')
  fi
  [[ "$audit_enabled" != "true" ]] && return 0

  local run_dir
  run_dir=$(current_run_dir 2>/dev/null) || return 0
  local metrics_file="$run_dir/metrics.jsonl"
  [[ -f "$metrics_file" ]] || return 0

  local run_id
  run_id=$(basename "$run_dir")

  local jq_args=(-n --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
                    --arg run_id "$run_id" \
                    --arg event "$event")
  local filter='{ts:$ts, run_id:$run_id, event:$event}'
  local pair key val parsed
  for pair in "$@"; do
    key="${pair%%=*}"
    val="${pair#*=}"
    [[ -z "$key" || "$key" == "$pair" ]] && continue
    if parsed=$(printf '%s' "$val" | jq -e . 2>/dev/null); then
      jq_args+=(--argjson "$key" "$parsed")
    else
      jq_args+=(--arg "$key" "$val")
    fi
    filter+=" + {$key: \$$key}"
  done

  jq -c "${jq_args[@]}" "$filter" >> "$metrics_file" 2>/dev/null || true
}

# --- Safety guards ---

# Refuse a path if it is empty, a known system root, outside CLAUDE_PLUGIN_DATA,
# or resolves via realpath to a location outside CLAUDE_PLUGIN_DATA (symlink
# escape). Used before every destructive `rm -rf` in pipeline scripts.
# Usage: assert_in_plugin_data "$path" || exit 1
assert_in_plugin_data() {
  local path="$1"
  if [[ -z "$path" ]]; then
    log_error "refuse: empty path"
    return 1
  fi
  case "$path" in
    /|/bin|/etc|/home|/root|/tmp|/usr|/var|"$HOME") log_error "refuse: system path: $path"; return 1 ;;
  esac
  local base
  base=$(_realpath_m "${CLAUDE_PLUGIN_DATA:-}") || {
    log_error "refuse: cannot resolve CLAUDE_PLUGIN_DATA"
    return 1
  }
  local resolved
  resolved=$(_realpath_m "$path") || {
    log_error "refuse: cannot resolve path: $path"
    return 1
  }
  if [[ "$resolved" != "$base" && "$resolved" != "$base"/* ]]; then
    log_error "refuse: $resolved is outside $base"
    return 1
  fi
  return 0
}

# Portable `realpath -m` shim. GNU coreutils supports `-m` (resolve even when
# components don't exist); macOS realpath does not. Fall back to Python.
_realpath_m() {
  local p="$1"
  [[ -z "$p" ]] && return 1
  if realpath -m "$p" 2>/dev/null; then return 0; fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$p" 2>/dev/null && return 0
  fi
  return 1
}

# --- Quota gate ---

# Run a quota gate at a named pipeline boundary.
#
# Constraint: Claude Code bash tool hard-caps at 10 min per invocation, so this
# function does AT MOST one sleep chunk per call (default 540s / 9min). On wait
# it sleeps once, re-checks, and either proceeds or yields (exit 3) back to the
# orchestrator, which re-invokes the gate — preserving full autonomy across
# arbitrarily long waits (e.g. a 5h window reset) without exceeding the tool cap.
#
# Stuck-cache protection: state key `.circuit_breaker.quota_wait_cycles` tracks
# consecutive yields. After MAX_CYCLES (default 60, ≈9h) the gate returns
# end_gracefully to avoid infinite loops when the statusline stops ticking.
# The counter resets on `proceed`.
#
# Usage: pipeline_quota_gate <run_id> <tier> <boundary_label>
# Returns: 0=proceed, 2=end_gracefully (halt), 3=wait_retry (orchestrator re-invoke)
pipeline_quota_gate() {
  local run_id="$1" tier="$2" boundary_label="$3"
  local quota route action wait_min prior trigger
  local sleep_cap_sec="${FACTORY_QUOTA_GATE_SLEEP_CAP_SEC:-540}"
  local max_cycles="${FACTORY_QUOTA_GATE_MAX_CYCLES:-60}"

  if [[ -z "$run_id" ]]; then
    log_error "quota gate [$boundary_label]: run_id required"
    return 2
  fi

  # Stuck-cache guard: count consecutive wait yields across orchestrator re-invocations.
  local cycles
  cycles=$(pipeline-state read "$run_id" '.circuit_breaker.quota_wait_cycles // 0' 2>/dev/null || printf '0')
  if (( cycles >= max_cycles )); then
    log_warn "quota gate [$boundary_label]: ${cycles} consecutive wait cycles (cap=${max_cycles}) — ending gracefully"
    return 2
  fi

  quota=$(pipeline-quota-check)
  route=$(pipeline-model-router --quota "$quota" --tier "$tier")
  action=$(printf '%s' "$route" | jq -r '.action')

  case "$action" in
    proceed)
      # Reset the stuck-cache counter on any successful proceed.
      pipeline-state write "$run_id" '.circuit_breaker.quota_wait_cycles' '0' 2>/dev/null \
        || log_warn "quota gate [$boundary_label]: failed to reset quota_wait_cycles"
      return 0
      ;;
    end_gracefully)
      trigger=$(printf '%s' "$route" | jq -r '.trigger // "unknown"')
      log_warn "quota gate [$boundary_label]: end_gracefully (trigger=$trigger)"
      return 2
      ;;
    wait)
      wait_min=$(printf '%s' "$route" | jq -r '.wait_minutes // empty')
      if [[ -z "$wait_min" ]]; then
        log_warn "quota gate [$boundary_label]: router returned wait with no wait_minutes — ending gracefully"
        return 2
      fi
      local want_sleep_sec=$(( wait_min * 60 ))
      local do_sleep_sec=$(( want_sleep_sec < sleep_cap_sec ? want_sleep_sec : sleep_cap_sec ))
      local slept_min=$(( (do_sleep_sec + 59) / 60 ))
      log_info "quota gate [$boundary_label]: over threshold — sleeping ${slept_min}m of ${wait_min}m (cycle $((cycles + 1))/${max_cycles})"
      sleep "$do_sleep_sec"

      # Record pause time so circuit breaker excludes it from runtime.
      prior=$(pipeline-state read "$run_id" '.circuit_breaker.pause_minutes // 0' 2>/dev/null || printf '0')
      if ! pipeline-state write "$run_id" '.circuit_breaker.pause_minutes' "$(( prior + slept_min ))" 2>/dev/null; then
        log_warn "quota gate [$boundary_label]: failed to write pause_minutes for run_id=$run_id"
      fi

      # Re-check after the chunk. If clear, proceed; else yield to orchestrator.
      quota=$(pipeline-quota-check)
      route=$(pipeline-model-router --quota "$quota" --tier "$tier")
      action=$(printf '%s' "$route" | jq -r '.action')
      if [[ "$action" == "proceed" ]]; then
        pipeline-state write "$run_id" '.circuit_breaker.quota_wait_cycles' '0' 2>/dev/null \
          || log_warn "quota gate [$boundary_label]: failed to reset quota_wait_cycles"
        return 0
      fi
      if [[ "$action" == "end_gracefully" ]]; then
        trigger=$(printf '%s' "$route" | jq -r '.trigger // "unknown"')
        log_warn "quota gate [$boundary_label]: end_gracefully after wait (trigger=$trigger)"
        return 2
      fi
      # Still waiting — increment cycle counter and yield.
      if ! pipeline-state write "$run_id" '.circuit_breaker.quota_wait_cycles' "$(( cycles + 1 ))" 2>/dev/null; then
        log_warn "quota gate [$boundary_label]: failed to increment quota_wait_cycles"
      fi
      log_info "quota gate [$boundary_label]: yielding to orchestrator for re-invocation"
      return 3
      ;;
    *)
      log_warn "quota gate [$boundary_label]: unexpected action=$action — ending gracefully"
      return 2
      ;;
  esac
}

# --- Rate-limit window math ---

# Parse an ISO 8601 UTC timestamp to epoch seconds. Portable across GNU
# (`date -d`), macOS Homebrew (`gdate -d`), and BSD (`date -j -f`).
# Usage: parse_iso8601_to_epoch <iso_string>
# Returns: epoch seconds on stdout, exit 1 on parse failure.
parse_iso8601_to_epoch() {
  local iso="$1"
  local out
  if command -v gdate &>/dev/null; then
    if out=$(gdate -d "$iso" +%s 2>/dev/null); then
      printf '%s' "$out"; return 0
    fi
  fi
  if out=$(date -d "$iso" +%s 2>/dev/null); then
    printf '%s' "$out"; return 0
  fi
  if out=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null); then
    printf '%s' "$out"; return 0
  fi
  return 1
}

# Compute the position (1-5) within Anthropic's 5-hour rate-limit window.
# Windows are session-anchored, not wall-clock-anchored — callers must pass
# `resets_at` from the API response (e.g. anthropic-ratelimit-unified-5h-reset).
# Formula: floor((now - (resets_at - 5h)) / 3600) + 1, clamped to [1,5].
# Usage: compute_window_hour <resets_at_epoch> <now_epoch>
compute_window_hour() {
  local resets_at="$1" now="$2"
  local window_start=$((resets_at - 18000))
  local elapsed=$((now - window_start))
  local hour=$((elapsed / 3600 + 1))
  if (( hour < 1 )); then hour=1; fi
  if (( hour > 5 )); then hour=5; fi
  printf '%s' "$hour"
}

# Compute the day (1-7) within Anthropic's 7-day rolling window.
# Usage: compute_window_day <resets_at_epoch> <now_epoch>
compute_window_day() {
  local resets_at="$1" now="$2"
  local window_start=$((resets_at - 604800))
  local elapsed=$((now - window_start))
  local day=$((elapsed / 86400 + 1))
  if (( day < 1 )); then day=1; fi
  if (( day > 7 )); then day=7; fi
  printf '%s' "$day"
}

# Hourly utilization threshold for a given window_hour. Linear 20/40/60/80
# with a hard cap at 90% in the final hour (the extra headroom protects
# against burst pricing).
# Usage: compute_hourly_threshold <window_hour>
compute_hourly_threshold() {
  local hour="$1"
  local t=$((hour * 20))
  if (( t > 90 )); then t=90; fi
  printf '%s' "$t"
}

# Daily utilization threshold for a given window_day. Non-linear curve
# [14, 29, 43, 57, 71, 86, 95] — day 7 is 95% (not 100%) so we never burn
# the very last reserve.
# Usage: compute_daily_threshold <window_day>
compute_daily_threshold() {
  local day="$1"
  local thresholds=(14 29 43 57 71 86 95)
  local idx=$((day - 1))
  if (( idx < 0 )); then idx=0; fi
  if (( idx > 6 )); then idx=6; fi
  printf '%s' "${thresholds[$idx]}"
}
