# `/factory:debug` Command + Root-Cause Iron Law — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/factory:debug` command that drives the existing reviewer ⇄ implementer loop against arbitrary code (latest commit, custom base, or full codebase), and add Iron Laws to `task-executor` requiring it to verify reviewer findings before fixing them and to escalate fundamental design flaws to a human instead of working around them.

**Architecture:** Skill-driven loop reusing `pipeline-detect-reviewer`, `pipeline-codex-review`, and `task-executor` agent. Two new bin scripts (`pipeline-debug-review` for severity filtering, `pipeline-debug-escalate` for the audit trail). Iron Laws added to `agents/task-executor.md` apply to every invocation of the agent (including the existing postreview loop in `pipeline-run-task`); a one-line reminder is appended in fix-mode prompts.

**Tech Stack:** Bash, jq, git, codex CLI (optional), Claude Code Skill / Agent tools.

**Spec:** `docs/superpowers/specs/2026-04-25-debug-command-design.md`

**File map:**

- Create: `bin/pipeline-debug-review`, `bin/pipeline-debug-escalate`
- Create: `skills/debug/SKILL.md`
- Create: `commands/debug.md`
- Create: `bin/tests/debug.sh`
- Create: `bin/tests/fixtures/debug/` (review JSON fixtures)
- Modify: `agents/task-executor.md` — add Iron Laws section + Red Flags rows
- Modify: `bin/pipeline-run-task` — append one reminder line in `_stage_postreview` heredoc

---

### Task 1: Add Iron Laws section and Red Flags rows to `task-executor.md`

This change applies the new rules to BOTH the new `/debug` loop AND the existing postreview loop in `pipeline-run-task`, since both spawn the same agent.

**Files:**

- Modify: `agents/task-executor.md`

- [ ] **Step 1: Read the current `task-executor.md` to confirm exact insertion points**

Run: `wc -l agents/task-executor.md && head -50 agents/task-executor.md`
Expected: ~117 lines; the `<EXTREMELY-IMPORTANT>` block ends on line 28; the `## Red Flags — STOP and re-read this prompt` heading is at line 30.

- [ ] **Step 2: Insert the new `## Iron Laws` section between the EI block and the Red Flags table**

Use Edit to insert after the closing `</EXTREMELY-IMPORTANT>` line (line 28) and before the blank line that precedes `## Red Flags`. Insert exactly:

```markdown
## Iron Laws

1. **Verify findings before planning a fix.** When you receive review feedback, validate each finding _before_ designing the fix:
   - _Technically_: read the code at the cited `file:line`; reproduce the failure or trace the execution path that produces the bug. If you cannot reproduce or trace it, the finding is unverified.
   - _Against the task intent_: when running under a spec (pipeline mode), cross-check against the task's acceptance criteria. When running standalone (e.g. `/factory:debug`), cross-check against the commit message and the surrounding code's intent. A finding that contradicts the intent is invalid even if technically correct.

   For each finding record one of: `confirmed` (proceed to fix), `dismissed: <one-line reason>` (do NOT fix; report in STATUS line), `uncertain: <question>` (STATUS: NEEDS_CONTEXT).

2. **Fix root causes; escalate fundamental flaws.** Fix the underlying cause — do not add layers around the symptom. Favour simplifying existing code over patching it. If a finding's root cause is a fundamental design or architecture flaw outside this task's scope, end with `STATUS: BLOCKED — escalate: <one-line description>` rather than working around it. This is the only sanctioned escalation path; in every other situation, finish the task.

Violating the letter of these rules violates the spirit. No exceptions.
```

- [ ] **Step 3: Append four new rows to the existing Red Flags table**

Use Edit to add these rows immediately before the `## Input` heading. The four rows are appended to the existing markdown table (preserve column alignment with the existing rows):

```markdown
| "Reviewer flagged it, must be a real bug" | Verify first. Read the code at the cited line; reproduce or trace. Unverified ≠ confirmed. |
| "I'll add a guard around the symptom and move on" | That's a layer, not a fix. Find the producer of the bad state. |
| "Refactoring this would be cleaner but I'll patch instead" | Simplification is preferred. Patching adds debt. |
| "This finding exposes a deeper design issue but I'll work around it" | `STATUS: BLOCKED — escalate: <issue>`. Do NOT work around. |
```

- [ ] **Step 4: Update the `## On Failure` `code_review` line to reference the new Iron Laws**

Find the line `- \`code_review\` — address ALL blocking findings.` and replace with:

