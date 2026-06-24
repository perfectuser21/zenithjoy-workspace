---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line04 客服工作汇总统计页（每台客服机今天/昨天 4 个数）

**范围**: cs_memory_messages 加 cs_wechat_id（nullable）+ 索引；落库盖客服身份章；`GET /api/wechat/cs/stats?date=today|yesterday` 按北京时区聚合每客服 4 数；dashboard「客服工作汇总」页（每客服一卡 + 今天/昨天切换 + 真发/演练标）
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件含 cs_wechat_id 列（IF NOT EXISTS 幂等）+ 索引 (cs_wechat_id, created_at)
  Test: bash -c 'MIG=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql | head -1); node -e "const fs=require(\"fs\");const r=fs.readFileSync(process.argv[1],\"utf8\");if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r))process.exit(1);if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r))process.exit(1)" "$MIG"'

- [ ] [ARTIFACT] 落库盖章：wechat-draft.ts 写 in/out 时带 cs_wechat_id 身份章
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/wechat-draft.ts','utf8');if(!c.includes('cs_wechat_id'))process.exit(1)"

- [ ] [ARTIFACT] dashboard 汇总页组件存在 + 路由注册（挂 Line04 私域客服区）
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/CsWorkSummaryPage.tsx');const n=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!n.includes('CsWorkSummaryPage'))process.exit(1)"

- [ ] [ARTIFACT] 后端口径 smoke 脚本就位（lint-feature-has-smoke 强制）
  Test: node -e "require('fs').accessSync('.github/workflows/scripts/smoke/cs-work-stats-smoke.sh')"

- [ ] [ARTIFACT] dashboard 汇总页 Playwright spec 就位
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/cs-work-summary.spec.ts')"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑；API=${API_BASE:-http://localhost:5200}）

