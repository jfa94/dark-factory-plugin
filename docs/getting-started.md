# Getting Started

This guide walks through installing the dark-factory plugin, configuring it for your project, and running your first autonomous coding pipeline.

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

Clone the plugin into your Claude Code plugins directory:

```bash
git clone https://github.com/jfa94/dark-factory-plugin.git ~/.claude/plugins/dark-factory
```

Claude Code discovers the plugin via `~/.claude/plugins/dark-factory/.claude-plugin/plugin.json`.

To verify the plugin is registered, open Claude Code and run `/help` — you should see `/dark-factory:run`, `/dark-factory:configure`, and other `/dark-factory:*` commands listed.

## Step 2: Configure Your Project

Run the configuration command to review and adjust settings:

```
/dark-factory:configure
```

This opens an interactive settings editor. It reads your current config from `${CLAUDE_PLUGIN_DATA}/config.json` (created on first write) and falls back to plugin defaults for any unset value. On macOS, `CLAUDE_PLUGIN_DATA` is typically `~/.claude/plugin-data/dark-factory`.

Key settings to review on first setup:

| Setting            | Default | Description                   |
| ------------------ | ------- | ----------------------------- |
| `humanReviewLevel` | 1       | Human oversight level (0–4)   |
| `maxTasks`         | 20      | Circuit breaker threshold     |
| `maxParallelTasks` | 3       | Concurrent task executors     |
| `localLlm.enabled` | false   | Enable Ollama for rate limits |

**`humanReviewLevel` values:**

| Level | Name              | What happens                                                     |
| ----- | ----------------- | ---------------------------------------------------------------- |
| 0     | Full Autonomy     | Pipeline creates PR and enables auto-merge; no human touchpoints |
| 1     | PR Approval       | Pipeline creates PR; you review and merge manually (default)     |
| 2     | Review Checkpoint | You sign off on completed work before the PR is created          |
| 3     | Spec Approval     | You approve the generated spec before task execution begins      |
| 4     | Full Supervision  | You approve at every stage: spec, each task, review, and PR      |

For your first run, set `humanReviewLevel` to 3 so you can review the generated specification before any code is written. Resume after approval with `/dark-factory:run resume`.

See [Configuration](./guides/configuration.md) for the full settings reference.

## Step 3: Launch with Autonomous Settings

The pipeline requires a specific Claude Code session with safety hooks, permission allowlists, and deny-lists loaded. This is a **one-time bootstrap** — once the settings file is materialized you reuse it for every subsequent run.

### Session A — generate the settings file

Start Claude Code normally and run the pipeline command:

```
/dark-factory:run prd --issue 42
```

Because autonomous mode is not yet active, the command will:

1. Materialize `$CLAUDE_PLUGIN_DATA/merged-settings.json` (resolving all `${CLAUDE_PLUGIN_ROOT}` paths inside the template)
2. Print the relaunch command
3. Stop — it will not proceed

> **Note:** Do not pass `templates/settings.autonomous.json` directly to `claude --settings`. That file contains unresolved `${CLAUDE_PLUGIN_ROOT}` tokens and will not work until the pipeline materializes `merged-settings.json`.

### Session B — relaunch with autonomous settings

Use the path the command printed:

```bash
claude --settings $CLAUDE_PLUGIN_DATA/merged-settings.json
```

Autonomous mode enables:

- **PreToolUse hooks**: branch protection, protected-file guards, SQL safety checks, dangerous-bash pattern detection
- **PostToolUse hooks**: prettier auto-format, related-test runner, audit log to `.claude/tool-audit.jsonl`
- **Stop hook**: vitest gate before Claude exits
- **Permission allowlist/denylist**: scoped to safe pipeline operations

> **For CI or advanced use only:** Setting `DARK_FACTORY_AUTONOMOUS_MODE=1` in your environment bypasses the acknowledgment check but does **not** load the hooks or permission lists. Always use the settings file for real runs.

## Step 4: Create a PRD Issue

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

> The `prd` label is used by `/dark-factory:run discover` to find issues automatically. When using `prd` mode with `--issue`, the label is not required unless you pass `--strict`.

## Step 5: Run the Pipeline

Execute the pipeline targeting your PRD issue (from Session B):

```
/dark-factory:run prd --issue 42
```

The pipeline will:

1. Fetch the PRD from GitHub
2. Generate a spec with task decomposition
3. (If `humanReviewLevel >= 3`) Pause for your spec approval
4. Execute each task in dependency order
5. Run adversarial code review
6. Create pull requests targeting the `staging` branch

## Step 6: Monitor Progress

The pipeline logs progress to stderr. Key checkpoints:

- **Spec generated**: Review at `.state/<run-id>/spec.md`
- **Task executing**: Each task runs in an isolated git worktree
- **Review round N**: Adversarial reviewer findings
- **PR created**: Link to the pull request

To check the state of a run (macOS example path):

```bash
# $CLAUDE_PLUGIN_DATA is typically ~/.claude/plugin-data/dark-factory
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.tasks | to_entries | map({task: .key, status: .value.status})'
```

## Step 7: Resume an Interrupted Run

If the pipeline stops mid-run (network issue, rate limit, manual stop):

```
/dark-factory:run resume
```

The orchestrator reads the persisted state in `runs/current/` and continues from the first incomplete task.

## Next Steps

- Read [Running the Pipeline](./guides/running-pipeline.md) for all operating modes
- Review [Configuration](./guides/configuration.md) to tune quality gates
- Set up [Local LLM Fallback](./guides/local-llm.md) for rate-limit resilience
