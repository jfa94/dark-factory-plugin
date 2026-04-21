# spec-generator prompt template

Canonical invocation wrapper for the `spec-generator` agent. The agent's own card (`agents/spec-generator.md`) defines role, skill bindings, and the Handoff Protocol; this template frames the per-run invocation.

## Your job

Convert the PRD into `<spec-dir>/spec.md` + `<spec-dir>/tasks.json`, validate, obtain spec-reviewer approval, execute the Handoff Protocol.

## Inputs

- `run_id`
- `issue_number` + full PRD body + issue metadata
- `spec_dir` — relative path inside the ephemeral worktree (typically `.state/<run_id>/`)

## Execution

Follow `skills/prd-to-spec/SKILL.md`. **Skip "quiz the user" — you are autonomous.** Record assumptions in a "Decisions & Assumptions" section of `spec.md`.

After writing spec.md + tasks.json:

1. `pipeline-validate-spec <spec-dir>` — max 5 validation retries.
2. Spawn `spec-reviewer` via Agent. Min score 54/60. Max 5 review iterations.
3. On exhaustion: `pipeline-gh-comment <issue> spec-failure --data '{"reason":"..."}'` and exit.

## Handoff Protocol

Mandatory last step. See `agents/spec-generator.md` §Handoff Protocol. Write `.spec.handoff_branch`, `.spec.handoff_ref`, `.spec.path` via `pipeline-state`. Without this, the spec never reaches the orchestrator.

## Final status block

```
STATUS: DONE — spec at <spec-dir>, handoff branch spec-handoff/<run_id>
STATUS: BLOCKED — <reason>
```

`DONE_WITH_CONCERNS` and `NEEDS_CONTEXT` are not valid for spec-generator — either the spec is approved and handed off, or the agent is blocked.

## Hard rules

- Every task in tasks.json: `files` ≤ 3, `acceptance_criteria` specific + testable, `depends_on` acyclic.
- No "test everything" tests — name concrete test descriptions.
- Transient API errors (5xx, 529): exponential backoff 15s/30s/45s, max 3 retries. Non-transient: report immediately.
