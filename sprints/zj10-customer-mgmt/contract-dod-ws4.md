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

- [ ] [BEHAVIOR] spec 文件包含 `page.screenshot()` 在关键操作前后，截图存入 `screenshots/` 目录
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/e2e/customer-management.spec.ts\",\"utf8\"); const count=(c.match(/page\.screenshot\(/g)||[]).length; if(count<4){console.error(\"FAIL:截图调用不足\",count,\"期望>=4\");process.exit(1)} console.log(\"OK count=\"+count)"'
  期望: OK

---

## BEHAVIOR:E2E 条目（Mode B final-e2e — windows_cloud Playwright 全程）

- [ ] [BEHAVIOR:E2E] 在 windows_cloud runner 上运行 `npx playwright test apps/dashboard/e2e/customer-management.spec.ts`，所有 4 个 test PASS，截图存入 `~/claude-output/harness-screenshots/`
  Screenshots:
    - ws4-01-customers-overview.png    期望：/admin/customers 页面加载，客户列表表格可见，至少 1 行数据，license_status 字段显示
    - ws4-02-platform-sessions.png     期望：/admin/customers/platform-sessions 页面加载，session-status 列显示 active/expired
    - ws4-03-publish-logs.png          期望：/admin/customers/publish-logs 页面加载，发布记录列表可见，tenant_id 筛选有效
    - ws4-04-forbidden.png             期望：非超管访问被拦截，页面显示错误提示或发生重定向
  期望：所有截图与期望描述一致，evaluator Claude Read 图自验通过

evaluator 完成验收后必须执行：
```bash
mkdir -p ~/claude-output/harness-screenshots/
cp screenshots/01-customers-overview.png ~/claude-output/harness-screenshots/ws4-01-customers-overview.png 2>/dev/null || true
cp screenshots/02-platform-sessions.png ~/claude-output/harness-screenshots/ws4-02-platform-sessions.png 2>/dev/null || true
cp screenshots/03-publish-logs.png ~/claude-output/harness-screenshots/ws4-03-publish-logs.png 2>/dev/null || true
cp screenshots/04-forbidden.png ~/claude-output/harness-screenshots/ws4-04-forbidden.png 2>/dev/null || true
```

---

## Red Evidence（TDD 红色证明 — 实现前必须失败）

```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws4/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 实际输出（已验证 2026-05-26）：
# Test Files  1 failed (1)
# Tests  9 failed (9)
```

---

## 假绿自查

- BEHAVIOR 1：`apps/dashboard/e2e/customer-management.spec.ts` 不存在 → `readFileSync` 抛异常 → FAIL ✅
- BEHAVIOR 2：同上 → FAIL ✅
- BEHAVIOR 3：同上 → FAIL ✅
- BEHAVIOR 4：同上 → FAIL ✅
- BEHAVIOR 5：同上 → FAIL ✅
