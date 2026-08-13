---
name: e2e-authoring
description: Use when authoring or reviewing Playwright end-to-end journey specs for the factory's e2e phase (Decision 39) — the discipline behind a meaningful, non-flaky, thin autonomous suite.
---

# E2E Authoring — Playwright journey discipline

## Overview

You are authoring end-to-end specs **nobody will review**. A vitest/unit test that's
wrong gets caught by the reviewer panel diffing the implementation against it; an e2e
spec gates a run (and every future `--e2e` run) on your judgment alone. That asymmetry drives
every rule below.

**Core principle:** a green e2e spec must mean "the user journey actually works," never
"an assertion happened to pass." The single biggest risk in autonomous e2e authoring is a
spec that's green but meaningless.

## The two tiers — persistence IS the criticality signal

There is no `@critical` tag, no annotation, no metadata file. **Where a spec lives is
what it means:**

- **Committed** (target repo's `e2e/` — the engine's fixed test directory) = **critical**.
  Thin, journey-oriented, load-bearing — it gates this run and every future `--e2e` run.
  Must pass the fail-first proof (below) before it is ever merged.
- **Ephemeral** (a gitignored run directory, never committed) = **throwaway**. One per
  user-facing task, broader coverage, exists only to shake out issues in _this_ run.
  Discarded when the run ends. No proof required — but still write it honestly; a
  false-green throwaway hides a real bug just as effectively as a false-green critical
  one, it just doesn't outlive the run.

Don't author a critical spec per task. Critical specs are the ~10%-of-the-pyramid
money-paths (checkout, sign-up, the thing that makes the app the app) — everything else
belongs in the throwaway tier or in vitest, not in the committed suite.

## The control assertion — the fail-first proof's anchor

Every critical spec needs one assertion titled with the `control:` prefix that passes on
**any** boot of the app, regardless of whether your new feature exists:

```typescript
test('control: app shell renders', async ({page}) => {
    await page.goto('/')
    await expect(page.getByRole('navigation')).toBeVisible()
})

test('checkout completes and shows order confirmation', async ({page}) => {
    // ... the actual journey, expected to fail on the unmodified base app
})
```

The engine runs your spec twice before merging it: once against the **unmodified base
branch** (expects `control:` GREEN + every journey assertion RED — proving "the app
booted but the feature doesn't exist yet," not "the app is broken"), and once against
**staging with your feature** (expects everything GREEN). A spec whose control assertion
fails on base is rejected as unprovable ("base unusable"); a spec that's already green on
base is rejected as vacuous (it isn't testing anything new). This is the autonomous
stand-in for a human reviewing your assertions — there is no other check.

## Locators, waits, auth, data (the reports' discipline)

| Do                                                          | Don't                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `page.getByRole("button", { name: "Checkout" })`            | `page.locator(".btn-primary-42")` — breaks on the next class rename  |
| `page.getByLabel("Email")`, `getByText(...)`                | XPath, nth-child, auto-generated test IDs you invented on the spot   |
| Web-first assertions: `await expect(locator).toBeVisible()` | `await page.waitForTimeout(2000)` — a hard wait always races reality |
| `expect(...).toPass()` for eventually-consistent state      | Manual `sleep`/retry loops around a flaky selector                   |
| `storageState` for authenticated journeys                   | Logging in via the UI in every single spec                           |
| Seed the exact data your spec needs                         | Relying on ambient fixtures / whatever data happens to exist         |

A spec that needs a hard wait to pass is telling you the locator or assertion is wrong,
not that the timeout is too short.

## Flaky vs. failed — never conflate them

Playwright's `retries` config (set in `playwright.config.ts`) reruns a failing test; the
JSON reporter marks a spec that failed then passed on retry as **flaky**, distinct from
one that failed on every attempt. The engine's decision logic treats these completely
differently:

- **Failed on every attempt** → a real signal. Feeds the reopen/fail decision.
- **Flaky (failed, then passed)** → reported, but **never** triggers a reopen. A spec you
  authored that's flaky against a stable staging app is a spec with a real bug in it
  (a race, a missing wait-for) — fix the flakiness at authoring time; don't rely on the
  engine's retry to paper over it.

## Journey-oriented, not task-oriented

A throwaway spec should read like a user's actual path through the feature, not a
mechanical restatement of the task's acceptance criteria as separate `test()` blocks.
One task might need one throwaway spec with several assertions along a single journey;
it rarely needs five near-identical specs.

## Self-validation is not optional

You are the only reviewer your spec will ever get before it gates a run. Run it yourself
against the live app and watch it pass for the right reason — the same "did I actually
prove this" discipline as TDD's RED phase, inverted: here you're proving GREEN is real,
not that RED is real.

## Common rationalizations

| Thought                                                                | Reality                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "I'll skip the control assertion, my spec obviously needs the feature" | The proof can't tell "obviously" from "I forgot to write it" — no control means auto-rejected.                                        |
| "One critical spec per task is more thorough"                          | Thoroughness lives in the throwaway tier / vitest. A bloated critical suite is slow and fragile — everything in it survives forever.  |
| "A short `waitForTimeout` here is harmless"                            | It either races (flaky under load) or hides a missing web-first assertion. Use `toPass()`/auto-wait instead.                          |
| "It passed once, good enough"                                          | Self-validate means run it and watch it pass for the right reason — same discipline as watching RED fail for the right reason in TDD. |
| "This throwaway spec doesn't need to be careful, it's not committed"   | A false-green throwaway still hides a real bug in the PR you're about to ship this run.                                               |

## Checklist before returning your manifest

- [ ] Every critical spec has exactly one `control:`-prefixed assertion that doesn't
      depend on the new feature.
- [ ] Every spec uses semantic locators — no brittle CSS/XPath, no hard waits.
- [ ] Authenticated journeys use `storageState`, not a UI login per spec.
- [ ] Every spec you authored ran green against the live app before you finished.
- [ ] The critical tier stays thin — money-paths only, not one-per-task.
- [ ] Every spec appears in the manifest with correct `task_ids` and `kind` — an
      unlisted spec can never be joined back to its task if it later fails.
- [ ] Every manifest entry carries a human-readable `title` ("Checkout completes and
      shows order confirmation") — it is what the run report shows a user who knows
      nothing about e2e testing (Decision 40).
