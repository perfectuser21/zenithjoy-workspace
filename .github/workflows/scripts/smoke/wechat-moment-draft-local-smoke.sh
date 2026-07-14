#!/usr/bin/env bash
# CI-CAPABLE: line-a
# wechat-moment-draft-local-smoke.sh — Path4 朋友圈草稿去飞书改本地 smoke
#
# 覆盖决策 19e6480c：generateMomentDraft 营销画像数据源从飞书 Bitable 切到本地
# zenithjoy.wechat_marketing_profile 表，POST /api/wechat/scheduler-tick 端到端验证：
#   [1] zenithjoy.wechat_marketing_profile 表存在
#   [2] 本地画像存在 → scheduler-tick 生成成功，wechat_publish_task 落库
#       type='moment' + tenant_id 正确（回归守卫：曾经 tenant_id 漏写导致落 NULL，决策19e6480c review 修复）
#   [3] 本地画像不存在的客户 → skipped，reason=profile_missing，不落库
set -euo pipefail

API="${ZJ_API:-http://localhost:5200}"
DB="${DATABASE_NAME:-cecelia}"
DBUSER="${DATABASE_USER:-postgres}"
PASS=0
FAIL=0

assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected $2, got $1)"; FAIL=$((FAIL+1)); fi
}

DB_REACHABLE=0
if psql -U "$DBUSER" -d "$DB" -c '\q' 2>/dev/null; then
  DB_REACHABLE=1
fi

echo "=== [1] zenithjoy.wechat_marketing_profile 表存在 ==="
if [ "$DB_REACHABLE" -eq 0 ]; then
  echo "  SKIP: DB at $DB not reachable"
else
  HAS_TABLE=$(psql -U "$DBUSER" -d "$DB" -tA -c "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='wechat_marketing_profile')" 2>/dev/null)
  assert "$HAS_TABLE" "t" "zenithjoy.wechat_marketing_profile 存在"
fi

API_REACHABLE=0
if curl -s --max-time 2 -o /dev/null "$API/health" 2>/dev/null; then
  API_REACHABLE=1
fi

TENANT_ID="00000000-0000-0000-0000-0000000004a4"
CUSTOMER_WITH_PROFILE="smoke_moment_客户_有画像"
CUSTOMER_NO_PROFILE="smoke_moment_客户_无画像"

echo ""
echo "=== [2] 本地画像存在 → scheduler-tick 生成成功 + wechat_publish_task 落库 tenant_id 正确 ==="
if [ "$DB_REACHABLE" -eq 0 ] || [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: DB($DB_REACHABLE) 或 API($API_REACHABLE) 不可达"
else
  psql -U "$DBUSER" -d "$DB" -c "DELETE FROM zenithjoy.wechat_publish_task WHERE target_user IN ('$CUSTOMER_WITH_PROFILE','$CUSTOMER_NO_PROFILE')" >/dev/null 2>&1 || true
  psql -U "$DBUSER" -d "$DB" -c "DELETE FROM zenithjoy.wechat_marketing_profile WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
  psql -U "$DBUSER" -d "$DB" -c "INSERT INTO zenithjoy.wechat_marketing_profile (tenant_id, customer, industry, audience, hook) VALUES ('$TENANT_ID', '$CUSTOMER_WITH_PROFILE', '教育', '家长', '不打骂也能让孩子主动写作业')" >/dev/null 2>&1

  RESP=$(curl -s --max-time 10 -X POST "$API/api/wechat/scheduler-tick" \
    -H "Content-Type: application/json" \
    -d "{\"tenant_id\":\"$TENANT_ID\",\"customer\":\"$CUSTOMER_WITH_PROFILE\"}")
  GENERATED=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('generated',0))" 2>/dev/null || echo "0")
  assert "$GENERATED" "1" "scheduler-tick generated=1"

  ROW_TENANT=$(psql -U "$DBUSER" -d "$DB" -tA -c "SELECT tenant_id FROM zenithjoy.wechat_publish_task WHERE target_user='$CUSTOMER_WITH_PROFILE' AND type='moment' ORDER BY created_at DESC LIMIT 1" 2>/dev/null)
  assert "$ROW_TENANT" "$TENANT_ID" "wechat_publish_task.tenant_id 非 NULL 且等于调用方 tenant_id（回归守卫）"
fi

echo ""
echo "=== [3] 本地画像不存在 → skipped profile_missing，不落库 ==="
if [ "$DB_REACHABLE" -eq 0 ] || [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: DB($DB_REACHABLE) 或 API($API_REACHABLE) 不可达"
else
  RESP=$(curl -s --max-time 10 -X POST "$API/api/wechat/scheduler-tick" \
    -H "Content-Type: application/json" \
    -d "{\"tenant_id\":\"$TENANT_ID\",\"customer\":\"$CUSTOMER_NO_PROFILE\"}")
  REASON=$(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('skipped',[{}])[0].get('reason','') if d.get('skipped') else '')" 2>/dev/null || echo "")
  assert "$REASON" "profile_missing" "无画像客户 skipped reason=profile_missing"

  ROW_COUNT=$(psql -U "$DBUSER" -d "$DB" -tA -c "SELECT COUNT(*) FROM zenithjoy.wechat_publish_task WHERE target_user='$CUSTOMER_NO_PROFILE'" 2>/dev/null)
  assert "$ROW_COUNT" "0" "无画像客户不落 wechat_publish_task"

  psql -U "$DBUSER" -d "$DB" -c "DELETE FROM zenithjoy.wechat_publish_task WHERE target_user='$CUSTOMER_WITH_PROFILE'" >/dev/null 2>&1 || true
  psql -U "$DBUSER" -d "$DB" -c "DELETE FROM zenithjoy.wechat_marketing_profile WHERE tenant_id='$TENANT_ID'" >/dev/null 2>&1 || true
fi

echo ""
echo "Smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