- [ ] [BEHAVIOR] 口径精确：seed 5 in + 3 out（2 客户）→ /cs/stats?date=today 该客服卡 received_count=5 / reply_count=3 / served_customers=2
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; RUN="dod-cs-$$-$RANDOM"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) SELECT '"'"'t-dod'"'"','"'"'c1'"'"','"'"'in'"'"','"'"'i'"'"'||g,'"'"'$RUN'"'"',now() FROM generate_series(1,3) g UNION ALL SELECT '"'"'t-dod'"'"','"'"'c2'"'"','"'"'in'"'"','"'"'i'"'"'||g,'"'"'$RUN'"'"',now() FROM generate_series(1,2) g UNION ALL SELECT '"'"'t-dod'"'"','"'"'c1'"'"','"'"'out'"'"','"'"'o'"'"'||g,'"'"'$RUN'"'"',now() FROM generate_series(1,3) g;"; CARD=$(curl -sf "$API/api/wechat/cs/stats?date=today" | jq -c --arg w "$RUN" ".agents[]|select(.cs_wechat_id==\$w)"); psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='"'"'$RUN'"'"';"; echo "$CARD" | jq -e ".received_count==5 and .reply_count==3 and .served_customers==2" || { echo FAIL; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 信封 schema：/cs/stats 返回 ok=true / timezone="Asia/Shanghai" / 禁用字段(in_count, customer_count)不存在
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today"); echo "$RESP" | jq -e ".ok==true and .timezone==\"Asia/Shanghai\"" || { echo FAIL; exit 1; }; echo "$RESP" | jq -e "[.agents[]|select(has(\"in_count\") or has(\"customer_count\"))]|length==0" || { echo "FAIL: 禁用字段漏网"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 北京时区日界：北京今天 00:30 消息归「今天」、昨天消息归「昨天」（防 #832 美区算错）
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; RUN="dod-tz-$$-$RANDOM"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) SELECT '"'"'t-dod'"'"','"'"'cY'"'"','"'"'in'"'"','"'"'y'"'"'||g,'"'"'$RUN'"'"', ((now() AT TIME ZONE '"'"'Asia/Shanghai'"'"')::date - 1 + time '"'"'10:00'"'"') AT TIME ZONE '"'"'Asia/Shanghai'"'"' FROM generate_series(1,2) g;"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES ('"'"'t-dod'"'"','"'"'cT'"'"','"'"'in'"'"','"'"'mid'"'"','"'"'$RUN'"'"', ((now() AT TIME ZONE '"'"'Asia/Shanghai'"'"')::date + time '"'"'00:30'"'"') AT TIME ZONE '"'"'Asia/Shanghai'"'"');"; Y=$(curl -sf "$API/api/wechat/cs/stats?date=yesterday"); T=$(curl -sf "$API/api/wechat/cs/stats?date=today"); psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id='"'"'$RUN'"'"';"; echo "$Y" | jq -e --arg w "$RUN" ".agents[]|select(.cs_wechat_id==\$w)|.received_count==2" || { echo "FAIL 昨天!=2"; exit 1; }; echo "$T" | jq -e --arg w "$RUN" ".agents[]|select(.cs_wechat_id==\$w)|.received_count==1" || { echo "FAIL 北京00:30 未归今天"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 数据隔离：A(4) 与 B(1) 各算各的，A 的数绝不串到 B 卡片
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; A="dod-isoA-$$-$RANDOM"; B="dod-isoB-$$-$RANDOM"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) SELECT '"'"'t-dod'"'"','"'"'ca'"'"','"'"'in'"'"','"'"'x'"'"'||g,'"'"'$A'"'"',now() FROM generate_series(1,4) g UNION ALL SELECT '"'"'t-dod'"'"','"'"'cb'"'"','"'"'in'"'"','"'"'x'"'"'||g,'"'"'$B'"'"',now() FROM generate_series(1,1) g;"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today"); psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE cs_wechat_id IN ('"'"'$A'"'"','"'"'$B'"'"');"; echo "$RESP" | jq -e --arg w "$A" ".agents[]|select(.cs_wechat_id==\$w)|.received_count==4" || { echo "FAIL A!=4"; exit 1; }; echo "$RESP" | jq -e --arg w "$B" ".agents[]|select(.cs_wechat_id==\$w)|.received_count==1" || { echo "FAIL B!=1 串台"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 老数据兼容：cs_wechat_id=NULL 消息不计入任何客服、接口 HTTP 200 不报错
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; N="dod-null-$$-$RANDOM"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) SELECT '"'"'t-dod'"'"','"'"'$N'"'"','"'"'in'"'"','"'"'old'"'"'||g, NULL, now() FROM generate_series(1,3) g;"; psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.cs_memory_messages (tenant_id,contact,role,text,cs_wechat_id,created_at) VALUES ('"'"'t-dod'"'"','"'"'lv'"'"','"'"'in'"'"','"'"'hi'"'"','"'"'$N-live'"'"',now());"; CODE=$(curl -s -o /tmp/dod_null.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=today"); psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.cs_memory_messages WHERE contact='"'"'$N'"'"' OR cs_wechat_id='"'"'$N-live'"'"';"; [ "$CODE" = "200" ] || { echo "FAIL: NULL 致非200=$CODE"; exit 1; }; jq -e "[.agents[]|select(.cs_wechat_id==null)]|length==0" /tmp/dod_null.json || { echo "FAIL: NULL 成卡片"; exit 1; }; jq -e --arg w "$N-live" ".agents[]|select(.cs_wechat_id==\$w)|.received_count==1" /tmp/dod_null.json || { echo "FAIL: 正常客服漏计"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path：非法 date=garbage → HTTP 400 + error 字段为 string
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; CODE=$(curl -s -o /tmp/dod_bad.json -w "%{http_code}" "$API/api/wechat/cs/stats?date=garbage"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 date 未返 400=$CODE"; exit 1; }; jq -e ".error | type==\"string\"" /tmp/dod_bad.json || { echo "FAIL: 缺 error 字段"; exit 1; }; echo OK'
  期望: OK

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，windows_cloud GHA Playwright）

- [ ] [BEHAVIOR:E2E] 管理员打开「客服工作汇总」页 → 看到每客服一卡 4 数 + 真发标 → 切「昨天」4 数变化，截图可视化验证
  Test: 见 contract-draft.md ## E2E 验收 (b) — apps/dashboard/e2e/cs-work-summary.spec.ts（windows_cloud GHA windows-latest）
  Screenshots:
    - 01-initial.png   期望：「客服工作汇总」页加载，今天/昨天切换控件可见
    - 02-action.png    期望：客服卡片可见，received=10 / reply=8 / served=3 / 真发标，4 数渲染正确
    - 03-result.png    期望：点「昨天」后同一卡片 received=2 / reply=1，数字切换为昨天的值
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：所有截图与期望描述一致，Claude Read 图自验通过
