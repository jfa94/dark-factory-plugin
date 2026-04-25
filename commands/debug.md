---
description: "Run a reviewer ⇄ implementer loop against the latest commit (or a chosen scope) until the reviewer is satisfied"
arguments:
  - name: "--base"
    description: "Diff base (commit hash). Mutually exclusive with --full. Default: HEAD~1."
    required: false
  - name: "--full"
    description: "Review the entire codebase (sets base to git's empty-tree SHA). Mutually exclusive with --base."
    required: false
  - name: "--limit"
    description: "Maximum runtime in seconds. Soft limit — checked between loop iterations only."
    required: false
  - name: "--fixSeverity"
    description: "Minimum severity to address: critical | high | medium | all. Default: medium."
    required: false
---

# /factory:debug

Reuse the existing reviewer (Codex when available) and `task-executor` agent in a loop:

1. Review the diff between `--base` (or HEAD~1, or root) and HEAD.
2. Filter findings by `--fixSeverity`.
3. If any remain, spawn `task-executor` to verify and fix them.
4. Repeat until clean, escalated, or `--limit` reached.

Parse flags from the user's input. Reject the call if both `--base` and `--full` are provided. Resolve the base ref:

- `--base <hash>` → that hash.
- `--full` → `4b825dc642cb6eb9a060e54bf8d69288fbee4904` (git empty tree).
- (default) → `HEAD~1`.

Validate `--fixSeverity` against `{critical, high, medium, all}` (default: `medium`).

Then load the skill:

```
Skill(debug, "base=<resolved> severity=<level> limit=<seconds> run-id=debug-$(date +%s)")
```

All loop logic lives in `skills/debug/SKILL.md`. Do not duplicate it here.
