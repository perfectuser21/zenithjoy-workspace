#!/usr/bin/env bash
# line04-cs-memory-smoke.sh (ZenithJoy)
# Line04 对话记忆三层后端 — feature smoke（CI 规范位置）。
#
# 真链路验收脚本由 sprint 合同产出，落在：
#   sprints/06181529-line04-cs-memory-backend/e2e/golden-path-smoke.sh
# 该脚本起真 apps/api（zenithjoy_test 库）→ curl|jq 验三层 schema + 隔离 + 缺 tenant 400
# → psql 带 5 分钟时间窗断言落库。本文件转调它（exec），保持单一事实源、不重复实现。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
SPRINT_SMOKE="$ROOT/sprints/06181529-line04-cs-memory-backend/e2e/golden-path-smoke.sh"

# 规范位置预检：sprint e2e 脚本必须存在，且本机有 npm（合同 e2e 用 npm run dev 起服务）
[ -f "$SPRINT_SMOKE" ] || { echo "FAIL: 缺 sprint e2e smoke: $SPRINT_SMOKE"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "FAIL: npm 不可用，无法起 apps/api"; exit 1; }

echo "[line04-cs-memory-smoke] 转调合同 e2e: $SPRINT_SMOKE"
exec bash "$SPRINT_SMOKE"
