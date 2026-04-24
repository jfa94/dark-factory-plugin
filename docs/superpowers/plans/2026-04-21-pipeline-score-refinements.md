# Pipeline-Score Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix compliance math, split `skipped_ok`, fix PR-CI detection, add `T1_quota_checked`, renumber/rename per-task steps, drop redundant `T14`, add start/end time to header.

**Architecture:** Modify the deterministic analyzer in `bin/pipeline-score` and its evaluators in `bin/pipeline-score-steps.sh`. Update the backfill helper and the golden-fixture test. Add `task_id` to `quota.check` emissions from the pipeline runtime.

**Tech Stack:** bash, jq, gh, shunit-style tests in `bin/tests/`.

---

## File Structure

- `bin/pipeline-score-steps.sh` — evaluators, aggregator helper, new `_gh_pr_ci_color`, renderer, `_observability_json`. Largest diff.
- `bin/pipeline-score` — header rendering, score-schema bump, aggregator counters, compliance formula wiring.
- `tools/score-run-backfill.sh` — replace inline jq with `_gh_pr_ci_color`.
- `bin/pipeline-lib.sh` — quota gate emits `task_id` when invoked per-task.
- `bin/tests/score.sh` — assertions over new outcomes + new step IDs.
- `bin/tests/fixtures/score/outsidey-20260420/expected.json` — regenerated golden.
- `docs/superpowers/specs/2026-04-21-pipeline-score-refinements-design.md` — design (already written).

---

### Task 1: Header — add start / end / duration

**Why first:** smallest change; verifies local test loop works.

**Files:**

- Modify: `bin/pipeline-score-steps.sh:6-37` (`_render_table`)
- Modify: `bin/pipeline-score:134-156` (top-level `result` JSON)
- Modify: `bin/tests/score.sh` (add header assertion)

- [ ] **Step 1: Write the failing test**

In `bin/tests/score.sh`, after the existing fixture-based assertions, append:

```bash
test_header_includes_timestamps() {
  out=$(FAKE_GH=1 bin/pipeline-score \
    --run "$FIXTURE_RUN" --format table --no-gh --no-log)
  echo "$out" | grep -qE '^Started: [0-9TZ:-]+   Ended: [0-9TZ:-]+   Duration: ' \
    || { echo "FAIL: header missing timestamps"; echo "$out"; return 1; }
}
```

- [ ] **Step 2: Run and confirm fail**

Run: `bin/test score`
Expected: `FAIL: header missing timestamps`

- [ ] **Step 3: Thread start/end into the JSON**

In `bin/pipeline-score`, after the existing `plugin_version`/`mode`/`status` reads (around line 37), add:

```bash
started_at=$(printf '%s' "$state" | jq -r '.started_at // empty')
ended_at=$(printf '%s' "$state" | jq -r '.ended_at // empty')
```

Extend the top-level `result` jq invocation (line 134-156) with two new
`--arg` bindings and fields:

```bash
result=$(jq -n \
  --arg run_id "$run_id" \
  --arg plugin_version "$plugin_version" \
  --arg mode "$mode" \
  --arg status "$status" \
  --arg bucket "$bucket" \
  --arg started_at "$started_at" \
  --arg ended_at "$ended_at" \
  --argjson run_steps "$run_steps" \
  --argjson task_steps_aggregate "$task_steps_aggregate" \
  --argjson anomalies "$anomalies" \
  --argjson full_success "$full_success" \
  --argjson observability "$observability" \
  '{
    run_id: $run_id,
    plugin_version: $plugin_version,
    mode: $mode,
    status: $status,
    bucket: $bucket,
    started_at: (if $started_at == "" then null else $started_at end),
    ended_at:   (if $ended_at == "" then null else $ended_at end),
    run_steps: $run_steps,
    task_steps_aggregate: $task_steps_aggregate,
    anomalies: $anomalies,
    full_success: $full_success,
    observability: $observability
  }')
```

- [ ] **Step 4: Render start/end/duration in `_render_table`**

Replace the first `printf` in `_render_table` (line 17-18) so that after the
run-line it emits a second line with timestamps and computed duration. Add
after the existing `full=` assignment:

