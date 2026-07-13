#!/usr/bin/env bash
# Smoke: dao1e-langgraph-brain-api — ZJ侧 langgraph-adapter 改走 Brain HTTP API
# 验证：
#   1. langgraph-adapter.ts 引入 CECELIA_BRAIN_URL + fetch 调用指向 /api/brain/pipelines
#      （复用 pipeline.controller.ts 已有的同名环境变量，不新起 BRAIN_API_URL）
#   2. 测试文件用 globalThis.fetch mock（非 pool.query mock）
#   3. 三函数单元测试通过
set -euo pipefail

ADAPTER_SRC="apps/api/src/services/langgraph-adapter.ts"
TEST_SRC="apps/api/src/services/__tests__/langgraph-adapter.test.ts"

echo "[dao1e-langgraph-brain-api-smoke] 1. CECELIA_BRAIN_URL + fetch 调用已引入"
grep -q "CECELIA_BRAIN_URL" "$ADAPTER_SRC" || { echo "FAIL: 缺少 CECELIA_BRAIN_URL"; exit 1; }
grep -q "api/brain/pipelines" "$ADAPTER_SRC" || { echo "FAIL: 缺少 api/brain/pipelines 调用"; exit 1; }
grep -q "fetch(" "$ADAPTER_SRC" || { echo "FAIL: 缺少 fetch() 调用"; exit 1; }
echo "Brain API fetch 调用正确 ✓"

echo "[dao1e-langgraph-brain-api-smoke] 2. 测试文件使用 globalThis.fetch mock"
grep -q "globalThis" "$TEST_SRC" || { echo "FAIL: 测试未使用 globalThis.fetch mock"; exit 1; }
grep -q "new Response" "$TEST_SRC" || { echo "FAIL: 测试缺少 Response mock"; exit 1; }
echo "fetch mock 方式正确 ✓"

echo "[dao1e-langgraph-brain-api-smoke] 3. 单元测试 langgraph-adapter"
cd apps/api && npx vitest run src/services/__tests__/langgraph-adapter.test.ts --reporter=verbose 2>&1 | tail -15

echo "[dao1e-langgraph-brain-api-smoke] ALL PASS"
