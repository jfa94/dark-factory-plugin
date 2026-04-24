#!/usr/bin/env bash
# run-wrapper.sh — bin/pipeline-run-task stage-machine contract.
# Seeds a run, stubs downstream scripts + gh, walks preflight → postexec →
# postreview → ship for hyphenated task ids, plus finalize-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN_DIR="$REPO_ROOT/bin"
ROOT_TMP="$(mktemp -d "${TMPDIR:-/tmp}/dark-factory-run-wrapper.XXXXXX")"
STUB_DIR="$ROOT_TMP/stubs"
mkdir -p "$STUB_DIR"
trap 'rm -rf "$ROOT_TMP"' EXIT INT TERM

export PATH="$STUB_DIR:$BIN_DIR:$PATH"

passed=0
failed=0
current=""

pass() { passed=$((passed+1)); printf '  PASS [%s] %s\n' "$current" "$1"; }
fail() { failed=$((failed+1)); printf '  FAIL [%s] %s\n' "$current" "$1"; }
assert_eq() {
  local desc="$1" want="$2" got="$3"
  if [[ "$want" == "$got" ]]; then pass "$desc"
  else fail "$desc (want=$want got=$got)"; fi
}

stage_of()  { pipeline-state task-read "$RUN_ID" alpha-001 stage 2>/dev/null; }
field_of()  { pipeline-state task-read "$RUN_ID" alpha-001 "$1" 2>/dev/null; }
status_of() { pipeline-state read "$RUN_ID" .tasks.alpha-001.status 2>/dev/null; }

# --- stubs -----------------------------------------------------------------
write_stub() {
  local name="$1"; shift
  printf '#!/usr/bin/env bash\n%s\n' "$*" > "$STUB_DIR/$name"
  chmod +x "$STUB_DIR/$name"
}

write_stub pipeline-quota-check 'cat <<EOF
{"detection_method":"stub",
 "five_hour":{"utilization":10,"over_threshold":false,"resets_at_epoch":0},
 "seven_day":{"utilization":5,"over_threshold":false,"resets_at_epoch":0}}
EOF'

write_stub pipeline-quality-gate 'exit 0'
write_stub pipeline-tdd-gate 'exit 0'
write_stub pipeline-coverage-gate 'exit 0'
write_stub pipeline-holdout-validate 'exit 0'
write_stub pipeline-branch 'exit 0'
write_stub pipeline-wait-pr 'echo "{\"status\":\"green\"}"; exit 0'
write_stub pipeline-cleanup 'exit 0'
write_stub pipeline-human-gate 'exit 0'
write_stub pipeline-parse-review 'cat'

write_stub pipeline-detect-reviewer '
p=$(cat "$STUB_DIR/reviewer" 2>/dev/null || echo claude)
printf "{\"reviewer\":\"%s\"}" "$p"'
echo claude > "$STUB_DIR/reviewer"

write_stub pipeline-codex-review '
echo "{\"decision\":\"APPROVE\",\"blockers\":[],\"concerns\":[]}"'

write_stub gh '
case "$1 $2" in
  "pr create") echo "https://github.com/acme/repo/pull/4242" ;;
  *) exit 0 ;;
esac'

export STUB_DIR

# --- shared setup ----------------------------------------------------------
new_run() {
  current="$1"
  local data="$ROOT_TMP/$1"
  mkdir -p "$data/runs"
  export CLAUDE_PLUGIN_DATA="$data"
  RUN_ID="run-wrapper-$1"
  pipeline-init "$RUN_ID" --issue 99 --mode prd >/dev/null
  pipeline-state write "$RUN_ID" .tasks '{
    "alpha-001":{"task_id":"alpha-001","title":"t","description":"d",
      "files":["src/a.ts"],"acceptance_criteria":["ok"],
      "tests_to_write":["t"],"depends_on":[],"status":"pending"}
  }' >/dev/null
}

run_wrapper() {
  set +e
  OUT=$(pipeline-run-task "$RUN_ID" "$@" 2>/dev/null)
  RC=$?
  set -e
}

# --- 1: preflight happy path ----------------------------------------------
new_run preflight-first
run_wrapper alpha-001 --stage preflight
assert_eq "preflight: exit 10" "10" "$RC"
assert_eq "preflight: action=spawn_agents" "spawn_agents" \
  "$(printf '%s' "$OUT" | jq -r '.action')"
