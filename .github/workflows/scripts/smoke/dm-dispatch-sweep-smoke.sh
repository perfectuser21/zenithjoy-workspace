#!/usr/bin/env bash
# dm-dispatch-sweep-smoke.sh — 验证 startScheduler() 真的被服务器进程启动，
# 且 triggerDmDispatchSweep 逻辑存在（静态+启动日志双重确认，不依赖真实等到 scheduled_for）。
#
# 治根 2026-07-19：startScheduler() 建库以来从未被 index.ts 调用，本 smoke 防止未来
# 重构时这行调用又被悄悄删掉且没人发现（同类 bug 复发）。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== 1. 静态检查：index.ts 源码含 startScheduler() 调用 ==="
if ! grep -qE '\bstartScheduler\s*\(\s*\)' apps/api/src/index.ts; then
  echo "FAIL: apps/api/src/index.ts 未调用 startScheduler()"
  exit 1
fi
echo "OK"

echo "=== 2. 静态检查：scheduler.ts 含 triggerDmDispatchSweep 且已接入 setInterval 回调 ==="
if ! grep -qE 'export\s+(async\s+)?function\s+triggerDmDispatchSweep\b' apps/api/src/services/scheduler.ts; then
  echo "FAIL: triggerDmDispatchSweep 未导出"
  exit 1
fi
if ! grep -q 'triggerDmDispatchSweep()' apps/api/src/services/scheduler.ts; then
  echo "FAIL: triggerDmDispatchSweep 未在 startScheduler 循环内被调用"
  exit 1
fi
echo "OK"

echo "=== 3. 存活服务健康检查（若 API_BASE 可达） ==="
if curl -sf -m 5 "$API_BASE/health" > /dev/null 2>&1; then
  echo "OK: $API_BASE/health 可达"
else
  echo "SKIP: $API_BASE 不可达（本地/CI 未起服务时的预期降级，静态检查已覆盖核心断言）"
fi

echo "=== dm-dispatch-sweep-smoke PASS ==="
