---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line04 客服工作汇总统计页（每台客服机今天/昨天 4 个数）

**范围**: cs_memory_messages 加 cs_wechat_id（nullable）+ 索引；落库盖客服身份章（真实 INSERT 路径 = `appendTenantMessage` @ tenant-memory.ts）；`GET /api/wechat/cs/stats?date=today|yesterday` 按北京时区聚合每客服 4 数 + mode；dashboard「客服工作汇总」页（每客服一卡 + 今天/昨天切换 + 真发/演练标）；smoke + Playwright 接进可运行 GHA
**大小**: M

> **SSOT 声明（修问题3 internal_consistency）**：本文件（contract-dod.md）是 evaluator 唯一执行来源。contract-draft.md 的每条 Step 验证命令与本文件 [BEHAVIOR] 一一镜像、断言数字字面相等（received=5 / reply=3 / served=2 / **work_duration_minutes=30** / mode live·dryrun）。口径/mode 种子由 `fixtures/seed-stats.sql` 单一来源驱动，draft、dod、smoke 三处都 `psql -v RUN=.. -f fixtures/seed-stats.sql`，不再各写各的 INSERT（杜绝漂移）。

## ARTIFACT 条目

- [ ] [ARTIFACT] migration 文件含 cs_wechat_id 列（IF NOT EXISTS 幂等）+ 索引 (cs_wechat_id, created_at)
  Test: bash -c 'MIG=$(ls apps/api/db/migrations/*add_cs_wechat_id_to_cs_memory_messages.sql | head -1); node -e "const fs=require(\"fs\");const r=fs.readFileSync(process.argv[1],\"utf8\");if(!/ADD COLUMN IF NOT EXISTS\s+cs_wechat_id/i.test(r))process.exit(1);if(!/CREATE INDEX IF NOT EXISTS.*\(cs_wechat_id,\s*created_at\)/is.test(r))process.exit(1)" "$MIG"'

- [ ] [ARTIFACT] 落库盖章（修：真实 INSERT 路径 = appendTenantMessage @ tenant-memory.ts，非 wechat-draft.ts）：cs_memory_messages 的 INSERT 写入 cs_wechat_id 身份章，且调用方路由 wechat-memory.ts 解析并传入
  Test: node -e "const fs=require('fs');const t=fs.readFileSync('apps/api/src/services/wechat/tenant-memory.ts','utf8');if(!/INSERT INTO zenithjoy\.cs_memory_messages[\s\S]{0,400}cs_wechat_id/.test(t))process.exit(1);const r=fs.readFileSync('apps/api/src/routes/wechat-memory.ts','utf8');if(!r.includes('cs_wechat_id'))process.exit(1)"

- [ ] [ARTIFACT] GET /api/wechat/cs/stats 路由就位（routes/wechat.ts）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/wechat.ts','utf8');if(!/cs\/stats/.test(c))process.exit(1)"

- [ ] [ARTIFACT] dashboard 汇总页组件存在 + 路由注册（挂 Line04 私域客服区）
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/CsWorkSummaryPage.tsx');const n=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!n.includes('CsWorkSummaryPage'))process.exit(1)"

- [ ] [ARTIFACT] 口径/mode 种子 + 清理 fixtures 就位（smoke/dod 唯一 SSOT）
  Test: node -e "const fs=require('fs');const s=fs.readFileSync('sprints/06232241-line04-cs-work-stats/fixtures/seed-stats.sql','utf8');if(!s.includes('cs_memory_messages')||!s.includes('Asia/Shanghai'))process.exit(1);fs.accessSync('sprints/06232241-line04-cs-work-stats/fixtures/cleanup.sql')"

- [ ] [ARTIFACT] 后端口径 smoke 脚本就位（lint-feature-has-smoke 强制）
  Test: node -e "require('fs').accessSync('.github/workflows/scripts/smoke/cs-work-stats-smoke.sh')"

- [ ] [ARTIFACT] dashboard 汇总页 Playwright spec + windows runner ps1 就位
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/cs-work-summary.spec.ts');require('fs').accessSync('sprints/06232241-line04-cs-work-stats/e2e-ui-verify.ps1')"

- [ ] [ARTIFACT] CI 接线①（修问题1）：ci-l4-e2e-smoke.yml 的 smoke-api-contract job 显式 invoke cs-work-stats-smoke.sh，且该 step 注入 DATABASE_URL（ci-l4 原仅有 PG 拆分变量，smoke 用 psql "$DATABASE_URL" 需补）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci-l4-e2e-smoke.yml','utf8');if(!c.includes('cs-work-stats-smoke.sh'))process.exit(1);if(!/DATABASE_URL:\s*postgres(ql)?:\/\//.test(c))process.exit(1)"

