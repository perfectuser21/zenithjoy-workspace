# Sprint PRD — ZenithJoy v1.2 Sprint B · 多租户数据隔离（works 表 blueprint）

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线（77%）
- **本次推进**：Sprint A 完成 License UI 后，需要确保客户 A 看不到客户 B 的内容数据 — 商业化必须的安全基线。
- **预期推进**：建立多租户隔离的工程模式（works 表作为 blueprint），后续 sprint 复制到 topics / pipeline_runs / fields 等表。

## 背景

PR #229（Sprint A）合并后，客户已能在中台自助看到自己的 License + Agent 列表，但所有业务数据（works / pipelines / topics 等）当前是**全局共享**的。任何登录用户都能查询到任何人的作品。

### 范围裁剪说明

Notion PRD 描述的 Sprint B 完整范围是 12+ 张业务表全部加 user_id。在一个 PR 中完成所有表风险过高（单 PR LOC 超 1500 行，回归面大）。本 PRD 把范围聚焦到 **works 表**作为多租户架构的 blueprint，建立：
- 数据库 migration 模式
- API 鉴权 + ownership 过滤模式
- 数据库回填模式
- super-admin bypass 模式
- E2E smoke 测试模式

后续的 topics / pipeline_runs 等表迁移直接 copy-paste 这套模式即可。

## 目标

客户 A 通过飞书登录后调 GET /api/works 只能看到 owner_id=A 的作品；客户 B 看到 owner_id=B 的作品；super-admin 用 `X-Bypass-Tenant: true` 头可以看到全部。POST /api/works 自动把当前用户写入 owner_id。

## User Stories

- **US-001**（P0）：作为客户 A，我登录后调 GET /api/works 只看到自己的作品（看不到客户 B 的）。
- **US-002**（P0）：作为客户 A，我 POST /api/works 创建的新作品自动归属到我（owner_id = A 的飞书 ID）。
- **US-003**（P0）：作为 super-admin，我设 X-Bypass-Tenant: true 后能看到全部 works（跨租户审计）。
- **US-004**（P0）：作为客户 A，我 PUT/DELETE /api/works/:id 一个客户 B 的作品时返回 404（不暴露存在性）。
- **US-005**（P1）：作为系统管理员，现有未归属的 works（migration 前已有的）保留可见但 owner_id=NULL，可被 super-admin 后续手动归属。

## 验收场景（Given-When-Then）

**场景 1**（US-001 + US-002）:
- Given 客户 A 已飞书登录，customer_id = ou_alice
- And A POST 一个作品 → owner_id = ou_alice
- And 客户 B（ou_bob）也 POST 一个作品 → owner_id = ou_bob
- When 客户 A 调 GET /api/works
- Then 返回只含 A 的作品（不含 B 的）

**场景 2**（US-003）:
- Given super-admin（ADMIN_FEISHU_OPENIDS 中）已登录
- When 调 GET /api/works 且不带 X-Bypass-Tenant
- Then 只看自己作为客户的作品
- When 加上 X-Bypass-Tenant: true 头
- Then 返回全部作品（跨租户）

**场景 3**（US-004）:
- Given 客户 A 已登录，存在客户 B 的作品 id=W2
- When A 调 GET /api/works/W2
- Then 返回 404 NOT_FOUND（不返回 403 以避免泄露存在性）

**场景 4**（US-005）:
- Given migration 之前已存在 N 条 works（owner_id = NULL）
- When 客户 A 调 GET /api/works
- Then 不返回 owner_id=NULL 的旧作品（demo 数据保护，不破坏 v1.0 演示）

## 功能需求

