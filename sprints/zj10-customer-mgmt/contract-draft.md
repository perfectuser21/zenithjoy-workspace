# Sprint Contract Draft (Round 2)
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

**来源**: `[FROM_PRD]` — PRD"Response Schema"段：GET /api/admin/customers Success (HTTP 200) 定义了 `success/data[]/total` 结构，禁用字段名 `users`/`clients`/`members`/`result`

**可观测行为**: 端点返回 `{success: true, data: [{tenant_id, email, license_status, platform_count, last_publish_at}], total: N}`，禁用字段名（`users`/`clients`/`members`/`result`）不作为顶层 key 出现。

**验证命令**（运行时 oracle — 启动 API 后执行）:
```bash
# 启动 API 服务（ZENITHJOY_INTERNAL_TOKEN 未设 = superAdminGuard 放行）
cd /workspace/apps/api
unset ZENITHJOY_INTERNAL_TOKEN
PORT=15201 npx tsx src/index.ts &
API_PID=$!
trap "kill $API_PID 2>/dev/null" EXIT

# 等待服务就绪（最多 20 秒）
for i in $(seq 1 20); do
  curl -sf localhost:15201/health >/dev/null 2>&1 && break
  [ $i -eq 20 ] && { echo "FAIL: API 服务启动超时"; exit 1; }
  sleep 1
done

RESP=$(curl -sf localhost:15201/api/admin/customers) || { echo "FAIL: /api/admin/customers 返回非 200"; exit 1; }

# 1. 顶层字段 success == true
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
# 2. data 是数组
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是 array"; exit 1; }
# 3. total 是数字
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是 number"; exit 1; }
# 4. 顶层禁用字段不存在
echo "$RESP" | jq -e 'has("users") | not' || { echo "FAIL: 含禁用字段 users"; exit 1; }
echo "$RESP" | jq -e 'has("clients") | not' || { echo "FAIL: 含禁用字段 clients"; exit 1; }
echo "$RESP" | jq -e 'has("members") | not' || { echo "FAIL: 含禁用字段 members"; exit 1; }
# 5. 若有数据，验证 data[0] schema
DLEN=$(echo "$RESP" | jq '.data | length')
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e '.data[0] | has("tenant_id") and has("email") and has("license_status") and has("platform_count") and has("last_publish_at")' \
    || { echo "FAIL: data[0] 缺必填字段"; exit 1; }
fi

echo "✅ Step 2 GET /api/admin/customers schema 验证通过"
```

**硬阈值**: 全部 jq -e 断言 exit 0；data 为空数组时 total == 0 仍视为通过（DB 假设满足时应有数据）

---

### Step 3: GET /api/admin/customers/platform-sessions 返回正确 schema

**来源**: `[FROM_PRD]` — PRD"Response Schema"段：GET /api/admin/customers/platform-sessions，`session_id/tenant_id/platform/status/expires_at`，status 字面量只能 `active`/`expired`，禁用 query 名 `user`/`client`/`id`/`t`

**可观测行为**: 端点返回 `{success: true, data: [{session_id, tenant_id, platform, status, expires_at}], total: N}`，status 不含 `valid`/`ok`/`inactive`；tenant_id 筛选生效时只返回该 tenant 的记录。

**验证命令**（运行时 oracle — 使用 Step 2 已启动的 API_PID 进程，或重新启动）:
```bash
# 假设 API 已在 Step 2 或独立启动于 localhost:15201
RESP=$(curl -sf 'localhost:15201/api/admin/customers/platform-sessions') \
  || { echo "FAIL: /api/admin/customers/platform-sessions 返回非 200"; exit 1; }

# 1. 顶层 schema
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是 array"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是 number"; exit 1; }

# 2. data[0] schema（若有数据）
DLEN=$(echo "$RESP" | jq '.data | length')
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e '.data[0] | has("session_id") and has("tenant_id") and has("platform") and has("status") and has("expires_at")' \
    || { echo "FAIL: data[0] 缺必填字段"; exit 1; }
  # 3. status 值只能是 active 或 expired
  STATUS=$(echo "$RESP" | jq -r '.data[0].status')
  [ "$STATUS" = "active" ] || [ "$STATUS" = "expired" ] \
    || { echo "FAIL: status 值 '$STATUS' 不在允许范围 (active|expired)"; exit 1; }
fi

# 4. tenant_id 筛选测试（使用 tenant_id param，不使用禁用名）
RESP_FILTERED=$(curl -sf 'localhost:15201/api/admin/customers/platform-sessions?tenant_id=nonexistent-tenant') \
  || { echo "FAIL: 带 tenant_id 筛选请求失败"; exit 1; }
echo "$RESP_FILTERED" | jq -e '.success == true and (.data | type == "array")' \
  || { echo "FAIL: tenant_id 筛选响应 schema 错误"; exit 1; }

echo "✅ Step 3 GET /api/admin/customers/platform-sessions schema 验证通过"
```

