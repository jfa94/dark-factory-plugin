# Getting Started

This guide walks through installing the factory plugin, configuring it for your project, and running your first autonomous coding pipeline.

## Prerequisites

Before installing the plugin, ensure you have:

1. **Claude Code** installed and authenticated
2. **Git** with a configured remote repository
3. **GitHub CLI** (`gh`) installed and authenticated (`gh auth login`)
4. **Node.js 18+** for the metrics MCP server (optional — only needed if you enable observability)

All required agents and skills (`spec-reviewer`, `code-reviewer`, `prd-to-spec`) ship with the plugin.

Verify prerequisites with:

```bash
claude --version
gh auth status
git remote get-url origin
```

## Step 1: Install the Plugin

### Marketplace install (recommended)

Inside Claude Code, run:

```
/plugin marketplace add jfa94/factory
/plugin install factory@jfa94
```

Claude Code handles cloning, discovery, and future updates automatically. Verify with `/help` — you should see `/factory:run`, `/factory:configure`, and other `/factory:*` commands listed.

### Manual install (air-gapped or offline)

If you cannot reach GitHub from your Claude Code session:

```bash
git clone https://github.com/jfa94/factory.git ~/code/factory-plugin
```

Inside Claude Code, register the cloned directory as a local marketplace and install:

```
/plugin marketplace add ~/code/factory-plugin
/plugin install factory@jfa94
```

Claude Code reads `.claude-plugin/marketplace.json` from the directory and installs the plugin into its local cache. `/help` should then list the `/factory:*` commands.

## Step 2: Configure Rate Limit Detection

The pipeline requires real-time rate limit data to make pause/continue decisions. This is captured via a statusline wrapper script.

**One-time setup:** Add to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "~/.claude/plugins/factory/bin/statusline-wrapper.sh"
  }
}
```

If you already have a custom statusline, chain to it:

```json
{
  "env": {
    "FACTORY_ORIGINAL_STATUSLINE": "~/.claude/your-statusline.sh"
  },
  "statusLine": {
    "type": "command",
    "command": "~/.claude/plugins/factory/bin/statusline-wrapper.sh"
  }
}
```

The wrapper writes rate limit data to `~/.claude/plugin-data/factory/usage-cache.json` on every statusline update. Without this, `pipeline-quota-check` will fail.

## Step 3: Configure Your Project

Run the configuration command to review and adjust settings:

```
/factory:configure
```

This opens an interactive settings editor. It reads your current config from `${CLAUDE_PLUGIN_DATA}/config.json` (created on first write) and falls back to plugin defaults for any unset value. On macOS, `CLAUDE_PLUGIN_DATA` is typically `~/.claude/plugin-data/factory`.

Key settings to review on first setup:

| Setting                  | Default | Description                                 |
| ------------------------ | ------- | ------------------------------------------- |
| `humanReviewLevel`       | 0       | Human oversight level (0–4)                 |
| `maxConsecutiveFailures` | 5       | Consecutive failures before pipeline aborts |
| `maxParallelTasks`       | 3       | Concurrent task executors                   |

**`humanReviewLevel` values:**

| Level | Name              | What happens                                                               |
| ----- | ----------------- | -------------------------------------------------------------------------- |
| 0     | Full Autonomy     | Pipeline creates PR and enables auto-merge; no human touchpoints (default) |
| 1     | PR Approval       | Pipeline creates PR; you review and merge manually                         |
| 2     | Review Checkpoint | You sign off on completed work before the PR is created                    |
| 3     | Spec Approval     | You approve the generated spec before task execution begins                |
| 4     | Full Supervision  | You approve at every stage: spec, each task, review, and PR                |

> **Level 0 (default) assumes:**
>
> - Branch protection on your default branch requires a passing CI check before merge.
> - GitHub auto-merge is enabled on the repo (Settings → General → Pull Requests → "Allow auto-merge").
> - Your CI covers the tests, linters, and type checks the plugin generates (`npm test`, `npm run lint`, etc.).
>
> If any of these are missing, set `humanReviewLevel` to 1 so you approve each PR manually. CI acts as the merge gate; the plugin will not bypass a failing check.

On your first run, you may want to temporarily set `humanReviewLevel=3` to review the generated specification before any code is written. Resume after approval with `/factory:run resume`.

See [Configuration](./guides/configuration.md) for the full settings reference.

## Step 4: Launch with Autonomous Settings

The pipeline requires a specific Claude Code session with safety hooks, permission allowlists, and deny-lists loaded. This is a **one-time bootstrap** — once the settings file is materialized you reuse it for every subsequent run.

### Session A — generate the settings file

Start Claude Code normally and run the pipeline command:

```
/factory:run prd --issue 42
```

Because autonomous mode is not yet active, the command will:

1. Materialize `$CLAUDE_PLUGIN_DATA/merged-settings.json` (resolving all `${CLAUDE_PLUGIN_ROOT}` paths inside the template)
2. Print the relaunch command
3. Stop — it will not proceed

> **Note:** Do not pass `templates/settings.autonomous.json` directly to `claude --settings`. That file contains unresolved `${CLAUDE_PLUGIN_ROOT}` tokens and will not work until the pipeline materializes `merged-settings.json`.

### Session B — relaunch with autonomous settings

#### Recommended — use the settings file

Use the path the command printed:

```bash
claude --settings $CLAUDE_PLUGIN_DATA/merged-settings.json
```

This loads:

- **PreToolUse hooks**: branch protection, protected-file guards, SQL safety checks, dangerous-bash pattern detection
- **PostToolUse hooks**: prettier auto-format, related-test runner, audit log to `.claude/tool-audit.jsonl`
- **Stop hook**: vitest gate before Claude exits
- **Permission allowlist/denylist**: scoped to safe pipeline operations

#### Advanced / CI — bypass the acknowledgment check only

Setting `FACTORY_AUTONOMOUS_MODE=1` in your environment lets `/factory:run` proceed but does **not** load the hooks or permission lists. Use this only in CI environments where equivalent guardrails are already enforced at the host level (sandboxed runner, GitHub branch protection, no production credentials on disk). For interactive runs on your own machine, always use the settings file.

> **Plugin upgrades:** `merged-settings.json` is regenerated automatically when you run `/factory:run` after a plugin upgrade — no manual action required. The new file is written to `$CLAUDE_PLUGIN_DATA/merged-settings.json`; relaunch Claude with `--settings` pointing at it to pick up the updated hooks and permissions.

## Step 5: Create a PRD Issue

Create a GitHub issue with the `prd` label describing the work you want done. The issue body should contain:

- Clear problem statement
- Acceptance criteria
- Technical constraints (if any)
- Non-goals (what not to build)

Example issue body:

```markdown
## Problem

