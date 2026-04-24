# Plan 07 — Orchestrator Prompt & Review Flow

**Priority:** P1 (major — task-executors can't see prior work, review verdicts are misparsed, quality gates are manual)
**Tasks:** `task_07_01` through `task_07_04`
**Findings:** M16, M17, M18, M19

## Problem

Four flow bugs in the orchestrator and prompt-building path:

1. **M16 — Prior-work directory not passed to task-executors.** When the orchestrator resumes a task that was partially completed in a previous session, it does not pass the prior worktree path to the task-executor agent. The executor starts from scratch and has no visibility into the branch state, previously written files, or prior reviewer feedback.

2. **M17 — `pipeline-parse-review` has no verdict anchor.** The parser greps the review markdown for `APPROVE`, `REQUEST_CHANGES`, or `NEEDS_DISCUSSION`. Any mention of those words in the review body (e.g. "I would not approve this approach") falsely matches. The old pipeline anchors on a structured verdict block (`## Verdict\nAPPROVE`).

3. **M18 — Quality gates are invoked manually in orchestrator.md.** The orchestrator's execution loop describes "run pnpm quality" in prose. There's no script that actually runs the project's quality commands + interprets the result + writes the outcome to state. Every orchestrator invocation has to re-implement this in natural language.

4. **M19 — orchestrator.md execution loop is not concrete enough.** The "Execution Sequence" section mixes prose with script calls and lacks explicit success/failure branching. An LLM reading it has to infer the flow. The old pipeline had a single executable bash function as the control loop.

## Scope

In:

- Record prior-work path into state when a task is paused mid-execution
- Pass prior-work path through `pipeline-build-prompt` into the task-executor prompt
- Introduce a structured verdict block parsed by `pipeline-parse-review` (M17)
- Create `bin/pipeline-quality-gate` that runs the project's quality commands and writes a structured result
- Tighten `agents/pipeline-orchestrator.md` execution loop with explicit branching

Out: parallel execution mechanics (covered by the existing follow-up plan referenced in `/Users/Javier/.claude/plans/cheerful-launching-river.md`).

## Tasks

| task_id    | Title                                              |
| ---------- | -------------------------------------------------- |
| task_07_01 | Record & pass prior-work dir through build-prompt  |
| task_07_02 | Anchor verdict block in review template and parser |
| task_07_03 | Create `pipeline-quality-gate` script              |
| task_07_04 | Rewrite orchestrator.md execution loop for clarity |

## Execution Guidance

### task_07_01 — Prior-work handoff

Files: `bin/pipeline-state`, `bin/pipeline-build-prompt`, `agents/pipeline-orchestrator.md`

When a task is interrupted (session ends, rate limit, crash), the orchestrator should record:

```bash
pipeline-state write "$run_id" ".tasks.$task_id.prior_work_dir" "$worktree_path"
pipeline-state write "$run_id" ".tasks.$task_id.prior_branch" "task/$task_id"
pipeline-state write "$run_id" ".tasks.$task_id.prior_commit" "$(git -C $worktree_path rev-parse HEAD)"
```

`pipeline-build-prompt` should read these on resume and include them in the prompt body:

```markdown
## Resume Context

This task was previously started in worktree: $prior_work_dir
Branch: $prior_branch
Last commit on that branch: $prior_commit

Before starting new work:

1. `git fetch origin $prior_branch`
2. `git checkout $prior_branch` (or create a new worktree from it)
3. Review what was previously written — look at `git log`, `git diff main..HEAD`
4. Only make NEW changes or corrections — do not redo completed work
```

If no prior-work fields exist in state (fresh task), `pipeline-build-prompt` omits the section entirely.

Test in `bin/test-phase3.sh`:

1. State with `prior_work_dir`, `prior_branch`, `prior_commit` set → `pipeline-build-prompt` output contains `## Resume Context` block with those values.
2. State with no prior-work fields → output has no `## Resume Context` block.
3. Prior-work fields contain special chars (`$`, `"`, newlines) — output is properly escaped, no shell injection.

### task_07_02 — Verdict anchor

Files: `bin/pipeline-parse-review`, `agents/implementation-reviewer.md`, `agents/quality-reviewer.md`

The reviewer agent should emit verdicts in a structured block at the end of its response:

```markdown
## Verdict

VERDICT: APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION
CONFIDENCE: HIGH|MEDIUM|LOW
BLOCKERS: <count>
```

Update `agents/implementation-reviewer.md` and `agents/quality-reviewer.md` (from plan 01 addendum) with an explicit "Output Format" section demanding this block as the final lines.

`bin/pipeline-parse-review` should extract only from this anchored block:

```bash
parse_verdict() {
  local review_file="$1"

  # Extract the Verdict section (everything after "## Verdict" marker)
  local verdict_section
  verdict_section=$(awk '/^## Verdict$/{flag=1; next} /^## /{flag=0} flag' "$review_file")

  if [[ -z "$verdict_section" ]]; then
    echo '{"error":"no_verdict_block"}'
    return 1
  fi

  local verdict confidence blockers
  verdict=$(echo "$verdict_section" | awk -F: '/^VERDICT:/{gsub(/ /,"",$2); print $2; exit}')
  confidence=$(echo "$verdict_section" | awk -F: '/^CONFIDENCE:/{gsub(/ /,"",$2); print $2; exit}')
  blockers=$(echo "$verdict_section" | awk -F: '/^BLOCKERS:/{gsub(/ /,"",$2); print $2; exit}')

  # Validate
  case "$verdict" in
    APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION) ;;
    *) echo '{"error":"invalid_verdict","got":"'"$verdict"'"}'; return 1 ;;
  esac

  jq -n --arg v "$verdict" --arg c "$confidence" --argjson b "${blockers:-0}" \
    '{verdict:$v, confidence:$c, blockers:$b}'
}
```

Key: parse ONLY the `## Verdict` block, not the whole review body. This eliminates false positives from prose.

Test in `bin/test-phase6.sh`:

1. Review with "I do not approve of this naming" in the body + `## Verdict\nVERDICT: APPROVE` at end → parser returns `APPROVE` (not `REQUEST_CHANGES` from prose).
2. Review missing `## Verdict` block entirely → `{"error":"no_verdict_block"}`.
3. Review with `VERDICT: MAYBE` (invalid) → `{"error":"invalid_verdict","got":"MAYBE"}`.
4. Review with valid block, `BLOCKERS: 3` → output contains `blockers:3`.

### task_07_03 — `pipeline-quality-gate` script

File: `bin/pipeline-quality-gate` (NEW)

A unified entry point that runs the project's quality commands and writes the result to state.

```bash
#!/usr/bin/env bash
set -euo pipefail

run_id="$1"
task_id="$2"
worktree="${3:-$PWD}"

pkg_mgr=$(pipeline-detect-pkg-manager 2>/dev/null || echo npm)
cd "$worktree"

# Discover quality commands — prefer dark-factory.quality array from package.json
# but fall back to standard pnpm/npm commands.
commands=$(jq -r '
  .["dark-factory"].quality // ["lint","typecheck","test"]
  | .[]
' package.json 2>/dev/null || printf 'lint\ntypecheck\ntest\n')

results=()
overall_ok=true

while IFS= read -r cmd; do
  [[ -z "$cmd" ]] && continue

  start=$(date +%s)
  if "$pkg_mgr" run "$cmd" > ".state/$run_id/$task_id.$cmd.log" 2>&1; then
    status="passed"
  else
    status="failed"
    overall_ok=false
  fi
  duration=$(( $(date +%s) - start ))

  results+=("$(jq -n --arg c "$cmd" --arg s "$status" --argjson d "$duration" \
    '{command:$c, status:$s, duration_s:$d}')")
done <<< "$commands"

summary=$(jq -n --argjson results "$(printf '%s\n' "${results[@]}" | jq -s .)" \
  --arg ok "$overall_ok" \
  '{ok: ($ok == "true"), checks: $results}')

pipeline-state write "$run_id" ".tasks.$task_id.quality_gate" "$summary"

if [[ "$overall_ok" == "true" ]]; then
  echo "$summary"
  exit 0
else
  echo "$summary"
  exit 1
fi
```

Notes:

- Never hardcode `pnpm`. The detector (from plan 05) picks the right package manager.
- Log files per-check go in the state directory so reviewers can inspect failures without re-running.
- The `dark-factory.quality` override in `package.json` lets projects customize the quality set. Default is `[lint, typecheck, test]`.
- Exit code mirrors overall status so callers can branch on it.

Test in `bin/test-phase6.sh` (or a new test file):

1. Fixture package.json with `scripts.lint`, `scripts.typecheck`, `scripts.test` all passing → exit 0, state has `quality_gate.ok=true`.
2. Fixture with `scripts.lint` failing → exit 1, state has `ok=false`, `checks[0].status=failed`.
3. Fixture with `dark-factory.quality=["lint"]` → only runs lint, skips others.
4. Fixture with no package.json → graceful error, exit 1, structured output.

### task_07_04 — Rewrite orchestrator execution loop

File: `agents/pipeline-orchestrator.md`

Find the current "## Execution Sequence" section. Replace the prose with an explicit, numbered loop with success/failure branching. Template:

```markdown
## Execution Sequence (per task)

For each task `$t` in the current parallel group:

1. **Pre-flight**
   - `pipeline-quota-check` — if paused, sleep and continue to next loop iteration
   - `pipeline-classify-risk $t` — record risk level in state
   - `pipeline-build-prompt $run_id $t` — get the full executor prompt

2. **Execute**
   - Spawn `task-executor` agent with the built prompt (isolation: worktree)
   - On return, record `worktree_path` in `.tasks.$t.worktree`
   - If the agent failed hard (Agent tool returned non-success), mark `.tasks.$t.status = failed` and jump to step 7

3. **Quality Gate**
   - `pipeline-quality-gate $run_id $t $worktree_path`
   - If exit != 0 → record failures in state, increment `.tasks.$t.quality_attempts`
     - If attempts < 3: mark `.status = ci_fixing`, spawn executor again with quality failure logs as context, goto step 3
     - If attempts >= 3: mark `.status = needs_human_review`, `pipeline-gh-comment --type ci-escalation`, jump to step 7

4. **Spawn Reviewers**
   - Always: spawn `implementation-reviewer` with `$worktree_path` and task context
   - If `risk_level == security`: also spawn `quality-reviewer` (and any user-provided security-reviewer/architecture-reviewer that exist)
   - All reviewers run in parallel (emit one assistant message with N Agent calls)

5. **Parse Verdicts**
   - For each returned reviewer: `pipeline-parse-review <output-file>`
   - If any verdict is `REQUEST_CHANGES` with `blockers > 0`:
     - Increment `.tasks.$t.review_attempts`
     - If attempts < 3: mark `.status = ci_fixing`, rebuild prompt with review feedback, goto step 2
     - If attempts >= 3: mark `.status = needs_human_review`, escalate, jump to step 7
   - If any verdict is `NEEDS_DISCUSSION`: mark `.status = needs_human_review`, escalate, jump to step 7
   - If all verdicts are `APPROVE`: continue to step 6

6. **Create PR & Wait**
   - `pipeline-branch task-commit $t` — commit to `task/$t` branch
   - `gh pr create ...` — open the PR
   - `pipeline-wait-pr $t` — wait for mergeable state, rebase if needed
   - On success: mark `.tasks.$t.status = done`
   - On failure: mark `.status = needs_human_review`, escalate

7. **Finalize**
   - `pipeline-state write "$run_id" ".tasks.$t.finished_at" "$(date -u +%FT%TZ)"`
   - Move to next task in group

After all tasks in the group are terminal (done/failed/needs_human_review), move to the next parallel group.
```

Key properties:

- Every step names the exact script to call
- Every branch has an explicit success/failure path
- Every status transition is explicit
- Attempt counters are namespaced (`quality_attempts` vs `review_attempts`) so they don't interfere

Test in `bin/test-phase8.sh`:

- Grep for each section header: `Pre-flight`, `Execute`, `Quality Gate`, `Spawn Reviewers`, `Parse Verdicts`, `Create PR & Wait`, `Finalize` — all present.
- Grep for `pipeline-quality-gate` — referenced at least once.
- Grep for `needs_human_review` — referenced for each escalation path.
- Grep for `emit one assistant message with N Agent calls` — confirms parallel spawn instruction.

## Verification

1. `bash bin/test-phase3.sh` — build-prompt tests pass (prior-work section)
2. `bash bin/test-phase6.sh` — parse-review and quality-gate tests pass
3. `bash bin/test-phase8.sh` — orchestrator structure tests pass
4. `bin/pipeline-quality-gate` exists, is executable, emits valid JSON on both pass and fail
5. Manual read of orchestrator.md top-to-bottom — the execution loop flows step-by-step without ambiguous prose
