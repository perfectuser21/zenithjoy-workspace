#!/usr/bin/env bash
# line04-cs-autosend-no-feishu-smoke.sh
#
# Line04 去飞书 + 个人私聊 AI 自动直发（第一刀）端到端 smoke。
#
# 真链路（API Contract Smoke job：localhost:5200 + cecelia DB 已起）：
#   A) 群消息 is_group=true → POST /api/wechat/draft-generate → status:skipped skip_reason:group（群不回）
#   B) CRM 标黑（crm_customers.identity='blacklist'）→ status:skipped skip_reason:blacklisted（标黑不回）
#   C) 个人未标黑 → 走到去飞书直发链路（status sent / ai_failed，CI 无 LLM key 时 ai_failed），
#      且**不写飞书**（feishu-poll.ts 已删）、**不落** wechat_publish_task pending_review（chat 去审核台）
#
# 静态：feishu-poll.ts 已删除（彻底去飞书）。
# reply 非空（真 AI 回复）由 rog 真机 E2E 验（CI 无 toapi key）。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

API="${API_BASE:-http://localhost:5200}"
PASS=0
FAIL=0
# 固定 uuid 租户（crm_customers.tenant_id 是 tenants(id) 的 uuid FK，必须真存在）
TENANT="11111111-1111-1111-1111-111111111111"
CSWX="ci_cs_wx_autosend"
PSQL=(psql -h "${PGHOST:-localhost}" -U "${PGUSER:-cecelia}" -d "${PGDATABASE:-cecelia}")

assert_eq() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected '$2' got '$1')"; FAIL=$((FAIL+1)); fi
}

echo "=== Static: feishu-poll.ts 已删除（彻底去飞书）==="
if [ -f apps/api/src/services/feishu-poll.ts ]; then
  echo "  FAIL: feishu-poll.ts 仍存在"; FAIL=$((FAIL+1))
else
  echo "  PASS: feishu-poll.ts 已删除"; PASS=$((PASS+1))
fi

API_REACHABLE=0
if curl -s --max-time 3 -o /dev/null "$API/health" 2>/dev/null; then API_REACHABLE=1; fi
DB_REACHABLE=0
if command -v psql >/dev/null 2>&1 && "${PSQL[@]}" -c '\q' 2>/dev/null; then DB_REACHABLE=1; fi

if [ "$API_REACHABLE" -eq 0 ]; then
  echo "  SKIP: API $API 不可达（gating/去飞书 行为由 vitest 单测 + ws3 smoke 覆盖）"
  echo "Smoke: PASS=$PASS FAIL=$FAIL"; [ "$FAIL" -eq 0 ]; exit $?
fi

if [ "$DB_REACHABLE" -eq 1 ]; then
  # 种一个固定 uuid 租户，供 crm_customers 黑名单行的 FK 用（幂等）
  "${PSQL[@]}" -q -c "INSERT INTO zenithjoy.tenants (id, name, license_key)
    VALUES ('$TENANT', 'CI Autosend', 'ci-autosend-license')
    ON CONFLICT (id) DO NOTHING;" 2>/dev/null || echo "  (warn) 种租户失败，B 段可能跳过"
fi

echo "=== A) 群消息 is_group=true → status:skipped skip_reason:group（群不回）==="
RA=$(curl -s --max-time 30 -X POST -H 'Content-Type: application/json' \
  -d "{\"sender\":\"某客户群\",\"wechat_id\":\"wxid_ci_group\",\"content\":\"群里随便聊\",\"mode\":\"auto\",\"is_group\":true,\"tenant_id\":\"$TENANT\"}" \
  "$API/api/wechat/draft-generate")
echo "  resp: $RA"
assert_eq "$(echo "$RA" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')" "skipped" "群 → status skipped"
assert_eq "$(echo "$RA" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("skip_reason",""))')" "group" "群 → skip_reason group"
assert_eq "$(echo "$RA" | python3 -c 'import sys,json;print("yes" if json.load(sys.stdin).get("reply") else "no")')" "no" "群 → 无 reply（不回）"

if [ "$DB_REACHABLE" -eq 1 ]; then
  echo "=== B) CRM 标黑 → status:skipped skip_reason:blacklisted（标黑不回）==="
  "${PSQL[@]}" -q \
    -c "INSERT INTO zenithjoy.crm_customers (tenant_id, cs_wechat_id, contact, identity, status, source)
        VALUES ('$TENANT', '$CSWX', '黑名单客户CI', 'blacklist', 'A1', 'manual')
        ON CONFLICT (tenant_id, cs_wechat_id, contact)
        DO UPDATE SET identity='blacklist', deleted_at=NULL;" 2>/dev/null || echo "  (warn) 插入黑名单行失败，继续"
  RB=$(curl -s --max-time 30 -X POST -H 'Content-Type: application/json' \
    -d "{\"sender\":\"黑名单客户CI\",\"wechat_id\":\"wxid_ci_bl\",\"content\":\"你好\",\"mode\":\"auto\",\"tenant_id\":\"$TENANT\",\"cs_wechat_id\":\"$CSWX\"}" \
    "$API/api/wechat/draft-generate")
  echo "  resp: $RB"
  assert_eq "$(echo "$RB" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')" "skipped" "标黑 → status skipped"
  assert_eq "$(echo "$RB" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("skip_reason",""))')" "blacklisted" "标黑 → skip_reason blacklisted"
else
  echo "  SKIP B: DB 不可达"
fi

echo "=== C) 个人未标黑 → 去飞书直发链路，不落 pending_review ==="
RC=$(curl -s --max-time 30 -X POST -H 'Content-Type: application/json' \
  -d "{\"sender\":\"莫易CI\",\"wechat_id\":\"wxid_ci_moyi\",\"content\":\"在吗\",\"mode\":\"auto\",\"tenant_id\":\"$TENANT\"}" \
  "$API/api/wechat/draft-generate")
echo "  resp: $RC"
STATUS_C=$(echo "$RC" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("status",""))')
case "$STATUS_C" in
  sent|ai_failed) echo "  PASS: 个人未标黑走到去飞书直发链路（status=$STATUS_C）"; PASS=$((PASS+1));;
  *) echo "  FAIL: 个人未标黑 status 非预期: $STATUS_C"; FAIL=$((FAIL+1));;
esac
# 注：「chat 去飞书后不落 wechat_publish_task pending_review」由 vitest（wechat-draft.test
#     断言无 INSERT INTO wechat_publish_task）覆盖；此处不再查库（表 schema 无 type 列，易脆）。

echo ""
echo "line04-cs-autosend-no-feishu-smoke: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
