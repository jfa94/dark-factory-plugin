---
description: "Scaffold a project for the dark-factory pipeline (run once per project)"
---

# /factory:scaffold

You are preparing a project to be run by the dark-factory pipeline for the first time. The pipeline refuses to start against an unscaffolded project, so this command must run before any `/factory:run` in a new repo.

## Step 1: Detect project root

Confirm the current working directory is a git repo:

```bash
git rev-parse --show-toplevel
```

Use that path as `$PROJECT_ROOT`. If the command fails, tell the user they must run `/factory:scaffold` from inside a git checkout and stop.

## Step 2: Run the scaffolder

```bash
pipeline-scaffold "$PROJECT_ROOT"
```

This creates (idempotently) the minimum set of files the pipeline expects:

- `claude-progress.json` and `feature-status.json` (progress tracking)
- `init.sh` (per-run setup hook)
- `.github/workflows/quality-gate.yml` (CI template)
- `.stryker.config.json` and `.dependency-cruiser.cjs` (quality gate configs)

Report any files that were newly created versus already present.

## Step 3: Check optional tool dependencies

Evaluate optional tools and prompt the user for each missing one. Never auto-install; ask for explicit confirmation.

### 3a. TruffleHog (optional, gated by `safety.useTruffleHog`)

Used by the `secret-commit-guard` PreToolUse hook to scan commits for secrets beyond the built-in regex set. Falls back to regex-only if absent.

```bash
command -v trufflehog || true
```

If missing, ask the user:

> TruffleHog is not installed. It provides an extra layer of secret scanning on every `git commit`. Want to install it? (y/n)

Install recipe (macOS): `brew install trufflesecurity/trufflehog/trufflehog`
Install recipe (Linux): `curl -sSfL https://raw.githubusercontent.com/trufflesecurity/trufflehog/main/scripts/install.sh | sh -s -- -b /usr/local/bin`

If the user accepts and install succeeds, enable the hook via `/factory:configure safety.useTruffleHog` (set to `true`).

### 3b. GitHub CLI (`gh`) — hard dependency

```bash
command -v gh || { echo "gh is required"; exit 1; }
```

If missing, error out with the Homebrew / apt install instructions and stop. The pipeline cannot run without `gh`.

### 3c. `jq` — hard dependency

```bash
command -v jq || { echo "jq is required"; exit 1; }
```

Same treatment as `gh`.

### 3d. GNU date (`gdate`) — optional on macOS

The pipeline's ISO 8601 parser falls back across `gdate`, `date -d`, and BSD `date -j`. Warn only if none of the three work on the current system.

## Step 4: Offer to pre-populate `safety.writeBlockedPaths`

Inspect the project for common sensitive-path patterns:

- `supabase/migrations/**` if a `supabase/` dir exists
- `.env*` if any `.env` file exists at the root
- `prisma/migrations/**` if a `prisma/` dir exists
- `terraform/**/*.tfstate` if a `.terraform/` dir exists

For each detected, ask the user if they want to add the glob to `safety.writeBlockedPaths`. If yes, run `/factory:configure safety.writeBlockedPaths` with the resulting array (the configure command handles the jq merge).

Never add defaults without explicit confirmation — the blocklist is permissive by design so the autonomous pipeline can make as many changes as possible.

## Step 5: Summary

Print a compact report:

- Files created by scaffold: [...]
- Files already present: [...]
- Optional tools installed: [...]
- Optional tools declined: [...]
- Write blocklist entries added: [...]

Remind the user:

- Run `/factory:configure` to inspect or change any setting.
- Run `/factory:run prd --issue <N>` to kick off a pipeline.
