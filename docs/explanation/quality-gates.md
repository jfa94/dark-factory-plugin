# Quality Gates

This document explains the 5-layer quality gate stack and the rationale behind each layer.

## Why 5 Layers

AI-generated code has a 67.3% PR rejection rate (LinearB study). The failures cluster around specific patterns:

- **Syntax and style errors** that static analysis catches
- **Broken tests** that the test suite catches
- **Coverage regression** where agents delete failing tests rather than fixing implementations
- **Surface-level implementations** that satisfy the letter but not the spirit of requirements
- **Tautological tests** that assert what was written, not what should work

Each layer targets a specific failure mode. The layers are sequential: a failure at any layer blocks progression to the next. This ensures problems are caught early, reducing wasted computation on code that would fail later.

---

## Layer 1: Static Analysis

**Purpose:** Catch syntax errors, lint violations, type errors, and formatting issues before tests run.

**Trigger:** Automatic via existing user hooks. Fires on every commit attempt.

**Why this layer exists:**

Agent instructions to "follow coding standards" are followed approximately 70% of the time. Hooks enforce at 100%. By delegating style enforcement to pre-commit hooks, the pipeline guarantees consistent code quality regardless of agent behavior.

**Failure behavior:**

The task-executor receives hook error output and fixes the issue. Max 3 internal retries. If all retries fail, the task is marked failed.

**Configuration:**

This layer uses the user's existing hook configuration. No plugin-specific settings.

---

## Layer 2: Test Suite

**Purpose:** Verify implementation correctness against existing and new tests.

**Trigger:** Runs as part of the task-executor's internal loop. The existing Stop hook also runs tests when the agent session ends.

**Why this layer exists:**

Tests are the primary correctness check. Unlike static analysis (which catches form), tests catch functional errors. The dual trigger (executor loop + Stop hook) ensures tests run even if the executor doesn't explicitly invoke them.

**Failure behavior:**

The task-executor receives test output and fixes failing tests or implementation. Max 3 internal retries. Critical rule: never modify existing tests to make them pass. Fix the implementation instead.

**Configuration:**

Uses the project's test runner. No plugin-specific settings.

---

## Layer 3: Coverage Regression

**Purpose:** Ensure new code doesn't decrease test coverage.

**Why this layer exists:**

Agents under pressure (e.g., running out of turns) have been observed to delete failing tests to improve metrics. This layer catches that behavior. Coverage is treated as a floor, not an optimization target: it must not decrease.

**Trigger:** After test suite passes. Called by the orchestrator.

**How it works:**

`pipeline-coverage-gate` compares before/after coverage JSON files. It checks line coverage, branch coverage, function coverage, and statement coverage. Any decrease beyond the tolerance threshold (default 0.5%) fails the gate.

**Failure behavior:**

The task-executor must add tests to restore coverage. The orchestrator re-runs the coverage gate after the fix.

**Configuration:**

| Setting                                  | Default | Description                                                                                           |
| ---------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| `quality.coverageMustNotDecrease`        | true    | Enable/disable this gate                                                                              |
| `quality.coverageRegressionTolerancePct` | 0.5     | Max allowed drop in percentage points before the regression gate fails (not a minimum coverage floor) |

---

## Layer 4: Holdout Validation

**Purpose:** Verify that the implementation genuinely satisfies the spec, not just the explicit instructions.

**Why this layer exists:**

AI implementations can "teach to the test" - satisfying exactly what was asked without understanding the broader requirement. Holdout validation withholds a percentage of acceptance criteria from the task-executor, then checks if those criteria are met anyway. If the implementation is genuinely correct, withheld criteria should be satisfied as a natural consequence.

This pattern comes from machine learning, where holdout data prevents overfitting. Applied to code generation, it prevents surface-level implementations.

**Trigger:** After coverage gate passes. Called by the orchestrator.

**How it works:**

