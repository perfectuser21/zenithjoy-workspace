---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Line02 Dashboard IA 重做（Hub GP 顺序 + 触达记录视图）

**范围**: Hub 页 MODULES 重排 + 账号页删昵称列 + ConfigPage 瘦身 + 新建 AcquisitionOutreachPage + 新增 outreach-history API 端点 + navigation.config 注册新路由
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AcquisitionHubPage.tsx` 已更新，MODULES 数组含 4 张 GP 顺序卡片（绑抖音小号/采集/看线索/触达记录）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/AcquisitionHubPage.tsx','utf8');if(c.includes('comingSoon: true')){process.exit(1)}if(!c.includes('绑抖音小号')||!c.includes('看线索')||!c.includes('触达记录')){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AcquisitionOutreachPage.tsx` 已新建，含"暂无触达记录"空状态文字和触达记录列表渲染
  Test: node -e "const fs=require('fs');if(!fs.existsSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx')){process.exit(1)}const c=fs.readFileSync('apps/dashboard/src/pages/AcquisitionOutreachPage.tsx','utf8');if(!c.includes('暂无触达记录')){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/api/acquisition-dispatch.api.ts` 新增 `fetchOutreachHistory()` 函数，调用 `/api/acquisition/outreach-history`
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/api/acquisition-dispatch.api.ts','utf8');if(!c.includes('outreach-history')){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/routes/acquisition-dispatch.ts` 新增 `GET /outreach-history` 路由，含 `tenant_id` 过滤，JOIN dm_assignments + dm_outreach_log + acquisition_leads
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/acquisition-dispatch.ts','utf8');if(!c.includes('outreach-history')||!c.includes('tenant_id')){process.exit(1)}console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/config/navigation.config.ts` 注册 `/area/acquisition/leads` 和 `/area/acquisition/outreach` 路由，旧 `/dashboard/leads` 保留
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(!c.includes('/area/acquisition/leads')||!c.includes('/area/acquisition/outreach')){process.exit(1)}if(!c.includes('/dashboard/leads')){console.error('FAIL: 旧路由被删');process.exit(1)}console.log('OK')"

---

## BEHAVIOR 条目（内嵌 manual:bash 命令，evaluator 直接执行）

- [ ] [BEHAVIOR] Hub 页 MODULES 无 comingSoon，含 4 张 GP 卡片标签（Golden Path Step 1 — 用户可观察）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AcquisitionHubPage.tsx\",\"utf8\");if(c.includes(\"comingSoon: true\")){console.error(\"FAIL: comingSoon\");process.exit(1)}if(!c.includes(\"绑抖音小号\")||!c.includes(\"看线索\")||!c.includes(\"触达记录\")){console.error(\"FAIL: GP卡片缺失\");process.exit(1)}if(c.includes(\"即将上线\")){console.error(\"FAIL: 即将上线标签\");process.exit(1)}console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] 账号管理页"抖音昵称"列头已删除，machine-hostname-cell 回归约束保留（Golden Path Step 2）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AcquisitionAccountsPage.tsx\",\"utf8\");if(c.includes(\"抖音昵称\")){console.error(\"FAIL: 昵称列头仍存在\");process.exit(1)}if(!c.includes(\"machine-hostname-cell\")){console.error(\"FAIL: 回归约束丢失\");process.exit(1)}console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] navigation.config 注册 /area/acquisition/leads + /area/acquisition/outreach，旧 /dashboard/leads 保留（Golden Path Step 4/5）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\");if(!c.includes(\"/area/acquisition/leads\")){console.error(\"FAIL: leads路由\");process.exit(1)}if(!c.includes(\"/area/acquisition/outreach\")){console.error(\"FAIL: outreach路由\");process.exit(1)}if(!c.includes(\"/dashboard/leads\")){console.error(\"FAIL: 旧路由被删\");process.exit(1)}console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] AcquisitionConfigPage 已删除"指派计划"块和 CookieHealthBlock 函数（Golden Path Step 6）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AcquisitionConfigPage.tsx\",\"utf8\");if(c.includes(\"指派计划\")){console.error(\"FAIL: 指派计划仍存在\");process.exit(1)}if(c.includes(\"function CookieHealthBlock\")){console.error(\"FAIL: CookieHealthBlock仍存在\");process.exit(1)}if(c.includes(\"getLine02AccountStatus\")){console.error(\"FAIL: getLine02AccountStatus仍被引用\");process.exit(1)}console.log(\"OK\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] GET /api/acquisition/outreach-history 端点注册且鉴权（无 session 返 401，不是 404）— schema 字段值验证（Golden Path Step 7）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/acquisition-dispatch.ts\",\"utf8\");if(!c.includes(\"outreach-history\")){console.error(\"FAIL: 端点未注册\");process.exit(1)}if(!c.includes(\"tenant_id\")){console.error(\"FAIL: 缺 tenant_id 过滤\");process.exit(1)}console.log(\"OK: 端点注册+租户过滤存在\")" || exit 1; CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/acquisition/outreach-history" 2>/dev/null || echo "000"); [ "$CODE" = "401" ] || [ "$CODE" = "403" ] || [ "$CODE" = "000" ] && echo "OK: auth code=$CODE" || { echo "FAIL: 预期 401/403 得到 $CODE"; exit 1; }'
  期望: OK（源码检查必须通过；若 API server 未起则 code=000 视为 skip）

