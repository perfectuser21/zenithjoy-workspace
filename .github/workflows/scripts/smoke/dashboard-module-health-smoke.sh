#!/usr/bin/env bash
# Sprint 06081603 — Dashboard 模块健康看板 smoke
#
# 验证 gamma 交付：客户机器 × Line 模块健康矩阵页面。
# 真实链路：
#   1. 页面/API client/测试文件存在
#   2. npx vitest 跑组件 BEHAVIOR 测试（用 mock 数据渲染 🟢/🔴/⚪ + reason）
#   3. 若 MODULE_HEALTH_BASE_URL 已设（API 已起），curl 校验 /api/agent/module-health 契约
#
# 端到端串联在 windows_cloud Playwright（apps/dashboard/e2e）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sprint 06081603 — Dashboard module-health smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. 交付文件存在
test -f apps/dashboard/src/pages/ModuleHealthPage.tsx
test -f apps/dashboard/src/api/moduleHealth.api.ts
test -f apps/dashboard/src/pages/__tests__/ModuleHealthPage.test.tsx
echo "  ✅ 页面 + API client + 测试文件存在"

# 2. 组件行为测试（真实渲染矩阵 + reason）
cd apps/dashboard
npx vitest run src/pages/__tests__/ModuleHealthPage.test.tsx
echo "  ✅ ModuleHealthPage BEHAVIOR 测试通过"
cd "$ROOT"

# 3. 契约 smoke（可选，API 已起时校验 module-health 端点结构）
if [ -n "${MODULE_HEALTH_BASE_URL:-}" ]; then
  echo "  → curl ${MODULE_HEALTH_BASE_URL}/api/agent/module-health"
  RESP="$(curl -fsS "${MODULE_HEALTH_BASE_URL}/api/agent/module-health")"
  echo "$RESP" | grep -q '"ok"' || { echo "::error::module-health 响应缺少 ok 字段"; exit 1; }
  echo "$RESP" | grep -q '"data"' || { echo "::error::module-health 响应缺少 data 字段"; exit 1; }
  echo "  ✅ module-health 端点契约校验通过"
else
  echo "  ⏭️  跳过端点 curl（未设 MODULE_HEALTH_BASE_URL）"
fi

echo ""
echo "  注：完整页面渲染 E2E 在 apps/dashboard/e2e（windows_cloud Playwright）"