**硬阈值**: 全部 jq -e 断言 exit 0；带 tenant_id 筛选不报错

---

### Step 4: GET /api/admin/customers/publish-logs 支持 tenant_id 筛选

**来源**: `[FROM_PRD]` — PRD"具体步骤"第4条 + Response Schema：publish-logs 含 `log_id/tenant_id/work_id/platform/status/created_at`，支持 `tenant_id` query param 筛选，禁用 query 名 `user`/`client`/`id`/`t`

**可观测行为**: 端点返回 `{success: true, data: [{log_id, tenant_id, work_id, platform, status, created_at}], total: N}`；带 `tenant_id=X` 时只返回该 tenant 的记录；`created_at` 是 ISO8601 字符串。

**验证命令**（运行时 oracle）:
```bash
RESP=$(curl -sf 'localhost:15201/api/admin/customers/publish-logs') \
  || { echo "FAIL: /api/admin/customers/publish-logs 返回非 200"; exit 1; }

# 1. 顶层 schema
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success != true"; exit 1; }
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是 array"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是 number"; exit 1; }

# 2. data[0] schema（若有数据）
DLEN=$(echo "$RESP" | jq '.data | length')
if [ "$DLEN" -gt 0 ]; then
  echo "$RESP" | jq -e '.data[0] | has("log_id") and has("tenant_id") and has("work_id") and has("platform") and has("status") and has("created_at")' \
    || { echo "FAIL: data[0] 缺必填字段"; exit 1; }
  # created_at 是字符串
  echo "$RESP" | jq -e '.data[0].created_at | type == "string"' \
    || { echo "FAIL: created_at 不是 string"; exit 1; }
fi

# 3. tenant_id 筛选测试（使用 tenant_id param，不使用 user/client/id/t）
RESP_F=$(curl -sf 'localhost:15201/api/admin/customers/publish-logs?tenant_id=test-tenant') \
  || { echo "FAIL: 带 tenant_id 筛选请求失败"; exit 1; }
echo "$RESP_F" | jq -e '.success == true and (.data | type == "array")' \
  || { echo "FAIL: tenant_id 筛选响应 schema 错误"; exit 1; }

echo "✅ Step 4 GET /api/admin/customers/publish-logs schema 验证通过"
```

**硬阈值**: 全部 jq -e 断言 exit 0；`tenant_id` query param 正确传递

---

### Step 5: 非超管访问 /admin/customers/* 返回 403

**来源**: `[FROM_PRD]` — PRD"边界情况"："非超管访问 /admin/customers/* 返回 403"

