# Plan 16 — Runnable-now posture: resolve remaining review findings

**Priority:** P0 (blocks real runs) for tasks 01-10, P1 for 11-12
**Supersedes:** The 12 residual findings from the comprehensive review that were not covered by plans 01-14 or were deferred in plan 15.
**Depends on:** Bugs BUG-1/2/3 (already shipped in commits prior to this plan).
**Defers:** Plan 15 / 15b (turn-budget tracking) remains out of scope.

## Problem

The comprehensive review closed 3 concrete bugs but surfaced 12 outstanding issues across four layers. With the plugin targeting real-repo runs, every safety gap must be closed and every user-facing config key must either work or be removed.

## Scope

Twelve discrete tasks in three layers:

| Layer                       | Tasks              | Concern                                                                                                         |
| --------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------- |
| Safety                      | 01, 02, 03, 04, 05 | Write protection, secret-commit guard, destructive-path helper, lock ownership, injection                       |
| Config alignment            | 06, 07, 08, 09, 10 | Coverage-tolerance naming, PR timeout wiring, LiteLLM strip, model-by-tier wiring, humanReviewLevel enforcement |
| Observability + scaffolding | 11, 12             | Minimal metrics logging, `/factory:scaffold` command + orchestrator precheck                                    |

## Tasks

| task_id    | Title                                                | Files                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| task_16_01 | Write-blocklist hook                                 | `hooks/write-protection.sh`, `hooks/hooks.json`, `.claude-plugin/plugin.json`, `bin/test-hooks.sh`, `bin/test-phase9.sh`                                                                                     |
| task_16_02 | Secret-commit-guard hook                             | `hooks/secret-commit-guard.sh`, `hooks/hooks.json`, `.claude-plugin/plugin.json`, `commands/configure.md`, `bin/test-hooks.sh`, `bin/test-phase9.sh`                                                         |
| task_16_03 | `assert_in_plugin_data` helper + rm-safety wiring    | `bin/pipeline-lib.sh`, `bin/pipeline-cleanup`, `bin/test-phase5.sh`                                                                                                                                          |
| task_16_04 | Hard PID check on lock release                       | `bin/pipeline-lock`, `bin/test-phase1.sh`                                                                                                                                                                    |
| task_16_05 | SEC-1 + OBS-1 hardening                              | `bin/pipeline-model-router`, `bin/pipeline-state`, `bin/test-phase3.sh`, `bin/test-phase1.sh`                                                                                                                |
| task_16_06 | Rename `coverageTolerance`                           | `.claude-plugin/plugin.json`, `bin/pipeline-coverage-gate`, `commands/configure.md`, `bin/test-phase9.sh`, `bin/test-phase6.sh`                                                                              |
| task_16_07 | Wire PR merge timeout + poll interval                | `bin/pipeline-wait-pr`, `bin/test-phase5.sh`                                                                                                                                                                 |
| task_16_08 | Strip LiteLLM keys                                   | `.claude-plugin/plugin.json`, `commands/configure.md`, `bin/test-phase9.sh`, `05-decisions.md`                                                                                                               |
| task_16_09 | Wire model-by-tier + maxTurns config                 | `.claude-plugin/plugin.json`, `bin/pipeline-classify-task`, `commands/configure.md`, `bin/test-phase3.sh`, `bin/test-phase9.sh`                                                                              |
| task_16_10 | `pipeline-human-gate` + humanReviewLevel enforcement | `bin/pipeline-human-gate`, `bin/pipeline-gh-comment`, `agents/pipeline-orchestrator.md`, `bin/test-phase1.sh`, `bin/test-phase2.sh`                                                                          |
| task_16_11 | Minimal observability                                | `bin/pipeline-lib.sh`, `hooks/run-tracker.sh`, `bin/pipeline-classify-task`, `bin/pipeline-coverage-gate`, `bin/pipeline-quality-gate`, `bin/pipeline-summary`, `bin/pipeline-cleanup`, `bin/test-phase6.sh` |
| task_16_12 | `/factory:scaffold` command                          | `commands/scaffold.md`, `bin/pipeline-scaffold`, `agents/pipeline-orchestrator.md`, `bin/test-phase9.sh`                                                                                                     |

## Detailed task specs

Detailed behaviour, acceptance criteria, and test fixtures are documented inline in `tasks.json` under each `task_16_NN` entry. The primary source of truth for implementation details is `/Users/Javier/.claude/plans/piped-gliding-hartmanis.md` (the approved plan file for this work).

## Verification

1. All 9 phase test suites pass; total test count rises from 744 to ≥810.
2. New `bin/test-hooks.sh` passes standalone.
3. `grep -r 'coverageTolerance\|useLiteLlm\|liteLlmUrl' --include='*.sh' --include='*.json' --include='*.md' --exclude-dir=remediation` returns nothing.
4. `bin/pipeline-scaffold --check` exits 1 in an unscaffolded tempdir, 0 after scaffolding.
5. End-to-end regression: committing a `.env` file with secret-commit-guard active blocks the commit; committing a file with an `AKIA...` secret also blocks.
6. End-to-end regression: `Edit` on `.env.local` with `safety.writeBlockedPaths: [".env*"]` blocks.
