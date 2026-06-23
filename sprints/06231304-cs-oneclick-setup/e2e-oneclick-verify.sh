#!/usr/bin/env bash
# 微信客服一键配置 E2E（真 API + 真 postgres）：seed 机器报到 → pending 列出 → 一键 setup → 自动绑+配 → 机器拉到
set -euo pipefail
API="${API_BASE:-http://localhost:3000}"; DB="${DATABASE_URL:?}"
pass(){ echo "  OK $1"; }
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"||echo 000); [ "$c" = 200 ]&&break; [ "$i" = 30 ]&&{ echo FAIL_ready; exit 1; }; sleep 1; done

echo "-- seed：租户+license+机器报到（license_machine）+ 一条 pending 异常 --"
TEN=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants(name,license_key) VALUES ('e2e-oc','e2e-oc-lic') RETURNING id"|head -1|tr -d '[:space:]')
LIC=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.licenses(license_key,status,tenant_id,tier,max_machines,expires_at) VALUES ('e2e-oc-lickey','active','$TEN','free',10,NOW()+interval '1 year') RETURNING id"|head -1|tr -d '[:space:]')
psql "$DB" -q -c "INSERT INTO zenithjoy.license_machines(license_id,machine_id,hostname) VALUES ('$LIC','e2e-mach-1','E2E-DESKTOP')"
psql "$DB" -q -c "INSERT INTO zenithjoy.wechat_cs_identity_alert(wechat_id,reason) VALUES ('e2e-mach-1','unregistered_machine')"
pass "seed tenant=$TEN"

echo "-- ① pending 列出该机器(带 hostname) --"
curl -sf "$API/api/wechat/cs/pending-machines" | jq -e '.machines[]|select(.machine_id=="e2e-mach-1" and .hostname=="E2E-DESKTOP")' >/dev/null
pass "pending 含 e2e-mach-1 / E2E-DESKTOP"

echo "-- ② 一键 setup（管理员只填人设/白名单/开关，不碰 machine_id）--"
R=$(curl -sf -X PUT "$API/api/wechat/cs/setup/e2e-mach-1" -H 'Content-Type: application/json' \
  -d '{"persona":{"self_name":"小助手","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true,"whitelist":["默忆"],"key_contact_wechat":"默忆"}')
echo "$R" | jq -e '.success==true and (.wechat_id|length>0)' >/dev/null
WID=$(echo "$R"|jq -r .wechat_id); pass "setup 成功 wechat_id=$WID"

echo "-- ③ 自动绑定写进 service_agents --"
CNT=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.service_agents WHERE machine_id='e2e-mach-1' AND wechat_id='$WID' AND deleted_at IS NULL")
[ "$CNT" = 1 ]||{ echo "FAIL 绑定未写 $CNT"; exit 1; }; pass "service_agents 自动绑定 1 行"

echo "-- ④ 机器按 machine_id 拉到自己配置(auto_agent=true) --"
curl -sf "$API/api/wechat/cs/agent-config?machine_id=e2e-mach-1" | jq -e '.wechat_id=="'"$WID"'" and .auto_agent_enabled==true and (.persona.self_name=="小助手")' >/dev/null
pass "agent-config 解析到配置 mode=real 就绪"

echo "-- ⑤ setup 后该机器从 pending 消失 --"
curl -sf "$API/api/wechat/cs/pending-machines" | jq -e '[.machines[]|select(.machine_id=="e2e-mach-1")]|length==0' >/dev/null
pass "已配的机器不再 pending"
echo "OK 一键配置 E2E 全过"
