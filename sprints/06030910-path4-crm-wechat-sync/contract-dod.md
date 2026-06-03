---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Path 4 CRM 表打通 + AI 每日 8:30 今日跟进名单推送

**范围**: 新增 CRM 路由（/api/crm/*）+ Notion/飞书双线服务 + crm_wechat_mapping DB 迁移（含 contact_status）+ Dashboard CrmConfigPage/CustomerListPage + 每日 AI 分析推送 + Playwright E2E
**大小**: L

> **BEHAVIOR 前提条件（Mode A）**: ZenithJoy API 服务运行在 `localhost:3000`。
> evaluator 在执行 `manual:bash tests/behavior-api-check.sh *` 之前须先执行：
> `cd /workspace && cd apps/api && npm run dev &` + `sleep 5`

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/crm.ts` 存在，含 4 个端点（/init /wechat-contacts /match-preview /daily-analysis）
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/crm.ts','utf8');if(!c.includes('/init'))process.exit(1);if(!c.includes('wechat-contacts'))process.exit(1);if(!c.includes('match-preview'))process.exit(1);if(!c.includes('daily-analysis'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/services/daily-crm-analysis.ts` 存在，含 FEISHU_NOTIFY_WEBHOOK 读取 + suggestion 生成逻辑
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/services/daily-crm-analysis.ts','utf8');if(!c.includes('FEISHU_NOTIFY_WEBHOOK'))process.exit(1);if(!c.includes('suggestion'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `packages/db/migrations/` 下存在 crm_wechat_mapping 迁移文件，含 5 个核心字段（含 contact_status）
  Test: node -e "const fs=require('fs'),path=require('path');const d='packages/db/migrations';const f=fs.readdirSync(d).find(x=>x.includes('crm_wechat_mapping'));if(!f){process.exit(1);}const c=fs.readFileSync(path.join(d,f),'utf8');['wechat_contact_id','crm_row_id','platform','tenant_id','contact_status'].forEach(col=>{if(!c.includes(col))process.exit(1);});console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CrmConfigPage.tsx` 存在，含飞书/Notion 平台选择器 + 飞书 OAuth 入口
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/CrmConfigPage.tsx','utf8');if(!c.includes('feishu')&&!c.includes('飞书'))process.exit(1);if(!c.includes('notion')&&!c.includes('Notion'))process.exit(1);if(!c.includes('FeishuBindTenant')&&!c.includes('feishu-bind')&&!c.includes('feishuOAuth'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/CustomerListPage.tsx` 存在
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/CustomerListPage.tsx');console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/e2e/crm-config.spec.ts` 存在，含 ≥ 4 个 test 和 ≥ 3 次 page.screenshot()
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/crm-config.spec.ts','utf8');const tests=(c.match(/\btest\(/g)||[]).length;if(tests<4){console.error('FAIL: 只有'+tests+'个test');process.exit(1);}const shots=(c.match(/page\.screenshot/g)||[]).length;if(shots<3){console.error('FAIL: 只有'+shots+'次截图');process.exit(1);}console.log('OK tests='+tests+' screenshots='+shots)"

---

## BEHAVIOR 条目（内嵌 manual: 命令，evaluator 直接执行）

> 所有 `behavior-api-check.sh` 调用依赖 `localhost:3000` ZenithJoy API 运行中。

- [ ] [BEHAVIOR] POST /api/crm/init 返回 success=true + table_id 字符串（schema 字段值 + keys 完整性）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh init
  期望: OK（exit 0）

- [ ] [BEHAVIOR] GET /api/crm/wechat-contacts 返回 contacts 数组 ≥ 1 条，含 wechat_id + nickname（禁用字段反向检查）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh contacts
  期望: OK（exit 0）

- [ ] [BEHAVIOR] GET /api/crm/match-preview 返回 matched/pending/unmatched 三字段数组（keys 完整性 + 禁用字段 results 反向）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh match
  期望: OK（exit 0）

- [ ] [BEHAVIOR] POST /api/crm/daily-analysis dry_run=true 返回 customers 数组 + webhook_sent=false；suggestion 字段为 string 类型（非空时）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh analysis
  期望: OK（exit 0）

- [ ] [BEHAVIOR] error path — 缺 tenant_id 时实际返回 HTTP 400（不允许 200/404/500）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh error
  期望: OK（exit 0）

- [ ] [BEHAVIOR] 禁用驼峰字段 webhookSent/tableId 不出现在 crm.ts 响应体（反向检查）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/crm.ts\",\"utf8\");if(c.includes(\"webhookSent\")||c.includes(\"tableId\")){console.error(\"FAIL: 含禁用驼峰字段\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] Risk 1 — wechat_rpa 失败时 /wechat-contacts 降级返回 warning 字段，不返 HTTP 500
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh risk-rpa-fail
  期望: OK（exit 0）

- [ ] [BEHAVIOR] Risk 2 — mode=connect 响应含 field_mapping 字段（有表字段映射预览，不自动导入）
  Test: manual:bash sprints/06030910-path4-crm-wechat-sync/tests/behavior-api-check.sh risk-field-mapping
  期望: OK（exit 0）

- [ ] [BEHAVIOR] Risk 3 — notion-crm.ts 含 token_expired 状态处理 + FEISHU_NOTIFY_WEBHOOK 推送调用
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/notion-crm.ts\",\"utf8\");if(!c.includes(\"token_expired\")){console.error(\"FAIL: 缺 token_expired\");process.exit(1);}if(!c.includes(\"FEISHU_NOTIFY_WEBHOOK\")){console.error(\"FAIL: 缺飞书告警\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] Risk 4 — crm-wechat-sync.ts 含 contact_lost 标记逻辑，不含硬删除 DELETE FROM crm_wechat_mapping
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/services/crm-wechat-sync.ts\",\"utf8\");if(!c.includes(\"contact_lost\")){console.error(\"FAIL: 缺 contact_lost\");process.exit(1);}if(c.includes(\"DELETE FROM crm_wechat_mapping\")){console.error(\"FAIL: 含硬删除\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

---

## BEHAVIOR:E2E 条目（Mode B — windows_cloud Playwright，final-e2e 跑）

- [ ] [BEHAVIOR:E2E] Playwright crm-config.spec.ts 在 windows_cloud 全部通过（含 OAuth 入口 + suggestion 字段断言）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/crm-config.spec.ts\",\"utf8\");const n=(c.match(/\\btest\\(/g)||[]).length;if(n<4)process.exit(1);if(!c.includes(\"FeishuBindTenant\")&&!c.includes(\"feishu-bind\")&&!c.includes(\"feishuOAuth\"))process.exit(1);if(!c.includes(\"suggestion\"))process.exit(1);console.log(\"OK tests=\"+n)"'
  期望: OK（final-e2e 时 GHA windows_cloud 跑 e2e-verify.ps1 → Playwright 全通过）
  Screenshots:
    - crm-01-config-page.png    期望：CRM 配置页初始状态，平台选择器（飞书/Notion）+ OAuth 入口可见
    - crm-02-oauth-step.png     期望：飞书 OAuth 绑定引导界面可见
    - crm-03-init-result.png    期望：建表成功提示，table_id 信息展示
    - crm-04-contacts.png       期望：联系人列表，mock 5 条展示
    - crm-05-match-result.png   期望：AI 匹配结果，已匹配/待确认/未匹配三栏
    - crm-06-confirmed.png      期望：用户确认后成功提示，映射建立完成
  路径格式: screenshots/crm-<step>.png
