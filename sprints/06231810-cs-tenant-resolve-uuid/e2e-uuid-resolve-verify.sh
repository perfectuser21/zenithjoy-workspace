#!/usr/bin/env bash
# listener 传 agentUuid(UUID) 时中台仍解得出租户+每客服配置 E2E（修 NO_TENANT_CONTEXT 根因）
set -euo pipefail
API="${API_BASE:-http://localhost:3000}"; DB="${DATABASE_URL:?}"
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"||echo 000); [ "$c" = 200 ]&&break; [ "$i" = 30 ]&&{ echo FAIL_ready;exit 1;}; sleep 1; done
EID="agent-env-uuidtest"; MID="uuidtest-mach"

echo "-- seed: 租户+license+机器(env-id)+agents行(UUID↔env-id)+绑定+每客服配置[苏小妖] --"
TEN=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants(name,license_key) VALUES ('e2e-uuid','e2e-uuid-lic') RETURNING id"|head -1|tr -d '[:space:]')
LIC=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.licenses(license_key,status,tenant_id,tier,max_machines,expires_at) VALUES ('e2e-uuid-lk','active','$TEN','free',3,NOW()+interval '1 year') RETURNING id"|head -1|tr -d '[:space:]')
psql "$DB" -q -c "INSERT INTO zenithjoy.license_machines(license_id,machine_id,agent_id,hostname) VALUES ('$LIC','$MID','$EID','E2E-UUID')"
# agents 行：id=UUID(listener 实际传这个), agent_id=env-id, tenant_id
AUUID=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.agents(agent_id,tenant_id,hostname) VALUES ('$EID','$TEN','E2E-UUID') RETURNING id"|head -1|tr -d '[:space:]')
psql "$DB" -q -c "INSERT INTO zenithjoy.service_agents(tenant_id,machine_id,wechat_id) VALUES ('$TEN','$MID','cs-uuidtest')"
curl -sf -X PUT "$API/api/wechat/cs/config/cs-uuidtest" -H 'Content-Type: application/json' \
  -d '{"persona":{"self_name":"小苏","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true,"whitelist":["苏小妖"],"key_contact_wechat":"默忆"}' >/dev/null
echo "  OK seed: env-id=$EID UUID=$AUUID"

echo "-- ① listener 传 UUID + 路人 → 应解到租户(不再 NO_TENANT_CONTEXT)、按每客服白名单拒路人 --"
R1=$(curl -s -X POST "$API/api/wechat/draft-generate" -H 'Content-Type: application/json' -d '{"sender":"路人甲","wechat_id":"路人甲","content":"在吗","mode":"auto","agent_id":"'"$AUUID"'"}')
echo "$R1" | jq -e '(.error // "") != "NO_TENANT_CONTEXT"' >/dev/null || { echo "FAIL 传UUID还NO_TENANT_CONTEXT: $R1"; exit 1; }
echo "$R1" | jq -e '.ok==false and .reason=="not_in_whitelist"' >/dev/null || { echo "FAIL 路人没按每客服白名单拒: $R1"; exit 1; }
echo "  OK 传UUID解到租户 + 路人按每客服白名单挡外"

echo "-- ② listener 传 UUID + 苏小妖(每客服白名单内)→ 不应 not_in_whitelist --"
R2=$(curl -s -X POST "$API/api/wechat/draft-generate" -H 'Content-Type: application/json' -d '{"sender":"苏小妖","wechat_id":"苏小妖","content":"在吗","mode":"auto","agent_id":"'"$AUUID"'"}')
echo "$R2" | jq -e '(.error // "") != "NO_TENANT_CONTEXT" and (.reason // "") != "not_in_whitelist"' >/dev/null || { echo "FAIL 苏小妖被拒: $R2"; exit 1; }
echo "  OK 传UUID时苏小妖过白名单(响应=$R2)"
echo "OK UUID 解析 E2E 全过：listener 传 UUID 也能解到租户+每客服配置"