```bash
  local started_at ended_at
  started_at=$(printf '%s' "$json" | jq -r '.started_at // empty')
  ended_at=$(printf '%s'   "$json" | jq -r '.ended_at // empty')

  local duration="—"
  if [[ -n "$started_at" && -n "$ended_at" ]]; then
    local s e delta h m sec
    s=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$started_at" +%s 2>/dev/null || echo "")
    e=$(date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$ended_at"   +%s 2>/dev/null || echo "")
    if [[ -n "$s" && -n "$e" && "$e" -ge "$s" ]]; then
      delta=$((e - s))
      h=$((delta / 3600))
      m=$(( (delta % 3600) / 60 ))
      sec=$((delta % 60))
      duration=$(printf '%d:%02d:%02d' "$h" "$m" "$sec")
    fi
  fi

  printf "Run: %s   plugin-version: %s   mode: %s   status: %s   bucket: %s\n" \
    "$run_id" "$version" "$mode" "$status" "$bucket"
  printf "Started: %s   Ended: %s   Duration: %s\n" \
    "${started_at:-—}" "${ended_at:-—}" "$duration"
```

Remove the old single-line header printf.

- [ ] **Step 5: Run test, verify pass**

Run: `bin/test score`
Expected: all assertions pass (including the new one).

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh bin/tests/score.sh
git commit -m "feat(score): header shows start, end and duration"
```

---

### Task 2: `_gh_pr_ci_color` helper + callers

**Why:** current logic collapses {in-flight, StatusContext-only success, missing conclusion} into `red`. The helper must distinguish four outcomes: `green`, `red`, `pending`, `unknown`. Pending PRs (e.g., outsidey 99-102 — only a Snyk StatusContext reporting SUCCESS, but required workflow checks never ran) must not be recorded as `red` in `task.ci` events.

**Files:**

- Modify: `bin/pipeline-score-steps.sh` — add helper; replace inline logic in `eval_R10_rollup_ci_green` and `eval_T11_pr_ci_green`.
- Modify: `tools/score-run-backfill.sh:78` — call helper and skip emit when pending/unknown.
- Modify: `bin/tests/score.sh` — regression tests covering all four outcomes.

- [ ] **Step 1: Write the failing tests**

Add to `bin/tests/score.sh`:

```bash
test_gh_pr_ci_color_all_outcomes() {
  # 1. Single StatusContext SUCCESS → green.
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"__typename":"StatusContext","state":"SUCCESS","conclusion":null}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "green" ]] || { echo "FAIL (SUCCESS StatusContext): got $out"; return 1; }

  # 2. CheckRun FAILURE → red.
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"__typename":"CheckRun","status":"COMPLETED","conclusion":"FAILURE"}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "red" ]] || { echo "FAIL (FAILURE CheckRun): got $out"; return 1; }

  # 3. CheckRun in progress (status=IN_PROGRESS, conclusion=null) → pending.
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":null}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "pending" ]] || { echo "FAIL (IN_PROGRESS): got $out"; return 1; }

  # 4. StatusContext PENDING → pending.
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"__typename":"StatusContext","state":"PENDING","conclusion":null}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "pending" ]] || { echo "FAIL (StatusContext PENDING): got $out"; return 1; }

  # 5. Mixed success + in-flight → pending (not yet green).
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"__typename":"StatusContext","state":"SUCCESS","conclusion":null},{"__typename":"CheckRun","status":"IN_PROGRESS","conclusion":null}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "pending" ]] || { echo "FAIL (mixed success+in-flight): got $out"; return 1; }

  # 6. Mixed success + failure → red (failure wins).
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[{"conclusion":"SUCCESS"},{"conclusion":"FAILURE"}]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "red" ]] || { echo "FAIL (mixed success+failure): got $out"; return 1; }

  # 7. Empty rollup → unknown.
  out=$(_FAKE_PR_VIEW='{"statusCheckRollup":[]}' \
    bash -c 'source bin/pipeline-score-steps.sh; _gh_pr_ci_color 42')
  [[ "$out" == "unknown" ]] || { echo "FAIL (empty): got $out"; return 1; }
}
```

- [ ] **Step 2: Run to confirm fail**

Run: `bin/test score`
Expected: `_gh_pr_ci_color: command not found` (or test failure).

- [ ] **Step 3: Add `_gh_pr_ci_color` helper**

Prepend to `bin/pipeline-score-steps.sh` after `_render_table`:

```bash
_gh_pr_ci_color() {
  local pr="$1" payload
  if [[ -n "${_FAKE_PR_VIEW:-}" ]]; then
    payload="$_FAKE_PR_VIEW"
  else
    payload=$(gh pr view "$pr" --json statusCheckRollup 2>/dev/null) || {
      echo "unknown"; return
    }
  fi
  printf '%s' "$payload" | jq -r '
    # Classify one rollup entry into pass | fail | pending | unknown.
    def classify:
      (.status // "" | ascii_upcase) as $st |
      (.state  // "" | ascii_upcase) as $se |
      (.conclusion // "" | ascii_upcase) as $c |
      if ($st == "QUEUED" or $st == "IN_PROGRESS" or $st == "WAITING" or $st == "PENDING"
          or $se == "PENDING" or $se == "EXPECTED"
          or ($st == "COMPLETED" and $c == "")) then "pending"
      else
        (if $c != "" then $c else $se end) as $o |
        if ["SUCCESS","SKIPPED","NEUTRAL"] | index($o) then "pass"
        elif ["FAILURE","TIMED_OUT","CANCELLED","STARTUP_FAILURE","ACTION_REQUIRED","ERROR"] | index($o) then "fail"
        else "unknown"
        end
      end;
    (.statusCheckRollup // []) as $r |
    if ($r | length) == 0 then "unknown"
    else
      ($r | map(classify)) as $cls |
      if   ($cls | any(. == "fail"))    then "red"
      elif ($cls | any(. == "pending")) then "pending"
      elif ($cls | all(. == "pass"))    then "green"
      else "unknown"
      end
    end'
}
```

- [ ] **Step 4: Replace inline jq in `eval_R10_final_pr_ci_green`**

In `bin/pipeline-score-steps.sh`, replace the `gh pr view ...` block
(around lines 145-155) with:

```bash
  if [[ "${use_gh:-true}" == "true" ]]; then
    local color
    color=$(_gh_pr_ci_color "$pr")
    case "$color" in
      green)   echo "pass" ;;
      red)     echo "fail" ;;
      pending) echo "not_performed" ;;
      *)       echo "not_performed" ;;
    esac
  else
    echo "not_performed"
  fi
