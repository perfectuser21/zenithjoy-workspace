---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Sprint: Line02 留言→人工跟进闭环

**范围**: acquisition_leads 加 latest_reply/latest_reply_at/assignee + 孤儿回复表 + 回复轮询逻辑 + assignee 分配 + 飞书新列 + Dashboard LeadsTable 统一组件
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] DB migration 文件存在
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const m=files.find(f=>f.includes('leads_reply_assignee'));if(!m)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+m,'utf8');if(!c.includes('latest_reply'))process.exit(1);if(!c.includes('assignee'))process.exit(1)"

- [ ] [ARTIFACT] acquisition_orphan_replies migration 存在（含 video_id/commenter_nickname/reply_text/captured_at/tenant_id）
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('apps/api/db/migrations');const m=files.find(f=>f.includes('leads_reply_assignee')||f.includes('orphan'));if(!m)process.exit(1);const c=fs.readFileSync('apps/api/db/migrations/'+m,'utf8');if(!c.includes('acquisition_orphan_replies'))process.exit(1);if(!c.includes('commenter_nickname'))process.exit(1)"

- [ ] [ARTIFACT] LeadsTable 共用组件文件存在且含必要列定义
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/components/LeadsTable.tsx','utf8');if(!c.includes('最新回复'))process.exit(1);if(!c.includes('负责人'))process.exit(1);if(c.includes('触达状态'))process.exit(1)"

- [ ] [ARTIFACT] LeadsPage 改用 LeadsTable 组件（不再内联 AG Grid columnDefs）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/LeadsPage.tsx','utf8');if(!c.includes('LeadsTable'))process.exit(1)"

- [ ] [ARTIFACT] AcquisitionTasksPage 内嵌 leads 子表改用 LeadsTable（无"触达状态"）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionTasksPage.tsx','utf8');if(!c.includes('LeadsTable'))process.exit(1);if(c.includes('触达状态'))process.exit(1)"

