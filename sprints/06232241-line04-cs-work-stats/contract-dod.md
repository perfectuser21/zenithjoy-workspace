---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: 客服工作汇总统计页（每台客服机今天/昨天 4 数据）

**范围**: cs_memory_messages 加 cs_wechat_id（nullable）+ 索引；落库盖身份章；`GET /api/wechat/cs/stats?date=today|yesterday`（北京时区聚合）；dashboard「客服工作汇总」页 + 今天/昨天切换 + Line04 区挂路由。
**大小**: M
**target_environment**: windows_cloud（UI mode-B）/ 真实 apps/api + DB（口径 mode-A）

## ARTIFACT 条目

- [ ] [ARTIFACT] 迁移文件加 cs_wechat_id（nullable）+ 索引 (cs_wechat_id, created_at)
  Test: manual:bash -c 'F=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages*.sql 2>/dev/null | head -1); [ -n "$F" ] || { echo FAIL no-migration; exit 1; }; node -e "const c=require(\"fs\").readFileSync(process.argv[1],\"utf8\").toLowerCase();if(!/alter table\s+zenithjoy\.cs_memory_messages/.test(c))process.exit(1);if(!/add column.*cs_wechat_id/.test(c))process.exit(1);if(/cs_wechat_id\s+text\s+not\s+null/.test(c))process.exit(1);if(!/create index.*cs_wechat_id.*created_at/s.test(c))process.exit(1);console.log(\"OK\")" "$F"'
  期望: OK

- [ ] [ARTIFACT] GET /cs/stats 路由在 wechat.ts 注册（挂 /api/wechat）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/wechat.ts\",\"utf8\");if(!/[\x27\x22\x60]\/cs\/stats[\x27\x22\x60]/.test(c)){console.error(\"FAIL: 未注册 /cs/stats\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

- [ ] [ARTIFACT] dashboard 客服工作汇总页 + Line04 路由挂载
  Test: manual:bash -c 'test -f apps/dashboard/src/pages/CsWorkStatsPage.tsx || { echo FAIL no-page; exit 1; }; node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");if(!/cs-?stats|CsWorkStatsPage/.test(c)){console.error(\"FAIL: 路由未挂\");process.exit(1)}console.log(\"OK\")"'
  期望: OK

## BEHAVIOR 条目（mode-A：真实 apps/api + 真 DB；命令与 contract-draft.md 验证命令对应）

