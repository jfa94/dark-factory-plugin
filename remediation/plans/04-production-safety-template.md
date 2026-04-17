# Plan 04 — Production Safety Template

**Priority:** P0 (blocker — autonomous mode ships with one hook; the original pipeline has ten-plus)
**Tasks:** `task_04_01` through `task_04_03`
**Findings:** C6, S5

## Problem

`templates/settings.autonomous.json` in the plugin contains a single `PreToolUse` hook entry (`branch-protection.sh`) and no `permissions.deny` list. The original `~/Projects/dark-factory/templates/settings.autonomous.json` ships with a full safety net:

- **8 PreToolUse hooks** — branch protection, force-push guard, env/migrations guard, rm-guard, git-push audit, npm-run approval, gh-release guard, secret-scan
- **3 PostToolUse hooks** — run-tracker, stop-gate, cost-tracker
- **1 Stop hook** — session-end cleanup
- **A `permissions.deny` list** with ~50 entries blocking destructive Bash patterns (`rm -rf /*`, `git push --force`, `DROP TABLE*`, `--no-verify` variants, etc.)
- **A `permissions.allow` allowlist** scoped to `Bash(pipeline-*)`, `Bash(git *)`, `Bash(gh *)`, `Bash(jq *)` etc.

An autonomous run using the plugin's current template has ~10% of that safety net active. A single prompt-injected Bash command (e.g. via a malicious PRD body that lands in a prompt) could wipe the working tree or push to main.

Secondary issue: `hooks/hooks.json` uses bare relative paths (e.g. `hooks/branch-protection.sh`). These resolve correctly when the plugin is activated through Claude Code's plugin loader, which sets the CWD to the plugin root. But when a user passes the plugin's settings file via `claude --settings <absolute-path>` — which `commands/run.md` currently instructs them to do — the CWD is **the repo under test**, not the plugin root, and every hook script fails to resolve. The documented convention in `~/.claude/plugins/marketplaces/claude-plugins-official/` plugins is `${CLAUDE_PLUGIN_ROOT}/hooks/<script>`.

## Scope

In:

- Port the full hook set and deny/allow lists from `~/Projects/dark-factory/templates/settings.autonomous.json` into the plugin template (C6)
- Rewrite all paths to use `${CLAUDE_PLUGIN_ROOT}` (S5)
- Fix `hooks/hooks.json` the same way
- Add runtime materialization in `commands/run.md` so the orchestrator hands Claude Code a settings file with absolute paths (works regardless of whether the plugin is activated)

Out:

- Individual hook script bug fixes (plan 09)
- Missing hook script implementations (plan 09 creates stubs for any that don't exist yet)
- Settings schema key alignment with `plugin.json` config (plan 08)

## Tasks

| task_id    | Title                                                                         |
| ---------- | ----------------------------------------------------------------------------- |
| task_04_01 | Port full safety hook set + deny list to `templates/settings.autonomous.json` |
| task_04_02 | Rewrite `hooks/hooks.json` to use `${CLAUDE_PLUGIN_ROOT}`                     |
| task_04_03 | Materialize absolute-path settings file in `commands/run.md`                  |

See `remediation/tasks.json` for full `acceptance_criteria` and `tests_to_write`.

## Execution Guidance

### task_04_01 — Port full template

File: `templates/settings.autonomous.json`

Read `~/Projects/dark-factory/templates/settings.autonomous.json` as the canonical source.

Structure to replicate:

```json
{
  "env": {
    "FACTORY_AUTONOMOUS_MODE": "1",
    "FACTORY_HOOK_LOG": "${CLAUDE_PLUGIN_DATA}/hooks.log"
  },
  "permissions": {
    "allow": [
      "Bash(pipeline-*)",
      "Bash(git status)",
      "Bash(git diff*)",
      "Bash(git log*)",
      "Bash(git show*)",
      "Bash(git branch*)",
      "Bash(git checkout*)",
      "Bash(git add*)",
      "Bash(git commit*)",
      "Bash(git push origin staging/*)",
      "Bash(git push origin task/*)",
      "Bash(git fetch*)",
      "Bash(git merge --ff-only*)",
      "Bash(gh pr *)",
      "Bash(gh issue *)",
      "Bash(gh api*)",
      "Bash(gh auth status)",
      "Bash(jq *)",
      "Bash(node --check *)",
      "Bash(npm run *)",
      "Bash(pnpm run *)",
      "Read(*)",
      "Grep(*)",
      "Glob(*)",
      "Edit(*)",
      "Write(*)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(rm -rf /*)",
      "Bash(rm -rf ~)",
      "Bash(rm -rf ~/*)",
      "Bash(rm -rf $HOME*)",
      "Bash(git push --force*)",
      "Bash(git push -f*)",
      "Bash(git push *--force*)",
      "Bash(git push origin main*)",
      "Bash(git push origin master*)",
      "Bash(git push origin develop*)",
      "Bash(git reset --hard origin/main*)",
      "Bash(git reset --hard origin/master*)",
      "Bash(git reset --hard origin/develop*)",
      "Bash(git branch -D main*)",
      "Bash(git branch -D master*)",
      "Bash(git branch -D develop*)",
      "Bash(git checkout main)",
      "Bash(git checkout master)",
      "Bash(git checkout develop)",
      "Bash(*--no-verify*)",
      "Bash(*--no-gpg-sign*)",
      "Bash(DROP TABLE*)",
      "Bash(TRUNCATE*)",
      "Bash(DELETE FROM*WHERE 1*)",
      "Bash(chmod -R 777*)",
      "Bash(sudo *)",
      "Bash(npm publish*)",
      "Bash(pnpm publish*)",
      "Bash(gh release delete*)",
      "Bash(gh repo delete*)",
      "Write(.env)",
      "Write(.env.*)",
      "Write(**/secrets/**)",
      "Write(**/migrations/**)",
      "Edit(.env)",
      "Edit(.env.*)",
      "Edit(**/migrations/**)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/branch-protection.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/force-push-guard.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/env-migrations-guard.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/rm-guard.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/git-push-audit.sh",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/secret-scan.sh",
            "timeout": 5000
          }
        ]
      },
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/env-migrations-guard.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/run-tracker.sh",
            "timeout": 10000
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/stop-gate.sh",
            "timeout": 5000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop-gate.sh",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

Critical rules when porting:

- Every hook command uses `${CLAUDE_PLUGIN_ROOT}` — the materialization step in task_04_03 substitutes this at runtime.
- Keep the deny list **broader than strictly needed**. It is cheap to add a blocked pattern; it is expensive to recover from a missed one.
- Merge the plugin's existing `env` keys (if any) rather than overwriting.
- Write-guard on `.env*` and `**/migrations/**` appears in both `permissions.deny` and as a PreToolUse hook matcher — defense in depth.
- Do not add an allow for `Bash(rm*)`. Let `rm-guard.sh` gate individual calls.
- If a hook script doesn't exist yet (e.g. `force-push-guard.sh`), create a minimal stub in plan 09 that `exit 0`s with a TODO log line. The template can reference it now; the real implementation lands in plan 09.

Tests in `bin/test-phase9.sh`:

1. `jq -e '.hooks.PreToolUse | length >= 2' templates/settings.autonomous.json` → true
2. `jq -e '[.hooks.PreToolUse[].hooks[]] | length >= 6' templates/settings.autonomous.json` → true (≥6 Bash PreToolUse hooks)
3. `jq -e '.permissions.deny | length >= 20' templates/settings.autonomous.json` → true
4. `jq -e '.permissions.allow[] | select(. == "Bash(pipeline-*)")' templates/settings.autonomous.json` → non-empty
5. `jq -e '[.hooks.PreToolUse[].hooks[].command] | all(startswith("${CLAUDE_PLUGIN_ROOT}"))' templates/settings.autonomous.json` → true
6. Deny list blocks `Bash(git push --force*)`, `Bash(*--no-verify*)`, `Write(.env)` at minimum.

### task_04_02 — Fix hooks/hooks.json

File: `hooks/hooks.json`

Every `command` field currently starts with `hooks/` (a relative path). Rewrite to `${CLAUDE_PLUGIN_ROOT}/hooks/`.

Before:

```json
{ "type": "command", "command": "hooks/branch-protection.sh" }
```

After:

```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/branch-protection.sh"
}
```

Apply to every hook entry in the file. This is the file Claude Code reads when the plugin is activated normally; fixing it removes a latent bug for users who load the plugin outside the marketplace path.

Test in `bin/test-phase9.sh`:

- `jq -e '[.. | .command? // empty] | all(startswith("${CLAUDE_PLUGIN_ROOT}"))' hooks/hooks.json` → true

### task_04_03 — Runtime materialization in commands/run.md

File: `commands/run.md`

Add a setup step that runs before the orchestrator is spawned. It materializes an absolute-path version of the template into a location Claude Code can load.

Add this block near the top of the command body, after any "## Prerequisites" section:

````markdown
## Step 0 — Materialize autonomous settings

The plugin's `templates/settings.autonomous.json` uses `${CLAUDE_PLUGIN_ROOT}` placeholders so it works when the plugin is activated. For the `claude --settings <file>` launch path we need an absolute-path version.

Run this once per session:

```bash
plugin_root="$(dirname "$(dirname "$(command -v pipeline-state)")")"
data_dir="${CLAUDE_PLUGIN_DATA:-$HOME/.local/share/dark-factory}"
mkdir -p "$data_dir"

jq --arg root "$plugin_root" '
  walk(
    if type == "object" and has("command") and (.command | type == "string")
    then .command |= gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root)
    else . end
  )
' "$plugin_root/templates/settings.autonomous.json" \
  > "$data_dir/merged-settings.json"

echo "Materialized settings at: $data_dir/merged-settings.json"
```

Then relaunch Claude Code in autonomous mode:

```bash
claude --settings "$data_dir/merged-settings.json" --continue
```
````

Notes:

- The `walk()` + `gsub()` approach handles arbitrary nesting, not just `PreToolUse[0].hooks[0]`. Future hooks added to the template don't need a matching jq path update.
- `$plugin_root` is derived from `$(command -v pipeline-state)` because the plugin's `bin/` is on PATH when the command is running.
- `$CLAUDE_PLUGIN_DATA` is the canonical location for plugin-writable state; falling back to `~/.local/share/dark-factory` keeps the command functional for users who invoke it outside the plugin loader.
- `--continue` preserves the current session's conversation state — the orchestrator lives across the relaunch.

Test in `bin/test-phase9.sh`:

1. Grep `commands/run.md` for the `jq --arg root` block — present.
2. Grep for `walk(` in the materialization snippet — present (verifies we use the robust substitution, not a hardcoded path).
3. Grep for `$data_dir/merged-settings.json` in the final `claude --settings` invocation — present.

## Verification

1. `bash bin/test-phase9.sh` — all new template/hooks assertions pass.
2. Manual dry-run:
   ```bash
   plugin_root="$PWD"
   jq --arg root "$plugin_root" 'walk(if type=="object" and has("command") then .command |= gsub("\\$\\{CLAUDE_PLUGIN_ROOT\\}"; $root) else . end)' templates/settings.autonomous.json | jq '.hooks.PreToolUse[0].hooks[0].command'
   ```
   Expected: a fully qualified `/Users/Javier/Projects/dark-factory-plugin/hooks/branch-protection.sh` path (no `${...}` literals).
3. `grep -c '${CLAUDE_PLUGIN_ROOT}' hooks/hooks.json` — matches the number of hook scripts referenced.
4. `jq '.permissions.deny | length' templates/settings.autonomous.json` — at least 20.
5. Diff against `~/Projects/dark-factory/templates/settings.autonomous.json` — deny list is a superset or equivalent; no safety regression from the old pipeline.
