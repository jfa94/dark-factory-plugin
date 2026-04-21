# Resume Protocol

A run can be interrupted by quota cap, human gate, CI wait, circuit breaker trip, session end, or crash. `/factory:run resume` resumes it from the first non-terminal task without human intervention beyond the `resume` command itself.

## Actors

- **`pipeline-run-task`** — stage machine. Every stage is idempotent via `_already_past`: if `.tasks.<id>.stage` is at or past the requested terminal marker, the stage short-circuits with exit 0.
- **`pipeline-state resume-point`** — reads the run state, returns the first task whose status is not `done`/`failed`/`needs_human_review`. Spec-phase resume falls through to the first incomplete task if spec-phase fields are populated.
- **`hooks/session-start-resume.sh`** (autonomous mode only) — on `source=resume`, injects the per-task stage snapshot into the session via `additionalContext` and exports `FACTORY_CURRENT_RUN` via `$CLAUDE_ENV_FILE`.
- **`hooks/asyncrewake-ci.sh`** (autonomous mode only) — background PostToolUse hook that polls `gh pr view --json statusCheckRollup` after `gh pr create` fires. On CI terminal, writes `.tasks.<id>.ci_status` and exits 2 with a stderr reminder instructing the orchestrator to re-invoke `pipeline-run-task … --stage ship --ci-status <state>`.

## Resume flow

1. User runs `/factory:run resume`.
2. Orchestrator reads `$CLAUDE_PLUGIN_DATA/runs/current` → run id (or latest run via `pipeline-state list | jq -r last`).
3. `SessionStart:resume` hook fires first (if registered in autonomous settings) and injects the stage snapshot.
4. Orchestrator skips autonomy/validate (already done in the original session) if state exists, runs `pipeline-state resume-point "$run_id"` to pick the next task.
5. Orchestrator reuses the orchestrator worktree (step 6a of `SKILL.md`).
6. For each non-terminal task, orchestrator reads `.tasks.<id>.stage` to pick the resume stage:
   - empty or `preflight_done` → `preflight` (wrapper short-circuits if already past).
   - `postexec_done` → `postreview`.
   - `postreview_done` → `ship`.
   - anything else → `preflight` and let the wrapper decide.
7. Orchestrator enters the per-task loop from `SKILL.md`. No special-case branches — the wrapper handles everything.

Finalize-run resumes similarly: the orchestrator invokes `pipeline-run-task "$run_id" RUN --stage finalize-run` and reacts to 0/10/3 per the taxonomy.

## CI wait resume

If the original session ended while `ship` was waiting on CI:

1. `asyncrewake-ci.sh` (still running in the background, independent of the session) completes its poll.
2. It writes `.tasks.<id>.ci_status`.
3. It exits 2, which wakes the session via stderr system reminder — but if the session already ended, the signal is lost.
4. On the next `/factory:run resume`, the orchestrator sees `.stage == "ship"` and `.ci_status == "green"` (or `red`) on the task. It calls `pipeline-run-task … --stage ship --ci-status "$(pipeline-state read "$run_id" ".tasks.<id>.ci_status")"` which routes into the asyncRewake wake branch of `_stage_ship`.

## Mid-stage crash resume

If a stage crashed before writing its terminal marker (power cut during `pipeline-quality-gate`, etc.), `.tasks.<id>.stage` is still at the previous marker. The next `--stage <same>` invocation re-runs everything — safe because state writes are atomic (`pipeline-state` uses `_state_lock` + `atomic_write`) and spawn manifests are emitted only at the very end of each stage. Idempotency guarantees: no double-spawn, no duplicate PR, no duplicate commit (quality gate is pure; task-commit is a no-op on clean worktree).

## Spec-phase resume

If the session died after `pipeline-init` but before the first task entered the queue:

- `resume-point` returns the first non-terminal task — but `.tasks` is empty.
- Orchestrator detects empty `.tasks` and re-runs Spec Generation phase from `SKILL.md`.
- Spec-generator's Handoff Protocol is idempotent — the handoff branch either exists (git no-ops the commit) or is re-created.

## What state fields guide the resume

- `.status` — `running` / `partial` / `awaiting_human` / `done` / `failed`.
- `.tasks.<id>.stage` — per-task terminal marker (`preflight_done`, `postexec_done`, …).
- `.tasks.<id>.status` — `pending` / `executing` / `reviewing` / `ci_fixing` / `done` / `failed` / `needs_human_review`.
- `.tasks.<id>.worktree` — written by SubagentStop hook after the executor returns; the resume hand-off is via state, not via the transient `Agent()` return payload.
- `.tasks.<id>.review_files` — codex path; Claude path uses files at `.state/<run-id>/<id>.review.<agent>.md` written by SubagentStop.
- `.orchestrator.worktree` — reuse across sessions.
- `.scribe.status` — `spawned` / `done`; finalize-run uses this to avoid double-spawning scribe.
- `.rollup.pr_url` — finalize-run uses this to avoid double-opening the rollup PR.

## Do NOT

- Do not delete `$CLAUDE_PLUGIN_DATA/runs/<run-id>/` to "start fresh" — it discards all spec/task/review state. Use `pipeline-cleanup "$run_id"` instead.
- Do not hand-edit `state.json`. Every state write goes through `pipeline-state` for atomicity.
- Do not assume the orchestrator remembers anything across sessions. Treat every resume as cold — state is the source of truth.
