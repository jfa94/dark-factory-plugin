# State Model

All durable run and spec state lives **outside** the target repo, under the plugin
data dir (`$CLAUDE_PLUGIN_DATA`, resolved by `src/config`). This is a hard
requirement: the holdout answer-key must be unreadable from an implementer
worktree, so state cannot live in-repo. Defined in `src/core/state/`.

The two stores below are the whole of that model. A **third area — the transient
spec-build scratch** (pre-validation agent handshake JSON) — is deliberately **not**
part of it: it holds nothing durable, so it lives in the OS temp dir rather than the
data dir. It is still outside the target repo (the holdout invariant is untouched),
just outside the two-store model too. See [Transient spec-build scratch](#transient-scratch)
below.

## Two stores

```
$CLAUDE_PLUGIN_DATA/
├── specs/<repo-key>/<spec-id>/        # DURABLE spec store — reused across runs
│   └── {spec.md,tasks.json,prd.json,spec.meta.json,ledger.json}
├── current/<repo-key>                # symlink → that repo's current run (the ONLY current pointer)
└── runs/
    └── <run-id>/
        ├── state.json                 # the RunState
        ├── audit.jsonl                # append-only audit log
        ├── metrics.jsonl              # append-only telemetry
        ├── report.md                  # finalize/partial report
        ├── holdouts/                  # <task>.answers.json (task-keyed) + <task>.r<rung>.verdicts.json (rung-keyed, S1)
        └── reviews/                   # reviewer artifacts
```

- **Durable spec store** — `specs/<repo-key>/<spec-id>/`, keyed by `(repo,
spec-id)` where `spec-id = "<issue>-<slug>"`. The PRD issue number is the stable
  lookup key, so re-running a PRD issue resolves the same spec. Reused across runs.
  Holds `spec.md` + `tasks.json`, the `spec.meta.json` header holdout, and — since
  [Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park) —
  a **durable PRD snapshot** `prd.json`, written by `SpecStore.write` (a spec
  without one is refused — regenerate with `--supersede`). The end-of-run
  traceability phase audits this snapshot rather than re-fetching a
  possibly-edited PRD from GitHub. Also holds — since
  [Decision 70](../explanation/decisions.md) — a **durable shipped-work ledger**
  `ledger.json` (`src/spec/ledger.ts`): append-only entries `{task_id, run_id,
pr_number?, shas[], verified_at, source: 'shipped' | 'already-satisfied'}`
  recording which commits shipped each task. `finalize` appends `shipped` entries
  after a merged rollup (SHA = post-rollup develop tip); `record.ts` appends
  `already-satisfied` entries when it verifies a producer's `ALREADY_SATISFIED`
  claim. `run create` reads it to seed a task `done` when every SHA of its latest
  entry is already an ancestor of the fresh staging tip. Missing file → empty
  ledger; corrupt content throws **loud** (a silently-empty ledger would re-run
  shipped work).
- <a id="transient-scratch"></a>**Transient spec-build scratch** _(not under the
  data dir)_ — a discardable handoff buffer for one generate/review loop, holding
  `{prd,generated,verdict}.json`. It lives at
  `<os-tmpdir>/factory-spec-build/spec-build/<repo-key>/<issue>/`
  (`defaultSpecBuildRoot()` → `specBuildDir()`, `src/core/state/paths.ts`), keyed by
  issue since no spec-id exists yet. Deliberately **rooted at the OS temp dir, not
  `$CLAUDE_PLUGIN_DATA`**: it is pre-validation agent output, never durable state, so
  the `SpecBuildDeps.scratchRoot` closure that carries it is independent of the
  durable-store `dataDir` (`src/spec/build.ts`). The two-store integrity model below
  does not cover it.
- **Ephemeral run store** — `runs/<run-id>/`, one per run.
- **Per-repo current pointer** — `current/<repo-key>` → `../runs/<run-id>`, in a
  tree **separate** from `runs/` so `listRuns` (which scans `runs/` only) is
  untouched. It's CLI ergonomics only — the reporters resolve "the current
  run" per repo from the caller's checkout (Decision 30). This is the **ONLY**
  current pointer: the global repo-less `runs/current` was retired
  ([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)),
  so `run create` writes only the per-repo pointer (and best-effort `rm`s any
  legacy global leftover); the no-cwd consumers (statusline ticks, `hook-context`,
  `next-task`) resolve via cwd → per-repo pointer, or the 3-tier
  `loadOwnerScopedRun` order, never a global fallback. `pointCurrentAt`
  refuses loud (before any write) to repoint a repo whose current names a
  still-live run owned by a different known session (the new run stays
  addressable via `--run`). **Pointer-liveness tolerance ([Decision 57](../explanation/decisions.md#decision-57--runs-are-born-whole-atomic-seeding--stale-run-sweep)):**
  inside `pointCurrentAt` **only**, an _unparseable_ pointer target (old schema / corrupt
  JSON) is treated as **stale** — it warns and repoints rather than throwing, since a run
  this engine cannot parse cannot be owned by a live session and so can never prove the
  "still-live, different owner" condition the guard exists for. This mirrors `listRuns`'
  tolerate-loudly precedent; every **targeted** read keeps its loud contract. This tolerance
  is what stops a schema-v2 pointer from crashing `run create` (the 2026-07-07 incident); the
  stale run dir it named is separately sweepable via [`rescue gc`](./cli.md#rescue-gc).
- **Producer worktrees** — NOT in this store. They live in the **target repo**, at
  `<repo-root>/.claude/worktrees/<run-id>/<task-id>/` (with results alongside at
  `<run-id>/.results/`), because `.claude/worktrees/` is the one subtree Claude Code's
  protected-path check exempts — an agent write under `$CLAUDE_PLUGIN_DATA` would
  otherwise trip an unsuppressible permission prompt (Decision 67). The path still
  encodes `(run-id, task-id)`, so the write-scope guard still derives run ownership
  straight from a write's absolute target path (Decision 30,
  [hooks](./hooks.md#run-ownership)) — it just anchors to the git-derived main-worktree
  root instead of the data dir.

`<repo-key>` is a sanitized single path segment derived from `owner/name` (the
slash and any unsafe char folded to `-`; a pure-dot path-traversal segment is
rejected). The same sanitizer keys both `specs/` and `current/`.

## Writes are atomic and locked

Every state mutation goes through the `StateManager` (`manager.ts`) — the only
sanctioned write path. Writes are atomic (write-temp-then-rename) and
lock-protected (`proper-lockfile`).

**Runs are born whole ([Decision 57](../explanation/decisions.md#decision-57--runs-are-born-whole-atomic-seeding--stale-run-sweep)).**
`StateManager.create()` accepts the seeded `tasks` map and birth-time `human_touches` in the
_same single write_, so a run is created complete — a crash mid-create can never leave a
`running` run with zero tasks (the class of half-created wreckage the 2026-07-07 incident
produced). An omitted touch `at` is stamped with the birth timestamp, so the `launch` touch's
`at === started_at` holds exactly. `createRunFromManifest` passes the seeded map in the create
payload; there is no follow-up `update()` to seed tasks. Two engine-owned recovery helpers
serve the wreckage class the fix prevents but does not retroactively clean:
`listStaleRunDirs()` enumerates run dirs this engine cannot parse (schema-v≠3 / corrupt JSON,
with best-effort `staging_branch`/`repo` extraction), and `deleteRun(runId)` removes a run dir
outright plus any `current` pointer naming it — a lock-free sweep for wreckage no valid state
can be serialized against, driven only by [`rescue gc --apply`](./cli.md#rescue-gc), never a
lifecycle verb.

## No stored verdicts (derive-don't-store)

The schema deliberately has **no field** holding a gate pass/fail boolean. Every
gate / panel / merge gate verdict is re-derived from ground truth at the moment it is
needed (`derive.ts`), so there is structurally nothing in state to forge. The one
stored judgment is each reviewer's panel verdict (the reviewer's opinion is itself
ground truth); the _merge gate_ (unanimity) is derived from those. The only other
sanctioned deviations are stored **events** (not verdicts) that no re-derivation can
recover — the `self_heal` and `human_touches` ledgers (see
[below](#self_heal--human_touches--the-stored-event-exceptions)). See
[../explanation/derive-dont-store.md](../explanation/derive-dont-store.md).

## `RunState`

`runs/<run-id>/state.json`. Schema in `src/core/state/schema.ts`. Validate
untrusted input with `parseRunState` (it layers the run-level cross-field check
`refineRunCrossFields`), never `RunStateSchema.parse` directly. The cross-field
check enforces that each entry in the `tasks` map is keyed by its own `task_id`
(a key/`task_id` mismatch is a loud parse error), so DAG traversal and keyed
lookups never read a misfiled row. It also enforces the **terminal ⇔ `ended_at`
biconditional**: `isTerminalRunStatus(status)` must equal `ended_at != null`, so a
terminal run always carries an end timestamp and a non-terminal run never does —
a mismatch is a loud parse error.

| Field                       | Type                           | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema_version`            | `3`                            | State-schema version (forward-migration marker). `StateManager.guardedParse` rejects any value other than `3` — including absent — with a clear `UsageError` ("created by an older factory version; start a fresh run") rather than a raw `ZodError`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `run_id`                    | string                         | `run-YYYYMMDD-HHMMSS`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `status`                    | RunStatus                      | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `execution_mode`            | `sequential \| balanced`       | The task-scheduling preset (`ExecutionModeEnum`, default `sequential`) the orchestrator reads when choosing how many tasks to advance at once. NOT the runner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ship_mode`                 | `no-merge \| live`             | Ship mode (default `live` — auto-merge; `--no-ship` opts into `no-merge`). Persisted at create so the runner / `resume` / `finalize` read it without re-passing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `owner_session`             | string?                        | Owning Claude Code session id. Scopes the Stop / SubagentStop gates (resolved via `findActiveByOwner`). **Always required at create (Decision 42)** — an ownerless `run create` is rejected as a usage error. Schema-optional because ownership can be released; an absent owner means no run is attributed to a stopping session, so the gate passes through (allow).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `staging_branch`            | string                         | The run's integration branch, **pinned once at create** (`staging-<run-id>`). Identity/provenance, not a derived verdict — required and read directly everywhere ([Decision 33](../explanation/decisions.md#decision-33-per-run-staging-branch-replaces-the-single-shared-staging-branch)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `spec`                      | SpecPointer                    | Pointer to the durable spec (not an embedded spec).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `tasks`                     | record<task_id, TaskState>     | Per-task state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ignore_quota`              | boolean                        | When `true`, the quota gate is skipped unconditionally for this run — both orchestrators + the runner read it from state (no per-call threading). Set at create from `--ignore-quota`, or toggled true by `factory resume --ignore-quota`. Schema default `false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `quota`                     | QuotaCheckpoint?               | Resume checkpoint; present _iff_ paused/suspended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `self_heal`                 | `{attempts, last_at}`?         | Bounded auto-rescue ledger ([Decision 48](../explanation/decisions.md#decision-48--factory-recover--bounded-auto-rescue-self-heal)); absent until `factory rescue auto` runs. A **sanctioned stored-event exception** — see [`self_heal` & `human_touches`](#self_heal--human_touches--the-stored-event-exceptions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `human_touches`             | `{kind, at}[]`                 | Append-only human-intervention ledger ([S11, Decision 49](../explanation/decisions.md#decision-49--observability-touch-metric--statusline-progress--score---fleet)); schema default `[]`. The **second** sanctioned stored-event exception. See [`self_heal` & `human_touches`](#self_heal--human_touches--the-stored-event-exceptions).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `misses`                    | `{task_id, at, note, lens?}[]` | Append-only review-miss ledger ([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)); schema default `[]`, written only by `factory miss`. The **third** sanctioned stored-event exception — a shipped defect is irrecoverable human-reported history the engine cannot re-derive. A `superRefine` rejects any `misses[].task_id` ∉ `tasks`. `lens` names the reviewer that should have caught it (or `'none'`). Surfaced by `score` (`misses`, `misses_by_lens`) and `score --reviewers`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs`                      | DocsPhase?                     | Documentation-phase marker; absent until the engine docs phase runs ([Decision 37](../explanation/decisions.md#decision-37--documentation-is-an-engine-phase-before-finalize)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `traceability`              | TraceabilityPhase?             | PRD-traceability audit marker ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park)); absent until the phase runs, only on a non-debug run. One recorded auditor verdict per numbered PRD requirement. See [`TraceabilityPhase`](#traceabilityphase).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `e2e`                       | boolean (default false)        | Whether this run opted into the e2e phase (the `--e2e` flag). Set once at create, immutable across resume. Default `false`: a run without the flag never schedules the e2e stage ([Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag)).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `e2e_assessment`            | E2eAssessment?                 | Run-start e2e-assessment record (Decision 40 D3): the coverage forecast, the boot config the assessor resolved into `playwright.config.ts`, and any degraded-coverage warning. Absent until the assessment runs; present only on an `--e2e` run. See [`E2eAssessment`](#e2eassessment).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `e2e_phase`                 | E2ePhase?                      | E2E-phase marker + author manifest + adjudication cursor; absent until the e2e phase first runs. See [`E2ePhase`](#e2ephase).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `rollup`                    | `{number?, merged, reason?}`?  | The staging→develop rollup outcome, persisted at finalize **only when it did not land** (`merged:false`). Two shapes: **(a)** an armed-but-not-landed rollup PR (`number` present — e.g. the "auto-armed" branch-policy fallback, D3; the run went terminal `completed`); **(b)** a forward-reconcile merge **conflict** before any rollup PR exists (`number` absent — finalize threw and the run stays **non-terminal**). Absent on a merged rollup (nothing to recover) or a `failed` run (no rollup attempted). Lets `rescue scan` flag either case (`rollup_pending`) without a live GitHub call. Recovery differs: **(a)** `rescue apply --recheck-rollup` reopens the run so a re-drive re-enters `finalizeRun`, whose `rollup()` resume-guard picks up the now-merged PR (PRD-close + branch-GC); **(b)** a human resolves the staging↔develop conflict, then a plain `factory resume` re-enters finalize, which overwrites/clears this marker with the real rollup result. Only `finalizeRun` mutates this pointer — `rescue apply` never does. |
| `started_at` / `updated_at` | string                         | ISO-8601.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `ended_at`                  | string \| null                 | ISO-8601, null until terminal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `terminal_reason`           | string?                        | One-line human-facing cause of a `failed` / `superseded` terminus (see below). A **stored event**, not a derived verdict.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### `terminal_reason` — why the run ended badly

`StateManager.finalize` is the sole writer, and its overloads make the reason
contract type-level:

```ts
finalize(runId, 'completed') // reason FORBIDDEN
finalize(runId, 'failed' | 'superseded', reason) // non-empty reason REQUIRED
```

- **Direction check (parse time).** `refineRunCrossFields` rejects a
  `terminal_reason` on any status other than `failed` / `superseded` — a completed
  or still-live run carrying one is a loud parse error.
- **Presence (write time only).** The schema keeps the field optional so terminal
  states written before it existed still parse; they display `reason unavailable`.
- **Never rewritten.** A same-status re-finalize with a _different_ reason throws;
  a missing stored reason (legacy state) may be backfilled exactly once. The cause
  at flip time is history nothing can re-derive, which is why it is stored at all
  rather than derived.

Surfaced by `factory state`, the rescue scan (`/factory:resume`), and the partial
report.

### `RunStatus`

| Value        | Terminal? | Meaning                                                                                                                                                                                                                                                                                                                             |
| ------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `running`    | no        | Actively executing.                                                                                                                                                                                                                                                                                                                 |
| `paused`     | no        | Quota 5h-window breach; waiting out the curve in-session, self-heals.                                                                                                                                                                                                                                                               |
| `suspended`  | no        | State persisted, process exited cleanly; `factory resume` continues it. Two causes: a **quota** 7d-window breach (carries a `quota` checkpoint), or an **operator/engine park** with NO checkpoint — `factory run stop` (Decision 72), `--approve-spec`, or a phase awaiting retry — which a plain resume un-parks unconditionally. |
| `completed`  | yes       | Every task done, rollup CI green; `staging-<run-id> → develop` merged, PRD closed, per-run branch deleted (success).                                                                                                                                                                                                                |
| `failed`     | yes       | A task was failed, the run could not start / wedged (circuit breaker), or the operator abandoned it via `factory run cancel`. `develop` untouched, PRD open, branch kept for rescue (unless `cancel --cleanup`).                                                                                                                    |
| `superseded` | yes       | A fresh run replaced this one; its `staging-<run-id>` branch + PRs were deleted.                                                                                                                                                                                                                                                    |

`develop` receives a run's work **only as a whole PRD** (Decision 34) — there is no
`partial` status. `paused`/`suspended` are **quota** states; `completed`/`failed`/
`superseded` are the terminal **outcomes** — they must stay distinct.

### `SpecPointer`

`{ repo, spec_id, issue_number }` — a run points at its spec, it does not embed
one.

## `TaskState`

| Field                       | Type                          | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `task_id`                   | string                        | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `status`                    | TaskStatus                    | See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `depends_on`                | string[]                      | Task ids this task depends on (the vertical-slice DAG). A deliberate denormalization: copied from the `SpecTask` at seed time and then frozen, so DAG-traversal readers (ready-task selection, rescue drift-scan) read edges off run state without coupling to the spec store.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `escalation_rung`           | int ≥0                        | Current rung on the producer escalation ladder (0 = starting).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `producer_role`             | `test-writer \| implementer`? | Which producer role is/last ran.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `test_revision_feedback`    | string?                       | The implementer's defect reason on a `test-defective` recovery (a wrong RED test, [Decision 38](../explanation/decisions.md#decision-38--defective-red-test-recovery-the-implementer-reports-it-the-test-writer-regenerates-it)). Set when the implementer raises `test requires revision`; injected into the regenerating test-writer's prior-failure context; cleared once the test-writer returns `done`. **Transient — not a failure field; allowed on any status.**                                                                                                                                                                                                                    |
| `needs_context`             | `{question, answer?}`?        | The producer's open NEEDS_CONTEXT question ([Decision 69](../explanation/decisions.md)). Written on the **first** NEEDS_CONTEXT at a phase (the task re-spawns ONCE at the same rung with the question injected); a **second consecutive** NEEDS_CONTEXT fails the task `needs-context` with the question refreshed. `answer` is written only by [`factory rescue apply --answer`](./cli.md#rescue-apply) and is injected alongside the question on the post-reset re-spawn. Cleared when a producer returns `done` (any role). **Deliberately PRESERVED by `resetTaskRow`** (unlike most transients — the open question is the point of the reset). **Transient — allowed on any status.** |
| `last_failing_gates`        | string[]?                     | The failing gate-id set (sorted, holdout excluded) of the LAST blocked merge-gate verify ([Decision 71](../explanation/decisions.md)). An event record — when the next blocked verify fails the **identical** set, the escalation is routed to the `tests` phase (the RED test is suspected as the broken arbiter, carrying `test_revision_feedback`) instead of re-rolling the implementer, unless `tdd_exempt`. Cleared on the advancing verify write, on `doneTaskRow`, and by `resetTaskRow`. **Transient — allowed on any status.**                                                                                                                                                    |
| `reviewers`                 | ReviewerResult[]              | Per-reviewer panel results (the merge gate is derived from these).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `cross_vendor_absent`       | `{ reason: string }`?         | Set _iff_ the advancing verify pass ran **without** an independent cross-vendor (Codex) reviewer ([Decision 44](../explanation/decisions.md#decision-44--verifier-upgrades-grep-rescue-claim-only-verification-real-cross-vendor)). A deliberate **derive-don't-store exception**: which executor actually reviewed is not derivable after the fact, so it is an event record like `reviewers[]` — written/cleared in the _same_ advance write as `reviewers`. Surfaced by the partial report (`## Review independence`) and the run summary (`tasks_without_cross_vendor`).                                                                                                                |
| `branch`                    | string?                       | Run-scoped branch `factory/<run_id>/<task_id>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pr_number`                 | int >0?                       | PR number once created.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `failure_class`             | FailureClass?                 | Set _iff_ `status === "failed"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `failure_reason`            | string?                       | Human-facing fail reason; set _iff_ failed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `phase`                     | TaskPhase?                    | The `next-action` orchestrator's resume cursor (see below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `merge_resyncs`             | int ≥0 (default 0)            | Ship live-merge re-sync count (see below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `holdout_evaluator_retries` | int ≥0?                       | Same-rung verify re-runs consumed by holdout **evaluator** faults (see below). Absent = 0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `spawn_in_flight`           | object?                       | Spawn-in-flight checkpoint for idempotent re-spawn, carrying the emit-time `spawned_at` clock read by stall-TTL detection (see below).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `e2e_feedback`              | string?                       | Feedback carried from a failing e2e journey into this task's NEXT implementation pass (the e2e reopen loop, [Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag)). Set by the e2e coroutine when it reopens the task (via `resetTaskRow`); injected into the producer's prior-failure context. **Transient — not a failure field; allowed on any status.**                                                                                                                                                                                                                                                          |
| `started_at` / `ended_at`   | string?                       | ISO-8601.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

`TaskState` stores **no** `risk_tier`. The single producer dial (`low | medium |
high`, set at spec time and never re-assessed mid-run) lives on the `SpecTask` and
is read live via the spec pointer — never copied into run state (derive-don't-store,
Decision 25). On-disk state written before this change still parses: the schema
strips the now-unknown key, and `schema_version` is unchanged.

### Plugin updates mid-run

Updating the plugin while a run is live is **supported iff `schema_version` is
unchanged** (currently the literal `3`): the persisted state parses under the new
engine and the run simply drives on. Two consequences are accepted by design:

- **Behavior may differ across engine versions within schema v3.** All state
  additions are additive-optional, so a run started under an older engine picks up
  the new engine's orchestration on its next `factory next-task`/`next-action`
  call. There is no `created_by_version` stamp — the state does not record which
  engine created it.
- **Merged-settings staleness** (e.g. a template or hook change shipped by the
  update) is handled by the Decision 31 preflight: rescaffold + relaunch the
  session, not the run.

A `schema_version` change fails **loud** at `StateManager.guardedParse` with the
remedy in the error ("created by an older factory version; start a fresh run" —
Decision 52). It never silently migrates or drops state.

### `TaskStatus`

| Value       | Terminal? | Meaning                                                                |
| ----------- | --------- | ---------------------------------------------------------------------- |
| `pending`   | no        | Not started, or blocked on an unsatisfied dependency.                  |
| `executing` | no        | A producer phase (test-writer / implementer) is in flight.             |
| `reviewing` | no        | The merge gate (gates + panel) is in flight.                           |
| `shipping`  | no        | Verified; PR open / merging into the run's `staging-<run-id>` branch.  |
| `done`      | yes       | Merged into `staging-<run-id>` (success).                              |
| `failed`    | yes       | Ladder exhausted; a classified loud fail (pairs with `failure_class`). |

### `FailureClass`

A closed set (adding one is a design change):

| Class                   | Meaning                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capability-budget`     | The producer could not meet the bar within the escalation ladder's budget.                                                                                                                                                               |
| `spec-defect`           | The failure is in the spec/target itself (e.g. an untestable criterion).                                                                                                                                                                 |
| `blocked-environmental` | An external blocker (CI infra, network, a missing dependency).                                                                                                                                                                           |
| `needs-context`         | A producer asked a question the repo/spec cannot answer, twice (Decision 69). The question is persisted on `task.needs_context`; a human answers via `factory rescue apply --task <id> --answer "<text>"`. Rescue-recoverable.           |
| `blocked-dependency`    | A cascade victim: a dependency failed, so this task never ran (Decision 72). Retryable as-is once the failed dependency is reset — rescue treats it recoverable. Circuit-breaker and e2e-assessment sweeps stay `blocked-environmental`. |

### `ReviewerResult`

`{ reviewer, verdict (approve|blocked|error), artifact?, confirmed_blockers }`.
Cross-field coherence is enforced: `approve ⇒ 0` confirmed blockers; `blocked ⇒
≥1`; `error` is unconstrained.

### `phase` — the `next-action` orchestrator's resume cursor

`"preflight" | "tests" | "exec" | "verify" | "ship"` (optional). The precise
machine cursor for `factory next-action`: which phase the task is at, or resuming at.
The `next-action` orchestrator reads it to resume after a crash; it is written by `markInFlight`.

- The lossy `status` (executing / reviewing / shipping …) stays the **human-facing**
  summary; `phase` is the **machine cursor**.
- **In-flight ⇒ cursor present (schema invariant, Decision 52).** `refineTaskCrossFields`
  rejects any `executing` / `reviewing` / `shipping` row whose `phase` is absent — the
  orchestrator writes `phase` in lockstep with `status`, so an in-flight row without a
  cursor is stale state from an older factory version (loud parse error naming "start a
  fresh run", not a `status → phase` guess table).
- **Absent** = not started — the orchestrator resumes at `preflight`.
- On a **terminal** row (`done` / `failed`), `phase` holds the _last in-flight
  stage_, not a resume point — terminal writers do not clear it.

(The literals duplicate the phase machine's `TASK_PHASE_ORDER` deliberately, so
`src/core/state` need not import the phase machine; a cross-check test keeps them
equal.)

### `merge_resyncs` — ship live-merge re-sync budget

`int ≥0` (default `0`). The number of times the task's `ship` phase refused a live
merge and re-routed back through `exec` to re-sync. The `next-action` orchestrator enforces the cap
(`MERGE_RESYNC_CAP`) and persists the count so the budget survives process
boundaries; exhausting it fails the task as `blocked-environmental`.

The serial merge writer (`MergeSerializer.merge`, `src/git/serial-writer.ts`)
re-reads the PR **inside** the app-level merge lock before deciding. Right after a PR
push/update GitHub reports `mergeable: UNKNOWN` for a beat while it computes
mergeability in the background — a transient state, not a real conflict. Treating it
as an immediate refusal would burn a full re-sync out of this budget on a PR that was
actually fine, so the writer first **polls** (`readSettledPr`) while `mergeable ===
'UNKNOWN'`: bounded at `DEFAULT_MERGEABILITY_POLL_MAX_TRIES` × `DEFAULT_MERGEABILITY_POLL_INTERVAL_MS`
(5 tries × 2 s ≈ 10 s ceiling; override via `MergeSerializerOptions.mergeabilityPoll`).
It stops as soon as `mergeable` settles to any terminal value (`MERGEABLE` or
`CONFLICTING`) or the budget is spent, then falls through to the existing allow-list
logic unchanged — a still-`UNKNOWN` PR after the poll refuses exactly as before, so
the poll is never worse than a single read. The poll runs while holding the merge
lock, so its ceiling stays well under the lock's stale window (`MERGE_LOCK_DEFAULTS.stale
= 30 s`) to avoid a concurrent acquirer breaking the "stale" lock mid-poll.

### `holdout_evaluator_retries` — evaluator faults are not producer misses

The holdout validator can break its own output contract. Before scoring, the engine
classifies the raw validator output (`classifyHoldoutOutput`); four shapes are
**evaluator failures**, not producer misses:

- unparseable JSON,
- wrong verdict cardinality (verdict count ≠ withheld-criteria count),
- criterion-text mismatch at a position (the positional anti-spoof check),
- a `satisfied: true` verdict with blank evidence.

An evaluator failure persists **no verdicts** and does not touch the escalation
rung: it re-runs the verify wave at the **same rung**, incrementing this counter.
The cap is `HOLDOUT_EVALUATOR_RETRY_CAP = 2` (`src/orchestrator/record.ts`);
exhausting it fails the task **`blocked-environmental`** — the evaluator is broken,
so charging the producer would be a lie.

This is distinct from `spawn_in_flight.redrives` (hung-spawn respawn,
[Decision 66](../explanation/decisions.md)), which bounds output that never
arrived; this bounds output that arrived broken. A well-formed **miss**
(`satisfied: false`, including a 0/N sweep) is not an evaluator failure — it
records normally and stays blocking via the merge gate.

### `spawn_in_flight` — idempotent re-spawn checkpoint

`{ phase: "tests"|"exec"|"verify", rung: int ≥0, tip_sha: string, spawned_at: number, redrives: int ≥0 }`
(optional). The checkpoint that makes a stop-mid-spawn plus `factory resume`
idempotent. Producers commit to the **shared** task worktree, so a stop in the
post-spawn / pre-record window leaves the abandoned producer's partial commits (and
uncommitted edits) on the task branch.

- **Set on a fresh spawn.** When the orchestrator emits a spawn for `(phase, rung)`, it
  records the task-branch `tip_sha` at emit time.
- **Reset on a matching re-spawn.** When a resume re-enters the **same** `(phase,
rung)` before any results were recorded, the orchestrator resets the worktree to
  `tip_sha` — discarding **only** the interrupted phase's work (prior completed
  phases live below that tip and survive) — then re-spawns clean.
- **Cleared on a terminal write.** `complete` / `fail` clear it; a record need not,
  because every forward edge changes `(phase, rung)` (advance moves the phase,
  escalate bumps the rung), so a stale checkpoint can never match.
- **Scope.** `phase` is the spawn-phase subset (`tests | exec | verify`) — preflight
  and ship never spawn. A `verify` re-spawn's reset is a no-op (the panel reviewers
  run in their own isolated worktrees, so the shared worktree HEAD never moved).
- **`spawned_at` — stall-TTL clock.** Epoch **seconds** (the shared quota clock,
  `OrchestratorDeps.now()`) stamped at spawn emit and refreshed on a matching re-entry
  (`src/orchestrator/orchestrator.ts`). `next-task` reads it to band a task's spawn age
  into the `work` envelope's advisory `stale` (`stallTtlMinutes < age ≤ hungSpawnMinutes`)
  or `hung` (`age > hungSpawnMinutes`, kill-even-if-alive — Decision 66) lists (a
  silently-dead or hung agent otherwise never self-heals in a live session — see
  [cli.md](./cli.md#next-task)). Detection is read-only: no status change. Defaults to
  `0` (epoch) so an untimed checkpoint persisted before this field existed parses as
  maximally aged (it lands in `hung`) — an untimed in-flight spawn should be flagged
  for re-drive, not silently trusted.
- **`redrives` — bounded re-drive budget (Decision 66).** Matching `(phase, rung)`
  re-entries already consumed. Incremented by the orchestrator's re-entry branch; a
  re-entry that would exceed `SPAWN_REDRIVE_CAP` (2) instead fails the task
  `blocked-environmental` (rescue-recoverable, so finalize → rescue-auto → page own the
  escalation). Resets naturally on any phase/rung advance (a fresh checkpoint is written
  with `0`). Defaults to `0` so a checkpoint persisted before this field existed parses
  with a **full** budget — safe: the cap bounds future re-entries only (the opposite
  gotcha from `spawned_at`).

(The `phase` literals duplicate the orchestrator's spawn-phase set deliberately, so
`src/core/state` need not import the orchestrator; a cross-check test keeps them equal.)

## `QuotaCheckpoint`

`{ resets_at_epoch?, binding_window?: "5h"|"7d" }` — the minimal state a resumable
run persists. Present _iff_ the run was parked by a **quota** breach; resume must
clear it before returning to `running`. A **non-quota** park (`factory run stop`
— Decision 72, `--approve-spec`, or a phase awaiting retry) is `suspended` with the
checkpoint **absent** — `planResume` clears such a park unconditionally, without
re-checking any window.

## `self_heal`, `human_touches` & `misses` — the stored-event exceptions

Derive-don't-store forbids storing anything re-derivable from ground truth. These
three fields are its **only sanctioned exceptions**: each records _history that no
state or git re-derivation can recover_ — an EVENT, not a verdict. (The precedent
is `TaskState.reviewers` and `cross_vendor_absent`, which are event records for the
same reason.) `self_heal` is absent until the first auto-rescue; `human_touches`
and `misses` default to `[]`. None ever holds a gate pass/fail boolean.

### `self_heal`

`{ attempts, last_at }?` — the bounded auto-rescue ledger
([Decision 48](../explanation/decisions.md#decision-48--factory-recover--bounded-auto-rescue-self-heal),
bound raised by [Decision 60](../explanation/decisions.md#decision-60--autonomous-forward-only-adoption-write-side)).
Stamped **inside the same locked `applyRescue` mutation** that performs an auto
reset (`src/rescue/apply.ts`). `factory rescue auto` refuses once `attempts >=
SELF_HEAL_MAX_ATTEMPTS` (**3**, flat count) and `finalizeRun` only auto-fires while
`attempts < 3`, so the self-heal loop is bounded to **three cycles per run** — "how
many self-heal cycles already ran" cannot be recovered from state or git once the
reset lands, so it must be stored. Forward-only **adoption** (Decision 60) never
touches this ledger: recording GitHub truth the engine can prove is neither a
recovery attempt nor a stored event, so adoptions are free.

### `human_touches`

`{ kind, at }[]?` — the append-only human-intervention ledger
([S11, Decision 49](../explanation/decisions.md#decision-49--observability-touch-metric--statusline-progress--score---fleet)).
One entry per human action on the run:

| `kind`     | Appended when                                                                                                                                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `launch`   | `run create` — the run's first (and, on a clean lights-out run, only) touch.                                                                                                                                       |
| `conflict` | a `--supersede` resolution — stamped on the **new** run alongside its `launch`.                                                                                                                                    |
| `resume`   | a human resume (via `/factory:resume`) that actually **cleared a park** (not a no-op resume).                                                                                                                      |
| `recover`  | an approved `factory rescue apply` that did work — ONE touch covers the whole approved plan, including apply's own park-clear tail (the kind name predates Decision 50's rename; retained for stored-data compat). |

`factory rescue auto` self-heal **never** appends — it is not a human. Every append is mirrored
to `runs/<run-id>/metrics.jsonl` as a `human_touch` event (observability only). The
touch METRIC stays derived, never stored: `(completed ? 1 : 0) / touches.length`,
reported by [`factory score`](./cli.md#score) (`touches` + `touch_metric` fields)
and the run report's "Human touches" line. Absent ledger → metric reads `null`/n/a,
never a fabricated `0`.

### `misses`

`{ task_id, at, note, lens? }[]` — the append-only review-miss ledger
([Decision 61](../explanation/decisions.md#decision-61--closing-the-outer-quality-loop-review-misses-reviewer-value-single-pointer)),
schema default `[]`. A **miss** is a defect found in shipped factory-produced
code, post-merge — the outer quality loop's only human input, written solely by
[`factory miss`](./cli.md#miss). It is a stored EVENT for the same reason as
the other two: "a bug shipped" is irrecoverable history the engine cannot
re-derive. It went to `misses[]` rather than `metrics.jsonl` (whose `emitMetric`
swallows IO errors — the wrong tier for history that must not be lost) or a gh
label (net-new write surface, zero derivational value). A schema `superRefine`
rejects any `task_id ∉ tasks`. `lens` names the reviewer lens that _should_ have
caught it (or `'none'`), joining misses to reviewer value. Derived roll-ups:
`score` reports `misses` + `misses_by_lens`; `score --fleet` adds
`total_misses` / `misses_per_run` / `misses_by_lens`; `score --reviewers`
attributes misses per lens. All derived from the ledger, never mirrored.

## `DocsPhase`

`{ status: "done" | "failed", reason?, attempts?, ended_at }` — the engine-owned documentation
phase marker ([Decision 37](../explanation/decisions.md#decision-37--documentation-is-an-engine-phase-before-finalize)).
Absent until the phase runs. `done` once scribe's output is committed onto the
`staging-<run-id>` branch (or a no-op pass); `failed` (with a `reason`) records a
failed attempt. `attempts` is the cumulative 1-indexed attempt count (a `done`
marker may omit it → treat as 1). While `attempts < MAX_DOCS_ATTEMPTS` (2) the run sits `suspended`,
resumable via `/factory:resume`; once the cap is hit docs become best-effort and the run
finalizes `completed` without a docs commit.
There is no `skipped` value — when docs are not applicable (no `/docs` directory or
`package.json` `factory.docs.enabled: false`), `factory next-task` decides applicability
read-only and the marker simply stays absent.

## `TraceabilityPhase`

`{ status: "done" | "failed", reason?, attempts?, verdicts, ended_at }` — the engine-owned
PRD-traceability phase marker ([Decision 47](../explanation/decisions.md#decision-47--spec-hardening-specifiability-gate-prd-traceability-approve-spec-park)).
Runs on every non-debug run between the e2e phase and docs. `verdicts` is one row per
numbered PRD requirement — `{ requirement, verdict: "met" | "partial" | "unmet", evidence }`.
`done` means the audit completed and no requirement is `unmet` (a `done` marker may never
carry an `unmet` verdict — the cross-field invariant); `partial` verdicts pass the gate but
surface as gaps in the run report. `failed` (with a `reason`) records a condemning audit —
any `unmet` verdict fails the run and blocks the finalize rollup (a concluded audit is
**never retried** — verdicts are judgment, not a transient failure). `attempts` counts
only auditor **crashes**: a crashed audit retries once (`MAX_TRACE_ATTEMPTS` = 2), and a
crash at the cap fails the run with empty `verdicts` (unlike docs, traceability is a
delivery gate, never best-effort-done).

## `E2ePhase`

`{ status?: "done" | "failed", reason?, advisory?, attempts?, author_attempts?, manifest, reopen_counts, adjudication?, adjudication_counts?, ended_at? }`
— the engine-owned e2e-phase marker + author manifest ([Decision 39](../explanation/decisions.md#decision-39--e2e-is-a-run-level-engine-phase-criticality-is-persistence-not-a-tag),
overhauled by [Decision 40](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)),
present only on an `--e2e` run and absent until the phase first runs.

Unlike `DocsPhase` (written once, never re-entered), this marker is **re-fired** on every
reopen: `status` is cleared back to absent when a failing journey reopens a task, so the
phase runs again once the reopened task settles. Several fields **persist** across the clear:

- `manifest` — the author's spec→task rows (`{ task_ids, spec_path, kind: "critical" | "throwaway", title? }`),
  fixed at authoring time and reused on every later pass (the author is not re-invoked;
  throwaway specs are re-run, not re-authored). This is the only join from a failing spec
  back to its task. `title` (Decision 40 D12) is the human-readable journey name surfaced in
  the run report.
- `reopen_counts` — per-`task_id` cumulative reopen count, bounding each task by
  `e2e.reopenCap` across the whole run, not just one pass.
- `adjudication_counts` — per-`spec_path` count of adjudications spent (Decision 40 D7, cap 1
  per spec per run); a spec failing again after its one adjudication is a regression.

Two more fields track sub-phase bookkeeping: `author_attempts` (Decision 40 D5 — a crashed or
unparseable author earns ONE automatic re-spawn before the phase fails; deliberate
blocked/needs-context verdicts never retry) and `adjudication` — the **in-flight adjudication
cursor** (`{ specs, attempts, requested_at }`), present only between "the suite hit unmappable
pre-existing failures" and "the adjudicator's result was recorded". Its presence is what routes
`runE2eRecord` to the adjudication leg.

`status` semantics: absent = not yet run this pass (or cleared for a reopen re-fire);
`done` = every critical spec present and green (the run proceeds to docs); `failed` (with
`reason`) = the run fails. A critical spec counts as proven only when it appears in the
results as `passed` or `flaky` — an **absent, `failed`, or `skipped`** critical spec is a
non-pass. An unmappable critical failure (no manifest entry names the spec) no longer fails the
run directly — it routes through **adjudication** (regression → fail; intentional-change →
rewrite the spec, re-prove, merge, re-run). `failed` reasons include: a residual critical miss
past the reopen cadence, an **adjudicated regression**, a **tooling failure**
(nonzero Playwright exit / reporter `errors[]` with no spec marked failed), an author
manifest that references an **unknown `task_id`** (validated against `run.tasks` at ingest)
or an unsafe/absolute `spec_path`, an author branch that violates the trust boundary (a change
outside `testDir`, or an undeclared file inside it — carve-out for the assessment-owned
`e2e/support/**` + `e2e/auth.setup.ts`), a rejected fail-first proof, an exhausted `reopenCap`,
or a non-`DONE` author status. `advisory` is the `done`-side counterpart of
`reason` — a non-gating note (e.g. residual throwaway red) enforced as **never present on
`failed`** (mirroring the `reason`-set-IFF-`failed` invariant). `attempts` is the
cumulative 1-indexed pass count. A reopen never touches `run.status`, which stays
`running` until `finalize`.

A `failed` verdict is **repairable, not permanent**: `factory rescue apply --reset-e2e`
clears it via the shared `reopenE2ePhase` helper. The clear is **manifest-aware**:

- A phase that failed **after** authoring (non-empty `manifest`) has
  `status`/`reason`/`advisory`/`ended_at` dropped and any live `adjudication` cursor dropped,
  while `manifest`, `reopen_counts`, `adjudication_counts`, and `attempts` are **preserved** —
  the phase re-enters and re-derives on the next pass without re-invoking the author.
- A phase that failed **before** a manifest was ever authored (empty `manifest` — every
  pre-authoring `markFailed`: author crash, non-`DONE` status, unsafe `spec_path`) is dropped
  **entirely** (`e2e_phase` set to absent), so `runE2eEmit`'s `run.e2e_phase === undefined`
  gate re-fires and the author actually re-spawns. Preserving an empty-manifest phase would
  otherwise let `runSuiteAndDecide` `markDone` a false "done" with zero e2e coverage.

This is never automatic —
`rescue scan` surfaces it as `e2e_failed: true` (folded into `needs_rescue` even when every
task is `done`), and `apply` clears it only on the explicit `--reset-e2e` flag. The same
`--reset-e2e` also drops a failed run-start `e2e_assessment` (surfaced by `rescue scan` as
`e2e_assessment_failed`). Plain `resume` does not clear it; it only re-checks the quota gate.

## `E2eAssessment`

`{ status?: "done" | "failed", reason?, warning?, resolved?, affected_specs, attempts?, ended_at? }`
— the run-start e2e-assessment record ([Decision 40 D3](../explanation/decisions.md#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)),
written once per `--e2e` run **before any task executes** and present only on an `--e2e` run.

- `status` — absent = not yet concluded (never spawned, or a crashed attempt awaiting its one
  retry); `done` = machinery validated (or steady-state, already present) — tasks may proceed;
  `failed` (with `reason`) = boot- or machinery-impossible, so the run **fails loud in plain
  language** and every non-terminal task is swept `blocked-environmental`.
- `warning` — a degraded-coverage note on a `done` assessment (e.g. auth machinery couldn't be
  resolved → logged-out coverage only). Surfaced in the run report as `e2e_warnings`.
- `resolved` — `{ start_command?, base_url? }` the assessor resolved and wrote into the repo's
  `playwright.config.ts` (the single source of truth, D10). `resolveBootConfig` reads a config
  override if present, else this.
- `affected_specs` — the coverage forecast: rows of `{ spec_path, task_ids, expectation }` over
  EXISTING committed specs, `expectation` being `needs-update` (a task deliberately changes what
  the spec asserts) or `should-still-pass` (a failure is a regression). This routes the e2e
  phase's adjudication of unmappable failures.
- `attempts` — assessor spawn attempts (crash-retry bookkeeping, cap 2); a deliberate
  `-impossible` verdict is final and never retried.
