---
description: 'Start a fresh factory autonomous coding pipeline run (PRD issue → task PRs → staging → develop)'
argument-hint: '(--issue <N> | --spec-id <id>) [--repo <owner/name>] [--no-ship] [--e2e] [--approve-spec] [--supersede | --resume] [--ignore-quota]'
arguments:
    - name: '--repo'
      description: 'Target GitHub repo as <owner>/<name> (OPTIONAL — auto-derived from the origin remote; pass to override)'
      required: false
    - name: '--issue'
      description: 'PRD issue number — the stable spec lookup key'
      required: false
    - name: '--spec-id'
      description: 'Explicit <issue>-<slug> spec id, instead of --issue'
      required: false
    - name: '--no-ship'
      description: 'CREATE-ONLY ship selector: open task/rollup PRs but never merge. Default (omit): live — auto-merge tasks into staging + rollup into develop. Cannot combine with --resume (rejected loud)'
      required: false
    - name: '--e2e'
      description: 'Opt into run-level e2e (Decisions 39/40): create checks the static Playwright prerequisites (scaffold provides them); a run-start e2e-assessment resolves boot config + authors seed/auth machinery BEFORE any task; once all tasks are terminal, author + run Playwright journeys against staging before docs/finalize; a mappable failing journey reopens its task with feedback. Persisted on the run — CREATE-ONLY, like --no-ship'
      required: false
    - name: '--approve-spec'
      description: 'Park the fully-created run (suspended, no quota checkpoint) for human spec sign-off BEFORE any agent runs (S9, Decision 47). The envelope names the spec.md to review; `/factory:resume` IS the sign-off. CREATE-ONLY, default off'
      required: false
    - name: '--supersede'
      description: 'If an active run already exists for this spec, mark it `superseded` (delete its staging branch + PRs) and start fresh — Phase 1 regenerates from the PRD; the old durable spec survives until the new one passes gate + review (`spec store` replaces it). Skips the conflict prompt. (Has no effect on the spec when combined with --spec-id, which bypasses Phase 1.)'
      required: false
    - name: '--resume'
      description: 'If an active run already exists, hand off to `/factory:resume` instead of starting fresh — skips the conflict prompt. Continues the run with its PERSISTED ship intent; never pass --no-ship alongside it'
      required: false
    - name: '--ignore-quota'
      description: "Bypass quota pacing end to end: skips Phase 1's spec-entry quota gate (a fresh PRD otherwise pauses before the generator spawn) and the weekly-quota hard stop on create/supersede. Persisted on the run so subsequent steps skip the quota gate too. Use only to override a mistaken suspend or after a manual quota reset."
      required: false
---

# /factory:run

Start a **fresh** pipeline run. The `factory` CLI is the engine (ALL control flow); the
runner is a dumb loop. `/factory:run` never silently reuses an existing run — to continue
or repair one, use `/factory:resume` (it routes itself). Reject the call
with a clear message if neither or both of `--issue`/`--spec-id` are given. `--repo` is
OPTIONAL — the CLI auto-derives it from the `origin` remote of the current checkout (pass
`--repo <owner/name>` only to override; an explicit value that disagrees with the remote fails
loud).

**Default (no flags): live ship** — the in-session runner loop, auto-merging each task
into staging and the staging→develop rollup into develop. One terse boolean override:
`--no-ship` (open PRs but never merge instead of live).

Develop protection is run-scoped by default (Decision 74): `run create` escalates develop
to the strict profile (full checks, strict up-to-date, admins enforced) and every
run-terminal path drops it back to the baseline (`developRequiredStatusChecks` minus
Mutation Testing for non-admin PRs, admins bypass). `--no-ship` caveat: finalize de-escalates when the rollup PR is left
open on purpose, so merging that PR later needs the baseline checks green for non-admins
but not Mutation Testing/strict — and an admin can bypass.

## Every run starts the same

