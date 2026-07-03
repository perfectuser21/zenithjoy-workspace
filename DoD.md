contract_branch: cp-07040325-ws-a2b672d8-ws1
sprint_dir: sprints/07032333-line02-lead-human-handoff

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

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 latest_reply 字段（string|null）
- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 latest_reply_at 字段（string|null）
- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应 lead 对象含 assignee 字段（string|null）
- [ ] [BEHAVIOR] GET /api/acquisition/leads 响应不含禁用字段 reply_text / last_reply
- [ ] [BEHAVIOR] GET /api/acquisition/leads?grade=bogus_value 返 400
- [ ] [BEHAVIOR] acquisition_leads 表含 latest_reply / latest_reply_at / assignee / comment_replied_at 列
- [ ] [BEHAVIOR] pickAssignee 函数存在且按取模轮询返回负责人
- [ ] [BEHAVIOR] pollReplies 逻辑层 4 tests pass
- [ ] [BEHAVIOR] GET /api/acquisition/leads 已有字段健全（commenter_id / comment_text / grade 不回退）
- [ ] [BEHAVIOR] 租户隔离 — GET /api/acquisition/leads 只返回本租户数据