- **FR-001**：DB migration 给 zenithjoy.works 加 `owner_id TEXT` 字段（nullable）+ 索引 `idx_works_owner` 。
- **FR-002**：所有 /api/works/* 端点必须经过 feishuUser 中间件（无登录 401）。
- **FR-003**：GET /api/works 自动 WHERE owner_id = req.feishuUserId（除非 super-admin 设 X-Bypass-Tenant: true）。
- **FR-004**：POST /api/works 自动 SET owner_id = req.feishuUserId。
- **FR-005**：GET/PUT/DELETE /api/works/:id 校验 owner_id == req.feishuUserId（mismatch 返回 404）。
- **FR-006**：super-admin（ADMIN_FEISHU_OPENIDS 含其飞书 ID）+ X-Bypass-Tenant: true 头时跳过 owner_id 过滤。
- **FR-007**：Dashboard works.api.ts 自动注入 X-Feishu-User-Id 头（参考 Sprint A license.api.ts 模式）。
- **FR-008**：保留 owner_id IS NULL 的 works（v1.0 demo 数据），但**默认不返回**，仅 super-admin bypass 看得到。

## 成功标准

- **SC-001**：`apps/api/tests/works-multitenant.test.ts` 5 个 vitest+supertest 场景全 PASS（A 看 A 的 / A 不看 B 的 / POST 自动归属 / cross-tenant GET-by-id 返回 404 / super-admin bypass）。
- **SC-002**：`.github/workflows/scripts/smoke/multi-tenant-smoke.sh` 跑：建 A、建 B、A POST works → A GET 1 条、B GET 0 条、bypass GET ≥ 2 条。
- **SC-003**：现有 works tests 全 PASS（不破坏现有 demo 数据访问）。
- **SC-004**：CI lint-feature-has-smoke / lint-tdd-commit-order / lint-test-pairing / lint-test-quality / lint-no-fake-test 全 PASS。
- **SC-005**：Migration 在含 demo 数据的库上跑，运行后表结构含 owner_id（NULL）+ 索引存在。

## 假设

- `[ASSUMPTION]` owner_id 用 TEXT（飞书 open_id 字符串），与 zenithjoy.licenses.customer_id 风格一致。
- `[ASSUMPTION]` 不做现有数据回填到具体用户（避免误归属），统一保留 NULL，由后续 sprint 或人工归属。
- `[ASSUMPTION]` super-admin bypass 用 `X-Bypass-Tenant: true` 头（非默认行为）— admin 默认看自己的；只有显式 bypass 才看全部。
- `[ASSUMPTION]` 其他业务表（topics / pipeline_runs / fields 等）的迁移**不在本 sprint 范围**，作为 blueprint 后续 PR 复制模式。

## 边界情况

- 未登录访问 /api/works → 401
- 客户 GET 不存在的 work id → 404
- 客户 GET 别人 owner 的 work id → 404（不区分"不存在"和"无权限"）
- super-admin 不带 X-Bypass-Tenant → 默认按客户身份查（看自己的）
- POST 数据有 `owner_id` 字段 → 服务端忽略，强制覆盖为 req.feishuUserId（防伪造）

## 范围限定

**在范围内**：
- works 表 owner_id migration + 索引 + 回填策略（保留 NULL）
- /api/works 5 个端点 multi-tenant 改造
- super-admin bypass 中间件
- Dashboard works.api.ts X-Feishu-User-Id 注入
- multi-tenant smoke 脚本

**不在范围内**：
- 其他业务表（topics / pipeline_runs / fields / pacing_config / publish_logs / ai_video_generations 等）迁移
- 强制 NOT NULL（保留 nullable 兼容历史）
- 行级安全 RLS / Postgres policy
- 跨租户分析端点
- 客户对自己作品的细粒度权限（read/write/admin role）

## 预期受影响文件

- `apps/api/db/migrations/20260428_120500_add_works_owner_id.sql`：新建 migration
- `apps/api/src/services/works.service.ts`：方法加 ownerId 参数
- `apps/api/src/controllers/works.controller.ts`：从 req 取 feishuUserId 传给 service
- `apps/api/src/routes/works.ts`：mount feishuUser + tenantBypass middleware
- `apps/api/src/middleware/tenant-bypass.ts`：新建（识别 super-admin + X-Bypass-Tenant）
- `apps/api/tests/works-multitenant.test.ts`：新建集成测试
- `apps/api/tests/middleware/tenant-bypass.test.ts`：新建单元测试
- `apps/dashboard/src/api/works.api.ts`：注入 X-Feishu-User-Id（参考 Sprint A license.api.ts 工具）
- `apps/dashboard/src/api/__tests__/works.api.test.ts`：新建（如缺失）
- `.github/workflows/scripts/smoke/multi-tenant-smoke.sh`：新建多租户隔离 E2E
