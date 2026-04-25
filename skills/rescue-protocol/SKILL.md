---
name: rescue-protocol
description: (internal) Recover a dark-factory pipeline run from complex issues (merge conflicts, unmerged PRs, orphan branches, failed tasks, review deadlocks, state drift) that /factory:run resume cannot handle. Produces a clean state that resume picks up naturally.
---

# rescue-protocol

You are the rescue orchestrator. You repair a pipeline run that has complex issues, then hand off to `/factory:run resume`. You never edit state by hand. All writes go through `pipeline-state`. All detection goes through `pipeline-rescue-scan`. All actions go through `pipeline-rescue-apply`. Your job is to sequence these, solicit user approval for risky actions, and dispatch the read-only `rescue-diagnostic` agent for failed or flagged tasks.

## Iron Laws

1. Never edit `state.json` directly.
2. Never attempt fixes not covered by `pipeline-rescue-apply`.
3. Always run `pipeline-ensure-autonomy` first.
4. Tier-1 fixes auto-apply without prompting.
5. Tier-2 and tier-3 fixes require `AskUserQuestion` batch approval.
6. The `rescue-diagnostic` agent is read-only; its decisions drive deterministic apply actions.
7. Final step is always `/factory:run resume`, unless the user cancels.

## Protocol

1. **Autonomy check.** Run `pipeline-ensure-autonomy`. If it exits 2 (stale or missing), follow the existing relaunch prompt pattern from `/factory:run`.

2. **Select target run.** Resolution order:
   1. Read `$CLAUDE_PLUGIN_DATA/runs/current` symlink → run id.
   2. Else `pipeline-state list | jq -r last`.
   3. Else list real runs in `$CLAUDE_PLUGIN_DATA/runs/` whose names match `^run-[0-9]{8}-[0-9]{6}$` (skip fixtures like `run-wrapper-*` unless the user passes `--include-fixtures`); if any, prompt with `AskUserQuestion`.
   4. Else list `$CLAUDE_PLUGIN_DATA/archive/*/state.json` newest-first, prompt with `AskUserQuestion`. On user pick, run `pipeline-rescue-apply --action=rehydrate-archived-run --run-id=<id>` (tier-1, auto-applied) before continuing — this restores `runs/<id>/` from the archive copy and re-creates `runs/current` if absent. Archive copy is preserved.
   5. Exit with "No run to rescue." if all empty.

3. **Refuse if pipeline is live.** If `.status == "running"` and a fresh `pipeline-state` lock attempt succeeds (meaning no current holder), proceed. Otherwise exit with "Pipeline is running; wait for it to halt before rescuing."

4. **Scan.** Run `pipeline-rescue-scan <run-id> > $rundir/rescue/report-<ts>.json 2> $rundir/rescue/scan-<ts>.log`. Read the report. On non-zero exit, quote the last 20 lines of `scan-<ts>.log` verbatim — never paraphrase stderr into prose.

5. **Short-circuit if clean.** If `mechanical_issues` and `investigation_flags` are both empty AND no task is `status=failed`, skip to step 12 (invoke resume).

6. **Auto-apply tier-1.** Run `pipeline-rescue-apply --tier=safe --plan=<report>`. Silent.

7. **Mechanical batch approval.** Collect all tier-2 and tier-3 mechanical issues. If any exist, call `AskUserQuestion` with one question listing them and three options: `approve-all`, `review-per-item`, `cancel`.
   - On `approve-all`: write `approved-mechanical-<ts>.json` containing all of them.
   - On `review-per-item`: loop, one `AskUserQuestion` per issue with `approve`/`skip`; aggregate approved into the file.
   - On `cancel`: exit with "Rescue cancelled by user."

8. **Apply approved mechanical.** Run `pipeline-rescue-apply --tier=risky --plan=<approved-mechanical>.json`.

9. **Investigation.** Read the current state; for every task where `.tasks.<id>.status == "failed"` OR every `investigation_flags[]` entry, build an input JSON at `$rundir/rescue/diagnostic.<task-id>.input.json` (see `reference/diagnostic-agent-contract.md`). Dispatch `rescue-diagnostic` via `Agent()` in parallel, one per task. Wait for all to return; read each `diagnostic.<task-id>.output.json`.

10. **Investigation batch approval.** Collect all agent outputs into a plans list. Call `AskUserQuestion` with one question summarizing each plan (one line per task: `<task>: <decision> (<reason-short>)`) and options: `approve-all`, `review-per-item`, `cancel`.
    - On `approve-all`: write `approved-plans-<ts>.json`.
    - On `review-per-item`: loop per plan.
    - On `cancel`: exit.

11. **Apply plans.** Run `pipeline-rescue-apply --plans=<approved-plans>.json`.

12. **Invoke resume.** Skill complete — hand control back by instructing the user (or downstream orchestrator) to run `/factory:run resume`. If operating in autonomous mode where you can directly invoke, call the `pipeline-orchestrator` skill with `mode=resume`.

## References

- `reference/issue-taxonomy.md` — full table of issue types, tiers, and fixes.
- `reference/remediation-protocol.md` — exact commands and invariants per action.
- `reference/diagnostic-agent-contract.md` — input/output schema for `rescue-diagnostic`.
- Skill complements `skills/pipeline-orchestrator/reference/resume-protocol.md`.

## Error handling

See `docs/superpowers/specs/2026-04-24-rescue-design.md` section 9 for the full matrix. Summary:

- Scan fails → exit non-zero with partial report, no state changes.
- User cancels at any prompt → exit 0 cleanly; tier-1 fixes already applied remain.
- Diagnostic times out or returns malformed JSON → treated as `no_action`.
- Apply errors are recorded in `.rescue.applied_actions` with `result: "error"`; batch continues.
