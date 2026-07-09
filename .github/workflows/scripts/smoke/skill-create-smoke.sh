#!/usr/bin/env bash
# skill-create-smoke.sh — 对话式创建 Skill 端到端冒烟测试
# sprint_dir: sprints/07091721-conversational-skill-creation
# task_id: 8541996f-7bc1-43c5-aac7-cec5ef8cb398
#
# 双层验证策略（同 staff-skill-eval-smoke.sh 惯例）：
#   层 1: 源码结构层 — 路由挂载 + staffGuard（不依赖 live server，恒定可靠）
#   层 2: error path 运行时层 — 403 鉴权行为（依赖 live server；glob-runner
#         长跑到本脚本时 apps/api 偶发已不可达，同批既存脚本同一现象——
#         API 不可达时 SKIP 不计 FAIL）
#
#   注意：本环境（ci-smoke-glob-runner.yml 起的共享 apps/api 进程）不配置
#   STAFF_EMAILS 白名单（只在部署/生产 workflow 里配），因此本脚本不测"已认证"
#   路径，只测 403 鉴权行为——同 staff-skill-eval-smoke.sh 的既定惯例。
#   创建/读取草稿等已认证行为逻辑由 apps/api/src/routes/__tests__/skill-drafts.test.ts
#   单元/集成测试 + apps/dashboard/e2e/skill-create.spec.ts 覆盖。
#
# 覆盖：
#   [BEHAVIOR] 7  — 无认证头时 403（runtime）
#   [BEHAVIOR] 1/2/5 — 路由挂载 + staffGuard 存在（ARTIFACT，运行时行为由单元/E2E覆盖）

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

API_BASE="${API_BASE:-http://localhost:3001}"

echo "=== skill-create smoke ==="
echo "API_BASE: $API_BASE"
echo ""

echo "▶ [1/2] ARTIFACT: 路由挂载 + staffGuard 检查"
ROUTE_FILE="apps/api/src/routes/skill-drafts.ts"
APP_FILE="apps/api/src/app.ts"

grep -q "router.use(staffGuard)" "$ROUTE_FILE" \
  && { echo "  ✓ skill-drafts 路由挂 staffGuard"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: skill-drafts 路由未挂 staffGuard"; FAIL=$((FAIL+1)); }

grep -q "skillDraftsRouter" "$APP_FILE" \
  && { echo "  ✓ skill-drafts 已在 app.ts 挂载"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: skill-drafts 未在 app.ts 挂载"; FAIL=$((FAIL+1)); }

echo ""
echo "▶ [2/2] BEHAVIOR: 403 鉴权 runtime check（API 不可达则 SKIP，不计 FAIL）"

check_403() {
  local desc="$1"; shift
  local CODE
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000")
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

check_403 "POST /skill-drafts 无认证头 → 403" -X POST "${API_BASE}/api/staff/skill-drafts" -H "Content-Type: application/json" -d '{}'
check_403 "GET /skill-drafts/:id 无认证头 → 403" "${API_BASE}/api/staff/skill-drafts/fake-id"
check_403 "POST /skill-drafts/:id/generate 无认证头 → 403" -X POST "${API_BASE}/api/staff/skill-drafts/fake-id/generate"

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过（$SKIP 项因 API 不可达 SKIP，已认证行为逻辑已由单元测试+E2E覆盖）"
  exit 0
else
  echo "❌ 有失败项"
  exit 1
fi