```markdown
- `code_review` — verify each finding per Iron Law 1, then address the confirmed ones per Iron Law 2 (escalate if fundamental).
```

- [ ] **Step 5: Verify edits by reading the file**

Run: `grep -n "## Iron Laws\|escalate: <" agents/task-executor.md`
Expected: at least three matches — the section heading, Iron Law 2's escalate clause, and the Red Flag row referencing it.

- [ ] **Step 6: Commit**

```bash
git add agents/task-executor.md
git commit -m "$(cat <<'EOF'
feat(executor): verify-findings + root-cause-or-escalate Iron Laws

Adds two Iron Laws to task-executor: (1) verify each review finding
technically and against task intent before planning a fix; (2) fix root
causes, escalate fundamental design flaws via STATUS: BLOCKED — escalate:.
Applies to every invocation (initial GREEN, postreview loop, /factory:debug).
EOF
)"
```

---

### Task 2: Append Iron Law reminder to `_stage_postreview` executor-fix heredoc

**Files:**

- Modify: `bin/pipeline-run-task` (around line 884–895, the `pf=$(_prompt_path executor-fix)` heredoc)

- [ ] **Step 1: Locate the executor-fix heredoc**

Run: `grep -n "Fix reviewer-reported blockers" bin/pipeline-run-task`
Expected: a single match around line 885.

- [ ] **Step 2: Add a `printf` line emitting the reminder before the closing `End with STATUS:` line**

Use Edit. Find:

```bash
      printf 'End with STATUS: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT.\n'
```

(only the occurrence inside the executor-fix heredoc — the other STATUS line in the file is for a different prompt). Replace with:

```bash
      printf '\nIron Law reminder: verify each finding (technically + against task intent) before planning a fix; address root causes, not symptoms; if a root cause is a fundamental design/architecture flaw outside scope, end with STATUS: BLOCKED — escalate: <reason>.\n'
      printf 'End with STATUS: DONE|DONE_WITH_CONCERNS|BLOCKED|NEEDS_CONTEXT.\n'
```

If the STATUS line appears more than once in the file, use a more specific anchor (the preceding line `printf '%s\n' "$prior_blockers_json"`...) to disambiguate.

- [ ] **Step 3: Smoke-test the script still parses**

Run: `bash -n bin/pipeline-run-task`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add bin/pipeline-run-task
git commit -m "feat(postreview): append Iron Law reminder to executor-fix prompt"
```

---

### Task 3: Failing tests for `pipeline-debug-review` (severity filter)

**Files:**

- Create: `bin/tests/debug.sh`
- Create: `bin/tests/fixtures/debug/review-mixed.json`

- [ ] **Step 1: Create review fixture with mixed-severity findings**

Create `bin/tests/fixtures/debug/review-mixed.json`:

```json
{
  "verdict": "REQUEST_CHANGES",
  "round": 1,
  "confidence": "HIGH",
  "findings": [
    {
      "title": "F-crit",
      "file": "a.ts",
      "line": 1,
      "severity": "critical",
      "verbatim_line": "let x = 1;",
      "description": "c"
    },
    {
      "title": "F-high",
      "file": "a.ts",
      "line": 2,
      "severity": "high",
      "verbatim_line": "let y = 2;",
      "description": "h"
    },
    {
      "title": "F-med",
      "file": "a.ts",
      "line": 3,
      "severity": "medium",
      "verbatim_line": "let z = 3;",
      "description": "m"
    },
    {
      "title": "F-low",
      "file": "a.ts",
      "line": 4,
      "severity": "low",
      "verbatim_line": "let w = 4;",
      "description": "l"
    },
    {
      "title": "F-imp",
      "file": "a.ts",
      "line": 5,
      "severity": "important",
      "verbatim_line": "let i = 5;",
      "description": "i"
    },
    {
      "title": "F-min",
      "file": "a.ts",
      "line": 6,
      "severity": "minor",
      "verbatim_line": "let n = 6;",
      "description": "n"
    }
  ],
  "summary": "mixed",
  "reviewer": "codex"
}
```

- [ ] **Step 2: Create `bin/tests/debug.sh` with the test scaffold + first failing tests**

```bash
#!/usr/bin/env bash
# debug.sh — bin/pipeline-debug-review and bin/pipeline-debug-escalate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
FIXTURES="$REPO_ROOT/bin/tests/fixtures/debug"
ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-debug.XXXXXX")"
STUB_DIR="$ROOT_TMP/stubs"
mkdir -p "$STUB_DIR"
trap 'rm -rf "$ROOT_TMP"' EXIT INT TERM

