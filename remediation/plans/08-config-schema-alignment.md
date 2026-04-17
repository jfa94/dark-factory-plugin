# Plan 08 — Config Schema Alignment

**Priority:** P1 (major — configure command writes keys the rest of the plugin doesn't read)
**Tasks:** `task_08_01` through `task_08_04`
**Findings:** M20, P2-config

## Problem

Three places define the plugin's configuration schema and they disagree:

1. **`plugin.json`** declares the configurable keys under `"configuration"`.
2. **`commands/configure.md`** writes keys to `~/.claude/plugins/factory/config.json` using one set of names.
3. **The `bin/pipeline-*` scripts** read the config via `pipeline-config get <key>` using a third set of names.

Examples of drift found during review:

- `plugin.json` says `parallel.maxConcurrent`; `configure.md` writes `parallelism.max`; scripts read `parallel.max_concurrent`.
- `plugin.json` declares `quota.threshold`; scripts read `quota.pauseThreshold`.
- `configure.md` uses `jq ... | sponge` which fails on systems without moreutils; should use `jq ... > tmp && mv tmp file`.
- `configure.md` passes some values to `jq` as strings (`--arg`) and then calls `| tonumber` inside the filter; inconsistent with other keys that use `--argjson`.

Secondary issue: several `pipeline-config get` call sites use different default values for the same key, meaning behavior depends on which script ran first.

## Scope

In:

- Pick one canonical key naming scheme
- Align `plugin.json`, `commands/configure.md`, and every `bin/pipeline-*` script to the canonical names
- Replace `sponge` with atomic file replacement
- Standardize on `--argjson` for numeric values in jq writes

Out: changing the default values themselves (defaults live in code).

## Tasks

| task_id    | Title                                                          |
| ---------- | -------------------------------------------------------------- |
| task_08_01 | Canonicalize config keys in plugin.json                        |
| task_08_02 | Rewrite configure.md setpath writes + remove sponge dependency |
| task_08_03 | Update all `pipeline-config get` call sites to canonical names |
| task_08_04 | Replace `--arg N + tonumber` with `--argjson N` everywhere     |

## Canonical schema (decision)

Use snake_case segments separated by dots. The root namespaces are `quota`, `parallel`, `circuit_breaker`, `ollama`, `review`, `rate_limit`. Full schema:

```json
{
  "quota": {
    "pause_threshold": 0.9,
    "provider": "anthropic",
    "window": "7d"
  },
  "parallel": {
    "max_concurrent": 4,
    "strategy": "batched"
  },
  "circuit_breaker": {
    "max_runtime_minutes": 240,
    "max_consecutive_failures": 3,
    "max_cost_usd": 25.0
  },
  "ollama": {
    "enabled": false,
    "base_url": "http://localhost:11434",
    "model": "qwen2.5-coder:32b"
  },
  "review": {
    "spec_threshold": 54,
    "task_threshold": 21,
    "max_review_rounds": 3
  },
  "rate_limit": {
    "backoff_seconds": 60,
    "max_wait_seconds": 86400
  }
}
```

All three layers use exactly these keys. No variants, no aliases.

## Execution Guidance

### task_08_01 — plugin.json

File: `plugin.json`

Open the `configuration` object. Rewrite entries to match the canonical schema. Each entry must have:

- `name` matching a canonical dot path
- `type` (number, string, boolean)
- `default` matching the value in the schema above
- `description` — concise (one line)

Example:

```json
"configuration": {
  "quota.pause_threshold": {
    "type": "number",
    "default": 0.9,
    "description": "Pause the run when used quota exceeds this fraction"
  },
  "parallel.max_concurrent": {
    "type": "number",
    "default": 4,
    "description": "Max parallel task-executor agents per group"
  },
  "circuit_breaker.max_runtime_minutes": {
    "type": "number",
    "default": 240,
    "description": "Hard cap on active runtime (pauses not counted)"
  },
  ...
}
```

Remove any legacy keys like `parallelism.max`, `quota.threshold`, `runtime_cap`.

### task_08_02 — configure.md setpath + no sponge

File: `commands/configure.md`

Current pattern (buggy — requires moreutils):

```bash
jq ".quota.threshold = $value" "$config" | sponge "$config"
```

Replace with atomic rewrite and `setpath`:

```bash
update_config() {
  local key="$1"  # e.g. "quota.pause_threshold"
  local value="$2"
  local type="$3"  # "number" | "string" | "bool"
  local config="$CONFIG_FILE"
  local tmp="${config}.$$.tmp"

  # Split dotted key into a jq path array
  local path_json
  path_json=$(jq -Rc 'split(".")' <<< "$key")

  case "$type" in
    number)
      jq --argjson p "$path_json" --argjson v "$value" \
        'setpath($p; $v)' "$config" > "$tmp" ;;
    bool)
      jq --argjson p "$path_json" --argjson v "$value" \
        'setpath($p; $v)' "$config" > "$tmp" ;;
    string)
      jq --argjson p "$path_json" --arg v "$value" \
        'setpath($p; $v)' "$config" > "$tmp" ;;
    *)
      echo "unknown type: $type" >&2
      rm -f "$tmp"
      return 1 ;;
  esac

  mv "$tmp" "$config"
}
```

Then every config write in the command body becomes:

```bash
update_config "quota.pause_threshold" "0.9" number
update_config "ollama.enabled" "true" bool
update_config "ollama.model" "qwen2.5-coder:32b" string
```

Key properties:

- `setpath($p; $v)` creates missing intermediate objects automatically
- `--argjson` for number/bool values (no string-to-number conversion in jq)
- `--arg` for strings only
- Atomic rewrite via tmp + `mv` — never leaves a partial file even on interrupt

Also update the `## Prerequisites` section — remove any mention of `sponge` / `moreutils`.

### task_08_03 — Align pipeline-config get call sites

Files: all `bin/pipeline-*` scripts that call `pipeline-config get`

Grep for `pipeline-config get` in `bin/`. For every call, rewrite the key argument to the canonical name:

```bash
# Before
max_concurrent=$(pipeline-config get parallelism.max 4)
threshold=$(pipeline-config get quota.threshold 0.9)

# After
max_concurrent=$(pipeline-config get parallel.max_concurrent 4)
threshold=$(pipeline-config get quota.pause_threshold 0.9)
```

Every call should pass both the canonical key AND the same default value found in the canonical schema. Defaults should match across scripts.

Strategy: create a helper in `bin/pipeline-config`:

```bash
# pipeline-config defaults
cat > "$DEFAULTS_FILE" <<'JSON'
{
  "quota.pause_threshold": 0.9,
  "parallel.max_concurrent": 4,
  "circuit_breaker.max_runtime_minutes": 240,
  ...
}
JSON

get() {
  local key="$1"
  local user_value
  user_value=$(jq -r --arg k "$key" 'getpath($k|split("."))' "$CONFIG_FILE" 2>/dev/null)
  if [[ "$user_value" != "null" && -n "$user_value" ]]; then
    echo "$user_value"
    return 0
  fi
  # Fall back to canonical default
  jq -r --arg k "$key" '.[$k]' "$DEFAULTS_FILE"
}
```

Then scripts can drop their inline defaults:

```bash
max_concurrent=$(pipeline-config get parallel.max_concurrent)
```

This guarantees consistent defaults across scripts.

### task_08_04 — Replace `--arg + tonumber` with `--argjson`

All files under `bin/`

Grep for `tonumber` in the `bin/` directory. Every occurrence where the pattern is:

```bash
jq --arg N "$num" '... ($N | tonumber) ...' ...
```

Replace with:

```bash
jq --argjson N "$num" '... $N ...'
```

`--argjson` parses the value as JSON, which correctly handles ints, floats, and booleans. `--arg` + `tonumber` fails on any non-numeric input with a confusing jq error and is slower.

Caveat: if the input might be empty or non-numeric, validate before passing to `--argjson`:

```bash
if [[ "$num" =~ ^-?[0-9]+(\.[0-9]+)?$ ]]; then
  jq --argjson N "$num" ...
else
  echo '{"error":"invalid_number","got":"'"$num"'"}' >&2
  exit 1
fi
```

## Verification

1. Grep `plugin.json` for `parallelism`, `quota.threshold`, `runtime_cap` — zero matches (legacy names gone)
2. Grep `commands/configure.md` for `sponge` — zero matches
3. Grep `commands/configure.md` for `setpath` — present (at least one match)
4. Grep `bin/` for `tonumber` — should be zero or minimal (only cases that can't be rewritten)
5. Grep `bin/` for all legacy names from step 1 — zero matches
6. `bin/test-phase9.sh` — config tests pass (assertions on canonical keys and setpath usage)
7. `jq '.configuration | keys' plugin.json` — output is exactly the canonical key set
8. Manual round-trip: run `/factory:configure`, set `parallel.max_concurrent=8`, read it back via `pipeline-config get parallel.max_concurrent` → returns `8`
