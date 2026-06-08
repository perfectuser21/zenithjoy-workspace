#!/usr/bin/env bash
# Smoke test (static): heartbeat 下发 modules 含 4 个 Line key（status + required_version）
# Sprint 06081603 起 modules 改 Line 命名，定义在 walking-skeleton.service.ts 的 HEARTBEAT_MODULES。
# 真链路 curl E2E 见 heartbeat-module-health-smoke.sh。
# Requires: API source code at REPO_ROOT (default: repo root)

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}"
SVC_FILE="$REPO_ROOT/apps/api/src/services/walking-skeleton.service.ts"
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

echo "=== Heartbeat Modules Smoke Test (static) ==="

check "service file exists" "$([ -f "$SVC_FILE" ] && echo true || echo false)"
check "line04-wechat-cs module present" "$(grep -q "'line04-wechat-cs'" "$SVC_FILE" && echo true || echo false)"
check "line01-publish module present" "$(grep -q "'line01-publish'" "$SVC_FILE" && echo true || echo false)"
check "line02-lead-gen module present" "$(grep -q "'line02-lead-gen'" "$SVC_FILE" && echo true || echo false)"
check "line05-video module present" "$(grep -q "'line05-video'" "$SVC_FILE" && echo true || echo false)"
check "required_version declared" "$(grep -q "required_version" "$SVC_FILE" && echo true || echo false)"
check "status 'active' used" "$(grep -q "'active'" "$SVC_FILE" && echo true || echo false)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "  ❌ heartbeat-modules smoke FAILED"
  exit 1
fi
echo "  ✅ heartbeat-modules smoke PASSED"
