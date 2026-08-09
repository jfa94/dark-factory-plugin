# Design Decisions

This document explains key architectural choices and their rationale.

> **Cutover annotation (2026-06-10, Scribe).** This ledger (D1–D27) is preserved
> verbatim as the historical design record. The project has since completed a
> big-bang rewrite from the original bash implementation to a Node + TypeScript
> engine, and a cutover commit deleted the bash sources. Decisions framed in
> bash-era terms — e.g. Decision 1's "41 pipeline-\* bin scripts / 13 hooks" — now
> map onto the **Model A** TypeScript surface: the deterministic engine is the
> single `factory` CLI (`src/` → `dist/factory.js`) plus the `factory-hook`
> dispatcher (`dist/factory-hook.js`, 8 guards in `hooks/hooks.json`); agents are
> the markdown surface (`commands/`, `agents/`, `skills/`). The _principle_ each
> decision records is unchanged; only the implementation substrate moved. For the
> current architecture see [model-a.md](./model-a.md) and
> [../architecture/overview.md](../architecture/overview.md). No decision below has
> been edited or removed.

## Decision 1: Deterministic-First Architecture

**Choice:** Approximately 5.4:1 ratio of deterministic components (bin scripts, hooks) to non-deterministic (agents). If a step CAN be a script, it MUST be a script.

**Why:**

- Agent instructions are followed approximately 70% of the time
- Hooks and scripts enforce at 100%
- Concrete operational rules outperform abstract directives by 123% (research)

**Result:** 41 pipeline-\* bin scripts, 10 plugin agents, 13 hooks. Scripts handle validation, state, classification, parsing. Agents handle code generation, review, spec creation.

---

## Decision 2: Runner Runs in Main Session

**Choice:** The runner logic lives in `commands/run.md` and runs in the invoking Claude Code session. It is not a sub-agent.

**Why not runner-as-sub-agent?**

Claude Code only exposes the `Agent` tool to the top-level session. Sub-agents cannot themselves spawn further sub-agents. An runner-as-agent therefore deadlocks the first time it needs to dispatch `spec-generator`, `implementer`, or a reviewer.

**Why not a pure script runner?**

Only agent sessions can invoke the `Agent` tool. A shell script cannot spawn sub-agents.

**Why not pure agent orchestration?**

State management, circuit breakers, DAG traversal, and classification MUST be 100% reliable. Agent instructions for these would fail approximately 30% of the time.

**Isolation:**

