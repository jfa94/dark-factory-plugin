# Plan 14 — Documentation Honesty

**Priority:** P2 (polish — docs are a contract; drift is a bug)
**Tasks:** `task_14_01` through `task_14_02`
**Findings:** P\*-docs

## Problem

The plugin's documentation overstates what the current implementation actually does. Two concrete examples:

1. **`01-prd.md` Goal #1** claims "fully autonomous end-to-end execution of a PRD through merged PRs with zero human intervention". The current implementation requires humans to:
   - Manually pre-install `spec-reviewer` and `code-reviewer` agents (plan 01 addendum fixes this but the PRD doc hasn't been updated)
   - Resolve PRs that escalate to `needs_human_review`
   - Create PRD issues with specific labels (plan 11 fixes discovery; the PRD still implies "any issue works")
   - Run `/factory:configure` once per project

   The doc should acknowledge these human touchpoints explicitly rather than promising "zero intervention".

2. **`05-decisions.md` has unresolved open questions listed as "decided"**. Several items in the Decisions section have language like "Decision: TBD — leaning toward X" which is not a decision. Either make the decision and update the doc, or move those items to an explicit "Open Questions" section at the bottom.

## Scope

In:

- Rewrite `01-prd.md` Goal #1 to accurately describe current behavior and the human touchpoints that remain
- Audit `05-decisions.md` and split genuine decisions from open questions

Out:

- Creating new documentation (no new files)
- Rewriting the entire PRD

## Tasks

| task_id    | Title                                                   |
| ---------- | ------------------------------------------------------- |
| task_14_01 | Rewrite 01-prd.md Goal #1 with accurate autonomy claims |
| task_14_02 | Split 05-decisions.md into decisions vs open questions  |

## Execution Guidance

### task_14_01 — PRD Goal #1

File: `01-prd.md`

Current claim (paraphrased): "Goal #1: fully autonomous end-to-end execution of a PRD to merged PRs with zero human intervention."

Rewrite to:

```markdown
## Goal #1 — Minimal-intervention PRD execution

The plugin aims to execute a PRD from issue-tracker entry through merged
pull requests with minimal human intervention. The following touchpoints
require a human:

**One-time setup (per project):**

- Install the plugin from the marketplace
- Run `/factory:configure` to set project-specific thresholds
  (quota.pause_threshold, parallel.max_concurrent, review.spec_threshold)
- Create a GitHub label `prd` for PRD issues (or use file-based PRDs)

**Per run:**

- Create a GitHub issue labeled `prd` describing the work
- Run `/factory:run <issue_number>` (or omit the number to use the
  most-recently-updated prd-labeled issue)

**During the run (intervention points):**

- Tasks escalated to `needs_human_review` require human approval — these
  happen when:
  - Quality gates fail 3 times in a row on the same task
  - Code review verdicts return REQUEST_CHANGES 3 times in a row
  - Circuit breaker trips (runtime, cost, or failure caps exceeded)
  - A reviewer returns NEEDS_DISCUSSION

- PRs that pass all automated checks merge without human action unless
  the project's GitHub branch protection rules require a human approver.

**Not autonomous by design:**

- Merging PRs into `main` — the plugin merges into `develop`. A human
  (or a separate release automation) cuts `main` from `develop`.
- Deleting branches on `main` or `master` — blocked by hooks.
- Modifying `.env*`, migrations, secrets — blocked by hooks.

Goal #1 is satisfied when a labeled PRD issue can be completed by running
a single command and approving escalated tasks on the way.
```

Key changes:

- "Fully autonomous" → "Minimal-intervention"
- Explicit list of touchpoints instead of hand-waving
- Explicit "not autonomous by design" section — the hooks are a feature, not a bug

### task_14_02 — Decisions vs Open Questions

File: `05-decisions.md`

Read the full file. For each numbered decision entry, classify as:

- **Decided** — contains "Decision: X" with a clear choice and no "leaning toward"
- **Open Question** — contains "TBD", "leaning toward", "unclear", or wording that doesn't commit

Move every open question to a new section at the bottom:

```markdown
## Open Questions

The following decisions are not yet made. They should be resolved before
a production run or explicitly acknowledged in an ADR.

1. **[Topic]** — [One-line summary of the question]
   - Options considered: A, B, C
   - Current lean: [if any]
   - Blocker for: [which plans/tasks depend on this]

2. **[Topic]** — ...
```

Leave the decided items in the main body but add an explicit "Decided: YYYY-MM-DD" timestamp to each. If a decision was made in the current remediation effort, cite the plan or task that settled it:

```markdown
## D7 — Spec reviewer scoring threshold

**Decided: 2026-04-10** (via Plan 01 follow-up)

Spec reviewer passes at 54/60 — matching `spec-generator.md`'s output
threshold. A spec scoring 53 or below is returned to the spec generator
for revision.
```

Specific items the review identified as open but labeled "decided":

- Parallel execution strategy (batched vs streaming) — reference plan 07
- When to run mutation testing — reference plan 10 task_10_02
- Ollama model selection policy — reference plan 02

If any of these are genuinely decided, add the decision timestamp and reference. If they're not, move to Open Questions.

At the top of the Open Questions section, add a warning:

```markdown
> ⚠ An open question is a commitment to defer a decision. It should have
> a timeline and an owner. Open questions older than 6 months should be
> either decided or removed.
```

## Verification

1. `grep -c 'fully autonomous' 01-prd.md` → zero matches (replaced with "minimal-intervention")
2. `grep -c 'zero human intervention' 01-prd.md` → zero matches
3. `grep -c 'needs_human_review' 01-prd.md` → at least one match (escalation points documented)
4. `05-decisions.md` contains a `## Open Questions` section
5. Every entry under `## Open Questions` has at least `Options considered:` and `Blocker for:` fields
6. Every decided item in `05-decisions.md` has a `Decided: YYYY-MM-DD` line
7. Grep `05-decisions.md` for `TBD` and `leaning toward` — zero matches in the "decided" sections (only allowed in Open Questions)
