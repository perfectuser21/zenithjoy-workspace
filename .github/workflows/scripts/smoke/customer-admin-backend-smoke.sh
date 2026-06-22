#!/usr/bin/env bash
# Line 10 客户管理后台 — 后端真链路 smoke（接进 ci-l4-e2e-smoke.yml 的 smoke-api-contract job）
#
# 打真实 ZenithJoy API（API_BASE，默认 localhost:5200）+ 真实 Postgres（PG* 默认 cecelia）。
# 覆盖 contract-dod.md 的后端 [BEHAVIOR]：
#   改公司名落库 / 建子账号带 role / 子账号配额超限硬拒（配额 N/M）/
#   客服-PC 绑定 + 双唯一 ALREADY_BOUND / 机器配额 MACHINE_QUOTA_EXCEEDED /
#   软删 + 租户隔离 / GET /accounts、/service-agents schema 纯度 / 非超管 403 / module-health。
#
# 正向调用带 X-Internal-Token（CI 关 dev-fallback，无头真 401）；负向 403 发 X-Feishu-User-Id: not-an-admin。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-cecelia}"
PGDATABASE="${PGDATABASE:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"
TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

Q() { psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "$1"; }
H_TOKEN=(-H "X-Internal-Token: $TOKEN")
SUF="$(date +%s)$$"

echo "==> [bootstrap] 建租户 + license（matrix=5 机位）"
LK="lk-cab-${SUF}"
TID=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('Personal-old','${LK}','matrix') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK}','matrix',5,'${TID}','active',NOW()+interval '365 days')" >/dev/null
echo "  tenant=$TID"

echo "==> [1] PUT /api/tenant/:id 改公司名落库"
R=$(curl -sf -X PUT "$API_BASE/api/tenant/$TID" -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"name":"晨悦传媒"}')
echo "$R" | jq -e '.success==true and .data.name=="晨悦传媒"' >/dev/null
NAME=$(Q "SELECT name FROM zenithjoy.tenants WHERE id='${TID}'" | tr -d ' ')
[ "$NAME" = "晨悦传媒" ] || { echo "FAIL: 公司名未落库 ($NAME)"; exit 1; }
echo "  OK 公司名落库"

echo "==> [2] POST /api/tenant/:id/accounts 建 service_agent 子账号"
R=$(curl -sf -X POST "$API_BASE/api/tenant/$TID/accounts" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d '{"email":"svc@cab.test","display_name":"客服","role":"service_agent"}')
AID=$(echo "$R" | jq -r '.data.account_id')
echo "$R" | jq -e '.success==true and .data.role=="service_agent"' >/dev/null
C=$(Q "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id='${AID}' AND tenant_id='${TID}' AND role='service_agent' AND deleted_at IS NULL" | tr -d ' ')
[ "$C" = "1" ] || { echo "FAIL: 子账号未入库"; exit 1; }
echo "  OK 子账号 $AID 入库"

echo "==> [3] 非法 role → 400 INVALID_ROLE，不写库"
CODE=$(curl -s -o /tmp/cab_role.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/accounts" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"email":"boss@cab.test","display_name":"x","role":"boss"}')
[ "$CODE" = "400" ] || { echo "FAIL role code=$CODE"; cat /tmp/cab_role.json; exit 1; }
jq -e '.error.code|test("ROLE")' /tmp/cab_role.json >/dev/null
echo "  OK 非法 role 拒绝"

echo "==> [4] 子账号配额超限硬拒（basic=1 → 第 2 个返 4xx「配额 N/M」）"
LK2="lk-cabq-${SUF}"
TID2=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('Q','${LK2}','basic') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK2}','basic',1,'${TID2}','active',NOW()+interval '365 days')" >/dev/null
LIM=$(curl -sf "$API_BASE/api/tenant/$TID2/accounts" "${H_TOKEN[@]}" | jq -r '.quota.limit')
[ "$LIM" -ge 1 ] || { echo "FAIL limit=$LIM"; exit 1; }
i=0; while [ "$i" -lt "$LIM" ]; do
  curl -sf -X POST "$API_BASE/api/tenant/$TID2/accounts" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
    -d "{\"email\":\"f${i}@cabq.test\",\"display_name\":\"f${i}\",\"role\":\"operator\"}" >/dev/null
  i=$((i+1))
