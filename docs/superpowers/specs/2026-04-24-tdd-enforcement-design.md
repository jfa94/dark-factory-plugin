# TDD Enforcement + Reviewer Restructure

**Date:** 2026-04-24
**Status:** Approved (pending user spec review)

## Goal

Make the dark-factory pipeline test-driven by construction. Ports the superpowers `test-driven-development` skill into the plugin and restructures the pipeline so TDD is enforced structurally (not just as prompt guidance). Also clarifies reviewer roles by renaming and splitting concerns.

## Motivation

The pipeline currently has `task-executor` write code and tests together in one phase. There is no "write failing test first" discipline, no verification that tests actually fail before implementation, and no enforcement that tests were written before production code. The `test-writer` agent exists but is scoped to post-execution coverage-gap filling.

Additionally, the current reviewer routing conflates two distinct concerns:

- **Spec alignment** — does the implementation genuinely satisfy the spec's intent (not just pass tests)?
- **Code quality** — is the implementation sound, secure, free of AI anti-patterns?

The `task-reviewer` agent is nominally the spec-alignment reviewer, but `pipeline-detect-reviewer` falls back to it for the Codex quality-review slot, mixing the two roles.

## Adherence Techniques Borrowed from Superpowers

The superpowers plugin achieves unusually high adherence to its processes. Techniques ported here:

1. **`<EXTREMELY-IMPORTANT>` / `<HARD-GATE>` / `<SUBAGENT-STOP>` markup** — high-attention framing for hard rules.
2. **Iron Laws** — short, absolute, negative rules ("NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST"). No interpretation room.
3. **Rationalization pre-emption (Red Flags tables)** — enumerate every excuse the model will invent with its counter.
4. **Mandatory invocation language** — "ABSOLUTELY MUST", "YOU DO NOT HAVE A CHOICE".
5. **DOT process graphs** — explicit flow diagrams reduce ambiguity.
6. **Verification checklists** — forced self-audit before claiming done.
7. **Delete-means-delete rules** — no intermediate state allowed ("keep as reference" explicitly forbidden).
8. **Structural enforcement at the harness layer** — the plugin's autonomous context allows us to add hooks and quality gates that superpowers (interactive) cannot. We use both prompt steering and harness enforcement.

## Design

### 1. New skill: `skills/test-driven-development/`

Port `skills/test-driven-development/SKILL.md` from superpowers verbatim. Strip "human partner" language (no partner in autonomous context). Keep Iron Law, RED→GREEN→REFACTOR, Red Flags table, verification checklist, and process graph.

Existing `skills/testing-anti-patterns.md` is already present — leave it as the secondary reference the TDD skill links to.

### 2. Two-phase task execution

Replace the single task-executor phase with two serialized phases in the same worktree:

**Phase A — RED (test-writer, mode=pre-impl):**

- Receives: task id, acceptance criteria, spec context. Forbidden to read implementation source.
- Writes failing tests derived purely from spec and type signatures.
- Runs project test command; MUST observe non-zero exit (tests fail for the right reason).
- Commits: `test(<scope>): failing tests for <criterion> [<task_id>]`.
- Emits `STATUS: RED_READY` or `STATUS: BLOCKED`.

**Phase B — GREEN (task-executor):**

- Receives same task context. Sees RED commit in history.
- Writes minimal implementation to make tests pass.
- Forbidden to modify RED test files except in an explicit REFACTOR commit after green.
- Commits: `feat(<scope>): minimal impl for <criterion> [<task_id>]`.
- Emits `STATUS: DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` / `NEEDS_CONTEXT`.

### 3. TDD quality gate

New script `bin/pipeline-tdd-gate` runs in `pipeline-run-task` postexec, between `pipeline-quality-gate` and `pipeline-coverage-gate`.

Logic:

- Inspect commits on the task branch since base, filtered to those tagged with `[<task_id>]`.
- Classify each commit by files touched (not by message prefix):
  - `test-only` if all changed paths match test-file patterns (`*.test.*`, `*.spec.*`, `tests/**`, `__tests__/**`).
  - `impl` otherwise (touches non-test source).
- Require that the first `impl` commit is preceded by at least one `test-only` commit tagged with the same task_id.
- Require that at least one `test-only` commit exists somewhere before any `impl` commit on the task branch.
- Skip gate (exempt=true) if the task's full diff is tests-only, docs-only, or config-only. "Docs-only" = paths under `docs/`, `*.md`. "Config-only" = paths matching patterns configurable in `package.json.dark-factory.tddConfigPaths` (default: `*.json`, `*.yml`, `*.yaml`, `*.toml`, `.gitignore`).
- Exempt via `package.json.dark-factory.tddExempt` (global) or `tdd_exempt: true` on a task in the spec's `tasks.json` (per task).

Path-correspondence (e.g. `src/foo.ts` paired with `src/foo.test.ts`) is NOT enforced — too brittle across project layouts. Commit ordering alone is the signal.

