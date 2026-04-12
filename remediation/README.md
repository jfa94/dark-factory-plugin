# Dark Factory Plugin — Remediation

This directory contains the follow-up work to address the comprehensive review findings for the dark-factory Claude Code plugin. It mirrors the dark-factory pipeline's own spec format (markdown plan + tasks.json) so the work is resumable across sessions.

## Structure

```
remediation/
├── README.md                  # This file
├── tasks.json                 # Flat task list with status — the single source of truth
├── analysis/
│   └── 15-turn-budget.md      # Turn budget structural analysis + recommendation
└── plans/
    ├── 01-critical-safety-hardening.md
    ├── 02-quota-rate-limiting.md
    ├── 03-spec-propagation.md
    ├── 04-production-safety-template.md
    ├── 05-branch-rebase-handling.md
    ├── 06-state-resume-correctness.md
    ├── 07-orchestrator-prompt-flow.md
    ├── 08-config-schema-alignment.md
    ├── 09-hook-robustness.md
    ├── 10-scaffolding-parity.md
    ├── 11-validator-discovery.md
    ├── 12-integration-tests.md
    ├── 13-minor-cleanups.md
    ├── 14-documentation-honesty.md
    ├── 15-turn-budget-review.md
    └── 15-turn-budget-impl.md
```

## Task schema

`tasks.json` is a flat JSON array. Each entry extends the standard dark-factory task schema with remediation-specific fields:

```json
{
  "task_id": "task_01_01",
  "plan_id": "01-critical-safety-hardening",
  "title": "Short descriptive title",
  "description": "What to implement and why",
  "priority": "P0|P1|P2",
  "findings": ["C4", "M22"],
  "status": "pending|in_progress|done|failed|blocked",
  "files": ["bin/pipeline-state", "bin/test-phase1.sh"],
  "acceptance_criteria": ["Criterion 1", "Criterion 2"],
  "tests_to_write": ["test file: description of what it asserts"],
  "depends_on": [],
  "notes": "optional free-text after completion"
}
```

- `priority` — `P0` (blocker), `P1` (major), `P2` (polish)
- `findings` — references to review-document finding IDs (C* = critical, M* = major, S* = security, P* = minor)
- `status` — updated as work progresses; the entire session state lives in this field
- `plan_id` — matches a file in `plans/` (without the `.md` extension)

## Test safety — do not run destructive commands against real paths

Several tasks harden code that calls `rm -rf`, `git push --force`, `gh issue close`, etc.

**Non-negotiable rules for every task in this directory:**

1. Never pass a real filesystem path (`/`, `~`, `$HOME`, the repo root, `/tmp` itself) as an argument to a command being hardened. Use a child of a fresh `mktemp -d` sandbox the test itself created. For teardown, always guard the variable: `trap '[[ -n "$sandbox" && "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"' EXIT`. Never use `rm -rf` directly on any path you did not create in the current script.
2. Stub external calls (`git rev-parse`, `gh`, `git push`, etc.) with a mocks directory on `PATH` so a red-phase run never touches the real repo or real GitHub.
3. If a finding says "verify `--spec-dir ~` is rejected", treat that as _semantic_ — use a sandbox path that sits outside the fake project root, never the literal `~` or `/`.
4. When in doubt, stop and ask. The cost of pausing is seconds; the cost of `rm -rf ~` is your home directory.

These rules override `tests_to_write` field content if there is a conflict.

## How to resume across sessions

### Start a fresh session

1. Open a new Claude Code session at the plugin root
2. Point Claude at this remediation plan:

```
Read remediation/README.md and remediation/tasks.json.
Find the next unblocked task (status=pending, all depends_on=done) with the
highest priority (P0 > P1 > P2). Read the plan file at
remediation/plans/<plan_id>.md for context. Execute the task, write the
regression tests listed in tests_to_write, then update tasks.json setting
status=done. Commit the work.
```

### Work one plan at a time

Alternatively, tackle a whole plan in a single session:

```
Read remediation/plans/02-quota-rate-limiting.md and the tasks in
remediation/tasks.json with plan_id=02-quota-rate-limiting. Execute all
tasks in dependency order. After each task: write the regression tests,
run the full phase-test suite (bin/test-phase*.sh), update tasks.json,
and commit.
```

### Resume a partial task

If you left mid-task:

```
Read remediation/tasks.json. Find the task with status=in_progress. Read
remediation/plans/<plan_id>.md for context. Resume where the prior session
left off. Check git log and the working tree for prior work.
```

## Testing requirement

**Every task MUST include regression tests.** The `tests_to_write` field on each task is mandatory, not optional. Reviewers found that the existing 411 tests are purely structural and do not exercise failure modes. Each bug fix in this remediation plan must ship with a test that would fail against the buggy code and pass against the fix.

Tests live in the existing `bin/test-phase*.sh` suites. When a fix touches a file, add the regression test to the corresponding phase suite (phase 1 = state/lock/circuit-breaker, phase 2 = gh-comment/fetch/validate, phase 3 = build-prompt/classify, phase 4 = branch/wait-pr, phase 5 = cleanup/summary, phase 6 = parse-review/coverage, phase 7 = quota/router, phase 8 = orchestrator.md, phase 9 = configure/templates/mcp).

Integration tests (plan 12) go in a new `bin/test-integration.sh`.

## Priority ordering

Execute plans roughly in this order. Later plans depend on earlier ones.

| Phase                       | Plans              | Why                                                                   |
| --------------------------- | ------------------ | --------------------------------------------------------------------- |
| **P0 — Block any real run** | 01, 02, 03, 04     | Injection, broken quota, broken spec handoff, missing safety template |
| **P1 — Feature parity**     | 05, 06, 07, 08, 09 | Branch handling, state/resume, orchestrator flow, config, hooks       |
| **P1 — Test coverage**      | 12                 | Integration tests for all P0/P1 fixes                                 |
| **P2 — Polish**             | 10, 11, 13, 14, 15 | Scaffolding, validator, cleanups, docs, turn-budget analysis          |

## Finding reference

- Full findings in the review chat transcript and the response preceding this remediation.
- `C1`–`C9`: Critical (P0 blockers)
- `M1`–`M23`: Major (P1)
- `S1`–`S7`: Security-specific
- `P*` / `P2`: Minor polish

## Progress tracking

To see progress at a glance:

```bash
jq '[.[] | {status, priority}] | group_by(.status) | map({status: .[0].status, count: length})' remediation/tasks.json
```

To list the next actionable task:

```bash
jq '[.[] | select(.status == "pending")]
    | map(select(all(.depends_on[];
        . as $dep
        | (input_filename | fromjson | .[] | select(.task_id == $dep) | .status == "done")
      ) or (.depends_on | length == 0)))
    | sort_by(.priority)[0]' remediation/tasks.json
```
