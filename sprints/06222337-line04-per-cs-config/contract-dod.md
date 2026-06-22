---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line04 每客服独立配置 + 客户机按身份拉配置

**范围**: 中台 Postgres 每客服配置表（key=绑定微信号）+ 前台「每客服设置区」编辑该行 + 客户机按自己微信号身份拉自己那份（含登录号校验报红+诊断异常）+ 真发 gate 跟随该客服 `auto_agent_enabled`（默认 dryrun）+ 存量全局配置迁为 legacy 现客服那一行（向后兼容）。
**大小**: L
**真发 gate 默认值**: dryrun（auto_agent_enabled 默认 OFF；拉失败强制 dryrun）
**接缝**: 真机微信读号/真发/读回送达 = `logic-done-pending`（真目标 xian-rog，见 contract-draft.md 接缝清单），本 sprint 只验逻辑层。

## ARTIFACT 条目

- [ ] [ARTIFACT] 每客服配置表 migration（key=微信号）+ 存量全局迁移 SQL
  Test: node -e "const fs=require('fs');const f=fs.readdirSync('apps/api/db/migrations').find(n=>/wechat_cs_account_config/.test(n));if(!f)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+f,'utf8');if(!/CREATE TABLE IF NOT EXISTS zenithjoy\.wechat_cs_account_config/.test(c))process.exit(1);if(!/wxid_legacy_global/.test(c)||!/wechat_cs_config/.test(c))process.exit(1)"

- [ ] [ARTIFACT] 客户机 gate 决策模块存在（resolveSendMode + shouldReply）
  Test: node -e "const m=require('./services/agent/build-modules/line04/cs-config-gate.js');if(typeof m.resolveSendMode!=='function'||typeof m.shouldReply!=='function')process.exit(1)"

- [ ] [ARTIFACT] 前台「每客服设置区」UI 存在（apps/dashboard 编辑该客服那一行）
  Test: node -e "const cp=require('child_process');const o=cp.execSync('grep -rl \"cs/config\" apps/dashboard/src 2>/dev/null || true').toString();if(!o.trim())process.exit(1)"

## BEHAVIOR 条目（user_facing 模式A：API-level，evaluator 直接跑 manual:bash 测真实中台 localhost:3000 + psql）