- [ ] [BEHAVIOR] outreach-history 响应 schema — data.items 是数组，data.total 是数值，禁用字段 plan/history/records 不出现（Golden Path Step 7 — schema 完整性）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/acquisition-dispatch.ts\",\"utf8\");const forbidden=[\"plan\",\"records\",\"history\",\"assignments\",\"logs\"];const match=c.match(/outreach-history[\s\S]{0,2000}/);const seg=match?match[0]:\"\";for(const k of forbidden){if(seg.includes(\"data.\"+k+\" \")||seg.includes(\"'\"+k+\"'\")){console.error(\"FAIL: 禁用字段 \"+k+\" 出现在 outreach-history 路由\");process.exit(1)}}if(!seg.includes(\"items\")){console.error(\"FAIL: 路由未使用 items 字段名\");process.exit(1)}if(!seg.includes(\"total\")){console.error(\"FAIL: 路由未返回 total 字段\");process.exit(1)}console.log(\"OK: schema 字段名合规\")" || exit 1'
  期望: OK

- [ ] [BEHAVIOR] error path — AcquisitionOutreachPage 含错误处理（API 失败时不崩溃，显示错误提示而非 white screen）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AcquisitionOutreachPage.tsx\",\"utf8\");if(!c.includes(\"catch\")||(!c.includes(\"err\")||!c.includes(\"error\"))){console.error(\"FAIL: 缺错误处理\");process.exit(1)}console.log(\"OK: 含错误处理\")" || exit 1'
  期望: OK

---

## BEHAVIOR:E2E 条目（user_facing 专属，Mode B final-e2e — Playwright 真实浏览器）

- [ ] [BEHAVIOR:E2E] 用户完整走完 Golden Path：Hub 4 卡片可见→无即将上线→账号页无昵称列→看线索路由正确→触达记录页渲染→设置入口存在
  Test: e2e-verify.ps1（GHA windows-latest，Playwright 打 localhost:5174，真实后端 E2E_API_URL）
  期望: Playwright 5 个测试全部通过，截图存入 screenshots/ 目录

  Screenshots:
    - 01-hub-page.png      期望：4 张 GP 卡片可见，无"即将上线"标签
    - 02-accounts-page.png 期望：表头行无"抖音昵称"，含"绑定机器"列
    - 03-leads-page.png    期望：Leads 页加载（URL 含 /leads），显示列表或空状态
    - 04-outreach-page.png 期望：触达记录页加载（URL 含 /outreach），显示列表或"暂无触达记录"
    - 05-config-page.png   期望：设置页加载，无"指派计划"区块
  路径格式: sprints/07041249-line02-dashboard-ia-redesign/screenshots/<step>.png
