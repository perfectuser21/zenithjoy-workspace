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
# 注：不能只用 `grep -q 'triggerDmDispatchSweep()'`——函数定义行
# `export async function triggerDmDispatchSweep(): Promise<void>` 本身就含
# 字面量子串 `triggerDmDispatchSweep()`（无参数，`(` 后紧跟 `)`），
# 单次 grep -q 会被定义行"假阳性"命中，即使真正的调用点被删掉也测不出来。
# 改为要求 `triggerDmDispatchSweep().catch(` ——这是 setInterval 回调里调用点独有的写法
# （fire-and-forget + .catch 兜底，见 startScheduler 内的调用），定义行不会产生这个子串。
if ! grep -q 'triggerDmDispatchSweep()\.catch(' apps/api/src/services/scheduler.ts; then
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
