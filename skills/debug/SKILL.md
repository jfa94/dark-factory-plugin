---
name: debug
description: (internal) Drive /factory:debug — the whole-scope review⇄fix loop. The `factory debug <start|review|spec|seed|finalize>` CLI owns every decision (base resolution, adjudication, pass ownership, finalize); you spawn what each envelope names and feed results back, exactly like skills/pipeline-runner/SKILL.md.
auto-invoke: false
---

# Debug — the /factory:debug whole-scope review⇄fix loop

`/factory:debug` runs the SAME risk-invariant judgment layer the per-task merge gate
uses (citation-verify → independent finding-verifier → per-reviewer adjudication),
applied to a **whole-scope diff** (`--base`/`--full` .. `HEAD`) instead of one task's
diff. Confirmed blockers are rendered into a synthetic PRD and driven through the
**ordinary** `factory spec` / `factory next-task` / `factory next-action` machinery —
so a debug pass is executed by the SAME producer⇄reviewer loop `/factory:run` uses,
just seeded from a review report instead of a GitHub issue. `factory debug
<start|review|spec|seed|finalize>` is the deterministic seam
(`src/cli/subcommands/debug.ts`); you are the same "dumb loop" role
`skills/pipeline-runner/SKILL.md` describes — you never decide a transition, you
spawn exactly what an envelope names and feed the raw results back.

<EXTREMELY-IMPORTANT>
## Iron Law

1. **`factory debug spec` is sound ONLY after a `{kind:"findings"}` review-record
   result.** Never call `debug spec resolve|gate|store` after a `{kind:"clean"}`
   result — a clean pass has zero confirmed blockers, so the synthetic PRD it would
   render (`"(no confirmed blockers)"`) can never pass the spec gate's traceability
   check (Task 6 report, "Issues or concerns"). `clean` branches straight to
   **finalize** (step 6) and STOPS.
2. **`next-task`'s `"finalize"` kind during a debug run means "this pass is done, go
   re-review" — it is NEVER a signal to call `factory run finalize`.** Only step 6's
   clean/cap branch calls the ONE real finalize, `factory debug finalize`, exactly
   once per session. See "Finalize interception" below — this is the single most
   important deviation from `skills/pipeline-runner/SKILL.md`'s Phase 3 loop.

Violating the letter of this rule violates the spirit. No exceptions.
</EXTREMELY-IMPORTANT>

## Iron Laws

1. **Never decide a transition.** The only next action is what the last envelope
   said. You never edit session/state JSON, never re-order steps, never re-run a
   step to "check" (identical to `skills/pipeline-runner/SKILL.md`).
2. **Spawn exactly what the manifest says; collect output verbatim.** `subagent_type`
   = each envelope entry's `agent_type` verbatim, model/`max_turns`/isolation per
   `skills/pipeline-runner/SKILL.md`'s Agent spawn rule — reused unchanged, not
   re-derived here.
