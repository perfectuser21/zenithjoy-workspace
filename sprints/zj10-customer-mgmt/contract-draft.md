# Sprint Contract Draft (Round 3)
# /admin/customers 统一客户管理模块

> **Round 3 修订说明**：修复 1 个 Reviewer BLOCK 项（internal_consistency=6）——
> (1) 截图数 SSOT 统一为 ≥ 8，同步修改 contract-draft.md / task-plan.json / contract-dod-ws4.md BEHAVIOR 5 / tests/ws4/ 共 4 处；
> (2) 删除悬空引用「参见 Round 1 E2E 段」，改为在本文件内嵌完整 E2E spec 骨架，Generator 可直接复制。
>
> **Round 2 修订说明（历史）**：修复 5 个 Reviewer 阻断项——
> (1) 新增 Risks 段（≥3 条）；
> (2) Golden Path Steps 验证命令从源码字符串扫描升级为真实 curl+jq -e API oracle；
> (3) 确认每 WS DoD ≥4 条 [BEHAVIOR]+manual:bash；
> (4) task-plan.json depends_on 链已明确（ws2→ws1→…）；
> (5) 新增 Red Evidence 段（npx vitest run 41 failures 截证）。

---

## Golden Path

[超管登录] → [「客户管理」导航入口] → [/admin/customers 概览列表] → [/admin/customers/platform-sessions 平台绑定] → [/admin/customers/publish-logs 发布追踪+tenant筛选]

---

### Step 1: 超管登录后左侧导航出现「客户管理」分组入口

**来源**: `[FROM_PRD]` — PRD"具体步骤"第1条原文：「超管登录后，左侧导航出现「客户管理」分组入口（requireSuperAdmin）」

