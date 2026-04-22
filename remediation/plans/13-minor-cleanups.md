# Plan 13 — Minor Cleanups

**Priority:** P2 (polish — individually minor, collectively they remove latent footguns)
**Tasks:** `task_13_01` through `task_13_07`
**Findings:** P*-1 through P*-7

## Problem

Seven independent minor issues that don't belong in any larger plan:

1. **`pipeline-classify-risk` emits a verdict without reasoning.** Returns `{"risk":"security"}` with no trace. Hard to audit or debug.
2. **Metrics schema not documented.** `servers/pipeline-metrics/index.js` defines 4 tool shapes but no schema doc, no validation.
3. **`gh issue list` calls don't paginate.** Default limit is 30; projects with 31+ issues silently miss entries.
4. **State writes don't fsync.** `pipeline-state write` calls `mv tmp dest` but doesn't fsync the parent directory, so a crash can leave the new content invisible or the state file empty on disk.
5. **Coverage gate uses strict equality.** `pipeline-coverage-gate` checks `coverage == threshold` not `coverage >= threshold`, failing on an exact-match boundary.
6. **Holdout test seed hardcoded.** `pipeline-holdout-test` uses `RANDOM_SEED=42` so the same tests are held out every run. Should seed from the run_id.
7. **Deny list uses leading-path patterns that don't match absolute paths.** Entries like `Write(migrations/**)` don't fire on `Write(/absolute/path/to/migrations/foo.sql)`.

## Scope

In: fix each of the seven items, add a test for each where feasible. Out: MCP server rewrites.

## Tasks

| task_id    | Title                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| task_13_01 | Emit reasoning trace from `pipeline-classify-risk`                                                                                                         |
| task_13_02 | ~~Document metrics schema in `servers/pipeline-metrics/README.md`~~ WontDo — server deleted; metrics path is now `$run_dir/metrics.jsonl` via `log_metric` |
| task_13_03 | Paginate all `gh issue list` / `gh pr list` calls                                                                                                          |
| task_13_04 | Fsync on state writes                                                                                                                                      |
| task_13_05 | Coverage gate >= not ==                                                                                                                                    |
| task_13_06 | Seed holdout test selection from run_id                                                                                                                    |
| task_13_07 | Deny list entries handle absolute paths                                                                                                                    |

## Execution Guidance

### task_13_01 — classify-risk reasoning trace

File: `bin/pipeline-classify-risk`

Current output:

```json
{ "risk": "security" }
```

Add a `reasoning` field listing the signals that contributed:

```bash
classify() {
  local task_json="$1"
  local signals=()
  local risk="low"

  # Inspect files
  local files
  files=$(echo "$task_json" | jq -r '.files[]?' 2>/dev/null)

  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      *auth*|*session*|*token*|*password*|*crypto*)
        signals+=("auth-related file: $f")
        risk="security"
        ;;
      **/migrations/*|**/db/*)
        signals+=("database migration: $f")
        [[ "$risk" != "security" ]] && risk="database"
        ;;
      *.env*|*secrets*|*credentials*)
        signals+=("secret file: $f")
        risk="security"
        ;;
    esac
  done <<< "$files"

  # Inspect title/description
  local title description
  title=$(echo "$task_json" | jq -r '.title // ""')
  description=$(echo "$task_json" | jq -r '.description // ""')

  if echo "$title $description" | grep -iEq 'auth|sso|oauth|jwt|csrf|xss|sql injection|rce'; then
    signals+=("security keyword in title/description")
    risk="security"
  fi

  if echo "$title $description" | grep -iEq 'migration|schema change|drop|alter'; then
    signals+=("migration keyword in title/description")
    [[ "$risk" != "security" ]] && risk="database"
  fi

  # Emit result with reasoning
  jq -n --arg r "$risk" --argjson s "$(printf '%s\n' "${signals[@]}" | jq -R . | jq -s .)" \
    '{risk:$r, reasoning:$s}'
}
```

If no signals fire → `risk: "low"`, `reasoning: []`.

Test in `bin/test-phase3.sh`:

1. Task with `files: ["src/auth/session.ts"]` → `risk=security`, reasoning contains `"auth-related file: src/auth/session.ts"`
2. Task with `title: "Add SSO login"` → `risk=security`
3. Task with no signals → `risk=low`, `reasoning=[]`

### task_13_02 — Metrics schema docs ~~WontDo~~

`servers/pipeline-metrics/` deleted. Server was orphaned — event vocabulary and storage path diverged from the real pipeline with zero wiring. Metrics path consolidated to `$run_dir/metrics.jsonl` via `log_metric` in `bin/pipeline-lib.sh`. Events `run.start` and `circuit_breaker` backfilled to per-run log so no observability is lost. See `docs/architecture/components.md` for current event vocabulary.

### task_13_03 — gh pagination

Files: all `bin/pipeline-*` scripts that call `gh issue list` or `gh pr list`

Default `gh` limit is 30. Any list call that could return more must paginate.

```bash
# Before
gh issue list --state open

# After
gh issue list --state open --limit 1000
```

Or if truly unbounded:

```bash
# Use --json and stream paginated fetches
page=1
all=""
while true; do
  batch=$(gh issue list --state open --limit 100 --page "$page" --json number,title)
  count=$(echo "$batch" | jq length)
  all=$(jq -s 'add' <(echo "$all") <(echo "$batch"))
  (( count < 100 )) && break
  page=$((page + 1))
done
```