3. **Fail loud.** An unknown envelope `kind`, an unexpected non-zero exit, or a
   `debug spec`/`debug seed` LOUD `Error` (e.g. "run 'debug review --record'
   first") → STOP and surface it verbatim. Never blind-retry.
4. **`session.base` never moves.** It is set once at `start`; every pass reviews
   the SAME `base..HEAD` range on the SAME debug staging branch, so later passes
   naturally see fewer residual findings as fixes land.

## Autonomy check (precondition for all numbered steps)

Identical mechanics to `/factory:run`'s Phase 0 step 2, repositioned as this
skill's own first step (standalone entry point): `factory autonomy preflight` —
exit 0 proceeds; on exit 1 relay the printed inline-settings `claude --worktree
--settings '<json>'` relaunch command and STOP (`debug start` HALTS loud in a
non-autonomous session; see `skills/pipeline-runner/SKILL.md` Phase 0 for the full
mechanics — not duplicated here).

## Step 1 — `factory debug start`

```bash
factory debug start [--base <hash> | --full] [--no-ship] [--author-e2e] \
  [--max-passes <n>] --session-id "$CLAUDE_CODE_SESSION_ID"
```

- `--base <hash>` / `--full` are mutually exclusive (`--full` diffs against the git
  empty-tree SHA `4b825dc642cb6eb9a060e54bf8d69288fbee4904`, i.e. review the ENTIRE
  tree); omit both for the default `HEAD~1`. Passing both throws a `UsageError`
  ("debug start: pass exactly one of --base or --full").
- `--no-ship` persists no-merge ship mode on the eventual debug `RunState` (default:
  live). `--author-e2e` persists `e2e:true` on it (opt into the e2e-authoring
  phase during the task loop, step 5). Neither takes effect until `seed` (step 4)
  actually creates the run.
- `--max-passes <n>` caps review⇄fix passes before the driver must stop looping
  (default 5; must be a positive integer or `debug start` throws).
- Always pass `--session-id "$CLAUDE_CODE_SESSION_ID"` (falls back to the env var
  itself if omitted) — same ownership rationale as `run create` in
  `skills/pipeline-runner/SKILL.md`'s Phase 2.

Mints the run id, cuts the debug staging branch (the SAME `ensureStaging` +
`runStagingBranch` mechanism `run create` uses), and emits:

```json
{"kind": "review", "run_id": "<id>", "base": "<resolved base>", "worktree": "<cwd>", "pass": 1}
```

No `RunState` exists yet — a debug run is born later, at `seed` (step 4). Record
`run_id` and `worktree` (the checkout you are already running in — debug does NOT
cut a separate worktree per pass); every subsequent action takes `--run <run_id>`.
Proceed to step 2.

## Step 2 — Review a pass: `factory debug review --emit` / `--record`

### 2a. Emit the panel manifest

```bash
factory debug review --emit --run <run_id>
```

Emits:

```json
{
  "kind": "review-spawn",
  "run_id": "<id>",
  "pass": <n>,
  "manifest": { "resume_phase": "verify", "agents": [ /* 4 panel roles */ ] },
  "base": "<resolved base>",
  "worktree": "<cwd>",
  "codex_available": true | false
}
```

`manifest` is `buildPanelManifest("verify")` — **identical construction** to the
per-task verify phase's panel (Δ K: the panel is risk-invariant, same fixed
per-role model for every reviewer, no debug-specific variant; each reviewer's
turn budget comes from its own frontmatter, not the manifest). Spawn the panel
(all 4 in one assistant message), run the cross-vendor
quality-reviewer recipe, and verify-then-fix EXACTLY per
`skills/pipeline-runner/SKILL.md`'s `expects: "reviews"` steps 2–3 (each entry's
`agent_type` verbatim, isolation `"worktree"`, model-alias mapped) — reused, not
re-derived here — with these debug-only deltas:

- Each reviewer's prompt is built INLINE from that role's `agents/<role>.md` body
  PLUS the `skills/review-protocol/SKILL.md` contract — panel manifest entries
  carry no `prompt` field, so there is no per-run prompt file to Read.
- Reviewers AND finding-verifiers inspect via `git -C <worktree> diff <base>..HEAD` — the
  envelope's `base`/`worktree` verbatim (no task worktree, no `base_ref`).
- **Prior dispositions (D68).** When the envelope carries `prior_dispositions`, append it
  VERBATIM to EVERY panel reviewer's prompt (after the review-protocol contract). NEVER
  append it to a finding-verifier prompt — verifiers stay blind to prior belief-state
  (anti-anchoring). The cross-vendor prompt already contains it engine-side — do not
  append twice.
- Cross-vendor resolution is read OFF THIS ENVELOPE, never re-derived:
  `codex_available` is the CLI's REAL probe (config `codex.model` + a live
  `codex --version`; `debugReviewEmit`); when `false` the envelope carries
  `codex_absent_reason` — echo it VERBATIM as `crossVendorAbsent.reason` in the
  results file (2b). The manifest's `cross_vendor` stamp mirrors it — when
  `status:"present"` it also carries a pre-composed `prompt` (3b/ii, same
  composition as the per-task verify phase); spawn it VERBATIM via the SAME
  `codex exec` recipe as `skills/pipeline-runner/SKILL.md`, never reassembled here.

### 2b. Record the results

Write the CONTENT of `skills/pipeline-runner/SKILL.md`'s per-task
`expects: "reviews"` results file's `reviews` key, hoisted to top level — no
`result_key`, no `holdout` (a whole-scope pass has no sidecar/holdout-validator):

```json
{ "reviews": [ ... ], "verifications": [ ... ], "crossVendorAbsent": { "reason": "..." } }
```

Omit `crossVendorAbsent` entirely when the Codex quality-reviewer actually ran;
include it when it didn't — echoing the envelope's `codex_absent_reason` verbatim,
or `"codex execution failed: <detail>"` if the `codex exec` fallback fired.

