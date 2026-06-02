---
skeleton: false
journey_type: user_facing
target_environment: local_api
---
# Contract DoD — Sprint: Path 4 Step 1 第一刀 — 微信 iLink 客户端通道（thin）

**范围**: 把腾讯官方 iLink HTTP JSON 协议（openclaw-weixin 移植）落地进 apps/api，跑通「扫码绑号 → 长轮询收私聊 → DeepSeek 单轮回复 → 自动 sendmessage → 写飞书 Lead」最小闭环。第一刀只贯穿，不加厚（无审核台 / 无频控 / 无多号 / 无群聊朋友圈媒体 / 无主动 outreach）。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/services/ilink-types.ts` 含 errcode -14 与 Update/Message/SendMessageRequest 三类类型定义
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ilink-types.ts','utf8');if(!c.includes('-14')||!/Update|SendMessage/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/services/ilink-client.ts` 暴露 getupdates / sendmessage / getconfig 三个调用入口
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ilink-client.ts','utf8');for(const fn of ['getupdates','sendmessage','getconfig'])if(!c.includes(fn))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/services/ilink-auth.ts` 含扫码登录流程（拉二维码 + 轮询登录态 + 拿 Bearer token）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ilink-auth.ts','utf8');if(!/qr|QR|qrcode/.test(c)||!/token|Bearer/.test(c))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/services/ilink-poller.ts` 含长轮询循环 + -14 改 needs_rebind + B→E 主流程
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/ilink-poller.ts','utf8');if(!c.includes('needs_rebind')||!c.includes('callOpenRouter')||!c.includes('wechat_ilink_chat_reply'))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/routes/wechat.ts` 新增三个 iLink 端点（旧端点不动）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/wechat.ts','utf8');for(const p of ['ilink-login-start','ilink-login-status','ilink-poller-start'])if(!c.includes(p))process.exit(1)"

- [ ] [ARTIFACT] `apps/api/src/cli/wechat-ilink-login.ts` CLI 入口存在，package.json 暴露 `wechat:ilink-login` script
  Test: node -e "const fs=require('fs');const cli=fs.readFileSync('apps/api/src/cli/wechat-ilink-login.ts','utf8');const pkg=JSON.parse(fs.readFileSync('apps/api/package.json','utf8'));if(!cli.length||!(pkg.scripts&&pkg.scripts['wechat:ilink-login']))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/golden-path-4-smoke.sh` 含 Step A-F mock 链路 dryrun（≥ 5 行实质 curl/psql）
  Test: bash -c 'f=.github/workflows/scripts/smoke/golden-path-4-smoke.sh; [ -f "$f" ] || exit 1; grep -cE "(curl|psql)" "$f" | { read n; [ "$n" -ge 5 ] || exit 1; }'

- [ ] [ARTIFACT] `apps/api/scripts/mock-ilink-server.js` mock iLink + OpenRouter + 飞书三合一 fastify mock，含 `__mock/sendmessage-log`、`__mock/feishu-write-log`、`__mock/trigger-session-timeout` 调试端点
  Test: node -e "const c=require('fs').readFileSync('apps/api/scripts/mock-ilink-server.js','utf8');for(const p of ['sendmessage-log','feishu-write-log','trigger-session-timeout','getupdates','sendmessage'])if(!c.includes(p))process.exit(1)"

- [ ] [ARTIFACT] `.agent-knowledge/path-4/ilink-step1-acceptance.md` Lead 自验 evidence 模板存在（含扫码截图 / 外部号发消息 / AI 回复 / 飞书 Lead 行 / DB 查询 6 类证据位）
  Test: node -e "const c=require('fs').readFileSync('.agent-knowledge/path-4/ilink-step1-acceptance.md','utf8');for(const k of ['扫码','外部','AI 回复','飞书','agent_platform_sessions','llm_audit'])if(!c.includes(k))process.exit(1)"

## BEHAVIOR 条目（user_facing — 模式 A：API-level，evaluator 逐 ws 跑；smoke.sh 启 mock-ilink-server + apps/api 后执行）