```

- [ ] **Step 5: Replace inline jq in `eval_T11_pr_ci_green`**

Replace the `gh pr view ...` block (around lines 291-301) with:

```bash
  if [[ "${use_gh:-true}" == "true" ]]; then
    local color
    color=$(_gh_pr_ci_color "$pr")
    case "$color" in
      green)   echo "pass" ;;
      red)     echo "fail" ;;
      pending) echo "not_performed" ;;
      *)       echo "not_performed" ;;
    esac
  else
    echo "not_performed"
  fi
```

- [ ] **Step 6: Replace jq in `tools/score-run-backfill.sh` and skip emit on pending/unknown**

Source the helper once at the top of the script, after `set -euo pipefail`:

```bash
source "$(cd "$(dirname "$0")/.." && pwd)/bin/pipeline-score-steps.sh"
```

Replace the block around line 78 that currently reads the `gh pr view ...`
conclusion and always emits a `task.ci` event:

```bash
    color=$(_gh_pr_ci_color "$pr")
    case "$color" in
      green|red)
        ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
        printf '{"ts":"%s","run_id":"%s","event":"task.ci","pr_number":%s,"status":"%s","backfilled":true}\n' \
          "$ts" "$run_id" "$pr" "$color" >> "$run_dir/metrics.jsonl"
        echo "Backfilled task $t → PR $pr ($color)"
        ;;
      pending|unknown)
        echo "Skipped task $t → PR $pr (ci $color, no terminal state)"
        ;;
    esac
```

Rationale: writing a synthetic `task.ci` event with `status: "red"` for a
pending PR corrupts the metrics log. No emit = scorer reads no terminal
evidence = evaluator returns `not_performed`. When CI eventually resolves,
a subsequent backfill run will emit the real terminal event.

- [ ] **Step 7: Re-run the backfill on the outsidey run, re-score**

Run:

```bash
tools/score-run-backfill.sh --run run-20260420-141621
bin/pipeline-score --run run-20260420-141621 --format table --no-log | head -30
```

Expected:

- Console output from backfill shows `Skipped task ... (ci pending, no terminal state)` for PRs 99-102 (and any other still-pending PR).
- `T12_pr_ci_green` (after renumber) / `T11_pr_ci_green` (now) no longer
  shows `0 pass / 17 fail`; the pending PRs drop into `not_performed`
  instead of `fail`.
- Any PR whose rollup is genuinely `red` (failed required check) still
  lands in `fail`.

- [ ] **Step 8: Run the test suite**

Run: `bin/test score`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add bin/pipeline-score-steps.sh tools/score-run-backfill.sh bin/tests/score.sh
git commit -m "fix(score): classify PR CI as green/red/pending/unknown; skip backfill emit for pending"
```

