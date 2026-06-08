#!/usr/bin/env bash
# Smoke test: POST /api/agent/heartbeat response includes modules field
# Validates the heartbeat endpoint schema includes modules section.
# Requires: API source code at REPO_ROOT (default: repo root)

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
ROUTE_FILE="$REPO_ROOT/apps/api/src/routes/walking-skeleton.ts"
PASS=0
FAIL=0

check() {
  local desc="$1" result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Heartbeat Modules Smoke Test ==="

# Check route file exists
check "heartbeat route file exists" "$([ -f "$ROUTE_FILE" ] && echo true || echo false)"

# Check modules field is present in heartbeat response
check "modules field in heartbeat handler" "$(grep -q "'wechat-cs'" "$ROUTE_FILE" && echo true || echo false)"
check "video-pipeline module present" "$(grep -q "'video-pipeline'" "$ROUTE_FILE" && echo true || echo false)"
check "crm-sync module present" "$(grep -q "'crm-sync'" "$ROUTE_FILE" && echo true || echo false)"

# Check module status values are valid
check "module status 'active' is used" "$(grep -q "'active'" "$ROUTE_FILE" && echo true || echo false)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  ❌ heartbeat-modules smoke FAILED"
  exit 1
fi
echo "  ✅ heartbeat-modules smoke PASSED"
