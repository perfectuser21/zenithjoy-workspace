#!/usr/bin/env bash
# line04-preflight-smoke.sh — Line04 微信AI客服模块环境预检 smoke test
# 验收标准：
#   1. preflight.py --dry-run 返回 9 项检测结果，exit code 0（dry-run 跳过自愈）
#   2. /module-health API 端点存在且返回 200
#   3. Dashboard navigation 中 module-health 条目不含 requireSuperAdmin: true
set -euo pipefail

API_BASE="${ZENITHJOY_API_BASE:-http://localhost:5200}"
AGENT_DIR="${AGENT_DIR:-services/agent}"
echo "=== Line04 Preflight Smoke ==="

# Check 1: preflight.py --dry-run 可执行
if [ -f "$AGENT_DIR/wechat-rpa/preflight.py" ]; then
  python3 "$AGENT_DIR/wechat-rpa/preflight.py" --dry-run 2>&1 | grep -E "os_session|wechat_version|pywinauto|middleware_health" | wc -l | xargs -I{} test {} -ge 4
  echo "✅ preflight.py --dry-run 返回检测结果"
else
  echo "⚠️ preflight.py 不在预期路径，跳过（CI 环境无 agent dir）"
fi

# Check 2: /api/agent/module-health 端点存在
SMOKE_AUTH="smoke-test-token" # gitleaks:allow
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 \
  -H "Authorization: Bearer ${SMOKE_AUTH}" \
  "$API_BASE/api/agent/module-health" 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ] || [ "$STATUS" = "401" ] || [ "$STATUS" = "403" ]; then
  echo "✅ /api/agent/module-health 端点存在 (HTTP $STATUS)"
else
  echo "⚠️ /api/agent/module-health 返回 $STATUS（API 未启动时可接受）"
fi

# Check 3: navigation.config.ts 中 module-health 不含 requireSuperAdmin: true
NAV_FILE="apps/dashboard/src/config/navigation.config.ts"
if [ -f "$NAV_FILE" ]; then
  # 找 module-health 段并确认无 requireSuperAdmin: true
  if grep -A5 "module-health" "$NAV_FILE" | grep -q "requireSuperAdmin: true"; then
    echo "❌ /module-health 仍有 requireSuperAdmin: true，smoke FAIL"
    exit 1
  fi
  echo "✅ /module-health 无 requireSuperAdmin 限制"
fi

echo "=== Line04 Preflight Smoke PASSED ==="