**可观测行为**: 携带无效凭据（或不携带）时所有 /admin/customers/* 端点返回 403。

**验证命令**:
```bash
# 设置一个无效的内部 token，触发 superAdminGuard 401/403
export ZENITHJOY_INTERNAL_TOKEN="invalid-for-test"
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer wrong-token" \
  localhost:15201/api/admin/customers)
[ "$CODE" = "401" ] || [ "$CODE" = "403" ] \
  || { echo "FAIL: 非超管访问返回 $CODE（期望 401 或 403）"; exit 1; }
unset ZENITHJOY_INTERNAL_TOKEN
echo "✅ Step 5 403 拦截验证通过"
```

**硬阈值**: HTTP 状态码 401 或 403；exit 0

---

### Step 6: 禁用字段名不出现在任何响应中（防止 schema 漂移）

**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：PRD 明确列出禁用字段名，generator 历史上会把 `data` 改成 `users` 或 `result`；加本步骤确保静态代码层也无漂移

**可观测行为**: 路由实现文件不含任何禁用字段名（`users`/`clients`/`members`/`result`）作为顶层 response object 的 key。

**验证命令**（已修复 Bug：移除逻辑倒置的 ok-fields 旁路条件）:
```bash
node -e "
const c = require('fs').readFileSync('apps/api/src/routes/admin-customers.ts', 'utf8');
// 精确匹配禁用字段作为对象 key（如 '\"users\":' 或 'users:'）
const forbidden = [
  /[\"']users[\"']\s*:/,
  /[\"']clients[\"']\s*:/,
  /[\"']members[\"']\s*:/,
  /\bdata\s*:\s*result\b/
];
forbidden.forEach((re, i) => {
  if (re.test(c)) {
    console.error('FAIL: 禁用字段名出现在响应对象中，pattern index=' + i);
    process.exit(1);
  }
});
console.log('OK');
"
```

**硬阈值**: 禁用字段名不作为 response key 出现；exit 0

---

## Risks

| # | Risk | 触发条件 | Mitigation |
|---|---|---|---|
| R1 | **DB 表 / 数据假设失效** | windows_cloud runner 没有连接真实 DB，或 agent_platform_sessions / publish_logs 表不存在 | WS4 Playwright 使用 page.route() stub，不依赖真实 DB；后端 WS1 runtime oracle 可在无数据时跳过 data[0] 字段检查（DLEN=0 时只验证顶层 schema） |
| R2 | **超管账号假设失效** | windows_cloud runner 中 ADMIN_FEISHU_OPENIDS / ZENITHJOY_INTERNAL_TOKEN 未设置，无法创建真实超管 session | evaluator 使用 `unset ZENITHJOY_INTERNAL_TOKEN` 触发 dev 兼容路径（superAdminGuard 放行）；测试时明确 unset 而非依赖环境预置 |
| R3 | **navigation.config.ts filterNavGroups 破坏现有鉴权** | 向 pageComponents 新增 AdminCustomersPage 但忘记更新 filterNavGroups 白名单，导致所有超管菜单失效 | WS2 BEHAVIOR 第 5 条明确检查 filterNavGroups 仍存在；generator 须增量修改不删除 |

---

## E2E 验收（final-e2e — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E runner**: GitHub Actions windows-latest（每次全新 VM，无 cookie/session 历史）

```javascript
// apps/dashboard/e2e/customer-management.spec.ts
// 在 GitHub Actions windows-latest 上执行（page.route() stub 模式，不依赖真实后端）

import { test, expect } from '@playwright/test';

test.describe('客户管理模块 Golden Path', () => {

  test('Step 1: /admin/customers 概览页加载，显示客户列表', async ({ page }) => {
    await page.route('**/api/admin/customers', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            { tenant_id: 'aaa-111', email: 'test@example.com', license_status: 'active', platform_count: 2, last_publish_at: '2026-05-20T10:00:00Z' },
            { tenant_id: 'bbb-222', email: 'test2@example.com', license_status: 'expired', platform_count: 0, last_publish_at: null },
          ],
          total: 2,
        },
      });
    });

    await page.goto('http://localhost:5174/admin/customers');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-customers-overview-before.png' });

    await expect(page.locator('[data-testid="customers-table-row"]').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toContainText('active');
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toContainText('test@example.com');
    await page.screenshot({ path: 'screenshots/01-customers-overview.png' });
  });

  test('Step 2: /admin/customers/platform-sessions 平台绑定状态', async ({ page }) => {
    await page.route('**/api/admin/customers/platform-sessions**', async (route) => {
      await route.fulfill({
        json: {
          success: true,
          data: [
            { session_id: 'sess-001', tenant_id: 'aaa-111', platform: 'douyin', status: 'active', expires_at: '2026-12-31T23:59:59Z' },
            { session_id: 'sess-002', tenant_id: 'bbb-222', platform: 'kuaishou', status: 'expired', expires_at: '2026-01-01T00:00:00Z' },
          ],
          total: 2,
        },
      });
    });

    await page.goto('http://localhost:5174/admin/customers/platform-sessions');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/02-platform-sessions-before.png' });

    await expect(page.locator('[data-testid="platform-sessions-table-row"]').first()).toBeVisible({ timeout: 10000 });
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
            { log_id: 'log-001', tenant_id: capturedTenantId ?? 'aaa-111', work_id: 'work-001', platform: 'douyin', status: 'published', created_at: '2026-05-20T10:00:00Z' },
          ],
          total: 1,
        },
      });
    });

    await page.goto('http://localhost:5174/admin/customers/publish-logs?tenant_id=aaa-111');
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/03-publish-logs-before.png' });

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
    await page.screenshot({ path: 'screenshots/04-forbidden-before.png' });

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
- `01-customers-overview-before.png` — 操作前初始状态
- `01-customers-overview.png` — 客户概览列表正常加载，表格行可见，license_status 显示
- `02-platform-sessions-before.png` — 导航操作前
- `02-platform-sessions.png` — 平台绑定状态列表，status 值为 active/expired
- `03-publish-logs-before.png` — 筛选前
- `03-publish-logs.png` — 发布追踪列表，tenant_id 筛选有效
- `04-forbidden-before.png` — 403 拦截前状态
- `04-forbidden.png` — 非超管访问被拦截或重定向

