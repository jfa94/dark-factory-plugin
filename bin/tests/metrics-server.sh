#!/usr/bin/env bash
# metrics-server.sh — end-to-end smoke test for the zero-dep pipeline-metrics
# MCP server. Pipes JSON-RPC frames over stdio and asserts response shape.
set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER="$PLUGIN_ROOT/servers/pipeline-metrics/index.js"

pass=0
fail=0

assert_json_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $label"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (expected '$expected', got '$actual')"
    fail=$((fail + 1))
  fi
}

if ! command -v jq >/dev/null 2>&1; then
  echo "SKIP: jq not installed"
  exit 0
fi

TMPDB=$(mktemp "${TMPDIR:-/tmp}/metrics-test-XXXXXX.jsonl")
trap 'rm -f "$TMPDB"' EXIT

# Build an NDJSON request batch. The server responds one line per request,
# in order.
REQS=$(cat <<'REQS'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"metrics_record","arguments":{"run_id":"smoke-run","event_type":"task_start","task_id":"t1"}}}
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"metrics_record","arguments":{"run_id":"smoke-run","event_type":"quality_gate","data":{"passed":true}}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"metrics_query","arguments":{"run_id":"smoke-run"}}}
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"metrics_summary","arguments":{"run_id":"smoke-run"}}}
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"metrics_record","arguments":{"run_id":"smoke-run","event_type":"bogus_event"}}}
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"unknown_tool","arguments":{}}}
{"jsonrpc":"2.0","id":9,"method":"totally/made/up","params":{}}
REQS
)

OUT=$(printf '%s\n' "$REQS" | METRICS_DB="$TMPDB" node "$SERVER")

# One line per request; extract by id.
by_id() { printf '%s\n' "$OUT" | jq -c "select(.id==$1)"; }

INIT=$(by_id 1)
assert_json_eq "initialize protocolVersion" "2024-11-05" "$(printf '%s' "$INIT" | jq -r '.result.protocolVersion')"
assert_json_eq "initialize server name"    "pipeline-metrics" "$(printf '%s' "$INIT" | jq -r '.result.serverInfo.name')"

LIST=$(by_id 2)
assert_json_eq "tools/list count" "4" "$(printf '%s' "$LIST" | jq '.result.tools | length')"

REC1=$(by_id 3)
assert_json_eq "record #1 isError absent" "false" "$(printf '%s' "$REC1" | jq '.result.isError // false')"
assert_json_eq "record #1 recorded flag"  "true"  "$(printf '%s' "$REC1" | jq -r '.result.content[0].text | fromjson | .recorded')"

Q=$(by_id 5)
assert_json_eq "query returns 2 rows" "2" "$(printf '%s' "$Q" | jq -r '.result.content[0].text | fromjson | length')"

S=$(by_id 6)
SUMMARY=$(printf '%s' "$S" | jq -r '.result.content[0].text | fromjson')
assert_json_eq "summary total_events"        "2" "$(printf '%s' "$SUMMARY" | jq -r '.total_events')"
assert_json_eq "summary quality_gates.passed" "1" "$(printf '%s' "$SUMMARY" | jq -r '.quality_gates.passed')"

BAD=$(by_id 7)
assert_json_eq "invalid event_type isError=true" "true" "$(printf '%s' "$BAD" | jq -r '.result.isError')"
assert_json_eq "invalid event_type kind=input_validation" "input_validation" \
  "$(printf '%s' "$BAD" | jq -r '.result.content[0].text | fromjson | .kind')"

UNK_TOOL=$(by_id 8)
assert_json_eq "unknown tool isError=true" "true" "$(printf '%s' "$UNK_TOOL" | jq -r '.result.isError')"

UNK_METHOD=$(by_id 9)
assert_json_eq "unknown method error code" "-32601" "$(printf '%s' "$UNK_METHOD" | jq -r '.error.code')"

echo ""
echo "=== Results ==="
echo "  Passed: $pass"
echo "  Failed: $fail"
echo "  Total:  $((pass + fail))"

[[ $fail -eq 0 ]] && exit 0 || exit 1
