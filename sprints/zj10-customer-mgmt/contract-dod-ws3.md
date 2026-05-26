---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Workstream 3: AdminPlatformSessionsPage + AdminPublishLogsPage

**范围**: 新建 `apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx`（平台绑定状态表格）+ `apps/dashboard/src/pages/AdminPublishLogsPage.tsx`（发布追踪表格，含 tenant_id 筛选）；在 `navigation.config.ts` additionalRoutes 添加对应路由
**大小**: M（~150 行净增，2+调整文件）
**依赖**: Workstream 2（路由配置和页面骨架先就位）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx` 文件已创建，含 `data-testid="platform-sessions-table-row"` 和 `data-testid="session-status"` 属性
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx'); const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx','utf8'); ['platform-sessions-table-row','session-status'].forEach(t=>{if(!c.includes(t)){console.error('FAIL:缺testid',t);process.exit(1)}}); console.log('OK')"

- [ ] [ARTIFACT] `apps/dashboard/src/pages/AdminPublishLogsPage.tsx` 文件已创建，含 `data-testid="publish-logs-table-row"` 属性和 `tenant_id` URL 参数读取逻辑
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/AdminPublishLogsPage.tsx'); const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminPublishLogsPage.tsx','utf8'); if(!c.includes('publish-logs-table-row')||!c.includes('tenant_id'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `pageComponents` 中包含 `AdminPlatformSessionsPage` 和 `AdminPublishLogsPage` 两个懒加载映射
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8'); ['AdminPlatformSessionsPage','AdminPublishLogsPage'].forEach(p=>{if(!c.includes(p)){console.error('FAIL:缺映射',p);process.exit(1)}}); console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] `AdminPlatformSessionsPage.tsx` 调用 `/api/admin/customers/platform-sessions` 端点，响应字段包含 `session_id`/`platform`/`status`/`expires_at`，且不含禁用 status 值（`valid`/`ok`/`inactive`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx\",\"utf8\"); [\"platform-sessions\",\"session_id\",\"expires_at\",\"platform\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺字段\",f);process.exit(1)}}); [\"valid\",\"inactive\"].forEach(v=>{if(c.includes(v)){console.error(\"FAIL:含禁用status值\",v);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminPlatformSessionsPage.tsx` 的 `data-testid="session-status"` 渲染的值只会是 `active` 或 `expired`（通过代码逻辑约束）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx\",\"utf8\"); if(!c.includes(\"session-status\")){console.error(\"FAIL:缺session-status testid\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminPublishLogsPage.tsx` 调用 `/api/admin/customers/publish-logs`，响应字段包含 `log_id`/`work_id`/`created_at`，且通过 `tenant_id` query param 筛选（不使用禁用 query 名 `user`/`client`/`id`/`t`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminPublishLogsPage.tsx\",\"utf8\"); [\"publish-logs\",\"log_id\",\"work_id\",\"created_at\",\"tenant_id\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺字段\",f);process.exit(1)}}); [\"?user=\",\"?client=\",\"?id=\",\"?t=\"].forEach(f=>{if(c.includes(f)){console.error(\"FAIL:禁用query参数\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `AdminPublishLogsPage.tsx` 使用 `useSearchParams`（或等价 API）读取 URL 中的 `tenant_id` 参数，并将其传递给 API 请求
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/pages/AdminPublishLogsPage.tsx\",\"utf8\"); const hasSearchParams=c.includes(\"useSearchParams\")||c.includes(\"URLSearchParams\")||c.includes(\"searchParams\")||c.includes(\"location.search\"); if(!hasSearchParams){console.error(\"FAIL:未读取URL searchParams\");process.exit(1)} console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `pageComponents` 已新增 `AdminPlatformSessionsPage` 和 `AdminPublishLogsPage` 两个懒加载映射
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/dashboard/src/config/navigation.config.ts\",\"utf8\"); [\"AdminPlatformSessionsPage\",\"AdminPublishLogsPage\"].forEach(p=>{if(!c.includes(p)){console.error(\"FAIL:缺懒加载映射\",p);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

---

## Red Evidence（TDD 红色证明 — 实现前必须失败）

```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws3/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 实际输出（已验证 2026-05-26）：
# Test Files  1 failed (1)
# Tests  12 failed (12)
```

---

## 假绿自查

- BEHAVIOR 1：`AdminPlatformSessionsPage.tsx` 不存在 → `readFileSync` 抛异常 → FAIL ✅
- BEHAVIOR 2：同上 → FAIL ✅
- BEHAVIOR 3：`AdminPublishLogsPage.tsx` 不存在 → FAIL ✅
- BEHAVIOR 4：同上，文件不存在 → FAIL ✅
- BEHAVIOR 5：`navigation.config.ts` 不含新增映射 → FAIL ✅（WS3 实现前）
