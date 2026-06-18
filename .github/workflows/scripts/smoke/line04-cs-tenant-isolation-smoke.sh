#!/bin/bash
# Line04 客服层多租户隔离（tenant scope）smoke
# Golden Path（local_api，evaluator/CI 直接跑）：客服读写路径按当前租户 scope，
# 缺租户上下文一律 4xx 拒绝、绝不回退全量。5 条 [BEHAVIOR] 一次性验收。
set -euo pipefail

cd "$(dirname "$0")/../../../../apps/api"

echo "[smoke] Line04 客服层多租户隔离 — 跑 regression vitest（supertest + mock pg pool，断言真实 SQL 文本+绑定参数）"
npx vitest run tests/regression/line04-cs-tenant-isolation.test.ts --reporter=basic

echo "✅ Line04 客服层多租户隔离 Golden Path 验证通过（5 条 BEHAVIOR 全绿）"
