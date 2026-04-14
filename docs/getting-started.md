# Getting Started

This guide walks through installing the dark-factory plugin, configuring it for your project, and running your first autonomous coding pipeline.

## Prerequisites

Before installing the plugin, ensure you have:

1. **Claude Code** installed and authenticated
2. **Git** with a configured remote repository
3. **GitHub CLI** (`gh`) installed and authenticated (`gh auth login`)
4. **Node.js 18+** for the metrics MCP server (optional)
5. A project with existing Claude Code agents:
   - `spec-reviewer` (required)
   - `code-reviewer` (required)
   - `prd-to-spec` skill (required)

Verify prerequisites with:

```bash
claude --version
gh auth status
git remote get-url origin
```

## Step 1: Install the Plugin

Install from the Claude Code plugin marketplace or clone manually:

```bash
# Clone to your plugins directory
git clone https://github.com/jfa94/dark-factory-plugin.git ~/.claude/plugins/dark-factory
```

## Step 2: Configure Your Project

Run the configuration command to review and adjust settings:

```
/dark-factory:configure
```

Key settings to review on first setup:

| Setting            | Default | Description                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------------------------ |
| `humanReviewLevel` | 1       | 0=full auto, 1=PR approval, 2=review checkpoint, 3=spec approval, 4=full supervision |
| `maxTasks`         | 20      | Circuit breaker threshold                                                            |
| `maxParallelTasks` | 3       | Concurrent task executors                                                            |
| `localLlm.enabled` | false   | Enable Ollama fallback for rate limiting                                             |

For your first run, consider setting `humanReviewLevel` to 3 (spec approval) to review the generated specification before task execution begins.

## Step 3: Launch with Autonomous Settings

The pipeline requires specific safety settings. Generate and launch with the correct settings file:

```bash
# First invocation will generate the settings file
claude --settings ~/.claude/plugins/dark-factory/templates/settings.autonomous.json
```

Alternatively, set the environment variable in your shell profile:

```bash
export DARK_FACTORY_AUTONOMOUS_MODE=1
```

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

## Step 5: Run the Pipeline

Execute the pipeline targeting your PRD issue:

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

To check the state of a run:

```bash
cat "${CLAUDE_PLUGIN_DATA}/runs/current/state.json" | jq '.tasks | to_entries | map({task: .key, status: .value.status})'
```

## Step 7: Resume an Interrupted Run

If the pipeline stops mid-run (network issue, rate limit, manual stop):

```
/dark-factory:run resume
```

The orchestrator reads the persisted state and continues from the first incomplete task.

## Next Steps

- Read [Running the Pipeline](./guides/running-pipeline.md) for all operating modes
- Review [Configuration](./guides/configuration.md) to tune quality gates
- Set up [Local LLM Fallback](./guides/local-llm.md) for rate-limit resilience
