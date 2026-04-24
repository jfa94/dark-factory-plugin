# Dark Factory Plugin

Autonomous coding pipeline that converts GitHub PRD issues into merged pull requests via a quality-first, TDD-enforced stage machine.

## Testing Discipline

This plugin enforces test-driven development (TDD) at the harness layer:

- Tasks run through two phases: `test-writer` commits failing tests first, then `task-executor` commits the minimal implementation.
- `pipeline-tdd-gate` enforces test-before-impl commit ordering. Violations block the task.
- See `skills/test-driven-development/SKILL.md` for the full discipline.
- Opt-out per task via `tdd_exempt: true` in the spec's `tasks.json`; globally via `package.json.dark-factory.tddExempt`.

Reviewer roles:

- `implementation-reviewer` — spec alignment: does the code address the spec, not just pass tests?
- `quality-reviewer` — adversarial code quality; Codex is the preferred executor when available.

## Key scripts

- `bin/pipeline-run-task` — per-task stage machine (preflight → preexec_tests → postexec → postreview → ship)
- `bin/pipeline-tdd-gate` — test-before-impl commit-order validation
- `bin/pipeline-orchestrator` — main entry point (invoked by the `pipeline-orchestrator` skill)

## Skills

- `skills/pipeline-orchestrator/SKILL.md` — full orchestrator protocol
- `skills/test-driven-development/SKILL.md` — TDD discipline for subagents
- `skills/prd-to-spec/SKILL.md` — converts PRD issues to spec + tasks.json
