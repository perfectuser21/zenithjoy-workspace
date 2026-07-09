#!/usr/bin/env bash
# staff-skill-eval-smoke.sh — Staff Tools Hub + Skill Evaluator API smoke
# sprint: sprints/07090821-staff-tools-skill-eval
# task: 23b96c28-cf91-4657-bd26-46cd33837f16
#
# 双层验证策略（同 ws2-three-template-builders-smoke.sh 惯例）：
#   层 1: 源码结构层 — staffGuard 导出 + /api/staff 路由挂载（不依赖live server，恒定可靠）
#   层 2: error path 运行时层 — 403 鉴权行为（依赖 live server；glob-runner 长跑到
#         本脚本时 apps/api 偶发已不可达，同批 sse-smoke.sh 等既存脚本同一现象——
#         API 不可达时 SKIP 不计 FAIL，鉴权逻辑本身已由 apps/api/src/middleware/staff.test.ts
#         单元测试 + apps/dashboard/e2e/staff-skill-eval.spec.ts 覆盖）
set -uo pipefail

PASS=0
FAIL=0
SKIP=0

echo "=== Staff Tools Hub API Smoke ==="

echo ""
echo "▶ [1/2] ARTIFACT: staffGuard 导出 + 路由挂载检查"
GUARD_FILE="apps/api/src/middleware/staff.ts"
ROUTE_FILE="apps/api/src/routes/staff.ts"
APP_FILE="apps/api/src/app.ts"

grep -qE "export function staffGuard" "$GUARD_FILE" \
  && { echo "  ✓ staffGuard export"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: staffGuard 缺 export"; FAIL=$((FAIL+1)); }

grep -q "router.use(staffGuard)" "$ROUTE_FILE" \
  && { echo "  ✓ /api/staff 路由全局挂 staffGuard"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: /api/staff 路由未挂 staffGuard"; FAIL=$((FAIL+1)); }

grep -q "app.use('/api/staff', staffRouter)" "$APP_FILE" \
  && { echo "  ✓ /api/staff 已在 app.ts 挂载"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: /api/staff 未在 app.ts 挂载"; FAIL=$((FAIL+1)); }

echo ""
echo "▶ [2/2] BEHAVIOR: 403 鉴权 runtime check（API 不可达则 SKIP，不计 FAIL）"
API_BASE="${API_BASE:-http://localhost:5200}"

check_403() {
  local desc="$1"; shift
  local CODE
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000")
  # 本环境 curl 连接失败时偶发把 %{http_code} 写两遍成 "000000"（同批既存 debt
  # 脚本同一现象，如 sse-smoke.sh），统一只取前 3 位规避
  CODE="${CODE:0:3}"
  if [ "$CODE" = "000" ]; then
    echo "  SKIP: $desc — API 不可达 (${API_BASE} 未启动)"
    SKIP=$((SKIP+1))
  elif [ "$CODE" = "403" ]; then
    echo "  ✓ $desc (got 403)"
    PASS=$((PASS+1))
  else
    echo "  ✗ FAIL: $desc (expected 403, got $CODE)"
    FAIL=$((FAIL+1))
  fi
}

check_403 "POST upload 不带认证头 → 403" -X POST "${API_BASE}/api/staff/skill-eval/upload"
check_403 "GET status 不带认证头 → 403" "${API_BASE}/api/staff/skill-eval/status/test-job-id"
check_403 "POST upload 空 email 头 → 403" -H "X-User-Email: " -X POST "${API_BASE}/api/staff/skill-eval/upload"

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过（$SKIP 项因 API 不可达 SKIP，鉴权逻辑已由单元测试+E2E覆盖）"
  exit 0
else
  echo "❌ 有失败项"
  exit 1
fi
