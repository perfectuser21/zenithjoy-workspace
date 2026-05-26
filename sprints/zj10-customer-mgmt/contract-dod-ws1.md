---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3 个 GET 端点 + `superAdminGuard`）；在 `apps/api/src/app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行净增，2 文件）
**依赖**: 无

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `apps/api/src/routes/admin-customers.ts` 文件已创建，导出 `adminCustomersRouter`
  Test: node -e "require('fs').accessSync('apps/api/src/routes/admin-customers.ts'); const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); if(!c.includes('adminCustomersRouter'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] `apps/api/src/app.ts` 已引入并注册 adminCustomersRouter 到 `/api/admin/customers`
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/app.ts','utf8'); if(!c.includes('admin/customers'))process.exit(1); if(!c.includes('adminCustomersRouter'))process.exit(1); console.log('OK')"

- [ ] [ARTIFACT] 路由实现包含 `GET /api/admin/customers`、`GET /api/admin/customers/platform-sessions`、`GET /api/admin/customers/publish-logs` 三个端点
  Test: node -e "const c=require('fs').readFileSync('apps/api/src/routes/admin-customers.ts','utf8'); ['platform-sessions','publish-logs'].forEach(e=>{if(!c.includes(e)){console.error('FAIL:缺端点',e);process.exit(1)}}); console.log('OK')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] GET /api/admin/customers 响应 schema 包含所有 PRD 必填字段（`success`/`data`/`total`/`tenant_id`/`email`/`license_status`/`platform_count`/`last_publish_at`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); const req=[\"tenant_id\",\"email\",\"license_status\",\"platform_count\",\"last_publish_at\",\"success\",\"total\"]; req.forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers 响应不含禁用字段名（`users`/`clients`/`members`/`result` 不作为顶层 key 出现）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); const bad=[\"\\\"users\\\"\",\"\\\"clients\\\"\",\"\\\"members\\\"\",\"data: result\"]; bad.forEach(f=>{if(c.includes(f)){console.error(\"FAIL:含禁用字段\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/platform-sessions 响应 schema 包含 `session_id`/`tenant_id`/`platform`/`status`/`expires_at`；status 值不含禁用词（`valid`/`ok`/`inactive`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); [\"session_id\",\"expires_at\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); [\"valid\",\"\\\"ok\\\"\",\"inactive\"].forEach(v=>{if(c.includes(v)){console.error(\"FAIL:含禁用status值\",v);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] GET /api/admin/customers/publish-logs 响应 schema 包含 `log_id`/`work_id`/`created_at`；query param 使用 `tenant_id`（不使用禁用 query 名 `user`/`client`/`id`/`t`）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); [\"log_id\",\"work_id\",\"created_at\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL:缺\",f);process.exit(1)}}); [\"req.query.user\",\"req.query.client \",\"req.query.id\",\"req.query.t \"].forEach(f=>{if(c.includes(f)){console.error(\"FAIL:使用禁用query参数\",f);process.exit(1)}}); console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 路由使用 `superAdminGuard` 中间件（非超管请求返回 403）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/routes/admin-customers.ts\",\"utf8\"); if(!c.includes(\"superAdminGuard\")){console.error(\"FAIL:缺superAdminGuard\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `app.ts` 已正确注册 `/api/admin/customers` 路由（端点不会返回 404）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"apps/api/src/app.ts\",\"utf8\"); if(!c.includes(\"admin/customers\")||!c.includes(\"adminCustomersRouter\")){console.error(\"FAIL:路由未注册\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK

---

## 假绿自查

每条 BEHAVIOR 的"如果 ws1 一行代码都没写，会 FAIL 吗？"检查：
- BEHAVIOR 1：`apps/api/src/routes/admin-customers.ts` 不存在 → `readFileSync` 抛异常 → FAIL ✅
- BEHAVIOR 2：同上 → FAIL ✅
- BEHAVIOR 3：同上 → FAIL ✅
- BEHAVIOR 4：同上 → FAIL ✅
- BEHAVIOR 5：同上 → FAIL ✅
- BEHAVIOR 6：`app.ts` 不含 `admin/customers` → FAIL ✅
