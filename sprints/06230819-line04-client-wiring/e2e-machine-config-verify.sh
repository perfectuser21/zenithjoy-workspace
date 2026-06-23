#!/usr/bin/env bash
# Line04 客户机接线 — 后端 E2E（真 API + 真 postgres，无 mock）
# 验：客户机按 machine_id 经 service_agents 绑定反查 → 拉到「自己那份」配置；
#     两机各绑各号各拉各的不串（萌萌/天下第一）；未绑/没填号/没配过 → 403 不泄漏 + 写诊断。
# 用法：DATABASE_URL=... API_BASE=http://localhost:3000 bash 本脚本（API 需已起好）
set -euo pipefail

API="${API_BASE:-http://localhost:3000}"
DB="${DATABASE_URL:?FAIL: DATABASE_URL 未注入}"

pass() { echo "  ✅ $1"; }

echo "── 0. 等中台就绪 ──"
for i in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$API/health" || echo 000)
  [ "$code" = "200" ] && { echo "ready ${i}s"; break; }
  [ "$i" = 30 ] && { echo "FAIL: API 30s 未就绪 code=$code"; exit 1; }
  sleep 1
done

echo "── 1. seed：两客服各自配置 + 一租户 + 四种绑定 ──"
TEN=$(psql "$DB" -t -A -c "INSERT INTO zenithjoy.tenants(name,license_key) VALUES ('e2e-cw','e2e-cw-license-key') RETURNING id" | head -1 | tr -d '[:space:]')
# 写接口已加管理员/服务闸（Sprint 06232248 Issue 96db53be）：服务级 e2e 用 internal token 走超管/服务通道
CSAUTH="X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token}"
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -H "$CSAUTH" \
  -d '{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"whitelist":["客户甲"]}' >/dev/null
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' -H "$CSAUTH" \
  -d '{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true}' >/dev/null
# 四种绑定：A→csa(已配)、B→csb(已配)、C→已绑没填号、D→填了号但该号没配过
psql "$DB" -q -c "INSERT INTO zenithjoy.service_agents(tenant_id,machine_id,wechat_id) VALUES
  ('$TEN','machine-A','wxid_csa'),('$TEN','machine-B','wxid_csb'),
  ('$TEN','machine-C',NULL),('$TEN','machine-D','wxid_unconfigured')"
pass "seed 完成 tenant=$TEN"

echo "── 2. 两机各拉各的，绝不串台（钉 defe1a42 客户机侧）──"
A=$(curl -sf "$API/api/wechat/cs/agent-config?machine_id=machine-A")
B=$(curl -sf "$API/api/wechat/cs/agent-config?machine_id=machine-B")
echo "$A" | jq -e '.persona.self_name=="萌萌" and .auto_agent_enabled==false and .wechat_id=="wxid_csa"' >/dev/null
echo "$B" | jq -e '.persona.self_name=="天下第一" and .auto_agent_enabled==true and .wechat_id=="wxid_csb"' >/dev/null
[ "$(echo "$A" | jq -r .persona.self_name)" != "$(echo "$B" | jq -r .persona.self_name)" ] || { echo "FAIL: 人设串台"; exit 1; }
pass "machine-A→萌萌(开关off) / machine-B→天下第一(开关on)，不串"

echo "── 3. 未绑/没填号/没配过/未注册 → 403 不泄漏 persona ──"
for m in machine-C machine-D machine-unbound; do
  code=$(curl -s -o /tmp/r.json -w '%{http_code}' "$API/api/wechat/cs/agent-config?machine_id=$m")
  [ "$code" = "403" ] || { echo "FAIL: $m 期望403 实际$code"; cat /tmp/r.json; exit 1; }
  jq -e 'has("persona")|not' /tmp/r.json >/dev/null || { echo "FAIL: $m 响应泄漏了 persona"; exit 1; }
  jq -e '.error=="UNBOUND_MACHINE"' /tmp/r.json >/dev/null
done
pass "machine-C/D/unbound 全 403 UNBOUND_MACHINE 且不泄漏"

echo "── 4. 诊断入库（时间窗防伪）：未绑机触发 unregistered_machine ──"
AC=$(psql "$DB" -t -A -c "SELECT count(*) FROM zenithjoy.wechat_cs_identity_alert WHERE wechat_id='machine-unbound' AND reason='unregistered_machine' AND created_at > NOW() - interval '5 minutes'")
[ "$AC" -ge 1 ] || { echo "FAIL: 诊断未入库 count=$AC"; exit 1; }
pass "诊断异常入库 count=$AC"

echo "── 5. 兼容 wechat_id 直拉路径仍在 ──"
curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa" | jq -e '.persona.self_name=="萌萌"' >/dev/null
pass "wechat_id 直拉 wxid_csa→萌萌"

echo "✅ E2E 全过：machine_id 按身份拉各拉各的不串 + 未绑403不泄漏+诊断入库 + 兼容直拉"
