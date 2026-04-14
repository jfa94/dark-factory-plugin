# Adversarial Review

This document explains the Actor-Critic pattern used for code review and why adversarial posture matters.

## Why Adversarial Review

Standard code review is collaborative: the reviewer helps the author improve the code. This works well when both parties have different perspectives and incentives.

When an AI generates code and an AI reviews it, the collaborative model breaks down. Both agents share the same training, similar biases, and no natural tension. A "helpful" reviewer may rationalize issues away or fail to catch problems that seem reasonable in context.

Adversarial review solves this by giving the reviewer a different objective: find all issues, not be helpful. The reviewer treats produced code as a hostile artifact that must be proven correct.

Research shows this approach catches 73% more issues, results in 71% fewer post-merge bugs, and reduces review time by 42% (Autonoma study). The cost is approximately $0.20-$1.00 per feature versus $50-$100/hr for human review.

---

## The Actor-Critic Pattern

The pipeline implements the Actor-Critic adversarial pattern:

**Actor (Builder):** task-executor agent

- Optimistic, fast implementation
- Knows the spec
- Has full implementation context
- Goal: ship working code quickly

**Critic (Reviewer):** task-reviewer agent or Codex

- Paranoid adversary
- Reviews cold (zero implementation context)
- Cannot modify code to ease validation
- Goal: find ALL issues

The asymmetry is critical. The Critic has no knowledge of why the Actor made certain choices. It cannot rationalize "oh, they probably did that because..." It only sees the output and must validate it against the spec.

---

## Fresh-Context Review

The task-reviewer agent reviews with zero implementation context. It receives:

- The code diff
- The acceptance criteria
- The holdout criteria (criteria the executor never saw)

It does NOT receive:

- The original prompt given to the executor
- The executor's reasoning or thought process
- Prior iterations or failed attempts

This fresh-context approach prevents the reviewer from inheriting the executor's assumptions. If the executor misunderstood a requirement, the reviewer is more likely to catch it because it reads the requirement independently.

---

## Multi-Round Review Loop

Review is iterative:

```
Round 1: Critic reviews → finds issues → REQUEST_CHANGES
Round 2: Actor fixes → Critic re-reviews → finds fewer issues → REQUEST_CHANGES
Round 3: Actor fixes → Critic re-reviews → APPROVE (or escalate)
```

Each round, the Actor receives specific findings to address. The Critic verifies the fixes were made correctly.

**Round limits by risk tier:**

| Risk Tier | Cloud Max | Ollama Max |
| --------- | --------- | ---------- |
| Routine   | 2         | 15         |
| Feature   | 4         | 20         |
| Security  | 6         | 25         |

Ollama limits are higher to compensate for lower model quality. The local model may need more iterations to converge on acceptable code.

---

## Verdicts

The reviewer outputs one of three verdicts:

**APPROVE**

- Zero blocking findings
- All acceptance criteria pass
- All holdout criteria pass

**REQUEST_CHANGES**

- One or more blocking findings, OR
- One or more criteria fail

The reviewer must provide specific findings with file, line, severity, and description.

**NEEDS_DISCUSSION**

- Ambiguity requiring human judgment
- The reviewer cannot determine correctness
- Escalates immediately (does not consume review rounds)

---

## Security Tier Review

Security-tier tasks (those touching auth, payment, crypto, etc.) receive additional review:

1. `task-reviewer` with standard review-protocol
2. `security-reviewer` agent (OWASP Top 10, secrets exposure)
3. `architecture-reviewer` agent (design implications)

All three must approve. Any REQUEST_CHANGES triggers a fix cycle.

---

## Codex vs Claude Code

The pipeline prefers OpenAI Codex for adversarial review when available:

```bash
pipeline-detect-reviewer
  → If Codex CLI installed + authenticated: use Codex
  → Otherwise: use Claude Code task-reviewer
```

Codex has a purpose-built adversarial review mode designed for pressure-testing assumptions. It performs threat modeling and edge case analysis specifically.

The Claude Code fallback uses the `task-reviewer` agent with the `review-protocol` skill injected. This provides consistent review behavior regardless of which reviewer is used.

---

## The review-protocol Skill

This skill injects Actor-Critic methodology into any reviewer. It provides:

**Adversarial posture:**

- Treat code as a hostile artifact
- Assume it's wrong until proven correct
- Do not rationalize or explain away issues

**Security audit checklist:**

- Injection vulnerabilities
- XSS
- Auth bypass
- Secret exposure
- OWASP Top 10

**AI anti-pattern detection:**

- Hallucinated APIs (calling functions that don't exist)
- Over-abstraction (premature helpers, unnecessary indirection)
- Copy-paste drift (similar but subtly different code blocks)
- Dead code (unused imports, unreachable branches)
- Excessive I/O (unnecessary file reads, redundant API calls)
- Sycophantic generation (code that looks good but doesn't work)
- Infinite code problem (unbounded growth without convergence)

**Structured output:**

The skill enforces a specific output format so `pipeline-parse-review` can extract verdicts and findings programmatically.

---

## Verdict Parsing

`pipeline-parse-review` normalizes output from both Codex and Claude Code:

```json
{
  "verdict": "REQUEST_CHANGES",
  "findings": [
    {
      "severity": "critical",
      "file": "src/auth.ts",
      "line": 42,
      "description": "SQL injection via unsanitized input",
      "category": "security"
    }
  ],
  "round": 1,
  "reviewer": "codex",
  "summary": "..."
}
```

Severity levels:

- **critical**: Must fix, blocks approval
- **major**: Should fix, blocks approval
- **minor**: Consider fixing, does not block
- **suggestion**: Optional improvement

Categories:

- security
- correctness
- performance
- style
- anti-pattern

---

## When Review Fails

If max review rounds are exhausted with REQUEST_CHANGES:

1. Task is marked `needs_human_review`
2. Pipeline pauses for this task
3. Other independent tasks continue
4. Human can review findings and either:
   - Fix the issue manually
   - Adjust requirements
   - Override and approve

The goal is graceful degradation: one difficult task should not block the entire pipeline.
