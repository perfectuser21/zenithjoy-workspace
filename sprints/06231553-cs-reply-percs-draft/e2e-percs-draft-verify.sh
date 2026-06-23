#!/usr/bin/env bash
# 草稿生成按每客服白名单 E2E：配了每客服白名单[苏小妖] → 苏小妖不再 not_in_whitelist、路人仍被拒
set -euo pipefail
API="${API_BASE:-http://localhost:3000}"; DB="${DATABASE_URL:?}"
for i in $(seq 1 30); do c=$(curl -s -o /dev/null -w '%{http_code}' "$API/health"||echo 000); [ "$c" = 200 ]&&break; [ "$i" = 30 ]&&{ echo FAIL_ready;exit 1;}; sleep 1; done

echo "-- seed: 租户+license+机器(agent_id)+绑定+每客服配置(白名单苏小妖,auto ON) --"
TEN=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants(name,license_key) VALUES ('e2e-pd','e2e-pd-lic') RETURNING id"|head -1|tr -d '[:space:]')
LIC=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.licenses(license_key,status,tenant_id,tier,max_machines,expires_at) VALUES ('e2e-pd-lk','active','$TEN','free',3,NOW()+interval '1 year') RETURNING id"|head -1|tr -d '[:space:]')
psql "$DB" -q -c "INSERT INTO zenithjoy.license_machines(license_id,machine_id,agent_id,hostname) VALUES ('$LIC','e2e-pd-mach','e2e-pd-agent','E2E-PD')"
psql "$DB" -q -c "INSERT INTO zenithjoy.service_agents(tenant_id,machine_id,wechat_id) VALUES ('$TEN','e2e-pd-mach','cs-e2e-pd')"
curl -sf -X PUT "$API/api/wechat/cs/config/cs-e2e-pd" -H 'Content-Type: application/json' \
  -d '{"persona":{"self_name":"小苏","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true,"whitelist":["苏小妖"],"key_contact_wechat":"默忆"}' >/dev/null
echo "  OK seed"

echo "-- ① 路人(不在每客服白名单)→ 应 not_in_whitelist --"
R1=$(curl -s -X POST "$API/api/wechat/draft-generate" -H 'Content-Type: application/json' -d '{"sender":"路人甲","wechat_id":"路人甲","content":"在吗","mode":"auto","agent_id":"e2e-pd-agent","tenant_id":"'"$TEN"'"}')
echo "$R1" | jq -e '.ok==false and .reason=="not_in_whitelist"' >/dev/null || { echo "FAIL 路人没被拒: $R1"; exit 1; }
echo "  OK 路人被拒 not_in_whitelist"

echo "-- ② 苏小妖(在每客服白名单)→ 不应再 not_in_whitelist --"
R2=$(curl -s -X POST "$API/api/wechat/draft-generate" -H 'Content-Type: application/json' -d '{"sender":"苏小妖","wechat_id":"苏小妖","content":"在吗","mode":"auto","agent_id":"e2e-pd-agent","tenant_id":"'"$TEN"'"}')
echo "$R2" | jq -e '(.reason // "") != "not_in_whitelist"' >/dev/null || { echo "FAIL 苏小妖仍被拒(每客服白名单没生效): $R2"; exit 1; }
echo "  OK 苏小妖过了白名单(响应=$R2)"
echo "OK 每客服白名单 E2E 全过：苏小妖能进、路人挡外"
