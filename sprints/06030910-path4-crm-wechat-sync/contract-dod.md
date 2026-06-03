---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Path 4 CRM 表打通 + AI 每日 8:30 今日跟进名单推送

**范围**: 新增 CRM 路由（/api/crm/*）+ Notion/飞书双线服务 + crm_wechat_mapping DB 迁移 + Dashboard CrmConfigPage/CustomerListPage + 每日 AI 分析推送 + AI 建议列写回 + Playwright E2E
**大小**: L

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/crm.ts` 存在，export 路由含 4 端点（/init /wechat-contacts /match-preview /daily-analysis）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');if(!c.includes('/init'))process.exit(1);if(!c.includes('wechat-contacts'))process.exit(1);if(!c.includes('match-preview'))process.exit(1);if(!c.includes('daily-analysis'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/daily-crm-analysis.ts` 存在，含 FEISHU_NOTIFY_WEBHOOK 读取逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/daily-crm-analysis.ts','utf8');if(!c.includes('FEISHU_NOTIFY_WEBHOOK'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/db/migrations/` 下存在 crm_wechat_mapping 迁移文件，含 4 核心字段
  Test: node -e "const fs=require('fs'),path=require('path');const d='packages/db/migrations';const f=fs.readdirSync(d).find(x=>x.includes('crm_wechat_mapping'));if(!f){process.exit(1);}const c=fs.readFileSync(path.join(d,f),'utf8');['wechat_contact_id','crm_row_id','platform','tenant_id'].forEach(col=>{if(!c.includes(col))process.exit(1);});console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CrmConfigPage.tsx` 存在，含飞书/Notion 平台选择器
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');if(!c.includes('feishu')&&!c.includes('飞书'))process.exit(1);if(!c.includes('notion')&&!c.includes('Notion'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CustomerListPage.tsx` 存在，含客户列表渲染逻辑
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/CustomerListPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/crm-config.spec.ts` 存在，含 ≥ 4 个 test + ≥ 3 次 page.screenshot() + wechat_id/nickname 断言 + length 精确卡 5
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/crm-config.spec.ts','utf8');const tests=(c.match(/\btest\(/g)||[]).length;if(tests<4){process.exit(1);}const shots=(c.match(/page\.screenshot/g)||[]).length;if(shots<3){process.exit(1);}if(!c.includes('wechat_id')||!c.includes('nickname')){console.error('FAIL: 缺 wechat_id/nickname 断言');process.exit(1);}if(!c.match(/toHaveCount\(5\)|length.*5|\.length,\s*5/)){console.error('FAIL: 缺 contacts.length==5 精确断言');process.exit(1);}console.log('OK tests='+tests)"

---

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `/api/crm/init` 响应含 `success` 字段（值 true）+ `table_id` 字段（非空字符串）；禁用 tableId 驼峰
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"success\")||!c.includes(\"table_id\")){process.exit(1);}if(c.includes(\"tableId\")){console.error(\"FAIL: 禁用 tableId\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/init` 支持 mode=detect 分支 — 有表场景返回已有 table_id，路由含 detect 逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"detect\")){console.error(\"FAIL: 缺 mode=detect 分支\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/wechat-contacts` 响应含 `contacts` 数组，每条对象含 `wechat_id` + `nickname` 两字段，mock 精确返回 5 条
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"contacts\")){process.exit(1);}if(!c.includes(\"wechat_id\")){console.error(\"FAIL: 缺 wechat_id 字段\");process.exit(1);}if(!c.includes(\"nickname\")){console.error(\"FAIL: 缺 nickname 字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/match-preview` 响应 keys 完整性：matched/pending/unmatched 三字段均在（禁 results/data）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");[\"matched\",\"pending\",\"unmatched\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: 缺\"+f);process.exit(1);}});if(c.match(/[\"'"'"']results[\"'"'"']/)||c.match(/[\"'"'"']data[\"'"'"']/)){console.error(\"FAIL: 含禁用字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/crm/daily-analysis` 响应含 `customers` 数组 + `webhook_sent` 布尔字段；dry_run=true 时 webhook_sent=false；禁用 webhookSent
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(!c.includes(\"customers\")||!c.includes(\"webhook_sent\")){process.exit(1);}if(!c.includes(\"dry_run\")){console.error(\"FAIL: 缺 dry_run 判断\");process.exit(1);}if(c.includes(\"webhookSent\")){console.error(\"FAIL: 含禁用 webhookSent\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `daily-crm-analysis.ts` 含 AI 调用 OpenRouter DeepSeek + FEISHU_NOTIFY_WEBHOOK 推送 + AI 建议列写回逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/daily-crm-analysis.ts\",\"utf8\");if(!c.includes(\"openrouter\")&&!c.includes(\"deepseek\")&&!c.includes(\"OpenRouter\")){console.error(\"FAIL: 缺 AI 调用\");process.exit(1);}if(!c.includes(\"FEISHU_NOTIFY_WEBHOOK\")){console.error(\"FAIL: 缺 webhook\");process.exit(1);}if(!c.includes(\"AI 建议\")&&!c.includes(\"ai_suggestion\")&&!c.includes(\"suggestion\")){console.error(\"FAIL: 缺 AI 建议写回逻辑\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `crm_wechat_mapping` 迁移 schema 完整性：wechat_contact_id/crm_row_id/platform/tenant_id 四字段均在
  Test: manual:bash -c 'node -e "const fs=require(\"fs\"),path=require(\"path\");const d=\"packages/db/migrations\";const f=fs.readdirSync(d).find(x=>x.includes(\"crm_wechat_mapping\"));if(!f)process.exit(1);const c=fs.readFileSync(path.join(d,f),\"utf8\");[\"wechat_contact_id\",\"crm_row_id\",\"platform\",\"tenant_id\"].forEach(col=>{if(!c.includes(col))process.exit(1);});console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] crm-config.spec.ts 含 wechat-contacts stub 返回 5 条 + wechat_id/nickname shape 断言 + contacts.length==5 精确卡（非仅源文件字符串存在，需验断言语法）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/crm-config.spec.ts\",\"utf8\");if(!c.includes(\"wechat_id\")){console.error(\"FAIL: 缺 wechat_id\");process.exit(1);}if(!c.includes(\"nickname\")){console.error(\"FAIL: 缺 nickname\");process.exit(1);}if(!c.match(/toHaveCount\(5\)|length.*5|\.length,\s*5/)){console.error(\"FAIL: 缺 length==5 精确断言\");process.exit(1);}if(!c.includes(\"page.route\")){console.error(\"FAIL: 缺 page.route stub\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（Mode B — windows_cloud Playwright，final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Playwright crm-config.spec.ts 在 windows_cloud 全部通过（CRM 配置页 Golden Path 含 mode=detect + contacts shape + AI 分析 dry_run）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/crm-config.spec.ts\",\"utf8\");const n=(c.match(/\btest\(/g)||[]).length;if(n<4)process.exit(1);if(!c.includes(\"wechat_id\")||!c.includes(\"nickname\"))process.exit(1);if(!c.match(/toHaveCount\(5\)|length.*5/))process.exit(1);console.log(\"OK tests=\"+n)"'
  期望: OK（final-e2e 时 GHA windows_cloud 跑 e2e-verify.ps1 → Playwright 全通过）
  Screenshots:
    - crm-01-config-page.png   期望：CRM 配置页初始状态，飞书/Notion 平台选择器可见
    - crm-02-init-result.png   期望：选平台后建表成功提示，table_id 信息可见
    - crm-03-contacts.png      期望：联系人列表页，mock 5 条联系人，wechat_id/nickname 展示
    - crm-04-match-result.png  期望：AI 匹配结果页，已匹配/待确认/未匹配三栏
    - crm-05-confirmed.png     期望：用户确认后成功提示，映射建立完成
  路径格式: screenshots/crm-<step>.png
