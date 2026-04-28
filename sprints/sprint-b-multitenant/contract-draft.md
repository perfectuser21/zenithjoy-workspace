# Sprint Contract Draft (Round 1) — Sprint B · 多租户隔离

## Feature 1: works 表 owner_id 多租户隔离

**行为描述**:
- /api/works/* 所有端点强制要求 X-Feishu-User-Id（缺失返回 401）
- GET /api/works 默认只返回 owner_id = req.feishuUserId 的行（不返回 NULL 或他人的）
- POST /api/works 自动 SET owner_id = req.feishuUserId（请求 body 中的 owner_id 被忽略）
- GET/PUT/DELETE /api/works/:id 当 owner_id 与 req.feishuUserId 不一致时返回 404
- super-admin（飞书 ID 在 ADMIN_FEISHU_OPENIDS）+ X-Bypass-Tenant: true 头时跳过 owner_id 过滤

**硬阈值**:
- 缺 X-Feishu-User-Id：HTTP 401
- A 的 GET /api/works：响应 body 中 data 数组每条 owner_id === A 的飞书 ID
- A 的 POST /api/works：响应 body owner_id === A 的飞书 ID
- A 的 GET /api/works/:B-的-id：HTTP 404
- super-admin + X-Bypass-Tenant=true 的 GET：response body data 数组长度 ≥ 多租户测试中创建的总数

**BEHAVIOR 覆盖**（落在 `apps/api/tests/works-multitenant.test.ts`）:
- `it('GET /api/works 缺 X-Feishu-User-Id 返回 401')`
- `it('GET /api/works 客户 A 只返回 owner_id=A 的作品')`
- `it('POST /api/works 自动 SET owner_id 为请求者飞书 ID')`
- `it('POST /api/works 忽略 body 中的 owner_id 字段（防伪造）')`
- `it('GET /api/works/:id 跨租户访问返回 404 NOT_FOUND')`
- `it('PUT /api/works/:id 跨租户修改返回 404 NOT_FOUND')`
- `it('DELETE /api/works/:id 跨租户删除返回 404 NOT_FOUND')`
- `it('super-admin 设 X-Bypass-Tenant=true 时返回全部作品')`

**ARTIFACT 覆盖**（contract-dod-ws[1-2].md）:
- works migration SQL 含 `ALTER TABLE` 与 `CREATE INDEX idx_works_owner`
- works.service.ts 5 个方法签名含 ownerId 参数
- tenant-bypass.ts 文件存在并 export tenantBypass
- works.ts router 引用 feishuUser

---

## Feature 2: tenant-bypass 中间件

**行为描述**:
- 读 X-Bypass-Tenant 头与 X-Feishu-User-Id
- 当 X-Feishu-User-Id 在 ADMIN_FEISHU_OPENIDS 且 X-Bypass-Tenant === 'true' → 设 req.bypassTenant = true
- 否则 req.bypassTenant = false 或 undefined

**BEHAVIOR 覆盖**（`apps/api/tests/middleware/tenant-bypass.test.ts`）:
- `it('admin + bypass=true 设 req.bypassTenant=true')`
- `it('admin + bypass=false 不设')`
- `it('非 admin + bypass=true 不设（防滥用）')`

---

## Feature 3: Dashboard works.api 自动注入用户头

**行为描述**:
- works.api.ts 内部 fetch 自动从 cookie/localStorage 读取 user 然后 set X-Feishu-User-Id

**BEHAVIOR 覆盖**（`apps/dashboard/src/api/__tests__/works.api.test.ts`）:
- `it('getWorks fetch 调用时 headers 含 X-Feishu-User-Id')`

**ARTIFACT 覆盖**（contract-dod-ws3.md）:
- works.api.ts 文件中含 `X-Feishu-User-Id` 字符串
- multi-tenant-smoke.sh 含 6+ curl + 验证 cross-tenant 隔离

---

## Workstreams

workstream_count: 3

### WS1: works.service ownerId 化 + migration
S/M：约 150 LOC（migration + service 改造）

### WS2: tenant-bypass 中间件 + works 路由集成
M：约 100 LOC

### WS3: Dashboard 注入 + multi-tenant smoke
S：约 80 LOC

---

## Test Contract

| Workstream | Test File | 预期红证据 |
|---|---|---|
| WS1+WS2 | `apps/api/tests/works-multitenant.test.ts` | 8 failures（feishuUser 未挂 → POST 200 而非 401，service 未 owner 化 → 跨租户能查到） |
| WS2 单元 | `apps/api/tests/middleware/tenant-bypass.test.ts` | 3 failures（中间件未实现） |
| WS3 单元 | `apps/dashboard/src/api/__tests__/works.api.test.ts` | 1 failure（X-Feishu-User-Id 未注入） |

---

## 注意事项

1. 现有 apps/api/tests/works.test.ts 13 个 request 调用没有 X-Feishu-User-Id 头 — 实施 WS2 后会全部 401。需在 commit-2 同步更新所有现有测试加 X-Feishu-User-Id。
2. owner_id 保持 nullable — 旧 demo 数据保留，仅 super-admin bypass 可见。