export PATH="$STUB_DIR:$BIN_DIR:$PATH"

passed=0; failed=0; current=""
pass() { passed=$((passed+1)); printf '  PASS [%s] %s\n' "$current" "$1"; }
fail() { failed=$((failed+1)); printf '  FAIL [%s] %s\n' "$current" "$1"; }
assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [[ "$want" == "$got" ]]; then pass "$desc"
  else fail "$desc (want=$want got=$got)"; fi
}

write_stub() {
  local name="$1"; shift
  printf '#!/usr/bin/env bash\n%s\n' "$*" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}

# --- pipeline-debug-review: severity filter -------------------------------

current="severity-filter"

# Stub the underlying reviewer to echo the fixture file
write_stub pipeline-detect-reviewer 'echo "{\"reviewer\":\"codex\"}"'
write_stub pipeline-codex-review "cat $FIXTURES/review-mixed.json"

run_filter() {
  local sev="$1"
  pipeline-debug-review --base HEAD --severity "$sev" --out-dir "$ROOT_TMP/out-$sev" 2>/dev/null
}

# critical → 1 blocking (F-crit)
got=$(run_filter critical | jq -r '.blocking_count')
assert_eq "critical level filters to {critical}" "1" "$got"

# high → 2 blocking (critical + high + important normalized)
got=$(run_filter high | jq -r '.blocking_count')
assert_eq "high level filters to {critical,high,important}" "3" "$got"

# medium (default) → 4 blocking
got=$(run_filter medium | jq -r '.blocking_count')
assert_eq "medium level filters to {critical,high,important,medium}" "4" "$got"

# all → 6 blocking
got=$(run_filter all | jq -r '.blocking_count')
assert_eq "all level filters to all" "6" "$got"

# Below-threshold count surfaced separately
got=$(run_filter critical | jq -r '.below_threshold_count')
assert_eq "below-threshold count when severity=critical" "5" "$got"

# Round file written to out-dir
out_dir="$ROOT_TMP/out-medium"
[[ -f "$out_dir/round-1.review.json" ]] && pass "round file written" \
  || fail "round file written (missing $out_dir/round-1.review.json)"

# --- summary --------------------------------------------------------------
printf '\n%s passed, %s failed\n' "$passed" "$failed"
[[ $failed -eq 0 ]]
```

Make executable: `chmod +x bin/tests/debug.sh`

- [ ] **Step 3: Run the new test suite — expect failures**

Run: `bin/test debug`
Expected: every assertion fails with `command not found: pipeline-debug-review` or similar (the script doesn't exist yet).

- [ ] **Step 4: Commit (failing tests)**

```bash
git add bin/tests/debug.sh bin/tests/fixtures/debug/review-mixed.json
git commit -m "test(debug): failing tests for pipeline-debug-review severity filter"
```

---

### Task 4: Implement `pipeline-debug-review`

**Files:**

- Create: `bin/pipeline-debug-review`

- [ ] **Step 1: Write the script**

Create `bin/pipeline-debug-review`:

```bash
#!/usr/bin/env bash
# pipeline-debug-review — wraps the existing reviewer (codex preferred,
# Claude fallback) for the /factory:debug loop. Resolves the diff base,
# normalizes finding severities, filters by --severity threshold, writes
# the round JSON to --out-dir, and prints a small JSON summary on stdout.
#
# Usage:
#   pipeline-debug-review --base <ref> --severity <critical|high|medium|all>
#                         --out-dir <dir> [--round <N>]
# Output (stdout, single line JSON):
#   {"blocking_count":N,"below_threshold_count":M,"verdict":"...","review_file":"<path>"}
# Exit: 0 on success, 1 on reviewer/IO failure.

set -euo pipefail
source "$(dirname "$0")/pipeline-lib.sh"
require_command jq

base_ref=""
severity="medium"
out_dir=""
round=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)     base_ref="$2"; shift 2 ;;
    --severity) severity="$2"; shift 2 ;;
    --out-dir)  out_dir="$2";  shift 2 ;;
    --round)    round="$2";    shift 2 ;;
    *) log_error "unknown flag: $1"; exit 1 ;;
  esac
done

