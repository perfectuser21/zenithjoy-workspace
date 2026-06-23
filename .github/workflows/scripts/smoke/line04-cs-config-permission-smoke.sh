#!/bin/bash
# Line04 客服配置写接口安全闸 smoke
# Golden Path（local_api / CI 直接跑）：三个写接口挂「管理员 + 租户隔离」闸 —— 越权（member /
# 跨租户 / 无 session / 解析不出目标）一律 403/401/404 拒绝且 0 写库，deny by default。
# 8 条 [BEHAVIOR] 一次性验收（supertest + mock pg pool，断言真实 HTTP 状态码 + 写库 store 0 调用）。
set -euo pipefail

cd "$(dirname "$0")/../../../../apps/api"

echo "[smoke] Line04 客服配置写接口安全闸 — 跑 regression vitest"
npx vitest run tests/regression/line04-cs-config-permission.test.ts --reporter=basic

echo "✅ Line04 客服配置写接口安全闸 Golden Path 验证通过（越权全拒 + deny by default）"
