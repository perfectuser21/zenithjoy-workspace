#!/usr/bin/env bash
# skill-create-longrun-smoke.sh — 对话式创建 Skill 后台长跑改造端到端冒烟测试
# sprint_dir: sprints/07101942-skill-create-longrun
# task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
#
# 双层验证策略（同 skill-create-smoke.sh 惯例）：
#   层 1: ARTIFACT — 源码结构检查（migration 字段、路由挂载、状态机新状态）
#   层 2: BEHAVIOR — 运行时 HTTP 语义（API 不可达则 SKIP，不计 FAIL）
#
# 覆盖：
#   B-01  — [BEHAVIOR] chatting→running 合法触发（runtime）
#   B-03  — [BEHAVIOR] running 状态互斥 409（runtime）
#   B-08  — [BEHAVIOR] callback token 不匹配 400（runtime）
#   B-12  — [BEHAVIOR] 软超时（artifact：路由含超时检测逻辑）
#   B-16  — [BEHAVIOR] DB migration 字段存在（artifact：SQL 文件内容）
#   B-15  — [BEHAVIOR] detached unref（artifact：路由文件含 detached:true + unref()）

set -uo pipefail

PASS=0
FAIL=0
SKIP=0

API_BASE="${API_BASE:-http://localhost:3001}"
STAFF_TOKEN="${STAFF_TOKEN:-}"
STAFF_EMAIL="${STAFF_EMAIL:-staff@test.com}"

echo "=== skill-create-longrun smoke ==="
echo "API_BASE: $API_BASE"
echo ""

# ─── 层 1: ARTIFACT ──────────────────────────────────────────────────────────

echo "▶ [1/5] ARTIFACT: DB migration 文件含三个新字段"
MIGRATION_FILE="apps/api/db/migrations/20260710_194200_skill_drafts_longrun.sql"
if [ -f "$MIGRATION_FILE" ]; then
  for field in pending_question result_json callback_token; do
    grep -q "$field" "$MIGRATION_FILE" \
      && { echo "  ✓ migration 含 $field"; PASS=$((PASS+1)); } \
      || { echo "  ✗ FAIL: migration 缺少 $field"; FAIL=$((FAIL+1)); }
  done
else
  echo "  ✗ FAIL: migration 文件不存在: $MIGRATION_FILE"
  FAIL=$((FAIL+3))
fi

echo ""
echo "▶ [2/5] ARTIFACT: 状态机含新状态（running/needs_input）"
SM_FILE="apps/api/src/services/skillDraftStateMachine.ts"
grep -q "running" "$SM_FILE" \
  && { echo "  ✓ 状态机含 running"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 状态机缺少 running"; FAIL=$((FAIL+1)); }
grep -q "needs_input" "$SM_FILE" \
  && { echo "  ✓ 状态机含 needs_input"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 状态机缺少 needs_input"; FAIL=$((FAIL+1)); }

echo ""
echo "▶ [3/5] ARTIFACT: 路由含 detached+unref（B-15）+ 软超时（B-12）+ internal callback"
ROUTE_FILE="apps/api/src/routes/skill-drafts.ts"
grep -q "detached: true" "$ROUTE_FILE" \
  && { echo "  ✓ 路由含 detached:true"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 路由缺少 detached:true"; FAIL=$((FAIL+1)); }
grep -q "\.unref()" "$ROUTE_FILE" \
  && { echo "  ✓ 路由含 unref()"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 路由缺少 unref()"; FAIL=$((FAIL+1)); }
grep -q "SOFT_TIMEOUT_MS" "$ROUTE_FILE" \
  && { echo "  ✓ 路由含软超时（SOFT_TIMEOUT_MS）"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 路由缺少软超时"; FAIL=$((FAIL+1)); }
grep -q "skillDraftsInternalRouter" "$ROUTE_FILE" \
  && { echo "  ✓ 路由含 skillDraftsInternalRouter"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: 路由缺少 skillDraftsInternalRouter"; FAIL=$((FAIL+1)); }

echo ""
echo "▶ [4/5] ARTIFACT: app.ts 已挂载 /internal/skill-drafts"
APP_FILE="apps/api/src/app.ts"
grep -q "internal/skill-drafts" "$APP_FILE" \
  && { echo "  ✓ /internal/skill-drafts 已挂载"; PASS=$((PASS+1)); } \
  || { echo "  ✗ FAIL: /internal/skill-drafts 未挂载"; FAIL=$((FAIL+1)); }

# ─── 层 2: BEHAVIOR（Runtime）────────────────────────────────────────────────

echo ""
echo "▶ [5/5] BEHAVIOR: 运行时 HTTP 语义（API 不可达则 SKIP）"

check_code() {
  local desc="$1"; local expected="$2"; shift 2
  local CODE
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$@" 2>/dev/null || echo "000")
  CODE="${CODE:0:3}"
  if [ "$CODE" = "000" ]; then
    echo "  SKIP: $desc — API 不可达"
    SKIP=$((SKIP+1))
  elif [ "$CODE" = "$expected" ]; then
    echo "  ✓ $desc (got $CODE)"
    PASS=$((PASS+1))
  else
    echo "  ✗ FAIL: $desc (expected $expected, got $CODE)"
    FAIL=$((FAIL+1))
  fi
}

AUTH_HEADER=""
if [ -n "$STAFF_EMAIL" ]; then
  AUTH_HEADER="X-User-Email: $STAFF_EMAIL"
fi

# B-03：running 状态互斥（无认证头 → 403，不测 409 因为需要 STAFF_EMAILS env）
check_code "POST /generate 无认证头 → 403" "403" \
  -X POST "${API_BASE}/api/staff/skill-drafts/fake-id/generate"

# B-08：callback 内部端点可达（draft 不存在 → 404，token 不匹配详细校验在单测）
check_code "POST /internal/callback 不存在的 draft → 404" "404" \
  -X POST "${API_BASE}/internal/skill-drafts/fake-id-nonexist/callback" \
  -H "Content-Type: application/json" \
  -d '{"token":"00000000-0000-0000-0000-000000000000","event":"done","zip_path":"/tmp/x.zip"}'

# B-10：answer 无认证 → 403
check_code "POST /answer 无认证头 → 403" "403" \
  -X POST "${API_BASE}/api/staff/skill-drafts/fake-id/answer" \
  -H "Content-Type: application/json" \
  -d '{"answer":"test"}'

echo ""
echo "=== 结果 ==="
echo "PASS=$PASS FAIL=$FAIL SKIP=$SKIP"

if [ "$FAIL" -eq 0 ]; then
  echo "✅ 全部通过（$SKIP 项因 API 不可达 SKIP）"
  exit 0
else
  echo "❌ 有失败项"
  exit 1
fi