done
CODE=$(curl -s -o /tmp/cab_q.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID2/accounts" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"email":"over@cabq.test","display_name":"o","role":"operator"}')
case "$CODE" in 409|400) : ;; *) echo "FAIL quota code=$CODE"; cat /tmp/cab_q.json; exit 1;; esac
jq -e '.error.message | test("配额") and test("/")' /tmp/cab_q.json >/dev/null || { echo "FAIL: 配额文案不含 N/M"; cat /tmp/cab_q.json; exit 1; }
QC=$(Q "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE tenant_id='${TID2}' AND deleted_at IS NULL" | tr -d ' ')
[ "$QC" = "$LIM" ] || { echo "FAIL: 配额满后 DB 行数=$QC ≠ $LIM"; exit 1; }
echo "  OK 配额超限硬拒，DB 行数停在 $LIM"

echo "==> [5] bind-device 绑定落库 + 重复绑同客服 → 409 ALREADY_BOUND"
MID="pc-${SUF}"
curl -sf -X POST "$API_BASE/api/tenant/$TID/service-agents/$AID/bind-device" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d "{\"machine_id\":\"${MID}\"}" | jq -e '.success==true and (.data.binding_id|type=="string")' >/dev/null
BC=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id='${AID}' AND machine_id='${MID}' AND deleted_at IS NULL" | tr -d ' ')
[ "$BC" = "1" ] || { echo "FAIL: 绑定未落库"; exit 1; }
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/service-agents/$AID/bind-device" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d "{\"machine_id\":\"${MID}\"}")
[ "$CODE" = "409" ] || { echo "FAIL dup code=$CODE"; exit 1; }
BC2=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id='${AID}' AND deleted_at IS NULL" | tr -d ' ')
[ "$BC2" = "1" ] || { echo "FAIL: 重复绑产生新行"; exit 1; }
echo "  OK 绑定落库 + 双唯一拒绝"

echo "==> [6] 机器配额超额硬拒 → 4xx MACHINE_QUOTA_EXCEEDED"
LK3="lk-cabm-${SUF}"
TID3=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('MQ','${LK3}','basic') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK3}','basic',1,'${TID3}','active',NOW()+interval '365 days')" >/dev/null
LID3=$(Q "SELECT id FROM zenithjoy.licenses WHERE license_key='${LK3}'" | tr -d ' ')
Q "INSERT INTO zenithjoy.license_machines(license_id,machine_id) VALUES('${LID3}','mq-pre-${SUF}')" >/dev/null
AID3=$(curl -sf -X POST "$API_BASE/api/tenant/$TID3/accounts" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d '{"email":"svc@mq.test","display_name":"客服","role":"service_agent"}' | jq -r '.data.account_id')
CODE=$(curl -s -o /tmp/cab_mq.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID3/service-agents/$AID3/bind-device" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d "{\"machine_id\":\"mq-new-${SUF}\"}")
case "$CODE" in 409|400|403) : ;; *) echo "FAIL mq code=$CODE"; cat /tmp/cab_mq.json; exit 1;; esac
jq -e '.error.code|test("MACHINE_QUOTA")' /tmp/cab_mq.json >/dev/null || { echo "FAIL: 非 MACHINE_QUOTA_EXCEEDED"; cat /tmp/cab_mq.json; exit 1; }
MC=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE account_id='${AID3}' AND deleted_at IS NULL" | tr -d ' ')
[ "$MC" = "0" ] || { echo "FAIL: 机器配额满仍写库"; exit 1; }
echo "  OK 机器配额硬拒"

echo "==> [7] GET /accounts schema 纯度（顶层子集卡 + data 项 account_id 不泄漏 id/users）"
R=$(curl -sf "$API_BASE/api/tenant/$TID/accounts" "${H_TOKEN[@]}")
echo "$R" | jq -e '(keys - ["data","quota","success","total"])|length==0' >/dev/null || { echo "FAIL: 顶层多余 key"; echo "$R" | jq -c keys; exit 1; }
for F in users clients members result id; do
  echo "$R" | jq -e "has(\"$F\")|not" >/dev/null || { echo "FAIL: 顶层禁用字段 $F"; exit 1; }