Pragmatic choice: `--limit 1000` is enough for any realistic project. Use it everywhere. Document the cap in the script.

Grep `bin/` for `gh issue list` and `gh pr list`. Fix each.

Test in `bin/test-phase2.sh`: extend the `gh` mock to verify callers pass `--limit` ≥ 100.

### task_13_04 — Fsync on state writes

File: `bin/pipeline-state`

Current write:

```bash
jq "..." "$state_file" > "$tmp"
mv "$tmp" "$state_file"
```

`mv` is atomic (rename) but not durable — a crash after rename but before filesystem sync can leave an empty file.

Fix (Linux has `sync`, macOS has `sync -f` or `/usr/bin/sync` but not on a single file — fall back to `python -c 'import os; f=open(...); os.fsync(f.fileno())'`):

```bash
atomic_write_json() {
  local dest="$1"
  local content="$2"

  local tmp="${dest}.$$.tmp"
  printf '%s' "$content" > "$tmp"

  # Fsync the tmp file
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import os; f=open('$tmp','rb'); os.fsync(f.fileno()); f.close()" 2>/dev/null || true
  elif [[ -w /proc/self/fd/0 ]]; then
    # Linux: sync -d if available
    sync -d "$tmp" 2>/dev/null || sync
  else
    sync
  fi

  mv "$tmp" "$dest"

  # Fsync the parent directory to ensure the rename is durable
  local parent
  parent="$(dirname "$dest")"
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import os; fd=os.open('$parent', os.O_RDONLY); os.fsync(fd); os.close(fd)" 2>/dev/null || true
  fi
}
```

This is overkill for most operations but the state file is the durability root. Losing state loses the whole run.

Performance impact: ~5-10ms per write. Acceptable since writes are not on the hot path.

Test in `bin/test-phase1.sh`:

- Call `pipeline-state write` 100 times → all values persist after the script exits
- No `$tmp` leftovers in the state directory
- Hard to test fsync behavior without simulating a crash; document the design rationale in the script header comment

### task_13_05 — Coverage gate >= not ==

File: `bin/pipeline-coverage-gate`

Grep for the comparison operator. Change `==` to `>=` or `-ge`:

```bash
# Before (strict equality — fails at boundary)
if (( $(echo "$coverage == $threshold" | bc -l) )); then pass; fi

# After
if (( $(echo "$coverage >= $threshold" | bc -l) )); then pass; fi
```

If using integer arithmetic:

```bash
# Before
if [[ "$coverage_int" -eq "$threshold_int" ]]; then pass; fi

# After
if [[ "$coverage_int" -ge "$threshold_int" ]]; then pass; fi
```

Test in `bin/test-phase6.sh`:

1. Coverage 80.0, threshold 80.0 → pass (was: fail)
2. Coverage 80.1, threshold 80.0 → pass
3. Coverage 79.9, threshold 80.0 → fail

### task_13_06 — Seed holdout from run_id

File: `bin/pipeline-holdout-test` (if exists) or any script with `RANDOM_SEED=42`

Replace the hardcoded seed with a hash of the run_id:

```bash
# Before
RANDOM_SEED=42

# After
seed_from_run_id() {
  local run_id="$1"
  # Take first 8 hex chars of sha256, convert to decimal
  local hash
  hash=$(printf '%s' "$run_id" | openssl dgst -sha256 | awk '{print $NF}' | head -c 8)
  printf '%d' "0x$hash"
}

RANDOM_SEED=$(seed_from_run_id "$run_id")
```

Now every run gets a different but reproducible holdout set. Re-running the same run_id produces the same holdout (useful for debugging), but two parallel runs in different directories get different holdouts (useful for coverage).

Test in `bin/test-phase6.sh`:

- Same run_id → same seed (reproducible)
- Different run_ids → different seeds (with >95% probability across 100 tests)

### task_13_07 — Absolute-path patterns in deny list

File: `templates/settings.autonomous.json`

Current deny list from plan 04:

```json
"deny": [
  "Write(.env)",
  "Write(**/migrations/**)"
]
```

The pattern `**/migrations/**` matches relative paths but may not match absolute paths depending on how Claude Code's matcher is implemented. Add absolute variants defensively:

```json
"deny": [
  "Write(.env)", "Write(./.env)", "Write(/**/.env)",
  "Write(.env.*)", "Write(./.env.*)", "Write(/**/.env.*)",
  "Write(**/migrations/**)", "Write(/**/migrations/**)",
  "Edit(**/migrations/**)", "Edit(/**/migrations/**)"
]
```

If Claude Code's matcher normalizes paths to relative, the absolute variants are harmless no-ops. If it doesn't, they close the gap. Both work.

Test in `bin/test-phase9.sh`:

- `jq -r '.permissions.deny[]' templates/settings.autonomous.json | grep -c '^Write'` — at least 6
- At least one entry contains `/**/` prefix (absolute-path pattern)

## Verification

1. `bash bin/test-phase1.sh` through `bin/test-phase9.sh` — all existing + new cleanup tests pass
2. Grep `bin/` for `gh issue list` without `--limit` — zero matches
3. Grep `bin/` for `RANDOM_SEED=42` — zero matches
4. ~~`servers/pipeline-metrics/README.md` and `schema.json` exist~~ (task_13_02 WontDo — server deleted)
5. `bin/pipeline-classify-risk` output contains a `reasoning` array
