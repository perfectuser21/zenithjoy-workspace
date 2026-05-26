# Sprint Contract Draft (Round 1)
# /admin/customers 统一客户管理模块

## Golden Path

[超管登录] → [导航「客户管理」入口] → [/admin/customers 概览列表] → [切换 platform-sessions Tab] → [切换 publish-logs Tab + tenant 筛选]

---

### Step 1: 超管登录后左侧导航出现「客户管理」分组入口

**来源**: `[FROM_PRD]` — PRD"具体步骤"第1条："超管登录后，左侧导航出现「客户管理」分组入口（requireSuperAdmin）"

**可观测行为**: `navigation.config.ts` 中存在一个 NavGroup 含有 path=/admin/customers 的 NavItem，且标记 `requireSuperAdmin: true`；非超管看不到该菜单项。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!c.includes('/admin/customers')) { console.error('FAIL: 缺少 /admin/customers 路径'); process.exit(1); }
if (!c.includes('requireSuperAdmin')) { console.error('FAIL: 缺少 requireSuperAdmin 标记'); process.exit(1); }
if (!c.includes('客户管理')) { console.error('FAIL: 缺少「客户管理」label'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 文件包含 `/admin/customers`、`requireSuperAdmin`、`客户管理` 三个字符串，缺一 FAIL

---

### Step 2: GET /api/admin/customers 返回正确 schema

**来源**: `[FROM_PRD]` — PRD"Response Schema"段："GET /api/admin/customers"Success (HTTP 200) 定义了 `success/data[]/total` 结构

**可观测行为**: 端点返回 `{success: true, data: [{tenant_id, email, license_status, platform_count, last_publish_at}], total: N}`，禁用字段（`users`/`clients`/`members`/`result`）不出现。

**验证命令**:
```bash
# 验证路由文件存在且包含正确字段名（实现前此命令 FAIL）
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
const required = ['tenant_id', 'email', 'license_status', 'platform_count', 'last_publish_at', 'success', 'total'];
const forbidden = ['users:', 'clients:', 'members:', 'result:'];
required.forEach(f => { if (!c.includes(f)) { console.error('FAIL: 缺必填字段', f); process.exit(1); } });
forbidden.forEach(f => { if (c.includes(f)) { console.error('FAIL: 含禁用字段', f); process.exit(1); } });
console.log('OK');
"
```

**硬阈值**: 所有必填字段出现，所有禁用字段不出现；exit 0

---

### Step 3: GET /api/admin/customers/platform-sessions 返回正确 schema

**来源**: `[FROM_PRD]` — PRD"Response Schema"段："GET /api/admin/customers/platform-sessions"Success (HTTP 200) 定义了 `session_id/tenant_id/platform/status/expires_at` 结构

**可观测行为**: 端点返回 `{success: true, data: [{session_id, tenant_id, platform, status, expires_at}], total: N}`，status 值只能是 `active` 或 `expired`，query param 必须为 `tenant_id`（不接受 `user`/`client`/`id`/`t`）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
const required = ['session_id', 'expires_at', 'platform-sessions'];
required.forEach(f => { if (!c.includes(f)) { console.error('FAIL: 缺字段', f); process.exit(1); } });
// 禁用 status 值
if (c.includes(\"status: 'valid'\") || c.includes(\"status: 'ok'\") || c.includes(\"status: 'inactive'\")) {
  console.error('FAIL: 含禁用 status 值'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: `session_id`、`expires_at`、`platform-sessions` 出现，禁用 status 值不出现；exit 0

---

### Step 4: GET /api/admin/customers/publish-logs 支持 tenant_id 筛选

**来源**: `[FROM_PRD]` — PRD"具体步骤"第4条："切换至 /admin/customers/publish-logs，可按 tenant_id query param 筛选，展示 publish_logs 记录"

**可观测行为**: 端点返回 `{success: true, data: [{log_id, tenant_id, work_id, platform, status, created_at}], total: N}`，支持 `tenant_id` query param 筛选（使用 `tenant_id` 不是禁用的 `user`/`client`/`id`/`t`）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
const required = ['log_id', 'work_id', 'publish-logs', 'created_at'];
required.forEach(f => { if (!c.includes(f)) { console.error('FAIL: 缺字段', f); process.exit(1); } });
// 禁用 query 参数名
const forbidden = [\"req.query.user\", \"req.query.client\", \"req.query.id\", \"req.query.t\"];
forbidden.forEach(f => { if (c.includes(f)) { console.error('FAIL: 使用禁用 query 参数', f); process.exit(1); } });
console.log('OK');
"
```

**硬阈值**: 所有必填字段出现，禁用 query 参数名不出现；exit 0

---

### Step 5: 非超管访问 /admin/customers/* 返回 403

**来源**: `[FROM_PRD]` — PRD"边界情况"："非超管访问 /admin/customers/* 返回 403"

**可观测行为**: 路由使用 `superAdminGuard` 中间件，未经超管认证的请求被拦截并返回 403。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
if (!c.includes('superAdminGuard')) { console.error('FAIL: 缺 superAdminGuard 中间件'); process.exit(1); }
console.log('OK');
" && \
node -e "
const c = require('fs').readFileSync('apps/api/src/app.ts', 'utf8');
if (!c.includes('admin/customers')) { console.error('FAIL: app.ts 未注册 admin-customers 路由'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: `superAdminGuard` 在路由文件中出现，`app.ts` 注册了该路由；exit 0

---

### Step 6: 禁用字段名不出现在任何响应中（防止 generator schema 漂移）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确列出禁用字段名，generator 历史上会把 `data` 改成 `users` 或 `result`；加本步骤防止漂移，确保 evaluator 不会假绿通过

**可观测行为**: 路由实现文件中不含任何禁用字段名（`users`/`clients`/`members`/`result` 作为顶层 response key）。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
// 禁用顶层 response key — 精确匹配赋值形式
const patterns = ['users:', 'clients:', 'members:', 'result:'];
patterns.forEach(p => {
  // 允许 license_status（含 status，不是独立的 result）
  const re = new RegExp('\\\\b' + p.replace(':', '') + '\\\\s*:');
  if (re.test(c) && !['license_status', 'platform_count'].some(ok => c.includes(ok + ': '))) {
    console.error('FAIL: 禁用字段名', p, '出现在响应对象中'); process.exit(1);
  }
});
console.log('OK');
"
```

**硬阈值**: 禁用字段名不作为 response key 出现；exit 0

---

## E2E 验收（final-e2e — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E runner**: GitHub Actions windows-latest（每次全新 VM，无 cookie/session 历史）

```javascript
// apps/dashboard/e2e/customer-management.spec.ts
// 在 GitHub Actions windows-latest 上执行
// API 调用通过 page.route() stub，不依赖真实后端

import { test, expect } from '@playwright/test';

test.describe('客户管理模块 Golden Path', () => {

  test('Step 1: /admin/customers 概览页加载，显示客户列表', async ({ page }) => {
    // Stub: GET /api/admin/customers
    await page.route('**/api/admin/customers', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              tenant_id: 'aaa-111',
              email: 'test@example.com',
              license_status: 'active',
              platform_count: 2,
              last_publish_at: '2026-05-20T10:00:00Z',
            },
            {
              tenant_id: 'bbb-222',
              email: 'test2@example.com',
              license_status: 'expired',
              platform_count: 0,
              last_publish_at: null,
            },
          ],
          total: 2,
        },
      });
    });

    await page.goto('http://localhost:5174/admin/customers');
    await page.waitForLoadState('networkidle');

    // 断言：列表至少 1 行数据
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toBeVisible({ timeout: 10000 });
    // 断言：license_status 字段显示
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toContainText('active');
    // 断言：email 字段显示
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toContainText('test@example.com');
    await page.screenshot({ path: 'screenshots/01-customers-overview.png' });
  });

  test('Step 2: /admin/customers/platform-sessions 平台绑定状态', async ({ page }) => {
    await page.route('**/api/admin/customers/platform-sessions**', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              session_id: 'sess-001',
              tenant_id: 'aaa-111',
              platform: 'douyin',
              status: 'active',
              expires_at: '2026-12-31T23:59:59Z',
            },
            {
              session_id: 'sess-002',
              tenant_id: 'bbb-222',
              platform: 'kuaishou',
              status: 'expired',
              expires_at: '2026-01-01T00:00:00Z',
            },
          ],
          total: 2,
        },
      });
    });

    await page.goto('http://localhost:5174/admin/customers/platform-sessions');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="platform-sessions-table-row"]').first()).toBeVisible({ timeout: 10000 });
    // status 只能是 active 或 expired
    const statusText = await page.locator('[data-testid="session-status"]').first().textContent();
    expect(['active', 'expired']).toContain(statusText?.trim());
    await page.screenshot({ path: 'screenshots/02-platform-sessions.png' });
  });

  test('Step 3: /admin/customers/publish-logs 发布追踪 + tenant_id 筛选', async ({ page }) => {
    let capturedTenantId: string | null = null;
    await page.route('**/api/admin/customers/publish-logs**', async (route) => {
      const url = new URL(route.request().url());
      capturedTenantId = url.searchParams.get('tenant_id');
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              log_id: 'log-001',
              tenant_id: capturedTenantId ?? 'aaa-111',
              work_id: 'work-001',
              platform: 'douyin',
              status: 'published',
              created_at: '2026-05-20T10:00:00Z',
            },
          ],
          total: 1,
        },
      });
    });

    // 测试带 tenant_id 筛选
    await page.goto('http://localhost:5174/admin/customers/publish-logs?tenant_id=aaa-111');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('[data-testid="publish-logs-table-row"]').first()).toBeVisible({ timeout: 10000 });
    // 验证 tenant_id query param 被正确传递（不是 user/client/id/t）
    expect(capturedTenantId).toBe('aaa-111');
    await page.screenshot({ path: 'screenshots/03-publish-logs.png' });
  });

  test('Step 4: 403 拦截验证（非超管路由保护）', async ({ page }) => {
    await page.route('**/api/admin/customers**', async (route) => {
      await route.fulfill({
        status: 403,
        json: { success: false, error: { code: 'FORBIDDEN', message: '需要 super-admin 权限' } },
      });
    });

    await page.goto('http://localhost:5174/admin/customers');
    await page.waitForLoadState('networkidle');

    // 非超管时页面应显示权限错误或重定向
    const url = page.url();
    const has403Content = await page.locator('[data-testid="error-forbidden"]').isVisible().catch(() => false);
    const redirectedAway = !url.includes('/admin/customers') || has403Content;
    expect(redirectedAway).toBeTruthy();
    await page.screenshot({ path: 'screenshots/04-forbidden.png' });
  });
});
```

**PASS 标准**: 所有 4 个 test 通过，exit 0，截图存入 `screenshots/`
**FAIL 标准**: 任一 test 失败，exit 1，或 timeout 15min

**截图 DoD**:
- `01-customers-overview.png` — 客户概览列表正常加载，表格行可见，license_status 显示
- `02-platform-sessions.png` — 平台绑定状态列表，status 值为 active/expired
- `03-publish-logs.png` — 发布追踪列表，tenant_id 筛选有效
- `04-forbidden.png` — 非超管访问被拦截或重定向

---

## Workstreams

**workstream_count**: 4

### Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3个 GET 端点 + superAdminGuard）；在 `apps/api/src/app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行）
**依赖**: 无（`ws1: depends_on: []`）
**BEHAVIOR 覆盖**: `tests/ws1/admin-customers-routes.test.ts`

---

### Workstream 2: 导航配置 + AdminCustomersPage 概览

**范围**: `apps/dashboard/src/config/navigation.config.ts` 新增「客户管理」NavGroup + 3 NavItems；新建 `apps/dashboard/src/pages/AdminCustomersPage.tsx`（概览表格）
**大小**: M（~150 行）
**依赖**: Workstream 1 完成后（API 端点存在才能定义实际 fetch）
**BEHAVIOR 覆盖**: `tests/ws2/admin-customers-nav.test.ts`

---

### Workstream 3: AdminPlatformSessionsPage + AdminPublishLogsPage

**范围**: 新建 `apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx` + `AdminPublishLogsPage.tsx`；在 `navigation.config.ts` 添加 additionalRoutes
**大小**: M（~150 行）
**依赖**: Workstream 2 完成后（路由配置先存在）
**BEHAVIOR 覆盖**: `tests/ws3/admin-platform-sessions-pages.test.ts`

---

### Workstream 4: E2E Playwright 测试（windows_cloud）

**范围**: 新建 `apps/dashboard/e2e/customer-management.spec.ts`（4 个 test，API stub 模式）
**大小**: S（~120 行）
**依赖**: Workstream 3 完成后（页面组件全部存在）
**BEHAVIOR 覆盖**: `tests/ws4/customer-management-e2e.test.ts`

---

## Workstreams 切分自查

| WS | 文件数 | 预期净增行数 | 是否超限 |
|---|---|---|---|
| ws1 | 2 (`admin-customers.ts` + `app.ts` 2行) | ~152 | ✅ ≤200 |
| ws2 | 2 (`navigation.config.ts` 增量 + `AdminCustomersPage.tsx`) | ~150 | ✅ ≤200 |
| ws3 | 2 (`AdminPlatformSessionsPage.tsx` + `AdminPublishLogsPage.tsx`) | ~150 | ✅ ≤200 |
| ws4 | 1 (`customer-management.spec.ts`) | ~120 | ✅ ≤200 |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/admin-customers-routes.test.ts` | 路由文件存在+字段验证+superAdminGuard+app.ts注册 | WS1 → 4 failures（文件未存在时） |
| WS2 | `tests/ws2/admin-customers-nav.test.ts` | 导航含「客户管理」+AdminCustomersPage 组件结构 | WS2 → 3 failures |
| WS3 | `tests/ws3/admin-platform-sessions-pages.test.ts` | 两个页面组件字段+testid+tenant_id筛选逻辑 | WS3 → 3 failures |
| WS4 | `tests/ws4/customer-management-e2e.test.ts` | E2E spec 文件存在+包含正确 test 名称 | WS4 → 2 failures |
