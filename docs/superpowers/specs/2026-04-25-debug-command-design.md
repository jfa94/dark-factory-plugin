# `/factory:debug` command + root-cause Iron Law

## Goal

Provide a standalone command that drives the existing reviewer ⇄ implementer loop against arbitrary code (latest commit, custom base, or full codebase) until the reviewer is satisfied. Strengthen the implementer agent so it (a) verifies reviewer findings before acting and (b) escalates fundamental design flaws to a human instead of papering over them.

## Motivation

The factory pipeline already has a high-quality review/fix loop, but it is bound to spec-driven task execution. Engineers want to point that loop at a recent change (a feature branch, a commit, the whole repo) without authoring a PRD. Reusing the existing reviewer agents and `task-executor` keeps new code minimal.

The root-cause / escalation rule fills a known failure mode: when a reviewer finding exposes a deeper architectural problem, the implementer currently tends to add a workaround. The new Iron Law forces a binary choice: fix the actual cause or escalate.

## Scope

In scope:

- New `/factory:debug` command (`commands/debug.md`).
- New `skills/debug/SKILL.md` driving the loop.
- New `bin/pipeline-debug-review` (severity-aware review wrapper) and `bin/pipeline-debug-escalate` (audit-trail writer).
- `agents/task-executor.md` — add `Iron Laws` section with verify-findings + root-cause-or-escalate rules.
- `bin/pipeline-run-task` `_stage_postreview` heredoc — append a one-line reminder pointing to the new Iron Laws.

Out of scope:

- Changes to reviewer agents (verification requirements already present).
- Changes to other pipeline stages (preflight, ship, finalize-run).
- Changes to `pipeline-codex-review` internals.
- PR creation / pushing. `/debug` only commits fixes locally.

## Architecture

```
commands/debug.md          flag parsing → invoke skills/debug
skills/debug/SKILL.md      Iron Laws + loop (review → filter → executor → repeat)
bin/pipeline-debug-review  resolves base ref, runs codex/agent reviewer, filters by severity
bin/pipeline-debug-escalate writes escalation audit trail, prints user-facing path
agents/task-executor.md    new Iron Laws section
```

Reused unchanged: `pipeline-detect-reviewer`, `pipeline-codex-review`, `pipeline-parse-review`, `task-executor` agent.

### Flag handling

| Flag                                          | Effect                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| (none)                                        | base = `HEAD~1`                                                            |
| `--base <hash>`                               | base = `<hash>`                                                            |
| `--full`                                      | base = `$(git rev-list --max-parents=0 HEAD \| tail -1)` (root commit)     |
| `--limit <seconds>`                           | record `deadline = $(date +%s) + N`; checked at top of each loop iteration |
| `--fixSeverity <critical\|high\|medium\|all>` | filter findings by minimum severity; default `medium`                      |

`--base` and `--full` are mutually exclusive; the skill validates and aborts otherwise.

### Severity normalization

Reviewers emit mixed vocabularies (codex: `critical|high|medium|low`; quality-reviewer agent: `critical|important|minor`). The filter normalizes:

- `important` → `high`
- `minor` → `low`

Threshold map:

| `--fixSeverity`      | Triggers another loop iteration when finding severity ∈ |
| -------------------- | ------------------------------------------------------- |
| `critical`           | {critical}                                              |
| `high`               | {critical, high}                                        |
| `medium` _(default)_ | {critical, high, medium}                                |
| `all`                | {critical, high, medium, low}                           |

Findings below the threshold are surfaced in the final summary but do not trigger another loop.

### Loop (driven by `skills/debug/SKILL.md`)

```
1. Validate flags. Resolve base ref. Generate run_id (timestamp-based).
2. Record deadline if --limit set.
3. Loop:
   a. If deadline passed: STATUS: TIME_LIMIT. Break.
   b. Run pipeline-debug-review --base <ref> --severity <s>
      → writes .state/<run-id>/round-N.review.json
      → stdout: blocking finding count
   c. If blocking count == 0: STATUS: CLEAN. Break.
   d. Build executor-fix prompt referencing review file + Iron Law reminder.
      Spawn task-executor (Agent tool, isolation: worktree).
   e. Parse executor STATUS line:
      - DONE / DONE_WITH_CONCERNS → continue loop.
      - BLOCKED — escalate: <reason> → invoke pipeline-debug-escalate. Break.
      - BLOCKED (other) | NEEDS_CONTEXT → surface, break.
4. Print summary: rounds run, final verdict, below-threshold findings, escalation path (if applicable).
```

### State

`${CLAUDE_PLUGIN_DATA}/debug/<run-id>/`:

- `state.json` — `{base, severity, deadline, rounds[], started_at, ended_at}`
- `round-N.review.json` — normalized review verdict per round
- `round-N.executor.log` — executor's final STATUS line per round
- `escalation.md` — present iff escalation triggered; full audit trail

### Escalation

`bin/pipeline-debug-escalate <run-id> <reason> <findings-json-path>`:

