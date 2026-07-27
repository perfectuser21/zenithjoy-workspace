#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT/sprints/07232240-setup-reset-pack-gap/e2e-verify.ps1"

test -f "$SCRIPT"
grep -Fq 'zenithjoy-agent-v2.0.89.tar.gz' "$SCRIPT"
grep -Fq 'Export-ScheduledTask' "$SCRIPT"
grep -Fq 'Register-ScheduledTask' "$SCRIPT"
grep -Fq 'try {' "$SCRIPT"
grep -Fq 'finally {' "$SCRIPT"
grep -Fq 'ZENITHJOY_ENV' "$SCRIPT"
grep -Fq 'staging' "$SCRIPT"
grep -Fq 'ZENITHJOY_AGENT_REAL_PUBLISH' "$SCRIPT"
grep -Fq 'setup-reset.log' "$SCRIPT"
grep -Fq '[setup-reset] done' "$SCRIPT"
grep -Fq 'preflight.py' "$SCRIPT"
grep -Fq -- '--dry-run' "$SCRIPT"
grep -Fq 'taskkill.exe' "$SCRIPT"
grep -Fq 'Start-ScheduledTask' "$SCRIPT"
! grep -Eq 'Write-(Host|Output).*(LICENSE|\.env)' "$SCRIPT"

echo "e2e-verify contract: PASS"
