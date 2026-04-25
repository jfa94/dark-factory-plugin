# Remediation Protocol

Every action below is idempotent. The apply script detects current state before mutating. Re-running rescue after partial progress is safe.

## Tier 1 (safe, auto-applied)

| Issue | Action                                                    |
| ----- | --------------------------------------------------------- |
| I-01  | Remove stale lock: `rm` pid file, `rmdir` lock dir        |
| I-02  | `git worktree remove --force <path>`                      |
| I-03  | `pipeline-state task-status done`, set `.stage=ship_done` |
| I-04  | Write `.pr_url` and `.pr_number` from GitHub              |
| I-05  | Overwrite `.ci_status` from `gh pr view` latest           |

### Pre-scan (selection-time, tier 1)

`pipeline-rescue-apply --action=rehydrate-archived-run --run-id=<id>` — invoked by the skill when the user picks an archived run. `cp -R $CLAUDE_PLUGIN_DATA/archive/<id>/` → `runs/<id>/`; restore `runs/current` symlink only if absent. Refuses if `runs/<id>/` already exists or `archive/<id>/state.json` is missing. Archive copy preserved. Audit entry: `action=rehydrate_archived_run`.

## Tier 2 (risky, batch-approved)

| Issue | Action                                                              |
| ----- | ------------------------------------------------------------------- |
| I-06  | Set `.stage=postreview_done`, `.status=ci_fixing`                   |
| I-07  | `git rebase origin/<base>` in task worktree; on failure → I-13 flag |
| I-08  | `pipeline-state task-status failed`; writes `.failure_reason`       |
| I-09  | Set `.stage=postexec_done`, clear `.review_files`                   |
| I-10  | `pipeline-state task-status pending`, clear `.stage`                |
| I-11  | Reset `.spec.status=pending`; skill re-runs spec phase              |
| I-12  | Restore `state.json` from `state.json.backup` if present            |

## Tier 3 (destructive, batch-approved)

| Issue | Action                                                        |
| ----- | ------------------------------------------------------------- |
| I-13  | Flag task for investigation phase; diagnostic agent decides   |
| I-14  | Flag branch for investigation phase; diagnostic agent decides |
| I-15  | Close all but most recent PR (`gh pr close`)                  |

## Decision → Apply (investigation plans)

| decision         | action                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| reset_pending    | task → pending; clear stage/worktree/pr/ci/review_files; close PR; remove worktree; delete branch |
| mark_failed      | task → failed; write `.failure_reason`                                                            |
| delete_branch    | `git branch -D`; `git push origin --delete`                                                       |
| reset_postreview | `.stage=postexec_done`; clear `.review_files`                                                     |
| no_action        | no state changes; surfaced in final report                                                        |

## Invariants

- All state writes go through `pipeline-state` (atomic via `_state_lock` + `atomic_write`).
- Worktree removal is guarded: check existence before `git worktree remove`.
- PR close is idempotent: `gh pr close` on an already-closed PR exits 0.
- Branch deletion is safe: check `git branch --list <name>` before `git branch -D`.
- Every action records its result in `.rescue.applied_actions[]` via `rescue_audit`.
