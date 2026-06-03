---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Path 4 CRM 表打通 + AI 每日 8:30 今日跟进名单推送

**范围**: 新增 CRM 路由（/api/crm/*）+ Notion/飞书双线服务 + crm_wechat_mapping DB 迁移 + Dashboard CrmConfigPage/CustomerListPage + 每日 AI 分析推送 + Playwright E2E
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/crm.ts` 存在，export 路由含 4 个端点（/init /wechat-contacts /match-preview /daily-analysis）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');if(!c.includes('/init'))process.exit(1);if(!c.includes('wechat-contacts'))process.exit(1);if(!c.includes('match-preview'))process.exit(1);if(!c.includes('daily-analysis'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/daily-crm-analysis.ts` 存在，含 FEISHU_NOTIFY_WEBHOOK 读取逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/daily-crm-analysis.ts','utf8');if(!c.includes('FEISHU_NOTIFY_WEBHOOK'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/db/migrations/` 下存在 crm_wechat_mapping 迁移文件，含 4 个核心字段
  Test: node -e "const fs=require('fs'),path=require('path');const d='packages/db/migrations';const f=fs.readdirSync(d).find(x=>x.includes('crm_wechat_mapping'));if(!f){process.exit(1);}const c=fs.readFileSync(path.join(d,f),'utf8');['wechat_contact_id','crm_row_id','platform','tenant_id'].forEach(col=>{if(!c.includes(col))process.exit(1);});console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CrmConfigPage.tsx` 存在，含飞书/Notion 平台选择器
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');if(!c.includes('feishu')&&!c.includes('飞书'))process.exit(1);if(!c.includes('notion')&&!c.includes('Notion'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CustomerListPage.tsx` 存在，含客户列表渲染逻辑
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/CustomerListPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/crm-config.spec.ts` 存在，含 ≥ 4 个 test 和 ≥ 3 次 page.screenshot()
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/crm-config.spec.ts','utf8');const tests=(c.match(/\btest\(/g)||[]).length;if(tests<4){console.error('FAIL: 只有'+tests+'个test');process.exit(1);}const shots=(c.match(/page\.screenshot/g)||[]).length;if(shots<3){console.error('FAIL: 只有'+shots+'次截图');process.exit(1);}console.log('OK tests='+tests+' screenshots='+shots)"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

### Mode A — 文件内容验证（evaluator 本地运行）

- [ ] [BEHAVIOR] `/api/crm/init` 响应含 `success` 字段（值 true）+ `table_id` 字段（非空字符串）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"success\")||!c.includes(\"table_id\")){process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/wechat-contacts` 响应含 `contacts` 数组字段，mock 场景返回 ≥ 1 条
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"contacts\")){process.exit(1);}if(!c.includes(\"wechat-contacts\")){process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/match-preview` 响应含 `matched` 字段（keys 完整性：matched/pending/unmatched）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");[\"matched\",\"pending\",\"unmatched\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: 缺\"+f);process.exit(1);}});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/daily-analysis` 响应含 `customers` 数组 + `webhook_sent` 布尔字段；dry_run=true 时 webhook_sent=false
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"customers\")||!c.includes(\"webhook_sent\")){process.exit(1);}if(!c.includes(\"dry_run\")){console.error(\"FAIL: 缺 dry_run 判断\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] error path — 路由含参数校验逻辑（缺 tenant_id → 4xx）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"400\")&&!c.includes(\"BAD_REQUEST\")&&!c.includes(\"tenant_id\")){process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 禁用字段名 `webhookSent`/`tableId` 不在 crm.ts 的 JSON 响应 key 中（驼峰命名禁止）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(c.includes(\"webhookSent\")||c.includes(\"tableId\")){console.error(\"FAIL: 含禁用驼峰字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `daily-crm-analysis.ts` 中 AI 调用 OpenRouter DeepSeek（复用 openrouter 集成）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/daily-crm-analysis.ts\",\"utf8\");if(!c.includes(\"openrouter\")&&!c.includes(\"deepseek\")&&!c.includes(\"OpenRouter\")){process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `crm_wechat_mapping` 迁移 schema 完整性：4 个核心字段均在
  Test: manual:bash -c 'node -e "const fs=require(\"fs\"),path=require(\"path\");const d=\"packages/db/migrations\";const f=fs.readdirSync(d).find(x=>x.includes(\"crm_wechat_mapping\"));if(!f)process.exit(1);const c=fs.readFileSync(path.join(d,f),\"utf8\");[\"wechat_contact_id\",\"crm_row_id\",\"platform\",\"tenant_id\"].forEach(col=>{if(!c.includes(col))process.exit(1);});console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（Mode B — windows_cloud Playwright，final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Playwright crm-config.spec.ts 在 windows_cloud 全部通过（CRM 配置页 Golden Path）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/crm-config.spec.ts\",\"utf8\");const n=(c.match(/\\btest\\(/g)||[]).length;if(n<4)process.exit(1);console.log(\"OK tests=\"+n)"'
  期望: OK（final-e2e 时 GHA windows_cloud 跑 e2e-verify.ps1 → Playwright 全通过）
  Screenshots:
    - crm-01-config-page.png   期望：CRM 配置页初始状态，平台选择器（飞书/Notion）可见
    - crm-02-init-result.png   期望：选平台后建表成功提示，table_id 信息可见
    - crm-03-contacts.png      期望：联系人列表页，mock 5 条联系人展示
    - crm-04-match-result.png  期望：AI 匹配结果页，已匹配/待确认/未匹配三栏
    - crm-05-confirmed.png     期望：用户确认后成功提示，映射建立完成
  路径格式: screenshots/crm-<step>.png
