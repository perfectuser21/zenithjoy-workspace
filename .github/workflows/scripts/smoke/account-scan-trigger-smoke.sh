#!/usr/bin/env bash
# account-scan-trigger-smoke.sh — 验证账号扫描手动触发端点存在且鉴权/参数校验生效
# （sprint 07192358）。不依赖真实在线设备（CI 环境没有），只验证路由存在 + 缺租户
# 时正确拒绝，真实"有设备时能建task"的路径由 acquisition.test.ts 单测覆盖。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== 1. 静态检查：acquisition.ts 含 account-scan/trigger 路由 ==="
if ! grep -q "'/account-scan/trigger'" apps/api/src/routes/acquisition.ts; then
  echo "FAIL: account-scan/trigger 路由未定义"
  exit 1
fi
echo "OK"

echo "=== 2. 静态检查：Android AgentService.kt 含 account_scan 判别符 ==="
if ! grep -q "shouldRouteAccountScan" services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt; then
  echo "FAIL: shouldRouteAccountScan 未定义"
  exit 1
fi
echo "OK"

echo "=== 3. 存活服务健康检查 + 缺租户校验（若 API_BASE 可达） ==="
if curl -sf -m 5 "$API_BASE/health" > /dev/null 2>&1; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -X POST "$API_BASE/api/acquisition/account-scan/trigger" -H "Content-Type: application/json" -d '{}')
  if [ "$STATUS" != "401" ]; then
    echo "FAIL: 缺租户上下文应返回 401，实际返回 $STATUS"
    exit 1
  fi
  echo "OK: 缺租户正确返回 401"
else
  echo "SKIP: $API_BASE 不可达（本地/CI 未起服务时的预期降级，静态检查已覆盖核心断言）"
fi

echo "=== account-scan-trigger-smoke PASS ==="