Output: structured JSON to state at `.tasks.<task_id>.quality_gates.tdd` = `{ok, violations: [...], exempt: bool}`. Hard gate: non-zero exit blocks progression identically to the coverage gate.

### 4. Reviewer restructure and rename

Rename agents to accurately describe their roles:

- `agents/task-reviewer.md` → `agents/implementation-reviewer.md`
  - Role: verifies the implementation satisfies the spec's intent, not merely that tests pass. Checks every acceptance criterion is genuinely addressed.
- `agents/code-reviewer.md` → `agents/quality-reviewer.md`
  - Role: adversarial code-quality review. Logic errors, security, test quality, AI-specific anti-patterns.

Restructure routing in `bin/pipeline-run-task`:

- **Always run two reviewers in parallel per task:**
  1. `implementation-reviewer` (spec alignment).
  2. Quality reviewer: Codex (preferred) via `bin/pipeline-codex-review`, or `quality-reviewer` as fallback.
- Update `bin/pipeline-detect-reviewer`: Codex fallback is now `quality-reviewer` (not `task-reviewer`). The implementation reviewer is always Claude Code regardless of Codex availability.
- Both verdicts merged by existing `bin/pipeline-parse-review`. Any REQUEST_CHANGES blocks.

### 5. Model configuration for test-writer

- Pre-impl mode (new): Opus, effort=medium. Based on 2025-2026 benchmark research — Sonnet 4.6 is close to Opus on standard coding (−1.2 pt SWE-bench) but Opus leads by ~10 pt on ARC-AGI-2 (deep reasoning). Test authoring from spec is reasoning-heavy (edge case discovery, invariant identification), so Opus is preferred. Effort=high would mostly inflate output tokens; medium balances cost vs quality.
- Coverage-gap mode (existing): Opus, effort=high. Mutation-killing benefits from maximum creativity.

### 6. Wiring and documentation updates

Files touched:

- `bin/pipeline-run-task` — wire test-writer pre-impl phase, tdd-gate, parallel reviewer spawn, rename references.
- `bin/pipeline-detect-reviewer` — fallback to `quality-reviewer`.
- `bin/pipeline-parse-review` — rename references.
- `bin/pipeline-holdout-validate`, `bin/pipeline-validate` — rename references.
- `hooks/subagent-stop-gate.sh`, `hooks/subagent-stop-transcript.sh` — rename references (pattern matches on agent names).
- `skills/pipeline-orchestrator/SKILL.md`, `skills/pipeline-orchestrator/reference/*.md`, `skills/pipeline-orchestrator/prompts/task-reviewer.md` → `implementation-reviewer.md`.
- `skills/run-pipeline/SKILL.md` — document two-phase flow + new gate.
- `commands/run.md` — document two-phase flow.
- `templates/settings.autonomous.json` — rename references.
- `bin/tests/fixtures/score/compliant-smoke/metrics.jsonl` — update `agent_type` values.
- `bin/tests/run-command.sh`, `bin/tests/branching.sh`, `bin/tests/hooks.sh` — rename references.
- `docs/**/*.md` (7 files identified) + `remediation/plans/*` — rename references.
- Plugin root `CLAUDE.md` — add TDD enforcement note + skill reference.

## Breaking Changes

- Rename of agents `task-reviewer` → `implementation-reviewer` and `code-reviewer` → `quality-reviewer` is breaking for any external config, state, or log consumer that pattern-matches the old names. Plugin is at v0.3.6 (pre-1.0); acceptable. Flag in release notes. Bump minor.
- Existing pipeline runs in flight (`state.json` files) may contain old agent names under `.tasks.*.review` fields. New code should tolerate both names when reading but emit new names when writing.

## Non-Goals

- Introducing a new review step beyond what's described. Codex handling of review comments is already wired and out of scope for further change.
- Changing the `spec-reviewer` agent (operates pre-pipeline, unaffected).
- Extending TDD enforcement to holdout validation (separate concern).

## Acceptance Criteria

- `skills/test-driven-development/SKILL.md` exists and is invokable.
- `agents/implementation-reviewer.md` and `agents/quality-reviewer.md` exist; old filenames removed; all references updated. `grep -r 'task-reviewer\|code-reviewer'` across the plugin (excluding `docs/superpowers/specs/` and release notes) returns no hits.
- `bin/pipeline-tdd-gate` exists, is executable, and is invoked by `bin/pipeline-run-task` between quality-gate and coverage-gate.
- `bin/pipeline-run-task` invokes test-writer in pre-impl mode before task-executor spawn; task-executor sees RED commit in history.
- Quality reviewer (Codex or `quality-reviewer`) and implementation reviewer both run in parallel; both verdicts merged.
- `agents/task-executor.md` rewritten with Iron Law, Red Flags table, RED/GREEN/REFACTOR cycle, verification checklist, and split test/impl commits.
- Fixture files and test scripts under `bin/tests/` updated; existing score tests pass.
- Plugin root `CLAUDE.md` documents TDD enforcement and links to the new skill.

## Plan Hand-Off

After user review of this spec, invoke the `writing-plans` skill to decompose into an ordered, testable implementation plan.
