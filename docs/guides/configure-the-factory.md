# How to Configure the Factory

All settings live in one schema with defaults; you override them in a sparse
overlay. Edits round-trip through the schema before they touch disk, so an invalid
value is rejected loudly and never persisted. For every key, type, and default see
the [configuration reference](../reference/configuration.md).

## Inspect the current config

Print the fully resolved config (defaults + your overlay):

```bash
factory configure
```

Read a single value by its dotted key path:

```bash
factory configure --get quality.holdoutPercent
factory configure --get git.baseBranch
```

## Change a setting

`--set` takes `key.path=value`, is repeatable, and persists once after validating
all edits. Values parse as JSON when possible (numbers, booleans, arrays),
otherwise as a bare string.

```bash
factory configure --set quality.holdoutPercent=25
factory configure --set git.baseBranch=develop
factory configure --set git.provision=true
factory configure --set 'git.developRequiredStatusChecks=["Quality","Mutation Testing","Security Scan"]'
```

Set several at once:

```bash
factory configure \
  --set quality.mutationScoreTarget=85 \
  --set quality.coverageRegressionTolerancePct=0.25
```

## Revert a setting to its default

`--unset` removes a key from the overlay so it tracks the default again
(repeatable):

```bash
factory configure --unset quality.holdoutPercent
```

Because the overlay is sparse, an unset key automatically picks up any future
change to its default.

## Common adjustments

| Goal                                                 | Command                                                                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hold back more acceptance criteria                   | `factory configure --set quality.holdoutPercent=30`                                                                                                                                              |
| Raise the mutation bar                               | `factory configure --set quality.mutationScoreTarget=90`                                                                                                                                         |
| Use a custom security scanner                        | `factory configure --set quality.securityCommand="my-sast --json"`                                                                                                                               |
| Auto-provision branch protection                     | `factory configure --set git.provision=true`                                                                                                                                                     |
| Keep develop strict at all times                     | `factory configure --set git.developProtection=permanent`                                                                                                                                        |
| Override the at-rest develop checks                  | `factory configure --set 'git.developBaselineStatusChecks=["Quality"]'`                                                                                                                          |
| Require a repo check in AND out of runs (e.g. pgTAP) | `factory configure --set 'git.developRequiredStatusChecks=["Quality","Mutation Testing","Security Scan","Database Tests"]'` — the at-rest baseline derives from this list minus Mutation Testing |
| Re-tier producer models                              | `factory configure --set quota.producerModels.high=claude-opus-4-6`                                                                                                                              |

## Notes

- `--get` cannot be combined with `--set`/`--unset`.
- Exotic test runners (Go, Ruby, Deno…) are not config: contract the gate's
  `command` in the repo's committed `.factory/gates.json` (written by
  `factory scaffold`, [Decision 46](../explanation/decisions.md#decision-46--the-gate-contract-scaffold-time-applicability-committed-and-enforced)).
- The spec apex pin (the model/effort the spec generator + reviewer run at) is
  not config — it is hard consts in `src/spec/agents.ts`, invariant by
  construction — see the [configuration reference](../reference/configuration.md).
- The trusted-compute-base write-deny is **hardcoded** in the hooks, not
  config-sourced; there is no config key to widen it.