Include one verdict for every blocking+citable finding. **If a finding-verifier
returns no parseable JSON, OMIT its verdict — never synthesize one.** A missing
verdict is the correct fail-closed signal: the CLI raises a verifier error and the
merge gate blocks. A fabricated `holds: false` is read as a genuine refutation,
silently drops a possibly-real blocker, and leaves no trace in state. **This is the
only reason to omit a verdict** — a verifier that inspected and is merely unsure
returns `holds: false` on its own.

```bash
factory debug review --record --run <run_id> --results <path-to-above-file>
```

Emits ONE of:

- `{ "kind": "clean", "run_id", "pass" }` — zero confirmed blockers (review
  findings AND the repo's COMMITTED e2e suite are folded into the SAME check via
  `foldE2eIntoBlockers` — "confirmed blocker" already means "review OR e2e").
  **Go straight to step 6 (finalize). Do NOT call `debug spec`.** On pass 1
  this means no `RunState` was ever created (`debug seed` never ran), so step
  6's `debug finalize` call emits `{kind:"nothing-to-ship", run_id}` instead of
  `{kind:"finalized", ...}` — treat that as a normal, successful terminal
  state (report "clean — nothing to ship, no PR opened" and stop), not an
  error.
- `{ "kind": "findings", "run_id", "pass", "report_path", "confirmed_count" }` —
  ≥1 confirmed blocker, written to `report_path` (a markdown findings write-up
  under `<dataDir>/debug/<run-id>/pass-<n>/findings.md`).
    - If `pass == maxPasses` (from `debug start`'s `--max-passes`, tracked by you —
      the CLI does not itself compare `pass` to the cap): **go straight to step 6
      (finalize)**, reporting `report_path`'s residual findings as unresolved. STOP.
    - Else: continue to step 3 (the spec sub-loop).

## Step 3 — Spec sub-loop: `factory debug spec resolve|gate|store`

Only reachable from a `findings` result with `pass < maxPasses` (Iron Law 1). Run
`skills/pipeline-runner/SKILL.md`'s Phase 1 generate⇄review loop EXACTLY as written
there (same `agents/spec-generator.md` / `agents/spec-reviewer.md`, same
`max_iterations` bound, same `SpecBuildEnvelope` union) with
`factory debug spec resolve|gate|store --run <run_id>` as the subcommands, plus
these debug-only deltas:

- The seed is a SYNTHETIC PRD rendered from this pass's confirmed blockers (issue
  number `DEBUG_ISSUE_BASE + pass`), fed through a network-free `GhClient` — no
  `gh` calls (`debugRepo` still auto-derives `owner/name` from the checkout's
  `origin` remote, exactly like real `factory spec`).
