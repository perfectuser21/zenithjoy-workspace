#!/usr/bin/env bash
# Line 10 客户管理后台 — 后端真链路 smoke（接进 ci-l4-e2e-smoke.yml 的 smoke-api-contract job）
#
# #816 合并去重后：账号模型统一到 better-auth user + tenant_members（废 tenant_sub_accounts）。
# 打真实 ZenithJoy API（API_BASE，默认 localhost:5200）+ 真实 Postgres（PG* 默认 cecelia）。
# 覆盖合并后的后端契约：
#   改公司名落库 / GET /customers 含 name+member_count /
#   按 email 拉成员(tenant_members) + 用户不存在 404 / 列成员 + schema 纯度 / 移除成员 /
#   客服-PC 绑定真实成员(member_user_id) + 双唯一 ALREADY_BOUND / 机器配额 MACHINE_QUOTA_EXCEEDED /
#   子账号端点已废(404) / 租户隔离 / GET /service-agents schema 纯度 / 非超管 403 / module-health。
#
# 正向调用带 X-Internal-Token（CI 关 dev-fallback，无头真 401）；负向 403 发 X-Feishu-User-Id: not-an-admin。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:5200}"
PGHOST="${PGHOST:-localhost}"
PGUSER="${PGUSER:-cecelia}"
PGDATABASE="${PGDATABASE:-cecelia}"
export PGPASSWORD="${PGPASSWORD:-cecelia}"
TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-}"

# 只取首行：INSERT...RETURNING 在某些 psql 版本会把命令标签(INSERT 0 1)打到第二行，
# 取首行=真值；sed -n '1p' 读完整输入(不早退)→ 不触发 SIGPIPE，psql 出错仍经 pipefail 透传。
Q() { psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -tAc "$1" | sed -n '1p'; }
H_TOKEN=(-H "X-Internal-Token: $TOKEN")
SUF="$(date +%s)$$"

echo "==> [bootstrap] 建租户 + license（matrix=5 机位）+ 2 个注册用户"
LK="lk-cab-${SUF}"
TID=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('Personal-old','${LK}','matrix') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK}','matrix',5,'${TID}','active',NOW()+interval '365 days')" >/dev/null
# better-auth user（成员标识 = user.id，与 tenant_members.feishu_user_id 对齐）
UID1="usr-svc-${SUF}"
UID2="usr-op-${SUF}"
Q "INSERT INTO \"user\"(id,name,email,\"emailVerified\") VALUES('${UID1}','客服','svc@cab.test',true)" >/dev/null
Q "INSERT INTO \"user\"(id,name,email,\"emailVerified\") VALUES('${UID2}','运营','op@cab.test',true)" >/dev/null
echo "  tenant=$TID user1=$UID1 user2=$UID2"

echo "==> [1] PUT /api/tenant/:id 改公司名落库"
R=$(curl -sf -X PUT "$API_BASE/api/tenant/$TID" -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"name":"晨悦传媒"}')
echo "$R" | jq -e '.success==true and .data.name=="晨悦传媒"' >/dev/null
NAME=$(Q "SELECT name FROM zenithjoy.tenants WHERE id='${TID}'" | tr -d ' ')
[ "$NAME" = "晨悦传媒" ] || { echo "FAIL: 公司名未落库 ($NAME)"; exit 1; }
echo "  OK 公司名落库"

echo "==> [2] POST /api/tenant/:id/members 按 email 拉注册用户进公司"
R=$(curl -sf -X POST "$API_BASE/api/tenant/$TID/members" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d '{"email":"svc@cab.test","role":"member"}')
echo "$R" | jq -e '.success==true and .data.user_id=="'"${UID1}"'"' >/dev/null
C=$(Q "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id='${TID}' AND feishu_user_id='${UID1}'" | tr -d ' ')
[ "$C" = "1" ] || { echo "FAIL: 成员未入 tenant_members"; exit 1; }
# 第二个成员（供绑定用）
curl -sf -X POST "$API_BASE/api/tenant/$TID/members" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d '{"email":"op@cab.test","role":"member"}' >/dev/null
echo "  OK 成员 $UID1/$UID2 入库"

