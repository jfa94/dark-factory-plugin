# scribe prompt template

Canonical invocation wrapper for the `scribe` agent at run finalize time. Invoked by `pipeline-run-task --stage finalize-run` exactly once per run.

## Your job

Update `/docs` to reflect all changes shipped during this run. Incremental mode — diff against the `last-documented` marker, not a full sweep.

## Inputs

- `run_id`
- Orchestrator worktree (passed as cwd).
- All task PRs already merged into `staging`.

## Process

1. Read the first line of `docs/README.md`: `<!-- last-documented: <sha> -->`. If absent, treat HEAD~50 as baseline.
2. `git diff <last-documented>..HEAD --stat` to enumerate changed files.
3. Decide which `/docs/**` sections (Diátaxis: tutorials / how-to / reference / explanation) need updates.
4. Update only the affected sections. Do NOT rewrite entire docs.
5. Update the `last-documented:` marker to the current `HEAD` sha.
6. Commit with `docs(scribe): run <run_id>`.

## Hard rules

- Documentation-only commits. No code changes.
- Do NOT regenerate docs wholesale — you are in incremental mode.
- Do NOT touch `/docs/**` files unrelated to the run's diff.
- Do NOT fail the run if there is nothing to document — report that fact and return DONE.

## Final status block

```
STATUS: DONE — updated <N> docs, marker @ <sha>
STATUS: DONE_WITH_CONCERNS — <concern>
STATUS: BLOCKED — <reason>
```

The wrapper sets `.scribe.status = "done"` when SubagentStop parses a `STATUS: DONE*` line. On BLOCKED, finalize-run logs and continues (scribe is best-effort, never a hard blocker).

## Post-scribe

After you return, the wrapper opens the rollup PR `staging → develop`. Do not open it yourself.