Load the skill and run its Phases 0–2 (preconditions → spec loop → `factory run create
[--no-ship] [--e2e] [--supersede | --resume] --session-id "$CLAUDE_CODE_SESSION_ID"`;
read `run_id` from the emitted `{kind:"created"|"superseded", run}` envelope). Forward THIS
command's `--no-ship`/`--e2e`/`--supersede`/`--resume`/`--ignore-quota` flags verbatim to Phase 2's `run
create` so the ship intent persists on the run — `ship_mode` is read back by
resume + finalize (never re-passed). `--no-ship`/`--e2e`
are **create-only** selectors: combining either with `--resume` is rejected loud by
`run create` (a resumed run keeps the `ship_mode`/`e2e` it was born with — both immutable), so
never let a ship flag ride a resume hand-off. Always pass `--session-id
"$CLAUDE_CODE_SESSION_ID"` so the run records THIS session as its `owner_session` — the Stop
gate then keeps the autonomous loop alive only here and lets other sessions stop freely
(Prompt J). With `--spec-id`, skip Phase 1 — the spec must already exist; `run create` fails
LOUD otherwise. When `--supersede` is set, forward it to Phase 1's `factory spec resolve` call
so the reuse check is skipped — Phase 1 will always regenerate from the PRD in this case
(never reuse); the OLD durable spec survives until `spec store` replaces it after the new
spec passes gate + review. Forward `--ignore-quota` to `spec resolve` too. `--supersede` has
no effect on the spec when combined with `--spec-id` (Phase 1 is skipped).

Forward `--approve-spec` verbatim too. When set, the `created`/`superseded` envelope
carries `spec_approval` and the run is already parked (`suspended`, no quota checkpoint) —
**STOP immediately**: print `spec_approval.spec_path` + "review the spec, then run
`/factory:resume`" and do NOT call `next-task` or enter THE LOOP (its quota-gate step
clears suspensions once it proceeds, which would silently un-park the run). Resume IS the
sign-off (S9, Decision 47).

Three Phase-1 envelopes are terminal — STOP, spawn nothing:

- `{kind:"unspecifiable"}` (exit 1): the PRD cannot support spec generation — relay
  `blockers` verbatim, tell the user to edit the PRD issue and re-run (zero agent cost;
  S9, Decision 47).
- `{kind:"pause"}` (exit 0): quota pacing stopped the spec build BEFORE any apex spend
  (or `--supersede` targeted a weekly-parked run). No run exists yet, nothing is parked —
  report `scope`/`reason`/`resets_at_epoch` (convert to a local time) and tell the user to
  re-run after the reset, or with `--ignore-quota` to override.
- `{kind:"spec-defect"}` (exit 1): the engine exhausted the regen bound
  (`iterations`/`max_iterations`) — relay `reason` + `blockers` verbatim; the PRD needs
  rework.

```
Skill(pipeline-runner)
```

## Active-run conflict (Decision 35 — no silent reuse)

If an active run already exists for this spec, Phase 2's `run create` exits `3`. There are
two distinct conflict envelopes — **handle `kind` first**:

### `kind:"pause"` — weekly quota hard stop

```json
{
    "kind": "pause",
    "scope": "7d",
    "run_id": "…",
    "status": "suspended",
    "reason": "…",
    "resets_at_epoch": 1234567890
}
```

The existing run is parked on the weekly quota window. This is a **hard stop** — do NOT
offer the supersede/resume prompt. Report the `reason` and `resets_at_epoch` (convert to a
human-readable date), tell the user to run `/factory:resume` after the window resets, and
**STOP**. The only override is `--ignore-quota`, which the user must pass explicitly:

```
run re-blocked on the 7d quota window (resets ~<date>).
Run /factory:resume after it resets, or re-run with --ignore-quota to override.
```

### `kind:"exists"` — generic active-run conflict

```json
{"kind": "exists", "existing": {"run_id": "…", "status": "running"}}
```

Unless the user already passed `--supersede`/`--resume` (forwarded by the skill, skipping
the prompt), ask with one `AskUserQuestion` before doing anything destructive:

- **Continue (resume)** → run `/factory:resume --run <existing.run_id>` — re-enter the
  existing run where it left off (its staging branch + merged work are intact).
- **Supersede (fresh)** → re-run `factory run create … --supersede`: the spec is
  regenerated from the PRD (Phase 1 — the old spec is replaced only once the new one
  passes gate + review), the old run is marked `superseded`, its `staging/<run-id>`
  branch + task PRs are deleted, and a fresh run starts with the new spec. Then drive
  the fresh run.
- **Cancel the prompt** → stop here; leave the existing run untouched and `running` (this
  declines to start a fresh run — it does NOT abandon the existing one).

Map the answer to the `--resume` / `--supersede` flag — the CLI stays the single source of
truth (never hand-edit run state from the command).

To genuinely **abandon** the existing run (mark it terminal so its owning session can stop),
that session runs `factory run cancel --run <run_id>` (`--cleanup` also deletes its staging
branch + task PRs). A cancelled run is `failed` and NOT resumable — start fresh with
`/factory:run`. See Decision 35's addendum.

## The loop

Continue with the skill's Phase 3 THE LOOP and Phase 4 verbatim: a parallel event loop
driving up to `maxParallelTasks` tasks in flight (config, default 3 — emitted as
`max_parallel` on the work envelope). Every agent is spawned in this session (agents in
the background, every `factory` call foreground), and the `factory` CLI stays the single
source of control flow.

## Autonomous mode (MANDATORY — no opt-in, no opt-out)

The pipeline runs unattended by design. `factory run create` and `factory resume`
**HALT loud** unless the session is autonomous (`FACTORY_AUTONOMOUS_MODE=1`); there is no
bypass flag. The gate lives in the deterministic engine (`src/autonomy/mode.ts`,
`NotAutonomousError`), so a non-autonomous `/factory:run` cannot start a run — it exits
non-zero with the relaunch instruction rather than degrading to per-tool permission prompts.

`/factory:run` calls `factory autonomy preflight` as its first step (Phase 0 of the
runner skill). Preflight builds the settings in memory when needed, so the user's
only manual act is the relaunch itself:

```bash
factory autonomy preflight     # run-entry check: exits 0 to proceed when the session is autonomous;
                               #   otherwise prints the inline-settings relaunch command and exits 1.
                               #   Never throws on the decision path.
factory autonomy ensure        # manual primitive: builds the settings in memory + prints the command
factory autonomy status        # manual primitive: exits 0 if autonomous, 1 if not (add --json for the payload)
```

Preflight is two-state (v1.47): the session is **autonomous** (`FACTORY_AUTONOMOUS_MODE=1`,
however it got set — a prior inline-settings relaunch or a directly-exported env, the
sanctioned CI path) → proceed; it is **not** → print the relaunch command and halt. Nothing
is written to disk — the old `merged-settings.json` artifact and its staleness/hash machinery
are gone; every relaunch carries the current settings by construction. `ensure` builds the
payload from `templates/settings.autonomous.json` **only** (placeholders substituted,
`CLAUDE_PLUGIN_DATA` baked into `env`, `statusLine` wired to `factory statusline`, the user's own
statusline chained via `FACTORY_ORIGINAL_STATUSLINE`) — the user's `~/.claude/settings.json` is
never re-serialized into the payload (it would land in argv/transcript/shell-history), and still
applies as an underlying layer beneath `--settings`. `ensure` then prints
`claude --worktree --settings '<json>'` — the template-derived settings object passed inline as
exactly one shell-quoted argument. Relaunching with that command sets
`FACTORY_AUTONOMOUS_MODE=1` and produces a fresh `usage-cache.json` on the first turn, which the
quota pacer reads. The relaunch is irreducible: Claude Code reads settings only at
launch, so a running session can never make _itself_ autonomous — automation covers the scaffold,
never the relaunch.

## Resuming a run → `/factory:resume`

Resuming a paused/suspended run is now its own command — see `/factory:resume [--run <id>]`.
`/factory:run` only ever starts fresh.