1. Writes `${CLAUDE_PLUGIN_DATA}/debug/<run-id>/escalation.md` containing: timestamp, base ref, severity threshold, escalation reason (executor's `escalate:` line), full findings list, executor's last assistant message.
2. Prints to stdout (single line, parseable by skill): `ESCALATED path=<absolute path>`
3. The skill's final user-facing output MUST include the line:

   ```
   Escalated to human review. Audit trail: <absolute path>
   ```

## Iron Law placement (root-cause / escalation rule)

Per `docs/guides/agent-adherence-guide.md` section 3, `task-executor` is an "Executor agent" and requires ✅ EI block, ✅ Iron Laws, ✅ Letter=Spirit, ✅ Red Flags. Currently has EI block (NO NEW TESTS) + Red Flags but no explicit `## Iron Laws` section. Per section 2.1, only one EI block per file — the existing NO NEW TESTS rule keeps it; the new rules go in a new Iron Laws section.

Two-level placement:

**Level 1 — `agents/task-executor.md`** (canonical; applies to ALL invocations: initial GREEN, postreview executor-fix, debug loop). New `## Iron Laws` section after the EI block:

1. **Verify findings before planning a fix.** When you receive review feedback, validate each finding before designing the fix:
   - _Technically_: read the code at the cited `file:line`; reproduce the failure or trace the execution path that produces the bug. If you cannot reproduce or trace it, the finding is unverified.
   - _Against the task intent_: when running under a spec (pipeline mode), cross-check the finding against the task's acceptance criteria. When running standalone (`/debug`), cross-check against the commit message and the surrounding code's intent. A finding that contradicts the intent is invalid even if technically correct.

   For each finding record one of: `confirmed` (proceed to fix), `dismissed: <one-line reason>` (do NOT fix; report in STATUS line), `uncertain: <question>` (STATUS: NEEDS_CONTEXT).

2. **Fix root causes; escalate fundamental flaws.** Fix the underlying cause — do not add layers around the symptom. Favour simplifying existing code over patching it. If a finding's root cause is a fundamental design or architecture flaw outside this task's scope, end with `STATUS: BLOCKED — escalate: <one-line description>` rather than working around it. This is the only sanctioned escalation path; in every other situation, finish the task.

   Violating the letter of these rules violates the spirit. No exceptions.

**Level 2 — fix-mode prompts** — one-line reminder appended only when fixing review findings:

- `bin/pipeline-run-task` `_stage_postreview` heredoc (existing loop).
- `skills/debug/SKILL.md` fix prompt (new loop).

Reminder text:

> Iron Law reminder: verify each finding (technically + against spec) before planning a fix; address root causes, not symptoms; if a finding's root cause is a fundamental design/architecture flaw outside scope, end with `STATUS: BLOCKED — escalate: <reason>`.

**Red Flags rows** appended to the existing table in `agents/task-executor.md`:

| Thought                                                              | Reality                                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "Reviewer flagged it, must be a real bug"                            | Verify first. Read the code at the cited line; reproduce or trace. Unverified ≠ confirmed. |
| "I'll add a guard around the symptom and move on"                    | That's a layer, not a fix. Find the producer of the bad state.                             |
| "Refactoring this would be cleaner but I'll patch instead"           | Simplification is preferred. Patching adds debt.                                           |
| "This finding exposes a deeper design issue but I'll work around it" | `STATUS: BLOCKED — escalate: <issue>`. Do NOT work around.                                 |

## Error paths

- **Reviewer fails** (`pipeline-codex-review` non-zero, parse failure): skill exits with summary line `STATUS: REVIEW_FAILED — <reason>`; no audit trail.
- **Executor returns malformed STATUS**: treated as `BLOCKED`; loop ends; round log preserved.
- **`--base` ref missing**: skill validates with `git rev-parse --verify` upfront; aborts with clear message.
- **Both `--base` and `--full` passed**: skill aborts; usage line printed.
- **`--fixSeverity` value not in {critical,high,medium,all}**: skill aborts.
- **Time limit hit mid-round**: current round completes; loop check at top of next iteration breaks. The user-visible final message includes "Time limit reached after N rounds; <count> findings unresolved."
- **No diff to review** (e.g., clean tree, base = HEAD): codex review emits empty-diff auto-approve; skill exits with `STATUS: CLEAN`.

## Testing

- Unit tests for `pipeline-debug-review`:
  - Severity normalization (`important` → `high`, `minor` → `low`).
  - Threshold filtering at each level (critical/high/medium/all).
  - Empty findings → exit 0 / blocking_count = 0.
- Unit tests for `pipeline-debug-escalate`:
  - Escalation file contents (timestamp, base, reason, findings, executor message).
  - Stdout format `ESCALATED path=<abs>` exact match.
- Integration test for skill loop:
  - Round 1 review returns finding, executor fixes, round 2 returns clean → CLEAN.
  - Executor returns escalate → escalation file written, summary references path.
  - `--limit 1` with slow review → TIME_LIMIT after at most one round.
- `bin/tests/debug.sh` — covers severity normalization, threshold filtering, escalation file shape, skill loop happy-path / escalate / time-limit (matches the existing `bin/tests/*.sh` pattern).

## Migration / compatibility

- New files only; no existing public interfaces change.
- `agents/task-executor.md` gains an Iron Laws section; the existing EI block, Red Flags, and STATUS contract are unchanged.
- The `_stage_postreview` heredoc gains one printf line.
- No state-file schema changes.

## Open questions

None at design time.