---

### Task 3: Split `skipped_ok` into `skipped_na` and `skipped_task_inactive`

**Why:** more faithful signal — distinguishes "design says don't run" from "pipeline never got there."

**Files:**

- Modify: `bin/pipeline-score-steps.sh` — update evaluators to emit the finer-grained values.
- Modify: `bin/pipeline-score` — aggregator switch, JSON shape, schema bump.
- Modify: `bin/tests/score.sh` — assertions over the new keys.
- Modify: `bin/tests/fixtures/score/outsidey-20260420/expected.json` — regenerate after code lands.

- [ ] **Step 1: Update `_aggregate_step` counters**

In `bin/pipeline-score:77-91`, extend the aggregator to five buckets:

```bash
_aggregate_step() {
  local id="$1" fn="$2"
  local p=0 f=0 sna=0 sti=0 np=0
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    local r; r=$($fn "$t")
    case "$r" in
      pass)                   p=$((p+1)) ;;
      fail)                   f=$((f+1)) ;;
      skipped_na)             sna=$((sna+1)) ;;
      skipped_task_inactive)  sti=$((sti+1)) ;;
      not_performed)          np=$((np+1)) ;;
    esac
  done < <(_task_ids)
  jq -n --arg id "$id" \
        --argjson p "$p" --argjson f "$f" \
        --argjson sna "$sna" --argjson sti "$sti" \
        --argjson np "$np" \
    '{id: $id, pass: $p, fail: $f,
      skipped_na: $sna, skipped_task_inactive: $sti,
      not_performed: $np}'
}
```

- [ ] **Step 2: Update run-step shape (keep backward-compatible fallback)**

Run-level steps do not aggregate; `_score_run_step` still emits
`{id, label, state}`. Only change: allow `state` to be any of
`pass | fail | skipped_na | skipped_task_inactive | not_performed`.
(`skipped_task_inactive` is never returned by run-level steps; fine.)

No code change in `_score_run_step` itself. Skip.

- [ ] **Step 3: Update every evaluator that returns `skipped_ok`**

Rename every `echo "skipped_ok"` in `bin/pipeline-score-steps.sh`:

- Mode / precondition skips → `skipped_na`:
  - `eval_R2_spec_generated` (task mode)
  - `eval_R3_spec_reviewer_approved` (task mode)
  - `eval_R7_scribe_ran` (tasks not all done)
  - `eval_R8_final_pr_opened` (tasks not all done)
  - `eval_R9_final_pr_merged` (no PR)
  - `eval_R10_final_pr_ci_green` (no PR)
  - `eval_T6_holdout_pass` (no fixture)
  - `eval_T7_mutation_pass` (risk_tier not feature/security)
  - `eval_T10_pr_created` (task status not reviewing/done/ci_fixing)
  - `eval_T11_pr_ci_green` (no PR)
  - `eval_T12_pr_merged` (no PR)

- Task never reached executing → `skipped_task_inactive`:
  - `_quality_check_step` (used by `T2-T4`)
  - `eval_T5_coverage_non_regress`
  - `eval_T6_holdout_pass` (first branch, `!_task_reached_executing`)
  - `eval_T7_mutation_pass` (first branch)
  - `eval_T8_reviewer_approved_first_round`
  - `eval_T9_reviewer_approved_overall`
  - `eval_T13_no_fix_loop_exhaustion` (about to be renamed in Task 5)

Each evaluator's ordering of branches is already correct — mode/precondition
checks come before the `_task_reached_executing` check, so the narrower
values win.

Full replacement text for one representative evaluator
(`_quality_check_step`):

```bash
_quality_check_step() {
  local t="$1" cmd="$2"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  local s; s=$(_quality_check_status "$t" "$cmd")
  case "$s" in
    passed) echo "pass" ;;
    failed) echo "fail" ;;
    *)      echo "not_performed" ;;
  esac
}
```

Apply the same pattern everywhere listed.

- [ ] **Step 4: Bump score schema**

In `bin/pipeline-score`, extend the top-level result jq call with:

```bash
  --argjson score_schema 2 \
  ...
  '{
    score_schema: $score_schema,
    run_id: $run_id,
    ...
  }'
```

(Add to the existing block; keep other fields unchanged.)

- [ ] **Step 5: Update `_render_table` aggregate row**

Replace the per-task aggregate rendering in `bin/pipeline-score-steps.sh`
(lines 22-28) with a 6-column table:

```bash
  printf "\nPER-TASK STEPS (aggregate)\n"
  printf "  %-35s  %5s  %5s  %7s  %10s  %8s  %s\n" \
    "step" "pass" "fail" "skip_na" "skip_inact" "not_perf" "compliance"
  printf '%s' "$json" | jq -r '.task_steps_aggregate | to_entries[] |
    .key as $k |
    .value as $v |
    (($v.pass) as $p | ($v.fail) as $f |
     ($v.not_performed) as $np | ($v.skipped_task_inactive) as $sti |
     ($p + $f + $np + $sti) as $denom |
     (if $denom == 0 then "--" else (($p * 100 / $denom) | floor | tostring + "%") end) as $pct |
     "  \(($k + (" " * 35))[0:35])  \(($p | tostring) + (" " * (5 - ($p | tostring | length))))  \(($f | tostring) + (" " * (5 - ($f | tostring | length))))  \(($v.skipped_na | tostring) + (" " * (7 - ($v.skipped_na | tostring | length))))  \(($sti | tostring) + (" " * (10 - ($sti | tostring | length))))  \(($np | tostring) + (" " * (8 - ($np | tostring | length))))  \($pct)")'
```

Compliance denominator is now `pass + fail + not_performed +
skipped_task_inactive` — per D1/D2 of the design.

- [ ] **Step 6: Update run-step table rendering**

Run-level steps still render as `state  label` pairs (line 20). No change
needed aside from the `skipped_ok` → `skipped_na` text change in the state
column. Run:

```bash
jq -r '.run_steps | to_entries[] | "  \(.value.state | (. + "                       ")[0:22])  \(.key)"'
```

Widen the padding from 12 chars to 22 to fit `skipped_task_inactive`.

- [ ] **Step 7: Update full_success computation**

In `bin/pipeline-score:121-130`, replace:

```bash
full_success=$(jq -n \
  --argjson rs "$run_steps" \
  --argjson ts "$task_steps_aggregate" \
  '
    def all_run_pass:
      [ .[] | select(.state != "pass" and .state != "skipped_na") ] | length == 0;
    def all_task_clean:
      [ .[] | select(.fail > 0 or .not_performed > 0 or .skipped_task_inactive > 0) ] | length == 0;
    ($rs | all_run_pass) and ($ts | all_task_clean)
  ')
```

- [ ] **Step 8: Update anomaly count**

Replace in `bin/pipeline-score:110-119`:

```bash
anomalies=$(jq -n \
  --argjson rs "$run_steps" \
  --argjson ts "$task_steps_aggregate" \
  '
    def count_run:
      [ .[] | select(.state == "not_performed") ] | length;
    def count_tasks:
      [ .[] | (.not_performed + .skipped_task_inactive) ] | add // 0;
    ($rs | count_run) + ($ts | count_tasks)
  ')
```

- [ ] **Step 9: Run tests (expect failures until fixture regenerated)**

Run: `bin/test score`
Expected: fixture-comparison failures flagging the new keys. That's fine
for this step.

- [ ] **Step 10: Regenerate the golden fixture**

```bash
bin/pipeline-score --run "$FIXTURE_RUN" --no-gh --no-log > \
  bin/tests/fixtures/score/outsidey-20260420/expected.json
```

Inspect the diff — new keys `skipped_na`, `skipped_task_inactive`,
`score_schema: 2`, `started_at`, `ended_at`. Commit this diff in the next
step.

- [ ] **Step 11: Run tests again**

Run: `bin/test score`
Expected: all assertions pass.

- [ ] **Step 12: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh \
        bin/tests/score.sh bin/tests/fixtures/score/outsidey-20260420/expected.json
