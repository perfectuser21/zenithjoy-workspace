# Sprint PRD — /admin/customers 统一客户管理模块

## OKR 对齐

- **对应 KR**：KR-10（超管可一站式管理所有客户状态）
- **当前进度**：30%（/admin/users + /admin/license 各自独立，无聚合视图）
- **本次推进预期**：70%（统一入口 + 概览 + 平台绑定 + 发布追踪全部可访问）

## 背景

现有 /admin/users 和 /admin/license 是两个孤立菜单项。超管无法一眼看到"某客户的平台绑定是否正常 + 最近发布是否成功"。本 sprint 新建 /admin/customers 统一入口，整合三个视图。

## Golden Path（核心场景）

超管从左侧导航「客户管理」入口 → 进入 /admin/customers 概览页 → 看到每个客户一行（license 状态 + 平台绑定数 + 最近发布时间）→ 点「平台绑定」Tab 切到 /admin/customers/platform-sessions → 看到每行平台 active/expired 状态 → 点「发布追踪」Tab 切到 /admin/customers/publish-logs → 可按 tenant 筛选发布历史。

具体步骤：
1. 超管登录后，左侧导航出现「客户管理」分组入口（requireSuperAdmin）
2. 点击进入 /admin/customers，列表非空，每行含 tenant_id、license 状态、platform_count、last_publish_at
3. 切换至 /admin/customers/platform-sessions，表格展示 agent_platform_sessions 数据（含 platform、status: active|expired、tenant）
4. 切换至 /admin/customers/publish-logs，可按 tenant_id query param 筛选，展示 publish_logs 记录

## Response Schema

### Endpoint: GET /api/admin/customers

**Success (HTTP 200)**:
```json
{"success": true, "data": [{"tenant_id": "<uuid>", "email": "<string>", "license_status": "active|expired|none", "platform_count": 2, "last_publish_at": "<iso8601|null>"}], "total": 5}
```
- 禁用字段名：`users`/`clients`/`members`/`result`

### Endpoint: GET /api/admin/customers/platform-sessions

**Query Parameters**:
- `tenant_id` (uuid-string, 可选): 按租户筛选
- **禁用 query 名**: `user`/`client`/`id`/`t`

**Success (HTTP 200)**:
```json
{"success": true, "data": [{"session_id": "<uuid>", "tenant_id": "<uuid>", "platform": "<string>", "status": "active|expired", "expires_at": "<iso8601|null>"}], "total": 10}
```
- `status` 字段字面量只能是 `active` 或 `expired`，禁用 `valid`/`ok`/`inactive`

### Endpoint: GET /api/admin/customers/publish-logs

**Query Parameters**:
- `tenant_id` (uuid-string, 可选): 按租户筛选
- **禁用 query 名**: `user`/`client`/`id`/`t`

**Success (HTTP 200)**:
```json
{"success": true, "data": [{"log_id": "<uuid>", "tenant_id": "<uuid>", "work_id": "<uuid>", "platform": "<string>", "status": "<string>", "created_at": "<iso8601>"}], "total": 20}
```

**Error (HTTP 400/401/403)**:
```json
{"success": false, "error": {"code": "<string>", "message": "<string>"}}
```

## 边界情况

- tenant 无发布记录时 last_publish_at 返回 null（不报错）
- 无平台绑定的 tenant 正常出现在概览（platform_count=0）
- 非超管访问 /admin/customers/* 返回 403

## 范围限定

**在范围内**：/admin/customers 概览（WS1）、平台绑定状态页（WS2）、发布追踪页（WS3）、左侧导航「客户管理」入口
**不在范围内**：Credit 系统、客户自助操作、/admin/users 和 /admin/license 的功能改动

## 假设

- [ASSUMPTION: DB 表 agent_platform_sessions、publish_logs、works.tenant_id、agents.tenant_id 已存在且有数据]
- [ASSUMPTION: windows_cloud runner 可访问到测试用的超管账号（至少 2 个 tenant）]

## 预期受影响文件

- `apps/dashboard/src/config/navigation.config.ts`: 新增「客户管理」NavGroup + 3 个 NavItem
- `apps/dashboard/src/pages/AdminCustomersPage.tsx`: 新建概览页
- `apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx`: 新建平台绑定状态页
- `apps/dashboard/src/pages/AdminPublishLogsPage.tsx`: 新建发布追踪页
- `apps/api/src/routes/admin-customers.ts`: 新建 3 个 API 端点
- `apps/dashboard/e2e/customer-management.spec.ts`: E2E 验收（windows_cloud）

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 新页面 + 超管 UI 交互
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy Dashboard UI，走 GitHub Actions windows-latest runner 运行 Playwright E2E
