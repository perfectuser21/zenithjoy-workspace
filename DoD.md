contract_branch: cp-harness-propose-r3-9b8199e0
workstream_index: 4
sprint_dir: sprints/zj10-customer-mgmt

---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Workstream 4: E2E Playwright 测试（windows_cloud）

**范围**: 新建 `apps/dashboard/e2e/customer-management.spec.ts`（4 个 test，API stub 模式，对应 Golden Path 全程）
**大小**: S（~120 行净增，1 文件）
**依赖**: Workstream 3（页面组件全部存在，test 引用的 data-testid 可以实际找到）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/e2e/customer-management.spec.ts` 文件已创建
  Test: node -e "require('fs').accessSync('apps/dashboard/e2e/customer-management.spec.ts'); console.log('OK')"

- [ ] [ARTIFACT] spec 文件包含 4 个 test，覆盖 Golden Path 全程（customers 概览/platform-sessions/publish-logs/403 拦截）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/customer-management.spec.ts','utf8'); const count=(c.match(/\btest\(/g)||[]).length; if(count<4){console.error('FAIL:test数量不足',count);process.exit(1)} console.log('OK count='+count)"

- [ ] [ARTIFACT] spec 文件使用 `page.route()` stub API 调用（不依赖真实后端，适合 windows_cloud 干净 VM）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/e2e/customer-management.spec.ts','utf8'); if(!c.includes('page.route'))process.exit(1); console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] spec 文件中存在针对 `/admin/customers` 的 test，且包含 `customers-table-row` data-testid 断言
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); if(!c.includes(\"/admin/customers\")||!c.includes(\"customers-table-row\")){console.error(\"FAIL:缺概览页test或testid断言\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] spec 文件中存在针对 `/admin/customers/platform-sessions` 的 test，包含 `session-status` data-testid 断言，且验证 status 值为 `active` 或 `expired`
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); if(!c.includes(\"platform-sessions\")||!c.includes(\"session-status\")){console.error(\"FAIL:缺platform-sessions test或testid\");process.exit(1)} if(!c.includes(\"active\")||!c.includes(\"expired\")){console.error(\"FAIL:缺status值验证\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] spec 文件中存在针对 `/admin/customers/publish-logs` 的 test，包含 `tenant_id` query param 验证（且不使用禁用 query 名 `user`/`client`/`id`/`t`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); if(!c.includes(\"publish-logs\")||!c.includes(\"tenant_id\")){console.error(\"FAIL:缺publish-logs test或tenant_id验证\");process.exit(1)} const forbidden=[\"searchParams.get(\\\"user\\\")\",\"searchParams.get(\\\"client\\\")\",\"searchParams.get(\\\"id\\\")\",\"searchParams.get(\\\"t\\\")\"]; forbidden.forEach(f=>{if(c.includes(f)){console.error(\"FAIL:使用禁用query参数名\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] spec 文件包含 403 error path test，验证非超管访问被拦截或重定向
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); if(!c.includes(\"403\")){console.error(\"FAIL:缺403 error path test\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] spec 文件包含 `page.screenshot()` 在关键操作前后（≥ 8 次），截图存入 `screenshots/` 目录
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); const count=(c.match(/page\.screenshot\(/g)||[]).length; if(count<8){console.error(\"FAIL:截图调用不足\",count,\"期望>=8\");process.exit(1)} console.log(\"OK count=\"+count)"'
  期望: OK