- `reuse` → call `factory debug spec store --run <run_id>` once anyway (idempotent)
  so `session.specId` is persisted — only `store`'s `kind:"stored"` branch writes
  it (`resolve`'s `reuse` envelope does NOT touch the session; see
  `debugSpecStore`'s doc comment). Then go to step 4 (seed).
- `stored` → session.specId persisted. Go to step 4 (seed).
- `unspecifiable` (S9) is structurally unreachable here — the synthetic PRD always
  renders an Acceptance Criteria section (one criterion per confirmed blocker), so
  it passes the specifiability gate by construction. If it ever fires anyway, Iron
  Law 3 applies — STOP LOUD, spawn nothing.
- `pause` IS reachable — `resolve` runs the same entry quota gate as real specs
  (fail-closed on a missing/stale usage cache). STOP unconditionally, spawn
  nothing, report `scope`/`reason`/`resets_at_epoch`; re-run the debug session
  after the window resets (debug has no `--ignore-quota` override).
- `spec-defect` (regen bound exhausted) → STOP LOUD, spawn nothing, surface
  `reason` + `blockers` — the confirmed findings likely need human triage.
- `debug spec resolve|gate|store` is LOUD (`Error`, not `UsageError`) if `review
--record` has not run yet this pass — "run 'debug review --record' first".

## Step 4 — `factory debug seed`

```bash
factory debug seed --run <run_id>
```

**Pass ownership (load-bearing — read this before touching `pass` anywhere):**
`session.pass` names the round CURRENTLY being reviewed/fixed. Steps 2 and 3 read
it as-is and never change it. `seed` is the ONLY action that advances it — pass 1:
creates the real `RunState` (`debug:true`, `intent:"fresh"`, `ship_mode`/`e2e` from
`debug start`'s `--no-ship`/`--author-e2e`) via the UNCHANGED `createRun`. Pass > 1:
appends the pass's fix tasks onto the SAME run's existing tasks
(`appendTasksFromSpec`). Either way, `seed` writes `pass: pass+1` into the session
BEFORE returning — so your NEXT `debug review --emit` call (once this pass's tasks
are terminal) naturally reviews as the next pass without any separate "advance"
action. Never increment `pass` yourself; never call `seed` a second time for the
same pass.

Emits `{ "kind": "loop", "run_id": "<id>" }`. Proceed to step 5.

## Step 5 — Drive the task loop (THE LOOP, reused)

Drive `run_id` through `skills/pipeline-runner/SKILL.md`'s Phase 3 THE LOOP
EXACTLY as written there — `factory next-task` / `factory next-action`, the
`expects: "producer-status"` / `expects: "reviews"` spawn collection, the Agent
spawn rule, the `e2e`/`document` stage handling if `--author-e2e` was set — none
of it is re-derived here. **One deviation, called out on its own because getting it
wrong ships nothing or ships too early:**

### Finalize interception (the ONE deviation from Phase 3)

```
loop:
  env = factory next-task --run <run_id>
  case env.kind:
    "finalize" → this pass's tasks are ALL terminal. Do NOT run `factory run
                 finalize`. Go back to step 2 (factory debug review --emit) to
                 re-review base..HEAD now that this pass's fixes have landed.
    "done"   → (should not occur mid-debug-session before a "finalize"; treat
                 identically to "finalize" above if it ever does — same
                 interception)
    "e2e" / "document" / "pause" / "work" → EXACTLY as Phase 3 describes.
```

`next-task` has no idea it is driving a debug session — it emits `"finalize"`
whenever a run's tasks are all terminal, debug or not (`src/orchestrator/next.ts`).
The ONLY thing that makes a debug session different is that YOU intercept that
signal here instead of calling `factory run finalize`. Only step 6's clean/cap
branch (from step 2) ever calls the real finalize — `factory debug finalize`.

## Step 6 — `factory debug finalize` (the one real finalize)

Reached ONLY from step 2's `clean` branch, or step 2's `findings` branch when
`pass == maxPasses`. Called EXACTLY ONCE per debug session:

```bash
factory debug finalize --run <run_id> [--no-ship]
```

Mirrors `run.ts`'s `runFinalize` byte-for-byte (`loadCliDeps` → `finalizeRun`,
UNCHANGED — just re-emitted under debug's own envelope kind). Emits:

```json
{
    "kind": "finalized",
    "run": {
        /* RunState */
    },
    "report": {
        /* PartialRunReport */
    },
    "rollup": {
        /* RollupResult, optional */
    },
    "failure_comment_posted": false
}
```

`failure_comment_posted` is always `false` for a debug run — `finalizeRun` skips
the PRD-facing failure comment and the completed-rollup PRD comment/close for
`run.debug === true` runs (Decision 39's deferred-finalize guards, Task 4): a debug
session has no real PRD issue to comment on or close, only its own staging
branch/PR. The rollup PR itself (staging → the base branch) is still opened/merged
normally — that PR **is** `/factory:debug`'s one deliverable.

When step 6 is reached from a pass-1 `clean` result, no `RunState` was ever
seeded — `finalize` emits `{ "kind": "nothing-to-ship", "run_id" }` instead of
the above. No rollup PR exists because no code ever changed. Report this
outcome plainly (e.g. "debug run `<run_id>`: codebase already clean, no
changes needed, nothing shipped") and stop; do not treat it as a failure or
try to read `run`/`report`/`rollup` fields from it.

## Report

Surface: run id, base, pass count reached, final `kind` (`clean` vs
`findings`-at-cap), the rollup PR (or "no-ship: PRs left open" if `--no-ship`), and
— on a cap-out — the last pass's `report_path` so residual findings are visible.
`factory state <run_id> --summary` gives the same shape `skills/pipeline-runner/SKILL.md`'s
Phase 4 reads for `/factory:run`; reuse it here too.

## When NOT to use this skill

- CLI/internal questions or debugging the factory plugin itself → regular tools.
- Driving `/factory:run`'s normal PRD→PR pipeline → `skills/pipeline-runner/SKILL.md`.
- A finished debug session → `factory state`; nothing to resume (debug's
  session-resume story is a documented known gap — see CLAUDE.md).