[[ -z "$base_ref" ]] && { log_error "--base required"; exit 1; }
[[ -z "$out_dir"  ]] && { log_error "--out-dir required"; exit 1; }
case "$severity" in critical|high|medium|all) : ;; *) log_error "invalid --severity: $severity"; exit 1 ;; esac

mkdir -p "$out_dir"
review_file="$out_dir/round-${round}.review.json"

# Run the underlying reviewer (codex preferred). pipeline-detect-reviewer
# never fails; if codex unavailable its caller would fall back to the
# quality-reviewer agent. /debug only supports the codex path for now;
# fallback is reported as REVIEW_FAILED.
detect_json=$(pipeline-detect-reviewer 2>/dev/null || printf '{}')
reviewer=$(printf '%s' "$detect_json" | jq -r '.reviewer // "unknown"')

if [[ "$reviewer" != "codex" ]]; then
  log_error "non-codex reviewer (\"$reviewer\") not yet supported by /factory:debug"
  exit 1
fi

# Codex review writes normalized JSON to stdout
if ! pipeline-codex-review --base "$base_ref" --task-id "debug-r${round}" > "$review_file"; then
  log_error "pipeline-codex-review failed"
  exit 1
fi

# Severity normalization: important → high, minor → low
normalized=$(jq -c '
  .findings = (.findings // [] | map(
    .severity = (
      if .severity == "important" then "high"
      elif .severity == "minor"   then "low"
      else (.severity // "medium")
      end
    )
  ))
' "$review_file")
printf '%s' "$normalized" > "$review_file"

# Threshold mapping
threshold_set() {
  case "$1" in
    critical) printf 'critical' ;;
    high)     printf 'critical high' ;;
    medium)   printf 'critical high medium' ;;
    all)      printf 'critical high medium low' ;;
  esac
}
allowed=$(threshold_set "$severity")