done
echo "$R" | jq -e '.data[0]|has("account_id") and (has("id")|not) and (has("users")|not)' >/dev/null
echo "  OK /accounts schema 纯净"

echo "==> [8] GET /service-agents schema 纯度（binding_id 不泄漏 id）"
R=$(curl -sf "$API_BASE/api/tenant/$TID/service-agents" "${H_TOKEN[@]}")
echo "$R" | jq -e '(keys - ["data","success","total"])|length==0' >/dev/null || { echo "FAIL: service-agents 顶层多余 key"; exit 1; }
echo "$R" | jq -e '.data[0]|has("binding_id") and (has("id")|not)' >/dev/null
echo "  OK /service-agents schema 纯净"

echo "==> [9] 软删账号 → 列表不含、deleted_at 置位、物理行保留"
curl -sf -X DELETE "$API_BASE/api/tenant/$TID/accounts/$AID" "${H_TOKEN[@]}" | jq -e '.data.deleted==true' >/dev/null
IN=$(curl -sf "$API_BASE/api/tenant/$TID/accounts" "${H_TOKEN[@]}" | jq -r "[.data[].account_id]|index(\"$AID\") // \"gone\"")
[ "$IN" = "gone" ] || { echo "FAIL: 软删账号仍在列表"; exit 1; }
DEL=$(Q "SELECT count(*) FROM zenithjoy.tenant_sub_accounts WHERE id='${AID}' AND deleted_at IS NOT NULL" | tr -d ' ')
[ "$DEL" = "1" ] || { echo "FAIL: 软删未置 deleted_at 或物理行丢失"; exit 1; }
echo "  OK 软删生效，物理行保留"

echo "==> [10] 租户隔离：A 账号不入 B 列表"
CROSS=$(curl -sf "$API_BASE/api/tenant/$TID2/accounts" "${H_TOKEN[@]}" | jq -r '[.data[].email]|map(select(test("@cab.test")))|length')
[ "$CROSS" = "0" ] || { echo "FAIL: 跨租户泄漏 $CROSS"; exit 1; }
echo "  OK 租户隔离"

echo "==> [11] 非超管 403（X-Feishu-User-Id: not-an-admin）"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Feishu-User-Id: not-an-admin" "$API_BASE/api/tenant/$TID/accounts")
[ "$CODE" = "403" ] || { echo "FAIL: 非超管 code=$CODE"; exit 1; }
echo "  OK 403 守卫"

echo "==> [12] 轻量审计落库（建+删账号产生 ≥2 行 ≥2 action）"
AC=$(Q "SELECT count(*) FROM zenithjoy.customer_admin_audit WHERE tenant_id='${TID}' AND actor IS NOT NULL AND length(actor)>0 AND action IS NOT NULL AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$AC" -ge 2 ] || { echo "FAIL: 审计行数=$AC <2"; exit 1; }
AD=$(Q "SELECT count(DISTINCT action) FROM zenithjoy.customer_admin_audit WHERE tenant_id='${TID}' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$AD" -ge 2 ] || { echo "FAIL: 审计 distinct action=$AD <2"; exit 1; }
echo "  OK 审计落库 ($AC 行 / $AD action)"

echo "==> [13] 诊断端点复用 GET /api/agent/module-health 返 {ok,data:array}"
# licenseAuth 校验真实 license_key，故用 bootstrap 建的 matrix license（active+未过期+带 tenant）作 Bearer
R=$(curl -s "$API_BASE/api/agent/module-health" -H "Authorization: Bearer ${E2E_LICENSE_TOKEN:-$LK}")
echo "$R" | jq -e 'has("ok") and (.data|type=="array")' >/dev/null || { echo "FAIL: module-health schema"; echo "$R"; exit 1; }
echo "  OK module-health 复用"

echo ""
echo "✅ customer-admin-backend smoke 全过（13 步真 API + 真库断言）"
