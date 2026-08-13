# Dark Factory Plugin

Autonomous coding pipeline that converts GitHub PRD issues into merged pull requests via a quality-first, TDD-enforced phase machine.

## Architecture (Model A)

- `agents/` and `skills/` markdown is executable policy, not documentation: it encodes engine invariants (the `interpolate_fields` whitelist, the fail-closed missing-verdict path) that no typechecker sees. An edit there is a code change — and so is an engine change that the prose describes. Re-verify every invariant the prose names, in the direction the pipeline actually runs: `agents/finding-verifier.md` once asserted the engine had citation-verified a finding before the verifier was spawned, which the ordering never did.
- The plugin surface is markdown (`commands/`, `agents/`, `skills/`) + hooks. The deterministic engine owns ALL control flow and exposes ONE seam — the **orchestrator** (`factory next-task` + `factory next-action`). ONE thin runner steps it (Decision 42): the in-session parallel event loop (`skills/pipeline-runner/SKILL.md`) — every `factory` call foreground, up to `maxParallelTasks` tasks' agents spawned in the background. The runner only spawns the `Agent()`s the orchestrator's `NextAction` spawn manifest names — it carries no pipeline logic of its own.
- The deterministic engine is one Node+TS CLI — `factory <subcommand>` — built by esbuild into two checked-in bundles: `dist/factory.js` (CLI) and `dist/factory-hook.js` (hook dispatcher, wired in `hooks/hooks.json`). `bin/factory` is the PATH shim onto the bundle.
- The CLI is the orchestrator seam + reporters + writers, never an agent-spawner: `factory next-task` emits the ready-task result (`NextTask`); `factory next-action` emits the spawn manifest (`NextAction`) and, via `--results`, records agent output into ONE state step. The six retired single-step writers (`run-task`/`advance`/`drop`/`record-producer`/`record-holdout`/`record-reviews`) collapsed into the orchestrator; the surviving writers are `spec`, `rescue`, `reconcile` (read-only without `--adopt`; `--adopt` applies forward-only adoption — Decision 60), `scaffold`, `configure`, `state`.
- Source lives in `src/` (vitest, colocated `*.test.ts`). `pnpm run verify` = typecheck && lint && test && build. `npx tsc` is shadowed — use `pnpm run typecheck`.
- Run/spec state lives OUTSIDE the target repo in `$CLAUDE_PLUGIN_DATA`: durable `specs/<repo>/<spec-id>/` + ephemeral `runs/<run-id>/`.

## Testing Discipline

This plugin enforces test-driven development (TDD) at the harness layer:

- Tasks run through two phases: `test-writer` commits failing tests first, then `implementer` commits the minimal implementation.
- The TDD gate (`src/verifier/deterministic/strategies/tdd.ts`) enforces test-before-impl commit ordering on the pre-squash task branch, memoized by tip SHA. Violations block the task.
- See `skills/test-driven-development/SKILL.md` for the full discipline.
- Opt-out per task via `tdd_exempt: true` in the spec's `tasks.json`; globally via `package.json.factory.tddExempt` (`src/verifier/deterministic/tdd-exempt.ts`). For repos with exotic test runners (Go, Ruby, Deno, etc.), contract the gate's `command` in the repo's committed `.factory/gates.json` (Decision 46) instead of bypassing enforcement.
- `tdd_exempt` is read from the spec's `tasks.json` + the repo's `package.json` — never from `state.json` (derive-don't-store).

Reviewer roles (risk-invariant panel — every reviewer runs on every task):

- `implementation-reviewer` — spec alignment: does the code address the spec, not just pass tests?
- `quality-reviewer` — adversarial code quality, plus the folded security, architecture, and type-design dimensions (Decision 43); Codex is the preferred executor when available.
- Plus `silent-failure-hunter` and `systemic-failure-reviewer`; blockers pass through an independent finding-verifier before reaching the producer (verify-then-fix, Decision 27).
- `database-design-reviewer` — content-conditional specialist (Decision 51): appended to the panel only when the task diff touches migration/schema files (`touchesDatabase`, `src/verifier/judgment/db-detect.ts`); additive-only, so risk-invariance holds.

## Key entry points

- `commands/run.md` — main entry (`--no-ship` to open PRs without merging; default: live. The runner loop runs in the invoking Claude Code session — see `skills/pipeline-runner/SKILL.md` for the protocol + CLI surface table). Three lifecycle verbs (Decisions 35+50): `run` starts FRESH (no silent reuse — on an active run it exits 3 / prompts resume·supersede·cancel), `commands/resume.md` (`/factory:resume`) is THE repair verb — scans, resumes a clean park promptless, else proposes a consent-gated repair plan (approve any subset) then resumes, `commands/debug.md` is the standalone review-fix loop.
- `src/cli/main.ts` — the `factory` subcommand registry (run, resume, spec, next-task, next-action, rescue, reconcile, score, miss, state, scaffold, configure, config-defaults, debug, autonomy, statusline)
- `src/orchestrator/orchestrator.ts` + `src/orchestrator/next.ts` — the task-level and run-level orchestrators behind `factory next-action`/`factory next-task` (record logic in `src/orchestrator/record.ts`)
- `src/hooks/main.ts` — the `factory-hook` guard dispatch (TCB write-deny, holdout guard, secret guard, branch protection, stop gates)

## Worktree base invariant

`.claude/settings.json` sets `worktree.baseRef: "head"` so every `Agent({isolation:"worktree"})` subagent worktree branches from the runner's staging HEAD, not stale `origin/main`. The staging branch is per-run — `staging-<run-id>` from `runStagingBranch` (`src/git/run-staging.ts`), pinned on `RunState.staging_branch`; there is no shared `staging` branch (a repo's own `refs/heads/staging`, if any, is unrelated). The runner FFs/forks its worktree to `origin/staging-<run-id>` before any spawn; the preflight phase's idempotent `checkout -B … origin/staging-<run-id>` stays as a fallback. The `worktree` block is read at session start (not mid-session) and is project-wide — see `docs/explanation/decisions.md` Decision 12.

## Skills

- `skills/pipeline-runner/SKILL.md` — full runner protocol (the in-session parallel event loop)
- `skills/test-driven-development/SKILL.md` — TDD discipline for subagents
- `skills/review-protocol/SKILL.md` — the RawReview JSON output contract every risk-invariant-panel reviewer emits (CLI citation-verifies + records it into the merge gate)
- `skills/rescue-protocol/SKILL.md` — the consent-gated repair protocol behind `/factory:resume`'s repair route (scan → diagnose → propose → approved-subset apply → resume)
- `skills/database-design-review/SKILL.md` — the schema-review checklist (Iron Laws + Decision Gates) the conditional `database-design-reviewer` applies
- `skills/debug/SKILL.md` — the standalone review⇄fix loop behind `commands/debug.md`
- `skills/e2e-authoring/SKILL.md` — the Playwright journey-spec discipline for the e2e phase (Decision 39)

## Known gaps (deliberate)

- (none currently — the SessionStart/compact hook wiring gap closed 2026-08-13; `hooks/hooks.json` remains TCB-protected and hand-edited, with a wiring test in `src/hooks/main.test.ts`.)