blocking=$(jq --arg allowed "$allowed" '
  [.findings[] | select((.severity // "medium") as $s
                        | ($allowed | split(" ")) | index($s))] | length
' "$review_file")
below=$(jq --arg allowed "$allowed" '
  [.findings[] | select(((.severity // "medium") as $s
                        | ($allowed | split(" ")) | index($s)) | not)] | length
' "$review_file")
verdict=$(jq -r '.verdict // "UNKNOWN"' "$review_file")

jq -nc \
  --argjson blocking "$blocking" \
  --argjson below "$below" \
  --arg verdict "$verdict" \
  --arg path "$review_file" \
  '{blocking_count:$blocking, below_threshold_count:$below, verdict:$verdict, review_file:$path}'
```

Make executable: `chmod +x bin/pipeline-debug-review`

- [ ] **Step 2: Run the test suite — expect pass**

Run: `bin/test debug`
Expected: all severity-filter assertions pass.

- [ ] **Step 3: Commit**

```bash
git add bin/pipeline-debug-review
git commit -m "feat(debug): pipeline-debug-review severity-aware reviewer wrapper"
```

---

### Task 5: Add `--full` and default base resolution to the skill (deferred — single source of truth)

Base-ref resolution lives in the skill (the LLM resolves `--full`, `--base`, default). `pipeline-debug-review` accepts an already-resolved `--base <hash>`. No code change in this task — just confirm by reading the spec section on flag handling. Skip if confirmed.

- [ ] **Step 1: Confirm the design assigns base resolution to the skill**

Run: `grep -n 'rev-list --max-parents=0' docs/superpowers/specs/2026-04-25-debug-command-design.md`
Expected: one match in the flag-handling table.

- [ ] **Step 2: No code change. Move on.**

---

### Task 6: Failing tests for `pipeline-debug-escalate`

**Files:**

- Modify: `bin/tests/debug.sh` (append new section)

- [ ] **Step 1: Append escalation tests at the end of `bin/tests/debug.sh` (before the summary block)**

Insert before the existing `printf '\n%s passed, %s failed\n'` line:

```bash
# --- pipeline-debug-escalate ---------------------------------------------

current="escalate"

esc_run="esc-001"
esc_dir="$ROOT_TMP/data/debug/$esc_run"
mkdir -p "$esc_dir"
export CLAUDE_PLUGIN_DATA="$ROOT_TMP/data"

cat > "$esc_dir/findings.json" <<'EOF'
[{"file":"x.ts","line":10,"severity":"critical","description":"d","verbatim_line":"let x"}]
EOF

cat > "$esc_dir/executor-msg.txt" <<'EOF'
The ConnectionPool singleton can't accept a configurable timeout without redesigning the pool ownership model.
STATUS: BLOCKED — escalate: ConnectionPool singleton needs ownership rework
EOF

stdout=$(pipeline-debug-escalate \
  --run-id "$esc_run" \
  --reason "ConnectionPool singleton needs ownership rework" \
  --base "HEAD~1" \
  --severity "medium" \
  --findings "$esc_dir/findings.json" \
  --executor-msg "$esc_dir/executor-msg.txt")

# Stdout exact format
case "$stdout" in
  "ESCALATED path=$esc_dir/escalation.md") pass "stdout format" ;;
  *) fail "stdout format (got: $stdout)" ;;
esac

# Escalation file exists and includes key fields
[[ -f "$esc_dir/escalation.md" ]] && pass "escalation file written" \
  || fail "escalation file written (missing)"

grep -q "ConnectionPool singleton needs ownership rework" "$esc_dir/escalation.md" \
  && pass "escalation file contains reason" \
  || fail "escalation file contains reason"

grep -q '"severity": "critical"' "$esc_dir/escalation.md" \
  || grep -q '"severity":"critical"' "$esc_dir/escalation.md" \
  && pass "escalation file embeds findings JSON" \
  || fail "escalation file embeds findings JSON"

grep -q "STATUS: BLOCKED — escalate" "$esc_dir/escalation.md" \
  && pass "escalation file embeds executor message" \
  || fail "escalation file embeds executor message"
```

- [ ] **Step 2: Run — expect failures**

Run: `bin/test debug`
Expected: severity-filter tests still pass; new escalation tests fail with `command not found: pipeline-debug-escalate`.

- [ ] **Step 3: Commit**

```bash
git add bin/tests/debug.sh
git commit -m "test(debug): failing tests for pipeline-debug-escalate"
```

---

### Task 7: Implement `pipeline-debug-escalate`

**Files:**

- Create: `bin/pipeline-debug-escalate`

- [ ] **Step 1: Write the script**

````bash
#!/usr/bin/env bash
# pipeline-debug-escalate — writes the escalation audit trail for /factory:debug
# when the executor returns STATUS: BLOCKED — escalate: <reason>.
#
# Usage:
#   pipeline-debug-escalate --run-id <id> --reason <text> --base <ref>
#                           --severity <s> --findings <path> --executor-msg <path>
# Output (stdout, exact): ESCALATED path=<absolute escalation.md path>
# Exit: 0 on success, 1 on IO failure.

set -euo pipefail
source "$(dirname "$0")/pipeline-lib.sh"
require_command jq

run_id=""; reason=""; base_ref=""; severity=""; findings=""; exec_msg=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id)       run_id="$2";   shift 2 ;;
    --reason)       reason="$2";   shift 2 ;;
    --base)         base_ref="$2"; shift 2 ;;
    --severity)     severity="$2"; shift 2 ;;
    --findings)     findings="$2"; shift 2 ;;
    --executor-msg) exec_msg="$2"; shift 2 ;;
    *) log_error "unknown flag: $1"; exit 1 ;;
  esac
done

for v in run_id reason base_ref severity findings exec_msg; do
  [[ -z "${!v}" ]] && { log_error "--${v//_/-} required"; exit 1; }
done

data_root="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/dark-factory}"
out_dir="$data_root/debug/$run_id"
mkdir -p "$out_dir"
out_file="$out_dir/escalation.md"

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || printf 'unknown')

{
  printf '# /factory:debug Escalation\n\n'
  printf '- **Run ID:** %s\n' "$run_id"
  printf '- **Timestamp:** %s\n' "$ts"
  printf '- **Base ref:** %s\n' "$base_ref"
  printf '- **Severity threshold:** %s\n' "$severity"
  printf '- **Reason:** %s\n\n' "$reason"

  printf '## Findings\n\n```json\n'
  if [[ -f "$findings" ]]; then
    jq '.' "$findings" 2>/dev/null || cat "$findings"
  fi
  printf '\n```\n\n'

  printf '## Executor final message\n\n```\n'
  if [[ -f "$exec_msg" ]]; then cat "$exec_msg"; fi
  printf '\n```\n'
} > "$out_file"

printf 'ESCALATED path=%s\n' "$out_file"
````

Make executable: `chmod +x bin/pipeline-debug-escalate`

- [ ] **Step 2: Run tests — expect pass**

Run: `bin/test debug`
Expected: all assertions pass.

- [ ] **Step 3: Commit**

```bash
git add bin/pipeline-debug-escalate
git commit -m "feat(debug): pipeline-debug-escalate writes audit trail and stdout marker"
```

---

### Task 8: Create `skills/debug/SKILL.md`

**Files:**

- Create: `skills/debug/SKILL.md`

- [ ] **Step 1: Read `skills/pipeline-rescue/SKILL.md` for shape reference**

Run: `wc -l skills/pipeline-rescue/SKILL.md && head -60 skills/pipeline-rescue/SKILL.md`
Expected: a frontmatter block + Iron Laws + procedure section. Use this as a structural reference for the new skill.

- [ ] **Step 2: Write `skills/debug/SKILL.md`**

```markdown
---
name: debug
description: "Drives a reviewer ⇄ implementer loop against a chosen scope until the reviewer is satisfied. Reuses pipeline-codex-review and the task-executor agent. Used by /factory:debug."
---

# /factory:debug — Reviewer ⇄ Implementer Loop

<EXTREMELY-IMPORTANT>
## Iron Law

EVERY ROUND COMMITS A REVIEW ARTIFACT TO STATE BEFORE SPAWNING THE EXECUTOR.

`pipeline-debug-review` writes `round-N.review.json` to the run's state dir and prints `{blocking_count, below_threshold_count, verdict, review_file}` on stdout. You do NOT spawn the executor without first persisting that artifact, and you do NOT advance to round N+1 without the executor's STATUS line recorded.

Violating the letter of this rule violates the spirit. No exceptions.
</EXTREMELY-IMPORTANT>

## Iron Laws

1. **Resolve the base ref before the first review.** `--base <hash>` overrides; `--full` resolves to the empty-tree SHA `4b825dc642cb6eb9a060e54bf8d69288fbee4904`; default is `HEAD~1`. `--base` and `--full` are mutually exclusive — abort with a usage line if both are present.
2. **Validate `--fixSeverity` upfront.** Allowed: `critical | high | medium | all`. Default `medium`. Reject anything else.
3. **Time limit is a soft boundary.** Check the deadline at the TOP of each iteration only. Do NOT abort a round in flight.
4. **Surface every escalation.** When `pipeline-debug-escalate` prints `ESCALATED path=<X>`, your final user-facing message MUST include the line `Escalated to human review. Audit trail: <X>`.

## Inputs

The command parses flags into a single line of arguments and invokes this skill with them. Expected variables:

- `BASE` — resolved base ref (hash, branch, or empty-tree SHA)
- `SEVERITY` — `critical | high | medium | all`
- `LIMIT` — integer seconds (0 = unlimited)
- `RUN_ID` — generated by the skill if not provided (`debug-<unix-ts>`)

## Procedure

1. **Validate flags + resolve base.** If `--full` and `--base` both set, abort: `usage: /factory:debug [--base <hash>|--full] [--limit <s>] [--fixSeverity ...]`.
2. **Compute deadline.** `deadline = LIMIT > 0 ? $(date +%s) + LIMIT : 0`.
3. **Initialise state.** `state_dir="${CLAUDE_PLUGIN_DATA:-$HOME/.claude/dark-factory}/debug/$RUN_ID"`. Write `state.json` with `{base, severity, deadline, started_at, rounds:[]}`.
4. **Loop (round = 1..N):**
   a. If `deadline > 0 && $(date +%s) >= deadline`: print summary with `STATUS: TIME_LIMIT`, break.
   b. Run: `pipeline-debug-review --base "$BASE" --severity "$SEVERITY" --out-dir "$state_dir" --round "$round"`. Parse stdout JSON.
   c. If `blocking_count == 0`: print summary with `STATUS: CLEAN`, break.
   d. Build the executor-fix prompt. Use the `Agent` tool with `subagent_type: "task-executor"`, `isolation: "worktree"`. Prompt content (template below).
   e. Capture the executor's final assistant message → `state_dir/round-${round}.executor.log`. Extract STATUS line.
   f. If STATUS matches `BLOCKED — escalate: <reason>`:
   - Run: `pipeline-debug-escalate --run-id "$RUN_ID" --reason "<reason>" --base "$BASE" --severity "$SEVERITY" --findings "$review_file" --executor-msg "$state_dir/round-${round}.executor.log"`.
   - Capture the `ESCALATED path=<X>` line. Print summary with `STATUS: ESCALATED` and `Escalated to human review. Audit trail: <X>`. Break.
     g. If STATUS is `BLOCKED` (other) or `NEEDS_CONTEXT`: print summary with `STATUS: <as-returned>`, break.
     h. Else (`DONE | DONE_WITH_CONCERNS`): increment `round`, continue.
5. **Final summary** (always printed). Include: rounds run, final STATUS, last review's `below_threshold_count`, and the escalation line if applicable.

## Executor-fix prompt template
```

[debug:round-${round}]

You are running under /factory:debug — there is no spec; the task is to address the reviewer's findings on the diff between ${BASE} and HEAD.

Review file (normalized JSON, contains findings array): ${review_file}

Iron Law reminder: verify each finding (technically + against task intent) before planning a fix; address root causes, not symptoms; if a root cause is a fundamental design/architecture flaw outside scope, end with STATUS: BLOCKED — escalate: <reason>.

For each finding, classify it as confirmed / dismissed / uncertain BEFORE editing any code. Then implement only the confirmed ones. Commit fixes locally — do not push.

End with STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT.

```

## Final user-facing summary template

```

/factory:debug summary

- Run ID: ${RUN_ID}
- Base: ${BASE}
- Severity: ${SEVERITY}
- Rounds: ${round}
- Final: ${STATUS}
- Below-threshold findings remaining: ${below_threshold_count}
  [Escalated to human review. Audit trail: <path> — only when STATUS=ESCALATED]

```

## Verification Checklist (MUST pass before printing the final summary)

- [ ] Validated flags (mutually exclusive, severity in allowed set)
- [ ] Resolved base ref BEFORE the first review
- [ ] Persisted each round's review artifact + executor log under `state_dir`
- [ ] When the executor escalated, ran `pipeline-debug-escalate` and surfaced its path verbatim in the summary
- [ ] Time limit was checked only at the top of each iteration

Can't check every box? Print `STATUS: BLOCKED — <reason>` instead of a normal summary.
```

- [ ] **Step 3: Commit**

```bash
git add skills/debug/SKILL.md
git commit -m "feat(debug): skills/debug drives review ⇄ implementer loop"
```

---

### Task 9: Create `commands/debug.md`

**Files:**

- Create: `commands/debug.md`

- [ ] **Step 1: Write the command**

```markdown
---
description: "Run a reviewer ⇄ implementer loop against the latest commit (or a chosen scope) until the reviewer is satisfied"
arguments:
  - name: "--base"
    description: "Diff base (commit hash). Mutually exclusive with --full. Default: HEAD~1."
    required: false
  - name: "--full"
    description: "Review the entire codebase (sets base to git's empty-tree SHA). Mutually exclusive with --base."
    required: false
  - name: "--limit"
    description: "Maximum runtime in seconds. Soft limit — checked between loop iterations only."
    required: false
  - name: "--fixSeverity"
    description: "Minimum severity to address: critical | high | medium | all. Default: medium."
    required: false
---

# /factory:debug

Reuse the existing reviewer (Codex when available) and `task-executor` agent in a loop:

1. Review the diff between `--base` (or HEAD~1, or root) and HEAD.
2. Filter findings by `--fixSeverity`.
3. If any remain, spawn `task-executor` to verify and fix them.
4. Repeat until clean, escalated, or `--limit` reached.

Parse flags from the user's input. Reject the call if both `--base` and `--full` are provided. Resolve the base ref:

- `--base <hash>` → that hash.
- `--full` → `4b825dc642cb6eb9a060e54bf8d69288fbee4904` (git empty tree).
- (default) → `HEAD~1`.

Validate `--fixSeverity` against `{critical, high, medium, all}` (default: `medium`).

Then load the skill:
```

Skill(debug, "base=<resolved> severity=<level> limit=<seconds> run-id=debug-$(date +%s)")

```

All loop logic lives in `skills/debug/SKILL.md`. Do not duplicate it here.
```

- [ ] **Step 2: Commit**

```bash
git add commands/debug.md
git commit -m "feat(debug): /factory:debug command + flag parsing"
```

---

### Task 10: Skill loop integration smoke test

This is a smoke test of the skill's documented procedure — without invoking the LLM. We exercise the bin scripts in the order the skill prescribes and assert state-dir layout.

**Files:**

- Modify: `bin/tests/debug.sh` (append a third section)

- [ ] **Step 1: Append the integration section before the final summary block**

```bash
# --- skill loop smoke test (bin scripts only) ----------------------------

current="loop-smoke"

loop_run="loop-001"
loop_dir="$ROOT_TMP/data/debug/$loop_run"
export CLAUDE_PLUGIN_DATA="$ROOT_TMP/data"

# Round 1: reviewer returns one critical finding
write_stub pipeline-codex-review "cat $FIXTURES/review-mixed.json"

result=$(pipeline-debug-review --base HEAD --severity critical --out-dir "$loop_dir" --round 1)
got=$(printf '%s' "$result" | jq -r '.blocking_count')
assert_eq "round 1 produces blocking findings" "1" "$got"

[[ -f "$loop_dir/round-1.review.json" ]] && pass "round 1 artifact persisted" \
  || fail "round 1 artifact persisted"

# Simulate executor escalation
cat > "$loop_dir/round-1.executor.log" <<'EOF'
Findings analysis complete.
STATUS: BLOCKED — escalate: ConnectionPool singleton ownership rework needed
EOF

# Skill calls escalate when STATUS line matches the escalate pattern.
findings_path=$(printf '%s' "$result" | jq -r '.review_file')
esc_stdout=$(pipeline-debug-escalate \
  --run-id "$loop_run" \
  --reason "ConnectionPool singleton ownership rework needed" \
  --base "HEAD~1" \
  --severity "critical" \
  --findings "$findings_path" \
  --executor-msg "$loop_dir/round-1.executor.log")

# The stdout marker the skill must surface verbatim
case "$esc_stdout" in
  "ESCALATED path=$loop_dir/escalation.md") pass "escalate stdout marker matches loop dir" ;;
  *) fail "escalate stdout marker (got: $esc_stdout)" ;;
esac

[[ -f "$loop_dir/escalation.md" ]] && pass "escalation.md present in loop dir" \
  || fail "escalation.md present in loop dir"
```

- [ ] **Step 2: Run — expect pass**

Run: `bin/test debug`
Expected: all assertions in `severity-filter`, `escalate`, and `loop-smoke` pass.

- [ ] **Step 3: Commit**

```bash
git add bin/tests/debug.sh
git commit -m "test(debug): skill loop smoke test (review + escalate sequence)"
```

---

### Task 11: Run the full test suite

- [ ] **Step 1: Run every suite**

Run: `bin/test`
Expected: all suites green (existing + the new `debug` suite).

- [ ] **Step 2: If any prior suite regressed, investigate and fix the regression — do NOT loosen the test.** Likely candidate: `run-wrapper.sh` / `task-prep.sh` if the heredoc reminder line appears in their stub output assertions.

- [ ] **Step 3: When clean, commit any fix in its own commit (one fix = one commit).**

---

## Self-review

**Spec coverage:**

- New `/debug` command → Task 9 ✓
- `--base`, `--full`, `--limit`, `--fixSeverity` flags → Task 9 (parsing) + Task 4 (severity filter) + Task 8 (skill resolves base + deadline) ✓
- Default `--fixSeverity medium` → Task 9 (command) + Task 8 (skill) ✓
- Default base = `HEAD~1` → Task 9 ✓
- Severity normalization (`important` → `high`, `minor` → `low`) → Task 4 ✓
- `--full` = empty-tree SHA → Task 8 (Iron Law 1) + Task 9 ✓
- Time-limit soft boundary → Task 8 (Iron Law 3) ✓
- Iron Laws on `task-executor` (verify findings + root cause / escalate) → Task 1 ✓
- Red Flags rows → Task 1 ✓
- Reminder line in existing postreview heredoc → Task 2 ✓
- Escalation audit trail under `${CLAUDE_PLUGIN_DATA}/debug/<run-id>/escalation.md` → Task 7 ✓
- User-facing line referencing audit-trail path → Task 8 (Iron Law 4 + summary template) ✓
- Tests covering filter + escalation + skill loop → Tasks 3, 6, 10 ✓

**Placeholder scan:** none.

**Type / signature consistency:**

- `pipeline-debug-review` flags: `--base, --severity, --out-dir, --round` — used identically in Tasks 4, 8, 10 ✓
- `pipeline-debug-escalate` flags: `--run-id, --reason, --base, --severity, --findings, --executor-msg` — identical in Tasks 7, 8, 10 ✓
- Stdout markers: `ESCALATED path=<abs>` (escalate) and JSON `{blocking_count,below_threshold_count,verdict,review_file}` (review) — matched in tests + skill ✓
- State path: `${CLAUDE_PLUGIN_DATA}/debug/<run-id>/` — consistent across spec, skill, escalate script ✓