- [ ] [BEHAVIOR] 落库盖身份章：cs_memory_messages 行 cs_wechat_id = 配置微信号（接缝 1，真写入路径，禁 mock）
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; TK="cswstat-$$-$RANDOM"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES (\x27t_$TK\x27,\x27c\x27,\x27in\x27,\x27hi\x27,\x27wxid_$TK\x27)"; R=$(psql "$DB" -t -c "SELECT cs_wechat_id FROM zenithjoy.cs_memory_messages WHERE tenant_id=\x27t_$TK\x27 AND cs_wechat_id IS NOT NULL" | tr -d " "); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id=\x27t_$TK\x27"; [ "$R" = "wxid_$TK" ] || { echo "FAIL got=$R"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] today 口径精确：received=3 reply=2 served=2 work_minutes=17
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; TK="cswstat-$$-$RANDOM"; W="wxid_$TK"; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES (\x27$W\x27,\x27{\"name\":\"cs\"}\x27::jsonb)"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES (\x27t\x27,\x27c1\x27,\x27in\x27,\x27q\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2710:00\x27)),(\x27t\x27,\x27c1\x27,\x27out\x27,\x27a\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2710:05\x27)),(\x27t\x27,\x27c1\x27,\x27in\x27,\x27q\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2710:10\x27)),(\x27t\x27,\x27c2\x27,\x27in\x27,\x27q\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2710:15\x27)),(\x27t\x27,\x27c2\x27,\x27out\x27,\x27a\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2710:17\x27))"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); CARD=$(echo "$RESP" | jq -c ".cards[] | select(.cs_wechat_id==\"$W\")"); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id=\x27$W\x27; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id=\x27$W\x27;"; echo "$CARD" | jq -e ".received_count==3 and .reply_count==2 and .served_customers==2 and .work_duration_minutes==17" || { echo "FAIL card=$CARD"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 顶层 schema 完整 + 禁用字段不漏网
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; W="wxid_schema_$$"; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES (\x27$W\x27,\x27{\"name\":\"s\"}\x27::jsonb)"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES (\x27t\x27,\x27c\x27,\x27in\x27,\x27x\x27,\x27$W\x27)"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); CARD=$(echo "$RESP" | jq -c ".cards[] | select(.cs_wechat_id==\"$W\")"); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id=\x27$W\x27; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id=\x27$W\x27;"; echo "$RESP" | jq -e "keys == [\"cards\",\"date\",\"ok\"]" || { echo FAIL toplevel; exit 1; }; echo "$CARD" | jq -e "(has(\"in_count\") or has(\"out_count\") or has(\"received\") or has(\"replies\") or has(\"served\") or has(\"duration\") or has(\"minutes\")) | not" || { echo FAIL 禁用字段; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 数据隔离：A 的数绝不出现在 B 的卡片
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; TK="$$_$RANDOM"; A="wxidA_$TK"; B="wxidB_$TK"; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES (\x27$A\x27,\x27{\"name\":\"A\"}\x27::jsonb),(\x27$B\x27,\x27{\"name\":\"B\"}\x27::jsonb)"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES (\x27t\x27,\x27ca\x27,\x27in\x27,\x27x\x27,\x27$A\x27),(\x27t\x27,\x27cb\x27,\x27in\x27,\x27y\x27,\x27$B\x27),(\x27t\x27,\x27cb\x27,\x27in\x27,\x27z\x27,\x27$B\x27)"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id IN (\x27$A\x27,\x27$B\x27); DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id IN (\x27$A\x27,\x27$B\x27);"; echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$A\") | .received_count==1" || { echo FAIL A; exit 1; }; echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$B\") | .received_count==2" || { echo FAIL B; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 时区：北京今天 00:30 的消息仍归 today
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; W="wxidTZ_$$"; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES (\x27$W\x27,\x27{\"name\":\"tz\"}\x27::jsonb)"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES (\x27t\x27,\x27c\x27,\x27in\x27,\x27x\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,(now() AT TIME ZONE \x27Asia/Shanghai\x27)::date+time \x2700:30\x27))"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id=\x27$W\x27; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id=\x27$W\x27;"; echo "$RESP" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==1" || { echo FAIL tz; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 老数据兼容：cs_wechat_id=NULL 不计入、接口不报错
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; TK="$$_$RANDOM"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id) VALUES (\x27t_$TK\x27,\x27cnull\x27,\x27in\x27,\x27orphan\x27,NULL)"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}") || { echo "FAIL: NULL 致接口报错"; exit 1; }; psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE tenant_id=\x27t_$TK\x27"; echo "$RESP" | jq -e ".ok == true and ([.cards[] | select(.cs_wechat_id==null)] | length == 0)" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 切昨天：date=yesterday 有数、date=today 为 0
  Test: manual:bash -c 'DB="${DATABASE_URL:-postgresql://localhost/cecelia}"; API="${API_BASE:-http://localhost:3000}"; W="wxidY_$$"; psql "$DB" -c "INSERT INTO zenithjoy.wechat_cs_account_config (wechat_id,persona) VALUES (\x27$W\x27,\x27{\"name\":\"y\"}\x27::jsonb)"; psql "$DB" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES (\x27t\x27,\x27c\x27,\x27in\x27,\x27x\x27,\x27$W\x27,timezone(\x27Asia/Shanghai\x27,((now() AT TIME ZONE \x27Asia/Shanghai\x27)::date-1)+time \x2712:00\x27))"; RY=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); RT=$(curl -sf "$API/api/wechat/cs/stats?date=today" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); psql "$DB" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id=\x27$W\x27; DELETE FROM zenithjoy.wechat_cs_account_config WHERE wechat_id=\x27$W\x27;"; echo "$RY" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==1" || { echo FAIL yesterday; exit 1; }; echo "$RT" | jq -e ".cards[] | select(.cs_wechat_id==\"$W\") | .received_count==0" || { echo FAIL today; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：date 非法返 400 + error 字段
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:3000}"; CODE=$(curl -s -o /tmp/cswstat_err.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=lastweek" -H "X-Internal-Token: ${ZENITHJOY_INTERNAL_TOKEN:-}"); [ "$CODE" = "400" ] || { echo "FAIL code=$CODE"; exit 1; }; jq -e ".error | type == \"string\"" /tmp/cswstat_err.json || { echo FAIL no-error-field; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑 — windows_cloud 真浏览器，接缝 2）

- [ ] [BEHAVIOR:E2E] 用户打开「客服工作汇总」页走完 today→yesterday 切换，截图可视化验证
  Screenshots:
    - 01-initial.png   期望：「客服工作汇总」页加载，至少一张客服机卡片可见，顶部含「今天/昨天」切换 tab
    - 02-action.png    期望：today 视图，卡片 4 个口径数（接收/回复/接待/工作分钟）文本均可见
    - 03-result.png    期望：点「昨天」后卡片仍可见，received 数字相对 today 已变化
  期望：所有截图与期望描述一致，Claude Read 图自验通过；evaluator 验收后截图存入 ${SPRINT_DIR}/screenshots/

> 注：本 E2E 数据依赖见 contract-draft.md `## E2E 验收` 的 **[CI_GAP]**（e2e-windows.yml 需补 postgres+migration+apps/api，或 Playwright page.route 注入 fixture）。未补齐前 UI 数据驱动断言标 logic-done-pending。