1. `pipeline-build-prompt --holdout N%` randomly selects N% of acceptance criteria
2. Selected criteria are stored in `${CLAUDE_PLUGIN_DATA}/runs/<run-id>/holdouts/<task-id>.json`
3. Task-executor never sees withheld criteria
4. After execution, the orchestrator passes withheld criteria to the reviewer
5. Reviewer verifies whether the implementation satisfies them

Since task-executors run in worktrees and holdouts live in plugin data, the executor cannot access criteria it was not meant to see.

**Failure behavior:**

If fewer than 80% of withheld criteria are satisfied, the implementation is surface-level. The task-executor receives the full spec (including previously withheld criteria) and re-implements. Holdout validation is NOT repeated on re-implementation (that would be unfair - the executor now knows all criteria).

**Graceful skip behavior:**

When a holdout file exists but the `SubagentStop` hook has not wired the `holdout_review_file` field to state, the pipeline records `.tasks.<id>.quality_gates.holdout = "skipped"` and continues rather than blocking. This avoids infinite re-entry loops when the holdout reviewer output is not yet available. The scorer treats `skipped` as `skipped_na` (not applicable) rather than a failure.

**Configuration:**

| Setting                   | Default | Description                        |
| ------------------------- | ------- | ---------------------------------- |
| `quality.holdoutPercent`  | 20      | Percentage of criteria to withhold |
| `quality.holdoutPassRate` | 80      | Minimum % that must be satisfied   |

---

## Layer 5: Mutation Testing

**Purpose:** Verify test quality by measuring mutation score.

**Why this layer exists:**

AI-generated tests often achieve high line coverage (85-95%) but low mutation scores (30-40%). These are tautological tests: they assert what was written, not what should work. Example:

```javascript
// Implementation
function add(a, b) {
  return a + b;
}

// Tautological test
test("add works", () => {
  expect(add(2, 3)).toBe(5); // Passes, but doesn't test edge cases
});
```

A mutant like `return a - b` would make this test fail, but if the test only checks one case, many mutants survive. Mutation score measures test thoroughness: what percentage of code changes (mutants) are caught by tests?

Industry target is >80% mutation score. AI code has 15-25% higher mutation survival rates than human code.

**Trigger:** After holdout validation passes. Only runs for feature-tier and security-tier tasks (routine tasks skip).

**How it works:**

1. Run mutation testing framework (Stryker)
2. If score < 80%, spawn `test-writer` (bundled in plugin)
3. `test-writer` generates targeted tests for surviving mutants
4. Re-run mutation testing
5. Max 2 rounds of mutation test improvement

**Failure behavior:**

If mutation score remains below 80% after 2 rounds, log a warning and continue. The goal is improvement, not perfection.

**Configuration:**

| Setting                        | Default                   | Description                           |
| ------------------------------ | ------------------------- | ------------------------------------- |
| `quality.mutationScoreTarget`  | 80                        | Minimum mutation score percentage     |
| `quality.mutationTestingTiers` | `["feature", "security"]` | Risk tiers requiring mutation testing |

---

## Layer Interactions

The layers are designed to complement each other:

1. **Static analysis** catches form errors early, before expensive test runs
2. **Test suite** catches functional errors
3. **Coverage regression** prevents gaming by deleting tests
4. **Holdout validation** prevents surface-level implementations
5. **Mutation testing** prevents tautological tests

Each layer addresses a failure mode that previous layers miss. Together, they form a defense-in-depth strategy against AI-generated code quality issues.

---

## Skipping Layers

Individual layers can be disabled via configuration:

- Coverage: `quality.coverageMustNotDecrease: false`
- Holdout: `quality.holdoutPercent: 0`
- Mutation: `quality.mutationTestingTiers: []`

Static analysis and test suite cannot be disabled; they are enforced by the user's existing hooks.

Disabling layers reduces execution time but increases the risk of quality issues reaching pull requests. Disable only when you understand the tradeoff.