- [ ] [BEHAVIOR] 按微信号写两客服那一行物理隔离，互不覆盖（钉死 Issue defe1a42 串台）
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; PA='"'"'{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]}}'"'"'; PB='"'"'{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]}}'"'"'; curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H "Content-Type: application/json" -d "$PA" | jq -e ".success == true and .config.persona.self_name == \"萌萌\"" >/dev/null || exit 1; curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H "Content-Type: application/json" -d "$PB" | jq -e ".success == true" >/dev/null || exit 1; curl -sf "$API/api/wechat/cs/config/wxid_csa" | jq -e ".persona.self_name == \"萌萌\"" >/dev/null || exit 1; curl -sf "$API/api/wechat/cs/config/wxid_csb" | jq -e ".persona.self_name == \"天下第一\"" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] DB 两独立行（按微信号 key 物理分行，5 分钟时间窗防伪）
  Test: manual:bash -c 'DB=${DB:-postgresql://localhost/cecelia}; C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN ('"'"'wxid_csa'"'"','"'"'wxid_csb'"'"') AND updated_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" = "2" ] || { echo "FAIL: 期望两独立行 实际 $C"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 客户机按注册号身份拉到「自己那份」（人设/白名单各取各）
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csa" -H "Content-Type: application/json" -d '"'"'{"persona":{"self_name":"萌萌","address_style":"x","tone":"x","sentence_style":"x","use_emoji":"x","banned_phrases":[],"few_shot":[]},"whitelist":["客户甲"]}'"'"' | jq -e ".success == true" >/dev/null || exit 1; curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa" | jq -e ".persona.self_name == \"萌萌\" and ((.whitelist | index(\"客户甲\")) != null)" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 未注册微信号拉配置 → 403 拒绝且响应体不泄漏任意 persona
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; CODE=$(curl -s -o /tmp/unreg.json -w "%{http_code}" "$API/api/wechat/cs/agent-config?wechat_id=wxid_never_registered_zzz"); [ "$CODE" = "403" ] || { echo "FAIL: 未注册号未拒绝 code=$CODE"; exit 1; }; jq -e "has(\"persona\") | not" /tmp/unreg.json >/dev/null || { echo "FAIL: 泄漏了 persona"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 身份校验失败写诊断异常（诊断页可见 + DB 5 分钟时间窗防伪）
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; DB=${DB:-postgresql://localhost/cecelia}; curl -s -o /dev/null "$API/api/wechat/cs/agent-config?wechat_id=wxid_never_registered_zzz"; curl -sf "$API/api/wechat/cs/diagnostics" | jq -e "[.alerts[] | select(.wechat_id == \"wxid_never_registered_zzz\")] | length >= 1" >/dev/null || { echo "FAIL: 诊断页无此异常"; exit 1; }; C=$(psql "$DB" -t -c "SELECT count(*) FROM zenithjoy.wechat_cs_identity_alert WHERE wechat_id='"'"'wxid_never_registered_zzz'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || { echo "FAIL: 诊断异常未入库"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 真发 gate 跟随该客服 auto_agent_enabled（默认 OFF=dryrun，开启后拉到 ON）
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa" | jq -e ".auto_agent_enabled == false" >/dev/null || { echo "FAIL: 新客服默认非 dryrun"; exit 1; }; curl -sf -X PUT "$API/api/wechat/cs/config/wxid_csb" -H "Content-Type: application/json" -d '"'"'{"persona":{"self_name":"天下第一","address_style":"y","tone":"y","sentence_style":"y","use_emoji":"y","banned_phrases":[],"few_shot":[]},"auto_agent_enabled":true}'"'"' | jq -e ".config.auto_agent_enabled == true" >/dev/null || exit 1; curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb" | jq -e ".auto_agent_enabled == true" >/dev/null || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 客户机 gate 决策纯函数：ON+拉成功=real，OFF=dryrun，ON+拉失败=强制 dryrun（绝不误真发）
  Test: manual:bash -c 'node -e '"'"'const {resolveSendMode}=require("./services/agent/build-modules/line04/cs-config-gate.js"); const ok=resolveSendMode({auto_agent_enabled:true},true)==="real"&&resolveSendMode({auto_agent_enabled:false},true)==="dryrun"&&resolveSendMode({auto_agent_enabled:true},false)==="dryrun"; if(!ok){console.error("FAIL: gate 决策错误");process.exit(1)}'"'"' && echo OK'
  期望: OK

- [ ] [BEHAVIOR] 第二台客户机各拉各配置互不串（交叉断言 persona 不相等）
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; A=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csa"); B=$(curl -sf "$API/api/wechat/cs/agent-config?wechat_id=wxid_csb"); echo "$A" | jq -e ".persona.self_name == \"萌萌\"" >/dev/null || exit 1; echo "$B" | jq -e ".persona.self_name == \"天下第一\"" >/dev/null || exit 1; [ "$(echo "$A" | jq -r .persona.self_name)" != "$(echo "$B" | jq -r .persona.self_name)" ] || { echo "FAIL: 人设串台"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — PUT 非法 body（空 persona）→ 400 INVALID_BODY
  Test: manual:bash -c 'API=${API_BASE:-http://localhost:3000}; CODE=$(curl -s -o /tmp/badbody.json -w "%{http_code}" -X PUT "$API/api/wechat/cs/config/wxid_csa" -H "Content-Type: application/json" -d '"'"'{"persona":{}}'"'"'); [ "$CODE" = "400" ] || { echo "FAIL: 非法 body 未返 400 code=$CODE"; exit 1; }; jq -e ".error == \"INVALID_BODY\"" /tmp/badbody.json >/dev/null || { echo "FAIL: error 码不符"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 迁移向后兼容 — 存量全局 wechat_cs_config 迁为 legacy 现客服那一行（幂等）
  Test: manual:bash -c 'DB=${DB:-postgresql://localhost/cecelia}; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_config(key,value) VALUES ('"'"'persona'"'"','"'"'{\"self_name\":\"存量小助手\",\"address_style\":\"\",\"tone\":\"\",\"sentence_style\":\"\",\"use_emoji\":\"\",\"banned_phrases\":[],\"few_shot\":[]}'"'"') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value" >/dev/null; ( cd apps/api && npm run migrate ) >/dev/null 2>&1; psql "$DB" -t -c "SELECT persona->>'"'"'self_name'"'"' FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='"'"'wxid_legacy_global'"'"'" | grep -q "存量小助手" || { echo "FAIL: 存量人设未迁移"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — 见 contract-draft.md ## E2E 验收 e2e-verify.ps1）

- [ ] [BEHAVIOR:E2E] 管理员在前台「每客服设置区」编辑某客服那一行并保存，落库该行不污染其他客服；截图可视化验证
  Screenshots:
    - 01-initial.png   期望：每客服设置区初始加载，客服微信号输入框 + 人设/开关/白名单字段可见
    - 02-action.png    期望：填入客服 A 微信号 + 人设「萌萌」并点保存后，保存成功提示可见
    - 03-result.png    期望：重新加载该客服那一行，人设回显「萌萌」；另一客服行不受影响
  期望：所有截图与期望描述一致，Claude Read 图自验通过；截图存入 ${SPRINT_DIR}/screenshots/<step>.png
