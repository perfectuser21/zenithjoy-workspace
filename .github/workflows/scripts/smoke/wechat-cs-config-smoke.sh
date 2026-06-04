#!/usr/bin/env bash
# wechat-cs-config-smoke.sh — Path 4 Step 3 Sprint B 中台配置页冒烟（后端链路）。
#
# 验：人设/企业知识库配置的 DB 存取 + CRUD 路由 + AI 帮填 A1-A5。
# 前端页面 E2E 走 windows_cloud GHA runner 的 Playwright（apps/dashboard/e2e/），不在此 smoke。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
API="$ROOT/apps/api"

echo "[1/2] cs-config-store 单测（mock pool，DB优先+兜底）"
( cd "$API" && npx vitest run src/services/wechat/__tests__/cs-config-store.test.ts )

echo "[2/2] wechat-config 路由集成（真DB往返 + suggest-audience mock）"
( cd "$API" && npx vitest run --config vitest.integration.config.ts \
  tests/integration/p4-wechat-cs-config/wechat-config.integration.test.ts )

echo "PASS wechat-cs-config-smoke"