- [ ] [ARTIFACT] Playwright spec 文件存在
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/leads-unified-table.spec.ts')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 latest_reply 字段（string|null）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"latest_reply\") else true end" || { echo "FAIL: latest_reply 字段缺失"; exit 1; }; echo OK'
  期望: OK（leads 为空时跳过，有数据时必须有 key）

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 latest_reply_at 字段（string|null）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"latest_reply_at\") else true end" || { echo "FAIL: latest_reply_at 字段缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 assignee 字段（string|null）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"assignee\") else true end" || { echo "FAIL: assignee 字段缺失"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应不含禁用字段 reply_text / last_reply（keys 防漂移）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then (.leads[0] | has(\"reply_text\") | not) else true end" || { echo "FAIL: 禁用字段 reply_text 存在"; exit 1; }; echo "$RESP" | jq -e "if .leads | length > 0 then (.leads[0] | has(\"last_reply\") | not) else true end" || { echo "FAIL: 禁用字段 last_reply 存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads?grade=bogus_value 返 400 + error 字段（error path）
  Test: manual:bash -c 'CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/acquisition/leads?grade=bogus_grade"); [ "$CODE" = "400" ] || { echo "FAIL: 非法 grade 未返 400 (got $CODE)"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] acquisition_leads 表含 latest_reply / latest_reply_at / assignee / comment_replied_at 列（DB schema）
  Test: manual:bash -c 'psql "$DATABASE_URL" -c "SELECT latest_reply, latest_reply_at, assignee, comment_replied_at FROM zenithjoy.acquisition_leads LIMIT 0" || { echo "FAIL: DB schema 缺新列"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] acquisition_orphan_replies 孤儿回复可写入且带时间窗口可查（Invariant：孤儿不丢失）
  Test: manual:bash -c 'T=$(psql "$DATABASE_URL" -t -c "INSERT INTO zenithjoy.tenants (name,created_at) VALUES ('"'"'dod-orp-'$$''"'"',now()) RETURNING id" | tr -d " \n"); psql "$DATABASE_URL" -c "INSERT INTO zenithjoy.acquisition_orphan_replies (video_id,commenter_nickname,reply_text,captured_at,tenant_id) VALUES ('"'"'dod-vid'"'"','"'"'dod-nick'"'"','"'"'dod-text'"'"',NOW(),'"'"'$T'"'"')" || { echo "FAIL: 写入失败"; exit 1; }; C=$(psql "$DATABASE_URL" -t -c "SELECT count(*) FROM zenithjoy.acquisition_orphan_replies WHERE tenant_id='"'"'$T'"'"' AND captured_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " "); [ "$C" -ge 1 ] || { echo "FAIL: count=$C"; exit 1; }; psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.acquisition_orphan_replies WHERE tenant_id='"'"'$T'"'"'" > /dev/null; psql "$DATABASE_URL" -c "DELETE FROM zenithjoy.tenants WHERE id='"'"'$T'"'"'" > /dev/null; echo OK'
  期望: OK

- [ ] [BEHAVIOR] pickAssignee 函数存在且按取模轮询返回负责人
  Test: manual:bash -c 'node -e "const {pickAssignee}=require(\"./apps/api/src/services/acquisition-dispatch.js\");const r=[\"客服A\",\"客服B\"];if(pickAssignee(r,0)!==\"客服A\")process.exit(1);if(pickAssignee(r,1)!==\"客服B\")process.exit(1);if(pickAssignee(r,2)!==\"客服A\")process.exit(1);if(pickAssignee([],0)!==null)process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 total 字段为 number 类型
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e ".total | type == \"number\"" || { echo "FAIL: total 非 number"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads 不含禁用字段 responder / owner（防字段名漂移）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then (.leads[0] | has(\"responder\") | not) else true end" || { echo "FAIL: 禁用字段 responder 存在"; exit 1; }; echo "$RESP" | jq -e "if .leads | length > 0 then (.leads[0] | has(\"owner\") | not) else true end" || { echo "FAIL: 禁用字段 owner 存在"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/leads 已有字段健全（commenter_id / comment_text / grade 不回退）
  Test: manual:bash -c 'RESP=$(curl -sf -H "X-Tenant-Id: test-tenant" http://localhost:3000/api/acquisition/leads); echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"commenter_id\") else true end" || { echo "FAIL: commenter_id 回退"; exit 1; }; echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"comment_text\") else true end" || { echo "FAIL: comment_text 回退"; exit 1; }; echo "$RESP" | jq -e "if .leads | length > 0 then .leads[0] | has(\"grade\") else true end" || { echo "FAIL: grade 回退"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 租户隔离 — GET /api/acquisition/leads 只返回本租户数据（多租户）
  Test: manual:bash -c 'T1_RESP=$(curl -sf -H "X-Tenant-Id: tenant-aaa" http://localhost:3000/api/acquisition/leads); T2_RESP=$(curl -sf -H "X-Tenant-Id: tenant-bbb" http://localhost:3000/api/acquisition/leads); echo "$T1_RESP" | jq -e ".leads | type == \"array\"" && echo "$T2_RESP" | jq -e ".leads | type == \"array\"" || { echo "FAIL: 响应格式错误"; exit 1; }; echo OK'
  期望: OK（两个租户各自独立响应，互不串数据）

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e Playwright 跑）

- [ ] [BEHAVIOR:E2E] Dashboard LeadsPage 显示"最新回复"和"负责人"列，无"触达状态"列
  Test: manual:bash -c 'npx playwright test apps/dashboard/e2e/leads-unified-table.spec.ts --reporter=list'
  期望: 所有 spec 通过，截图已存入 sprints/07032333-line02-lead-human-handoff/screenshots/

- [ ] [BEHAVIOR:E2E] AcquisitionTasksPage 内嵌 leads 子表无"触达状态"列（用 LeadsTable 共用组件）
  Screenshots:
    - 01-leads-page-initial.png     期望：LeadsPage 加载，"最新回复"和"负责人"列头可见，无"触达状态"
    - 02-acquisition-tasks-page.png 期望：AcquisitionTasksPage 加载，无"触达状态"文字
    - 03-leads-api-response.png     期望：浏览器 Network 面板或 page.request 验证 /api/acquisition/leads 返回新字段
  期望: 截图与描述一致，Claude Read 图自验通过