---

## Workstreams

**workstream_count**: 4

### Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3 个 GET 端点 + superAdminGuard）；在 `apps/api/src/app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行）
**依赖**: 无（`ws1: depends_on: []`）
**BEHAVIOR 覆盖**: `tests/ws1/admin-customers-routes.test.ts`

---

### Workstream 2: 导航配置 + AdminCustomersPage 概览

**范围**: `apps/dashboard/src/config/navigation.config.ts` 新增「客户管理」NavGroup + 3 NavItems；新建 `apps/dashboard/src/pages/AdminCustomersPage.tsx`（概览表格）
**大小**: M（~150 行）
**依赖**: Workstream 1 完成后
**BEHAVIOR 覆盖**: `tests/ws2/admin-customers-nav.test.ts`

---

### Workstream 3: AdminPlatformSessionsPage + AdminPublishLogsPage

**范围**: 新建 `apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx` + `AdminPublishLogsPage.tsx`；在 `navigation.config.ts` 添加 additionalRoutes
**大小**: M（~150 行）
**依赖**: Workstream 2 完成后
**BEHAVIOR 覆盖**: `tests/ws3/admin-platform-sessions-pages.test.ts`

---

### Workstream 4: E2E Playwright 测试（windows_cloud）

**范围**: 新建 `apps/dashboard/e2e/customer-management.spec.ts`（4 个 test，API stub 模式）
**大小**: S（~120 行）
**依赖**: Workstream 3 完成后
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
| WS1 | `tests/ws1/admin-customers-routes.test.ts` | 路由注册（GET 200）+ schema 字段 + superAdminGuard + 禁用字段不存在 + 运行时 jq-e oracle | WS1 未实现 → 路由返回 404 → **4 failures**（status 404 ≠ 200）|
| WS2 | `tests/ws2/admin-customers-nav.test.ts` | 导航含「客户管理」+ AdminCustomersPage 组件结构 + testid | WS2 → **3 failures**（文件不存在）|
| WS3 | `tests/ws3/admin-platform-sessions-pages.test.ts` | 两个页面组件字段 + testid + tenant_id 筛选逻辑 | WS3 → **3 failures** |
| WS4 | `tests/ws4/customer-management-e2e.test.ts` | E2E spec 文件存在 + 包含正确 test 名称 | WS4 → **2 failures** |

### WS1 预期 Red 输出（`npx vitest run tests/ws1/admin-customers-routes.test.ts`）

```
 FAIL  sprints/zj10-customer-mgmt/tests/ws1/admin-customers-routes.test.ts

 × WS1 — admin-customers 后端 API 路由 [BEHAVIOR] > GET /api/admin/customers 返回 200 + PRD schema (12ms)
   AssertionError: expected 404 to be 200
     Expected: 200
     Received: 404

 × WS1 — admin-customers 后端 API 路由 [BEHAVIOR] > GET /api/admin/customers/platform-sessions 返回 200 + PRD schema (9ms)
   AssertionError: expected 404 to be 200
     Expected: 200
     Received: 404

 × WS1 — admin-customers 后端 API 路由 [BEHAVIOR] > GET /api/admin/customers/publish-logs 返回 200 + PRD schema (8ms)
   AssertionError: expected 404 to be 200
     Expected: 200
     Received: 404

 × WS1 — admin-customers 后端 API 路由 [BEHAVIOR] > superAdminGuard 中间件存在，非超管返回 401/403 (11ms)
   AssertionError: expected 200 to satisfy (status => [401,403].includes(status))
     Expected: [401, 403]
     Received: 200 (路由未注册时 notFoundHandler 不走 superAdminGuard，所以返回 404 which ≠ 403)

Test Files  1 failed (1)
Tests       4 failed (4)
```
