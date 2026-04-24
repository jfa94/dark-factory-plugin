#!/usr/bin/env bash
# Assert that the resume-protocol doc instructs the orchestrator to run a preflight
# scan and halt on tier-2/3 issues.
set -euo pipefail
pass=0
fail=0
doc="$(cd "$(dirname "$0")/../.." && pwd)/skills/pipeline-orchestrator/reference/resume-protocol.md"
if grep -q "pipeline-rescue-scan" "$doc"; then
  echo "  PASS: resume-protocol mentions pipeline-rescue-scan"
  pass=$((pass + 1))
else
  echo "  FAIL: resume-protocol missing pipeline-rescue-scan"
  fail=$((fail + 1))
fi
if grep -q "/factory:rescue" "$doc"; then
  echo "  PASS: resume-protocol mentions /factory:rescue handoff"
  pass=$((pass + 1))
else
  echo "  FAIL: resume-protocol missing rescue handoff"
  fail=$((fail + 1))
fi
echo "Passed: $pass | Failed: $fail"
[[ $fail -eq 0 ]]