echo "==> [3] 拉未注册 email → 404 USER_NOT_FOUND，不写库"
CODE=$(curl -s -o /tmp/cab_nf.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/members" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"email":"ghost@cab.test","role":"member"}')
[ "$CODE" = "404" ] || { echo "FAIL user-not-found code=$CODE"; cat /tmp/cab_nf.json; exit 1; }
jq -e '.error.code=="USER_NOT_FOUND"' /tmp/cab_nf.json >/dev/null
echo "  OK 未注册 email 拒绝"

echo "==> [4] 子账号端点已废 → 404（POST/GET /:id/accounts 不存在）"
CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/tenant/$TID/accounts" "${H_TOKEN[@]}")
[ "$CODE" = "404" ] || { echo "FAIL: GET /accounts 应已废 code=$CODE"; exit 1; }
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/accounts" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d '{"email":"x@cab.test","role":"service_agent"}')
[ "$CODE" = "404" ] || { echo "FAIL: POST /accounts 应已废 code=$CODE"; exit 1; }
echo "  OK 子账号端点已废"

echo "==> [5] bind-device 绑真实成员落库 + 重复绑同成员 → 409 ALREADY_BOUND"
MID="pc-${SUF}"
curl -sf -X POST "$API_BASE/api/tenant/$TID/service-agents/$UID1/bind-device" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d "{\"machine_id\":\"${MID}\"}" | jq -e '.success==true and (.data.binding_id|type=="string") and .data.member_user_id=="'"${UID1}"'"' >/dev/null
BC=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE member_user_id='${UID1}' AND machine_id='${MID}' AND deleted_at IS NULL" | tr -d ' ')
[ "$BC" = "1" ] || { echo "FAIL: 绑定未落库"; exit 1; }
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/service-agents/$UID1/bind-device" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d "{\"machine_id\":\"${MID}\"}")
[ "$CODE" = "409" ] || { echo "FAIL dup code=$CODE"; exit 1; }
BC2=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE member_user_id='${UID1}' AND deleted_at IS NULL" | tr -d ' ')
[ "$BC2" = "1" ] || { echo "FAIL: 重复绑产生新行"; exit 1; }
echo "  OK 绑定落库 + 成员双唯一拒绝"

echo "==> [6] 同 PC 绑第二个成员 → 409 ALREADY_BOUND（机器双唯一）"
CODE=$(curl -s -o /tmp/cab_pc.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID/service-agents/$UID2/bind-device" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d "{\"machine_id\":\"${MID}\"}")
[ "$CODE" = "409" ] || { echo "FAIL pc-dup code=$CODE"; cat /tmp/cab_pc.json; exit 1; }
jq -e '.error.code=="ALREADY_BOUND"' /tmp/cab_pc.json >/dev/null
echo "  OK PC 双唯一拒绝"

echo "==> [7] 机器配额超额硬拒 → 4xx MACHINE_QUOTA_EXCEEDED"
LK3="lk-cabm-${SUF}"
TID3=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('MQ','${LK3}','basic') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK3}','basic',1,'${TID3}','active',NOW()+interval '365 days')" >/dev/null
LID3=$(Q "SELECT id FROM zenithjoy.licenses WHERE license_key='${LK3}'" | tr -d ' ')
Q "INSERT INTO zenithjoy.license_machines(license_id,machine_id) VALUES('${LID3}','mq-pre-${SUF}')" >/dev/null
UID3="usr-mq-${SUF}"
Q "INSERT INTO \"user\"(id,name,email,\"emailVerified\") VALUES('${UID3}','客服MQ','svc@mq.test',true)" >/dev/null
curl -sf -X POST "$API_BASE/api/tenant/$TID3/members" -H "Content-Type: application/json" "${H_TOKEN[@]}" \
  -d '{"email":"svc@mq.test","role":"member"}' >/dev/null
CODE=$(curl -s -o /tmp/cab_mq.json -w '%{http_code}' -X POST "$API_BASE/api/tenant/$TID3/service-agents/$UID3/bind-device" \
  -H "Content-Type: application/json" "${H_TOKEN[@]}" -d "{\"machine_id\":\"mq-new-${SUF}\"}")
case "$CODE" in 409|400|403) : ;; *) echo "FAIL mq code=$CODE"; cat /tmp/cab_mq.json; exit 1;; esac
jq -e '.error.code|test("MACHINE_QUOTA")' /tmp/cab_mq.json >/dev/null || { echo "FAIL: 非 MACHINE_QUOTA_EXCEEDED"; cat /tmp/cab_mq.json; exit 1; }
MC=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE member_user_id='${UID3}' AND deleted_at IS NULL" | tr -d ' ')
[ "$MC" = "0" ] || { echo "FAIL: 机器配额满仍写库"; exit 1; }
echo "  OK 机器配额硬拒"

echo "==> [8] GET /api/admin/customers 含 name + member_count"
R=$(curl -sf "$API_BASE/api/admin/customers" "${H_TOKEN[@]}")
echo "$R" | jq -e '(keys - ["data","success","total"])|length==0' >/dev/null || { echo "FAIL: customers 顶层多余 key"; echo "$R" | jq -c keys; exit 1; }
echo "$R" | jq -e '[.data[]|select(.tenant_id=="'"${TID}"'")][0] | .name=="晨悦传媒" and (.member_count>=2)' >/dev/null \
  || { echo "FAIL: customers 缺 name/member_count"; echo "$R" | jq -c '[.data[]|select(.tenant_id=="'"${TID}"'")][0]'; exit 1; }
echo "  OK customers 含 name + member_count"

