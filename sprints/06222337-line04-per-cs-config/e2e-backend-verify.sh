#!/bin/bash
# Line04 每客服独立配置 — 后端 E2E（ubuntu-latest + postgres:15 service）
# 验：迁移向后兼容 + 两客服按微信号物理隔离不串台 + 未注册号 403 不泄漏 + 诊断入库 + gate/缓存判定。
# 真机微信读号/真发/读回送达 = 接缝（见 contract-draft.md 接缝清单），走 xian-rog，不在此验。
set -euo pipefail

API=${API_BASE:-http://localhost:3000}
DB=${DATABASE_URL:?FAIL: DATABASE_URL 未注入（应由 ubuntu postgres service 提供）}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "── 0. 装依赖 + 构建 + 迁移 ──"
npm ci --workspace=apps/api
( cd apps/api && npm run build && npm run migrate )

echo "── 0b. 种入存量全局配置后再跑迁移（验向后兼容；迁移幂等可重跑）──"
psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_config(key,value) VALUES ('persona','{\"self_name\":\"存量小助手\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]}') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value"
( cd apps/api && npm run migrate )

echo "── 0c. 启 apps/api 等就绪 ──"
( cd apps/api && node dist/index.js >/tmp/api.log 2>&1 & echo $! >/tmp/api.pid )
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/health" 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && { echo "ready after ${i}s"; break; }
  [ "$i" = 30 ] && { echo "FAIL: 中台 30s 未就绪 code=$CODE"; cat /tmp/api.log; exit 1; }
  sleep 1
done

echo "── 1. 迁移向后兼容：存量人设迁为 legacy 行 ──"
psql "$DB" -t -c "SELECT persona->>'self_name' FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_legacy_global'" | grep -q '存量小助手' \
  || { echo "FAIL: 迁移未保留存量人设"; exit 1; }

echo "── 2. 两客服物理隔离不串台（钉死 Issue defe1a42）──"
PA='{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}}'
PB='{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true}'
# 写接口已加管理员/服务闸（Sprint 06232248 Issue 96db53be）：服务级 e2e 用 internal token 走超管/服务通道
CSAUTH="X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-ci-only-internal-token-not-prod}"
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -H "$CSAUTH" -d "$PA" | jq -e '.success == true and .config.persona.self_name == "萌萌"'
curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H 'Content-Type: application/json' -H "$CSAUTH" -d "$PB" | jq -e '.config.auto_agent_enabled == true'
A=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa")
B=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb")
echo "$A" | jq -e '.persona.self_name == "萌萌" and .auto_agent_enabled == false'
echo "$B" | jq -e '.persona.self_name == "天下第一" and .auto_agent_enabled == true'
[ "$(echo "$A" | jq -r .persona.self_name)" != "$(echo "$B" | jq -r .persona.self_name)" ] || { echo "FAIL: 人设串台"; exit 1; }
C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('wxid_csa','wxid_csb') AND updated_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$C" = "2" ] || { echo "FAIL: 期望两独立行 实际 $C"; exit 1; }

echo "── 3. 未注册号拒绝 + 不泄漏 + 诊断入库（时间窗防伪）──"
CODE=$(curl -s -o /tmp/unreg.json -w '%{http_code}' "$API/api/wechat/cs/agent-config?wechat_id=wxid_never_zzz")
[ "$CODE" = "403" ] || { echo "FAIL: 未注册号未拒绝 code=$CODE"; exit 1; }
jq -e 'has("persona") | not' /tmp/unreg.json
curl -sf "$API/api/wechat/cs/diagnostics" | jq -e '[.alerts[] | select(.wechat_id == "wxid_never_zzz")] | length >= 1'
AC=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_identity_alert WHERE wechat_id='wxid_never_zzz' AND created_at > NOW() - interval '5 minutes'" | tr -d ' ')
[ "$AC" -ge 1 ] || { echo "FAIL: 诊断异常未入库"; exit 1; }

echo "── 4. error path：PUT 空 persona → 400 INVALID_BODY ──"
CODE=$(curl -s -o /tmp/badbody.json -w '%{http_code}' -X PUT "$API/api/wechat/cs/config/wxid_csa" -H 'Content-Type: application/json' -H "$CSAUTH" -d '{"persona":{}}')
[ "$CODE" = "400" ] || { echo "FAIL: 非法 body 未返 400 code=$CODE"; exit 1; }
jq -e '.error == "INVALID_BODY"' /tmp/badbody.json

echo "── 5. 客户机 gate 决策 + 断网期缓存继续判定纯函数（拉失败强制 dryrun，绝不误真发）──"
node -e 'const {resolveSendMode,resolveActiveConfig,shouldReply}=require("./services/agent/build-modules/line04/cs-config-gate.js");
const cached={auto_agent_enabled:true,whitelist:["客户乙"]};
const ok = resolveSendMode({auto_agent_enabled:true},true)==="real"
  && resolveSendMode({auto_agent_enabled:false},true)==="dryrun"
  && resolveSendMode({auto_agent_enabled:true},false)==="dryrun"
  && JSON.stringify(resolveActiveConfig(null,cached,false))===JSON.stringify(cached)
  && shouldReply(cached,"客户乙")===true && shouldReply(cached,"路人")===false;
if(!ok){console.error("FAIL: gate/缓存判定错误");process.exit(1)}'

kill "$(cat /tmp/api.pid)" 2>/dev/null || true
echo "✅ job1 后端全过：迁移向后兼容 + 两客服物理隔离不串 + 未注册拒绝+诊断入库 + error path + gate 决策"