git commit -m "feat(score): split skipped_ok, count not_performed in compliance, schema v2"
```

---

### Task 4: Renumber T1→T13 and drop old T14

**Why:** make room for the new quota step at `T1` and remove a redundant
final-status step.

**Files:**

- Modify: `bin/pipeline-score-steps.sh` — rename evaluator functions.
- Modify: `bin/pipeline-score` — `_aggregate_step` call list + final jq
  object.
- Modify: `bin/tests/score.sh` — step-ID assertions.
- Modify: `bin/tests/fixtures/score/outsidey-20260420/expected.json` — new
  key names.

- [ ] **Step 1: Rename evaluator functions**

Rename in `bin/pipeline-score-steps.sh`:

| Old symbol                              | New symbol                              |
| --------------------------------------- | --------------------------------------- |
| `eval_T1_executor_spawned`              | `eval_T2_executor_spawned`              |
| `eval_T2_lint_pass`                     | `eval_T3_lint_pass`                     |
| `eval_T3_typecheck_pass`                | `eval_T4_typecheck_pass`                |
| `eval_T4_tests_pass`                    | `eval_T5_tests_pass`                    |
| `eval_T5_coverage_non_regress`          | `eval_T6_coverage_non_regress`          |
| `eval_T6_holdout_pass`                  | `eval_T7_holdout_pass`                  |
| `eval_T7_mutation_pass`                 | `eval_T8_mutation_pass`                 |
| `eval_T8_reviewer_approved_first_round` | `eval_T9_reviewer_approved_first_round` |
| `eval_T9_reviewer_approved_overall`     | `eval_T10_reviewer_approved_overall`    |
| `eval_T10_pr_created`                   | `eval_T11_pr_created`                   |
| `eval_T11_pr_ci_green`                  | `eval_T12_pr_ci_green`                  |
| `eval_T12_pr_merged`                    | `eval_T13_pr_merged`                    |
| `eval_T13_no_fix_loop_exhaustion`       | `eval_T14_within_retry_budget`          |
| `eval_T14_terminal_status_done`         | (delete entirely)                       |

(Leave the new-T1 evaluator empty; Task 5 adds it.)

- [ ] **Step 2: Rewrite `task_steps_aggregate` wiring**

In `bin/pipeline-score:93-108`, replace the entire block with:

```bash
task_steps_aggregate=$(jq -n \
  --argjson T2 "$(_aggregate_step T2_executor_spawned              eval_T2_executor_spawned)" \
  --argjson T3 "$(_aggregate_step T3_lint_pass                     eval_T3_lint_pass)" \
  --argjson T4 "$(_aggregate_step T4_typecheck_pass                eval_T4_typecheck_pass)" \
  --argjson T5 "$(_aggregate_step T5_tests_pass                    eval_T5_tests_pass)" \
  --argjson T6 "$(_aggregate_step T6_coverage_non_regress          eval_T6_coverage_non_regress)" \
  --argjson T7 "$(_aggregate_step T7_holdout_pass                  eval_T7_holdout_pass)" \
  --argjson T8 "$(_aggregate_step T8_mutation_pass                 eval_T8_mutation_pass)" \
  --argjson T9 "$(_aggregate_step T9_reviewer_approved_first_round eval_T9_reviewer_approved_first_round)" \
  --argjson T10 "$(_aggregate_step T10_reviewer_approved_overall   eval_T10_reviewer_approved_overall)" \
  --argjson T11 "$(_aggregate_step T11_pr_created                  eval_T11_pr_created)" \
  --argjson T12 "$(_aggregate_step T12_pr_ci_green                 eval_T12_pr_ci_green)" \
  --argjson T13 "$(_aggregate_step T13_pr_merged                   eval_T13_pr_merged)" \
  --argjson T14 "$(_aggregate_step T14_within_retry_budget         eval_T14_within_retry_budget)" \
  '{T2_executor_spawned:$T2, T3_lint_pass:$T3, T4_typecheck_pass:$T4,
    T5_tests_pass:$T5, T6_coverage_non_regress:$T6, T7_holdout_pass:$T7,
    T8_mutation_pass:$T8, T9_reviewer_approved_first_round:$T9,
    T10_reviewer_approved_overall:$T10, T11_pr_created:$T11,
    T12_pr_ci_green:$T12, T13_pr_merged:$T13, T14_within_retry_budget:$T14}')
```

(T1 added in Task 5.)

- [ ] **Step 3: Update test step-ID assertions**

In `bin/tests/score.sh`, wherever test bodies grep for old step IDs, update
to new. Search & replace (manually verify per occurrence):

- `T1_executor_spawned` → `T2_executor_spawned`
- `T2_lint_pass` → `T3_lint_pass`
- …continuing through the table above…
- Any assertion targeting `T14_terminal_status_done` — delete it.

- [ ] **Step 4: Regenerate fixture**

```bash
bin/pipeline-score --run "$FIXTURE_RUN" --no-gh --no-log > \
  bin/tests/fixtures/score/outsidey-20260420/expected.json
```

- [ ] **Step 5: Run tests**

Run: `bin/test score`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add bin/pipeline-score bin/pipeline-score-steps.sh \
        bin/tests/score.sh bin/tests/fixtures/score/outsidey-20260420/expected.json
git commit -m "refactor(score): renumber T1-T13, drop redundant T14, rename retry-budget step"
```

