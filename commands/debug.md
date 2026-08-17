---
description: 'Run the whole-scope review⇄fix loop against the diff since a base ref (or the entire tree), driven by the same risk-invariant panel + producer⇄reviewer machinery /factory:run uses, until clean or the pass cap is hit'
argument-hint: '[--base <hash>|--full] [--no-ship] [--author-e2e] [--max-passes <n>] [--session-id <id>]'
arguments:
    - name: '--base'
      description: 'Diff base (commit hash) for the whole-scope review. Mutually exclusive with --full. Default: HEAD~1.'
      required: false
    - name: '--full'
      description: "Review the ENTIRE codebase (diffs against git's empty-tree SHA). Mutually exclusive with --base."
      required: false
    - name: '--no-ship'
      description: "Open the debug session's task/rollup PRs but never merge. Default (omit): live — auto-merge."
      required: false
    - name: '--author-e2e'
      description: 'Opt the eventual debug run into the e2e-authoring phase during the task loop (same engine stage /factory:run --e2e uses).'
      required: false
    - name: '--max-passes'
      description: 'Cap on review⇄fix passes before the loop must stop and finalize with residual findings. Default: 5.'
      required: false
    - name: '--session-id'
      description: 'Owning Claude Code session id (defaults to $CLAUDE_CODE_SESSION_ID).'
      required: false
---

# /factory:debug

Whole-scope review⇄fix loop: repeatedly review the diff between a base ref and
`HEAD` with the same risk-invariant 4-role panel `/factory:run`'s merge gate uses,
turn confirmed blockers into a synthetic spec, drive it through the ordinary
`factory next-task`/`factory next-action` producer⇄reviewer loop, and repeat until
a pass comes back clean (or `--max-passes` is reached) — then finalize into one PR.

Parse `--base`/`--full` (reject if both are present), `--no-ship`, `--author-e2e`,
`--max-passes <n>` (positive integer), and `--session-id` from the invoking
command's flags. Like `/factory:run`, this requires autonomous mode — the skill
runs `factory autonomy preflight` as its own first step; a non-autonomous session
halts with the printed inline-settings relaunch command (`claude --worktree --settings '<json>'`).

Then load BOTH skills — the debug skill delegates its spawn mechanics, spec loop,
and task loop to the runner protocol, so it must be in context first:

```
Skill(pipeline-runner)
Skill(debug, "base=<resolved|omitted> full=<true|false> no-ship=<true|false> author-e2e=<true|false> max-passes=<n|default> session-id=<id|$CLAUDE_CODE_SESSION_ID>")
```

All loop logic — the autonomy check, `factory debug start`, the panel spawn +
finding-verifier + review-record cycle, the synthetic-spec sub-loop, `factory debug
seed`, driving the task loop (including the finalize-interception rule — a
mid-session `next-task` `"finalize"` means "re-review", never "call `factory run
finalize`"), and the one real `factory debug finalize` at the end — lives in
`skills/debug/SKILL.md`. Do not duplicate it here.