assert_eq "preflight: stage_after=preexec_tests" "preexec_tests" \
  "$(printf '%s' "$OUT" | jq -r '.stage_after')"
assert_eq "preflight: 1 agent" "1" "$(printf '%s' "$OUT" | jq -r '.agents | length')"
assert_eq "preflight: agent=test-writer" "test-writer" \
  "$(printf '%s' "$OUT" | jq -r '.agents[0].subagent_type')"
prompt_file=$(printf '%s' "$OUT" | jq -r '.agents[0].prompt_file')
if [[ -f "$prompt_file" ]]; then pass "preflight: prompt file written"
else fail "preflight: prompt file missing ($prompt_file)"; fi
assert_eq "preflight: stage=preflight_done" "preflight_done" "$(stage_of)"
assert_eq "preflight: status=executing" "executing" "$(status_of)"

# --- 2: preflight idempotent rerun ----------------------------------------
current="preflight-idem"
run_wrapper alpha-001 --stage preflight
assert_eq "preflight rerun: exit 0" "0" "$RC"

# --- 3: postexec — codex path ---------------------------------------------
new_run postexec-codex
run_wrapper alpha-001 --stage preflight
wt="$ROOT_TMP/$current-wt"; mkdir -p "$wt"
pipeline-state task-write "$RUN_ID" alpha-001 worktree "\"$wt\"" >/dev/null
echo codex > "$STUB_DIR/reviewer"
run_wrapper alpha-001 --stage postexec
assert_eq "postexec codex: exit 10" "10" "$RC"
assert_eq "postexec codex: agent=implementation-reviewer" "implementation-reviewer" \
  "$(printf '%s' "$OUT" | jq -r '.agents[0].subagent_type')"
assert_eq "postexec codex: stage_after=postreview" "postreview" \
  "$(printf '%s' "$OUT" | jq -r '.stage_after')"
assert_eq "postexec codex: stage=postexec_done" "postexec_done" "$(stage_of)"
echo claude > "$STUB_DIR/reviewer"

# --- 4: postexec — claude fan-out (security tier) -------------------------
new_run postexec-claude
run_wrapper alpha-001 --stage preflight
wt="$ROOT_TMP/$current-wt"; mkdir -p "$wt"
pipeline-state task-write "$RUN_ID" alpha-001 worktree "\"$wt\"" >/dev/null
pipeline-state task-write "$RUN_ID" alpha-001 risk_tier '"security"' >/dev/null
run_wrapper alpha-001 --stage postexec
assert_eq "postexec security: exit 10" "10" "$RC"
assert_eq "postexec security: 4 reviewers" "4" \
  "$(printf '%s' "$OUT" | jq -r '.agents | length')"
assert_eq "postexec security: stage_after=postreview" "postreview" \
  "$(printf '%s' "$OUT" | jq -r '.stage_after')"

# --- 5: postreview — APPROVE ----------------------------------------------
new_run postreview-approve
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postexec_done"' >/dev/null
rf="$ROOT_TMP/$current-review.json"
echo '{"decision":"APPROVE","blockers":[],"concerns":[]}' > "$rf"
run_wrapper alpha-001 --stage postreview --review-file "$rf"
assert_eq "postreview APPROVE: exit 0" "0" "$RC"
assert_eq "postreview APPROVE: stage=postreview_done" "postreview_done" "$(stage_of)"

# --- 6: postreview — REQUEST_CHANGES retry --------------------------------
new_run postreview-changes
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postexec_done"' >/dev/null
rf="$ROOT_TMP/$current-review.json"
echo '{"decision":"REQUEST_CHANGES","blockers":["x"],"concerns":[]}' > "$rf"
run_wrapper alpha-001 --stage postreview --review-file "$rf"
assert_eq "postreview REQUEST_CHANGES: exit 10" "10" "$RC"
assert_eq "postreview REQUEST_CHANGES: attempts=1" "1" "$(field_of review_attempts)"
assert_eq "postreview REQUEST_CHANGES: stage_after=postexec" "postexec" \
  "$(printf '%s' "$OUT" | jq -r '.stage_after')"