---

### Task 5: New `T1_quota_checked` step + pipeline-side `task_id` emission

**Why:** promotes quota check from observability-only to a first-class gate.

**Files:**

- Modify: `bin/pipeline-lib.sh` (or wherever `quota.check` is emitted) — add `task_id` to the event payload when invoked per-task.
- Modify: `bin/pipeline-score-steps.sh` — add `eval_T1_quota_checked`.
- Modify: `bin/pipeline-score` — wire T1 into `task_steps_aggregate`.
- Modify: `bin/tests/score.sh` — fixtures + assertion for the new step.
- Add: `bin/tests/fixtures/score/outsidey-20260420/expected.json` — regenerate.

- [ ] **Step 1: Locate the quota-check emit site**

Run: `rg -n '"event":"quota.check"' bin/`
Expected: one or more hits; record file:line.

- [ ] **Step 2: Write the failing evaluator test**

Add to `bin/tests/score.sh`:

```bash
test_T1_quota_checked_pass_when_event_precedes_task_start() {
  local scratch; scratch=$(mktemp -d)
  mkdir -p "$scratch/runs/run-fake"
  cat > "$scratch/runs/run-fake/state.json" <<'JSON'
{
  "version":"9.9.9","mode":"task","status":"done",
  "started_at":"2026-04-21T00:00:00Z","ended_at":"2026-04-21T00:10:00Z",
  "tasks":{"t-1":{"status":"done","worktree":"/tmp/wt"}}
}
JSON
  cat > "$scratch/runs/run-fake/metrics.jsonl" <<'M'
{"ts":"2026-04-21T00:00:10Z","event":"quota.check","task_id":"t-1","used_pct":42}
{"ts":"2026-04-21T00:00:20Z","event":"task.start","task_id":"t-1"}
M
  : > "$scratch/runs/run-fake/audit.jsonl"

  out=$(CLAUDE_PLUGIN_DATA="$scratch" bin/pipeline-score --run run-fake --no-gh --no-log)
  v=$(echo "$out" | jq -r '.task_steps_aggregate.T1_quota_checked.pass')
  [[ "$v" == "1" ]] || { echo "FAIL: expected T1 pass=1, got $v"; return 1; }
}

test_T1_quota_checked_fail_when_no_event() {
  local scratch; scratch=$(mktemp -d)
  mkdir -p "$scratch/runs/run-fake"
  cat > "$scratch/runs/run-fake/state.json" <<'JSON'
{
  "version":"9.9.9","mode":"task","status":"done",
  "started_at":"2026-04-21T00:00:00Z","ended_at":"2026-04-21T00:10:00Z",
  "tasks":{"t-1":{"status":"done","worktree":"/tmp/wt"}}
}
JSON
  cat > "$scratch/runs/run-fake/metrics.jsonl" <<'M'
{"ts":"2026-04-21T00:00:20Z","event":"task.start","task_id":"t-1"}
M
  : > "$scratch/runs/run-fake/audit.jsonl"

  out=$(CLAUDE_PLUGIN_DATA="$scratch" bin/pipeline-score --run run-fake --no-gh --no-log)
  v=$(echo "$out" | jq -r '.task_steps_aggregate.T1_quota_checked.fail')
  [[ "$v" == "1" ]] || { echo "FAIL: expected T1 fail=1, got $v"; return 1; }
}
```

- [ ] **Step 3: Run — confirm fail**

Run: `bin/test score`
Expected: test reports `T1_quota_checked` not present (null).

- [ ] **Step 4: Implement evaluator**

Add to `bin/pipeline-score-steps.sh`:

```bash
eval_T1_quota_checked() {
  local t="$1"
  if ! _task_reached_executing "$t"; then echo "skipped_task_inactive"; return; fi
  [[ -f "$metrics_file" ]] || { echo "fail"; return; }
  # earliest task.start timestamp for this task
  local start_ts check_ts
  start_ts=$(grep '"event":"task.start"' "$metrics_file" 2>/dev/null \
    | jq -cr --arg t "$t" 'select(.task_id == $t) | .ts' | head -1)
  check_ts=$(grep '"event":"quota.check"' "$metrics_file" 2>/dev/null \
    | jq -cr --arg t "$t" 'select(.task_id == $t) | .ts' | head -1)
  if [[ -n "$check_ts" && ( -z "$start_ts" || "$check_ts" < "$start_ts" ) ]]; then
    echo "pass"
  else
    echo "fail"
  fi
}
```