echo "==> [9] GET /members schema 纯度（user_id+email+role，不泄漏 feishu_user_id）"
R=$(curl -sf "$API_BASE/api/tenant/$TID/members" "${H_TOKEN[@]}")
echo "$R" | jq -e '(keys - ["data","success","total"])|length==0' >/dev/null || { echo "FAIL: members 顶层多余 key"; exit 1; }
echo "$R" | jq -e '.data[0]|has("user_id") and has("email") and has("role")' >/dev/null
echo "$R" | jq -e '[.data[].email]|index("svc@cab.test")!=null' >/dev/null || { echo "FAIL: 成员列表缺 svc@cab.test"; exit 1; }
echo "  OK /members schema 纯净"

echo "==> [10] GET /service-agents schema 纯度（binding_id+member_user_id 不泄漏 id）"
R=$(curl -sf "$API_BASE/api/tenant/$TID/service-agents" "${H_TOKEN[@]}")
echo "$R" | jq -e '(keys - ["data","success","total"])|length==0' >/dev/null || { echo "FAIL: service-agents 顶层多余 key"; exit 1; }
echo "$R" | jq -e '.data[0]|has("binding_id") and has("member_user_id") and (has("id")|not)' >/dev/null
echo "  OK /service-agents schema 纯净"

echo "==> [11] 移除成员 → 列表不含、tenant_members 行删、连带解绑"
curl -sf -X DELETE "$API_BASE/api/tenant/$TID/members/$UID1" "${H_TOKEN[@]}" | jq -e '.success==true' >/dev/null
IN=$(curl -sf "$API_BASE/api/tenant/$TID/members" "${H_TOKEN[@]}" | jq -r "[.data[].user_id]|index(\"$UID1\") // \"gone\"")
[ "$IN" = "gone" ] || { echo "FAIL: 移除成员仍在列表"; exit 1; }
GONE=$(Q "SELECT count(*) FROM zenithjoy.tenant_members WHERE tenant_id='${TID}' AND feishu_user_id='${UID1}'" | tr -d ' ')
[ "$GONE" = "0" ] || { echo "FAIL: tenant_members 行未删"; exit 1; }
UNB=$(Q "SELECT count(*) FROM zenithjoy.service_agents WHERE member_user_id='${UID1}' AND deleted_at IS NULL" | tr -d ' ')
[ "$UNB" = "0" ] || { echo "FAIL: 移除成员未连带解绑"; exit 1; }
echo "  OK 移除成员生效 + 连带解绑"

echo "==> [12] 租户隔离：A 成员不入 B 列表"
LK2="lk-cabb-${SUF}"
TID2=$(Q "INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES('B','${LK2}','basic') RETURNING id" | tr -d ' ')
Q "INSERT INTO zenithjoy.licenses(license_key,tier,max_machines,tenant_id,status,expires_at) VALUES('${LK2}','basic',1,'${TID2}','active',NOW()+interval '365 days')" >/dev/null
CROSS=$(curl -sf "$API_BASE/api/tenant/$TID2/members" "${H_TOKEN[@]}" | jq -r '[.data[].email]|map(select(test("@cab.test")))|length')
[ "$CROSS" = "0" ] || { echo "FAIL: 跨租户泄漏 $CROSS"; exit 1; }
echo "  OK 租户隔离"

echo "==> [13] 非超管 403（X-Feishu-User-Id: not-an-admin）"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "X-Feishu-User-Id: not-an-admin" "$API_BASE/api/tenant/$TID/members")
[ "$CODE" = "403" ] || { echo "FAIL: 非超管 code=$CODE"; exit 1; }
echo "  OK 403 守卫"

echo "==> [14] 轻量审计落库（拉/移成员 + 绑定产生 ≥2 行 ≥2 action）"
AC=$(Q "SELECT count(*) FROM zenithjoy.customer_admin_audit WHERE tenant_id='${TID}' AND actor IS NOT NULL AND length(actor)>0 AND action IS NOT NULL AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$AC" -ge 2 ] || { echo "FAIL: 审计行数=$AC <2"; exit 1; }
AD=$(Q "SELECT count(DISTINCT action) FROM zenithjoy.customer_admin_audit WHERE tenant_id='${TID}' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$AD" -ge 2 ] || { echo "FAIL: 审计 distinct action=$AD <2"; exit 1; }
echo "  OK 审计落库 ($AC 行 / $AD action)"

echo "==> [15] 诊断端点复用 GET /api/agent/module-health 返 {ok,data:array}"
# licenseAuth 校验真实 license_key，故用 bootstrap 建的 matrix license（active+未过期+带 tenant）作 Bearer
R=$(curl -s "$API_BASE/api/agent/module-health" -H "Authorization: Bearer ${E2E_LICENSE_TOKEN:-$LK}")
echo "$R" | jq -e 'has("ok") and (.data|type=="array")' >/dev/null || { echo "FAIL: module-health schema"; echo "$R"; exit 1; }
echo "  OK module-health 复用"

echo ""
echo "✅ customer-admin-backend smoke 全过（15 步真 API + 真库断言，账号统一到注册用户）"