# --- 7: postreview — NEEDS_DISCUSSION -------------------------------------
new_run postreview-discuss
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postexec_done"' >/dev/null
rf="$ROOT_TMP/$current-review.json"
echo '{"decision":"NEEDS_DISCUSSION","blockers":[],"concerns":["ambiguous"]}' > "$rf"
run_wrapper alpha-001 --stage postreview --review-file "$rf"
assert_eq "postreview NEEDS_DISCUSSION: exit 30" "30" "$RC"
assert_eq "postreview NEEDS_DISCUSSION: status=needs_human_review" "needs_human_review" "$(status_of)"

# --- 8: ship --ci-status green --------------------------------------------
new_run ship-green
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postreview_done"' >/dev/null
run_wrapper alpha-001 --stage ship --ci-status green
assert_eq "ship green: exit 0" "0" "$RC"
assert_eq "ship green: stage=ship_done" "ship_done" "$(stage_of)"
assert_eq "ship green: status=done" "done" "$(status_of)"

# --- 9: ship --ci-status red → spawn fix ----------------------------------
new_run ship-red
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postreview_done"' >/dev/null
run_wrapper alpha-001 --stage ship --ci-status red
assert_eq "ship red: exit 10" "10" "$RC"
assert_eq "ship red: ci_fix_attempts=1" "1" "$(field_of ci_fix_attempts)"
assert_eq "ship red: stage_after=ship" "ship" \
  "$(printf '%s' "$OUT" | jq -r '.stage_after')"

# --- 10: ship — PR create sync path (FACTORY_ASYNC_CI=off) ---------------
new_run ship-sync
wt="$ROOT_TMP/$current-wt"; mkdir -p "$wt"
pipeline-state task-write "$RUN_ID" alpha-001 worktree "\"$wt\"" >/dev/null
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postreview_done"' >/dev/null
set +e; FACTORY_ASYNC_CI=off pipeline-run-task "$RUN_ID" alpha-001 --stage ship >/dev/null 2>&1; RC=$?; set -e
assert_eq "ship sync: exit 0" "0" "$RC"
assert_eq "ship sync: pr_number=4242" "4242" "$(field_of pr_number)"
assert_eq "ship sync: stage=ship_done" "ship_done" "$(stage_of)"

# --- 11: finalize-run — pending blocks ------------------------------------
new_run finalize-pending
set +e; pipeline-run-task "$RUN_ID" RUN --stage finalize-run >/dev/null 2>&1; RC=$?; set -e
assert_eq "finalize-run pending: exit 3" "3" "$RC"

# --- 12: finalize-run — scribe spawn then complete -----------------------
new_run finalize-complete
pipeline-state write "$RUN_ID" .tasks.alpha-001.status '"done"' >/dev/null
run_wrapper RUN --stage finalize-run
assert_eq "finalize-run 1st: exit 10" "10" "$RC"
assert_eq "finalize-run 1st: agent=scribe" "scribe" \
  "$(printf '%s' "$OUT" | jq -r '.agents[0].subagent_type')"
pipeline-state write "$RUN_ID" .scribe.status '"done"' >/dev/null
run_wrapper RUN --stage finalize-run
assert_eq "finalize-run 2nd: exit 0" "0" "$RC"
assert_eq "finalize-run: run status=done" "done" \
  "$(pipeline-state read "$RUN_ID" .status 2>/dev/null)"

# --- 13: postreview — real parse-review contract (markdown → .verdict) ----
# Regression for the .decision/.verdict key mismatch: stub parse-review is
# removed so the wrapper shells out to the real bin/pipeline-parse-review,
# which emits {verdict:...} from a markdown review file. The wrapper MUST
# read .verdict (fallback to .decision for legacy fixtures).
rm -f "$STUB_DIR/pipeline-parse-review"
new_run postreview-real-approve
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postexec_done"' >/dev/null
rf="$ROOT_TMP/$current-review.md"
cat > "$rf" <<'MDEOF'
## Findings

## Acceptance Criteria Check

## Summary

All criteria satisfied.

## Verdict

