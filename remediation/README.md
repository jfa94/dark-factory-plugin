# Factory Plugin — Remediation (Historical)

This directory holds the markdown plans that drove the post-review remediation work for the dark-factory / factory plugin migration. **All work tracked here is complete.** The directory is retained for archaeology — the plans explain _why_ particular fixes were made and what the alternatives were, which can be useful when revisiting the same areas later.

The original task tracker (`tasks.json`, 75 entries) was removed in 0.3.0; every entry was status=`done` and the surviving narrative lives in the per-plan markdown files plus git history.

## Structure

```
remediation/
├── README.md
└── plans/
    ├── 01-critical-safety-hardening.md
    ├── 03-spec-propagation.md
    ├── 04-production-safety-template.md
    ├── 05-branch-rebase-handling.md
    ├── 06-state-resume-correctness.md
    ├── 07-orchestrator-prompt-flow.md
    ├── 09-hook-robustness.md
    ├── 10-scaffolding-parity.md
    ├── 11-validator-discovery.md
    └── 13-minor-cleanups.md
```

Plans 02 (quota-rate-limiting), 08 (config-schema-alignment), 12 (integration-tests), 14 (documentation-honesty), 15 (turn-budget), and 16 (runnable-posture) were removed in 0.3.0 along with the Ollama/LiteLLM local-LLM routing, `maxTasks`, and `execution.maxOrchestratorTurns` features they were written against.

## Test safety — do not run destructive commands against real paths

Several tasks in these plans harden code that calls `rm -rf`, `git push --force`, `gh issue close`, etc. The same rules still apply when extending those areas:

1. Never pass a real filesystem path (`/`, `~`, `$HOME`, the repo root, `/tmp` itself) as an argument to a command being hardened. Use a child of a fresh `mktemp -d` sandbox the test itself created. For teardown, always guard the variable: `trap '[[ -n "$sandbox" && "$sandbox" == /tmp/* ]] && rm -rf "$sandbox"' EXIT`. Never use `rm -rf` directly on any path you did not create in the current script.
2. Stub external calls (`git rev-parse`, `gh`, `git push`, etc.) with a mocks directory on `PATH` so a red-phase run never touches the real repo or real GitHub.
3. If a finding says "verify `--spec-dir ~` is rejected", treat that as _semantic_ — use a sandbox path that sits outside the fake project root, never the literal `~` or `/`.
4. When in doubt, stop and ask. The cost of pausing is seconds; the cost of `rm -rf ~` is your home directory.

## Testing requirement

Every fix shipped here had to include regression tests in `bin/tests/*.sh`. The same expectation applies to any future patch in these areas — pure structural tests are not enough; the test must fail against the buggy code and pass against the fix.

Tests live in `bin/tests/*.sh`, organized by domain: `state.sh`, `spec-intake.sh`, `task-prep.sh`, `branching.sh`, `cleanup.sh`, `hooks.sh`, `routing.sh`, `run-command.sh`, `config.sh`, `audit-hooks.sh`. Integration tests live in `bin/tests/integration.sh`. The `bin/test` runner invokes the full suite.

## Finding reference

- Full findings in the review chat transcript and the response preceding this remediation.
- `C1`–`C9`: Critical (P0 blockers)
- `M1`–`M23`: Major (P1)
- `S1`–`S7`: Security-specific
- `P*` / `P2`: Minor polish