(ISO-8601 strings are lexicographically ordered when zero-padded and UTC —
safe for this comparison.)

- [ ] **Step 5: Wire T1 into the aggregate**

In `bin/pipeline-score`, extend the `task_steps_aggregate` jq call (the one
from Task 4 Step 2):

```bash
  --argjson T1 "$(_aggregate_step T1_quota_checked eval_T1_quota_checked)" \
```

Add `T1_quota_checked: $T1,` as the first field of the final object.

- [ ] **Step 6: Emit `task_id` in pipeline `quota.check` events**

Locate the emit site(s) from Step 1. For each per-task invocation, append
`task_id` to the payload. Example pattern (inside the relevant emit
helper):

```bash
printf '{"ts":"%s","run_id":"%s","event":"quota.check","task_id":"%s","used_pct":%s}\n' \
  "$ts" "$run_id" "$task_id" "$used_pct" >> "$metrics_file"
```

Run-start quota checks that lack a `task_id` continue to emit no such field
and are invisible to T1 — desired.

- [ ] **Step 7: Regenerate fixture**

```bash
bin/pipeline-score --run "$FIXTURE_RUN" --no-gh --no-log > \
  bin/tests/fixtures/score/outsidey-20260420/expected.json
```

Note: the historical outsidey run won't have `task_id` on its quota.check
events, so T1 will show `fail` for all tasks that did execute — expected.

- [ ] **Step 8: Run tests, confirm pass**

Run: `bin/test score`
Expected: all assertions pass.

- [ ] **Step 9: Commit**

```bash
git add bin/pipeline-lib.sh bin/pipeline-score bin/pipeline-score-steps.sh \
        bin/tests/score.sh bin/tests/fixtures/score/outsidey-20260420/expected.json
git commit -m "feat(score): add T1_quota_checked step + per-task quota.check task_id"
```

---

### Task 6: End-to-end verification on the outsidey run

**Why:** confirms the whole pipeline of fixes works against the real run
that surfaced the bugs.

- [ ] **Step 1: Re-run backfill**

```bash
tools/score-run-backfill.sh --run run-20260420-141621
```

Expected: backfill re-emits `task.ci` events only for PRs whose rollup
reaches a terminal state (`green`/`red`). Pending PRs (99-102 and any
other with unresolved required checks) print `Skipped task ... (ci
pending, no terminal state)` and produce no new event.

Note: old backfill already wrote `status: "red"` entries for these PRs
into `metrics.jsonl`. Those stale events remain unless purged. For a
clean verification, first strip `"backfilled":true` entries from the
metrics file:

```bash
run_dir="$HOME/.claude/plugins/data/factory-jfa94/runs/run-20260420-141621"
grep -v '"backfilled":true' "$run_dir/metrics.jsonl" > "$run_dir/metrics.jsonl.tmp"
mv "$run_dir/metrics.jsonl.tmp" "$run_dir/metrics.jsonl"
tools/score-run-backfill.sh --run run-20260420-141621
```

- [ ] **Step 2: Re-score**

```bash
bin/pipeline-score --run run-20260420-141621 --format table --no-log
```

Expected:

- Header line 2 shows `Started: 2026-04-20T14:16:21Z   Ended: 2026-04-21T05:49:15Z   Duration: 15:32:54` (or similar).
- `T12_pr_ci_green` — PRs whose CI genuinely failed land in `fail`; PRs
  still pending (99-102, etc.) land in `not_performed`; any PR with true
  all-success rollup lands in `pass`. Prior 17-fail verdict gone.
- `T1_quota_checked` shows mostly `fail` (historical events lack `task_id`).
- Compliance percentages are <100 % on any step with `not_performed` or
  `skipped_task_inactive`.

- [ ] **Step 3: Record the output in the plan dir**

```bash
bin/pipeline-score --run run-20260420-141621 --format table --no-log \
  > docs/superpowers/plans/2026-04-21-pipeline-score-refinements.verification.txt
git add docs/superpowers/plans/2026-04-21-pipeline-score-refinements.verification.txt
git commit -m "docs(score): capture post-refinement score of outsidey run"
```

---

## Unresolved Questions

- None — all decisions captured in the design doc.

## Self-Review

- [x] Spec coverage: every design decision (D1-D7) maps to one or more tasks.
- [x] No placeholders.
- [x] Type consistency: evaluator return set is `pass | fail | skipped_na | skipped_task_inactive | not_performed` across all evaluators. Aggregator counters match. Compliance denominator consistent in `_render_table` and `full_success`.
