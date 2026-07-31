#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SMOKE="$ROOT/.github/workflows/scripts/smoke/line02-android-cancel-realmachine-smoke.sh"

grep -Fq 'am start -W -n "$AGENT_PACKAGE/$AGENT_ACTIVITY"' "$SMOKE"
if grep -Fq 'am startservice -n com.zenithjoy.agent/.AgentService' "$SMOKE"; then
  echo "FAIL: shell must not bypass the non-exported AgentService"
  exit 1
fi

echo "PASS: Android cancel smoke starts through exported MainActivity"