Users cannot reset their password from the login page.

## Acceptance Criteria

- [ ] "Forgot password?" link on login page
- [ ] Email input form with validation
- [ ] Password reset email sent via SendGrid
- [ ] Reset token expires after 1 hour
- [ ] Rate limit: 3 requests per email per hour

## Non-Goals

- Do not change the existing authentication flow
- Do not add SMS-based reset
```

> The `prd` label is used by `/factory:run discover` to find issues automatically. When using `prd` mode with `--issue`, the label is not required unless you pass `--strict`.

## Step 6: Run the Pipeline

Execute the pipeline targeting your PRD issue (from Session B):

```
/factory:run prd --issue 42
```

The pipeline will:

1. Fetch the PRD from GitHub
2. Generate a spec with task decomposition
3. (If `humanReviewLevel >= 3`) Pause for your spec approval
4. Execute each task in dependency order
5. Run adversarial code review
6. Create pull requests targeting the `staging` branch

## Step 7: Monitor Progress

The pipeline logs progress to stderr. Key checkpoints:

- **Spec generated**: Review at `.state/<run-id>/spec.md`
- **Task executing**: Each task runs in an isolated git worktree
- **Review round N**: Adversarial reviewer findings
- **PR created**: Link to the pull request

To check the state of a run (macOS example path):

```bash
# $CLAUDE_PLUGIN_DATA is typically ~/.claude/plugin-data/factory
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.tasks | to_entries | map({task: .key, status: .value.status})'
```

## Step 8: Resume an Interrupted Run

If the pipeline stops mid-run (network issue, rate limit, manual stop):

```
/factory:run resume
```

The orchestrator reads the persisted state in `runs/current/` and continues from the first incomplete task.

## Next Steps

- Read [Running the Pipeline](./guides/running-pipeline.md) for all operating modes
- Review [Configuration](./guides/configuration.md) to tune quality gates
- See [Rate Limiting](./explanation/rate-limiting.md) for pause/resume behavior when approaching limits
