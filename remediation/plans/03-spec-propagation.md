# Plan 03 — Spec Propagation Fix

**Priority:** P0 (blocker — spec-generator outputs are lost before orchestrator reads them)
**Tasks:** `task_03_01` through `task_03_04`
**Findings:** C1, M3

## Problem

`spec-generator` is declared with `isolation: worktree` in its frontmatter. Claude Code runs isolated agents in an ephemeral git worktree checked out from the current branch; the worktree is destroyed when the agent returns unless the files are explicitly committed or copied back. Spec-generator currently writes `spec.md` and `tasks.json` directly into its CWD and returns — those files are lost.

Downstream, `pipeline-orchestrator.md` reads `.state/<run_id>/spec.md` and `.state/<run_id>/tasks.json` from the **main** worktree where the orchestrator runs. Those files never appear there, so the orchestrator either fails fast (if `pipeline-validate-spec` is run) or hallucinates tasks (if it proceeds without validation).

Secondary issue: `pipeline-branch` has no `reconcile_staging_with_develop` step before creating the `staging/<run_id>` branch. The original `~/Projects/dark-factory` bash pipeline ran reconciliation on every staging operation to prevent drift. Without it, a long-running plugin run can end up with a staging branch that is N commits behind `develop`, so later PRs will have noisy rebase conflicts.

## Scope

In:

- Commit spec outputs from the spec-generator worktree back to `staging/<run_id>` (C1)
- Add `reconcile_staging_with_develop` to `pipeline-branch staging-init` (M3)
- Ensure every task-executor agent receives an absolute, resolvable path to `spec.md` (C1 downstream)

Out:

- spec-reviewer bundling / scoring changes (separate follow-up)
- Config key alignment (plan 08)
- hooks.json path fixes (plan 04)

## Tasks

| task_id    | Title                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| task_03_01 | Add `reconcile_staging_with_develop` to `pipeline-branch staging-init` |
| task_03_02 | Make spec-generator commit spec.md + tasks.json to `staging/<run_id>`  |
| task_03_03 | Add S3b commit-spec step to orchestrator startup (fallback path)       |
| task_03_04 | Pass resolved spec path into every task-executor prompt                |

See `remediation/tasks.json` for `acceptance_criteria` and `tests_to_write`.

## Root cause — why the current design fails

`isolation: worktree` creates a new worktree at something like `/tmp/claude-<hash>/worktree-<id>/` pointing at a detached commit of the current HEAD. The agent's CWD is that temp dir. Reads/writes there never touch the main checkout. When the agent returns:

1. If the agent made zero changes → worktree is auto-cleaned and discarded.
2. If the agent made changes → worktree path + branch name are returned in the agent result, but nothing is auto-merged into the main branch.

Spec-generator currently writes files and returns success — the orchestrator never sees the worktree path, and no commit was made. The files vanish with the worktree.

The fix is: spec-generator must either (a) commit its changes on a branch that the orchestrator can fetch, or (b) write via a tool that bypasses the worktree (`pipeline-state write` writes to `$FACTORY_STATE_DIR` which is absolute). Option (a) is the more robust approach because it also makes the spec available to downstream task-executors (which also run in isolated worktrees).

## Execution Guidance

### task_03_01 — reconcile_staging_with_develop in pipeline-branch

File: `bin/pipeline-branch`

Find the `staging-init` action. Before `git checkout -b "staging/$run_id"`, insert a reconciliation block:

```bash
# Reconcile staging base with develop to prevent drift during long runs
base_branch="${FACTORY_BASE_BRANCH:-develop}"
if git rev-parse --verify "origin/$base_branch" >/dev/null 2>&1; then
  git fetch origin "$base_branch" --quiet || true
  behind=$(git rev-list --count "HEAD..origin/$base_branch" 2>/dev/null || echo 0)
  if [[ "$behind" -gt 0 ]]; then
    if ! git merge --ff-only "origin/$base_branch" --quiet 2>/dev/null; then
      jq -n --arg base "$base_branch" --argjson behind "$behind" \
        '{error:"staging_reconcile_conflict", base:$base, behind:$behind}'
      exit 1
    fi
  fi
fi
```

