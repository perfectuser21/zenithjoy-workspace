#!/usr/bin/env bash
# 我的客服机列表 E2E：已配机器带白名单出现、待配机器标 configured=false（本地已实跑通）
set -euo pipefail
API="${API_BASE:-http://localhost:3000}"; DB="${DATABASE_URL:?}"
for i in $(seq 1 30); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$API/health")" = 200 ]&&break; sleep 1; done
TEN=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants(name,license_key) VALUES ('e2e-ml','e2e-ml-lic') RETURNING id"|head -1|tr -d '[:space:]')
LIC=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.licenses(license_key,status,tenant_id,tier,max_machines,expires_at) VALUES ('e2e-ml-lk','active','$TEN','free',3,NOW()+interval '1 year') RETURNING id"|head -1|tr -d '[:space:]')
psql "$DB" -q -c "INSERT INTO zenithjoy.license_machines(license_id,machine_id,hostname) VALUES ('$LIC','mlist-conf','HOST-CONF'),('$LIC','mlist-unconf','HOST-UNCONF')"
psql "$DB" -q -c "INSERT INTO zenithjoy.service_agents(tenant_id,machine_id,wechat_id) VALUES ('$TEN','mlist-conf','cs-mlist1')"
curl -sf -X PUT "$API/api/wechat/cs/config/cs-mlist1" -H 'Content-Type: application/json' -d '{"persona":{"self_name":"小苏","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true,"whitelist":["默忆","客户A"]}' >/dev/null
R=$(curl -s "$API/api/wechat/cs/machines")
echo "$R" | jq -e '[.machines[]|select(.machine_id=="mlist-conf" and .configured==true and (.whitelist|length)==2)]|length==1' >/dev/null || { echo "FAIL 已配机器没带白名单: $R"; exit 1; }
echo "$R" | jq -e '[.machines[]|select(.machine_id=="mlist-unconf" and .configured==false)]|length==1' >/dev/null || { echo "FAIL 待配机器状态错: $R"; exit 1; }
echo "OK 我的客服机列表 E2E：已配带白名单 + 待配标 false"