VERDICT: APPROVE
CONFIDENCE: HIGH
BLOCKERS: 0
ROUND: 1
MDEOF
run_wrapper alpha-001 --stage postreview --review-file "$rf"
assert_eq "postreview real APPROVE: exit 0" "0" "$RC"
assert_eq "postreview real APPROVE: stage=postreview_done" "postreview_done" "$(stage_of)"

new_run postreview-real-changes
pipeline-state task-write "$RUN_ID" alpha-001 stage '"postexec_done"' >/dev/null
rf="$ROOT_TMP/$current-review.md"
cat > "$rf" <<'MDEOF'
## Findings

### [BLOCKING] Missing null check
- **File:** src/a.ts:42
- **Severity:** major
- **Category:** correctness
- **Description:** Null input crashes.
- **Suggestion:** Add guard.

## Summary

One blocker.

## Verdict

VERDICT: REQUEST_CHANGES
CONFIDENCE: HIGH
BLOCKERS: 1
ROUND: 1
MDEOF
run_wrapper alpha-001 --stage postreview --review-file "$rf"
assert_eq "postreview real REQUEST_CHANGES: exit 10" "10" "$RC"
assert_eq "postreview real REQUEST_CHANGES: attempts=1" "1" "$(field_of review_attempts)"

# Restore the stub so later tests (if added) still get the cat passthrough.
write_stub pipeline-parse-review 'cat'

# --- 14: finalize-run SHA guard — task PR not merged → exit 3 ---------------
new_run finalize-sha-guard-open
pipeline-state write "$RUN_ID" .tasks.alpha-001.status '"done"' >/dev/null
pipeline-state task-write "$RUN_ID" alpha-001 pr_number '101' >/dev/null
# gh stub returns PR state=OPEN → guard should detect not merged
write_stub gh '
case "$*" in
  "pr view 101 --json state,mergeCommit,headRefOid")
    printf '"'"'{"state":"OPEN","mergeCommit":null,"headRefOid":"abc123"}'"'"' ;;
  "pr create"*) echo "https://github.com/acme/repo/pull/4242" ;;
  *) exit 0 ;;
esac'
set +e; pipeline-run-task "$RUN_ID" RUN --stage finalize-run >/dev/null 2>&1; RC=$?; set -e
assert_eq "finalize-run sha-guard (pr open): exit 3" "3" "$RC"
# Restore default gh stub
write_stub gh '
case "$1 $2" in
  "pr create") echo "https://github.com/acme/repo/pull/4242" ;;
  *) exit 0 ;;
esac'

# --- 15: finalize-run SHA guard — all PRs merged, SHA on staging → proceeds -
new_run finalize-sha-guard-merged
pipeline-state write "$RUN_ID" .tasks.alpha-001.status '"done"' >/dev/null
pipeline-state task-write "$RUN_ID" alpha-001 pr_number '102' >/dev/null
pipeline-state write "$RUN_ID" .scribe.status '"done"' >/dev/null
# gh stub returns PR state=MERGED with a sha that git will accept
write_stub gh '
case "$*" in
  "pr view 102 --json state,mergeCommit,headRefOid")
    printf '"'"'{"state":"MERGED","mergeCommit":{"oid":"deadbeef"},"headRefOid":"deadbeef"}'"'"' ;;
  "pr create"*) echo "https://github.com/acme/repo/pull/5050" ;;
  *) exit 0 ;;
esac'
# Stub git to accept merge-base --is-ancestor check
write_stub git '
if [[ "$1 $2" == "merge-base --is-ancestor" ]]; then exit 0; fi
exec /usr/bin/git "$@"'
run_wrapper RUN --stage finalize-run
assert_eq "finalize-run sha-guard (merged): exit 0" "0" "$RC"
final_pr_url=$(pipeline-state read "$RUN_ID" '.final_pr.pr_url // ""' 2>/dev/null || printf '')
assert_eq "finalize-run sha-guard: final_pr.pr_url written" "https://github.com/acme/repo/pull/5050" "$final_pr_url"
# Restore default stubs
write_stub gh '
case "$1 $2" in
  "pr create") echo "https://github.com/acme/repo/pull/4242" ;;
  *) exit 0 ;;
esac'
rm -f "$STUB_DIR/git"

printf '\n=== RESULTS: %d passed, %d failed ===\n' "$passed" "$failed"
exit $(( failed > 0 ? 1 : 0 ))