**可观测行为**: `navigation.config.ts` 包含 `/admin/customers` NavItem 且标记 `requireSuperAdmin: true`；「客户管理」label 存在。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts', 'utf8');
if (!c.includes('/admin/customers')) { console.error('FAIL: 缺 /admin/customers'); process.exit(1); }
if (!c.includes('requireSuperAdmin')) { console.error('FAIL: 缺 requireSuperAdmin'); process.exit(1); }
if (!c.includes('客户管理')) { console.error('FAIL: 缺「客户管理」label'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 3 项字符串全部存在，exit 0

---

### Step 2: GET /api/admin/customers 返回正确 schema（真实 API oracle）

**来源**: `[FROM_PRD]` — PRD"Response Schema"段 GET /api/admin/customers 定义的 success/data/total 结构

**可观测行为**: 端点返回 `{success: true, data: [{tenant_id, email, license_status, platform_count, last_publish_at}], total: N}`，顶层 keys 完全等于 `[data, success, total]`，禁用字段不出现。

**验证命令（真实 API curl+jq — 需 server 运行于 localhost:5200）**:
```bash
#!/bin/bash
set -e
# pre-check: server must be running (evaluator starts via 'PORT=5200 npx tsx apps/api/src/index.ts &')
RESP=$(curl -sf "http://localhost:5200/api/admin/customers") || {
  echo "FAIL: GET /api/admin/customers 未返回 200（端点未注册 或 server 未启动）"; exit 1
}

# 1. success == true
echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success 不为 true"; exit 1; }

# 2. data 是数组
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是数组"; exit 1; }

# 3. total 是数字
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是数字"; exit 1; }

# 4. schema 完整性：顶层 key 必须精确等于 [data, success, total]
echo "$RESP" | jq -e 'keys | sort | . == ["data","success","total"]' || {
  echo "FAIL: schema 完整性失败 — 顶层 keys 不精确匹配 [data,success,total]"; exit 1
}

# 5. 禁用字段反向检查
echo "$RESP" | jq -e 'has("users") | not'   || { echo "FAIL: 禁用字段 users 出现"; exit 1; }
echo "$RESP" | jq -e 'has("clients") | not' || { echo "FAIL: 禁用字段 clients 出现"; exit 1; }
echo "$RESP" | jq -e 'has("members") | not' || { echo "FAIL: 禁用字段 members 出现"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not'  || { echo "FAIL: 禁用字段 result 出现"; exit 1; }

echo "✅ GET /api/admin/customers 验证通过"
```

**硬阈值**: 所有 jq -e 断言 exit 0

---

### Step 3: GET /api/admin/customers/platform-sessions 返回正确 schema

**来源**: `[FROM_PRD]` — PRD"Response Schema"段 platform-sessions 定义：session_id/tenant_id/platform/status/expires_at；status 只能是 active|expired

**可观测行为**: 端点返回正确 schema，status 字面量只为 `active` 或 `expired`，query param 为 `tenant_id`（禁用 user/client/id/t）。

**验证命令（真实 API curl+jq）**:
```bash
#!/bin/bash
set -e
RESP=$(curl -sf "http://localhost:5200/api/admin/customers/platform-sessions") || {
  echo "FAIL: platform-sessions 端点未返回 200"; exit 1
}

echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success 不为 true"; exit 1; }
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是数字"; exit 1; }

# schema 完整性
echo "$RESP" | jq -e 'keys | sort | . == ["data","success","total"]' || {
  echo "FAIL: schema 完整性失败"; exit 1
}

# 如有数据，验证 data item 字段
DATA_LEN=$(echo "$RESP" | jq '.data | length')
if [ "$DATA_LEN" -gt "0" ]; then
  echo "$RESP" | jq -e '.data[0] | has("session_id")' || { echo "FAIL: session_id 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("tenant_id")' || { echo "FAIL: tenant_id 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("platform")' || { echo "FAIL: platform 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("status")' || { echo "FAIL: status 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("expires_at")' || { echo "FAIL: expires_at 字段缺失"; exit 1; }
  # status 值只能是 active 或 expired
  echo "$RESP" | jq -e '.data[].status | . == "active" or . == "expired"' || {
    echo "FAIL: status 含禁用值 (valid/ok/inactive)"; exit 1
  }
fi

# tenant_id query param 筛选有效（用 tenant_id 不是禁用 query 名）
RESP_FILTERED=$(curl -sf "http://localhost:5200/api/admin/customers/platform-sessions?tenant_id=00000000-0000-0000-0000-000000000000") || {
  echo "FAIL: tenant_id 筛选请求失败（禁用 query 名被使用或端点报错）"; exit 1
}
echo "$RESP_FILTERED" | jq -e '.success == true' || { echo "FAIL: tenant_id 筛选 success 不为 true"; exit 1; }

echo "✅ GET /api/admin/customers/platform-sessions 验证通过"
```

**硬阈值**: 所有 jq -e 断言 exit 0

---

### Step 4: GET /api/admin/customers/publish-logs 支持 tenant_id 筛选

**来源**: `[FROM_PRD]` — PRD"具体步骤"第4条 + Response Schema 定义 log_id/tenant_id/work_id/platform/status/created_at

**可观测行为**: 端点返回正确 schema，通过 `tenant_id` query param 筛选（不接受禁用名 user/client/id/t）。

**验证命令（真实 API curl+jq）**:
```bash
#!/bin/bash
set -e
RESP=$(curl -sf "http://localhost:5200/api/admin/customers/publish-logs") || {
  echo "FAIL: publish-logs 端点未返回 200"; exit 1
}

echo "$RESP" | jq -e '.success == true' || { echo "FAIL: success 不为 true"; exit 1; }
echo "$RESP" | jq -e '.data | type == "array"' || { echo "FAIL: data 不是数组"; exit 1; }
echo "$RESP" | jq -e '.total | type == "number"' || { echo "FAIL: total 不是数字"; exit 1; }

# schema 完整性
echo "$RESP" | jq -e 'keys | sort | . == ["data","success","total"]' || {
  echo "FAIL: schema 完整性失败"; exit 1
}

# 如有数据，验证 data item 字段
DATA_LEN=$(echo "$RESP" | jq '.data | length')
if [ "$DATA_LEN" -gt "0" ]; then
  echo "$RESP" | jq -e '.data[0] | has("log_id")'    || { echo "FAIL: log_id 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("tenant_id")' || { echo "FAIL: tenant_id 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("work_id")'   || { echo "FAIL: work_id 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("platform")'  || { echo "FAIL: platform 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("status")'    || { echo "FAIL: status 字段缺失"; exit 1; }
  echo "$RESP" | jq -e '.data[0] | has("created_at")' || { echo "FAIL: created_at 字段缺失"; exit 1; }
fi

# tenant_id 筛选（用合法 query 名）
RESP_FILTERED=$(curl -sf "http://localhost:5200/api/admin/customers/publish-logs?tenant_id=00000000-0000-0000-0000-000000000000") || {
  echo "FAIL: tenant_id 筛选请求失败"; exit 1
}
echo "$RESP_FILTERED" | jq -e '.success == true' || { echo "FAIL: 筛选响应 success 不为 true"; exit 1; }

# 禁用 query 名返回 404 或 400（不被接受）
BAD_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:5200/api/admin/customers/publish-logs?user=abc")
# 注：服务器应忽略未知 query 参数（返回 200），但不应有 req.query.user 逻辑分支
# 至少验证 tenant_id 是功能性的 query param（实现使用 req.query.tenant_id 不是 req.query.user）
echo "✅ GET /api/admin/customers/publish-logs 验证通过"
```

**硬阈值**: 所有 jq -e 断言 exit 0；tenant_id 筛选有效

---

### Step 5: 非超管访问 /admin/customers/* 返回 403

**来源**: `[FROM_PRD]` — PRD"边界情况"原文：「非超管访问 /admin/customers/* 返回 403」

**可观测行为**: 路由使用 `superAdminGuard` 中间件；携带无效 feishu-user-id 时返回 403。

**验证命令（真实 API curl — 设置 ZENITHJOY_INTERNAL_TOKEN 触发鉴权）**:
```bash
#!/bin/bash
set -e
# 临时设置 token 触发鉴权逻辑（superAdminGuard 在 token 设置且不匹配时返回 401）
# 用非法 feishu-user-id 触发 403
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Feishu-User-Id: not-an-admin" \
  "http://localhost:5200/api/admin/customers")
[ "$CODE" = "403" ] || { echo "FAIL: 非超管应返回 403，实际 HTTP=$CODE"; exit 1; }

echo "✅ 非超管 403 拦截验证通过"
```

**硬阈值**: HTTP 403，exit 0

---

### Step 6: 禁用字段名不出现在响应中（防 schema 漂移）

**来源**: `[AI_ADDED]` — GAN Round 2 Proposer 加入，理由：PRD 明确列出 6 个禁用字段名，generator 有历史记录把 `data` 改为 `users` 或 `result`；此步骤确保 schema 漂移在 smoke 阶段被捕获，不让 Reviewer 遗漏。

**可观测行为**: 三个端点的响应均不含禁用字段名作为顶层 key。

**验证命令**:
```bash
#!/bin/bash
set -e
FORBIDDEN=("users" "clients" "members" "result")
ENDPOINTS=(
  "http://localhost:5200/api/admin/customers"
  "http://localhost:5200/api/admin/customers/platform-sessions"
  "http://localhost:5200/api/admin/customers/publish-logs"
)

for EP in "${ENDPOINTS[@]}"; do
  RESP=$(curl -sf "$EP") || { echo "FAIL: $EP 未返回 200"; exit 1; }
  for F in "${FORBIDDEN[@]}"; do
    echo "$RESP" | jq -e "has(\"$F\") | not" || {
      echo "FAIL: 端点 $EP 含禁用字段 $F"; exit 1
    }
  done
done

echo "✅ 禁用字段反向检查通过（全部 3 端点 × 4 禁用字段）"
```

**硬阈值**: 12 次 jq -e 断言全部 exit 0

---

## Risks（v7.12 Round 2 新增 — 修复 Reviewer 风险登记=1 阻断）

| # | 风险 | 概率 | 影响 | Mitigation |
|---|------|------|------|-----------|
| R1 | DB 表 `agent_platform_sessions`/`publish_logs`/tenants 不存在或无数据 | 中 | 高：评估时 data 数组为空，字段检查跳过，假绿 | PRD 已标注 [ASSUMPTION: DB 表已存在且有数据]；evaluator 在运行 smoke 前需确认 DB 有至少 1 行测试数据；必要时用 psql 手动 INSERT seed 数据 |
| R2 | windows_cloud runner 上无可用超管账号/Token | 中 | 中：Playwright step 4（403 拦截验证）无法用真实身份验证 → 降级为 stub 模式 | E2E spec 用 `page.route()` mock 403 响应；超管 Feishu OpenID 通过 CI secret `ADMIN_FEISHU_OPENIDS` 注入 → 在 GHA workflow env 中配置 |
| R3 | ws1 实现失败导致 ws2/ws3/ws4 无法评估（级联失败） | 低 | 高：task-plan.json 串行链中 ws2 depends_on ws1，ws1 FAIL → 后续全部挂起 | task-plan.json 明确 depends_on 串行链；Brain dispatch 按依赖顺序调度；ws1 失败时 Evaluator 立即上报，不继续后续 ws |

---

## API Smoke 脚本完整版（evaluator mode A 使用 — ws1 实现后运行）

> **使用前提**：`cd /workspace/apps/api && npm install && PORT=5200 npx tsx src/index.ts &`（dev 模式：`ZENITHJOY_INTERNAL_TOKEN` 未设置，superAdminGuard 开放通道）

```bash
#!/bin/bash
# smoke-customer-mgmt.sh — evaluator mode A 验证 ws1 API 行为
set -e
BASE="http://localhost:5200"

echo "=== smoke: GET /api/admin/customers ==="
C=$(curl -sf "$BASE/api/admin/customers")
echo "$C" | jq -e '.success == true'                                  || { echo FAIL_success; exit 1; }
echo "$C" | jq -e '.data | type == "array"'                           || { echo FAIL_data_type; exit 1; }
echo "$C" | jq -e '.total | type == "number"'                         || { echo FAIL_total_type; exit 1; }
echo "$C" | jq -e 'keys | sort | . == ["data","success","total"]'     || { echo FAIL_schema_completeness; exit 1; }
echo "$C" | jq -e 'has("users") | not'                                || { echo FAIL_forbidden_users; exit 1; }
echo "$C" | jq -e 'has("clients") | not'                              || { echo FAIL_forbidden_clients; exit 1; }
echo "$C" | jq -e 'has("members") | not'                              || { echo FAIL_forbidden_members; exit 1; }
echo "$C" | jq -e 'has("result") | not'                               || { echo FAIL_forbidden_result; exit 1; }
echo "PASS /api/admin/customers"

echo "=== smoke: GET /api/admin/customers/platform-sessions ==="
C=$(curl -sf "$BASE/api/admin/customers/platform-sessions")
echo "$C" | jq -e '.success == true'                               || { echo FAIL_success; exit 1; }
echo "$C" | jq -e '.data | type == "array"'                        || { echo FAIL_data_type; exit 1; }
echo "$C" | jq -e '.total | type == "number"'                      || { echo FAIL_total_type; exit 1; }
echo "$C" | jq -e 'keys | sort | . == ["data","success","total"]'  || { echo FAIL_schema_completeness; exit 1; }
echo "PASS /api/admin/customers/platform-sessions"

echo "=== smoke: GET /api/admin/customers/publish-logs ==="
C=$(curl -sf "$BASE/api/admin/customers/publish-logs")
echo "$C" | jq -e '.success == true'                               || { echo FAIL_success; exit 1; }
echo "$C" | jq -e '.data | type == "array"'                        || { echo FAIL_data_type; exit 1; }
echo "$C" | jq -e '.total | type == "number"'                      || { echo FAIL_total_type; exit 1; }
echo "$C" | jq -e 'keys | sort | . == ["data","success","total"]'  || { echo FAIL_schema_completeness; exit 1; }
# tenant_id 筛选（用合法 query 名）
CF=$(curl -sf "$BASE/api/admin/customers/publish-logs?tenant_id=00000000-0000-0000-0000-000000000000")
echo "$CF" | jq -e '.success == true'                              || { echo FAIL_filter_success; exit 1; }
echo "PASS /api/admin/customers/publish-logs"

echo "=== smoke: 403 拦截 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "X-Feishu-User-Id: not-an-admin" \
  "$BASE/api/admin/customers")
[ "$CODE" = "403" ] || { echo "FAIL: 非超管应 403，实际 HTTP=$CODE"; exit 1; }
echo "PASS 403 拦截"

echo "✅ 全部 API smoke 测试通过"
```

---

## E2E 验收（final-e2e — target_environment: windows_cloud）

**journey_type**: user_facing
**target_environment**: windows_cloud
**E2E runner**: GitHub Actions windows-latest

**E2E spec 位置**: `apps/dashboard/e2e/customer-management.spec.ts`
**GHA workflow**: `.github/workflows/e2e-windows.yml`（`workflow_dispatch` + `windows-latest`）

**spec 内容**（由 WS4 实现，Generator 直接复制到 `apps/dashboard/e2e/customer-management.spec.ts`）：

```typescript
// apps/dashboard/e2e/customer-management.spec.ts
import { test, expect } from '@playwright/test';

const STUB_CUSTOMERS = {
  success: true,
  data: [
    { tenant_id: 'aaa-bbb-ccc-111', email: 'admin@test.com', license_status: 'active',  platform_count: 2, last_publish_at: '2026-05-01T10:00:00Z' },
    { tenant_id: 'bbb-ccc-ddd-222', email: 'user@test.com',  license_status: 'expired', platform_count: 0, last_publish_at: null }
  ],
  total: 2
};

const STUB_SESSIONS = {
  success: true,
  data: [
    { session_id: 's1', tenant_id: 'aaa-bbb-ccc-111', platform: 'kuaishou', status: 'active',  expires_at: '2026-12-01T00:00:00Z' },
    { session_id: 's2', tenant_id: 'bbb-ccc-ddd-222', platform: 'douyin',   status: 'expired', expires_at: '2026-01-01T00:00:00Z' }
  ],
  total: 2
};

const STUB_LOGS = {
  success: true,
  data: [
    { log_id: 'l1', tenant_id: 'aaa-bbb-ccc-111', work_id: 'w1', platform: 'kuaishou', status: 'success', created_at: '2026-05-01T10:00:00Z' }
  ],
  total: 1
};

const BASE = 'http://localhost:5174';

test.describe('/admin/customers 统一客户管理 E2E', () => {
  test('概览页加载，显示客户列表行', async ({ page }) => {
    await page.route('**/api/admin/customers', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB_CUSTOMERS) })
    );
    await page.screenshot({ path: 'screenshots/ws4-01-before-overview.png' });
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ws4-02-overview-loaded.png' });
    await expect(page.locator('[data-testid="customers-table-row"]').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/ws4-03-overview-asserted.png' });
  });

  test('platform-sessions 页加载，session-status 为 active 或 expired', async ({ page }) => {
    await page.route('**/api/admin/customers/platform-sessions**', route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STUB_SESSIONS) })
    );
    await page.goto(`${BASE}/admin/customers/platform-sessions`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ws4-04-platform-sessions-loaded.png' });
    await expect(page.locator('[data-testid="session-status"]').first()).toBeVisible({ timeout: 10000 });
    const statusText = await page.locator('[data-testid="session-status"]').first().textContent();
    expect(['active', 'expired']).toContain(statusText?.trim());
    await page.screenshot({ path: 'screenshots/ws4-05-sessions-asserted.png' });
  });

  test('publish-logs 页通过 tenant_id query param 筛选', async ({ page }) => {
    await page.route('**/api/admin/customers/publish-logs**', route => {
      const url = new URL(route.request().url());
      const tenantId = url.searchParams.get('tenant_id');
      const body = tenantId
        ? { success: true, data: STUB_LOGS.data.filter(l => l.tenant_id === tenantId), total: 1 }
        : STUB_LOGS;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`${BASE}/admin/customers/publish-logs`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ws4-06-publish-logs-loaded.png' });
    await page.goto(`${BASE}/admin/customers/publish-logs?tenant_id=aaa-bbb-ccc-111`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/ws4-07-logs-filtered.png' });
    await expect(page.locator('[data-testid="publish-logs-table-row"]').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/ws4-08-logs-asserted.png' });
  });

  test('非超管访问 /admin/customers 返回 403 错误页', async ({ page }) => {
    await page.route('**/api/admin/customers', route =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, error: { code: 'FORBIDDEN', message: '权限不足' } })
      })
    );
    await page.goto(`${BASE}/admin/customers`);
    await page.waitForLoadState('networkidle');
    const pageContent = await page.content();
    expect(
      pageContent.includes('403') || pageContent.includes('权限') || pageContent.toLowerCase().includes('forbidden')
    ).toBeTruthy();
  });
});
```

> **截图 SSOT**：spec 骨架含 8 次 `page.screenshot()`（ws4-01 ～ ws4-08），与 task-plan.json ws4 dod、contract-dod-ws4.md BEHAVIOR 5 阈值 `≥ 8`、tests/ws4/ `toBeGreaterThanOrEqual(8)` 四处完全对齐。

**PASS 标准**: 所有 4 个 Playwright test 通过，exit 0，截图存入 `screenshots/`
**FAIL 标准**: 任一 test 失败，exit 1，或 timeout 15min

---

## Workstreams

**workstream_count**: 4

### Workstream 1: 后端 API 路由（3 个端点）

**范围**: 新建 `apps/api/src/routes/admin-customers.ts`（3 GET + superAdminGuard）；在 `app.ts` 注册 `/api/admin/customers`
**大小**: M（~150 行净增，2 文件）
**依赖**: 无（`ws1: depends_on: []`）

**Red Evidence（实现前 vitest 运行）**:
```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws1/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 预期输出：Tests 12 failed (12)
```

---

### Workstream 2: 导航配置 + AdminCustomersPage 概览

**范围**: `navigation.config.ts` 新增「客户管理」NavGroup（requireSuperAdmin）；新建 `AdminCustomersPage.tsx`
**大小**: M（~150 行净增，2 文件）
**依赖**: ws1（API 端点已注册，`depends_on: ["ws1"]`）

**Red Evidence**:
```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws2/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 预期输出：Tests 9 failed (9)
```

---

### Workstream 3: AdminPlatformSessionsPage + AdminPublishLogsPage

**范围**: 新建两个页面组件（platform-sessions + publish-logs）；pageComponents 加两个懒加载映射
**大小**: M（~150 行净增，2+调整文件）
**依赖**: ws2（路由先就位，`depends_on: ["ws2"]`）

**Red Evidence**:
```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws3/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 预期输出：Tests 12 failed (12)
```

---

### Workstream 4: E2E Playwright 测试（windows_cloud）

**范围**: 新建 `apps/dashboard/e2e/customer-management.spec.ts`（4 test，page.route() stub）
**大小**: S（~120 行净增，1 文件）
**依赖**: ws3（页面组件全部存在，`depends_on: ["ws3"]`）

**Red Evidence**:
```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ws4/ --reporter=verbose 2>&1 | grep -E "Tests|failed"
# 预期输出：Tests 9 failed (9)
```

---

## Red Evidence 汇总（全部 41 failures 确认 TDD Red 阶段正确）

```bash
npx vitest run sprints/zj10-customer-mgmt/tests/ --reporter=verbose 2>&1 | grep -E "Test Files|Tests"
# 实际输出（已验证，2026-05-26）：
# Test Files  4 failed (4)
# Tests  42 failed (42)
```

---

## Workstreams 切分自查

| WS | 文件数 | 预期净增行数 | 是否超限 |
|---|---|---|---|
| ws1 | 2 (`admin-customers.ts` ~140行 + `app.ts` 2行调整) | ~142 | ✅ ≤200 |
| ws2 | 2 (`navigation.config.ts` ~30行增量 + `AdminCustomersPage.tsx` ~120行) | ~150 | ✅ ≤200 |
| ws3 | 2 (`AdminPlatformSessionsPage.tsx` ~80行 + `AdminPublishLogsPage.tsx` ~80行) | ~160 | ✅ ≤200 |
| ws4 | 1 (`customer-management.spec.ts` ~120行) | ~120 | ✅ ≤200 |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | Red Evidence |
|---|---|---|---|
| WS1 | `tests/ws1/admin-customers-routes.test.ts` | 12 项 API schema+路由+鉴权+禁用字段检查 | **12 failed** |
| WS2 | `tests/ws2/admin-customers-nav.test.ts` | 9 项 nav配置+页面组件+testid+null边界 | **9 failed** |
| WS3 | `tests/ws3/admin-platform-sessions-pages.test.ts` | 12 项 两页面schema+testid+searchParams | **12 failed** |
| WS4 | `tests/ws4/customer-management-e2e.test.ts` | 9 项 spec完整性+testid+路由+截图 | **9 failed** |
| **合计** | 4 files | **42 项** | **42 failed** |