Notes:

- Use `--ff-only` only — do **not** rebase automatically. Rebasing a shared staging branch rewrites history for anyone else looking at it. If `HEAD` is not a fast-forward ancestor of `origin/$base_branch`, fail loudly so a human can resolve.
- `FACTORY_BASE_BRANCH` lets integration tests override the base to avoid needing a real `develop` branch.
- Emit structured JSON on failure so the orchestrator can surface it to `pipeline-gh-comment`.

Regression tests in `bin/test-phase4.sh`:

1. Temp repo with `develop` 2 commits ahead of current HEAD, FF-mergeable → `staging-init` succeeds, final HEAD equals `develop` HEAD.
2. Temp repo with `develop` diverged (true conflict) → `staging-init` exits 1, stdout contains `"error":"staging_reconcile_conflict"` and `"behind":2`.
3. Temp repo with no `origin/develop` → reconcile block is a no-op, `staging-init` succeeds (backwards-compatible for repos without a remote).

### task_03_02 — spec-generator commits to staging

File: `agents/spec-generator.md`

The correct fix is to make spec-generator commit its outputs to a branch the orchestrator can read. Replace the current "write spec.md and tasks.json then return" instruction with a handoff protocol.

Add to the agent body (at the end, after all the spec-writing instructions):

```
## Handoff Protocol

You are running in an isolated worktree. Your changes will be lost unless you
commit them on a branch that the orchestrator can fetch. Do this as the very
last step, after spec.md and tasks.json are fully written and validated:

1. Determine the run ID from your prompt context. It is passed as `run_id`.

2. Create a handoff branch from the current worktree HEAD:
     git checkout -b "spec-handoff/$run_id"

3. Stage and commit the spec files:
     git add spec.md tasks.json
     git -c user.email=dark-factory@local \
         -c user.name="dark-factory spec-generator" \
         commit -m "chore(dark-factory): spec handoff for run $run_id"

4. Push the branch to origin so the orchestrator can fetch it from its own
   worktree. If no remote is configured, skip push and rely on the orchestrator
   reading the local branch ref via `git show spec-handoff/$run_id:spec.md`:
     git push -u origin "spec-handoff/$run_id" 2>/dev/null || true

5. Record the handoff so the orchestrator knows where to look:
     pipeline-state write "$run_id" .spec_handoff_branch "spec-handoff/$run_id"
     pipeline-state write "$run_id" .spec_handoff_ref "$(git rev-parse HEAD)"

`pipeline-state` writes into an absolute state directory that is shared across
worktrees, so the orchestrator will see these values even though this worktree
is ephemeral.

DO NOT attempt to copy files directly to the main worktree — you do not have
access to its path.
```

Notes:

- The agent must use `git -c user.email=... -c user.name=...` inline because the ephemeral worktree may not inherit global git config.
- The `2>/dev/null || true` on push is intentional: in test environments or repos without a remote, we fall back to local ref reading. The orchestrator handles both.
- `pipeline-state write` is the only reliable cross-worktree channel because it writes to `$FACTORY_STATE_DIR` (absolute path) rather than the worktree's CWD.

### task_03_03 — Orchestrator commit-spec fallback (S3b)

File: `agents/pipeline-orchestrator.md`

Even with task_03_02 in place, we need the orchestrator to resolve the spec and merge it onto `staging/<run_id>` so task-executors (running in their own isolated worktrees) can fetch it through the normal staging branch.

In the `## Startup` section, after S3 (spec generation) and before task execution, insert a new step:

```
### S3b. Resolve spec handoff

After spec-generator returns, read the handoff metadata:

  handoff_branch=$(pipeline-state read "$run_id" .spec_handoff_branch)
  handoff_ref=$(pipeline-state read "$run_id" .spec_handoff_ref)

If handoff_branch is null or empty, spec-generator did not complete the
handoff protocol — fail the run with:
  pipeline-gh-comment --type ci-escalation --body "spec handoff missing"
  pipeline-state write "$run_id" .status failed
  exit 1

Fetch the handoff branch (try remote first, fall back to local ref):
  git fetch origin "$handoff_branch" 2>/dev/null \
    || git rev-parse --verify "$handoff_ref" >/dev/null

Read spec.md and tasks.json from the handoff ref:
  git show "$handoff_ref:spec.md" > ".state/$run_id/spec.md"
  git show "$handoff_ref:tasks.json" > ".state/$run_id/tasks.json"

Merge the handoff onto staging (ff-only is fine — handoff branched from staging):
  git checkout "staging/$run_id"
  git merge --ff-only "$handoff_ref" \
    || git merge --no-ff "$handoff_ref" -m "chore: merge spec handoff for $run_id"
  git push origin "staging/$run_id" 2>/dev/null || true

Record the canonical spec location in state:
  pipeline-state write "$run_id" .spec_path ".state/$run_id/spec.md"
  pipeline-state write "$run_id" .spec_committed true

Validate the spec before proceeding:
  pipeline-validate-spec ".state/$run_id/spec.md" || { fail_spec_review; }
```

This guarantees two properties for downstream steps:

1. `.state/<run_id>/spec.md` exists on the orchestrator's filesystem for direct reads
2. `origin/staging/<run_id>` contains the spec as of HEAD, so any worktree that fetches staging gets the spec for free

### task_03_04 — Pass spec path into task-executor prompts

File: `agents/pipeline-orchestrator.md`

In the section that builds the task-executor prompt (where `pipeline-build-prompt` is called), ensure the spec path is included in the context passed to each executor.

Find the prompt-building instructions and add a "Context" block:

```
When spawning a task-executor agent, include in the prompt:

  RUN ID: <run_id>
  TASK ID: <task_id>
  SPEC (read before starting):
    - Fetch staging:  git fetch origin staging/<run_id>
    - Read spec:      git show origin/staging/<run_id>:spec.md
    - Or read locally (if orchestrator and executor share a filesystem):
                      .state/<run_id>/spec.md
  TASK DETAILS:     git show origin/staging/<run_id>:tasks.json \
                      | jq '.[] | select(.task_id == "<task_id>")'

The task-executor agent runs in an isolated worktree, so the `git show`
commands are the robust path. The direct `.state/` read is a fallback for
in-process tests.
```

Also update `bin/pipeline-build-prompt` if needed: ensure it emits the `SPEC` and `TASK DETAILS` sections, and that it uses the value from `pipeline-state read $run_id .spec_path` rather than hardcoding `.state/$run_id/spec.md`.

## Verification

1. `bash bin/test-phase4.sh` — three new reconcile tests pass (FF case, conflict case, no-remote case).
2. Read `agents/spec-generator.md` — a `## Handoff Protocol` section exists with `pipeline-state write` for `.spec_handoff_branch` and `.spec_handoff_ref`.
3. Read `agents/pipeline-orchestrator.md` — `S3b` appears between S3 and the execution loop; it reads `.spec_handoff_branch`, fetches the ref, writes `.state/<run_id>/spec.md`, and merges onto `staging/<run_id>`.
4. Grep `agents/pipeline-orchestrator.md` for `spec.md` — appears at least twice: once in S3b resolution and once in the executor prompt context.
5. Grep `bin/pipeline-build-prompt` for `spec_path` — the build-prompt script reads the state key rather than a hardcoded path.
6. Integration (plan 12) — end-to-end test that stubs spec-generator to commit two files and asserts they appear in `.state/<run_id>/` on the orchestrator side after S3b.

No live API run possible for full verification; structural + integration test coverage is sufficient.
