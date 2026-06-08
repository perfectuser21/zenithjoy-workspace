#!/usr/bin/env bash
# Sprint 06081603 — Dashboard 模块健康看板 smoke
#
# 验证 gamma 交付：客户机器 × Line 模块健康矩阵页面。
# 真实链路：
#   1. 页面/API client/测试文件存在
#   2. npx vitest 跑组件 BEHAVIOR 测试（mock 数据渲染状态矩阵 + reason）
#   3. 若 MODULE_HEALTH_BASE_URL 已设（API 已起），curl 校验端点契约
#
# 端到端串联在 windows_cloud Playwright（apps/dashboard/e2e）。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$ROOT"

echo "=== Sprint 06081603 — Dashboard module-health smoke ==="

# 1. 交付文件存在
test -f apps/dashboard/src/pages/ModuleHealthPage.tsx
test -f apps/dashboard/src/api/moduleHealth.api.ts
test -f apps/dashboard/src/pages/__tests__/ModuleHealthPage.test.tsx
echo "  ok: 页面 + API client + 测试文件存在"

# 2. 组件行为测试（真实渲染矩阵 + reason）
( cd apps/dashboard && npx vitest run src/pages/__tests__/ModuleHealthPage.test.tsx )
echo "  ok: ModuleHealthPage BEHAVIOR 测试通过"

# 3. 契约 smoke（可选，API 已起时校验 module-health 端点结构）
BASE_URL="${MODULE_HEALTH_BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  echo "  skip: 未设 MODULE_HEALTH_BASE_URL，跳过端点 curl"
  exit 0
fi

# 校验 URL 形态，拒绝非 http(s) 输入，避免误用/注入
if ! printf '%s' "$BASE_URL" | grep -qiE '^https?://[A-Za-z0-9._:-]+(/.*)?$'; then
  echo "::error::MODULE_HEALTH_BASE_URL 非法（需 http(s):// 开头）: $BASE_URL"
  exit 1
fi

ENDPOINT="${BASE_URL%/}/api/agent/module-health"
echo "  -> curl $ENDPOINT"
RESP="$(curl -fsS --max-time 15 "$ENDPOINT")"
printf '%s' "$RESP" | grep -q '"ok"' || { echo "::error::module-health 响应缺少 ok 字段"; exit 1; }
printf '%s' "$RESP" | grep -q '"data"' || { echo "::error::module-health 响应缺少 data 字段"; exit 1; }
echo "  ok: module-health 端点契约校验通过"