- [ ] [ARTIFACT] CI 接线②（修问题1）：e2e-line04-cs-work-stats.yml 有 windows-latest job 跑 cs-work-summary（经 e2e-ui-verify.ps1），且 paths 触发含本 sprint 路径
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/e2e-line04-cs-work-stats.yml','utf8');if(!/windows-latest/.test(c))process.exit(1);if(!/(e2e-ui-verify\.ps1|cs-work-summary)/.test(c))process.exit(1);if(!c.includes('sprints/06232241-line04-cs-work-stats'))process.exit(1)"

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑；API=${API_BASE:-http://localhost:5200}，DATABASE_URL 由 CI step 注入）

- [ ] [BEHAVIOR] 口径精确 + 字段完整性：seed-stats（5 in + 3 out，2 客户，首条09:00 末条09:30）→ /cs/stats?date=today 该卡 received_count=5 / reply_count=3 / served_customers=2 / **work_duration_minutes=30**；卡 keys 完整等于 8 个约定字段；10 个禁用 drift 字段一个都不许出现
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; SD="sprints/06232241-line04-cs-work-stats/fixtures"; RUN="dod-stats-$$-$RANDOM"; psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/seed-stats.sql" >/dev/null; CARD=$(curl -sf "$API/api/wechat/cs/stats?date=today" | jq -c --arg w "$RUN" ".agents[]|select(.cs_wechat_id==\$w)"); psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/cleanup.sql" >/dev/null; echo "$CARD" | jq -e ".received_count==5 and .reply_count==3 and .served_customers==2 and .work_duration_minutes==30" >/dev/null || { echo "FAIL 口径: $CARD"; exit 1; }; echo "$CARD" | jq -e "keys==[\"cs_name\",\"cs_wechat_id\",\"mode\",\"online\",\"received_count\",\"reply_count\",\"served_customers\",\"work_duration_minutes\"]" >/dev/null || { echo "FAIL keys 完整性: $CARD"; exit 1; }; echo "$CARD" | jq -e "[to_entries[].key]|map(select(.==\"in_count\" or .==\"out_count\" or .==\"messages_received\" or .==\"reply\" or .==\"replies\" or .==\"customer_count\" or .==\"duration\" or .==\"duration_minutes\" or .==\"minutes\" or .==\"wxid\"))|length==0" >/dev/null || { echo "FAIL 禁用字段漏网: $CARD"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] mode 真发/演练标（修问题2b 后端 oracle）：seed-stats 含 live(auto_agent_enabled=true) 卡 + dry(false) 卡 → RUN 卡 mode="live"、RUN-dry 卡 mode="dryrun"
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; SD="sprints/06232241-line04-cs-work-stats/fixtures"; RUN="dod-mode-$$-$RANDOM"; psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/seed-stats.sql" >/dev/null; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today"); psql "$DATABASE_URL" -v RUN="$RUN" -f "$SD/cleanup.sql" >/dev/null; echo "$RESP" | jq -e --arg w "$RUN" ".agents[]|select(.cs_wechat_id==\$w)|.mode==\"live\"" >/dev/null || { echo "FAIL: live 卡 mode!=live"; exit 1; }; echo "$RESP" | jq -e --arg w "$RUN-dry" ".agents[]|select(.cs_wechat_id==\$w)|.mode==\"dryrun\"" >/dev/null || { echo "FAIL: dry 卡 mode!=dryrun"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 信封 schema：/cs/stats 返回 ok=true / timezone="Asia/Shanghai" / date 回显请求值
  Test: manual:bash -c 'API="${API_BASE:-http://localhost:5200}"; RESP=$(curl -sf "$API/api/wechat/cs/stats?date=today"); echo "$RESP" | jq -e ".ok==true and .timezone==\"Asia/Shanghai\" and .date==\"today\"" >/dev/null || { echo "FAIL 信封: $RESP"; exit 1; }; echo OK'
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

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e 跑，windows_cloud GHA Playwright，经 e2e-line04-cs-work-stats.yml windows-latest job）

- [ ] [BEHAVIOR:E2E] 管理员打开「客服工作汇总」页 → 看到每客服一卡 4 数 + 真发标 → 切「昨天」4 数变化，截图可视化验证
  Test: 见 contract-draft.md ## E2E 验收 (b) — apps/dashboard/e2e/cs-work-summary.spec.ts，由 sprints/06232241-line04-cs-work-stats/e2e-ui-verify.ps1 在 windows-latest 上跑（page.route 拦后端，纯前端渲染逻辑）
  Screenshots:
    - 01-initial.png   期望：「客服工作汇总」页加载，今天/昨天切换控件可见
    - 02-action.png    期望：客服卡片可见，received=10 / reply=8 / served=3 / 真发标，4 数渲染正确
    - 03-result.png    期望：点「昨天」后同一卡片 received=2 / reply=1，数字切换为昨天的值
  路径格式：${SPRINT_DIR}/screenshots/<step>.png
  期望：所有截图与期望描述一致，Claude Read 图自验通过