`factory run create` materialises the run's staging branch in a dedicated worktree at `.claude/worktrees/orchestrator-<run_id>/` (`ensureStaging`, `src/git/staging.ts`); the runner `cd`s into it at the end of Phase 2 (`skills/pipeline-runner/SKILL.md`) and runs all git operations there. The user's primary checkout is never touched — the engine never checks staging out in the main dir (a `checkout -B` there parked it on the run's staging branch and later phase-merge checkouts collided: `already used by worktree` — smoke defect D2). Sub-agents (`spec-generator`, `implementer`, reviewers, `scribe`) continue to run with `isolation: worktree`.

**Mitigations:**

- State persistence: every state transition is written by a bin script
- Circuit breakers: deterministic limits prevent runaway execution
- Idempotent scripts: re-running produces the same output
- Resume capability: interrupted runs recover from persisted state

---

## Decision 3: Bundle All Pipeline Agents

**Choice:** All agents used by the pipeline are bundled inside the plugin's `agents/` directory. No user-provided agents are required.

**Why:**

- Documented behavior works out of the box — no missing-agent silent degradation
- Consistent output formats across all consumers; `pipeline-parse-review` never breaks
- Plugin ships as a complete unit; install = fully functional

**Trade-off:** Bundled agents pin behavior to the plugin version. User edits to plugin agents propagate to all pipeline runs from that project.

---

## Decision 4: Separate implementation-reviewer from quality-reviewer

**Choice:** Create a new `implementation-reviewer` agent in the plugin rather than reusing the existing `quality-reviewer` directly.

**Why:**

- `implementation-reviewer` adds acceptance-criteria validation
- `implementation-reviewer` validates holdout criteria (criteria the implementer never saw)
- `implementation-reviewer` outputs machine-parseable structured format
- `implementation-reviewer` is round-aware (tracks review iteration)

The existing `quality-reviewer` is still used as a fallback when Codex is unavailable.

---

## Decision 5: Holdout Specs in Plugin Data, Not Repo

**Choice:** Store withheld acceptance criteria in `${CLAUDE_PLUGIN_DATA}/holdouts/`, outside the git worktree.

**Why:**

- Task-executors run in isolated worktrees
- If holdouts were in the repo, executors could read them
- Plugin data directory is inaccessible from worktrees
- Maintains holdout integrity

---

## Decision 6: Three-Tier Component Model

**Choice:** Three distinct tiers with clear responsibility boundaries.

| Tier        | Reliability                | Responsibility                                 |
| ----------- | -------------------------- | ---------------------------------------------- |
| Hooks       | 100% enforcement           | Safety constraints that must never be violated |
| Bin scripts | 100% given valid input     | Logic with a single correct answer             |
| Agents      | ~70% instruction following | Tasks requiring judgment, creativity, NLU      |

**Why not just hooks + agents?**

Hooks fire on specific events. They cannot be called on-demand by the runner. Scripts fill the gap: on-demand deterministic logic.

**Why not just scripts + agents?**

Hooks are un-bypassable. Even if the runner ignores instructions, hooks still fire. Branch protection via hook blocks force-push regardless of agent behavior.

---

## Decision 7: No External State Server

**Choice:** JSON files in `${CLAUDE_PLUGIN_DATA}` for all state management.

**Why:**

- Human-readable, trivially inspectable with `jq`
- No dependencies
- Same pattern as the original Bash pipeline

**Exception:** The metrics MCP server uses SQLite because metrics queries benefit from SQL aggregation.

**Atomic writes:** All state writes use `write-to-temp + mv` pattern to prevent corruption.

---

## Decision 8: Worktree Isolation Replaces Directory Locking

**Choice:** Each implementer runs in its own git worktree.

**Why:**

- True isolation: each implementer has its own working directory and branch
- No possibility of git conflicts between concurrent tasks
- No deadlocks from held locks
- Native support via Claude Code's `isolation: "worktree"` frontmatter

The lock (`pipeline-lock`) exists only to prevent two runner instances from running simultaneously.

---

## Decision 9: Adversarial Review with Vendor Fallback

**Choice:** Use OpenAI Codex's adversarial review mode as primary reviewer when available; fall back to Claude Code's implementation-reviewer.

**Why Codex as primary:**

- Purpose-built adversarial review command
- Different vendor creates genuine independence (different biases, failure modes)
- Actor-Critic pattern is strongest when Actor and Critic are distinct systems

**Why Claude Code as fallback:**

- Codex may not be installed or authenticated
- Fallback must be fully functional
- `review-protocol` skill injects adversarial posture

Detection is deterministic: `pipeline-detect-reviewer` checks Codex availability via CLI commands.

**Inverse-hallucination guards (fall through to fallback):**

In addition to "codex unavailable" and "codex rc non-zero", the runner treats two pathological codex outputs as faults and routes through the Claude Code fallback path (with a `task.review.codex_inverse_hallucination` metric logged):

1. `REQUEST_CHANGES` with zero verified findings — every finding's `verbatim_line` failed exact-line match against the diff, leaving the implementer nothing to fix.
2. `APPROVE` / `APPROVED` with non-zero `blocking_count` — internal contradiction; the review cannot be trusted to gate the task.

The fallback path is identical to a codex CLI failure: the bogus verdict file is discarded, agent reviewers are spawned, and the task continues. See `docs/reference/bin-scripts.md` (`pipeline-codex-review` and `pipeline-run-task`) for details.

---

## Decision 10: Dual Usage Checks (5h and 7d)

**Choice:** Run two independent usage checks before each task spawn with distinct behaviors.

**Why not coalesce into a single metric?**

- 5-hour limit is a burst constraint (temporary, appropriate to wait)
- 7-day limit is a budget constraint (indicates sustained over-consumption, should stop)

**5-hour behavior:**

- Over threshold: wait until reset

**7-day behavior:**

- Over threshold: end gracefully, mark partial
- Override: `/factory:run resume --allow-7d-over` bypasses the local circuit-breaker decision (see [Rate Limiting: Override](./rate-limiting.md#override))

**Why source from statusline?**

Claude Code's statusline JSON includes `rate_limits` data. The `statusline-wrapper.sh` script captures this to `usage-cache.json` on every statusline update — no API calls, no token cost, real-time data.

---

## Decision 11: Existing User Hooks Fire Automatically

**Choice:** Do NOT duplicate the user's existing hooks in the plugin.

**Why:**

- User's hooks fire for ALL agent sessions including plugin agents
- Duplicating would cause double-execution
- User customizations should be inherited, not overridden

Plugin-specific hooks (branch-protection, run-tracker, stop-gate) cover pipeline-specific concerns only.

---

## Decision 12: Staging Branch as Integration Point

**Choice:** All task worktrees branch from `staging`, and all task PRs target `staging`.

**Why:**

- `main` and `develop` are protected branches
- Multiple concurrent tasks modifying protected branches would conflict
- `staging` provides an integration layer without touching `main`
- Humans retain explicit control over what moves to `main`

**Dependent task ordering:**

Task B waits for Task A's PR to merge into `staging` before starting. Sequential execution for dependent tasks, parallel for independent.

**Enforcing the staging base deterministically (`worktree.baseRef: "head"`):**

By default Claude Code's `worktree.baseRef` is `"fresh"` — every `Agent({isolation: "worktree"})` worktree branches from `origin/<default-branch>` (here `origin/main`), **ignoring the runner's staging HEAD**. That left subagent worktrees on a stale `origin/main` base (the 2026-05-28 bootstrap defect: postexec automated gates failed because `origin/main` lacked pipeline scripts present on staging).

`.claude/settings.json` sets `worktree.baseRef: "head"`, which makes subagent worktrees branch from the **invoking session's local HEAD**. `run create` materialises the orchestrator worktree on the run's staging branch (forked from `origin/develop`, idempotently re-pointed on resume) and the runner `cd`s into it _before_ any subagent spawn (`skills/pipeline-runner/SKILL.md`, end of Phase 2), so every subagent — test-writer, implementer, reviewers, rescue — now births on the current staging tip with no per-agent bootstrap step.

- **Defense in depth:** the test-writer/implementer still run `git checkout -B <branch> origin/staging` (the `_stage_preflight` handler in `bin/pipeline-run-task-phases.sh`) as an _idempotent fallback_ — a no-op once the worktree already births on staging, and the safety net if the setting is absent/overridden. Do not remove it; dropping it would make correctness depend solely on a global setting.
- **Blast radius:** `worktree.baseRef` is project-wide. It also changes interactive human `--worktree` / `Agent({isolation:"worktree"})` use in this repo — worktrees carry local unpushed HEAD instead of a clean `origin/main`. For the pipeline this is strictly more correct; for ad-hoc human use it is a behavior change to be aware of. No per-spawn override exists.
- **Activation:** the `worktree` settings block is read at **session start**, not mid-session — it takes effect on the next session/run after the setting lands (supported since Claude Code v2.1.133).

**Update (2026-06-13):** Same root cause, downstream of this decision — the review panel and holdout-validator inspect a task with `git -C <taskWorktree> diff origin/staging`, **not** `diff staging`. The task worktree forks from the remote-tracking ref `origin/staging` (`createTaskWorktree`, `src/git/worktree.ts`) and never maintains a local `staging` branch, so a bare `diff staging` is stale-or-absent: it degraded silently in session mode and hard-errors in workflow mode. `origin/staging` is the fork point and the deterministic inspect base. See [verifier.md](./verifier.md#how-the-panel-and-holdout-inspect-a-task).

**Update (2026-06-19) — per-run base ref, not a bare `origin/staging`.** Following Decision 33's per-run branch, the inspect base is no longer the single shared `origin/staging` but the run's own `origin/staging-<run-id>`. The orchestrator computes it once from the run's PINNED branch (`base_ref = origin/${resolveStagingBranch(runId, run.staging_branch)}`, `src/orchestrator/orchestrator.ts`) and plumbs it through the spawn `NextAction` (`base_ref` field, [cli.md](../reference/cli.md#next-action)) to every reviewer and the holdout validator; the runner (`skills/pipeline-runner/SKILL.md`) and all seven `agents/*.md` + `skills/review-protocol/SKILL.md` now diff against `<baseRef>`/`${env.base_ref}`, never a hardcoded `origin/staging`. `buildHoldoutPrompt(record, worktree, baseRef)` (`src/verifier/holdout/validate.ts`) requires the base ref and throws if a worktree is supplied without one. A bare `origin/staging` namespace-collides after a repo branch rename and resolves to the wrong/no commit — diffing reviewers against the wrong base.

**Update (2026-06-19) — worktree dependency provisioning at preflight.** `createTaskWorktree` only forks the git tree — it installs no dependencies, but the `test`/`type`/`build` gates run with `cwd=<worktree>` and have no skip-guard, so an empty `node_modules` made them fail closed (the root cause of a stalled run's gate-half never clearing). The preflight handler (`src/orchestrator/handlers.ts`) now runs `provisionWorktree` (`src/git/provision.ts`) immediately after the worktree is created, before the command-gates: it runs the configured `quality.setupCommand` if set, else a lockfile-detected install (`pnpm`/`yarn` frozen install · `npm ci`), else a no-op (Go/Ruby/Deno repos rely on their own runner / `.quality.redTestCommand`). It FAILS LOUD on a non-zero exit, so a broken environment halts as a clear preflight error rather than an opaque downstream gate failure. Because preflight persists its cursor before running, a provisioning (or base-tip-assert) failure leaves the worktree on disk; `createTaskWorktree` is therefore REPLAY-SAFE — on resume it reuses an already-registered worktree (`git worktree list --porcelain` probe → D12 `checkout -B` re-point) instead of a bare `worktree add` that would fatal on the existing path and wedge the run. See [configuration.md](../reference/configuration.md#quality) (`quality.setupCommand`).

---

## Decision 13: Bundled Autonomous Settings

**Choice:** The plugin ships `templates/settings.autonomous.json`. `factory autonomy ensure` materializes a `merged-settings.json` from it; relaunching with `claude --settings <merged-settings.json>` puts the session in autonomous mode. `factory autonomy status` reports whether the current session is autonomous (exits 0/1).

**Detection:** The settings file sets `FACTORY_AUTONOMOUS_MODE=1`. The single predicate is `src/autonomy/mode.ts` (`isAutonomous` = exactly `FACTORY_AUTONOMOUS_MODE === "1"`), shared by the engine gate (Decision 29) and the branch-protection / pipeline guards.

**Why not hook-based swap?**

The session must start with correct settings. Subagents inherit parent session settings. A swap approach risks leaving autonomous settings in place if the pipeline crashes.

---

## Decision 14: CI Integration and Conflict Handling

**Choice:** `pipeline-wait-pr` polls both PR merge status AND CI checks. On CI failure, attempt up to 2 automated fixes. On merge conflicts, attempt one rebase.

**CI failure retry limit (2):**

CI failures from pipeline output should be rare (automated gates run first). Two attempts handle transient issues. Beyond that, human judgment is needed.

**Rebase-once strategy:**

One rebase resolves most simple conflicts. If it still fails, the conflict is likely semantic and requires human review.

---

## Decision 15: Project Scaffolding

**Choice:** `factory scaffold` writes project files idempotently, under a **two-tier
file policy**:

- **MANAGED** — files the plugin is the sole author of: the CI net
  `.github/workflows/quality-gate.yml` and its cost-aware shard helper
  `.github/scripts/shard-mutation-scope.mjs`. These **auto-update by default**:
  when an already-scaffolded repo's copy drifts from the shipped template, the next
  `factory scaffold` overwrites it (reported under `files_updated`). This is the
  propagation path — a template fix (e.g. the 2026-06-18 mutation-shard rebalance)
  reaches downstream repos without a manual delete-and-re-scaffold.
- **SEED** — files the project owns once it touches them: `.stryker.config.json`,
  `.dependency-cruiser.cjs`, `eslint.config.mjs`, `playwright.config.ts`,
  `e2e/example.spec.ts`. Copied verbatim when absent (a load-safe baseline). Once
  present, a seed is auto-refreshed on template change **only while provably
  pristine**: scaffold records the sha256 of each seed's content as written into
  the committed `.factory/scaffold.lock`, and a re-scaffold overwrites a seed
  (reported under `files_updated`, lock re-stamped) only when its on-disk bytes
  still match that recorded hash. Anything else — customized bytes, a missing lock
  entry (repo scaffolded before the lock existed), an unparsable lock, even a git
  line-ending rewrite — reads as **project-owned**: reported under
  `files_present`, never overwritten (fail safe: bad data can never cause a
  clobber). There is no `files_outdated` bucket (retired): a SEED file that has
  grown into a richer project config (e.g. an `eslint.config.mjs` that imports
  `typescript-eslint`/plugins, or a `.dependency-cruiser.cjs` with extra boundary
  rules) is **recognized as current, not stale**. This is what preserves the
  never-fail-close lint property — a fresh repo only ever receives the
  dependency-free baseline (which loads before any plugin is installed), while an
  established repo's full config is left untouched.
  A single compatibility migration is deliberately narrower than the general
  cold-start rule: the two exact pre-lock `e2e/example.spec.ts` templates that
  disabled `playwright/no-skipped-test` are recognized by sha256, replaced with the
  current template, and adopted into the lock. That directive referenced a plugin
  the scaffold never registered, so untouched historical bytes made the generated
  lint gate fail. Any byte of project customization changes the hash and preserves
  project ownership.
- **MERGE** — `.gitignore` and `.claude/settings.json` are reconciled
  non-destructively (append missing entries / merge keys). The `.gitignore`
  guarantee makes the in-repo split **explicit**: each per-machine `.claude/` child
  (`worktrees/`, `projects/`, `settings.local.json`, …) is enumerated individually
  so `.claude/settings.json` stays **tracked** while `.claude/settings.local.json`
  is **ignored** — never via a wildcard `.claude/`, a sibling-enumeration, or a
  global `core.excludesfile` (which is not portable). `docs/factory/**` (the
  in-repo spec mirror) is deliberately **left tracked** as durable, PR-reviewable
  provenance of the spec that drove each merged PR.

**Why scaffold instead of bundled templates?**

Scaffolding files are project-specific artifacts. They belong in the user's
repository, versioned and visible to teammates.

**Why unconditional auto-update only for the MANAGED tier?**

The CI workflow + shard helper encode plugin-owned pipeline machinery, not project
preferences; customizing them is unsupported by contract, and git is the safety net
(an auto-overwrite shows up in `git diff`). SEED refresh is gated on proof of
pristineness because the original "overwriting would destroy customizations" concern
applies to exactly that tier.

**The scaffold lock — how "pristine" is proven (`.factory/scaffold.lock`).**

`{version: 1, seeds: {"<rel>": "<sha256>"}}`, written by `applyTemplate`
(`src/cli/subcommands/scaffold.ts` + `scaffold-lock.ts`) ONLY when scaffold itself
writes a seed, committed so pristine tracking travels with the repo, and persisted
immediately after the seed pass — before the gate-contract/protection steps, whose
refusal paths throw after seeds have already landed on disk. A stale entry
(customized seed) is kept: harmless, and reverting the file to the exact
scaffold-written bytes re-adopts it. The lock is TCB-protected (`scaffold-lock`
rule, `src/hooks/tcb.ts`): a producer that could forge an entry hashing the repo's
customized gate config would schedule it for silent "pristine" reversion to the
weaker plugin baseline on the operator's next scaffold.

**Known limitation — customized SEED files do not receive template updates
(deliberate).**

A _new_ baseline rule added to a shipped SEED template does **not** reach a repo
whose copy was customized — or predates the lock (cold start: no entry can prove
pristineness, so the file is treated as project-owned forever). This is the
unavoidable cost of the project-ownership guarantee: the same rule that refuses to
clobber a repo's grown-up config also refuses to back-fill plugin baseline changes
into it. There is deliberately **no** merge mechanism for SEED files — one would
reintroduce exactly the clobber risk this tier exists to prevent. Such a repo opts
into a refreshed baseline explicitly by deleting its SEED file and re-running
`factory scaffold` (which re-copies the current template and re-adopts it into the
lock). Plugin-owned machinery that _must_ stay in lockstep belongs in the MANAGED
tier, not SEED.

---

## Decision 16: Asymmetric Auto-Merge Strategy

**Choice:** Task PRs (→ staging) auto-merge with `--squash`. The final run-rollup PR (staging → develop) auto-merges with `--merge` (true merge commit).

**Why:**

- Squashing the rollup PR severs staging↔develop ancestry. Next run's `staging-init` cannot FF-reconcile, replays already-shipped work, or aborts on conflict.
- A merge commit on develop keeps staging tip as an ancestor of develop tip. `staging-init` fast-forwards in one step.
- Per-task squash on staging is still desired: collapses the test-writer + implementer commit pair into one logical commit on the integration branch.

**Workflow gate:** `templates/.github/workflows/quality-gate.yml` checks `github.base_ref` to pick the strategy. Repo settings must permit merge commits on `develop`.

**`--delete-branch` on develop-target merges:**

The workflow uses `gh pr merge --merge --auto --delete-branch` for staging-to-develop rollup PRs. This deletes the `staging` branch after the PR merges. This is safe because:

- `bin/pipeline-branch staging-init` checks whether `origin/staging` exists (line 41) and recreates it from `origin/develop` (or the configured base branch) when missing (lines 85-106).
- The concern in this section is about merge _strategy_ preserving history within develop, not about the `staging` ref persisting between runs.

**Migration:** Already-scaffolded repos retain the old single-squash workflow. To pick up both this fix and the Node 24 action-runtime upgrade: delete `.github/workflows/quality-gate.yml` and re-run `pipeline-scaffold`, or patch the file manually to match the new template (asymmetric auto-merge + `checkout@v6`, `setup-node@v6`, `pnpm/action-setup@v6`, `cache@v5`).

---

## Decision 17: Coarse Bash Allow with Hook-Enforced Defense-in-Depth

**Choice:** `templates/settings.autonomous.json` lists `Bash(*)` in `permissions.allow`. The allow-list is intentionally coarse; the security boundary lives in hooks and `permissions.deny`, not in the allow-list.

**Why:**

- In fully autonomous mode there is no human in the loop to approve granular `Bash(...)` permission prompts. A missing allow rule would deadlock the pipeline mid-task.
- The LLM cannot enumerate every shell invocation it will need up front (build tools, test runners, ad-hoc `jq`/`awk`/`grep`, git plumbing, project-specific scripts). Coarse allow + hook-enforced denial is more reliable than fine allow + perpetually-missing rules.
- The real boundary is enforced at execution time by hooks, which fire on every Bash call and cannot be bypassed by an LLM that "didn't get the memo."

**Where the boundary actually lives:**

- `hooks/secret-commit-guard.sh` — blocks `git commit`/`push` when staged content matches the secret regex.
- `hooks/pretooluse-pipeline-guards.sh` — blocks scribe Bash writes outside `/docs/**`, blocks `gh pr create` without an attributable `task_id`, and similar pipeline-shape guards.
- `hooks/_security-common.sh` — shared deny library; `_is_nested_shell_or_hook_bypass` blocks nested-shell and hook-bypass attempts.
- `hooks/write-protection.sh` — blocks `Edit`/`Write` on `main`/`master` and protected files.
- The `permissions.deny` block in the same `templates/settings.autonomous.json` — dense list covering destructive shell patterns (`rm -rf /`, `git push --force*`, `--no-verify`), language `-e`/`-c` interpreters (`python -c`, `node -e`, `eval`), AWS destructive APIs (`iam delete-*`, `s3 rb`, `rds delete-*`), and writes to `~/.ssh`, `~/.aws`, `~/.claude/**`, etc.

**Why the nested-shell / hook-bypass guard is autonomous-only (by design, not an oversight):**

The TS port (`decideBranchProtection`, `src/hooks/branch-protection.ts`) denies a nested
shell (`bash -c …`, `sh -c …`) or hook-bypass **only when `isAutonomous()` is true** — a
faithful port of the bash `_is_nested_shell_or_hook_bypass` gate. A nested shell is a
legitimate, everyday tool in a **human** dev session (build scripts, one-liners, editor
integrations); denying it there would be a constant false-positive. It is dangerous only
in an **unattended** run, where it is the canonical way to smuggle a git write past the
parsed-command guards (the guard parses the visible command string; a nested shell hides
the real command from that parse). Scoping the gate to autonomous mode is therefore the
correct security/usability trade-off, not a gap — the same single `isAutonomous` predicate
that gates every other autonomous-only rail (Decision 13/29).

**Why not narrow the allow-list?**

Every narrowing has been tried and produces the same failure mode: the pipeline halts on a command the allow-list did not anticipate, and there is no operator to approve it. The cost of one missed allow rule is a stalled run; the cost of one missed deny rule is bounded by the hook layer.

**`additionalDirectories` (working-directory boundary):** The autonomous merged-settings (E2) declares a `permissions.additionalDirectories` entry plus `Read|Write|Edit(<data-dir>/**)` allow rules covering the data dir. The allow-list grants the _tool_, but Claude Code's working-directory boundary is an independent check: a built-in file tool (Read/Write/Edit) touching a path outside the launch directory still prompts the user to "add" the directory. The plugin writes to out-of-tree paths under the data dir (`runs/`, `specs/`); declaring the single data-dir parent grants recursive access so those writes never trip the boundary — fatal in autonomous mode, where no human is present to approve the prompt. E1 (the scaffolded target repo) declares the equivalent entry too, but — corrected below — in a separate GITIGNORED file, never in the committed `.claude/settings.json`.

**Why these rules are BAKED, never `${CLAUDE_PLUGIN_DATA}` (2026-06-20 fix):** Both emitters resolve the canonical data dir at emit time and write a _concrete path_ into the rule — they do **not** ship the literal `${CLAUDE_PLUGIN_DATA}` placeholder and trust Claude Code to expand it. Two independent reasons:

- Env-var interpolation inside permission rules is **undocumented / unsupported** by Claude Code. Only `~/` (in `Read/Write/Edit` globs) and absolute paths are documented to work; a `${VAR}` rule stays literal and matches nothing.
- `CLAUDE_PLUGIN_DATA` is **session-globally corruptible**: a co-installed plugin's `SessionStart` hook can re-export its own data dir into `$CLAUDE_ENV_FILE` (observed with the Codex plugin), which Claude Code sources for the whole session. A placeholder rule would then resolve to the _other_ plugin's dir.

So E2 substitutes the placeholder to the resolved absolute path at `factory autonomy ensure` time (`substitutePlaceholders` + `resolveDataDir`), and E1's `factory scaffold` bakes the `~`-tilde form for the `Read/Write/Edit` allow globs (git-safe in a committed `.claude/settings.json`; absolute fallback when the dir is outside `$HOME`) via `buildTargetDataDirRules` (`src/cli/subcommands/target-settings.ts`). Both run through `resolveDataDir()`, which canonicalizes the foreign-plugin leak (`expectedDataDir`), so the emitted rule keeps matching even when the env var is hijacked. Correction (2026-07-14): the `permissions.allow` merge (`mergeTargetSettings`) is, and always has been, a **pure additive union** — it does not strip a stale literal-`${CLAUDE_PLUGIN_DATA}` allow rule left by an old scaffold. Such a rule is inert (it matches nothing, since Claude Code never expands it) but is not actively removed; this paragraph previously claimed a migration that the code never implemented.

**`.claude/settings.json` / `.claude/settings.local.json` split, and `additionalDirectories` baked ABSOLUTE (2026-07-14 fix, corrects the 2026-07-06 fix below):** `~/` expansion in `additionalDirectories` is not documented and verified live to NOT work — a scaffolded repo with the tilde entry still prompted on a test-writer `Write` into `<data-dir>/worktrees/<run>/<task>` (run-20260630-095544). The 2026-07-06 fix baked `additionalDirectories` absolute but left it in the COMMITTED `.claude/settings.json` — which leaks `$HOME`/username into git and is wrong on any other machine or CI. `factory scaffold` now splits the emit in two: `.claude/settings.json` (committed) carries the allow-list + tilde-form data-dir globs + `worktree.baseRef` and **never** carries `additionalDirectories`; the new, GITIGNORED `.claude/settings.local.json` carries the absolute `additionalDirectories` entry, written by `mergeLocalSettings` (`src/cli/subcommands/target-settings.ts`) with genuine prune-then-add semantics — it strips any factory-managed stale entry (a literal `${CLAUDE_PLUGIN_DATA}` placeholder, a tilde form, or a previously-baked absolute path that moved) and re-adds the current one, while leaving the user's own unrelated entries untouched. Because `factory scaffold` re-runs idempotently on every `/factory:run` preflight (Phase 0, `skills/pipeline-runner/SKILL.md`), a stale entry self-heals on the next run with no separate migration step. E2 was never affected (its placeholder substitutes to the absolute path, and it was never git-committed).

**Scope:** This design applies only to autonomous mode (sessions launched with `templates/settings.autonomous.json`, identified by `FACTORY_AUTONOMOUS_MODE=1`). Since autonomy is now mandatory for a run (Decision 29), every _pipeline_ session is an autonomous one; an interactive session can still use the user's normal (tighter) settings for non-pipeline work, but `factory run create`/`resume` will refuse to start there.

---

## Decision 18: Reviewer Model is Fixed, Not Quota-Routed

> **Refined by Decision 21** (layered model/effort): the "fixed, not quota-routed" principle stands; the canonical tier becomes Opus and an effort dimension is added.
>
> **Refined again by [Decision 64](#decision-64--per-role-reviewer-model-reverses-the-single-fixed-reviewer-model)** (per-role reviewer model): "fixed, not quota-routed" still stands — reviewer model is keyed on **role**, never risk tier — but the _one-model-for-every-reviewer_ implementation (internally **Δ T**) is reversed in favour of a per-role model map. The operator override this decision added (`review.model` over the whole reviewer surface) is retired for the panel: `review.model` now overrides only the holdout-validator sidecar.

**Choice:** Reviewer subagents (`quality-reviewer`, `implementation-reviewer`, `security-reviewer`, `architecture-reviewer`) spawn with a fixed model. They do not consult `pipeline-model-router`. Default is `sonnet`; operator can override the entire reviewer surface via `package.json.factory.review.model` (and the parallel `review.maxTurnsDeep` / `review.maxTurnsQuick` / `testWriter.maxTurns` knobs).

**Why fixed (not quota-routed):**

- Review consistency outweighs quota economy. Two reviews of the same task that ran on different models can disagree, which inflates `request_changes` cycles and confuses reviewers' own retry logic.
- The Actor–Critic discipline (see Decision 9) is strongest when the Critic is held constant; varying the Critic by quota tier collapses the value of repeat reviews.
- Reviewer cost is small relative to implementer cost; routing reviewers by tier would save little.

**Why operator-configurable (added 2026-05-22):**

- Different installs land on different default models (ChatGPT-account Codex restrictions, opus availability, cost ceilings). A hardcoded `sonnet` was making it impossible to opt into `opus` reviews on cost-tolerant installs or to downgrade to a cheaper model on tight-quota installs.
- The override is applied once per run via `read_config` in `bin/pipeline-run-task` (single read, threaded through every reviewer spawn manifest). Consistency-within-a-run is preserved; only the model identity is operator-controlled.

**Trade-off:** Reviewers consume quota at the configured tier even on routine tasks. Accepted.

**Scope:** Applies to `bin/pipeline-run-task` reviewer / test-writer / scribe / implementer-respawn spawn manifests. The model router still governs initial implementer spawn decisions. The frontmatter defaults inside `agents/<name>.md` remain authoritative outside the pipeline.

---

## Decision 19: Full Autonomy — No Sanctioned Human-Escalation Valve

> **Aligned with Decision 20.** Autonomy and quality are both fundamental; they differ in _kind_, not importance — autonomy is binary-assurable (a hard _condition_), quality has no objective yes/no (the _maximand_). The no-escalation stance below is the operational consequence of the autonomy condition.

**Choice:** Within the domain boundary (PRD → `develop`), the pipeline targets _full_ autonomy. There is no designed human-escalation valve. The `NEEDS_DISCUSSION` review verdict that currently halts a Run for human input, and the human handoff after CI-fix retries are exhausted (Decision 14), are interim crutches — not endorsed end-states. The intent is that the system resolves every within-domain situation itself, including off-path auto-merge failures.

**Why:**

- Autonomy is a **fundamental condition** of the project — not a means to a quality end, nor an end that subordinates quality; both are the point (Decision 20). It is held as a hard _condition_ because it is binary-assurable ("did a human intervene?" is yes/no), whereas quality, lacking any objective yes/no, is the _maximand_. Automated gates, holdout validation, and review exist to _earn_ the trust to act unattended — not to route work to a human.
- A standing human valve would re-introduce the very dependency the domain exists to remove, and would let reliability gaps hide behind "escalate to a human" instead of being closed.
- Treating escalation as a bug (not a feature) keeps pressure on the real fix: more reliable reviewers and more capable autonomous recovery.

**Scope / boundary clarification:**

- The domain ends at the auto-merged rollup into **`develop`**: task PRs auto-merge onto `staging`, then the `staging → develop` rollup auto-merges (Decision 16) — both without human approval. Human control begins only at promotion from `develop` to **`main`**, which is **downstream and out of scope** — deliberate human ownership of the release boundary, not a contradiction of within-domain autonomy. The factory never touches `main`.
- What _is_ in scope, and therefore a crutch to retire over time: `NEEDS_DISCUSSION` → human (`bin/pipeline-run-task` postreview), and CI-retry-exhaustion → human (Decision 14).

**Trade-off:**

- Higher bar on reviewer reliability and recovery automation: every disagreement or failure the system cannot resolve is a gap to close in the agents/scripts, not a supported off-ramp.
- Until the crutches are retired, a Run can still stop for a human in those two cases. This is accepted as interim, and should be tracked as debt against the autonomy goal rather than relied upon.

---

## Decision 20: Objective Ranking — Quality Maximised Under an Autonomy Constraint

**Choice:** The project's objective is to produce **high-quality code without human intervention** — quality and autonomy are _both_ fundamental. They are not symmetric, though: **autonomy is a hard condition** (no human in the loop between PRD and the `develop` rollup) and **quality is the maximand**. **Cost** (tokens + wall-clock) is the free variable that flexes with quota. The human acts only at the boundaries: authoring the PRD, owning `develop → main`, and handling loud failures.

**Why the asymmetry is verifiability, not priority:**

- **Autonomy is binary-assurable.** "Did a human intervene between the PRD and the `develop` rollup?" has an objective yes/no answer, so autonomy can be enforced as a hard condition — a predicate every run either satisfies or fails.
- **Quality cannot be objectively guaranteed.** There is no binary certificate of "high quality." A property you cannot gate on, you can only push toward — so quality is the maximand: maximised, never proven complete. _If_ "high quality" were an objective yes/no, both quality and autonomy would be hard conditions; it is quality's non-verifiability — not a ranking of importance — that makes it the maximand instead.
- **This is the root of the whole trust architecture.** Because quality has no ground-truth certificate, the verifier layer (Decision 21) is the system's best _synthetic_ approximation of one — the closest thing to a quality yes/no it can manufacture. "Quality is the maximand" and "the verifier is the merge gate" are the same fact seen twice.
- **Downstream:** when quality and cost conflict, cost yields (within quota); when quality cannot be reached autonomously, the system fails loudly (Decision 22) rather than ship uncertain quality or call a human. Cost-flexes-with-quota makes throughput the shock absorber — under pressure the system slows or suspends, never lowers the bar.

**Relationship to Decision 19:** Decision 19 (no human-escalation valve) stands — it is the operational consequence of the autonomy _condition_. Decision 19's body has been **aligned** with this framing: where it once called autonomy "the domain's primary reason-for-being, not a means to a quality end," it now states that autonomy and quality are both fundamental, split into condition vs maximand by **verifiability** rather than by importance.

**Trade-off:** A run that cannot reach the quality bar autonomously gets no shortcut — it fails loudly (Decision 22), even at high cost or zero delivery. A confident-wrong merge is worse than a loud failure.

**Scope:** Autonomy is bounded by the subscription-quota envelope — quota is _environmental_, outside the autonomy domain; a quota-forced human relaunch (Decision 24) is mechanical, not a quality-escalation valve, so it does not violate this ranking.

---

## Decision 21: Layered Model/Effort Allocation

> **Amended (2026-07-09) — apex effort `max` → `xhigh`.** The spec-apex pin's effort
> was lowered one notch, from `max` to `xhigh` (`APEX_EFFORT` in `src/spec/agents.ts`;
> `APEX_MODEL` stays `opus`). This is a value tuning of the same apex-pin concept — the
> pin itself (unconditional, hard-const, non-config; Decision 45) is unchanged, so it is
> an amendment, not a new decision. Read "Max" below as `xhigh`. The wider per-agent
> model/effort/turns tuning it landed with is [Decision 63](#decision-63--per-agent-dial-pinning--max_turns-single-sourced-to-frontmatter).

**Choice:** Allocate model tier and reasoning effort per layer by each layer's role in the quality chain:

| Layer                      | Model                       | Effort    |
| -------------------------- | --------------------------- | --------- |
| Spec (generation + review) | Opus                        | **xhigh** |
| Verifier (reviewers)       | Opus                        | Default   |
| Producer (implementer)     | **Adaptive** (by task risk) | Default   |

**Why:**

- **Spec is the apex.** Acceptance criteria are the operational definition of quality and the one gate with no machine-checkable ground truth (its only anchor is the PRD). A defect here is certified downstream as success, so it gets the most expensive configuration in the system.
- **The verifier is the trust anchor and is never cheapened on model.** It stands in for the absent human; review consistency (Decision 18) and credibility outweigh quota economy. Default effort suffices once the model is top-tier.
- **The producer is a tunable commodity.** Quality can't exceed what it can produce (the ceiling), so its model **adapts up** for high-risk/important tasks (e.g. security) and down for routine ones. This is where cost flexes.

**Relationship to Decision 18:** This **refines Decision 18** (reviewers fixed, not quota-routed). The "fixed, not quota-routed" principle is kept and extended to the whole verifier surface; the canonical fixed tier becomes **Opus** (Decision 18's `sonnet` default was a cost compromise, not the design intent), and the **effort** dimension plus the spec/producer allocations are added.

**Trade-off:** Top-tier verification plus max-effort spec work is a fixed, non-trivial expense every run. Accepted as the price of the trust anchor; savings come from the producer dial, never from review.

---

## Decision 22: Loud, Classified Drop with Partial Delivery

**Choice:** When the system cannot complete a task to standard, it **fails** the task — and a fail is **loud and classified**:

- Any permanently failed task ⇒ the **run is marked a failure** and the **PRD stays open**, even if every other task passed.
- The fail is **classified** by cause — at least _capability/budget exhausted_, _spec defect_, _blocked/environmental_ — so the failure report tells the human what to do.
- Completed work is **delivered**: the dependency-closed set of passed tasks (each a vertical slice, Decision 23) ships, loudly flagged as a partial result. A red **rollup full-CI gate** is likewise a run-level failure even when all tasks passed individually. The only forbidden outcome is **silent** absorption of a fail.

**Why:**

- Under the autonomy constraint (Decisions 19/20) there is no human to escalate to mid-run; the loud, classified fail is the _boundary handback_ — it returns precisely the un-certifiable work to the human, with a reason, after the run.
- Silence is the one behavior incompatible with a quality objective: a quietly-closed PRD with a missing task is a confident-wrong outcome.
- Partial delivery preserves verified high-quality work instead of discarding it to all-or-nothing; coherence is guaranteed by the vertical-slice contract plus the integration gate, not by hoping.

**Trade-off:** `develop` can carry an incomplete PRD (a partial feature). Bounded by: vertical slices leave no broken surface, the rollup gate certifies integration, and the loud failure + open PRD make the remaining work explicit.

---

## Decision 23: Vertical-Slice Decomposition (Hard Rule)

**Choice:** Every task in a spec must be an **independently-shippable vertical slice** — it adds standalone value and leaves no broken or dead surface if its sibling tasks are absent. This is a hard decomposition rule, enforced at spec generation/review, not a preference.

**Why:**

- It is the precondition that makes **partial delivery** (Decision 22) coherent: a failed task then leaves a smaller-but-whole result, not a half-built feature.
- It bounds integration risk: slices compose along explicit dependencies rather than through hidden horizontal coupling.
- It is good decomposition hygiene regardless of failure handling — vertical slices are independently reviewable, testable, and reversible.

**Trade-off:** Some PRDs resist clean vertical slicing (cross-cutting concerns, large migrations); the spec generator must work harder to find slice boundaries and may emit more tasks with explicit dependencies than a horizontal cut would. Accepted as the cost of coherent partial delivery and per-slice verifiability.

---

## Decision 24: Quota Pacing and the Execution-Mode Caveat

> **Superseded in part (2026-07-03, [Decision 42](#decision-42--one-runner-workflow-mode-deleted-runquota-presence-is-the-suspend-discriminant)).** Workflow mode is deleted, so the execution-mode caveat is moot: pacing applies to **every** run. The pacing model itself (two windows, the curve, the 5h-pause / 7d-stop split) stands.

**Choice:** The pipeline bounds its own subscription-quota consumption by **proactive pacing**, not reactive backoff. Quota is **never a reason to fail work — only to pause it** (distinct from the Decision 22 retry-budget fail).

- **Two windows, paced linearly with a 10% reserve floor:**
    - **5-hour window** — burn ≤ 20%/hr; milestones at 80 / 60 / 40 / 20% remaining at hours 1 / 2 / 3 / 4; never below 10% remaining.
    - **7-day window** — the same shape pro-rated: ≤ 14.29%/day (100% ÷ 7); never below 10% remaining.
- **Over the curve → pause.** The binding (more-constrained) window wins.
- **5h breach → pause in place.** Self-heals within ≤ 5h as the curve descends with elapsed time and the window resets; the run holds.
- **7d breach → graceful stop.** The recovery horizon is too long to hold a live process, so the run exits cleanly — _paused, not failed_: the PRD stays open, completed tasks stay committed, and a **human relaunch resumes it from checkpoint** (chosen for implementation simplicity over automatic resume).

**Execution-mode caveat:** pacing needs an observable usage signal, which only the **orchestrated-session** mode has.

- **Session mode (default):** fully paced as above.
- **Workflow mode** — the pipeline driven as a background multi-agent Workflow script — **cannot observe usage**, so there is **no pacing**. The user is **warned at opt-in**, and the run simply **hard-stops** when the allowance runs out. The pause-not-fail guarantee still holds: the stop lands on committed-task boundaries, so a relaunch resumes; only the in-flight task's uncommitted work is lost (same guarantee, weaker mechanism).

**Why:**

- Proactive pacing keeps the run under the subscription wall, so the 5h window never _exhausts_ — quota pressure becomes a pause, never a failure. This is what "cost flexes with quota" (Decision 20) operationally means.
- The 5h / 7d split is about **recovery horizon**: a ≤ 5h pause is holdable in-process; a multi-day wait is not, so the long window forces a clean stop-and-resume instead.
- Quota is **environmental**, outside the autonomy domain (Decisions 19/20) — like the host losing power. A quota-induced human relaunch is _mechanical_ (resource), not a _quality/judgment_ escalation valve, so it does not violate the autonomy condition; it **bounds** it: end-to-end autonomy holds within the paced quota envelope, and a mechanical relaunch continues a run that exceeds it.
- Workflow mode trades pacing for the throughput of the Workflow runtime; the up-front warning plus task-boundary resumability keep cost bounded and the no-fail guarantee intact.

**Trade-off:** Proactive pacing can leave allowance unused (idling under-pace) rather than racing to the wall — deliberate, to respect subscription limits. The graceful-stop choice accepts a mechanical human touch-point on 7d-cap stops (vs the more-autonomous but more-complex auto-resume). Workflow mode accepts a hard, unpaced stop as the price of an unmonitorable runtime.

**Scope:** The milestone percentages (80 / 60 / 40 / 20, the 10% floor, 14.29%/day) are tuning parameters, not load-bearing. The load-bearing choices are: proactive-pacing-over-backoff, quota-pauses-never-fails, the 5h-pause / 7d-stop split, and the session/workflow mode caveat.

---

## Decision 25: Risk Determination and the Producer Escalation Ladder

**Choice:** A task's risk/importance — the input to the producer-model dial (Decision 21) — is a **spec-time judgment made by the spec generator** (Opus/Max), recorded as part of the task's acceptance criteria. It sets the **starting rung** of a failure-driven **escalation ladder**, and is never re-assessed mid-run.

- **Judgment, not heuristic.** Risk is assigned by the apex already reasoning over the whole PRD at max effort. Deterministic signals (auth/crypto/payment paths, blast radius, task type) and any human/PRD flags are _inputs_ to that judgment, not separate mechanisms.
- **One unified dial — difficulty and stakes folded together.** The producer dial is a single judgment of _how much model strength the task warrants_, blending **difficulty** (likelihood the producer gets it wrong) and **stakes** (cost if it does) — risk as P(error) × impact. This **supersedes** the earlier two-axis model (`proposals/design-intent-and-redesign.md` §7), which split a count-based _complexity_ dial (→ producer model) from a path-based _risk_ dial (→ review depth): the review-depth axis is gone (the merge gate is now risk-invariant, Decision 26), and "risk tier" now denotes this single producer dial.
- **Static tier = starting rung.** The risk tier fixes where on the producer-model ladder the task's first attempt begins (low-risk low; high-risk high).
- **Escalation is the only dynamic.** Each nuke-and-retry (Decision 22) bumps the rung along a combined **model→effort** dial (`src/producer/model-dial.ts`): it climbs the model to its **ceiling first** (a sub-ceiling task jumps straight to Opus on the first escalation rung), **then** climbs the effort/reasoning level (`xhigh`→`max`), injecting prior-failure context from rung 2 on. **A fail is the top rung exhausted.** A high-risk task starts at the ceiling, so it begins climbing effort immediately and reaches the top in fewer retries.
- **Cap = 4 extra attempts (5 total), shared.** The ladder is capped at `ESCALATION_CAP = 4` (`src/producer/escalation.ts`), enforced by `escalateOrFail` (`src/orchestrator/transitions.ts`). One `escalation_rung` counter is SHARED across producer failures and reviewer send-backs. Raised from 2 so a hard task gets the full model→effort climb before a `capability-budget` fail (see `jfa94/outsidey#231`); the cost is more spend per hard task (low-risk tasks now jump to Opus after two clean-slate fails) — the deliberate quality-over-cost tradeoff.
- **No mid-run re-assessment.** Under-estimation self-corrects for free: a task riskier than tagged simply fails review and escalates.

**Why:**

- **Risk-tiering is a performance optimization, not a safety control.** The dial sets only the **ceiling**; the verifier stays Opus regardless (Decision 21), so the **merge gate never moves**. A mis-classified task therefore **degrades gracefully** — a too-cheap producer fails review → more retries, or a loud fail — and **never ships bad code**. Because errors are safe, risk can be a judgment call rather than a brittle (if auditable) heuristic.
- **Spec-time is the right moment.** Risk is part of the operational definition of the task (the "target"), and the generator is already doing whole-PRD max-effort reasoning — the cheapest place to add the judgment, and the apex best positioned to make it.
- **One judgment + one ladder is the minimal mechanism.** Because escalation absorbs under-estimation, a separate mid-run risk-reclassifier would be redundant machinery.

**Trade-off:** A badly under-tagged high-risk task pays in wasted retries before it climbs to the tier it needed (or fails) — accepted, since the alternative (mid-run re-assessment) is more machinery for a failure mode the ladder already covers, and the merge gate guarantees the under-tagging never reaches `develop` as bad code.

**Relationship:** Refines Decision 21 (how the _adaptive_ producer dial is driven) and Decision 22 (its "nuke-and-retry outer bound" = the ladder's top rung; the risk tier = its starting rung).

---

## Decision 26: The Two-Layer Verifier and the Risk-Invariant Merge Gate

**Choice:** Verification is **two layers** — a **deterministic layer** (tests, mutation, coverage, SAST, type-check, lint, build: machine-checkable facts) and a **judgment layer** (the **review panel** — independent, single-purpose reviewers). The **entire merge gate is risk-invariant**: model, effort, review depth, and panel membership are fixed for every task in a run and do **not** vary with a task's risk. Only the **producer** (the ceiling) is risk-adaptive (Decision 25). **TDD exists to maximise the deterministic layer** — to convert as much of "quality" as possible into machine-checkable fact that needs no judgment.

- **Determinism-first, with TDD as the lever.** A deterministic fact can't be argued down; the judgment layer covers only what determinism can't reach. TDD grows the deterministic layer (every behaviour gets a test-first assertion), shrinking both the judgment surface and the producer's room to rationalise.
- **The merge gate does not move with risk — the safety counterpart to Decision 25.** The producer dial sets only the _ceiling_, so it can mis-classify and still degrade gracefully — _but only because the merge gate is constant_. A risk-sized panel (lighter review for "routine" work) would mean a task mis-tagged low-risk **skips the very reviewer that would have caught its defect** → bad code ships. So every reviewer runs on every task (a no-op when not applicable); the verifier is never thinned for "low-risk" work.
- **It is also forced by Decision 21.** "Widen scrutiny for risk" only makes sense if the baseline is cheap or narrow — but the verifier is always Opus at full depth, so there is no narrower baseline to widen _from_. Fixed-at-max is the only merge gate consistent with a never-cheapened verifier.
- **The panel evolves across versions, not across tasks.** "Fixed" means risk-invariant _within_ a run; the set of reviewers is still expected to change over time as industry standards do (Decision 9; the planned CCR borrows). Two senses of "not fixed": across-risk (forbidden) vs across-versions (expected).

**Why:** With no human judge, the verifier _is_ the quality merge gate and the trust anchor (Decision 20). A merge gate that moves with a fallible spec-time guess is not a merge gate. Holding the whole verifier constant is exactly what makes risk-misclassification a _performance_ question (wasted producer retries) instead of a _safety_ one (a missed defect) — the property that licenses the producer dial to be cheap and adaptive in the first place.

**Trade-off:** Every task pays full verification cost, trivial ones included. Accepted: the verifier is never the cost-flex point (cost flexes on the producer, Decision 21, and via pacing, Decision 24).

**Supersedes:** the "two orthogonal axes" model in `proposals/design-intent-and-redesign.md` §7–§8, where **risk sized the review panel** (routine / feature / security → 2 / 4 / 6 rounds + extra dimensions) and a separate **complexity** dial drove the producer. Review depth no longer varies with risk; risk drives only the producer (Decision 25, unified dial); and spec review is unconditionally max (Decision 21), not "scaled to the maximum risk tier across tasks."

**Relationship:** Pairs with Decision 25 (ceiling moves / merge gate fixed), realises Decision 20 (verifier = merge gate + trust anchor), depends on Decision 21 (fixed verifier model/effort), and is the structure whose output Decision 27 governs.

**Addendum (2026-06-20) — fail-closed command-gate tool resolution + a named block reason.** The deterministic command gates (`test`/`type`/`lint`/`mutation`) now resolve the worktree-local `node_modules/.bin/<tool>` (walk-up from cwd via `resolveLocalBin`, `src/verifier/deterministic/tools.ts`) and exec it directly instead of shelling out through `npx <tool>`. Root cause: under corepack + a `packageManager: pnpm@…` field (node ≥ 24) a bare `npx <tool>` bypasses the installed bin and resolves a REMOTE registry decoy (`npx tsc`/`npx vitest` exit 1), a false gate failure that the generic "merge gate not unanimous" reason then masked. When no local bin resolves, `runTool` FAILS CLOSED with a synthetic exit-127 result (`missingBinResult`) that names the tool — it never reintroduces the npx path. lint/mutation already skip on a missing bin; only the unconditional type/test gates reach the fail-closed path, where a missing tsc/vitest in a provisioned worktree is a genuine failure. The diff-scoped `test` gate also runs vitest with `--coverage.enabled=false` (a scoped run against a config with global per-file coverage thresholds was itself a false negative; coverage is the `coverage` gate's job). `resolveLocalBin` DELIBERATELY does not realpath-contain the resolved bin: a containment guard would reject pnpm's `.bin` symlinks (which point into the content-addressed `.pnpm` store outside the package dir — the very package manager whose npx decoy this dodges), and the gate layer already executes worktree-controlled code on the same trust boundary, so following a `.bin` symlink crosses no new privilege boundary. Finally, `mergeGateBlockReason` was consolidated into a single shared helper in `src/core/state/derive.ts` (replacing divergent private copies in `panel-run.ts` and the `handlers.ts` resume path); it names failing deterministic gates with their detail and reports an empty gate-evidence set explicitly, so a fail-closed gate surfaces instead of hiding behind unanimity wording. See [../reference/automated-gates.md](../reference/automated-gates.md) and [verifier.md](./verifier.md).

**Addendum (2026-06-24) — CI-parity gate env (`quality.gateEnv`).** The same fail-closed gates run in a **fresh task worktree** with no `.env.local` and no build-time env injection, so a repo whose CI supplies placeholder env for the same build step (e.g. a Next.js static prerender needing `NEXT_PUBLIC_*`) failed the `build` gate on a missing-env crash — a false-negative floor unrelated to task quality, the same class of bug the npx-decoy fix above addresses. Fix: a new `quality.gateEnv` config field (`z.record(z.string(), z.string()).default({})`, `src/config/schema.ts`) — a name→value map merged over `process.env` into every gate command's spawn env via `defaultGateTools(gateEnv)` (`src/verifier/deterministic/tools.ts`), wired from config in `src/cli/wiring.ts`. Operators set it with `factory configure --set quality.gateEnv.<KEY>=<value>`. It is **CI parity, NOT a secret store** — the values live in the plaintext config overlay; only placeholders belong there. The string-only schema makes each value an explicit "set this var" (a numeric-looking value must be quoted as JSON at the `--set` boundary). See [../reference/configuration.md](../reference/configuration.md#gateenv--ci-parity-placeholders) and [../reference/automated-gates.md](../reference/automated-gates.md#ci-parity-gate-env-qualitygateenv).

**Addendum (2026-06-24) — auto-detecting `quality.gateEnv` from CI.** Transcribing each placeholder by hand (the manual `--set` above) is the escape hatch; the preferred path now AUTO-DETECTS the CI build env from the repo's workflow YAML (`src/ci/detect-gate-env.ts`, `factory configure --detect-gate-env`). Three design choices: (1) **Hand-rolled YAML line-scanner, no `yaml` dependency** — the dist bundles inline every dep and the surface needed (step/job-level `env:` literals) is narrow; its safety property is **bias to MISS, never mis-detect** (block-style space-indented YAML only; a var in anchors/aliases/merge-keys/flow-mappings is silently skipped, never mangled — the miss's escape hatch is the manual `--set`). Three policy filters fail a value before it reaches gateEnv: a `${{ }}` GitHub-expression ref (unusable + unsafe), anything the secret scanner flags (defense-in-depth — gateEnv is placeholders, not a secret store), and structurally anything inside a `run: |` block scalar. (2) **Gap-fill, operator wins** — detection only fills keys the overlay does not already have; a detected value that differs from a configured one is reported as a CONFLICT (preserved, not overwritten), equal is skipped (idempotent), and the overlay is written only when there are new keys. (3) **Detect-before-managed-overwrite ordering** — `factory scaffold` runs detection FIRST, before its `quality-gate.yml` managed template clobbers the repo's own workflow, so the repo author's CI env is captured into the durable overlay while that file is still theirs. See [../reference/cli.md](../reference/cli.md#configure) and [../reference/configuration.md](../reference/configuration.md#gateenv--ci-parity-placeholders).

---

## Decision 27: Verify-Then-Fix — Reviewer Findings Are Confirmed Before They Act

**Choice:** A reviewer's blocker reaches the producer only after an **independent verifier confirms it against ground truth**. Unverified findings never trigger a fix or a retry. This is the false-_positive_ twin of Decision 1's derive-don't-store: the system already refuses to trust a _PASS_ the producer claims (re-derive the verdict → guard false _negatives_, bad code merging); it now also refuses to trust a _FAIL_ a reviewer claims (re-derive the finding → guard false _positives_, good code needlessly "fixed").

- **Why this matters more here than in industry tools.** Every shipped AI reviewer inserts a verification pass (Anthropic Code Review's "verification step checks candidates against actual code behavior"; the `claude-code-security-review` `findings_filter`; Cloudflare; Datadog) — but each has a _human_ reading the output, for whom a false positive is ignorable noise. This loop has **no human filter**: the producer acts on every finding, so a false positive becomes a **harmful fix to working code**. Precision is non-negotiable, not a nicety. (The "recall beats precision" stance only holds when something downstream filters; nothing does here.)
- **The verifier must be independent.** LLM self-review carries a leniency bias and shares blind spots with the finder ("fail in correlated ways"). Verification runs in a fresh context, cross-vendor where available — never the finder re-checking itself (extends Decision 9 independence to finding-verification).
- **Evidence bar, not confidence vibes.** A finding must carry ground-truth evidence — a `file:line` citation / repro that substring-matches real code — not an inference from naming. (This is the deterministic citation-verify filter already planned in `design-intent-and-redesign.md` §8 / Delta K; determinism-first applied to reviewer output.)
- **Adversarial framing, single bounded pass.** The verifier is asked _"does this finding hold against the code?"_, never _"is this a false alarm?"_ — confirmation-bias framing swings detection 16–93%. And it runs **once** per finding: "more rounds, more noise" — an iterative debate measurably degrades versus a single pass.
- **"Account for every blocker" = fix-or-justify, bounded.** A confirmed blocker returns the task to the producer (the merge gate is conjunctive — _unanimous_ approval to ship). The producer may **rebut** a verified finding once, with evidence, adjudicated by the independent verifier (not the original reviewer) — a single shot, not a multi-round contest.

**Why:** The verifier is the trust anchor (Decision 20); a _noisy_ merge gate corrodes trust as surely as a _low_ one. In an autonomous loop a false positive doesn't merely churn quota — it degrades the very code quality that is the maximand. Verification is the cheapest way to keep the merge gate _trustworthy_, not merely _present_. The pattern is the frontier default (Anthropic, Cloudflare, Datadog), and the research around it (leniency bias, confirmation-bias framing, "more rounds, more noise") dictates the four constraints above.

**Trade-off:** A verification pass per finding costs tokens and latency, and a wrong verifier could suppress a _real_ finding — mitigated, not eliminated, by independence + adversarial framing + the evidence bar. The residual is accepted as strictly smaller than the false-positive-fix risk it removes.

**Relationship:** Extends Decision 1 (derive-don't-store — the false-negative side), Decision 9 (independent review), and Decision 26 (the judgment layer whose output this governs); realises the trust property in `proposals/quality-architecture.md` §3.

---

## Decision 28: One Engine, One Seam (the Orchestrator), Two Thin Drivers

> **Superseded in part (2026-07-03, [Decision 42](#decision-42--one-runner-workflow-mode-deleted-runquota-presence-is-the-suspend-discriminant)).** "Two thin drivers" became ONE: the Workflow-script runner is deleted; the in-session parallel event loop is the only runner. The engine / one-seam split and everything else here stands.

**Choice:** The deterministic `factory` CLI owns **all** pipeline control flow — including the loop itself — and exposes exactly **one** seam, the **orchestrator**, in two halves:

- `factory next-task` — the **run-level** orchestrator (`src/orchestrator/next.ts`, `nextTask`): emits a `NextTask` of ready tasks (or terminal / pause).
- `factory next-action` — the **task-level** orchestrator (`src/orchestrator/orchestrator.ts`, `nextAction`): emits a `NextAction` spawn request; re-invoked with `--results` it records the spawned agents' raw output into exactly **one** state step (record cores in `src/orchestrator/record.ts`).

A **runner** carries no pipeline logic of its own — it only calls the orchestrator, spawns the `Agent()`s the `NextAction` request names, and feeds their output back via `next-action --results`. Two interchangeable runners step the same seam, selected by `--workflow` on `/factory:run` (Decision 32):

- session (default, no flag) — the in-session LLM runner loop (`skills/pipeline-runner/SKILL.md`), which can spawn `Agent()`s directly.
- `--workflow` — the plugin-shipped Workflow script (`scripts/factory-run-runner.js`), which wraps every CLI call in a small exec agent (Workflow JS cannot shell out).

Both are subscription-only; there is no headless `claude -p` / API-token path.

**Why:**

- **One implementation of the loop, by construction.** The earlier design had the loop expressed twice — an in-process runner (`src/orchestrator/loop.ts`, `driveTask` / `driveRun`) used in tests, and the runner skill mirroring it by prose — kept in agreement only by discipline. Collapsing both onto the orchestrator makes the loop a single tested kernel both runners inherit verbatim; two runners cannot diverge on a transition because neither owns one.
- **Idempotent, exactly-once records.** `next-action` without `--results` re-derives the same spawn envelope from persisted state (safe to retry after any crash); `next-action --results` validates the echoed `result_key` (`{phase, rung}`) against the live cursor before any mutation, so a stale or duplicate delivery is rejected loud instead of double-recorded. The resume cursor is the new `TaskState.phase` field.
- **The seam is runner-agnostic.** Because the orchestrator emits a spawn request and the runner merely spawns it, adding a runner (e.g. a future out-of-session scheduler) is a new thin loop over the unchanged seam — not a re-implementation of pipeline logic.

**What this retired:** the six single-step CLI writers — `run-task`, `advance`, `fail`, `record-producer`, `record-holdout`, `record-reviews` — collapsed into the orchestrator; their record logic now runs inside `next-action --results` (`src/orchestrator/record.ts`). `src/orchestrator/loop.ts` and `src/orchestrator/agent-runner.ts` (the in-process `driveTask` / `driveRun` loop) were deleted. The surviving non-orchestrator writers are `spec`, `rescue`, `scaffold`, `configure`, `state`; the current `factory` subcommand registry is `autonomy, config-defaults, configure, next-action, next-task, rescue, resume, run, scaffold, score, spec, state, statusline`.

**Trade-off:** A runner re-invokes the CLI per step (one process spawn per orchestrator call) rather than running the loop in-process, and must persist/relay the per-spawn results file between `next-action` calls. Accepted: the spawn boundary is where an `Agent()` call is unavoidable anyway, and per-call idempotency is what makes crash-resume and the two-runner story sound.

**Relationship:** Realises the Model-A split (Decision 2) as a single seam rather than a reporter+writer fan-out; preserves derive-don't-store (Decision 1) and verify-then-fix (Decision 27) — both now record through `next-action --results`; the workflow runner is the unpaced mode of Decision 24.

---

## Decision 29: Autonomy is Mandatory — Enforced in the Engine, No Opt-Out

**Choice:** Autonomous mode is not an opt-in convenience; it is a **precondition** for a run. `factory run create` and `factory run resume` call `requireAutonomousMode()` (`src/autonomy/mode.ts`) as their first act and **HALT loud** (`NotAutonomousError`, non-zero exit) when `FACTORY_AUTONOMOUS_MODE !== "1"`. There is no bypass flag and no opt-out. `factory autonomy status` is the diagnostic (exits 0/1, never throws).

**Why:**

- **The pipeline is designed to run unattended** (Decisions 19/20). A non-autonomous `/factory:run` used to "work" only by degrading into a per-tool permission-prompt crawl — silently defeating the unattended design and leaving half-created runs behind. Refusing loud at the source is the honest behavior.
- **Enforced in the deterministic engine, not the markdown surface.** The gate is a typed error in the CLI, so it cannot be skipped by editing a prompt or skill; it mirrors `ProtectionMissingError` (Decision 12's branch-protection refusal) as a hard start condition.
- **Single predicate.** `isAutonomous` is the one source of truth, shared by this gate and the hook layer (branch-protection / pipeline guards), so the autonomous signal can never diverge between "may this run start" and "may this run merge."

**Scope of the gate (deliberately narrow):** Only `create` + `resume` are gated — the two verbs that bring a run into existence or re-activate it, both of which execute in the **foreground runner session** that definitively carries the env. Downstream verbs (`next-task`/`next-action`/`finalize`) operate only on an already-autonomous run and stay ungated, so the workflow runner's background exec-agent CLI calls carry no env-propagation dependency. The shipping operations are independently autonomous-gated at the hook layer (`pipelineCanWrite`, Decision 12).

**Trade-off:** A hand-typed `factory next-action --run X` in a non-autonomous shell against a pre-existing run is not caught (never something `/factory:run` does). Closeable later by stamping autonomy on the run record (no env dependency) if ever needed.

**Relationship:** Operationalises the autonomy _condition_ of Decisions 19/20 as a runtime precondition; complements Decision 13 (how a session becomes autonomous) with the enforcement of _requiring_ it.

---

## Decision 30: Guards Derive Run Ownership From Their Own Inputs — No Hook Reads the Global Pointer

**Choice:** A hook never asks "what is the active run?" via the shared mutable pointer (`runs/current`). Each guard **derives the owning run from the signal it already holds**, so N runs across different repos run concurrently — each with TDD enforced — while same-repo simultaneous `run create`s stay serialized:

- **Write-scope arm** (the TDD rail in `pipeline-guards.ts`) derives `{run_id, task_id}` from the **target file path**. A producer writes into `<repo-root>/.claude/worktrees/<run_id>/<task_id>/…`; Claude's `Edit`/`Write` `file_path` is absolute, so the path encodes both ids (`runTaskForPath`, `hook-context.ts`). A target under no worktree is not a producer write → pass through (the bug fixed: an unrelated session editing a non-test file no longer trips the live run's test-writer scope). A target under a worktree whose run state EXISTS but is corrupt → **fail closed** (deny); a run id with NO state on disk (ENOENT) passes through — it names a native session worktree sharing the root, not a factory task (D11 amendment under Decision 67). (The worktrees root was `<dataDir>/worktrees` when this decision landed; [Decision 67](#decision-67--task-worktrees--results-relocate-into-the-target-repos-claudeworktrees) RE-ROOTED it to the target repo. It is still a required, caller-resolved anchor — now git-derived (`workDir`, `loadCliDeps`) rather than dataDir-derived — never an unanchored segment scan.)
- **Bash arms** (nested-shell, ship) scope by **owner session**: the live run whose `owner_session` equals `CLAUDE_CODE_SESSION_ID` (`StateManager.findActiveByOwner`). No owning run → pass through; env id absent → retain prior behavior (these arms are lower-stakes — nested-shell is a rail, ship is dormant — so they carry the only residual runtime assumption, isolated from the critical write arm).
- **Stop gate** resolves the run **owned by the stopping session** (`findActiveByOwner(stoppingSession)`) instead of `readCurrent()`, so a clobber can no longer make a stopping owner finalize the wrong run; unknown session → degrade to `readCurrent()`.
- **`holdout-guard`** reads only `dataDir` — correctly global, untouched.

**Per-repo `current` is CLI-only (not load-bearing for concurrency).** After the guards stop reading the global pointer, concurrency-correctness is already done. A separate `<dataDir>/current/<repoKey>` → `../runs/<run_id>` pointer tree (kept out of `runs/` so `listRuns` is untouched) only makes the human CLI (`state`/`score`/`rescue`/`run` resume with no `--run`) pick the right run for the caller's checkout (`readCurrentForCwd` resolves the repo from `origin`; unresolvable → global fallback). `run create` writes both the per-repo and legacy global pointers; `pointCurrentAt` **refuses loud** (pre-write) to repoint a repo whose current names a still-live run owned by a different known session — the new run's `state.json` already exists, so it stays addressable via `--run`. `next-task` is left on the global-pointer + `--assert-owner` mechanism untouched; `next-action` still requires `--run`.

**Why:**

- **Ownership is a property of the tool call, not of machine-global state.** The root cause of "runs can't coexist" was one design mistake: globally-installed hooks consulting a single shared mutable pointer instead of deriving ownership from the call. Each guard now reads ownership from inputs it already has — the write arm's target path, the Bash/Stop arms' session id — so enabling the plugin in an unrelated session can never leak a live run's scope into it.
- **The critical arm needs no runtime spike.** Scoping by `session_id` payload or by `process.cwd()` both depend on unprovable-from-repo runtime facts (does a subagent's hook payload carry the runner's id? `Edit`/`Write` honor no `cd`). The worktree target path is the signal the guard **already extracts** and is absolute by construction — verified-correct without a spike. The owner-session scope on the two lower-stakes Bash arms is the only place a runtime assumption survives, and it fails safe.
- **Defense-in-depth, not a weakened boundary.** The write-scope arm is a rail; the authoritative TDD enforcement remains the deterministic commit-order gate on the task branch (`src/verifier/deterministic/strategies/tdd.ts`), which a path-anchor miss does not weaken.

**Trade-off:** A producer write via `Bash` (rather than `Edit`/`Write`) still bypasses the path-anchored rail — already true and already documented; the commit-order gate is the real boundary. The Bash arms' owner-session scope degrades to prior (occasionally cross-session) behavior when `CLAUDE_CODE_SESSION_ID` is absent in the hook subprocess.

**Relationship:** Extends derive-don't-store (Decision 1) to the hook layer — ownership is derived per call, never stored in a global pointer; shares the single `isAutonomous` predicate path with Decision 29; the clobber refusal mirrors the loud start-condition refusals of Decisions 12/29.

---

## Decision 31: Run-Entry Preflight Auto-Scaffolds Autonomous Settings

**Choice:** `/factory:run` (and `/factory:debug`) call `factory autonomy preflight` as their first setup step. Preflight is a thin CLI wrapper around a **pure decision** (`decideAutonomyPreflight`, `src/autonomy/mode.ts`) over three inputs — is this session autonomous, does `merged-settings.json` exist, and does its stamped `_factoryVersion` match the installed plugin. It **regenerates the merged settings (via `ensure`) and halts for a relaunch** when the session is not autonomous OR the settings are stale / missing / unstamped; it **proceeds** when they are already fresh, or when the session is autonomous via a directly-exported env (the CI path), or when the plugin version is unreadable (regenerating would only churn). It exits 0 to proceed, 1 to halt, and — like `status` — never throws on the decision path. `ensure`/`status` remain the manual primitives.

**Why:**

- **Restores a lost convenience, faithfully.** The old bash `pipeline-ensure-autonomy` auto-regenerated the merged settings on (missing OR version-changed) and halted with the relaunch command; the Node+TS port shipped `ensure`/`status` as clean primitives but failed the detect-and-regenerate step and wired no caller. The convenience fell through the cutover — it was a gap, not a reasoned UX decision. Preflight re-composes the primitives into that run-entry behavior.
- **Decision logic lives in the engine, not prose.** The verdict is a pure, total, IO-free function (Model A): testable in isolation, with the markdown surface reduced to "run preflight; on non-zero relay the printed command and stop." The CLI wrapper does IO only and delegates every write to the one `ensure` writer path (idempotency + statusLine chaining for free).
- **The relaunch is irreducible.** Claude Code reads settings only at session launch, so a running session can never make _itself_ autonomous. Automation can cover the **scaffold**, never the relaunch — so preflight stops at printing the command. The hard invariant `regenerate ⟹ halt` encodes this: settings written mid-session can't load into the running session, so proceeding on a fresh regenerate would reintroduce false freshness.
- **No lock needed.** `merged-settings.json` is a pure function of (template, user-settings, plugin version), so concurrent atomic writes from racing preflights converge to the same bytes.

**Trade-off:** Preflight is a UX layer, not a correctness layer — a hand-typed `factory next-action` in a non-autonomous shell still bypasses it. That is exactly why `requireAutonomousMode()` (Decision 29) remains the backstop in `create`/`resume`; preflight makes the common path friendly, the gate keeps the uncommon path safe.

**Relationship:** Sits in front of Decision 29 (the mandatory gate, untouched); operationalises Decision 13 (how a session becomes autonomous) as an automatic run-entry step.

---

## Decision 32: Ship Live by Default; Boolean `--workflow` / `--no-ship` Run-Entry Flags

**Choice:** A no-flag `/factory:run` resolves to **session mode + live ship**: the in-session runner loop drives the run, each task auto-merges into staging, and the staging→develop rollup merges into develop. The two deviations from that default are terse booleans on the user-facing lifecycle verbs:

- `--workflow` → run the background Workflow runner instead of the in-session loop (persisted as `mode: "workflow"`).
- `--no-ship` → open the task/rollup PRs but never merge (persisted as `ship_mode: "no-merge"`).

The verbose `--mode <session|workflow>` / `--ship-mode <no-merge|live>` pairs are **removed** from the user-facing verbs (`run create`, `run finalize`) — not kept as back-compat. `--ship-mode` survives only on the **internal orchestrator seam** (`factory next-action`, `factory next-task` via `--expect-mode`), where the runners machine-generate it and a user never types it; omitting it there honors the run's persisted value. `live` is the single-source-of-truth default in the schema (`ShipModeEnum.default("live")`, `manager.ts`), so schema and CLI agree without a second hardcoded fallback.

**Why:**

- **Auto-merge is the pipeline's purpose, not an opt-in.** A quality-first, TDD-enforced run that ends with an un-merged PR has not shipped. The merge is already gated four ways — branch protection (Decision 12), the risk-invariant review panel (Decision 26), the TDD commit-ordering rail, and the holdout — so `live` is safe to make the default; `no-merge` is the cutover-safety exception, kept for staged rollouts and dry runs.
- **Boolean flags match how operators think.** "Run it" / "run it in the background" / "run it but don't merge" maps to _nothing_ / `--workflow` / `--no-ship` — no value to remember, no enum to mistype. The verbose pairs added a second spelling of the same two dials for no benefit, so they were removed outright rather than carried as hidden aliases (a second accepted spelling is a maintenance and ambiguity cost with no user value once the boolean exists).
- **Persisted-once, read-many.** `mode` and `ship_mode` persist on the run at `run create`; `next-task`/`next-action`/`finalize` and the workflow runner + `resume` read them from state, so the runner never re-marshals ship intent through Phase 3. `run finalize` defaults to the persisted `ship_mode`; its `--no-ship` overrides that one finalize call only.

**Trade-off:** Because the CLI now always resolves a concrete `mode`/`ship_mode` from the flags, the reuse-mismatch guard fires whenever a bare re-`create` resolves to a different intent than the run it would reuse — e.g. re-running a `--workflow`/`--no-ship` run without those flags now hard-fails (loud `UsageError`) instead of silently reusing. This is the desired safety (never drive a pre-existing run under a ship intent the operator did not ask for); the fix is to match the run's flags or pass `--new`. Direct-API callers that pass `mode`/`shipMode` as `undefined` still reuse without divergence (the guard compares only defined intent).

**Relationship:** Inherits the two-runner seam of Decision 28 (`--workflow` is just the runner selector) and the unpaced-workflow contract of Decision 24; the live-by-default merge rides the shipping gates of Decisions 12/26; the reuse-mismatch guard composes with the per-`(repo, spec_id)` run isolation of Decision 30.

---

## Decision 33: Per-Run Staging Branch (Replaces the Single Shared Staging Branch)

**Status:** Implemented (2026-06-18). Supersedes the single-shared-`staging` model assumed by Decisions 12 and 32. `runStagingBranch(runId)` (`src/git/run-staging.ts`) is the single branch-name source; `run create` cuts + protects `staging-<run-id>` from `develop`; ship/handlers/serializer/rollup/finalize target it; scaffold now protects `develop` instead of a shared `staging`; finalize forward-reconciles `develop` into the run branch before rollup.

**Choice:** Each run integrates its tasks on its own private branch `staging-<run-id>`, cut from the current tip of develop at `run create`, instead of all runs sharing one long-lived `staging` branch. Task PRs target the run's own `staging-<run-id>`; that work is invisible to develop and to every other run until the run completes.

**Why:**

- **Confinement makes recovery non-destructive.** An unfinished run's work lives only on its private branch, so superseding, resuming, or rescuing it never touches develop and never reaches for a force-push (forbidden by construction — `GitClient` exposes no force method, `src/git/git-client.ts`).
- **It removes the cross-PRD contamination hazard** of the shared branch: two concurrent runs no longer pile onto one integration line, so cleaning up one never disturbs another.
- **"Start from scratch" becomes literally true and safe:** a fresh run gets a clean branch from current develop; the abandoned attempt is just a branch nobody continues.

**Mechanics:**

- Cut `staging-<run-id>` from current `origin/develop` at `run create`, so staging starts up-to-date with develop.
- Before the completion rollup merges to develop, reconcile forward if develop advanced in the meantime — integrate develop into the run branch (forward-only; never rebase-publish or force-push). The exact sequence (fast-forward vs merge-develop-in to satisfy a "branches up to date" requirement) is an implementation detail, but it is always forward-only and bounded to once per run, at completion.
- `superseded` deletes its `staging-<run-id>` immediately (auto-closing its open task PRs). `failed` KEEPS its branch so rescue can reopen and resume the work already banked on it. Branches orphaned by a fresh start (rather than supersede) are cleaned up manually.

**Amendment (2026-06-19) — flat `-` delimiter, not `/`.** The per-run branch is `staging-<run-id>`, not `staging/<run-id>`. Git stores refs as files (`refs/heads/…`), so a slashed `staging/<run-id>` requires `staging` to be a _directory_ — which collides with a target repo's long-lived `refs/heads/staging` release branch (the common `develop → staging → main` flow). That collision is config-unfixable (the prefix is hardcoded) and blocks every `run create` in such a repo. A flat `staging-<run-id>` shares no path segment with `refs/heads/staging`, so the two coexist regardless of the target repo's branch layout. `runStagingBranch(runId)` (`src/git/run-staging.ts`) builds the name construct-only — nothing parses it — so no callers changed. Runs created before this change live on the old slashed name; they are ephemeral, so supersede/restart rather than migrate.

**Amendment (2026-06-19) — pin the branch name in `RunState`, don't recompute it.** The branch name is now **pinned once at `run create`** into `RunState.staging_branch` (`src/core/state/schema.ts`) and read everywhere through a new pure resolver `resolveStagingBranch(runId, pinned?)` (`src/git/run-staging.ts`): it returns the pinned name when present, else falls back to `runStagingBranch(runId)`. `run create` computes the name once and threads it through `state.create({…, staging_branch})`; every read site — preflight base, the verify gate `baseRef`, ship's PR base + `MergeSerializer` staging (`src/orchestrator/handlers.ts`, `src/orchestrator/ship.ts`), the spawn envelope's `base_ref` (`src/orchestrator/orchestrator.ts`), the holdout validator baseRef (`src/orchestrator/record.ts`), and the finalize rollup + branch GC (`src/orchestrator/finalize.ts`) — resolves through it. _Why:_ recomputing the name on every read silently desyncs the gate base ref / worktree fork point from the branch already pushed to origin if the naming scheme changes mid-run (as the flat-delimiter amendment above just did) or the repo branch layout shifts. A pinned identity is the run's git provenance — an immutable fact about what was created, not a recomputed verdict — so storing it does **not** violate derive-don't-store, which governs only re-derivable quality verdicts (gate pass/fail, the merge gate). The resolver keeps a pure `(string, string?) => string` signature with no `RunState` import, so the git layer stays independent of `core/state`. Legacy runs created before the field fall back to the recomputed name, so nothing breaks.

**Trade-off:** Per-run branches diverge from develop over their lifetime, so a run that completes after another has merged to develop must reconcile forward before its rollup — integration work the single forward-only shared branch did not need. Accepted: the reconciliation is forward-only and bounded, and it buys the confinement that makes the whole recovery model safe.

**Relationship:** Keystone for Decisions 34 and 35; replaces the shared-`staging` assumption in Decision 12's worktree-base invariant and Decision 32's per-task merge-into-staging; preserves the no-force-push global rule.

---

## Decision 34: Develop Receives Only Whole PRDs — Incremental Delivery and the `partial` Status Removed

**Status:** Implemented (2026-06-18). Reverses the partial-rollup-to-develop behavior of the prior `finalize`/`rollup` (the `PARTIAL:` rollup header is retired). `partial` removed from `RunStatusEnum`; `decideFinalize` is binary `completed | failed`; rollup fires only on `completed`; on a merged rollup finalize comments + closes the PRD (new `issueComment`/`issueClose`) and deletes the per-run branch; a wedged run hits the `next.ts` circuit breaker → `failed`.

**Choice:** The `staging-<run-id>`→develop rollup fires ONLY when the run is `completed` (every task shipped). An incomplete run lands nothing on develop. There is no partial delivery: a run delivers the whole PRD or delivers nothing to develop.

**Why:**

- **It realigns the implementation with the domain.** The glossary already defines a Run as succeeding "only when the whole PRD has been delivered, never partially" (`docs/glossary.md`); the code had drifted into partial rollups. This is the code catching up to the decided domain, not a new invention.
- **All-or-nothing is what makes the recovery model coherent.** Since an unfinished run's work is confined to its private branch (Decision 33) and never reaches develop, continuing/repairing/replacing it is always safe. Allowing partial develop landings would reintroduce exactly the develop-collision hazard Decision 33 removes.
- **"Resuming an unfinished run" is the only form of partial progress** — and it is recoverable, not a terminal half-delivery.

**Consequences for the status enum:**

- `partial` is REMOVED. A run is `completed`, or it is unfinished/resumable.
- A wedged run the circuit breaker gives up on goes terminal `failed` — develop clean, PRD left open. `failed` broadens from "could not start" to "delivered no work to develop" (couldn't-start OR gave-up after banking work on its private branch).
- On `completed`, finalize CLOSES and COMMENTS the originating PRD issue — net-new behavior added via `issueClose`/`issueComment` (`src/git/gh-client.ts`). Closing the PRD is what guarantees `run` never re-touches a delivered PRD (Decision 35). On `failed`, finalize instead posts ONE comment on the open PRD listing the failed tasks (Decision 36 — superseding the original per-task `issueCreate`/`issueList` surface, both since removed).

**Trade-off:** Loses "bank the N good tasks, hand off the failures" incremental value delivery — a run that cannot finish delivers nothing to develop, even if most tasks passed. Accepted deliberately: the banked work is not lost (it survives on the run's private branch for rescue/resume), and atomic per-PRD delivery is worth more than partial landings that complicate develop and recovery.

**Relationship:** Rides on Decision 33's per-run branch (where partial work safely waits); revises the `finalize` rollup; orthogonal to Decision 22 (notify-on-ship, untouched); enables Decision 35's "`run` never sees terminal runs" simplification.

---

## Decision 35: `run` / `resume` / `rescue` Are Distinct Lifecycle Verbs; `run` Supersedes Rather Than Silently Reuses

**Status:** Implemented (2026-06-18). Revises Decision 32's idempotent-reuse-on-`create`. `resume` is now its own top-level command (`commands/resume.md` + `factory resume`, with `run resume` kept as a thin CLI alias). Implemented as "fail loud + flags": bare `run create` with an active run exits `3` and emits `{kind:"exists"}`; `--supersede` marks the old run `superseded` + deletes its branch, `--resume` hands off; the interactive prompt (resume/supersede/cancel) lives in `commands/run.md` via `AskUserQuestion`, mapping the answer to the flag. Adds the `superseded` terminal status. Rescue gains a `rescue-reconciler` git/GitHub drift pass before resume.

**Choice:** Three distinct run-lifecycle commands, plus the unchanged standalone `debug`:

- **`run`** — always a fresh start. It looks for a NON-terminal run on the spec; finding one, it PROMPTS (continue via `resume`, or supersede). Proceeding supersedes: the prior run goes `superseded` (its private branch deleted, Decision 33), a fresh run begins. With no active run it starts silently. It never sees terminal runs (a delivered PRD is closed, Decision 34).
    - **Supersede regenerates the spec, not just the run (2026-06-26).** A supersede is an escape from a _bad attempt_, and the spec is often what was bad — so `--supersede` deletes the durable spec dir (`SpecStore.deleteByIssue`) as well as the run's branch. `commands/run.md` forwards `--supersede` into Phase 1's `factory spec resolve`, which deletes before its reuse check so Phase 1 always falls through to `generate` and rebuilds the spec from the PRD. Without this the superseding run silently reused the same broken spec it was trying to escape. Deletion is mandatory (regen-without-delete risks two dirs for one issue, a `resolveByIssue` store-integrity error). The run-level CLI (`run create --supersede`) does NOT touch the spec — spec regen is the runner's Phase 1 — and pairing `--supersede` with `--spec-id` leaves the spec untouched (Phase 1 is skipped).
- **`resume`** — continue an unfinished run if possible. It classifies via the read-only rescue scan: no active run → report the terminal status; quota-paused → re-check the window; running with runnable work → continue; running but deadlocked → STOP and redirect to rescue. It never mutates state and never auto-escalates.
- **`rescue`** — repair, then auto-resume. It reconciles run-state and git/GitHub drift, then continues driving. Forward-only/non-destructive repair is autonomous; any destructive step (delete a branch, close a PR, discard work) is surfaced for consent; force-push never. Git/GitHub reconciliation is performed by a CODING AGENT that detects, troubleshoots, and addresses the issue — not an enumerated catalog of fix-ups in the deterministic engine. The engine detects "stuck/drifted" and hands off; the open-ended repair is agent work, per Model A.
- **`debug`** — unchanged; a standalone, run-independent review-fix loop (risk-invariant panel + Codex on a chosen scope), not part of the recovery ladder.
- **`run cancel`** — abandon a live run from inside the owning session (added 2026-06-19; see Addendum). Marks the run terminal (reuses `failed`) so the Stop gate releases; it does NOT start, continue, or repair — it is the explicit end-of-line for a run the operator no longer wants.

**Why:**

- **The verbs were conflated.** `run` both started AND silently reused (Decision 32), there was no first-class `resume`, and "continue" vs "repair" were undivided — operators hit the bug where `/factory:run` found an existing run and stopped instead of starting fresh. Separating the verbs maps each to one intent: start-over / continue / repair.
- **Supersede-with-consent honors the never-fail-without-confirmation rule** while still letting an operator start fresh. The at-most-one-non-terminal-run-per-spec invariant it enforces keeps state unambiguous (no zombie parallel runs on one PRD).
- **Agent-driven reconciliation keeps the engine out of a brittle drift catalog.** The engine is good at detecting that progress is blocked; open-ended diagnosis and repair of git/GitHub state is exactly the agent layer's job under Model A.

**Trade-off:** `run` is no longer a silent idempotent no-op on re-invocation — it stops to ask, costing an interaction in the (rare) re-run case. And agent-driven rescue is less predictable than a fixed reconciliation routine. Both accepted: the prompt prevents silent supersede of real work, and the recovery surface is too open-ended to enumerate safely in TS.

**Relationship:** Replaces the idempotent reuse + reuse-mismatch guard of Decision 32 (the guard's intent — never drive a run under an unintended ship mode — is subsumed by the explicit supersede prompt); leans on Decisions 33/34 (terminal runs are closed and confined, so `run` can ignore them); rescue's agent hand-off mirrors the `rescue-diagnostic` pattern; preserves the autonomy gate of Decision 29 (the supersede prompt is a pre-start human moment, before the run goes autonomous).

**Addendum (2026-06-19) — `run cancel`, the in-session abandon verb.** A run with non-terminal tasks left the owning session unable to stop: the Stop gate (`src/hooks/stop-gate.ts`) blocks the session while a `running` run has pending work, and every other lever was unreachable mid-session — `state.json` is TCB-write-protected, `run finalize` refuses an in-flight task, and `FACTORY_ALLOW_STOP` is a launch-time-only env. The lifecycle had a start/continue/repair vocabulary but no _abandon_. `factory run cancel [--run <id>] [--cleanup] [--session-id <id>]` (`runCancel` in `src/cli/subcommands/run.ts`) fills the gap: it resolves the run via `--run` → owner-scan (`findAllActiveByOwner`, robust to a detached `runs/current`) → current pointer (explicit `--run` is a deliberate operator override with NO ownership check — the cross-session escape hatch a crashed owner's run needs, sound under the single-operator local trust model, exactly as `resume`/`finalize` honor `--run`; the owner-scan resolves the SINGLE owned run, failing LOUD and demanding `--run` when the session owns ≥2 live runs rather than guessing which to abandon, yet still falls through to the pointer when it owns none), then calls `state.finalize(runId, "failed")` **directly** — NOT `finalizeRun` (cancel must not attempt rollup CI / ship of a partial run). `finalize` validates only that the _target_ status is terminal — it never inspects task statuses — so a run with a task still `executing` is cancellable, the exact mechanism `--supersede` already uses. The CLI is the sanctioned state writer (it bypasses the TCB hook, which guards Edit/Write tools, not the engine's own fs writes), so this is not "routing around the guard." Design choices: reuse `failed` (no schema change; a user-abandon is a give-up-after-partial-work, which `failed` already means), so a cancelled run is terminal and NOT resumable; teardown of the staging branch + task PRs is opt-in via `--cleanup` (default leaves them for manual handling) and best-effort — a teardown failure is surfaced LOUD (a `cleanup_error` in the envelope plus a safe-retry hint on stderr) but never fails the abandon, since the run is already `failed` and the Stop gate already released; re-running `--cleanup` retries idempotently; and the verb omits the autonomy gate (Decision 29) because it is the documented _escape_ from the Stop gate and must work from any session. The Stop-gate block message now names `factory run cancel --run <id>` so a trapped session discovers it.

**Addendum (2026-06-20) — supersede teardown is resume-safe-ordered.** `supersedeRun` (`src/cli/subcommands/run.ts`) now tears down the old run's protection + `staging-<run-id>` branch BEFORE flipping it `superseded`, the terminal write LAST — the resume-safe convention `finalizeRun` (`src/orchestrator/finalize.ts`) already uses. Previously it finalized first, then tore down unguarded: a teardown throw (GitHub 401/403/5xx) propagated, so the fresh run was never created AND the old run was already terminal — excluded from `findActiveBySpec`, so no re-run ever re-attempted its teardown and the protected branch was orphaned permanently (rescue scopes out branch GC). With finalize last, a teardown failure leaves the old run non-terminal, so re-running `run --supersede` re-resolves it and retries the whole step idempotently (`deleteProtection`/`deleteRemoteBranch` tolerate already-gone), leaving NO orphan. This is the DELIBERATE inverse of `run cancel`'s finalize-first ordering: cancel's priority is releasing the Stop gate even if teardown fails (so the terminal write must win), whereas supersede has no gate and is an interactive pre-start moment, so a clean, recoverable replacement wins over forcing the fresh run through.

**Addendum (2026-07-01) — an armed-but-not-landed rollup is recoverable, not a silent loss.**
When the completion rollup PR arms a `--auto` merge that GitHub's branch policy blocks from
landing immediately (the "auto-armed" branch-policy fallback, D3), the run still finalizes
`completed` — but the PRD-close and per-run branch-GC that a merged rollup triggers never fire,
and nothing recorded the queued merge. `finalizeRun` now persists that outcome as
`RunState.rollup {number, merged, reason?}` (`src/core/state/schema.ts`), written **before**
the terminal status flip (so a crash between the two still leaves the pointer durable) and
**only** when the rollup did not land (`merged:false`); a merged rollup has nothing to recover
and stores nothing. `rescue scan` surfaces this purely from durable state — no live GitHub
call — as a new `rollup_pending` flag folded into `needs_rescue`, and `rescue apply
--recheck-rollup` reopens the `completed` run so a re-drive re-enters `finalizeRun`, whose
idempotent `rollup()` resume-guard finds the now-merged PR and completes the PRD-close +
branch-GC (clearing the pointer). Minimal-surface by design: no polling loop, the staging
branch is **retained** until the merge is confirmed, and `apply` never mutates the pointer
itself — only `finalizeRun` writes or clears `rollup`, keeping the finalize path the single
source of truth for rollup state. Like `--reset-e2e`, the recheck is **never automatic** — a
human asserts the queued merge landed; a default `apply` leaves a pending rollup alone.

**Addendum (2026-06-21) — the Stop-gate pending-work block is removed (simplification Phase 2).** The Stop hook (`src/hooks/stop-gate.ts`) no longer emits `{decision:"block"}` while a `running` run has pending work, and the `FACTORY_ALLOW_STOP` escape hatch is gone. That block was the "session-hostage" behaviour — a session that could not progress was held open indefinitely — and it never functioned in `--workflow` mode (the strategic primary runner) anyway, since a workflow-mode run already passed through. A session may now always stop; a run left `running` with pending work stays cleanly resumable via `factory resume` (an idempotent re-entry — `applyResume`). **Superseded (2026-07-02) — the hook no longer finalizes on stop.** The old finalize-on-stop arm called `manager.finalize` (a pure status flip) that bypassed the real `finalizeRun` delivery pipeline (rollup PR, PRD close / failure comment, `report.md`, the e2e-failed→failed override), stranding the run healthy-looking but undelivered — and once flipped terminal, resume never re-entered finalize. The hook now performs NO state mutation: an owned, session-mode, all-terminal run is left `running` with a log hint, and the next `factory resume` re-derives all-terminal and routes through the real `finalizeRun`. The ONLY remaining block is an inaccessible data directory (M9 — surface genuine inconsistency, not lack of progress). Consequence for `run cancel` (the 2026-06-19 addendum above): it is no longer the "escape from the Stop gate" — it is simply the explicit ABANDON verb (mark `failed`, optionally `--cleanup` teardown) for deliberately discarding a run you will not resume.

---

## Decision 36: A Failed Run Comments the PRD Issue; Per-Task Failure Issues Are Retired

**Status:** Implemented (2026-06-22). Removes the per-failed-task GitHub-issue surface (`fileFailureIssues` + the gh-client `issueCreate`/`issueList` methods and their types) from `finalize`. On a `failed` run, finalize now posts ONE comment on the originating PRD issue listing every failed task; the PRD stays open.

**Choice:** GitHub issues represent **PRDs**, not run-internal task outcomes. A `failed` run's fails are surfaced as a single comment on the PRD issue (`commentFailuresOnPrd`, `src/orchestrator/finalize.ts`, step 5) carrying fails-only content — for each failed task: id, title, `failure_class`, `failure_reason`, and its full (all-unmet) acceptance criteria. The renderer (`renderFailureComment`, `src/scoring/partial-report.ts`) leads the body with a hidden marker `<!-- factory:run-failed:<run-id> -->`; finalize scans existing PRD comments (new `GhClient.listIssueComments`) for that marker and skips if present, so a resumed finalize (a crash before the terminal flip) never double-posts.

**Why:**

- **Issues = PRDs.** A previous run filed several `[factory] … failed` issues, polluting the issue namespace with run-internal state. Per-task status is **already** authoritative locally — `RunState.tasks[id].status` (`done`/`failed` + `failure_class` + `failure_reason`) plus the durable `report.md`. The fix replaces a redundant, namespace-polluting GitHub surface, not local tracking (which was never missing).
- **Symmetric with the success path.** A `completed` run already comments + closes the PRD (Decision 34); a `failed` run now comments + leaves it open. One PRD-comment surface for both outcomes, keyed off the same `report.issue_number`.
- **One comment, not N issues.** A run that fails K tasks produces ONE consolidated comment, not K issues a human must triage and close. A later successful re-run simply adds its own comment and closes the PRD — no stale open issues to reap.

**Trade-off:** Loses the per-task issue as an independently-assignable/closable work item. Accepted: the PRD is the unit of work in this model, the local run state is the authoritative per-task ledger, and the fails-only comment gives a human everything needed to decide rescue/resume/abandon without a parallel issue namespace to maintain. CLI consequence: the `finalized` envelope emits `failure_comment_posted: boolean` in place of `issues_filed: number`.

**Relationship:** Refines Decision 34's failure path (which left the PRD open but said nothing about how fails were surfaced) and Decision 22's "loud, classified fail" (the comment IS the loud handback). Reuses the same `FailureLine[]` the partial report already derives.

---

## Decision 37 — Documentation Is an Engine Phase Before Finalize

Docs generation was a Phase-4 markdown conditional that ran AFTER the rollup PR
merged and the PRD issue closed, leaving doc updates uncommitted. It is now a
deterministic, blocking, resumable engine phase: `factory next-task` returns
`document` when the prospective status is `completed`, the repo keeps `/docs`,
docs are not opted out (`package.json` `factory.docs.enabled`), and the docs
phase isn't `done`. A runner runs `factory run docs` (emit a scribe spawn request on a
staging-rooted worktree → record publishes the docs commit onto staging). Because
`next-task` withholds `finalize` until docs are `done`, the rollup/PRD-close cannot
fire while docs pend. A docs failure suspends the run for a retry (resumable via
`/factory:resume`), bounded by `MAX_DOCS_ATTEMPTS` (2) — once the cap is hit docs become
best-effort and the run finalizes `completed` without a docs commit rather than
suspend-looping — never shipping half-documented. Whole-PRD diff
(`origin/<baseBranch>..HEAD`); ships inside the one rollup PR (Decision 34).

---

## Decision 38 — Defective-RED-Test Recovery: the Implementer Reports It, the Test-Writer Regenerates It

A workflow run dead-ended on a DB-migration task that had **no executable RED test**:
the test-writer, unable to assert behavior against a SQL migration with no RED-time
runner, fell back to a **source-presence pin** — `toContain("<impl literal>")` over
the migration file — which locked the _first_ implementation guess in as "the
contract." When reviewers later found that guess wrong, the immutable test (the
implementer may never edit a test, Iron Law) made it unfixable. The implementer's
only exit was `BLOCKED — escalate`, which classifies as a **terminal `spec-defect`**
(Decision 25, Rule 1) — and stateless [rescue](../guides/rescue-a-stalled-run.md)
regenerated the same pin. There was no path for a wrong _test_ (as opposed to a wrong
_spec_) to self-heal.

**Choice:** add a recoverable producer outcome, `test-defective`, that resumes the
task **at the `tests` phase** so the **test-writer** regenerates the RED test — the
implementer never touches it.

- **Signal.** The implementer raises `STATUS: BLOCKED — escalate: test requires
revision <reason>`. `parseProducerStatus` (`src/producer/agents.ts`) promotes a
  `BLOCKED — escalate` line to the `test-defective` outcome **only** when it carries
  the _contiguous_ uppercased substring `TEST REQUIRES REVISION`; otherwise the line
  stays `blocked-escalate` (terminal spec-defect). Contiguity is deliberate — a
  genuine spec contradiction that merely mentions "the criterion the test verifies"
  must stay terminal.
- **Classification.** `test-defective` classifies as `{action:"retry"}` →
  `capability` (`src/producer/classify.ts`), **not** the terminal `spec-defect` that
  `blocked-escalate` maps to. `classify.ts` stays phase-agnostic.
- **Routing.** `applyProducerOutcome` (`src/orchestrator/transitions.ts`) accepts the
  outcome only from the `exec` phase (only the implementer may raise it), persists the
  defect reason on the transient task field `test_revision_feedback`, then
  `escalateOrFail(..., "tests")` — resuming at `tests`, not the implementer's own
  `exec` phase. A `test-defective` from a non-exec role (the parser is role-blind) is
  reclassified as a producer **error** and escalated/capped rather than thrown, so it
  never escapes `next-action`'s catch.
- **Feedback.** The `tests` handler (`src/orchestrator/handlers.ts`) injects a
  specific revision note into the regenerating test-writer's `priorFailures` whenever
  `test_revision_feedback` is set — **gated on the field, not the rung dial**, so it
  reaches the test-writer even at rung 1 (where the generic prior-failure note is
  still off). The field is cleared once the test-writer returns `done`, and
  `resetTaskRow` clears it on rescue.
- **Bounding.** The recovery shares the single `escalation_rung` budget (Decision 25,
  Rule 3); a persistent re-pin climbs to `ESCALATION_CAP` then fails
  `capability-budget` — a clean dead-end, never an infinite test↔impl loop.

**Prevention (markdown surface).** `agents/test-writer.md` now forbids source-presence
pins outright (Iron Law 6) and steers a non-executable artifact (e.g. a SQL migration
with no RED-time runner) to a behavior probe or a `STATUS: NEEDS_CONTEXT` defer —
`tdd_exempt` / `.quality.redTestCommand` remain the sanctioned escapes for exotic or
deferred runners, never a text pin. `agents/implementer.md` promotes `test requires
revision` into its sanctioned Final-status menu as the recoverable signal, distinct
from the terminal `BLOCKED — escalate`.

**Trade-off:** one more outcome on the closed producer union and one more transient
task field — the cost of converting a class of dead-ends (wrong test, not wrong spec)
into a self-healing path instead of a loud fail. See
[producer-ladder.md](./producer-ladder.md#the-test-defective-recovery-path).

---

## Decision 39 — E2E Is a Run-Level Engine Phase; Criticality Is Persistence, Not a Tag

Unit-level gates (vitest, tdd, coverage, mutation, sast, type, lint) verify a task in
isolation; they cannot catch a feature that's broken once every task's change is
integrated. `--e2e` adds an autonomous Playwright phase that authors and runs journey
tests against the integrated staging app and **acts** on failures by reopening the
task responsible — mirroring the docs phase (Decision 37), ordered immediately
**before** it (don't document code about to change).

**Criticality by persistence, not a tag.** The `e2e-author` agent writes two kinds of
spec, distinguished only by WHERE they land — there is no `@critical` annotation, no
metadata file:

- **Committed** (target repo's `e2e/`, default `e2e.testDir`) = **critical**. Thin,
  journey-oriented, load-bearing — gates this run, every future `--e2e` run, and the
  repo's CI (the durable net; see the `e2e` job added to `quality-gate.yml`).
- **Ephemeral** (an out-of-repo run directory, never committed) = **throwaway**. One
  per user-facing task, broader coverage, exists only to shake out this run's issues;
  discarded at run end.

Committing per-task tags or annotations would let an author-side bug silently widen or
narrow what gates future runs; a directory boundary cannot drift the same way.

**Spec→task link is an author-emitted manifest**, keyed by `task_id`. No Playwright
tag, no git provenance, no source-file→task mapping exists (a squash-merged commit
loses per-task attribution) — the author already has every task's `task_id` +
`acceptance_criteria` for free, so it returns
`[{ task_ids, spec_path, kind: "critical"|"throwaway" }]` via the universal
`--results` seam (`E2eResultsSchema`). This is the ONLY join the engine has: a spec
the author forgets to list can never be traced back to its task if it later fails.

**Fail-first proof — the autonomous stand-in for human assertion review.** No human
reviews an autonomously-authored e2e assertion before it gates a run; a spec that's
green but meaningless (asserting something trivially true) gives false confidence.
Every **critical** spec must carry exactly one `control:`-prefixed assertion that
passes on any boot of the app, independent of the feature under test. Before a
critical spec is ever merged, the engine runs it twice via `runE2e()`: once against
the **unmodified base branch** (expects the control assertion GREEN + every journey
assertion RED — proof the app booted but the feature doesn't exist yet) and once
against **staging with the feature** (expects everything GREEN). A spec whose control
assertion fails on base is rejected as "base unusable"; a spec already green on base
is rejected as vacuous. Throwaway specs carry no such proof — only author
self-validation against live staging — since they never gate anything past this run.

**Reopen cadence and disposition.** Pass 1 reopens for any failing mappable spec
(critical or throwaway); pass 2+ reopens only for critical failures — a throwaway spec
existed to shake out issues in the tasks it covers, not to gate convergence forever.
Flaky (Playwright's own fail-then-pass-on-retry classification) never reopens. 0
critical red → the run completes (a residual throwaway red becomes an advisory line in
the report, not a blocker); an unmappable critical failure or one that exhausts
`e2e.reopenCap` fails the run outright.

**Reopen never flips `run.status`.** Only the task rows reset to `pending` (carrying
`e2e_feedback`, reusing the `resetTaskRow` rescue primitive); the run stays `"running"`
throughout every pass — `finalizeRun` is the only writer of a terminal run status. The
`e2e` phase marker (`E2ePhaseSchema.status`) is cleared on reopen so the phase re-fires
once the reopened task settles — the one place this mirrors-but-diverges from the docs
phase, whose marker never re-clears (docs never has a reason to re-run mid-run).

**Simplified reject→fail, no re-author loop.** `parseProducerStatus` — the shared
STATUS-line grammar for every producer-like role — governs the author's terminal line
too; in `runE2eRecord` ANY non-`"done"` outcome (`blocked-escalate`, `needs-context`,
`error`) fails the whole e2e phase outright. There is deliberately no "ask the author
to try again" retry loop: an author that couldn't finish authoring is a signal to
surface, not paper over with another attempt at the same live app.

**Config is consumed, not just declared.** `e2e.startCommand`/`baseURL`/`testDir`/
`readyTimeoutMs`/`reopenCap` (`E2eConfigSchema`) are read by the runtime at every call
site — repeating `.quality.redTestCommand`'s "declared but never wired" mistake was an
explicit thing to avoid here. Unconfigured `startCommand`/`baseURL` on an `--e2e` run
suspends the phase (loud, resumable via `/factory:resume`) rather than silently
skipping it.

**`--e2e` is create-only**, exactly like `--workflow`/`--no-ship` — persisted on the
run at creation, immutable across `--resume`. This class of bug (a boolean flag added
to `CreateRunArgs`/`StateManager.create()`'s whitelist but missed in the parallel
`--resume` rejection guard) is worth naming: any future create-only run flag needs
BOTH the create-guard AND the resume-guard updated together, or `factory run resume
--<flag>` silently no-ops instead of rejecting loud.

**TCB.** `e2e/**` is implementer-write-denied (`src/hooks/tcb.ts`, category
`e2e-suite`) — only the `e2e-author` agent commits there; an implementer that could
edit a committed spec could make its own feature's failing journey pass without fixing
the underlying bug. Hardcoded to the literal `e2e` path component per the existing "no
config parameter can influence the denylist" invariant (Δ W) — a repo that customizes
`e2e.testDir` away from the default is not covered by this rule, a known limitation
rather than a bypass an implementer could reach (it cannot set config either).

**Deferred, not built:** `debug`'s e2e integration (critical suite on every debug run,
`--full-e2e` for full coverage, folding results into the report → spec → re-review
loop until no crucial/important findings). `/factory:debug` is non-functional today
(retired `pipeline-*` bash bins) — the core (`runE2e()`, the author, the manifest
contract) is deliberately consumer-agnostic so debug becomes a second consumer later
without touching this phase.

### Decision 39 addendum — remediation refinements

A comprehensive-review remediation pass hardened the phase without changing its shape.
These refine Decision 39; they do not supersede it.

**Playwright owns the app lifecycle; the engine does not run a process manager.** Rather
than the engine spawning/polling/killing a dev server around each run, the scaffolded
`templates/playwright.config.ts` `webServer` block owns boot, readiness poll, and
teardown — the standard Playwright mechanism. The engine's only contract with it is
**environment**: every invocation passes `FACTORY_E2E_START_COMMAND` (falling back to
`npm run dev`), `BASE_URL`, `FACTORY_E2E_READY_TIMEOUT_MS`, and `FACTORY_E2E=1`. That last
flag forces `reuseExistingServer: false` so a factory-driven run always boots fresh, while
a plain local/CI `playwright test` may reuse a running server. This keeps a single boot
code path shared by the mechanical run and a human's local run, and avoids re-implementing
process supervision (a "no process manager primitive" constraint the runner already works
around by being the control loop). Because both the scaffolded config and CI
`quality-gate.yml` hardcode `testDir: "e2e"`, `e2e.testDir` is now **schema-locked** to
that default (rejected at config-parse time) rather than a documented-but-unenforced
convention — a custom value could only diverge from what actually runs and gates.

**App provisioning mirrors task worktrees.** Each e2e worktree (author, base-proof, and the
persistent run worktree) is `provisionWorktree`'d (`npm ci`-equivalent) right after it is
created and on every resync, so the app can actually boot — the same provisioning task
worktrees already get. The throwaway tier now genuinely runs, via a generated CommonJS
`--config` whose `testDir` points at the out-of-repo throwaway dir while `cwd` stays the run
worktree (so `@playwright/test` resolves through that worktree's `node_modules`).

**Honest green.** An errored Playwright run — nonzero exit code or a reporter `errors[]`
entry (e.g. the app never booted) — is `ok:false`, distinct from a cleanly-red suite; a
tooling failure with no spec marked failed fails the run outright rather than being absorbed
as a green. This is enforced symmetrically for **both** tiers: the critical suite always
gates on it, and the **throwaway** suite gates on it **on pass 1** (mirroring the critical
check) — a broken throwaway config/invocation with zero individually-failed specs would
otherwise fall through to an empty failure set and silently `markDone`. On pass 2+, where the
throwaway tier is already non-gating (Decision 8), a throwaway tooling failure is **folded
into the advisory string** rather than dropped silently. A manifest `critical` spec is proven
only when it appears in results as `passed` or `flaky`; **absent, `failed`, or `skipped`** are
all misses that reopen the task. Pass-1 throwaway failures fold into the same reopen decision
(cadence unchanged: pass 1 reopens for any mappable failure, pass 2+ only for critical).

**A `failed` verdict is repairable, not permanent.** `factory rescue apply --reset-e2e`
clears the concluded verdict via the shared `reopenE2ePhase` helper, **manifest-aware**: a
failure that occurred **after** authoring drops `status`/`reason`/`advisory`/`ended_at` while
preserving `manifest`/`reopen_counts`/`attempts`, so the phase re-enters and re-derives
without re-invoking the author; a failure **before** any manifest was authored (empty
`manifest` — every pre-authoring `markFailed`: author crash, non-`DONE` status, unsafe
`spec_path`) drops `e2e_phase` **entirely**, so `runE2eEmit`'s `run.e2e_phase === undefined`
gate re-fires and the author actually re-spawns. Preserving an empty-manifest phase instead
would let `runSuiteAndDecide` settle a false "done" with zero e2e coverage — falsifying the
"re-enters and re-derives" contract for exactly the pre-authoring case. Empty-vs-non-empty
manifest is a reliable discriminator because `runSuiteAndDecide` (the only post-authoring
`markFailed` caller) always reads a persisted non-empty manifest first. The repair is never
automatic — `rescue scan` reports `e2e_failed: true` (folded into `needs_rescue`) but `apply`
only clears it on the explicit flag; plain `resume` re-checks the quota gate alone. The three
`worktreeAdd(["-b", …])` sites became `-B` (idempotent) for crash-safety — a crash between a
worktree's removal and the state write that concludes the phase can leave the branch behind,
and a bare `-b` would fatal on re-entry.

**Tighter trust boundary on the unreviewed author branch.** Two location rules bound what the
unreviewed branch can land, both anchored on the committed `<testDir>/`. First, every
`critical` manifest entry's `spec_path` must itself start with `<testDir>/` — a critical entry
declared at the repo root would otherwise merge an unreviewed file into application source
purely by self-declaring as "critical" (nothing else checks a critical entry's location).
Second, the engine does a name-only diff against staging and rejects **any** changed path
outside `<testDir>/`. Because throwaway specs live out-of-repo (never committed, never in this
diff), the only files a legitimate author branch touches are critical specs under
`<testDir>/` — so once the critical-location rule holds, the stray-file guard collapses to the
single rule "only files under `<testDir>/` may change," with no per-file manifest allowlist.
The prior allowlist (built from every manifest `spec_path`, throwaway entries included) was
removed: it could have whitelisted a stray file merely by listing it as a throwaway entry.
Authored
specs run under a **scrubbed, allowlisted** env (PATH/HOME plus the boot vars, `replaceEnv`
so the parent `process.env` is not merged in), and `assertSafeSpecPath` guards every manifest
`spec_path` against traversal/absolute paths before any join/copy/`--testDir` use. Manifest
`task_ids` are validated against `run.tasks` at ingest, rejecting unknown ids loudly instead
of letting them silently vanish at reopen time. Schema invariants tightened to match:
`advisory` is enforced never-present-when-`failed` (mirroring `reason`-set-IFF-`failed`), and
`e2e.baseURL` is validated as a URL.

## Decision 40 — E2E Overhaul: Zero-Knowledge UX via Assessment, Adjudication, and Plain Language

**Date:** 2026-07-03

**Context:** A design review of Decision 39 against two goals — catch real regressions on
real apps, and require ZERO e2e knowledge from the user — found structural gaps: the user
had to hand-configure boot values they don't know; a stale committed spec (intentional UI
change) failed runs the user couldn't repair; a crashed author failed the whole phase; the
CI `e2e` job could brick auto-merge on infra CI can't boot; and every e2e surface spoke
engine jargon. Fourteen sub-decisions (D1–D14) landed as one overhaul; this is not a 39
addendum because it removes a 39 element (the CI job) and adds phases 39 never had.

**Decision (by sub-decision):**

- **D2/D10 — boot config is resolved, not configured.** `factory run create --e2e` eagerly
  checks only three static prerequisites (`package.json`, `@playwright/test`,
  `playwright.config.ts` — `factory scaffold` provides them). The real boot pair
  (`startCommand`/`baseURL`) has a single source of truth: `resolveBootConfig` = operator
  config override ?? the values the run-start ASSESSMENT resolved (and wrote into the
  repo's `playwright.config.ts`). The config keys are now optional overrides, normally
  unset. Phase-entry suspend stays as a backstop for legacy/assessment-skipped runs.
- **D3 — run-start e2e-assessment phase** (once per `--e2e` run, BEFORE any task; opus,
  `agents/e2e-assessor.md`, coroutine `src/orchestrator/assessment.ts`): (a) forecasts
  which committed specs this run's tasks will touch (`affected_specs` rows with
  `expectation: needs-update | should-still-pass` — the adjudication routing map);
  (b) detects/authors seed+auth machinery and writes the resolved boot pair into
  `playwright.config.ts`, validating by booting + logging in; (c) boot/machinery
  impossible → the RUN fails loud in plain language before any task runs; auth-only gap →
  degrade to logged-out coverage with a named warning that reaches the report.
- **D4/D5 — author hardening.** The e2e-author is apex-pinned (opus). Its failure modes
  split: deliberate verdicts (BLOCKED/NEEDS_CONTEXT) stay FINAL; a crash/unparseable
  status earns ONE automatic re-spawn (`author_attempts`, cap 2) from a hard-reset
  worktree. Runner dead-agent synthesis must parse as the retryable `error` status —
  never contain BLOCKED/ESCALATE/NEEDS/DONE (the R2 wording lesson).
- **D6 — converse manifest check.** Every committed file under `testDir/` must be a
  declared critical manifest row (carve-out: `support/**`, `auth.setup.ts`) — an
  undeclared spec could never reopen a task when it later fails.
- **D7 — adjudication of pre-existing failing specs.** An unmappable critical failure no
  longer hard-fails the run. Routing (in `runSuiteAndDecide`): forecast
  `should-still-pass` → reopen the mapped tasks like any manifest failure; forecast
  `needs-update` → adjudicator spawn in pre-authorized update mode; unforecast →
  adjudicator rules **regression** (fail loud with its plain-language reason) vs
  **intentional-change** (REQUIRES a verbatim citation of the authorizing task/criterion;
  the spec is rewritten to the new behavior, re-proven fail-first, diff-scope-guarded,
  merged, and the suite re-runs). Cap: ONE adjudication per spec per run
  (`adjudication_counts`) — failing again after the update merged IS a regression. The
  cursor (`e2e_phase.adjudication`) routes the record leg; `E2eAction` spawns are
  discriminated by `expects: "author-results" | "adjudication-results"`, and both runners
  loop while `kind === "spawn"`. Rescue drops a live cursor (dead worktree) but preserves
  `adjudication_counts`.
- **D8/D12 — plain language end to end.** Playwright per-test error detail (4KB cap)
  rides into `e2e_feedback` and adjudication prompts. Manifest rows carry a human `title`;
  the run report gains `e2e_journeys` (what was verified, in user words), `e2e_reopened`
  (found-and-sent-back), `e2e_warnings` (assessment degradations), and
  `e2e_assessment_failure`; engine reasons may follow `"<plain>\n<detail>"` — renderers
  show the plain line and fence the detail.
- **D9 — reopened tasks keep the FULL pipeline** (explicit no-change).
- **D11 — CI `e2e` job removed** from the quality-gate template and auto-merge `needs:` —
  a committed suite CI cannot boot would brick auto-merge (self-inflicted, undebuggable
  for a zero-knowledge user). Critical specs still gate every `--e2e` run's rollup.

**Consequences:** A user needs to know nothing about e2e testing: setup is assessed and
authored for them, intentional UI changes no longer wedge runs, and every failure surface
leads with a sentence a non-engineer can read. In-flight pre-D40 `--e2e` runs hit the
assessment gate on resume (idempotent, acceptable). The committed suite no longer runs in
CI — its gate is the factory run itself.

---

## Decision 41 — Runtime Circuit-Breaker: Idle Never Counts, and a Runtime Trip Suspends

> **Superseded (2026-07-03, [Decision 42](#decision-42--one-runner-workflow-mode-deleted-runquota-presence-is-the-suspend-discriminant)).** The runtime arm and the whole idle-crediting apparatus (`paused_minutes`, `idleGapCredit`, `ACTIVE_GAP_CAP_MINUTES`, `maxRuntimeMinutes`, scope `"runtime-budget"`) were deleted with workflow mode; the circuit breaker is **failures-only**. Kept for history.

**Date:** 2026-07-03

**Context:** The workflow-mode runtime circuit breaker (`src/orchestrator/circuit-breaker.ts`)
trips on effective runtime `(wall − paused) >= maxRuntimeMinutes` (default 480). Its
`paused` term relied on `paused_minutes` being banked at scattered sites — resume and
rescue-reopen — which only fire when someone drives the loop. A workflow run that a human
simply walked away from for three days accrued **zero** paused credit: the pause was
counted as runtime, tripped the breaker (`max runtime reached (4211min >= 480min)`), and
the trip's HARD-abort behavior cascade-failed 28 otherwise-healthy tasks. Two defects
compounded: idle time was mis-credited, and even a correct runtime trip was treated as a
pathology rather than a recoverable budget stop.

**Decision:**

- **`StateManager.update()` is the SOLE writer of `paused_minutes`** (`src/core/state/manager.ts`).
  Every state write banks `max(0, gap_since_last_write − ACTIVE_GAP_CAP_MINUTES)` as idle,
  where the cap is 60 minutes (exported `ACTIVE_GAP_CAP_MINUTES` + pure `idleGapCredit()`).
  A legitimate workflow step (spawn write → agent stage → results write) stays under the
  cap; a human pause writes nothing for hours-to-days, so its whole gap-minus-cap is banked
  the moment the next write lands. **Counted runtime is therefore Σ min(gap, 60)** —
  activity time, not wall-clock. The two old scattered crediting sites (rescue-reopen in
  `src/rescue/apply.ts`, resume in `src/cli/subcommands/run.ts`) were **deleted** — one
  writer, no double-count.
- **Read-side pending-gap term.** `nextTask` evaluates the breaker _before_ any post-pause
  write lands, so the breaker gate (`src/orchestrator/circuit-breaker-gate.ts`) adds the
  same `idleGapCredit(run.updated_at, now)` for the still-pending gap since the last write.
  The persisted credit plus this read-side term give an exact idle deduction at evaluation
  time.
- **Arm-tagged verdicts with different severities.** `CircuitBreakerResult`'s tripped
  variant now carries `arm: "runtime" | "failures" | "fail-closed"`. `nextTask`
  (`src/orchestrator/next.ts`) maps severity:
    - **`runtime`** → the run is **suspended** (not failed) and returns a `kind:"pause"`
      envelope with the new scope `"runtime-budget"`; the reason tells the operator to raise
      `maxRuntimeMinutes` in `config.json` and resume. Resuming without raising the cap simply
      re-suspends here. This preserves the 28 healthy tasks the old cascade-fail destroyed.
    - **`failures` / `fail-closed`** → unchanged HARD abort: every remaining non-terminal task
      is failed `capability-budget` (loud, classified) and the run falls through to
      all-terminal → finalize → `failed`, reusing the Decision-34 wedge-fail path.
- **Resume clears unconditionally in workflow mode.** A `runtime-budget` suspend is
  non-quota by construction — workflow mode never quota-pauses (Decision 24) — so
  `planResume` (`src/quota/resume.ts`) force-clears the checkpoint without consulting the
  usage pacer, exactly like `--ignore-quota`.

**Consequences:** A parked workflow run no longer self-destructs: idle is excluded from the
runtime ceiling by construction (single-writer + read-side term), and a genuine runtime
exhaustion is a resumable budget stop the operator clears by raising the cap, not a
28-task cascade failure. Following derive-don't-store, no breaker counter is persisted —
`paused_minutes` is the only new durable field and it is written in exactly one place.

---

## Decision 42 — One Runner: Workflow Mode Deleted; `run.quota` Presence Is the Suspend Discriminant

**Date:** 2026-07-03

**Context:** The 2026-07 design review concluded the unattended path (workflow mode) was
the least-hardened surface: no quota pacing (Decision 24 exempted it), an LLM in the
control channel (every CLI step wrapped in a Sonnet exec-agent — the blocker-#9 class),
a permanent exec-agent quota tax, and a second runner protocol to keep in lockstep with
the session loop. The redesign (2026-07-03, session plan S1–S12) chose ONE runner: the
session loop becomes a parallel event loop; workflow mode dies entirely.

**Decision:**

- **Workflow mode is deleted end to end.** `scripts/factory-run-runner.js`, the
  workflow envelope (`src/orchestrator/workflow-envelope.ts`), `--workflow`/`--expect-mode`,
  `RunModeEnum` and the persisted `mode` field, and the stop-gate's workflow ALLOW are all
  gone. `--owner` is now always required — no unattended exemption. `z.object` strips the
  stale `mode`/`paused_minutes` keys from persisted runs; no migration.
- **The circuit breaker is failures-only.** The runtime arm existed to bound an unattended
  workflow run; with the runner always session-owned it lost its reason to exist. The whole
  Decision-41 idle-crediting apparatus (`paused_minutes`, `idleGapCredit`,
  `ACTIVE_GAP_CAP_MINUTES`, `maxRuntimeMinutes`, `maxStaleCycles`, scope
  `"runtime-budget"`) is deleted with it. A trip (`cumulativeFailures >=
maxConsecutiveFailures`, capability-budget failures only, fail-closed on malformed
  input) is a HARD abort, as before Decision 41.
- **`run.quota` presence ⇔ the stop was quota-caused.** Every quota stop now writes a
  checkpoint — including the fail-closed unavailable halt, which writes
  `{binding_window: "unavailable"}` (the enum gains that value; `resets_at_epoch` is
  optional). Non-quota suspends (docs/e2e parks, future spec-approval) never write one.
  `planResume` needs no stored reason field: a quota-present suspend gets a fresh pacer
  recheck (an unavailable checkpoint rechecks like any window); a quota-absent suspend
  clears unconditionally — **resume IS the sign-off**. Legacy pre-42 unavailable suspends
  (no checkpoint) self-heal: cleared as non-quota, re-suspended by the next quota gate if
  usage is still unobservable. An explicit `suspend_reason` field was rejected: three
  writers plus every clear path for the same discrimination the checkpoint already makes.

**Consequences:** One runner protocol, no LLM in the control channel, no exec-agent tax,
and quota pacing applies to every run (the Decision-24 workflow exemption is moot).
Decisions 24 (workflow half), 28, and 41 are superseded in their workflow-specific parts.
Supersedes the runtime arm entirely; Decision 41's idle-crediting rationale is preserved
here for history but the mechanism no longer exists.

**Addendum (2026-07-03) — the runner event-loop protocol (S3).** The "parallel event
loop" this decision announced is now specified in `skills/pipeline-runner/SKILL.md`
(Phase 3). The load-bearing choices: the **main session is the multiplexer** —
background subagents cannot spawn agents, so ALL `factory` CLI calls run FOREGROUND in
the main session (one-driver-per-task by construction) and ONLY `Agent()` spawns run in
the background. The runner's **in-flight table** (`task_id → {result_key, wave, agent
ids}`) is a rebuildable cache held in conversation context only — the state file is
truth, and compaction recovery re-derives it from `next-task` (in-flight first) +
idempotent `next-action` re-invocations, never from memory. After every completion the
runner **refills** up to the work envelope's `max_parallel`; a task's wave records only
when ALL its agents are in (`next-action --results`, foreground). Any `kind:"pause"`
from either verb converges hard: spawn nothing, `TaskStop` every in-flight agent —
safe because the quota gate precedes `recordResults` and the `spawn_in_flight` reset
makes abandoned spawns resume-clean. Run-level stages (document / e2e / finalize) only
emit once the table is empty by construction; one arriving with tasks in flight is an
engine defect, stop loud.

---

## Decision 43 — Panel 7→4: Quality Absorbs Security, Architecture, and Type Design

**Date:** 2026-07-03

**Context:** The risk-invariant panel (Decision 26) spawned 7 Opus reviewers on every
task — the single largest quota spend on the happy path. Review telemetry showed the
architecture, security, and type-design lenses were the panel's lowest-marginal-value
layer: heavily overlapping citation disciplines (quote the import / quote the source→sink
pair / quote the declaration), the same fresh-context adversarial posture, and findings
that a strong quality reviewer surfaces anyway. The 2026-07 redesign (session S4,
workstream B1) consolidated them.

**Decision:**

- **`PANEL_ROLES` is exactly 4:** `implementation-reviewer`, `quality-reviewer`,
  `silent-failure-hunter`, `systemic-failure-reviewer` (~-43% panel spend). The
  architecture, security, and type-design charters fold into a rewritten merged
  `quality-reviewer` charter that keeps each lens's citation law (source→sink both lines;
  quote the import edge; quote the indicted declaration), adds an explicit
  dimension-ownership map, and keeps Codex as the preferred executor. Unanimity,
  risk-invariance, engine-side Opus pinning, citation-verify, and the finding-verifier
  (Decision 27) are all unchanged.
- **No state migration.** `ReviewerResultSchema.reviewer` is an open string; an in-flight
  pre-43 7-role run self-heals at the record seam (`enforcePanelRoster`): retired-role
  reviews demote to `verdict:"error"`, the gate fails loud, and the task re-reviews with
  the 4-role panel — one burned rung, no silent pass.
- **Findings cap 10, engine-enforced, with visibility.** The old cap existed only as
  charter prose ("≤ ~7"). `parseRawReview` now soft-truncates to the FIRST 10 findings
  (the reviewer's own likelihood × impact ranking) — never a parse error, which would burn
  escalation rungs on noise. Overflow is added to the new optional `dropped_by_cap`
  RawReview field (reviewers may also self-report it) and surfaced via warn; it stays in
  the review artifact, not run state.

**Consequences:** Panel quota drops ~43% per task with the merged charter carrying the
folded dimensions' iron laws. A weaker per-dimension depth is the accepted trade — the
deterministic gates (SAST, dependency-cruiser, tsc) still own the mechanical ends of
security/architecture/types, and `dropped_by_cap` makes truncated coverage read as
truncated. Decision 26's roster examples now describe 4 roles.

---

## Decision 44 — Verifier Upgrades: Grep-Rescue, Claim-Only Verification, Real Cross-Vendor

**Date:** 2026-07-03

**Context:** Redesign session S5 (workstream B2). Three verify-pipeline defects: (1)
citation-verify dropped findings whose quote was REAL but whose line number was off by
more than ±2 — losing true blockers to a reviewer's counting error; (2) the independent
finding-verifier (Decision 27) received the reviewer's full finding including
`description`, so its "independent" judgment could be anchored by the finder's reasoning
chain; (3) cross-vendor review was aspirational — the panel was hardcoded all-Claude,
the SKILL shipped a hardcoded `crossVendorAbsent` string, and debug's `codex_available`
was a config-presence check that never executed Codex.

**Decision:**

- **Grep-rescue (Δ K).** On `quote-not-in-window`/`line-out-of-range`, a single-line,
  non-blank trimmed quote is grepped across the whole cited file; EXACTLY one match →
  the finding is kept with its line RELOCATED (audit `RELOCATE relocated_ok`), 0 or ≥2
  matches → dropped as before. `uncitable`/`file-not-found`/multi-line never rescue.
  `kept` entries carry `{finding, citedLine?}`: confirmation (and the replay runner's
  `file:line` verdict key) uses the CITED line — what the verifier agent actually saw —
  while `fix_findings`/reports carry the RELOCATED line. A naive relocate-before-confirm
  would orphan every recorded verdict and turn rescued blockers into blocked tasks.
- **Claim-only verification (D27 hardening).** `Finding` gains a required
  `claim` (≤300 chars, the one-sentence checkable assertion; `description` stays the
  reviewer's reasoning). The verifier sees ONLY the typed `ClaimOnlyFinding`
  projection `{claim, file, line, quote}`. **Admissibility rule:** a field enters the
  verifier's prompt iff the verifier can CHECK it against the code — `claim` is the
  proposition under test, and `file`/`line`/`quote` say where to look (`line` is a
  coordinate, not an assertion). What the reviewer BELIEVED is excluded: its reasoning
  (`description`), its confidence (`severity`), and its identity (`reviewer`). None can
  be confirmed or refuted by reading the file, so each is a pure prior — severity is the
  finder's own confidence signal and decision-irrelevant (`blocking:true` already
  filtered, materiality is defined intrinsically in the agent body); reviewer is an
  authorship label, and withheld authorship is what makes cross-context review
  non-sycophantic. The rule derives the whitelist rather than enumerating it.
  `description?: never; severity?: never; reviewer?: never` makes leaking any of the
  three a compile error, and `pipeline-runner`'s SKILL pins the interpolation rule.
  `FixFinding` (producer-facing) deliberately KEEPS `description`.
  `claim` is REQUIRED with no grace fallback: prompts + engine ship in one bundle, and a
  mid-upgrade old-format review fails loud at `parseRawReview` → fresh panel spawn.
- **Real cross-vendor (Δ U).** `review.requireCrossVendor: "warn" | "block"` (default
  `warn`). The engine resolves availability once per spawn decision via
  `resolveCodexCrossVendor` — a memoized `codex --version` probe, short-circuited to a
  deterministic `absent` when `codex.model` is unset (default config never shells out) —
  and stamps `cross_vendor: {status:"present",model} | {status:"absent",reason}` on the
  verify panel manifest. `present` ⇒ the runner executes the quality-reviewer via
  `codex exec --sandbox read-only` (Claude fallback + honest
  `codex execution failed: <detail>` absence on runtime failure). `warn` ⇒ the absence
  persists as `TaskState.cross_vendor_absent` (event record, written in the same advance
  write as `reviewers`) and surfaces as the report's `## Review independence` section +
  the summary's `tasks_without_cross_vendor` — no more buried `log.warn`. `block` ⇒
  runPanel demotes the quality-reviewer result to `verdict:"error"` (fail-closed
  synthesis if missing) so the merge gate blocks with the policy named in the reason;
  the verify handler fail-fasts the spawn (wait-retry BEFORE burning a 4-Opus panel)
  when the probe already says absent.

**Consequences:** Real blockers with off-by-a-few citations now survive to
confirmation; ambiguity still fails closed. The verifier judges the bare claim against
the code. Single-vendor review is now a visible, policy-controlled property of a run
instead of a silent default; `block` makes Decision 43's "Codex is the preferred
executor" enforceable end-to-end.

---

## Decision 45 — Proportional Circuit Breaker + Config Pruning

**Date:** 2026-07-03

**Context:** Redesign session S6 (workstream C2 + C6). (1) The run-level circuit
breaker tripped at a flat `maxConsecutiveFailures` (default 3) regardless of
task-graph size — on a 40-task PRD, 3 genuine failures out of 40 aborted the whole
run, the sharpest edge of the whole-PRD delivery cliff (Decision 34 keeps whole-PRD
delivery; this softens it). (2) Two config surfaces were decorative: `e2e.enabled`
was informational-only (the e2e phase is gated solely by `run.e2e` from the `--e2e`
flag — verified zero control-flow readers), and `spec.specModel`/`spec.specEffort`
were a frozen-default pin no override could ever reach (the apex boundary read
`SPEC_DEFAULTS`, never the resolved config).

**Decision:**

- **Proportional breaker (C2).** `effectiveThreshold = max(maxConsecutiveFailures,
ceil(0.15 × totalTasks))`. The existing config key is REINTERPRETED as the floor —
  no rename, default 3 unchanged; ≤20 tasks behave exactly as before, 30 → 5, 40 → 6.
  `FAILURE_RATIO = 0.15` is a module constant in `src/orchestrator/circuit-breaker.ts`, NOT
  config (no speculative knob). `CircuitBreakerInput` gains `totalTasks`, fail-closed
  on malformed input like `cumulativeFailures`; the gate supplies
  `Object.keys(run.tasks).length` (derive-don't-store, as before).
- **Config pruning (C6).** `e2e.enabled` and `spec.specModel`/`spec.specEffort`
  deleted from the schema. The Decision-21 apex pin becomes hard consts
  (`APEX_MODEL`/`APEX_EFFORT`) in `src/spec/agents.ts` — invariant by construction
  instead of by docstring; the rest of `SPEC_DEFAULTS` survives. Stale on-disk
  overlays keep loading (ConfigSchema strips unknown keys; regression test extended
  with the newly pruned keys).

**Consequences:** Large task graphs tolerate a proportional failure budget instead
of a fixed one, so one bad corner of a big PRD no longer aborts still-runnable
independent work; small runs are byte-identical to before. The config surface only
contains keys the engine actually branches on.

---

## Decision 46 — The Gate Contract: Scaffold-Time Applicability, Committed and Enforced

**Date:** 2026-07-04

**Context:** Redesign session S7 (workstream B3). Gate applicability was decided
ad-hoc inside each deterministic strategy: a missing eslint binary, absent coverage
data, or unconfigured security command silently SKIPPED the gate (excluded from the
merge conjunction). On a Deno repo every tool-probe gate skipped — "nothing ran"
could quietly pass a task. The one prior attempt at stack flexibility,
`quality.redTestCommand`, was declared in the schema and read by nothing.

**Decision:**

- **The contract.** `factory scaffold` detects the stack (deno-first, then npm,
  else refuse) and writes `.factory/gates.json` into the target repo: `{version,
stack, gates}` with ALL 8 gate ids as REQUIRED keys — each `{contracted: true}`
  (optionally a stack `command` for test/type/build/lint, e.g. `deno test`) or
  `{contracted: false, reason}` (the committed audit trail). Strict zod schema; a
  `command` on a non-command gate is rejected at parse (never
  declared-but-not-wired); commands pass the shared charset allowlist +
  a modest runner policy (`src/shared/command-allowlist.ts`,
  `isAllowedGateRunner`). The file is TCB-write-denied (hook rule
  `gate-contract`) so producers cannot weaken their own gates.
- **Skip taxonomy.** `classifySkip` splits skip reasons: SCOPE
  (`no-vitest-runnable-tests-in-scope`, `no-mutable-changes` — properties of the
  task) stay excluded as today; everything else is TOOLING (missing
  binary/config/data), and unknown reasons classify as tooling (fail-closed). At
  gate time: an uncontracted gate skips cleanly WITHOUT invoking its strategy
  (`uncontracted: <reason>`); a TOOLING skip on a CONTRACTED gate converts to a
  loud FAIL (`contracted-but-unrunnable: <reason>`), NOT memoized (installing a
  tool changes node_modules, not the tree SHA).
- **Commands execute.** test/type/build/lint honor the contracted `command` via a
  `CommandRunner` gate tool (argv spawn, no shell). A contracted test command runs
  the FULL suite — no vitest diff-scoping — killing the Deno trap where a
  non-JS diff scope-skipped a contracted test gate.
- **Floor + waiver.** Scaffold refuses to write a below-floor contract (npm floor:
  vitest dep + tsconfig.json + scripts.build; deno's `deno check` is
  build-equivalent when no build task exists). Mutation on npm requires stryker or
  an explicit `--waive mutation`; coverage on npm requires a vitest coverage
  provider (`@vitest/coverage-v8`/`-istanbul`) or an explicit `--waive coverage`
  (S8 flipped the interim "not wired yet" waiver).
  Seed semantics: absent → write; valid → untouched; invalid → refuse.
- **`run create` precondition.** A run is only born when the contract is present,
  valid, AND git-tracked (an uncommitted contract never reaches task worktrees).
  `--resume` is exempt; pre-contract in-flight runs take GateRunner's legacy path
  (absent contract → today's semantics + one warn per sweep) and the run report
  derives a `## Warnings` legacy-run line from contract absence at finalize
  (derive-don't-store; TODO remove after one release).
- **Pruned `quality.redTestCommand`** — zero code consumers; exotic runners now go
  through the contract's per-gate `command`. Stale overlays keep loading
  (ConfigSchema strips unknown keys; regression fixture extended).

**Consequences:** A gate can no longer silently vanish from the merge conjunction:
every non-run is either a committed, reasoned waiver or a loud failure naming the
broken tooling. Non-npm stacks get first-class gates instead of a skip cascade.
The contract is repo-owned, reviewed in PRs, and protected from the producers it
judges.

**S8 addendum (executable shift, same date):** the coverage gate now EXECUTES
under the contract. Coverage joined COMMAND_GATES (a `gates.coverage.command`
override must itself write `coverage/coverage-summary.json`); the dead
reader path (`CoverageReader`, `no-coverage-data`) is deleted. The gate measures
head in the task worktree and base via an ephemeral detached worktree, both
persisted per tree SHA in `runs/<run-id>/coverage/` (perf cache only —
measure-on-miss, verdict re-derived every sweep). Every non-measured answer
fails closed naming the side; the sole remaining skip is `no-gate-contract`
(legacy pre-contract worktrees, TODO remove after one release). Scaffold
contracts coverage on npm behind the provider check above; deno stays
waived-by-stack (lcov, no json-summary) with the command override as the escape
hatch. Scaffold also emits a one-line fast-check advisory (npm, not a dep) so
the test-writer can write property tests — advisory only, never installs.

---

## Decision 47 — Spec Hardening: Specifiability Gate, PRD Traceability, Approve-Spec Park

**Date:** 2026-07-04

**Context:** Redesign session S9 (workstream B5). Nothing verified spec-vs-intent:
a plausible-but-wrong spec shipped with every gate green — the spec chain was the
least-verified link in the quality spine. Three mechanisms close it.

**Decision:**

- **Specifiability gate (free, pre-generation).** Deterministic
  `specifiabilityGate(prdBody)` runs in `spec resolve` between the scratch
  `prd.json` write and the `generate` envelope: ≥200 chars of non-heading body,
  ≥1 extractable requirement (`extractPrdRequirements` — Out-of-Scope excluded),
  and an acceptance-criteria-style section heading (or, since Decision 56, nested
  per-requirement criteria). Refusal emits a
  `{kind:"unspecifiable", blockers}` envelope + `EXIT.ERROR` (exit-code enum is
  FROZEN — the envelope `kind` is the machine discriminator, no new code). The
  runner STOPS before any agent spawn: the PRD needs editing, at zero agent cost.
  The gate is UNIVERSAL — debug's synthetic PRD gained a real
  `## Acceptance Criteria` section (one criterion per finding) instead of a
  bypass flag. Reuse of an existing spec never re-runs the gate.
- **Durable PRD snapshot.** `SpecStore.write` takes the PRD as a REQUIRED third
  param and persists `prd.json` beside `spec.md` (not mirrored to
  `docs/factory/` — the PRD is already public on the issue). Reuse backfills a
  missing snapshot once via `gh.fetchPrd`; `run create` preflights its presence
  (a full-run-cost traceability failure becomes a pre-run refusal). REJECTED: a
  `gh` re-fetch at finalize — network at the most expensive moment, and it would
  audit a possibly-edited PRD (TOCTOU). The audit judges the PRD the spec was
  generated from.
- **PRD-traceability stage (+1 Opus per run).** A new run-level phase between
  e2e and docs on EVERY prospectively-completed non-debug run: an Opus auditor
  (`agents/traceability-auditor.md` — adversarial, evidence-first, read-only,
  judges ONLY the diff/tree, never task statuses) reads the whole staging diff
  in a DETACHED worktree (`worktrees/<runId>/.trace`; no branch to GC, TCB-safe)
  and returns one `met|partial|unmet` verdict per numbered PRD requirement.
  Coverage is semantically enforced (exactly one verdict per index 1..n, LOUD).
  Any `unmet` → the phase concludes `failed` (a verdict is judgment — no retry),
  finalize's terminal override condemns the run, the rollup never ships, and the
  PRD comment carries an "Unmet PRD requirements" block. `partial` passes but
  surfaces as `traceability_gaps` in the report even on a done audit.
  Trace-before-docs ordering: a condemned run never pays the docs Opus, and docs
  commits stay out of the audited diff. ANTI-DOCS DELTA: an auditor crash at cap
  (`MAX_TRACE_ATTEMPTS = 2`) concludes `failed` — docs is best-effort-done, the
  delivery gate never is. A pre-cap crash suspends WITHOUT a quota checkpoint
  (A2) and re-fires on resume; concluded-vs-awaiting-retry is derived from
  verdicts-presence (failed + verdicts>0 = concluded unmet; failed + attempts ≥
  cap + verdicts=[] = concluded crash; derive-don't-store, pinned). Verdict rows
  persist in the phase marker with requirement TEXT, not index (frozen against
  extractor drift; bounded — one row per PRD bullet, evidence ≤500 chars).
  Debug runs skip the stage (their review⇄fix loop IS their traceability), but
  keep the specifiability gate via the synthetic AC section.
- **`run create --approve-spec` (default OFF).** The run is created IN FULL
  (staging cut, tasks seeded), then ONE `state.update` parks it `suspended` with
  NO quota checkpoint (A2). The envelope gains `spec_approval: {spec_path,
note}`; still `EXIT.OK`. Resume IS the sign-off — `planResume` already clears
  non-quota suspends unconditionally, so resume re-implements NOTHING. ACCEPTED
  HAZARD (documented, not fixed): `next-task` step-4 clears any suspension once
  the quota gate proceeds — the park holds because `commands/run.md` instructs
  the session to STOP on the parked envelope (docs/e2e parks share this
  property).

**Rejected:** a new exit code (enum frozen); per-task traceability (needs the
whole-diff view, multiplies Opus); a sidecar verdicts file (parse seam that can
desync from `status`); `gh` PRD re-fetch at finalize (TOCTOU); a debug bypass
flag for the specifiability gate (AC section instead).

**Consequences:** A PRD that cannot support spec generation is refused for free
before any agent runs; a run whose shipped diff does not satisfy the PRD's
requirements cannot merge to develop; and a human can opt into signing off the
spec before the pipeline spends anything. Cost: +1 Opus audit per completed run.

---

## Decision 48 — `factory recover` + Bounded Auto-Rescue (Self-Heal)

**Date:** 2026-07-04

**Context:** Redesign session S10. Repairing a stalled run demanded the operator
know WHICH of three verbs applied (`resume` for parks, `rescue` for stuck/failed
tasks, neither for dead-ends) — triage knowledge the engine already has. And a
transient failure (a flaky environment) that failed a run stayed failed until a
human typed the rescue incantation, even when the engine knew the reset was safe.

**Decision:**

- **`factory recover` — ONE self-routing repair verb.** Pure ROUTING over the
  existing seams (`scanRun`, `assessWork`, `applyRescue`, `applyResume`) — zero
  new pipeline logic. Routes in order: no run → `{kind:"nothing"}`;
  completed/superseded → nothing (+ `--recheck-rollup` hint when a rollup is
  armed); paused/suspended + clean scan → resume, the envelope naming the
  DERIVED awaiting cause (`quota|e2e|traceability|docs|spec-approval` via pure
  `deriveAwaiting` — never a stored reason field); resettable work → rescue
  apply + clear any surviving park, with `reconcile:true` when the git probe
  flags drift (recorded branch gone / staging base unresolvable — the COMMAND
  doc then spawns rescue-reconciler; the CLI never spawns agents); dead-ends/e2e
  only → `{kind:"page"}` with exact `rescue apply` hint commands. Every envelope
  is EXIT.OK — a page is a routed outcome, not a CLI failure. `--dry-run` emits
  scan + route, writing nothing; `factory rescue scan` is now an alias of it.
  `resume`/`rescue` stay registered as the flag-rich escape hatches.
- **`--auto` — ONE bounded self-heal cycle per run.** Fired by the runner ONCE
  after a failed finalize. The auto-safe set is `effectiveAutoResets`:
  `scan.resettable` (stuck ∪ recoverable) filtered to tasks ACTIONABLE
  POST-RESET — simulate all candidates `pending`, keep a task iff no task in its
  transitive `depends_on` closure remains failed/missing. A candidate downstream
  of a dead-end is excluded (its reset would just re-cascade and re-finalize — a
  pure quota burn). Dead-ends, e2e verdicts, and rollup rechecks are NEVER auto
  (each needs a human assertion the cause is fixed). Targets + gating are
  computed INSIDE the locked `applyRescue` mutator; `auto` is mutually exclusive
  with every manual option (LOUD error).
- **`self_heal` stored-event exception.** `{attempts, last_at}` on RunState —
  a sanctioned exception to derive-don't-store (precedent: the retired
  `paused_minutes`): "how many self-heal cycles already ran" is history no
  state/git re-derivation can recover. `--auto` requires `attempts === 0`,
  bounding the loop to ONE cycle; a blocked auto never spends the cycle.
  ([Decision 60](#decision-60--autonomous-forward-only-adoption-write-side) later
  raises this bound to three cycles — `attempts < SELF_HEAL_MAX_ATTEMPTS` — once
  forward-only adoption removes the merged-work-loss hazard.)
- **Loud page.** A blocked `--auto` posts ONE comment on the originating PRD
  (deduped via `selfHealCommentMarker`, same contract as the failure comment) —
  the runner is unattended, stdout reaches nobody. The finalize failure comment
  gains a "self-heal runs next" line iff eligible (attempts=0 ∧ non-empty
  effective set), so the PRD reader knows whether to wait or triage.

**Consequences:** `factory recover` is the only verb an operator needs to
remember; transient failures clear themselves exactly once with no human in the
loop; and a run can never ping-pong between finalize and self-heal — the
attempts ledger caps the cycle at one, after which a human is paged with exact
repair commands.

---

## Decision 49 — Observability: Touch Metric + Statusline Progress + `score --fleet`

**Date:** 2026-07-04

**Context:** Redesign session S11 (close-out). The factory's objective is
lights-out delivery, but nothing measured it: no per-run record of how many
times a human had to intervene, and no ambient signal of run progress without
polling `factory state`.

**Decision:**

- **`human_touches` stored-event ledger** — the SECOND sanctioned exception to
  derive-don't-store (after `self_heal`, Decision 48): an append-only
  `{kind, at}` array on RunState. Engine write-sites append exactly ONE touch
  per human action: `launch` (run create), `conflict` (the supersede-created
  fresh run, on top of its launch), `resume` (a human resume that actually
  cleared a park — the idempotent already-running re-entry appends nothing),
  `recover` (a manual rescue apply that did work). `recover` route 4
  (rescue + resume tail) is ONE action → ONE `recover` touch; the resume tail
  runs with `{touch:false}`. `--auto` self-heal NEVER appends — it is not a
  human. Each append is mirrored to `metrics.jsonl` (`human_touch` event) at
  the CLI layer for offline analysis.
- **The touch metric is DERIVED, never stored:** per run,
  `(completed ? 1 : 0) / human_touches.length`. `launch` counts, so a clean
  lights-out run scores exactly **1.0** — the acceptance bar S12 smokes
  against. Legacy runs without the ledger report `null`/n/a, never a
  fabricated value. Surfaced in `RunSummary` + report.md.
- **`factory score --fleet`** — the store-wide roll-up: per-run
  `{run_id, status, touches, metric}` plus
  `aggregate = sum(completed) / sum(touches)` over runs carrying the ledger
  (`null` when none do). Rides the tolerant `listRuns` (malformed run dirs
  warn + skip).
- **Statusline run-progress suffix** — ` [factory <done>/<total> <phase>
<run_id> <status>]` appended to the passthrough line. Raw `JSON.parse` of
  `state.json` through the GLOBAL `runs/current` pointer — deliberately NOT
  `parseRunState`: a torn/partial read degrades to NO suffix; the statusline
  never throws (always EXIT.OK). Terminal runs linger ≤30 min past `ended_at`;
  `FACTORY_STATUSLINE_PROGRESS=0` disables. Accepted limit: the global pointer
  shows the most-recent-writer under two concurrent repo runs.

**Consequences:** every run now answers "how autonomous was it?" with one
number whose perfect score is exactly 1.0; the fleet aggregate makes regressions
across runs visible; and run progress is ambient in the statusline without a
single state-poll — all without breaking derive-don't-store, because the ledger
records EVENTS (irrecoverable history), never derivable state.

---

## Decision 50 — One Consent-Gated Repair Verb: `/factory:resume` Absorbs Rescue and Recover

**Date:** 2026-07-06

**Context:** Decision 48 collapsed the triage knowledge into `factory recover`, but
the OPERATOR surface still exposed three overlapping verbs (`/factory:resume`,
`/factory:rescue`, `/factory:recover`) — near-synonyms confusing enough that the
newest one went unnoticed. And `recover` auto-applied stuck/recoverable resets
without asking, while `rescue` demanded typed flag incantations (`--task`,
`--reset-e2e`, …) for the human assertions.

**Decision:**

- **ONE slash command: `/factory:resume`.** The operator intent is always "make my
  run continue"; escalation is internal, not a second command.
  `/factory:rescue` and `/factory:recover` are deleted. Supersedes Decision 48's
  command surface and Decision 35's resume/rescue verb split (both histories stand).
- **Consent replaces verb-splitting.** `factory rescue scan` (read-only) now carries
  the routing: `nothing` (no run / terminal with nothing repairable) → report + stop;
  `resume` (clean park or healthy re-entry, `awaiting` naming the derived park
  cause) → `factory resume`, no prompt; `repair` → the rescue-protocol skill builds
  a proposed plan — safe resets, diagnostic-recommended dead-ends
  (`rescue-diagnostic` agents run first), e2e/traceability verdict clears, rollup
  recheck, git-drift reconciliation — and presents it as ONE AskUserQuestion
  multiSelect. The human approves ANY SUBSET; exactly that subset executes via ONE
  `factory rescue apply`. **Nothing mutates without an approved plan item** —
  including the stuck/recoverable resets `recover` previously auto-applied. The
  scan's `hints` (one exact `apply` command per proposable repair) double as the
  decline path's manual escape hatch.
- **A healthy `running` run routes `resume`, not `nothing`** — one command always
  makes progress; `applyResume` is the idempotent re-entry (and re-enters a
  finalize when all tasks are terminal).
- **`recover` dies as a name; `rescue scan|apply|auto` is the CLI plumbing.** The
  bounded self-heal (`recover --auto`) is renamed `factory rescue auto`, semantics
  identical (Decision 48's `effectiveAutoResets` + `self_heal.attempts === 0`
  bound). The apply's park-clear tail moved INTO `rescue apply` (`{touch:false}`
  resume), preserving Decision 49's ONE-action-ONE-touch accounting: an approved
  plan application appends ONE `recover` touch, and the follow-up
  `factory resume` is the touchless already-running re-entry. The stored
  `human_touches` kind literal `'recover'` is RETAINED (existing runs carry it;
  it is not operator-facing) — the sanctioned exception to the rename.
- **Model A intact.** The CLI stays deterministic — scan/route/hints in envelopes,
  `apply` the only writer, never a prompt or an agent spawn. Prompting, diagnostics,
  and reconciliation live in `commands/resume.md` + `skills/rescue-protocol/`.

**Consequences:** one verb to remember, one interactive consent point, zero typed
flag incantations on the happy path; a clean park still resumes promptly with no
prompt at all; and the no-mutation guarantee the old `resume` provided by
construction is now provided by consent — stronger, because it also covers what
`recover` used to change silently.

---

## Decision 51 — Content-Conditional DB-Design Specialist Reviewer

**Date:** 2026-07-06

**Context:** Schema mistakes (missing constraints, float money, one-step
destructive migrations) are the most expensive defect class and no panel lens
owned them. Folding the lens into `quality-reviewer` (the Decision 43 route) was
rejected: DB design applies to a small minority of diffs, and carrying its
rubric on every task dilutes the reviewer's attention. But the panel is
deliberately risk-invariant (Decision 26) — `buildPanelManifest` has no tier
parameter — so a conditional reviewer needed a principled carve-out.

**Decision:**

- **The invariant is about RISK TIERS, not content.** Risk-invariance guards
  against the engine skimping review on an unreliable risk-tier _judgment_.
  "The diff touches a migration file" is a deterministic _fact about content_,
  and the specialist is strictly ADDITIVE: the four-lens floor
  (`PANEL_ROLES`) always runs; a DB-touching task gets floor + specialist.
  Review only ever gets stricter, never laxer.
- **`database-design-reviewer`** — a fifth `SpawnRole` with its own charter
  (`agents/database-design-reviewer.md`) and rubric skill
  (`skills/database-design-review/SKILL.md`, a review-framed distillation of
  relational-design Iron Laws + Decision Gates). Emits the same RawReview;
  flows through citation-verify + finding-verifier unchanged.
- **Trigger = ground truth, derive-don't-store:** `touchesDatabase`
  (`db-detect.ts`) runs `git diff --name-only base...HEAD` in the task
  worktree and matches built-in path patterns (`migrations/`, `db/migrate/`,
  `alembic/versions/`, `drizzle/`, `schema.prisma`, `*.sql`). No config
  surface, no persisted roster decision — the spawn site (handlers verify) and
  the record site (`enforcePanelRoster` caller) both re-derive from the same
  worktree tip, so they cannot disagree.
- **`panelRolesFor(dbApplicable)`** is the ONLY sanctioned roster sizing;
  roster enforcement fails closed both ways (expected-but-missing specialist →
  synthesized error; unexpected specialist on a non-DB diff → demoted to
  error).

**Consequences:** migration/schema diffs get a dedicated fresh-context schema
review at zero cost to non-DB tasks; the risk-invariance property stays
structurally true (still no tier parameter anywhere in the panel); and
`*.sql` deliberately over-matches (seeds/queries) — the charter instructs the
specialist to approve non-schema SQL rather than the engine guessing intent.

---

## Decision 52 — The Simplification Pass: Greenfield Doctrine, Single-Source Guards, `agent_type` Envelopes

**Date:** 2026-07-06

**Context:** Decisions 39–51 shipped ~+23K net lines in five days. A whole-repo
audit found the seams healthy but the body fat: duplicated engine plumbing, a
980-line niche feature, legacy-compat branches in a greenfield system, double
guard layers, dead code, ~6K lines of archaeology, and heavy markdown protocol
restatement. One pass removed ~10K lines with zero functionality regressions;
the lights-out-autonomy north star constrained every cut (no simplification may
replace an autonomous path with a human park).

**Decision (eight changes):**

1. **detect-gate-env deleted** — `quality.gateEnv` is manual-only config
   (`factory configure --set quality.gateEnv.KEY=value`); scaffold still renders
   configured values into the managed workflow, it just never guesses them.
2. **Greenfield doctrine: all legacy fallbacks dropped, `schema_version` 2→3.**
   Absent version now rejects too; `staging_branch` required (the
   `resolveStagingBranch` recompute fallback died); `human_touches` defaults
   `[]`; the S9 PRD backfill died (a spec without `prd.json` is refused —
   regenerate with `--supersede`); a worktree without `.factory/gates.json`
   throws instead of warn-and-skip; the cwd-based reporters no longer fall back
   to the global pointer (per-repo miss → no current run); in-flight task status
   now REQUIRES a phase cursor (schema invariant, not a status→phase guess
   table). Stale artifacts fail loud naming the remedy — never silently degrade.
3. **Single-source guards** — the inline shell PreToolUse guards left
   `templates/settings.autonomous.json`; the compiled TS hooks are the one guard
   layer. Accepted coverage deltas (Edit/Write main-guard, Supabase SQL-safety,
   curl-pipe-sh) recorded in the template's `_security_model`.
4. **`factory run resume` alias removed** — `/factory:resume` (Decision 50) is
   the one resume surface.
5. **GateMemo deleted** (dead in production: every run constructed a fresh
   instance, so it never memoized across anything).
6. **Archaeology deleted** — `remediation/`, `docs/reports/`, `docs/rewrite/`,
   tracked `docs/superpowers/` strays, `schemas/codex-review.schema.json`.
   `decisions.md` kept intact (this file is the history).
7. **Markdown single-sourcing** — reviewers point at the injected
   `review-protocol` skill instead of restating it; the TDD skill is wired into
   test-writer (RED half) + implementer (GREEN/REFACTOR half) via frontmatter
   `skills:`; the debug SKILL shrank to deltas over pipeline-runner; the runner
   spawn matrix died — **every spawn envelope now carries `agent_type`**
   (`AGENT_TYPE_BY_ROLE`, `src/core/phase-machine/spawn.ts`) and the runner uses
   it verbatim.
8. **Shared stage helpers, not a framework** — `stage-helpers.ts`
   (`ensureStageWorktree`, `publishToStaging`, `specTaskLines`, `StageSpawnBase`),
   the `e2e.ts` split into 5 modules behind a facade, and mechanical dedup
   (`isEnoent`, `resolveRunIdOrCurrent`, `withHelpGate`/`openState`, hook token
   helpers). Each run-level stage keeps its own coroutine and attempt-cap
   policy — the rejected alternative was a stage policy engine.

**Consequences:** the wire formats are byte-identical except the additive
`agent_type`; old on-disk runs fail loud with the v3 message instead of limping;
the test suite reorganized along the same seams (`lifecycle.test.ts`,
`spec/build.test.ts`, shared `cli/test-fixtures.ts`). Anyone resurrecting a
legacy-compat branch should read change 2 first: the doctrine is that a factory
that runs unattended must never guess about stale state.

---

## Plugin System Constraints

### Agents Cannot Use Hooks Per-Agent

All hooks in `hooks.json` fire for all agents. Hook scripts check context to decide whether to act.

### Agents Cannot Use mcpServers Per-Agent

MCP servers declared in `.mcp.json` are available to all plugin agents.

### Agents Cannot Use permissionMode

Cannot set per-agent permissions (e.g., read-only for reviewers). Reviewer agents are instructed to only use read tools; enforcement is ~70% reliable.

### No Process Manager Primitive

Solved by running the runner in the main session. The command body IS the control loop.

### Concurrent Agent Results

The runner (main session) emits multiple `Agent()` calls in one message. Claude Code invokes them in parallel natively. All results return in the same turn.

---

## Decision 53 — Stack-Adaptive Quality-Gate CI, Rendered From the Gate Contract

**Date:** 2026-07-06

**Context:** The scaffolded `.github/workflows/quality-gate.yml` mirrored one
project's stack byte-for-byte: `pnpm install --frozen-lockfile`, `pnpm next
typegen`, `pnpm typecheck/lint/test/build`, `pnpm deps:validate`, Stryker. On any
npm/vitest repo it failed at the install step, so the CI checks could never be
made **required** — the opinionated end state the factory wants (a red run must
not reach `develop`). Meanwhile the engine already resolves a per-repo **gate
contract** (`.factory/gates.json`, Decision 46) that names exactly which gates
apply and with which commands — the same contract the local GateRunner enforces.
The CI workflow was a second, hardcoded source of truth for the same facts.

**Decision (four changes):**

1. **Render the workflow from the gate contract.** `renderQualityGate`
   (`src/ci/render-quality-gate.ts`) is a pure text render over a marker-annotated
   template (`# factory:setup` / `# factory:gates` / `# factory:mutation-*`).
   Scaffold resolves the contract **before** the CI net renders (a two-pass
   template loop: seeds → contract → managed CI net), then threads it plus
   lockfile-detected package manager, `package.json` scripts, and a `next`-dep
   flag into the render. Each quality-job gate step is **override > GateRunner
   built-in** (`npx`/`pnpm exec` + `tsc --noEmit`, `eslint .`, `vitest run`;
   build renders `npm run build`/`pnpm run build` — the local `DefaultBuildTool`
   runs the script by name) — exactly the two tiers the local GateRunner
   resolves, so CI and the local gate run the same command. There is
   deliberately **no package.json-script tier** (amended 2026-07-07): the local
   gate never consults scripts, so a script tier was the one channel where CI
   could diverge from the merge gate; a repo needing a custom command contracts
   it in `.factory/gates.json` (Decision 46), which both consumers honor. The
   CI `test` step is the same tool/config but un-scoped (the local gate runs
   diff-scoped vitest per task) — inherent and desirable: CI is the full-suite
   backstop. Existing repos pick the new render up on their next `factory
scaffold`. An
   uncontracted gate is omitted with an audit comment. Drift is still measured
   against the **rendered** output, so per-repo rendering stays idempotent.
   Composes with the existing `injectGateEnvIntoWorkflow` (gate-env still a
   downstream marker). **npm-stack only** this pass: a deno/custom contract makes
   the render throw, and scaffold skips the CI net for those repos with a loud log
   (they rely on the local GateRunner) rather than writing a broken workflow.

2. **The engine owns merges — the CI `auto-merge` job is deleted.** The factory
   already merges at both points (task PRs via `MergeSerializer`, the rollup PR
   via finalize's `gh pr checks` poll), so a CI-side `gh pr merge --auto` only
   raced it. Removing the job also drops the stale `github.base_ref == 'staging'`
   literal that never matched per-run `staging-<run-id>` branches.

3. **Vacuous-green `Mutation Testing` when mutation is waived.** A mutation-waived
   repo renders no `mutation-scope`/shard jobs, but keeps an aggregator job named
   exactly **`Mutation Testing`** that reports green with the waive reason. The
   required-check **context stays universal** across factory repos, so one
   develop required-check list works everywhere — no per-repo protection drift
   that could deadlock the rollup.

4. **Split the single `requiredStatusChecks` knob into develop vs staging.**
   `developRequiredStatusChecks` defaults to `["Quality", "Mutation Testing",
"Security Scan"]` (asserted at scaffold, provisioned with `--provision`) — the
   opinionated gate on the rollup into `develop`. `stagingRequiredStatusChecks`
   defaults to `[]` on each per-run `staging-<run-id>` branch: the local
   GateRunner is the primary task-level gate, and a required check there would
   stall every task-PR merge on CI wall-clock. The workflow triggers on
   `['staging-*', develop]` so per-run branches actually report. (The GitHub REST
   API accepts contexts that have never reported — the "run once first" limitation
   is UI-only — so provisioning works on a fresh scaffold.)

5. **CI consumes the repo's committed Node runtime declaration (amended
   2026-07-15).** npm-stack scaffold now requires `.node-version`, `.nvmrc`, or a
   non-empty string at `package.json#engines.node`, with deterministic precedence in
   that order. If both version files exist they must contain the same trimmed,
   single-line value. The renderer passes the selected source to setup-node through
   `node-version-file` in both the Quality and mutation install jobs. There is no
   default, config knob, or operator-host inference: an undeclared repo fails loud,
   and a re-scaffold cannot silently change CI merely because it ran on another
   machine. When package.json is the selected source, fields setup-node would prefer
   over `engines.node` (`volta.node`, `volta.extends`, `devEngines.runtime`) are
   rejected rather than silently changing the runtime.

**Consequence:** Scaffolding a repo whose `develop` protection lacks the three
default contexts now refuses unless `--provision` is passed (the default list is
no longer empty). This is intentional: required-by-default is the point.

---

## Decision 54 — Review-Remediation Sweep: Honest Failure Classes and Non-Masking Recovery

**Date:** 2026-07-07

**Context:** A comprehensive-review pass surfaced a cluster of correctness
defects where a failure was **misclassified** (poisoning a downstream signal) or a
cleanup path **masked** the original fault. None is a new capability — each restores
an invariant an existing decision already assumed.

**Decision (the coherent fixes):**

1. **The circuit-breaker trip sweep fails `blocked-environmental`, not
   `capability-budget`** (`src/orchestrator/next.ts`). When the breaker (Decisions
   34/45) trips, it sweeps every remaining non-terminal task. Those tasks are
   **consequences** of the trip, not independent capability failures — so they now
   carry the breaker-**excluded** class (like the wedge cascade), matching the
   breaker's own derive-don't-store signal (`circuit-breaker-gate.ts` counts only
   genuine `capability-budget` fails). A `capability-budget` sweep counted its own
   output: a partial `rescue apply --task <genuine-failures>` reopen would re-trip on
   the leftover swept rows before any agent ran. The class also makes swept tasks
   rescue-**recoverable** (they never ran).

2. **Block-mode cross-vendor absence is a terminal `blocked-environmental` fail, not
   a burned escalation ladder** (`src/orchestrator/handlers.ts`,
   `src/orchestrator/record.ts`). With `review.requireCrossVendor=block` and codex
   absent, the merge gate can never pass — and the vendor probe is **process-sticky**,
   so no producer re-run can repair a missing binary. Both the verify-reporter and the
   record path now short-circuit to a terminal failure instead of climbing all four
   escalation rungs to `capability-budget`. Recovery: `rescue apply` reset → `factory
resume` in a **fresh process** re-probes codex.

3. **Finalize's forward-reconcile conflict persists a durable marker and stays
   recoverable** (`src/orchestrator/finalize.ts`). Step 6 now uses `tryMergeNoForce`
   (abort-clean — never leave the tree mid-merge); on conflict it writes `run.rollup
{merged:false, reason}` (with `number` **absent**, distinguishing it from an
   armed-but-not-landed rollup PR — `RollupMarker.number` is now optional in
   `schema.ts`) and throws with resolution instructions. The run stays **non-terminal**;
   `rescue scan` flags it (`rollup_pending`) and the summary branches on run status —
   terminal → `--recheck-rollup`, non-terminal → resolve-conflict-then-`resume`. This
   extends Decision 33's forward-reconcile without a silent data-loss window.

4. **Cleanup and detection stop masking real errors.** `gh deleteRemoteBranch`
   (`src/git/gh-client.ts`) tightened its tolerated-stderr regex to `/Reference does
not exist|Not Found|HTTP 404/i` — a **refused 422** (ruleset-protected ref) now
   throws instead of masquerading as already-gone. A shared `removeWorktreeBestEffort`
   (`src/git/worktree.ts`) replaces ten ad-hoc teardowns: it never throws (cleanup
   paths must not mask the original failure) but **warns** on a nonzero exit with the
   path still on disk (never silently leaks). `readCurrentForCwd` (`src/cli/current.ts`)
   narrowed its catch to `UsageError → null`; a broken git env now **rethrows** rather
   than reporting "no current run".

**Also in this sweep (non-behavioral):** a single composition site for the
deterministic-gate context + holdout evidence (`src/orchestrator/gate-context.ts`,
shared by the verify reporter and `applyRecordReviews`); `resyncShipRetry` extracted
from `nextAction`; `--ignore-quota` documented in `factory resume` help; and the
Decision 53 amendment above (no package.json-script tier in the CI render).

---

## Decision 55 — Deletable-by-Default Staging Branches + the `rescue gc` Orphan Sweep

**Date:** 2026-07-07

**Context:** Two orphaned `staging-*` branches on a target repo could not be
deleted by hand — each carried its auto-created exact-name protection rule with
GitHub's default `allow_deletions: false`, forcing a manual
`gh api -X DELETE …/protection` workaround. Investigation found (a) one orphan
was historical only (a pre-pin run superseded across the slash→flat naming flip;
teardown recomputed the wrong name and the 404-tolerance swallowed the miss —
impossible since schema v3 made `staging_branch` required), and (b) a live
structural gap: every teardown path is conditional (merged finalize, supersede,
opt-in `cancel --cleanup`), so a failed run banked for rescue or an abandoned
suspended run leaks a protected branch that nothing ever GCs — rescue scan is
state-pure and terminal runs route to `nothing`.

**Decision (two halves):**

1. **`putProtection` now sends `allow_deletions: true`** (`src/git/gh-client.ts`).
   The plugin never relies on deletion-blocking — its own teardown always deletes
   protection first — so a leftover per-run staging branch stays deletable with a
   plain `git push --delete`. Status checks + `enforce_admins` are unchanged.

2. **`factory rescue gc`** (`src/rescue/gc.ts`) — the self-healing safety net.
   Scan (read-only, default) probes every **terminal** and **suspended** run's
   pinned `staging_branch` via `branchExists` (new read-only `GhClient` probe) +
   `repoProtection`, and reports leftovers with exact hints (Model A: scan
   proposes, apply writes, consent in the command layer). `--apply --run <id>`
   tears down protection-then-branch for explicitly named **terminal** runs only;
   a `failed` run is flagged `banked: true` (its branch is deliberately kept for
   rescue). Suspended runs are NEVER apply targets — deleting their branch
   destroys resumability — they get a `factory run cancel --run <id> --cleanup`
   hint instead (the ergonomic path for the abandoned-suspended-run gap).

**Known ceiling:** gc candidates come from run state only. A rule lingering on a
branch deleted out-of-band is invisible to the REST branch-protection endpoints
(404 on a missing branch); enumerating those needs the GraphQL rules API — add
only if such rules actually accumulate post-`allow_deletions`.

---

## Decision 56 — Specifiability Gate Accepts Nested Per-Requirement Criteria

**Date:** 2026-07-07

**Context:** The specifiability gate (Decision 47) required a dedicated
acceptance-criteria-shaped heading (Acceptance Criteria / Acceptance Tests /
Success Criteria / Definition of Done). PRDs that instead nest testable criteria
as sub-bullets under each numbered requirement — the `/write-a-prd` template
shape — carried perfectly verifiable criteria yet were rejected as unspecifiable
(false-negative repro: jfa94/outsidey#288).

**Decision:** `specifiabilityGate` (`src/spec/gates.ts`) now passes the
acceptance-criteria check when EITHER an AC-shaped heading is present OR the body
exhibits the nested criteria-per-requirement shape — a list item followed by a
deeper-indented bullet, outside excluded (Out-of-Scope / Non-Goals) sections (new
`hasNestedCriteriaShape` helper, a raw-indent scan sharing the same heading-level
skip flag as `extractPrdRequirements`). The blocker message names both remedies.
The ≥200-char and ≥1-extractable-requirement checks are unchanged.

**Consequences:** The two mainstream PRD shapes — a dedicated AC section, and
per-requirement nested criteria — both pass. No PRD that previously passed now
fails (the check is strictly widened). Referred to as defect D10 in the author's
external defect ledger, distinct from this Decision numbering.

---

## Decision 57 — Runs Are Born Whole (Atomic Seeding + Stale-Run Sweep)

**Date:** 2026-07-07

**Context:** `factory run create` (2026-07-07 incident, PRD jfa94/outsidey#288)
crashed between its two state writes: `create()` wrote a valid `running` run
with `tasks: {}`, then the follow-up `update()` seeding tasks never ran because
`pointCurrentAt` had already thrown — the per-repo `current` pointer still named
a schema-v2 run and the clobber guard's read is loud on unparseable state. The
half-created run looked completable: `next-task`'s `every()` was vacuously true
on zero tasks (silent finalize routing), `rescue scan` reported it healthy
(`needs_rescue: false, total: 0`), and the v2 wreckage itself was invisible to
`rescue gc` (which only sees `listRuns()`' parsed output).

**Decision:** Five folds. (a) **Atomic seeding** — `StateManager.create()`
accepts `tasks` + `human_touches` (an omitted touch `at` is stamped with the
birth timestamp, so `at === started_at` holds exactly); `createRunFromManifest`
passes the seeded map in the create payload and the follow-up `update()` is
deleted — one write births a complete run. (b) **Pointer-liveness tolerance** —
in `pointCurrentAt` only, an unparseable pointer target is _stale_ (warn +
repoint), mirroring `listRuns`' tolerate-loudly precedent; every targeted read
keeps its loud contract. (c) **Empty-set guard** — `next-task` on a `running`
run with zero tasks throws a `UsageError` naming it half-created (the third and
last `every`-on-empty site, after `deriveAllGatesVerdict` and `decideFinalize`).
(d) `rescue scan` reports `empty_task_map`, folded into `needs_rescue`. (e)
`rescue gc` sweeps unparseable run dirs: `StateManager.listStaleRunDirs()`
(schema-v≠3 / corrupt-json, best-effort branch+repo extraction) feeds a `stale`
section in the gc report; `--apply --run <id>` routes stale ids to
`gcApplyStale` — protection→branch teardown when extractable, then
`deleteRun()` (dir + any `current` pointer naming it).

**Consequences:** A run either exists whole (tasks + launch touch) or not at
all; an empty run can never pass anything. The incident is a regression test
(`lifecycle.test.ts`), create is provably single-write, and the v2 wreckage
class that caused B1 is now visible and sweepable. Deliberately skipped: a
parse-level "running ⇒ tasks non-empty" schema invariant — it would brick
_reading_ (thus cancelling) existing wreckage.

---

## Decision 58 — Gate-Machinery Hole-Closing Sweep (S1–S4)

**Date:** 2026-07-07

**Context:** Four self-documented holes in the gate machinery, each a place where a
gate could pass on evidence it should not have trusted. They are independent fixes but
share one theme — close a trust gap at the seam that owns it, without widening any
trust boundary.

**Decision:** Four folds.

- **S1 — rung-keyed holdout verdicts.** The holdout verdict store
  (`src/verifier/holdout/verdict-store.ts`) is now keyed by `(runId, taskId, rung)`
  instead of `(runId, taskId)`; verdict files are
  `runs/<run>/holdouts/<task>.r<rung>.verdicts.json`. The crash-resume fast-path in
  `handlers.ts` reads the current-rung file to decide whether it may derive the merge
  gate without re-spawning the validator panel. Task-keying let a **stale prior-rung**
  verdict survive an escalation bump and satisfy that check; rung-keying makes the
  current-rung file absent after a bump, so the fast-path **fails closed** and
  re-spawns the panel. The answer-key store stays task-keyed (withheld criteria are
  stable across escalations). Extends the holdout Δ V confinement. See
  [Rung-keyed holdout verdicts](./verifier.md#rung-keyed-holdout-verdicts-s1).

- **S2 — GateRunner ↔ CI-render partition.** `src/ci/render-quality-gate.ts` now
  exports `CI_RENDERED_GATES` (`type`/`lint`/`test`/`build`/`mutation`) and
  `LOCAL_ONLY_GATES` (`tdd`/`coverage`/`sast`), pinned by a cross-check test asserting
  their union equals `GATE_IDS`. This kills the local-green ≠ CI-green drift class: a
  9th gate id fails the partition test until classified. No new CI steps were added
  (`sast`/`coverage` stay local for now). Extends
  [Decision 53](#decision-53--stack-adaptive-quality-gate-ci-rendered-from-the-gate-contract).
  See [Which gates CI mirrors](../reference/automated-gates.md#which-gates-ci-mirrors-the-render-partition-s2).

- **S3 — gates-in-force enumeration.** New pure helper `enumerateGatesInForce(contract)`
  (`src/verifier/deterministic/gate-contract.ts`) returns `{contracted, skipped,
warnings}`. `run create` warns on stderr per dropped floor gate and carries `gates`
  on the created/superseded envelope; the finalize report re-derives the same
  enumeration from the committed contract (derive-don't-store) into a **Gates in force**
  section, rendered loudly if the contract is absent/invalid at finalize. `DEFAULT_GATES`
  = `test`/`tdd`/`type` (universal floor); `build` is a floor gate for every stack except
  deno (deno waives build by stack, so no false-warn). A dropped floor gate is the one
  misconfig TCB write-protection can't catch — it guards the file's writability, not its
  content. Extends [Decision 46](#decision-46--the-gate-contract-scaffold-time-applicability-committed-and-enforced).
  See [Gates in force](../reference/automated-gates.md#gates-in-force-s3).

- **S4 — `--e2e` testDir preflight.** `assertE2ePrereqs`
  (`src/orchestrator/preflight.ts`) now reads the target repo's own
  `playwright.config.ts` and refuses a `run create --e2e` whose declared `testDir` is
  not the TCB-covered literal `e2e`/`./e2e` (fail-closed on an absent declaration too —
  Playwright defaults to `tests`, outside TCB write-deny). This closes the `tcb.ts` rule-3b
  known gap **at run birth**, without introducing config trust: the TCB rule itself stays
  literal-hardcoded (reading config to widen it would be the circular trust the TCB refuses).
  Extends [Decision 40 D2](#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language).

**Consequences:** Each seam now fails closed on the evidence it previously over-trusted:
a stale holdout verdict, a CI/local gate-set drift, a hand-edited dropped floor gate, and
a Playwright suite outside the write-guard. No trust boundary widened — S1/S4 in particular
keep their literal/confined invariants and close the window earlier instead.

---

## Decision 59 — The Engine Sees GitHub Truth (Read-Only Reconcile)

**Date:** 2026-07-08

**Context:** `rescue scan` (and the whole rescue surface) is **pure over run state** — it
reasons only about `state.json` and never calls GitHub. That left a class of drift the
engine was structurally blind to: a PR merged on GitHub but never recorded `done` (state
lost the ship), a PR closed without merging while its task still counts on it, a recorded
`pr_number` that matches no PR on the head, a staging branch deleted out-of-band under a
still-running run, and — the recurring one — a `staging→develop` rollup that **landed** on
GitHub while the run's marker still reads `merged:false` (the auto-armed branch-policy
fallback, Decision 40 D3). The reconciler agent had to rediscover all of this by hand
every time. The design review (`docs/proposals/design-review-2026-07-07.md` §P1) called for
the engine to gather GitHub truth itself. This is the **read-only slice** — detection and
classification only; the forward-only adoption writes land in
[Decision 60](#decision-60--autonomous-forward-only-adoption-write-side).

**Decision (three parts):**

1. **A GitHub-truth module** (`src/rescue/reconcile.ts`). `gatherRunFacts(run, gh)` probes
   through the single `GhClient` seam (staging `branchTip`, `prList {state:'all'}` per
   branched task, a remote-head `branchTip` only when the recorded PR is found OPEN, and the
   rollup `prList` only when the marker says `merged:false`); `classifyDrift(run, facts)` is
   **pure**, naming seven drift classes (`merged-unrecorded`, `closed-unmerged`,
   `stale-pr-number`, `pr-unrecorded`, `branch-missing`, `staging-missing`, `rollup-landed`),
   each carrying a `detail` with its manual remedy. Fact-gathering is **all-or-nothing**:
   any gh failure propagates — no partial facts. `done` tasks are never classified, and an
   unrecorded MERGED PR on a task head is **not** drift (the e2e-reopen shape, where a
   deterministic branch is reused after `clearShippedPr`).

2. **Two reporters over the same module, with opposite gh-failure semantics.**
   [`factory reconcile [--run <id>]`](../reference/cli.md#reconcile) is the dedicated,
   read-only reporter — GitHub facts ARE its job, so it **fails loud** on any gh error.
   [`rescue scan`](../reference/cli.md#rescue-scan) embeds the same result in a new `github`
   envelope section but **contains** a gh outage (`{ok:false, error}`) — the scan is the
   repair entry point and must keep working offline. Detection only: neither writes state or
   GitHub, and `rescue apply`'s scope is unchanged.

3. **Seam extensions** (`src/git/gh-client.ts`). New `GhClient.branchTip(owner, repo,
branch)` → `sha | null` (404 → `null`, truncation / other errors throw); `branchExists`
   now delegates to it. `PrListArgs.repo?` emits an explicit `--repo owner/name` so probes
   work when the CLI runs outside the target checkout, and `PullRequest.mergeCommit?.oid`
   surfaces the squash-merge SHA (the merged-SHA fact).

**Consequences:** The scan's classification stays state-pure — GitHub truth arrives in its
own `github` section and never changes a task disposition. The reconciler agent now consumes
`github.drifts` as pre-classified evidence instead of rediscovering drift by hand. Repair
remains manual in this slice; the forward-only adoption writes — record a merged PR as `done`,
re-push a missing branch, recheck a landed rollup automatically — land in
[Decision 60](#decision-60--autonomous-forward-only-adoption-write-side), behind the same
`reconcile` module, not in `rescue apply`'s reset logic.

---

## Decision 60 — Autonomous Forward-Only Adoption (Write Side)

**Date:** 2026-07-08

**Context:** [Decision 59](#decision-59--the-engine-sees-github-truth-read-only-reconcile)
gave the engine EYES on GitHub truth but no HANDS: every repair — recording a merged-but-lost
PR as `done`, re-pushing a branch the remote dropped, reopening a run whose rollup landed under
an armed `merged:false` marker — still needed a human or the `rescue-reconciler` agent. Worse,
one of those drifts was actively **dangerous**: a task whose PR is MERGED on GitHub but whose
state still reads `executing`/`reviewing`/`shipping`/`failed` classifies as `resettable`, so a
default `rescue apply`/`auto` would reset it to `pending` and **clobber already-merged work**.
The design review (`docs/proposals/design-review-2026-07-07.md` §P1b/P3) called for the engine
to close the loop itself: forward-only, autonomous, no agent round-trip.

**Decision (five parts):**

1. **An adoption module** (`src/rescue/adopt.ts`): `planAdoption(run, report)` is **pure** over
   a Decision-59 `ReconcileReport` — it names only forward-only, non-destructive repairs
   (`merged-unrecorded` → `done`; `stale-pr-number` → rebind or clear `pr_number`;
   `branch-missing` → re-push a branch that still exists locally; `rollup-landed` **or** every
   task now `done` → reopen the completed run). `adoptRun`/`adoptFromReport` execute the plan
   under the state lock, **re-verifying each write on the locked snapshot** (a raced-away
   condition just leaves the field untouched — forward-only, finalize recomputes either way).
   Re-pushes run OUTSIDE the lock via a plain `git push` — **never** `--force`; a branch gone
   locally is skipped and `surfaced` for a human, not reconstructed.

2. **The hazard is closed at the source.** Adoption runs BEFORE any reset path can fire:
   `rescue apply`/`auto` adopt first, so a merged-unrecorded task is recorded `done` and is no
   longer `resettable` by the time reset logic runs. A merged PR can never again be reset to
   `pending`.

3. **Adoptions are FREE.** They never spend the `self_heal.attempts` budget and never append a
   `human_touch` — recording truth the engine can prove from GitHub is not a recovery attempt
   and not human intervention. Only genuine resets/re-attempts spend the budget.

4. **Three auto-invocation sites**, each with its own gh-outage policy:
    - **`rescue apply` / `rescue auto`** — adopt, then reset the (now smaller) resettable set.
    - **`next-task`** — when the ready result carries a **stale `shipping`** task (a crashed ship
      retains its `verify`-phase `spawn_in_flight`, so it can go stale), probe gh and adopt
      before handing the runner a spurious "work" verdict. Non-shipping stale tasks never trigger
      a probe (no gh cost on the hot path).
    - **`reconcile --adopt`** — apply the forward-only repairs against the SAME report the read
      pass produced (no second probe).
      Every site **degrades** on a gh outage: adoption returns `{ok:false, error}` and the caller
      proceeds (resume still resumes, next-task still reports) — adoption is additive, never a gate.
      `reconcile --adopt` alone stays loud (its whole job is GitHub).

5. **The self-heal bound rises to `< 3`** (`SELF_HEAL_MAX_ATTEMPTS = 3`, flat count). With
   merged-work loss removed, the runner can retry a recoverable failure up to three cycles
   before paging a human, instead of once. Both gates read the one constant:
   `finalize` stays eligible while `attempts < 3`; `rescue apply`'s `auto` refuses at `>= 3`.

**Consequences:** The `rescue-reconciler` agent is **demoted** to LOCAL-git residue only —
a run branch behind its base needing a forward-merge (conflict → blocked), a branch gone BOTH
locally and remotely, orphan worktrees, an unresolvable staging base. PR↔state agreement and
re-pushing a still-local branch are now engine adoption, so the agent is spawned only when a
post-apply scan still reports `reconcile: true`. `reconcile` is now a **reporter + writer**
(read-only without `--adopt`). Adoption telemetry emits one `adoption` metric event per action;
self-heal cycles emit `self_heal`. The write surface stays deliberately forward-only: nothing
here resets, force-pushes, closes a PR, or deletes a branch — those remain consent-gated
(`/factory:resume`) or agent-surfaced.

---

## Decision 61 — Closing the Outer Quality Loop (Review Misses, Reviewer Value, Single Pointer)

**Date:** 2026-07-08

**Context:** The INNER quality loop is closed (risk-invariant panel, verify-then-fix, deterministic
gates). The OUTER loop was not: nothing measured whether a defect the review panel MISSED reached
shipped code, nothing told us which reviewer lenses earned their tokens, and two legacies lingered —
the `warn`-mode cross-vendor policy and the global `runs/current` pointer (the B1 hazard class where
a stale pointer outlives schema versions and silently drives the wrong run).

> **Terminology (chosen 2026-07-08).** The concept is a **review miss** — a defect the panel should
> have caught but didn't, found post-merge. We rejected "escape" (the textbook QA term "defect
> escape") because the codebase already overloads "escape" three ways (path-traversal escape,
> string escaping, escape-hatch). "Miss" also reads cleanly next to the reviewer-lens attribution
> ("which lens missed it").

**Decision (five parts):**

1. **Review-miss ledger — a third sanctioned stored-EVENT exception.** A **miss** = a defect the
   review panel missed, found in shipped factory-produced code post-merge. It is recorded as
   `misses: MissSchema[]` on `RunState` (`{task_id, at, note, lens?}`), beside `self_heal` ([Decision 48](#decision-48--in-session-self-heal-for-transient-failures))
   and `human_touches` ([Decision 49](#decision-49--human-touch-ledger)) — the three deliberate
   breaks from derive-don't-store, because a miss is irrecoverable human-reported history the
   engine cannot re-derive. **Not** `metrics.jsonl` (`emitMetric` swallows IO errors — wrong tier
   for history that must not be lost) and **not** gh labels (net-new write surface for zero
   derivational value). A schema `superRefine` rejects a dangling `misses[].task_id` (must exist
   in `run.tasks`). The `factory miss [--run] --task --note [--lens]` verb stamps the entry;
   `--run` defaults through the per-repo current pointer so "record a miss the day after" works
   from the repo checkout. `score` derives the miss count + `misses_by_lens` from state (no
   mirror), and `--fleet` aggregates `total_misses` / `misses_per_run` / `misses_by_lens`.

2. **`review.round` telemetry.** `applyRecordReviews` emits ONE `review.round` metric per verify
   round (`{task_id, rung, outcome: advance|send-back|environmental, reviewers[], cross_vendor_absent?}`).
   This is telemetry (`emitMetric`), NOT state — a lossy analytics signal, correctly on the swallow-IO
   tier. `factory score --reviewers` aggregates it (over the pure `src/scoring/reviewer-value.ts`)
   into per-lens yield / send-back-rate, joins misses by lens, and reports backfill honesty
   (`runs_covered` / `runs_without_events`) so a metrics-less run is never silently counted as clean.

3. **The global `runs/current` pointer is RETIRED.** Every consumer now resolves the PER-REPO
   current pointer (`current/<repo-key>`, keyed by `spec.repo`): `next-task` via `readCurrentForCwd`,
   statusline via the payload cwd → `resolveRepo` → per-repo link, and the hook guard's
   `loadOwnerScopedRun` via a strict 3-tier order — (a) owner `CLAUDE_CODE_SESSION_ID`, (b) the
   invoking cwd's per-repo pointer, (c) a newest-non-terminal `listRuns` scan (deliberately broader
   than the old global pointer, because the deny arms only need "a run is active" and null-in-a-degraded-env
   would re-open the ship/nested-shell gates). `pointCurrentAt` no longer writes the global link and
   best-effort `rm`s any legacy leftover; `deleteRun` sweeps only the per-repo family; `readCurrent()`,
   `currentLinkPath`, and `BrokenRunStateError` are deleted. A corrupt state.json behind a live
   per-repo pointer still throws LOUD (fail-closed deny); only genuine absence resolves to null.

4. **Cross-vendor `block` recommended, default stays `warn` (deferred flip).** Under `block`, a
   missing Codex fails the task ENVIRONMENTAL (rescue-recoverable) — a stall source without
   autonomous repair. The recommendation (documented in
   [configuration.md](../reference/configuration.md)): flip to `block` only once Codex is reliably
   provisioned AND self-heal is live ([Decision 48](#decision-48--in-session-self-heal-for-transient-failures)).
   The flip is a per-maintainer `factory configure` action, not a repo-committed default.

5. **e2e default-on is DEFERRED (recorded open decision).** Flipping `--e2e` from opt-in to
   default-on (probe a git-tracked `playwright.config.ts`; `e2e = noE2e ? false : explicitE2e || probe.ok`)
   is gated on operational evidence: **≥3 consecutive `--e2e` opt-in runs with the e2e phase
   concluding `done`, zero e2e-caused rescues, and self-heal live.** Those are live-operational facts
   not derivable from the repo and unmet at authoring time, so the default-on code was NOT landed —
   e2e stays opt-in. Revisit once the soak holds.

**Consequences:** The outer loop is now measurable: misses are recorded and joined to reviewer
lenses, so `score --reviewers` answers "which lens earns its tokens" and `score`/`--fleet` answer
"how many misses shipped." The single-pointer story removes a whole hazard class — no global pointer can
outlive a schema version and drive the wrong run; two concurrent runs in two checkouts each resolve
their OWN run. Two flips (cross-vendor `block`, e2e default-on) remain deliberately deferred behind
operational gates rather than shipped blind.

---

## Decision 62 — In-Session 5h Quota Wait

**Date:** 2026-07-08

**Context:** [Decision 42](#decision-42--one-runner-workflow-mode-deleted-runquota-presence-is-the-suspend-discriminant)'s
runner rewrite made the in-session loop "zero pipeline logic, no sleep." A side effect:
the runner began to STOP the session on **any** quota pause — including a 5h pause the
pacer explicitly models as recoverable in place (`pause-5h` → "self-heals in-session as
curve rises"). A launchd **sentinel** spike (waking fresh interactive sessions on an
interval to fire `/factory:resume --auto`) tried to restore unattended progress but was
heavy and fragile (plist + `osascript` Terminal, GUI-login requirement, an `auto_wake`
ledger, a watchdog, a `--auto` machine-resume path, manual-only validation) for little
benefit — it was dropped in favor of simply waiting in-session.

**Decision:** A `scope "5h"` pause **waits in-session** instead of stopping. The runner's
PAUSE CONVERGENCE (`skills/pipeline-runner/SKILL.md`) routes by scope: `"5h"` → TaskStop
in-flight agents, report once, then WAIT (end the turn). The **already-armed heartbeat**
(`CronCreate`, every `stallTtlMinutes`) re-enters Phase 3 REFILL, and `factory next-task`'s
quota gate re-runs and **self-clears `paused`→`running` on a fresh proceed**
(`src/orchestrator/next.ts`). `"7d"` and `"unavailable"` still STOP — a 7d recovery
horizon is days, not hours, and an unobservable reading fails closed. No new engine code,
timer, config, or ledger: the wait is **self-bounded** (a 5h window fully resets by
`resets_at_epoch`, ≤5h, so recovery is guaranteed), and the heartbeat interval (default
15 min) stays under the 3600s usage-cache staleness ceiling, so the statusline-refreshed
cache never goes stale mid-wait.

**Consequences:** Restores the pre-Decision-42 posture — a 5h pause waits and
self-continues; only a 7d suspend (or unavailable halt) exits the session for a human
`/factory:resume`. This is purely a runner-protocol (SKILL.md) change; the engine seams
it rides (next-task's clear-on-recovery, the pacer's rising 5h curve) already existed. The
scheduled-wake sentinel and its apparatus are dropped, so a **dead** session (process
gone) returns to needing a human `/factory:resume` — the pre-sentinel behavior. Three
vestigial wait-config keys (`sleepCapSec`/`maxWaitCycles`/`wallBudgetMin`) are pruned: the
self-bounded wait needs no knobs. Scope is the main PAUSE CONVERGENCE path; run-level
e2e/traceability/docs stage suspends still STOP.

---

## Decision 63 — Per-Agent Dial Pinning + max_turns Single-Sourced to Frontmatter

**Date:** 2026-07-09

**Context:** The pipeline spawns ~16 subagents, each with three cost dials — `model`,
`effort`, `max_turns`. The dials were inconsistent and mostly _inherited_ rather than
explicitly pinned, and `max_turns` in particular was scattered across **five** places:
agent frontmatter, two config fields (`review.maxTurnsDeep` / `review.maxTurnsQuick`),
one config block (`testWriter.maxTurns`), four hardcoded consts (`TRACE_MAX_TURNS`,
`DOCS_MAX_TURNS`, `ASSESSOR_MAX_TURNS`, `E2E_AUTHOR_MAX_TURNS`), and "nothing" for a few
unbounded agents. The scatter created a live **dead-frontmatter trap**: `implementer.md`
declared `maxTurns: 60` but the engine stamped `30`, so the frontmatter value was dead.

**Decision:**

- **Pin all three dials explicitly, per agent, in frontmatter** — trimmed where the
  reasoning load is light, kept strong where quality is critical (`haiku` avoided by prior
  feedback). The agreed allocation:

    | Agent                     | model                         | effort | max_turns |
    | ------------------------- | ----------------------------- | ------ | --------- |
    | spec-generator            | opus                          | xhigh  | 60        |
    | spec-reviewer             | opus                          | xhigh  | 30        |
    | test-writer               | opus (pinned, risk-invariant) | high   | 30        |
    | implementer               | sonnet→opus (tiered dial)     | medium | 50        |
    | quality-reviewer          | opus                          | high   | 40        |
    | systemic-failure-reviewer | opus                          | medium | 40        |
    | implementation-reviewer   | sonnet                        | medium | 40        |
    | database-design-reviewer  | opus                          | medium | 40        |
    | silent-failure-hunter     | sonnet                        | medium | 40        |
    | finding-verifier          | sonnet                        | high   | 30        |
    | traceability-auditor      | sonnet                        | medium | 60        |
    | scribe                    | sonnet                        | medium | 60        |
    | e2e-assessor              | sonnet                        | medium | 60        |
    | e2e-author                | sonnet                        | medium | 90        |
    | rescue-diagnostic         | sonnet                        | medium | 30        |
    | rescue-reconciler         | sonnet                        | medium | 30        |

- **`max_turns` is single-sourced to frontmatter.** `AgentSpecSchema.max_turns`
  (`src/core/phase-machine/spawn.ts`) and `StageSpawnBase.max_turns` are now both
  `optional()`. The engine **never stamps** `max_turns` on a spawn-manifest entry; when it
  is absent the runner (`skills/pipeline-runner/SKILL.md`) omits it at spawn, so the
  agent's own frontmatter `maxTurns:` governs — the same fallback pattern `effort` already
  uses. Every engine build site that used to stamp it (`buildPanelManifest`, `producerSpawn`,
  and the single-agent requests in `traceability.ts` / `docs.ts` / `assessment.ts` /
  `e2e-author.ts` / `e2e-suite.ts`) drops the field. This deletes the dead-frontmatter trap
  by construction — the frontmatter value is now the only value.

- **Config + consts deleted.** `review.maxTurnsDeep`, `review.maxTurnsQuick`, the whole
  `testWriter` block (`TestWriterSchema`), `JudgmentConfig.maxTurnsDeep`, and the four
  `*_MAX_TURNS` consts are removed. Turn budgets are **no longer overridable via
  `/factory:configure`** — they are plugin-author-owned in frontmatter (the accepted
  trade-off). Stale on-disk overlays keep loading (ConfigSchema strips unknown keys).

- **One deliberate carve-out.** The holdout-validator sidecar (`HoldoutSpawn`,
  `src/orchestrator/orchestrator.ts`) spawns as generic `general-purpose` with no bespoke
  agent file to fall back to, so its cap stays a local const `HOLDOUT_MAX_TURNS = 40` — the
  single documented exception to the single-source rule.

- **Standalone model trims (opus → sonnet).** `traceability-auditor`, `scribe` (the docs
  stage), `e2e-assessor`, and `e2e-author` moved from opus to sonnet in the same cost-tuning
  pass. The e2e pair was apex-pinned opus by
  [Decision 40](#decision-40--e2e-overhaul-zero-knowledge-ux-via-assessment-adjudication-and-plain-language)
  (D3/D4/D5); that pin is relaxed to sonnet here — these lenses are auxiliary, not the merge
  gate, so they are cost-flex points.

- **Scope of single-sourcing.** Only `max_turns` becomes single-source. `effort` stays
  **two-layer by design** — frontmatter default + engine override for the spec apex pin
  (Decision 21) and the producer escalation ladder (Decision 25). `model` stays
  engine-authoritative where tier/role logic requires it: the producer keeps its tiered
  `sonnet→opus` dial, `test-writer` is pinned opus regardless of task risk (config-driven
  ceiling in `producerSpawn`), and the panel model is per-role (Decision 64).

- **finding-verifier promoted to a first-class agent.** Previously the independent
  finding-verifier (verify-then-fix, Decision 27) ran as generic `general-purpose` with no
  frontmatter, tracking the reviewer panel's model. It is now a real agent file
  `agents/finding-verifier.md` (`model: sonnet`, `effort: high`, `maxTurns: 30`,
  `isolation: worktree`), decoupled from the panel's model. Its spawn points at the new
  `FINDING_VERIFIER_AGENT_TYPE` const (`src/core/phase-machine/spawn.ts`). Per-finding
  prompts still come from `VERIFIER_PROMPT_TEMPLATE` at spawn; the agent-file body is the
  standing system prompt and now carries the full verification discipline (adversarial
  mandate, grounding gate, refute-when-unsure calibration — authored in a follow-up
  session, see below).

**Consequences:** Each agent's turn cap lives in exactly one place — its own frontmatter —
and the "declared 60 / stamped 30" class of bug cannot recur. The config surface shrinks to
only keys the engine actually reads. Reviewer/producer turn budgets are no longer
operator-tunable; accepted as the price of a single source of truth.

**Gap closed:** `agents/finding-verifier.md` shipped as a stub (a `TODO(user)` in place of
the full verification discipline) until a follow-up session authored the body — process,
red flags, and output-contract restatement, consistent with the runner-supplied
`VERIFIER_PROMPT_TEMPLATE` which still carries the operative per-finding prompt.

**Relationship:** Amends Decision 21 (apex effort `max`→`xhigh`); carries the per-role
reviewer-model change (Decision 64); extends Decision 27 (the finding-verifier it promotes);
relaxes Decision 40's e2e apex pin.

---

## Decision 64 — Per-Role Reviewer Model Reverses the Single-Fixed-Reviewer Model

**Date:** 2026-07-09

**Context:** The risk-invariant review panel (Decision 26) stamped **one** fixed model on
**every** reviewer — the single-fixed-reviewer-model implementation (internally **Δ T**),
which realised the "reviewer model is fixed, not quota-routed" principle of Decisions
18/21/26 by holding the model literally constant across the whole panel. The independent
finding-verifier (Decision 27) and the holdout-validator both tracked that same panel model.
Uniform Opus across the panel was the single largest happy-path quota spend, yet the
narrower-scoped lenses (spec-alignment, silent-failure) do not need apex reasoning.

**Decision:**

- **Per-role reviewer model.** `src/verifier/judgment/panel.ts` replaces the single stamped
  model with a `REVIEWER_MODEL_BY_ROLE` map: **opus** for the deepest-reasoning lenses
  (`quality-reviewer`, `systemic-failure-reviewer`, `database-design-reviewer`), **sonnet**
  for the narrower ones (`implementation-reviewer`, `silent-failure-hunter`). The map is
  keyed **only on role, never on risk tier**, so the merge gate stays **risk-invariant**
  (Decision 26) — this is additive precision, not a break of that invariant. Producer roles
  are never looked up here.

- **The single-model implementation (Δ T) is SUPERSEDED.** "Fixed, not quota-routed"
  (Decision 18) still holds — reviewer model is a fixed function of role, independent of a
  task's risk — but the _one-model-for-every-reviewer_ realisation is gone.

- **finding-verifier and holdout decoupled.** The finding-verifier now runs on its own fixed
  `sonnet` (`FINDING_VERIFIER_MODEL`, plus its own agent file — Decision 63), no longer the
  reviewer model. `review.model` config is retired for the panel and now overrides **only**
  the `general-purpose` holdout-validator sidecar (`resolveReviewModel`,
  `src/orchestrator/orchestrator.ts`).

**Consequences:** The panel spends apex tokens only on the lenses that need them; the
narrower lenses run cheaper on sonnet, with no loss of risk-invariance — a mis-tagged task
still meets the identical panel. Reviewer model is now a per-role constant in code, not a
run-level config knob.

**Relationship:** Refines Decision 18 (fixed, not quota-routed) and Decision 21 (canonical
verifier tier); preserves Decision 26 (risk-invariant merge gate); landed alongside
Decision 63's dial-pinning pass.

---

## Decision 65 — Deny-List Shrink to Honest Accident-Prevention

> **The relaunch half of this decision was superseded by [Decision 67](#decision-67--task-worktrees--results-relocate-into-the-target-repos-claudeworktrees)
> on 2026-07-15.** As originally written this decision had two halves: a permission-mode
> override on the autonomous relaunch command, and the deny-list shrink below. Decision 67
> removed the need for the override by moving the writes out from under the protected path
> entirely, so the relaunch command carries no override and `factory autonomy ensure` emits a
> plain `claude --worktree --settings <path>`. **The deny-list shrink below is unchanged and
> still in force.** The original relaunch rationale is preserved in this repo's git history
> (commit `aeb780a`); it is paraphrased rather than quoted here because the flag it named is
> explicitly not this project's goal and a live-looking snippet invites cargo-culting.

**Problem:** A live run (`run-20260709-095909`, task `legal-001`) stalled on permission
_prompts_ — "edit and create sensitive files" and "allow Claude to edit its own settings" —
for ordinary writes under the plugin's own data dir
(`~/.claude/plugins/data/<plugin>/worktrees/<run>/<task>/...`). Autonomous mode has no
operator to answer a prompt, so every prompt is an unattended stall — the #1 pain point
(Decision 62/Session-6). The user's principle: in autonomous mode every decision must be
**binary** (allow or deny); nothing should ever prompt.

**Root cause:** Claude Code's built-in protected-path check protects the whole `.claude/`
tree except `.claude/worktrees`. This plugin's data dir lives under `~/.claude/plugins/data/`,
and its worktrees sat under `.../data/<plugin>/worktrees/...` — a sibling path, not the
exempted one — so every Edit/Write there hit the built-in prompt regardless of
`permissions.allow`/`additionalDirectories` (that check runs _before_ allow-rules are
consulted). This root cause is correct and is what Decision 67 ultimately fixed at the source.

**Original choice (superseded):** append a permission-mode override to the autonomous
relaunch command, suppressing the protected-path prompt after the fact. It worked, and in an
unattended run it was defensible — a prompt nobody can answer is not a gate, so converting it
to a binary outcome was strictly better than stalling. But it treated the symptom: the writes
were still landing on a path the platform protects. Decision 67 moves them onto the exempted
path instead, which is why the override is gone rather than merely discouraged.

**Course correction — this decision also walks back a first attempt in the same session.**
An earlier pass solved the reported prompts with that same override, but then _added_ ~16 new
`permissions.deny` entries and a ~180-line scoped-recursive-`rm` hook
(`dangerousRmTargets`/`protectedRmRoots` in `src/hooks/write-protection.ts`) on top of an
already-121-entry deny-list. User feedback: this added layers when the goal was to simplify.
On review, the added hook solved nothing the reported prompts needed — `rm` was exactly as
protected with the override as without it, since a permission-mode override never touches Bash
deny rules. That hook and its 16 deny additions are **reverted** by this decision.

**The deny-list is reframed and cut from 121 entries to ~57** (`templates/settings.autonomous.json`),
on a single thesis:

> A string-glob deny-list cannot be a security boundary. It is simultaneously **incomplete**
> (misses `rm -rf ../..`, absolute-path forms, nested shells, every AWS destructive verb) and
> **over-broad** (blocks legitimate migration/test-DB/`.env.example` work). Against a
> **non-adversarial** coding agent it doesn't need to be complete — it only needs to prevent
> _accidents_ to a few irreversible, non-file-path-shaped operations. Real containment against
> a _malicious_ agent is the OS sandbox (deferred below), which string-globs were never going
> to provide.

**What the deny-list keeps** (all from the KEEP set — nothing here overlaps what the
path-resolving hook layer already enforces):

- **A few catastrophic `rm` globs** (`rm -rf /`, `rm -rf ~`, `rm -rf ~/*`, `rm -rf $HOME*`,
  `rm -rf /*`) — makes the built-in circuit-breaker's cases binary instead of a stalling
  prompt.
- **Interpreter-eval** (`node -e`, `python -c`, `python3 -c`, `perl -e`, `ruby -e`,
  `deno eval`, `bun -e`, `eval *`) — kept unchanged, on purpose. Over-broad (blocks legitimate
  one-off interpreter use) but load-bearing under a string-matching boundary: the only thing
  stopping an agent from laundering an otherwise-denied command through an interpreter, past
  the parsed-command guards. The only _safe_ way to relax this is an OS sandbox that confines
  interpreter child processes at the kernel level — deferred, not attempted here.
- **Irreversible remote/publish ops** (`npm publish`, `pnpm publish`, `gh repo delete`,
  `gh release delete`, `gh api -X DELETE`) — not file-path-shaped, so no hook can see them;
  the deny-list is the only place these can be stopped.
- **`Write`/`Edit(**/.git/**)`** and **home credentials/config**
  (`~/.ssh/**`, `~/.aws/**`, `~/.gnupg/**`, `~/.netrc`, `~/.config/gh/**`, `~/.gitconfig`,
  `~/.npmrc`, `~/.claude.json`, `~/.bashrc`, `~/.zshrc`, `~/.profile`, and the `~/.claude/*`
  settings/credentials/hooks/CLAUDE.md set) — these sit outside any task worktree, so the
  hook layer (which is scoped to TCB paths and the worktree) can't reach them; the deny-list
  is the only guard.

**What was deleted (~90 entries) and why it's safe:**

- **All AWS destructive-verb entries (9)** and **all SQL `DROP`/`TRUNCATE` entries (5)** —
  globs can't distinguish a prod resource from a test one, so they only ever gave false
  confidence while blocking legitimate infra/test-DB work.
- **Redundant git history-rewrite globs (10)** — `branch-protection`
  (`src/hooks/branch-protection.ts`) already path-resolves and denies force-push/reset/
  branch-delete on the protected-branch set; a feature-branch force-push is legitimate and
  the glob duplicate only blocked it.
- **`.claude` Bash read-guards (3)** — the `.claude`-carve-out PreToolUse hook and
  holdout-guard already govern sensitive `.claude` access with path resolution; the blanket
  `ls`/`find`/`cat .claude*` denies blocked harmless introspection.
- **Repo-relative sensitive-file writes (~10: `.env`, `**/secrets/**`, `**/migrations/**`,
`**/_.tfstate_`, repo-relative `**/.npmrc`/`**/.gitconfig`/`**/.mcp.json`/`**/.claude.json`)**
— these live inside the ephemeral task worktree, are often the task itself (a migration, an
`.env.example`), never reach `main`if junk, and`secret-guard` already blocks committing an
  actual secret.
- **Theater/misc (~6): `chmod 777`/`chmod -R 777`, `sudo *`, `npx *create-*`, `*base64 -d*`,
  `*--no-verify*`/`*--no-gpg-sign*`** — `sudo` fails with no TTY regardless; `--no-verify`
  bypasses _git_ hooks, not the factory's Claude Code hooks, so denying it is moot; the rest
  never blocked a real threat.

**Rejected design — a positive "write only inside your own worktree" sandbox.** Considered
and rejected (not merely deferred): no ambient signal identifies the current agent's
worktree — `FACTORY_TASK_ID`/`FACTORY_RUN_ID` are read by hooks but never set in production,
and a subagent's cwd isn't reliably the task worktree (confirmed against
`src/hooks/hook-context.ts`). Even with a reliable signal, legitimate tooling writes outside
any worktree (`~/.npm`, `~/.cache`, `/tmp`), so a worktree-only allowlist would deny real work
and stall the run — precisely the failure mode this whole decision exists to eliminate. Doing
this safely is exactly what an OS sandbox (`sandbox.*` allowlists) is for; see below.

**Deferred to separate sessions (not attempted here):**

- **A global dotfiles hook** (`~/.dotfiles/.claude/hooks/dangerous-patterns-check.sh`,
  symlinked into `~/.claude/hooks/`) independently emits a permission `ask` on a
  false-positive string match (the word "credentials" inside a heredoc body) — a third
  prompt source in the original report. Out of scope here: it lives in the user's global
  config, and this change is scoped to be self-contained to this repo. Still open after
  Decision 67: that decision relocated the factory's own writes off the protected path, which
  is not where this hook's false positive comes from — it string-matches heredoc _bodies_
  regardless of target path.
- **OS sandbox adoption** (`sandbox.*`, macOS Seatbelt): the genuinely stronger,
  injection-resistant boundary, the only way to safely relax the interpreter-eval denies, and
  the only way to implement the worktree-only sandbox rejected above. Not pursued now — it
  doesn't fix the protected-path prompt (Read/Edit/Write bypass the sandbox), its network
  confinement pre-allows no domains (so `git push`/`gh`/`npm` would newly stall on first use),
  and `gh`/`gcloud`/`terraform` fail TLS under Seatbelt without `excludedCommands` entries.
  Scoped as its own future initiative.

**Relationship:** Extends Decision 17 (coarse-Bash, hook-enforced boundary) — the
pipeline-integrity hooks (branch-protection, secret-guard, pipeline-guards, holdout-guard,
write-protection's TCB-path arm) remain the actual, complete boundary for what they guard;
this decision narrows `permissions.deny` to the residual accident-prevention role those hooks
structurally can't cover. Continues the Close-the-Loop stall-elimination line
(Decision 61/62).

---

## Decision 66 — Hung-Spawn Hard Wall Clock + Bounded Re-Drive Budget

**Date:** 2026-07-10

**Context:** The stall TTL (S1) is advisory: `next-task` flags an aged in-flight spawn in
`work.stale`, and the runner liveness-checks it — if ANY tracked agent still runs, it is
left alone, forever (the false-positive guard; deliberately, because the only re-drive
mechanism resets the task worktree and would destroy a live agent's work). A **hung-but-alive
agent is therefore never reaped**, and the failure compounds structurally: the hung task keeps
the run permanently non-terminal, so it never reaches finalize — which is the only gate that
fires `rescue auto` (Decision 48/60) — locking out every escalation mechanism the system has.
Re-drives also incremented no counter, so even the dead-spawn kill→respawn loop was unbounded.
Stalls are the #1 operational pain (design-review-2026-07-07).

**Decision:** Two disjoint age bands on the `work` envelope, both engine-computed:

- `stale` — the ADVISORY band, `stallTtlMinutes < age ≤ hungSpawnMinutes` (defaults 15/120;
  the TTL default also dropped 20 → 15 to tighten heartbeat-driven recovery). Runner behavior
  unchanged: liveness-check first, touch only all-dead spawns.
- `hung` — the HARD band, `age > hungSpawnMinutes`. The runner TaskStops the spawn's agents
  **even if alive** (past the hard cap, aliveness IS the failure) and re-drives.

The kill→respawn→hang loop is bounded engine-side: `spawn_in_flight.redrives` (default 0,
so pre-existing checkpoints parse with a full budget) is incremented on every matching
`(phase, rung)` re-entry; a re-entry that would exceed `SPAWN_REDRIVE_CAP` (2,
`orchestrator.ts`) instead fails the task `blocked-environmental` — the same over-cap shape
as the merge re-sync budget — which is rescue-`recoverable`, so finalize → `rescue auto`
(≤3 cycles) → page owns the escalation from there. Worst case is finite by construction.
The stale-shipping adoption probe (Decision 60) gates on the UNION of both bands — a
crashed-before-recording spawn is typically ancient, so it surfaces as `hung`.

**Consequences:** `redrives` counts ALL matching re-entries, including pause-resume and
legitimate dead-spawn re-drives (the engine cannot know why the runner re-entered without
anti-Model-A flags; a re-drive looping at the same `(phase, rung)` is "no progress" evidence
regardless of cause). The counter resets on every phase/rung advance (a fresh checkpoint is
written with 0) and on rescue reset. Quota-pause recovery deliberately does NOT refresh
`spawned_at`: PAUSE CONVERGENCE TaskStops all in-flight agents before waiting, so a
post-pause `hung` flag correctly re-drives already-dead spawns, and refreshing would mask a
genuinely pre-pause-hung spawn for another full window. `hungSpawnMinutes` must exceed
`stallTtlMinutes` (schema `superRefine`). A legacy untimed checkpoint (`spawned_at` 0) now
lands in `hung` rather than `stale` — still "never silently trust an untimed spawn," but the
recovery is now kill+re-drive instead of liveness-check.

**Relationship:** Closes the last structural stall in the Close-the-Loop line
(Decision 61/62): S1/3c handled silent DEATH; this handles silent HANGING. Mirrors the
`MERGE_RESYNC_CAP` bounded-budget shape and hands over to Decision 48/60's bounded self-heal.

**Addendum (2026-07-16, goodbyespy live-run finding #6):** The runner skill's `stale`
branch previously treated ABSENCE of information as death — "TaskList shows nothing for
the tracked agents" fell into the re-drive leg, and since TaskList does not reliably
track background `Agent()` spawns, that read routinely killed LIVE work (the re-drive
resets the task worktree to its checkpoint tip). The skill now requires **positive
evidence of death for every tracked agent** before a stale re-drive: a completion/error
task-notification received, an unfed results file on disk, or an explicit terminal
TaskList entry. No information → do not touch the task; the `hung` hard band above is
the backstop for a truly wedged spawn. The same rule applies to the
stale-not-in-table compaction fallthrough. Accepted cost: a genuinely dead spawn with no
evidence now waits out `hungSpawnMinutes` before recovery — the price of never killing
live work on a guess. Skill-only change (`skills/pipeline-runner/SKILL.md`); no engine
change.

---

## Decision 67 — Task Worktrees + Results Relocate into the Target Repo's `.claude/worktrees/`

**Date:** 2026-07-15

**Problem:** An **interactive** run prompted on every agent Write/Edit under
`~/.claude/plugins/data/factory-<id>/results/<run>/<task>-exec-r1.json` — "…which is a
sensitive file." Same root cause Decision 65 diagnosed in autonomous mode: Claude Code's
built-in protected-path check covers the whole `~/.claude/` tree **except**
`.claude/worktrees/`, and it runs _before_ `permissions.allow`/`additionalDirectories` are
consulted, so no allow-rule can reach it. Decision 65 suppressed the prompt with a
permission-mode override on the relaunch command. The user rejected that as the fix here:
"I don't want to launch sessions with bypass permissions. That's the entire point of the
permissive settings file." So the prompt has to never fire, not be suppressed after the fact.

**Root cause of the root cause:** the escape hatch was already in the codebase and already
load-bearing. The orchestrator's own staging worktree has lived at
`<repo>/.claude/worktrees/orchestrator-<run_id>` since Decision 2 and has never tripped the
prompt. Task worktrees and results just weren't in that tree — they sat under
`$CLAUDE_PLUGIN_DATA/{worktrees,results}/`, a sibling path with no exemption.

**Choice:** move them into the tree the orchestrator worktree already uses.

|                   | before                                                | after                                                |
| ----------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| task worktree     | `<dataDir>/worktrees/<run>/<task>/`                   | `<repoRoot>/.claude/worktrees/<run>/<task>/`         |
| scratch worktrees | `<dataDir>/worktrees/<run>/.docs`, `.trace`, `.e2e-*` | `<repoRoot>/.claude/worktrees/<run>/.docs`, …        |
| results           | `<dataDir>/results/<run>/*.json`                      | `<repoRoot>/.claude/worktrees/<run>/.results/*.json` |

Run/spec **state** (`runs/`, `specs/`) stays in `$CLAUDE_PLUGIN_DATA` — it is TCB-write-denied
and only the engine writes it, via Node `fs`, which the permission system never sees. The
split is exactly "agent-writable → target repo, engine-only → data dir."

No new env var and no marketplace-id math: the target repo _is_ the namespace (the same
guarantee `orchestrator-<run_id>/` already relies on), and `.claude/worktrees/` is already an
unconditional `GITIGNORE_ENTRIES` entry in every scaffolded repo.

**`mainWorktreeRoot()`, not `showToplevel()` — a real bug avoided by construction.** The new
root is resolved via `git rev-parse --path-format=absolute --git-common-dir` +
`dirname` (`src/git/git-client.ts`), plumbed once through `loadCliDeps` as
`deps.workDir` (`src/cli/wiring.ts`). `showToplevel()` would have been the cheap-looking
choice and is wrong: from Phase 3 onward the runner's cwd is `$ORCH` — itself a linked
worktree — so `showToplevel()` returns `$ORCH`, nesting every task worktree _inside_ the
orchestrator worktree. `git worktree remove --force "$ORCH"` at teardown would then delete
still-registered child directories and leave git's admin entries dangling.
`--git-common-dir` resolves the true main root from any linked worktree.

**The hook re-roots, it does not de-root.** `runTaskForPath` (`src/hooks/hook-context.ts`)
keeps its required root parameter; only the root's _value_ changed (git-derived `workDir`, not
`dataDir`). Dropping the parameter for a bare `.claude/worktrees/` segment scan would have
been a live regression, not a simplification: `decideWriteScope` fires on **every**
Edit/Write/MultiEdit system-wide, and `.claude/worktrees/` is also where Claude Code's own
native `--worktree` feature puts unrelated worktrees in _any_ repo. An unanchored scan would
read a user's unrelated native worktree as a factory task write, `loadRunById` would throw, and
the guard would deny a completely unrelated edit. `src/hooks/pipeline-guards.test.ts` pins
this: a `.claude/worktrees/<validId>/<validId>/…` path under a _different_ repo root than
`deps.cwd`'s must pass through, not deny.

`decideWriteScope` also gained a cheap path-aware pre-filter (a `.claude` segment immediately
followed by a `worktrees` segment, compared via `sep` so it is correct on Windows) that returns
before any git call or `resolveDataDir`. The common case is now **cheaper** than before: the
old code called `resolveDataDir` unconditionally.

**Consequence — the permission-mode override is deleted, not merely discouraged.** With the
relocation, zero agent-side writes land under `~/.claude/` outside the exemption, so the
override in Decision 65's relaunch command had nothing left to suppress. `factory autonomy
ensure` now emits a plain `claude --worktree --settings <path>`. The
`Read|Write|Edit(<dataDir>/**)` allow rules **stay**: `Read` is load-bearing (agents read the
stored spec), and the `Write`/`Edit` pair costs nothing, while removing it could only convert a
future in-tree write into an unattended stall. This was verified by static analysis rather than
the live smoke test originally planned — the claim is a universal ("no agent-side write under
the data dir"), which a passing run samples but cannot establish. The autonomy tests assert the
relaunch command by **exact equality**, so re-appending any flag fails them.

**Breaking: between-runs upgrade only.** Worktree paths are deterministic and recomputed each
call, never persisted (`src/orchestrator/paths.ts`), so nothing on disk records which scheme a
run uses. Upgrading the binary mid-run means the next `next-task`/`next-action` recomputes the
new location and won't find the existing worktree — a loud git error (`ensureOnStaging` against
a missing path), not silent corruption. No `run.engine_version` guard was built; add one only
if mid-run upgrades turn out to be a real operational pattern. Old on-disk
`~/.claude/plugins/data/factory-*/{worktrees,results}` are left in place — same
"leaving it is harmless" philosophy as the orchestrator worktree's own teardown.

**Note for a full manual reset:** ephemeral worktree/results data now lives in the target repo,
so a full reset needs both `rm -rf ~/.claude/plugins/data/factory-*` (state) **and**
`git worktree prune` + `rm -rf <repo>/.claude/worktrees` per target repo.

**Relationship:** Fixes at the source what [Decision 65](#decision-65--deny-list-shrink-to-honest-accident-prevention)
worked around, and supersedes that decision's relaunch half (its deny-list shrink stands).
Extends Decision 2's `.claude/worktrees/` convention from the orchestrator worktree to every
worktree. The PreToolUse `.claude/` guard in `templates/settings.autonomous.json` already
carved out `(^|/)\.claude/worktrees/` unconditionally — written to mirror this exemption, it
had simply never been fed a matching path.

**Amendment (2026-07-17, v1.43.1 — D11): ENOENT is pass-through, not fail-closed.** The
relocation put factory worktrees under the SAME root Claude Code's native worktree feature
uses in the same repo. This decision's prose anticipated the cross-repo collision (the root
anchor defends it) but missed the same-repo one: a native session worktree write
(`<repo>/.claude/worktrees/<session>/src/x.ts`) anchors to the correct repo root, parses as
`<session>/src`, and `loadRunById` throws ENOENT — which the write-scope arm mapped to a
fail-closed deny, bricking every Edit/Write in every non-factory session worktree of a
plugin-bearing repo (defect D11, found live 2026-07-16). It also latently denied writes in
factory's own single-segment `orchestrator-<run>` worktree. Fix (`decideWriteScope`,
`src/hooks/pipeline-guards.ts`): a run id with NO state on disk (`err.code === 'ENOENT'`) is a
positive "this run was never created → not a factory worktree" signal → pass through; a run
whose state EXISTS but cannot be read/parsed is corruption → still fail closed. Re-rooting
factory worktrees to a `factory/` subdir was considered and rejected: bigger diff, breaks
paused runs' on-disk layout, and doesn't fix the orchestrator-worktree case.

---

## Decision 68 — Anti-Ratcheting: Disposition Ledger + Fixer Scope Limits + Parsimony Fold-In

**Date:** 2026-07-15

**Context:** Multi-pass review loops ratchet: each pass adds guards/tests/comments, none
removes anything, and adjudications don't persist. Observed in a 6-pass external loop
(and structurally possible here): a finding refuted in round N is blindly re-raised in
round N+1 by a fresh-context reviewer (fresh contexts are the anti-anchoring design — the
cost is amnesia), burning a verify cycle and sometimes getting "fixed" anyway. Literature
(ESLint suppression ratchets, Google eng-practices "improves code health, not perfect",
Huang et al. ICLR 2024 on non-converging self-correction) supports persisted dispositions
plus scope pressure on the fixer.

**Decision:** Three lean, composable changes:

1. **Disposition ledger on TaskState.** `review_dispositions?: ReviewDisposition[]`
   (`{reviewer, disposition: refuted|non-blocking, file?, line?, quote, claim, note?, round}`)
   next to `fix_findings`. Written in `record.ts`'s wait-retry branch:
   `appendDispositions(prior, composeDispositions(reviews, adjudicated, round))` —
   refuted blockers (verifier reason as note) + non-blocking findings; citation-dropped
   findings deliberately excluded (never adjudicated on merit — suppressing them would hide
   a mis-cited real defect). Fingerprint dedupe (`file|quote|claim`, latest round wins),
   cap 30 — dedupe/cap are containment only, never gating. Cleared on advance and on rescue
   `doneTaskRow`; survives escalation (the `{...t}` spread) and rescue reset, same lifecycle
   as `fix_findings`.
2. **Injection as a challengeable input document.** `renderDispositionLedger` produces a
   markdown docket ("input document — NOT shared belief-state"); the spawn envelope stamps
   it as `prior_dispositions` ONLY for `expects: 'reviews'`. The runner appends it VERBATIM
   to every panel reviewer's prompt and NEVER to a finding-verifier (anti-anchoring
   boundary: verifiers stay blind to prior belief-state). The cross-vendor prompt gets it
   engine-side. Re-raise convention is prose-only — a `CHALLENGES PRIOR DISPOSITION:`
   description prefix with NEW evidence — no Finding/RawReview schema change.
   `factory debug` mirrors the thread: `DebugSession.dispositions`, recorded on `--record`,
   stamped on the next `--emit` envelope.
3. **Scope pressure on both sides of the loop.** Implementer charter: fix-forward passes
   change ONLY code a fixInstruction/gate implicates; no "while I'm here" armor; DELETION
   IS A VALID FIX. Quality-reviewer charter: parsimony dimension (speculative abstraction,
   redundant guards, comment bloat, additions a deletion would replace), ALWAYS
   `blocking: false`.

**Deliberate non-changes:** No cross-pass auto-refute (code changes between rungs; the
verifier stays arbiter). No convergence-policy change (blocking-only gate + escalation cap
already bound the loop). No ledger in producer prompts (would invite defensive armor). No
new panel role (frozen `SpawnRoleEnum`). No file-based ledger (the TaskState field has
exactly the right lifecycle).

**Consequences:** A reviewer who re-files an adjudicated claim without new evidence wastes
its own finding (the docket told it not to); a challenge still goes through the normal
finding-verifier, which never saw the docket — so a wrong prior disposition is correctable
on merit. Ledger is transient per task: nothing persists past ship, so no cross-run bloat.

**Relationship:** Extends the Decision 5 frozen-state seam (new optional field, back-compat
parse); preserves D26 (citation-verify untouched), D27 (verify-then-fix — verifiers stay
blind), D44 (panel construction unchanged), D43 (parsimony folds into the merged
quality charter rather than a new seat).

---

## Decision 69 — NEEDS_CONTEXT Fails Fast and Surfaces the Question

**Date:** 2026-07-16

**Context:** goodbyespy live-run defect P0a. A producer returning `STATUS: NEEDS_CONTEXT`
was classified as a retryable failure signal: `classifyProducerFailure` → `escalateOrFail`
burned a rung, DROPPED the question, and re-spawned a byte-identical prompt (only the
model dial changed). A question the repo genuinely cannot answer therefore consumed the
whole escalation ladder — four identical asks — and terminated as a misleading
`capability-budget` deadlock, with the actual question nowhere in state. User decision:
fail fast + surface.

**Decision:** NEEDS_CONTEXT is a QUESTION, not a capability failure. `applyProducerOutcome`:

- **First ask** — persist `task.needs_context = {question}` (new additive-optional
  `TaskState` field) and return same-phase/same-rung: the producer is re-spawned ONCE with
  the question injected as a prior-failure note ("resolve from repo/spec evidence; only
  return NEEDS_CONTEXT again if genuinely unanswerable"). No rung burn. The re-spawn rides
  the matching `spawn_in_flight` checkpoint branch, so it spends one `redrives` slot —
  accepted (max one re-ask per question; the cap is 2).
- **Second consecutive ask** — the question is overwritten and the task fails LOUD with
  new failure class `needs-context`, reason naming the question. `'needs-context'` is
  removed from `classifyProducerFailure`'s `FailureSignal` union — the compiler now forces
  a loud throw if it ever re-enters the rung-burn path.
- **Answer channel** — rescue: `failed`+`needs-context` scans `recoverable` with the
  question on the scan line; `rescue apply --task <id> --answer "<text>"` resets the task
  preserving `needs_context` and writing the answer; the next spawn injects "a human
  answered: <answer> — proceed". `rescue auto` excludes `needs-context` (self-heal has no
  answer). A `done` producer outcome clears the field.

**Consequences:** An unanswerable question stops the task after two asks total instead of
deadlocking the ladder; the question survives into state, the rescue proposal, and the
human's screen. The circuit breaker needed no change (its equality filter on
`capability-budget` already excludes the new class).

**Relationship:** Additive-optional on the Decision 5 frozen state (schema stays v3).
Uses the Decision 66 redrive budget for the one re-ask; hands recovery to the
Decision 22/60 rescue machinery via the new `--answer` channel.

---

## Decision 70 — ALREADY_SATISFIED Verdict + the Durable Per-Spec Shipped Ledger

**Date:** 2026-07-16

**Context:** goodbyespy live-run defect P0b. `run cancel` (then the only stop verb)
forced a fresh `run create --spec-id` against a base branch that already contained most
of the spec's work. Every task seeded `pending`; producers correctly recognized the work
existed but had NO sanctioned way to say so — the harness forced them toward NEEDS_CONTEXT
or fake re-implementation. User decision: an engine-verified ALREADY_SATISFIED verdict
PLUS a durable per-spec record of what shipped (with PR numbers).

**Decision:** Two cooperating pieces:

1. **The producer verdict.** `STATUS: ALREADY_SATISFIED — <sha…>: <evidence>` joins the
   producer protocol (both `agents/test-writer.md` and `agents/implementer.md`). The
   claimant cites commit SHAs and commits NOTHING. The ENGINE verifies in `record.ts` at
   the `spawn_in_flight` checkpoint's `tip_sha` — the pre-spawn tip, so a producer can
   never launder its own fresh commits into the claim: `resetHardClean(tip)`, every cited
   SHA must resolve AND be an ancestor of the tip, then the `test` gate must pass at that
   tip. Pass → `completeTask` + a `source: 'already-satisfied'` ledger entry. Reject (no
   SHAs / unknown SHA / non-ancestor / red tests) → `fix_findings` gains an
   `already-satisfied-verifier` record and the normal escalation burns a rung — a false
   claim is a capability failure. `applyProducerOutcome` throws loud if the outcome ever
   reaches it unverified. The `tests` spawn now threads `task.fix_findings` as
   confirmedBlockers (exec already did), so the rejection reason reaches the retry prompt.
2. **The ledger.** `specs/<repo>/<spec-id>/ledger.json` (sibling of `tasks.json`; zod;
   ENOENT → empty, garbage → loud): `{task_id, run_id, pr_number?, shas[], verified_at,
source: 'shipped' | 'already-satisfied'}`. Write sites: finalize appends one `shipped`
   entry per `done` task **inside the merged-rollup branch only** (SHA = the post-rollup
   `develop` tip — task squash SHAs are never ancestors of future bases), skipping debug
   runs; `record.ts` appends on a verified already-satisfied claim. Read site:
   `createRunFromManifest` seeds any task whose latest ledger entry's SHAs are ALL
   ancestors of the fresh staging tip directly to `done` — a re-run of a shipped spec
   starts where reality is instead of re-litigating it. Ledger IO failure in finalize
   logs loud but never fails finalize (the verdict covers the gap next run).

**Consequences:** Base-satisfied tasks cost one producer spawn (or zero, when the ledger
seeds them) instead of a full TDD pipeline against already-merged work; PR numbers are
durably queryable per spec. No file lock on the ledger — single-process writers today.

**Relationship:** Extends the Decision 46 committed-contract philosophy to spec-level
provenance; the verification reuses the Decision 5 checkpoint tip and the gate-subsetting
seam. Complements Decision 72 (`run stop`) — together they remove both halves of the
cancel→blind-recreate failure chain.

---

## Decision 71 — Dead Spawns Spend Redrives, Not Rungs; Repeated Identical Gate Failures Rederive the Tests

**Date:** 2026-07-16

**Context:** goodbyespy live-run defect P1 (two heads of one waste pattern). (a) A spawn
that died without a parseable STATUS was classified `error` → `escalateOrFail` burned a
rung on ZERO information — three infrastructure hiccups exhausted a ladder. (b) The
merge-gate send-back loop always routed to `exec`: when the TESTS were the defect (a
degenerate assertion no implementation can satisfy), the implementer was re-spawned
against the same failing gate set forever, burning the ladder without ever touching the
actual defect.

**Decision:**

- **C2 — `error` is a re-drive, not an escalation.** `applyProducerOutcome` on `error`
  logs and returns same-phase/same-rung; the next `next-action` re-entry hits the
  matching-checkpoint branch, increments `redrives`, and past `SPAWN_REDRIVE_CAP` (2)
  fails `blocked-environmental` (Decision 66's exact outcome, message widened to name
  "no parseable STATUS"). The nonsensical non-exec `test-defective` branch routes the
  same way; `FailureSignal`'s producer union shrank to `'blocked-escalate' |
'test-defective'` with loud guards.
- **C1 — same failing gates twice → rederive the tests.** The merge-gate send-back leg
  records the sorted failing-gate set (minus `holdout` — a leak guard, and tests cannot
  fix a holdout miss) in transient `task.last_failing_gates`. If the next verdict fails
  with the IDENTICAL set and the task is not `tdd_exempt`, the task escalates to `tests`
  with `test_revision_feedback` naming the repeated set — the Decision 38 machinery
  end-to-end (the regenerating test-writer clears the feedback on done). `fix_findings`
  is cleared (stale against regenerated tests); `review_dispositions` survives. Cleared
  on advance, rescue reset, and done.

**Consequences:** Infrastructure noise can no longer masquerade as capability failure;
the degenerate-test loop breaks after exactly two identical gate failures instead of
never. A rung still burns on the tests route — rederiving tests IS an escalation.

**Relationship:** C2 completes Decision 66 (one bounded budget for ALL dead-spawn
shapes); C1 reuses Decision 38's test-revision channel rather than adding a new one.

---

## Decision 72 — `run stop` Parks; `cancel` Sweeps and Warns; Cascade Victims Are `blocked-dependency`

**Date:** 2026-07-16

**Context:** goodbyespy live-run defect P2 — the root of the P0 chain. `run cancel` was
the ONLY stop verb, and it is terminal: state failed, staging deleted. An operator who
just wanted to pause overnight had to cancel, then blind-recreate — landing on the
advanced-base minefield Decision 70 addresses. Cancel also left in-flight task rows
`executing`/`reviewing` inside a failed run (undiagnosable wreckage), and its cascade
sweep mislabeled never-ran dependents `blocked-environmental` (rescue-recoverable ≠ true:
nothing environmental happened to them).

**Decision:**

- **`factory run stop`** — the park verb: sets `status: 'suspended'` with NO quota
  checkpoint, tasks untouched; idempotent on an already-parked run; loud on a terminal
  one. Plain `factory resume` un-parks (planResume already clears a quota-less suspend
  unconditionally — resume IS the sign-off). Stderr names `factory resume` and points at
  `run cancel` only as the destructive alternative.
- **The park guard.** `next.ts` gains guard 1b: `suspended` + `quota === undefined` →
  `pause` envelope with new scope `'park'`, BEFORE the checkpoint-clearing steps — which
  are now also gated on `run.quota !== undefined`. This closes the latent hole where any
  `next-task` call silently un-parked a suspended run (the A2 invariant holds: every
  quota-caused stop writes `run.quota`; a quota-less suspend is always a deliberate park).
  A parked run reports 'park' even when all tasks are terminal — stop means stop; resume
  then finalizes.
- **Cancel hygiene.** Before finalizing, `run cancel` sweeps every in-flight task to
  `failed`/`blocked-environmental` ("run cancelled by operator") so the terminal state is
  self-describing; help and output carry an irreversibility warning naming `run stop`.
- **`blocked-dependency`.** The orchestrator's cascade fail (a dependency failed → the
  dependent never ran) now uses this new failure class; rescue scans it `recoverable`
  (reset the dependency, the victim retries as-is). Circuit-breaker and e2e-assessment
  sweeps STAY `blocked-environmental` — those tasks were stopped by a systemic halt, not
  a dependency edge.

**Consequences:** Overnight pause is now `stop` + `resume` — no state loss, no
recreation, no ledger round-trip. The suspend semantics split cleanly: quota-suspends
auto-clear on the gate, parks never auto-clear.

**Relationship:** Closes the operational gap that caused Decision 70's scenario.
Extends the Decision 35/50 lifecycle-verbs line with the fourth verb (start / repair /
debug / **park**). The park-guard scope joins the QuotaStop scopes on the pause envelope.

---

## Decision 73 — `setup_steps`: CI Environment Boot Lives in the Gate Contract

**Date:** 2026-07-16

**Context:** goodbyespy live-run defect P2b — the scaffold arms race. Its test suite
needs a booted Supabase; the managed `quality-gate.yml` had no sanctioned way to express
that, so the operator hand-edited the workflow — and every rescaffold detected drift on
the plugin-MANAGED file and auto-reverted the edit ("auto-updated … quality-gate.yml",
every run). Managed-file auto-update and per-repo env boot were structurally at war.

**Decision:** The committed gate contract (`.factory/gates.json`, Decision 46) gains
optional `setup_steps`: an array of strict step objects — exactly one of `uses` (with
optional `with` inputs) or `run`, optional `name` (zod superRefine). The workflow
renderer emits them after the package-manager setup in BOTH the `# factory:setup` region
(quality job) and the `# factory:mutation-setup` region (the mutation shards boot the
test suite too, carrying the shard's slice-guard condition). goodbyespy's case becomes
six committed lines of gates.json (`{uses: "supabase/setup-cli@v1"}` +
`{run: "supabase start"}`) instead of doomed hand edits; the render is contract-sourced,
so repeated scaffolds are byte-stable.

**Consequences:** Hand edits to the managed workflow remain unsupported — but the reason
to make them is gone. Steps are rendered verbatim into repo-committed CI (same trust
level as the hand edit they replace); the contract stays TCB-write-denied, so producers
cannot inject steps mid-run.

**Relationship:** Extends Decision 46 (the contract as the single committed source of
gate truth) and Decision 53 (one render source for local + CI parity) to the environment
the gates run IN.

---

## Decision 74 — Run-Scoped Develop Protection (two-profile lifecycle)

**Date:** 2026-07-16

**Context:** `scaffold --provision` wrote PERMANENT strict protection on develop (full
checks, strict up-to-date, `enforce_admins: true`) and nothing ever removed it — so
scaffolded repos blocked the owner from pushing develop directly even with no factory
run in sight. The operator wants develop always protected, but only lightly outside runs.

**Decision:** Two profiles, one knob (`git.developProtection`, default `run-scoped`):

- **baseline** (at rest): required checks `git.developBaselineStatusChecks` (default
  Quality + Security Scan), `strict: false`, `enforce_admins: false`. Non-admin PRs into
  develop still need the checks green; **admins bypass everything** (GitHub semantics:
  required checks block direct pushes, so admin bypass is what restores the owner's
  direct-push freedom).
- **run profile** (escalated): `git.developRequiredStatusChecks`, `strict: true`,
  `enforce_admins: true` — the pre-D74 payload.

Lifecycle: scaffold writes/asserts the baseline (relaxed gate: contexts required, strict
not) → `run create` escalates (before the run row persists — same rollback contract as
the staging cut) → terminal paths de-escalate: finalize (before the terminal flip),
supersede (after the old branch delete), `run cancel --cleanup` (inside the retryable
teardown). `factory resume` idempotently RE-escalates, closing the rescued-run gap
(finalize de-escalated at `failed`, rescue reopened the run). Stateless by design: no
`developEscalated` run flag — every de-escalation is an idempotent full-replace PUT.

Two guards make de-escalation safe:

1. **Pending-rollup guard** (finalize): rollup arms GitHub auto-merge when branch policy
   blocks the immediate merge (`auto-armed`); dropping protection then would merge the PR
   WITHOUT CI. The predicate is inverted for robustness — de-escalate only when the
   rollup is merged, absent, `no-merge`, or the run failed; any pending reason
   (`auto-armed`/`ci-failing`/`ci-timeout`/`not-mergeable`) keeps the strict profile, and
   the `--recheck-rollup` re-drive de-escalates once the PR lands.
2. **Sibling-run guard** (all sites): active-run uniqueness is per (repo, issue), so two
   PRDs can run on one repo; `StateManager.hasOtherActiveForRepo` skips the downgrade
   while a sibling is live. Scaffold `--provision` likewise refuses mid-run.

Migration for already-scaffolded repos: re-run `factory scaffold --provision` (one-shot
downgrade to baseline); or just wait — the first run-terminal after the upgrade
self-heals; or hand-write it:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/develop/protection --input - <<'JSON'
{"required_status_checks":{"strict":false,"contexts":["Quality","Security Scan"]},"enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null,"allow_deletions":true}
JSON
```

**Consequences (accepted):** run-scoped mode OWNS develop's protection shape — custom
manual rules are clobbered by the full-replace PUTs (`permanent` is the escape hatch).
Admins can even force-push develop at baseline (GitHub's `enforce_admins:false` bypasses
all rules) — that is the requested freedom. A `no-merge` run de-escalates with its rollup
PR open on purpose: merging it later needs only baseline checks for non-admins. A run
closed-unmerged (surfaced-for-human in adoption) leaves develop strict until the operator
acts — over-protection only, never a CI bypass. Runs reopened in-session via `next`
(adoption, not `factory resume`) don't re-escalate; their rollup is engine-CI-gated
(`waitForCi`) regardless. Debug runs (Decision 39) are symmetric-exempt: they never
escalate at create (`debugSeed`'s `createRun` carries no stagingDeps), so their finalize
never de-escalates — a debug session rides whatever profile is live. A crash between
escalation and the run row leaves develop strict with no run — self-heals at the next
terminal.

**Relationship:** Refines Decision 35 (protection lifecycle around per-run branches) and
Decision 33's serial-writer correctness (the strict profile still guards develop for the
entire life of every run); extends Decision 60's adoption story (`--recheck-rollup`
re-drive is the pending-rollup exit).

**Amended 2026-07-16 — derived baseline default:** `git.developBaselineStatusChecks`
no longer carries its own hardcoded default. Unset, it DERIVES as
`git.developRequiredStatusChecks` minus `"Mutation Testing"` (the pinned aggregator
context) — with default lists that still yields Quality + Security Scan, but a custom
run-profile context (e.g. a repo's pgTAP check) now stays required at rest with one list
to maintain: the ONLY check the baseline drops is mutation testing. An explicitly set
value (including `[]`) overrides the derivation; the derived value is never persisted
(sparse-overlay semantics, `src/config/save.ts`).

**Amended 2026-07-20 — per-repo required checks via the gate contract (v1.45.0):** factory
config is global-only, so a per-repo protection requirement had no home. Two optional
top-level fields in the committed `.factory/gates.json` (Decision 46 philosophy) now tune the
develop profiles the engine actually PUTs (`effectiveProfiles`, `src/git/protection.ts`),
**additive-only** — a contract can add required contexts, never drop a config-required one:

- **`requiredChecks: string[]`** — extra required CI contexts merged into **both** profiles
  (run + baseline). E.g. outsidey declares `["pgTAP"]`, goodbyespy `["CI"]`. `"Mutation
Testing"` is rejected here (it is owned by the profiles).
- **`requireMutationAtRest: boolean`** — keep `"Mutation Testing"` required on the **baseline**
  profile too (reversing this decision's default that the baseline drops exactly mutation); a
  no-op when the run profile dropped the context entirely.

Both never throw at load (`loadRequiredCheckExtras`, `requiredCheckExtras` in
`gate-contract.ts`): absent → no extras, invalid → no extras + a loud warn — the
de-escalation paths (finalize / supersede / `cancel --cleanup`) must not fail on a broken
contract. All six protection PUT sites merge the extras: scaffold provisioning, run-start
escalate + supersede, resume re-escalate + `cancel --cleanup`, and finalize de-escalate (the
last gains an optional `targetRoot` dep wired from `CliDeps`).

---

## Decision 75 — Mutation CI Redesign (develop-only, warm-base incremental, hash shards, roots)

**Date:** 2026-07-18

**Context:** Stryker dominated the CI merge gate: outsidey Quality Gate runs ranged
7–50 min with one shard repeatedly a 40-minute pole, and every task PR burned
~60–80 runner-minutes on mutation CI nothing waited on. Diagnosis found four
compounding misconfigurations (a 60 s mutant timeout via a shadowed config,
`concurrency: 4` on 2-vCPU runners, the per-mutant TypeScript checker, no
`ignoreStatic`), a dead cache architecture (PR-scoped caches are unreadable by
sibling PRs and the rollup; LPT-by-sloc resharding misaligned per-shard incremental
files between runs), and one silent quality hole: goodbyespy has no `src/`, so the
required "Mutation Testing" check passed in seconds having mutated nothing.

**Decision:**

1. **Seed retune** (`templates/.stryker.config.json`): `timeoutMS` 10 000, no
   TypeScript checker (the `type` gate already runs `tsc --noEmit` on real code;
   Stryker itself default-disabled the checker in v7), `ignoreStatic: true`
   (perTest is forced by the vitest runner), no pinned `concurrency` (CI passes
   `--concurrency 2` explicitly for its 2-vCPU runners).
2. **Develop-only mutation CI:** the rendered quality-gate mutation region runs only
   on PRs targeting develop (the rollup — the merge point it actually gates). Task
   PRs into `staging-*` skip it: the local per-task gate already enforced mutation
   pre-merge and `stagingRequiredStatusChecks` defaults `[]`, so the jobs were pure
   burn. The "Mutation Testing" aggregator reports green on the skip path so the
   universal check name stays satisfiable.
3. **Warm-base incremental architecture:** a new MANAGED `mutation-nightly.yml`
   (cron + dispatch, rendered only when mutation is contracted) mutates the FULL
   mutable surface on the default branch nightly and saves per-shard incremental
   caches there — where actions/cache makes them readable by every PR. Sharding
   switched from LPT-by-sloc to STABLE HASH (`fnv1a(path) % 4`,
   `src/verifier/deterministic/shard.ts`): a file's shard depends only on its path,
   so PR shards always restore the cache the nightly seeded and re-run only
   genuinely changed mutants.
4. **Mutation roots as contract data** (fixes the silent no-op): optional
   `gates.mutation.roots: string[]` in `.factory/gates.json` (default `["src"]`,
   plain dirs, mutation gate only). Scaffold detects roots (`src/` wins; else
   candidate dirs `app/components/lib/utils/db/server/hooks` with mutable `.ts`)
   and REFUSES loudly when mutation would contract with zero roots. One source
   feeds the local gate scope (`mutationScope`), both workflows' pathspecs
   (renderer substitution), and the seeded stryker `mutate` globs.
5. **Shadow guard:** scaffold refuses to seed `.stryker.config.json` when any
   sibling Stryker config basename exists, naming the file discovery loads
   (the 60 s-timeout bug was a factory seed silently shadowing a hand-tuned
   `.stryker.config.mjs`).
6. **CI wait budget as config:** `git.rollupCiWaitMinutes` (default 30) replaces the
   hard-coded ~20 min poll bound in finalize's rollup CI wait — mutation on a cold
   cache exceeded 20 min and produced `ci-timeout` stalls.

**Consequences:** Task PRs spend zero mutation runner-minutes; rollup mutation cost
drops to changed-mutants-only against a nightly warm base; the nightly is
off-critical-path (reporting-only); goodbyespy-shaped repos get a real gate or a
loud refusal, never a placebo check.

**Relationship:** Refines Decision 46 (gate contract — `roots` is new contract
vocabulary), Decision 53 (managed CI net — second rendered workflow), Decision 74
(baseline still drops only "Mutation Testing"); supersedes the cost-aware LPT
sharding note in Decision 42-era templates.

**Amendment 2026-07-20 (v1.45.1) — 8 shards, 360 m nightly budget:** the warm-base
seeder never completed on a large surface. outsidey's full scope (~227 files /
~16.2 k mutants) split 4 ways left the worst shard needing ~7 h at `--concurrency 2`
on a 2-vCPU private-repo runner — past GitHub's hard 6 h job cap — so every nightly
job hit `timeout-minutes: 180` and Stryker (which writes the incremental file only at
run end) cached nothing; the warm base never seeded. Shard count is the only lever
that beats the 6 h cap. `SHARD_COUNT` 4→8 (`src/bin/shard-mutation-scope.ts`, matched
in both workflow templates' matrices and the `"","",…` empty-scope fallbacks); nightly
`timeout-minutes` 180→360; the nightly's pinned `--concurrency 2` dropped so Stryker
auto-detects cores (identical on a 2-core runner, a free upgrade if runners grow — the
PR-side gate keeps its explicit `--concurrency 2` since it is diff-scoped and fast).
Per-file shard == PR shard preserved (same `fnv1a % SHARD_COUNT`), so cache keys still
align; the old 4-shard caches never seeded, so the reshuffle invalidates nothing.

**Amendment (2026-07-20, v1.45.2 — quarantined files dropped from mutation scope).**
Repos may quarantine legacy files from mutation scoring with a file-wide
`// Stryker disable all: <reason>` marker on line 1 (goodbyespy's rebuild debt
ledger). Such files yield only Ignored mutants, and a shard whose slice contains
nothing else aborts Stryker's dry run with "No tests were executed" (exit 1) —
observed on goodbyespy PR #76 where 3 of 8 shards drew all-quarantined slices.
Both workflow templates' scope-compute steps now drop marker-bearing files before
sharding (an `awk` first-line check; the shard script itself stays pure/no-I/O).
Contract: the marker must be the file's FIRST line to be recognised.

**Amendment (2026-08-07, v1.46.0 — manual full tracking, hunk-scoped PR verdicts).**
Seven days of private-repository job timestamps showed the two scheduled full-surface
workflows consumed 98.3% of Actions minutes. Because GitHub bills every matrix job
separately, nightly eight-shard runs cost the sum of their runtimes; some shards also
reached the six-hour ceiling. The cache key used `github.sha` even though the workflow
checked out `develop`, so repeated immutable keys could restore but not publish newer
incremental state.

The managed filename remains `mutation-nightly.yml` for in-place rollout, but the
workflow is now **Mutation Full (Manual)** with `workflow_dispatch` only. Full shards
run sequential eight-file chunks against one incremental file, stop starting chunks
after a 330-minute soft budget, and save partial progress on threshold failure. Cache
write keys include shard, checked-out `develop` SHA, run id, and attempt; restoration
uses only the stable OS/shard prefix.

The rollup PR workflow no longer consumes full-run caches. It derives Stryker line
ranges from zero-context hunks (new files whole; modified/deletion seams padded two
lines and merged) and runs cold, making `thresholds.break` a verdict on the PR alone.
The generated `shard-mutation-scope` helper now owns both `diff <base-ref> <roots...>`
and `full <roots...>` modes plus the shared exclusions and first-line quarantine
rule. Its scaffolded test pins empty/added/modified/deletion/overlap/root/filter cases.
The Stryker seed carries the same test, declaration, type-only, `types/`, `data/`,
barrel, and Next metadata exclusions.

---

## Open Questions

### Codex Plugin Availability

Is the Codex Claude Code plugin stable and publicly available?

**Status:** Unvalidated. Fallback via Claude Code reviewer is fully functional.