- [ ] [BEHAVIOR] Step A — `POST /api/wechat/ilink-login-start` + mock 扫码完成后，`agent_platform_sessions` 新增一行 role=burner / platform=wechat_personal_ilink / status=bound（5 分钟时间窗）
  Test: manual:bash -c 'SR=$(curl -fs -X POST http://localhost:3000/api/wechat/ilink-login-start -H "Content-Type: application/json" -d "{\"agent_id\":\"e2e-burner-1\"}"); SID=$(echo "$SR" | jq -r ".session_id"); for i in $(seq 1 10); do ST=$(curl -fs "http://localhost:3000/api/wechat/ilink-login-status?session_id=$SID" | jq -r ".status"); [ "$ST" = "bound" ] && break; sleep 1; done; [ "$ST" = "bound" ] || exit 1; C=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.agent_platform_sessions WHERE platform='"'"'wechat_personal_ilink'"'"' AND role='"'"'burner'"'"' AND status='"'"'bound'"'"' AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step B — `POST /api/wechat/ilink-poller-start` 启动后 10 秒内 mock iLink 收到 ≥ 1 次 sendmessage（说明 getupdates → poller 拉到 → 触发后续 C-D 通路）
  Test: manual:bash -c 'curl -fs -X POST "http://localhost:3000/api/wechat/ilink-poller-start?session_id=$SESSION_ID" >/dev/null; for i in $(seq 1 10); do N=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq "length"); [ "$N" -ge 1 ] && break; sleep 1; done; [ "$N" -ge 1 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step B/Auth header — poller getupdates 请求必须携带 Bearer token 与非空 X-WECHAT-UIN
  Test: manual:bash -c 'H=$(curl -fs http://localhost:7799/__mock/last-getupdates-headers); echo "$H" | jq -e ".authorization | startswith(\"Bearer \") and (. != \"Bearer \")" || exit 1; echo "$H" | jq -e ".[\"x-wechat-uin\"] | type == \"string\" and length > 0" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step C — DeepSeek 调用落库 `llm_audit` 一行 request_purpose='wechat_ilink_chat_reply' / success=true（5 分钟时间窗）
  Test: manual:bash -c 'C=$(psql $DB -t -c "SELECT count(*) FROM zenithjoy.llm_audit WHERE request_purpose='"'"'wechat_ilink_chat_reply'"'"' AND success=true AND created_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step D — sendmessage 请求体 schema 完整（to_user_id string + context_token string + item_list 1 元素 type=text + text 非空）
  Test: manual:bash -c 'L=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq ".[-1]"); echo "$L" | jq -e ".to_user_id | type == \"string\"" || exit 1; echo "$L" | jq -e ".context_token | type == \"string\"" || exit 1; echo "$L" | jq -e ".item_list | type == \"array\" and length == 1" || exit 1; echo "$L" | jq -e ".item_list[0].type == \"text\"" || exit 1; echo "$L" | jq -e ".item_list[0].text | type == \"string\" and length > 0" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step E — lead-writer 触发飞书 writeRecord ≥ 1 次，字段含 from_user_id + context_token（便于排错追踪）
  Test: manual:bash -c 'WL=$(curl -fs http://localhost:7799/__mock/feishu-write-log); echo "$WL" | jq -e "length >= 1" || exit 1; echo "$WL" | jq -e ".[-1].fields | keys | any(. == \"from_user_id\") and any(. == \"context_token\")" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Step F — 触发 mock 切到 -14 后，15 秒内 DB session.status 改为 `needs_rebind`，且 poller 已停（5 秒内 sendmessage-log 数量不再增长）
  Test: manual:bash -c 'curl -fs -X POST http://localhost:7799/__mock/trigger-session-timeout; for i in $(seq 1 15); do ST=$(psql $DB -t -c "SELECT status FROM zenithjoy.agent_platform_sessions WHERE platform='"'"'wechat_personal_ilink'"'"' AND role='"'"'burner'"'"' ORDER BY created_at DESC LIMIT 1" | tr -d " "); [ "$ST" = "needs_rebind" ] && break; sleep 1; done; [ "$ST" = "needs_rebind" ] || exit 1; B=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq "length"); sleep 5; A=$(curl -fs http://localhost:7799/__mock/sendmessage-log | jq "length"); [ "$B" = "$A" ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] Error path — `GET /api/wechat/ilink-login-status?session_id=invalid-id` 必须返 4xx + error 字段（不可静默返 200 / 不可 500）
  Test: manual:bash -c 'RESP=$(curl -s -w "\n%{http_code}" "http://localhost:3000/api/wechat/ilink-login-status?session_id=does-not-exist-xyz"); CODE=$(echo "$RESP" | tail -1); BODY=$(echo "$RESP" | head -n -1); { [ "$CODE" = "404" ] || [ "$CODE" = "400" ]; } || exit 1; echo "$BODY" | jq -e ".error | type == \"string\"" || exit 1; echo OK'
  期望: OK
