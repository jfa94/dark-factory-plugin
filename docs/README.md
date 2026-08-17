<!-- last-documented: 8ef19a14abac4cf2e07c681869652e4231ae30e1 -->

# Dark Factory Plugin

The Dark Factory is a Claude Code plugin that converts a GitHub PRD (Product
Requirements Document) issue into merged pull requests, autonomously, through a
quality-first, TDD-enforced phase machine. A person writes the requirements and
walks away; the factory generates a spec, decomposes it into a dependency graph
of tasks, drives each task test-first through implementation and an adversarial
merge gate, and ships the result up a per-run `staging-<run-id> → develop`
integration branch — only once the whole PRD is delivered, never touching `main`.

## What problem it solves

Autonomous coding agents are unreliable narrators: an agent that says "done"
followed its instructions roughly 70% of the time. The Dark Factory's answer is
to push every decision that _can_ be deterministic out of the agent and into
code, leaving the agents to do only what requires judgment (generate a spec,
write code, review code). The result is a pipeline where phase transitions,
failure classification, the retry ladder, automated gates, and the merge gate are
all enforced by a tested TypeScript engine — not by prose an agent may ignore.

## Design philosophy

**Model A — one engine, one seam, one thin runner.** The plugin is two halves
with a hard seam between them:

- A **deterministic engine**: one Node + TypeScript CLI, `factory <subcommand>`,
  that owns _all_ run-state writes, the spec gates, the deterministic verifier
  gates, failure classification, the producer escalation ladder, the
  risk-invariant merge gate, PR creation — and the pipeline loop itself, exposed
  through ONE seam, the **orchestrator** (`factory next-task` + `factory next-action`). It is pure,
  tested, and **never spawns an agent**.
- A thin **runner**: it steps the seam — spawning exactly the `Agent()`s the
  orchestrator's spawn request names and feeding their raw output back via `factory next-action
--results`. It carries no pipeline logic and never decides a transition by prose.
  ONE runner steps the seam (Decision 42): the in-session parallel event loop
  (`skills/pipeline-runner/SKILL.md`) — every `factory` call foreground, up to
  `maxParallelTasks` tasks' agents in the background.

The CLI subcommands are **reporters** (read-only; emit one JSON envelope), the
**orchestrator** (`next-task` / `next-action` — the control-flow seam), or **writers** (single-step
state mutations). The CLI is the brain and owns the loop; a runner is just the
hands.

**Quality over speed.** Every task is produced test-first (a `test-writer`
commits failing tests, then a `implementer` commits the minimal
implementation — enforced by the TDD gate), passes a stack of deterministic
automated gates (tests, coverage, mutation, SAST, type, lint, build, and the TDD
gate itself), and clears a unanimous four-reviewer adversarial panel — plus a
conditional schema specialist when the diff touches the database — before it can
ship. Reviewer findings are independently confirmed before they act
(verify-then-fix).

**Derive, don't store.** The run state file holds no gate pass/fail booleans.
Every verdict is re-derived from ground truth at the moment it is needed, so
there is structurally nothing in state for an agent to forge.

**Loud, classified failure.** Nothing fails silently. When a task cannot be made
to meet the bar, it is _failed_ with a closed-enum failure class and a
human-facing reason. Because `develop` receives only whole PRDs, any fail makes
the run `failed`: `develop` is left untouched, the PRD stays open, and one comment
listing every failed task is posted on the PRD issue. A `failed` run is a legible,
classified outcome — never a quiet success.

## Architecture at a glance

| Layer             | Lives in                                                            | Role                                           |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------- |
| Runner surface    | `commands/`, `agents/`, `skills/` (markdown)                        | LLM instructions + agent definitions           |
| Deterministic CLI | `src/` → `dist/factory.js` (via `bin/factory`)                      | The engine: orchestrator + reporters + writers |
| Hook guards       | `src/hooks/` → `dist/factory-hook.js` (wired in `hooks/hooks.json`) | Enforce invariants at tool-use time            |
| Run / spec state  | `$CLAUDE_PLUGIN_DATA/{runs,specs}/`                                 | Engine-only; lives **outside** the target repo |
| Task worktrees    | `<repo-root>/.claude/worktrees/<run>/<task>/` (gitignored)          | Agent-writable; results at `<run>/.results/`   |

See [architecture/overview.md](./architecture/overview.md) for the full picture.

## Who it is for

Engineers operating the factory against their own repositories, and contributors
working on the plugin's TypeScript engine. The [getting-started](./getting-started.md)
tutorial onboards a contributor end-to-end; the [guides](./guides/) solve
operator tasks; the [reference](./reference/) is the precise CLI / config / state
contract.

---

## Table of contents

### Getting started

- [Getting Started](./getting-started.md) — clone, verify, and trace a run through the engine end-to-end (contributor onboarding).

### Architecture

- [System Overview](./architecture/overview.md) — system context + container view: the Model-A split, the run lifecycle, data flow.
- [Components](./architecture/components.md) — the major building blocks: CLI registry, state store, phase machine, verifier, producer, quota, git, scoring, hooks.

### How-to guides

- [Run the pipeline](./guides/run-the-pipeline.md) — drive a PRD issue to shipped PRs.
- [Run with end-to-end tests](./guides/run-with-e2e.md) — add the autonomous Playwright e2e phase with `--e2e`.
- [Scaffold a target repo](./guides/scaffold-a-repo.md) — prepare a repo (CI net, gate configs, `develop` branch protection).
- [Configure the factory](./guides/configure-the-factory.md) — inspect and edit the config overlay.
- [Rescue a stalled run](./guides/rescue-a-stalled-run.md) — `/factory:resume` routes and consent-gates the repair for you; the rescue scan/apply plumbing underneath.
- [Build and verify the engine](./guides/build-and-verify.md) — the contributor build/test/bundle workflow.

### Reference

- [CLI](./reference/cli.md) — every `factory` subcommand, its flags, and its JSON result.
- [Engine vocabulary](./reference/engine-vocabulary.md) — orchestrator vs runner, the `next-task`/`next-action` seam, and what each control-flow word means.
- [Hooks](./reference/hooks.md) — the `factory-hook` guards and their `hooks.json` wiring.
- [Configuration schema](./reference/configuration.md) — every config key, type, and default.
- [State model](./reference/state-model.md) — the run/spec store layout and the `RunState`/`TaskState` schema.
- [Automated gates](./reference/automated-gates.md) — the closed gate set and what each checks.
- [Exit codes](./reference/exit-codes.md) — the CLI/hook exit-code contract.

### Explanation

- [Model A: the deterministic/LLM split](./explanation/model-a.md) — why the brain/hands seam, and what it buys.
- [The verifier and the risk-invariant merge gate](./explanation/verifier.md) — the two-layer verifier, the panel, verify-then-fix.
- [The producer escalation ladder](./explanation/producer-ladder.md) — nuke-and-retry, change-a-variable, classify-before-retry.
- [Quota pacing and resumption](./explanation/quota-pacing.md) — the two-window pacer; pause vs suspend vs halt.
- [The plugin data dir](./explanation/plugin-data-dir.md) — where run/spec state lives and why it sits outside the target repo.
- [Derive, don't store](./explanation/derive-dont-store.md) — why no gate verdict is ever persisted.
- [Design Decisions](./explanation/decisions.md) — the design ledger (preserved; see the cutover annotation).

### Domain

- [Glossary](./glossary.md) — the ubiquitous-language terms of the Dark Factory domain.
