# Issue Taxonomy

Each issue has a fixed tier and a fixed remediation. The scan emits the issue type; apply dispatches to the corresponding handler. The user approves tier-2/3 issues in a batch but does not choose the fix flavor.

## Tiers

- **Tier 1 — safe:** auto-applied without approval.
- **Tier 2 — risky:** state transitions or worktree/git operations. Batch-approved.
- **Tier 3 — destructive:** branch or PR deletion. Batch-approved.

## Issue Table

| ID   | Type                                 | Detection signal                                                  | Tier | Remediation                                                                                       |
| ---- | ------------------------------------ | ----------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| I-01 | Stale state lock                     | `state.lock/` dir exists, PID dead                                | 1    | `rm` pid file, then `rmdir` lock dir                                                              |
| I-02 | Orphan worktree                      | `git worktree list` entry, branch gone                            | 1    | `git worktree remove --force`                                                                     |
| I-03 | PR merged, state not updated         | state `!= done`, `gh pr view`=`MERGED`                            | 1    | Set `.tasks.<id>.status=done`, `.stage=ship_done`                                                 |
| I-04 | PR exists, state missing `pr_url`    | empty `pr_url`, PR found by branch                                | 1    | Write `pr_url` and `pr_number` into state                                                         |
| I-05 | Stale CI status                      | `.ci_status` disagrees with `gh pr view` latest                   | 1    | Overwrite `ci_status` from current `gh` view                                                      |
| I-06 | CI red, no recovery attempted        | `stage=ship` + CI red + not `ci_fixing`                           | 2    | Reset `.stage=postreview_done`, `.status=ci_fixing`                                               |
| I-07 | PR merge conflict with base          | `gh pr view --json mergeable`=`CONFLICTING`                       | 2    | `git rebase origin/<base>` in task worktree; on failure, task is flagged for investigation (I-13) |
| I-08 | PR closed unmerged                   | `state`=`CLOSED`, `mergedAt`=null                                 | 2    | Mark task `failed` (autonomous); task flows into investigation (I-16)                             |
| I-09 | Review verdict deadlock              | review files present, contradictory verdicts, no progress         | 2    | Reset to `postreview` with fresh review fan-out                                                   |
| I-10 | Stuck `executing` no worktree        | `status=executing`, no worktree, no PR                            | 2    | Reset task to `pending`                                                                           |
| I-11 | Spec handoff branch missing          | past spec, no `spec-handoff/<run-id>`, empty `.tasks`             | 2    | Re-run spec generation phase                                                                      |
| I-12 | Malformed state.json                 | `jq .` fails, required fields missing, or non-numeric `pr_number` | 2    | Restore from `.backup/` if available; otherwise surface to user; no auto-fix                      |
| I-13 | Unresolvable merge conflict          | I-07 rebase failed                                                | 3    | Flag task for investigation phase                                                                 |
| I-14 | Orphan task branch (no PR, no state) | branch matches `dark-factory/<run-issue>/*`, no state entry       | 3    | Flag for investigation phase                                                                      |
| I-15 | Duplicate PRs for same task          | multiple open PRs for same branch                                 | 3    | Close all but most recent (autonomous, no per-item choice)                                        |
| I-16 | Failed task root cause               | `.tasks.<id>.status=failed`                                       | 2    | Investigation phase dispatches diagnostic agent to produce plan                                   |

Tier-3 destructive actions (`git branch -D`, `git push origin --delete`, `gh pr close`) require explicit approval via either the `approve-all` batch option or per-item approval.

## Pre-scan actions

| Action                 | Trigger                                                         | Tier | Effect                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rehydrate-archived-run | User picks an archived run (`$CLAUDE_PLUGIN_DATA/archive/<id>`) | 1    | `cp -R archive/<id>/ runs/<id>/`; recreate `runs/current` symlink only if absent. Refuses if `runs/<id>/` exists or archive missing. Archive preserved. |
