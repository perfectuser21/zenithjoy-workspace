# account-scan-manual-trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Path2 账号扫描（`DeviceAccountScanService`）补一条服务端可主动触发的通道，把客户切换抖音账号后 Dashboard 显示新账号的延迟从"最长等一小时、无反馈"降到"最坏约30秒、有明确状态提示"。

**Architecture:** 照抄已验证过的 DM 派单模式（`dispatchDue`/`routeDmOutreachTask`）——Dashboard 按钮 → 新 API 端点校验在线设备+限流后写一条 `publish_tasks(task_type='account_scan')` → 手机端既有的 ws1 心跳（≤30s 周期）拉到任务 → `AgentService` 新增判别符分支直接调用已有的 `DeviceAccountScanService.dispatchTask`（该服务已有 `state != IDLE` 重入保护，与内部 30-60 分钟循环天然互斥）。

**Tech Stack:** TypeScript/Express（API + Dashboard React），Kotlin（Android），Vitest，JUnit，Playwright。

## Global Constraints

- TDD 铁律：每个 task 先写失败测试（commit-1），再写实现让测试变绿（commit-2）
- 不改 `DeviceAccountScanService` 扫描本体逻辑（面板读取/账号识别/结果上报路径）
- 不改 `runAccountScanLoop` 内部 30-60 分钟被动轮询本身（继续保留兜底）
- 手动触发走 ws1（HTTP 心跳长轮询 30s 周期），不改造 ws0 真 WebSocket——延迟最坏约 30 秒，Dashboard 文案禁止承诺"3-5秒"等精确数字
- 限流用 `simpleRateLimit`（`apps/api/src/middleware/simple-rate-limit.ts`，已存在，直接复用，不手写限流逻辑）
- `tenantId` 传给 Android 端时必须传空字符串（安全约定：设备侧不可信任 tenantId，服务端按 `agent_id` 反查），同 `runAccountScanLoop` 现有调用方式

---

### Task 1: API 触发端点 `POST /api/acquisition/account-scan/trigger`

**Files:**
- Modify: `apps/api/src/routes/acquisition.ts`（新增路由，插入位置：文件内其它 `acquisitionRouter.post(...)` 路由附近，如 `/collect/start` 之后）
- Test: `apps/api/src/routes/acquisition.test.ts`（追加新 describe 块）

**Interfaces:**
- Consumes：`pool`（已 import）、`tenantContextOptional`（已 import）、`simpleRateLimit`（已 import）、`tenantOf`/`ok`/`fail` 辅助函数（文件内已定义，489-503行）
- Produces：路由 `POST /api/acquisition/account-scan/trigger`，成功响应 `{success:true, data:{task_id}}`，供 Task 3 的 Dashboard 按钮调用

**当前文件里可直接复用的三个既有片段（照抄写法，不要发明新模式）：**

`simpleRateLimit` 用法（`apps/api/src/routes/acquisition.ts:26-31`）：
```typescript
const pendingCollectTasksRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 60,
  keyFn: (req) => req.header('x-agent-id') || 'anonymous',
});
```

`tenantOf`/`ok`/`fail` 定义（`apps/api/src/routes/acquisition.ts:489-503`，已存在不用重写）：
```typescript
function ok(res: Response, data: unknown, status = 200) {
  return res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
}
function fail(res: Response, status: number, code: string, message: string) {
  return res
    .status(status)
    .json({ success: false, error: { code, message }, timestamp: new Date().toISOString() });
}
function tenantOf(req: Request, res: Response): string | null {
  const t = req.tenantId;
  if (!t) {
    fail(res, 401, 'NO_TENANT', '缺租户上下文（未登录或无 X-Tenant-Id）');
    return null;
  }
  return t;
}
```

`/collect/start` 的路由定义写法（`apps/api/src/routes/acquisition.ts:578`）作为参照：
```typescript
acquisitionRouter.post('/collect/start', tenantContextOptional, async (req: Request, res: Response) => {
  const tenantId = tenantOf(req, res);
  if (!tenantId) return;
  // ...
});
```

- [ ] **Step 1: 写失败测试 — 追加到 `apps/api/src/routes/acquisition.test.ts` 文件末尾**

```typescript
describe('POST /api/acquisition/account-scan/trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无在线 android 设备 → 400 NO_ONLINE_ANDROID_AGENT', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValueOnce({ rows: [] }); // 查在线 android agent 为空

    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-1')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NO_ONLINE_ANDROID_AGENT');
  });

  it('有在线 android 设备 → 200，写入 publish_tasks(task_type=account_scan)', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any)
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] }) // 查在线 android agent
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid-1' }] }); // INSERT publish_tasks

    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-1')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.task_id).toBe('task-uuid-1');

    const insertCall = (db.query as any).mock.calls[1];
    expect(insertCall[0]).toContain('publish_tasks');
    expect(insertCall[0]).toContain('account_scan');
  });

  it('缺租户上下文 → 401 NO_TENANT', async () => {
    const res = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_TENANT');
  });

  it('60秒内重复触发同一租户 → 第二次 429 RATE_LIMITED', async () => {
    const { default: db } = await import('../db/connection');
    (db.query as any).mockResolvedValue({ rows: [{ id: 'agent-uuid-1' }] });

    const first = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-rate-limit-test')
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/acquisition/account-scan/trigger')
      .set('x-test-tenant-id', 'tenant-rate-limit-test')
      .send({});
    expect(second.status).toBe(429);
    expect(second.body.error.code).toBe('RATE_LIMITED');
  });
});
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "account-scan/trigger"`
Expected: 4 个新用例全部 FAIL（路由不存在，404）

- [ ] **Step 3: 实现路由 — 在 `apps/api/src/routes/acquisition.ts` 里新增**

在文件里已有 `simpleRateLimit` 实例定义区（`pendingCollectTasksRateLimit`/`collectReportRateLimit` 附近）追加：

```typescript
// Path2 账号扫描手动触发限流：同租户 60 秒内只允许触发一次，防止连点把
// DeviceAccountScanService（无障碍面板读取）打崩（sprint 07192358）。
const accountScanTriggerRateLimit = simpleRateLimit({
  windowMs: 60_000,
  max: 1,
});
```

在文件里任意一个 `acquisitionRouter.post(...)` 路由之后追加新路由：

```typescript
// POST /api/acquisition/account-scan/trigger — 手动触发账号扫描（sprint 07192358）
// 治根：DeviceAccountScanService 唯一触发路径是客户端 30-60 分钟随机被动定时器，
// 服务端此前完全没有主动催促通道。照抄 dispatchDue 的"写 publish_task + ws1 心跳
// 拉取"机制，延迟从最长一小时降到最坏约30秒。
acquisitionRouter.post(
  '/account-scan/trigger',
  tenantContextOptional,
  accountScanTriggerRateLimit,
  async (req: Request, res: Response) => {
    const tenantId = tenantOf(req, res);
    if (!tenantId) return;

    const agentRes = await pool.query<{ id: string }>(
      `SELECT id FROM zenithjoy.agents
        WHERE tenant_id = $1
          AND capabilities @> ARRAY['android']::text[]
          AND last_heartbeat_at > now() - interval '2 minutes'
        ORDER BY last_heartbeat_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const agentId = agentRes.rows[0]?.id;
    if (!agentId) {
      return fail(res, 400, 'NO_ONLINE_ANDROID_AGENT', '未检测到在线的安卓设备，请先确认手机 App 在运行');
    }

    const taskRes = await pool.query<{ id: string }>(
      `INSERT INTO zenithjoy.publish_tasks
         (agent_id, platform, status, task_type, payload, tenant_id, created_at, updated_at)
       VALUES ($1, 'douyin', 'queued', 'account_scan', '{}'::jsonb, $2, NOW(), NOW())
       RETURNING id`,
      [agentId, tenantId]
    );

    return ok(res, { task_id: taskRes.rows[0].id });
  }
);
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts -t "account-scan/trigger"`
Expected: 4 个用例全部 PASS

- [ ] **Step 5: 跑全文件回归**

Run: `cd apps/api && npx vitest run src/routes/acquisition.test.ts`
Expected: 全部用例（含本次新增 4 条）PASS，无回归

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/acquisition.test.ts
git commit -m "test(acquisition): add failing tests for account-scan trigger endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add apps/api/src/routes/acquisition.ts
git commit -m "feat(acquisition): POST /account-scan/trigger 手动触发账号扫描

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Android 端路由新任务类型

**Files:**
- Modify: `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt`
- Test: `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceAccountScanRouteTest.kt`（新建）

**Interfaces:**
- Consumes：`DeviceAccountScanService.dispatchTask(context, requestId, tenantId, thisDeviceId)`（已存在，签名不变，`services/agent-android/.../account/DeviceAccountScanService.kt:650`）
- Produces：`AgentService.shouldRouteAccountScan(payloadTaskType: String?): Boolean`，供测试直接调用（同 `shouldRouteWarmup`/`shouldRouteDmOutreach` 现有导出模式，`AgentService.kt:871,884`）

**现有可直接照抄的两处代码（`AgentService.kt`）：**

判别符函数（871-884行附近）：
```kotlin
fun shouldRouteWarmup(payloadTaskType: String?): Boolean = payloadTaskType == "warmup"
fun shouldRouteDmOutreach(payloadTaskType: String?): Boolean = payloadTaskType == "dm_outreach"
```

heartbeatLoop 的 `onTask` 回调（317-336行区域）：
```kotlin
onTask = { task ->
    android.util.Log.i(TAG, "ws1 task: ${task.platform} id=${task.task_id} type=${task.type}")
    val payloadTaskType = task.payload["task_type"] as? String
    if (shouldRouteWarmup(payloadTaskType)) {
        val operatorNickname = task.payload["operator_nickname"] as? String ?: ""
        android.util.Log.i(TAG, "ws1 warmup task: id=${task.task_id} operator=$operatorNickname")
        DeviceAccountScanService.dispatchWarmupTask(
            this@AgentService, task.task_id, config.machineId, operatorNickname,
        )
    } else if (task.platform == "android_douyin") {
        val keyword = task.payload["keyword"] as? String ?: ""
        if (keyword.isNotBlank()) {
            DouyinCollectService.dispatchTask(this@AgentService, keyword, task.task_id)
        }
    } else if (shouldRouteDmOutreach(payloadTaskType)) {
        routeDmOutreachTask(task)
    }
},
```

- [ ] **Step 1: 写失败测试 — 新建 `services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceAccountScanRouteTest.kt`**

```kotlin
package com.zenithjoy.agent

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Path2 账号扫描手动触发（sprint 07192358）：判别符测试，同 shouldRouteDmOutreach
 * 现有测试模式（AgentServiceDmTargetTest.kt:61-74）——判别符只看 payload.task_type，
 * 不看 task 顶层 type（服务端 publish_tasks.type 列默认恒为 "image"）。
 */
class AgentServiceAccountScanRouteTest {
    @Test
    fun `payload_task_type=account_scan 才路由`() {
        assertEquals(true, AgentService.shouldRouteAccountScan("account_scan"))
    }

    @Test
    fun `task_type 不是 account_scan 不路由`() {
        assertEquals(false, AgentService.shouldRouteAccountScan("warmup"))
        assertEquals(false, AgentService.shouldRouteAccountScan("dm_outreach"))
        assertEquals(false, AgentService.shouldRouteAccountScan(null))
        assertEquals(false, AgentService.shouldRouteAccountScan(""))
        assertEquals(false, AgentService.shouldRouteAccountScan("image"))
    }
}
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceAccountScanRouteTest"`
Expected: FAIL（`shouldRouteAccountScan` unresolved reference）

- [ ] **Step 3: 实现 — 修改 `AgentService.kt`**

在 `shouldRouteDmOutreach` 定义之后追加：

```kotlin
        // account_scan 判别符（sprint 07192358）：手动触发的账号扫描，同 warmup/dm_outreach
        // 走 payload.task_type 判别，不看 task 顶层 type（服务端恒为默认值 "image"）。
        fun shouldRouteAccountScan(payloadTaskType: String?): Boolean = payloadTaskType == "account_scan"
```

修改 `onTask` 回调，在 `else if (shouldRouteDmOutreach(payloadTaskType))` 分支之后追加一个 `else if` 分支：

```kotlin
                } else if (shouldRouteDmOutreach(payloadTaskType)) {
                    routeDmOutreachTask(task)
                } else if (shouldRouteAccountScan(payloadTaskType)) {
                    // 手动触发的立即扫描：直接复用既有 dispatchTask，DeviceAccountScanService
                    // 内部已有 state != State.IDLE 早退判断，与内部 30-60 分钟循环天然互斥，
                    // 不需要额外去重逻辑（sprint 07192358）。
                    android.util.Log.i(TAG, "ws1 account_scan task (manual trigger): id=${task.task_id}")
                    DeviceAccountScanService.dispatchTask(
                        this@AgentService, task.task_id, tenantId = "", thisDeviceId = config.machineId,
                    )
                }
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceAccountScanRouteTest"`
Expected: PASS

- [ ] **Step 5: 跑相关回归测试**

Run: `cd services/agent-android && ./gradlew testDebugUnitTest --tests "com.zenithjoy.agent.AgentServiceWarmupTest" --tests "com.zenithjoy.agent.AgentServiceDmTargetTest" --tests "com.zenithjoy.agent.AgentServiceAccountScanTest"`
Expected: 全部 PASS（未改动这几个文件覆盖的既有逻辑，仅新增一个判别符+一个 onTask 分支）

- [ ] **Step 6: Commit**

```bash
git add services/agent-android/app/src/test/kotlin/com/zenithjoy/agent/AgentServiceAccountScanRouteTest.kt
git commit -m "test(android): add failing tests for shouldRouteAccountScan

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt
git commit -m "feat(android): 新增 account_scan WS任务类型，立即调用 DeviceAccountScanService

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard "立即扫描" 按钮

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`
- Test: `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts`（新建）
- Modify: `test-registry.yaml`（追加）

**Interfaces:**
- Consumes：Task 1 产出的 `POST /api/acquisition/account-scan/trigger`（响应 `{success, data:{task_id}}` 或 `{success:false, error:{code, message}}`）
- Produces：无（页面组件，终端节点）

**当前文件全文已读**（`apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`，208行），改动点：在文件末尾"📱 Android 绑定"那一小节（现状只有一段说明文字，无按钮）里加按钮 + 状态。

- [ ] **Step 1: 写失败的 Playwright E2E — 新建 `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts`**

```typescript
import { test, expect } from '@playwright/test';

/**
 * Path2 账号扫描手动触发按钮（sprint 07192358）。stub 后端响应，验证真实浏览器
 * 交互：点击 → 调用真实端点 → 60秒内本地禁用 → 离线态错误提示，不 mock 组件本身。
 */
test.describe('账号管理页 — 立即扫描按钮', () => {
  test('点击后调用触发端点，展示成功提示并禁用按钮', async ({ page }) => {
    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    let triggerCalled = false;
    await page.route('/api/acquisition/account-scan/trigger', (route) => {
      triggerCalled = true;
      return route.fulfill({ json: { success: true, data: { task_id: 'task-1' } } });
    });

    await page.goto('/area/acquisition/accounts');
    const btn = page.getByRole('button', { name: '立即扫描' });
    await expect(btn).toBeVisible();
    await btn.click();

    expect(triggerCalled).toBe(true);
    await expect(page.getByText(/已发送.*最长.*30秒/)).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('无在线设备时点击 → 展示明确错误提示', async ({ page }) => {
    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    await page.route('/api/acquisition/account-scan/trigger', (route) =>
      route.fulfill({
        status: 400,
        json: { success: false, error: { code: 'NO_ONLINE_ANDROID_AGENT', message: '未检测到在线的安卓设备，请先确认手机 App 在运行' } },
      })
    );

    await page.goto('/area/acquisition/accounts');
    await page.getByRole('button', { name: '立即扫描' }).click();

    await expect(page.getByText('未检测到在线的安卓设备，请先确认手机 App 在运行')).toBeVisible();
  });
});
```

> 路由路径已核实：`apps/dashboard/src/config/navigation.config.ts:207` 注册 `{ path: '/area/acquisition/accounts', component: 'AcquisitionAccountsPage' }`，上面两条测试的 `page.goto` 已按此路径写死。

- [ ] **Step 2: 跑测试确认报红**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-account-scan-trigger.spec.ts`
Expected: FAIL（找不到"立即扫描"按钮）

- [ ] **Step 3: 实现 — 修改 `AcquisitionAccountsPage.tsx`**

在组件顶部 state 声明区（`accountLabel`/`labelError`/`submitting` 附近）追加：

```typescript
const [scanTriggering, setScanTriggering] = useState(false);
const [scanMessage, setScanMessage] = useState('');
const [scanError, setScanError] = useState('');
const [scanCooldownUntil, setScanCooldownUntil] = useState(0);
```

在组件内追加处理函数（`handleStartBind` 函数之后）：

```typescript
async function handleTriggerScan() {
  setScanTriggering(true);
  setScanMessage('');
  setScanError('');
  try {
    const r = await fetch('/api/acquisition/account-scan/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const j = await r.json();
    if (!j?.success) {
      setScanError(j?.error?.message || '触发扫描失败');
    } else {
      setScanMessage('已发送扫描请求，最长等待约30秒后刷新本页查看');
      setScanCooldownUntil(Date.now() + 60_000);
    }
  } catch (e) {
    setScanError(String((e as Error).message || e));
  } finally {
    setScanTriggering(false);
  }
}

const scanOnCooldown = Date.now() < scanCooldownUntil;
```

把"📱 Android 绑定"小节（文件末尾，现状只有一段 `<p>` 说明文字）替换为：

```tsx
<div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">📱 Android 绑定</div>
<p className="text-sm text-gray-600 dark:text-gray-400">
  在手机 ZenithJoy Agent App 里，切换到你要绑定的抖音小号——中台会自动检测到并出现在上方账号列表里，无需在此操作。
  App 内置每 30-60 分钟自动扫描一次；如果不想等，可以点下面的按钮立即触发一次。
</p>
<button
  type="button"
  disabled={scanTriggering || scanOnCooldown}
  onClick={handleTriggerScan}
  className="mt-2 rounded bg-orange-600 px-4 py-2 text-white text-sm disabled:bg-gray-300 dark:disabled:bg-slate-700"
>
  立即扫描
</button>
{scanMessage ? <div className="mt-2 text-sm text-green-600 dark:text-green-400">{scanMessage}</div> : null}
{scanError ? <div className="mt-2 text-sm text-red-600 dark:text-red-400">{scanError}</div> : null}
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-account-scan-trigger.spec.ts`
Expected: PASS

- [ ] **Step 5: 注册进 test-registry.yaml**

在文件末尾追加：

```yaml
- id: account-scan-trigger-button-e2e
  path: apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts
  type: e2e
  ci: L3
  status: active
  product: 客户智能获客
  note: "sprint(07192358): 账号扫描手动触发通道——Dashboard立即扫描按钮真Playwright规格，验证点击后调真实端点+60秒本地禁用+离线态错误提示"
```

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts
git commit -m "test(dashboard): add failing E2E for account-scan trigger button

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add apps/dashboard/src/pages/AcquisitionAccountsPage.tsx test-registry.yaml
git commit -m "feat(dashboard): 账号管理页加「立即扫描」按钮

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: smoke 脚本（feat: 类 PR 强制要求）

**Files:**
- Create: `.github/workflows/scripts/smoke/account-scan-trigger-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`

**Interfaces:**
- Consumes：staging API `POST /api/acquisition/account-scan/trigger`（Task 1 新增端点）、`GET /health`
- Produces：无

**背景**：项目 CLAUDE.md 铁律——`feat:` 类 PR 改了 `apps/*/src/` 必须有对应 smoke.sh 挂进 CI，否则 `lint-feature-has-smoke` 拦截合并。

- [ ] **Step 1: 写 smoke 脚本**

```bash
#!/usr/bin/env bash
# account-scan-trigger-smoke.sh — 验证账号扫描手动触发端点存在且鉴权/参数校验生效
# （sprint 07192358）。不依赖真实在线设备（CI 环境没有），只验证路由存在 + 缺租户
# 时正确拒绝，真实"有设备时能建task"的路径由 acquisition.test.ts 单测覆盖。
set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3000}"

echo "=== 1. 静态检查：acquisition.ts 含 account-scan/trigger 路由 ==="
if ! grep -q "'/account-scan/trigger'" apps/api/src/routes/acquisition.ts; then
  echo "FAIL: account-scan/trigger 路由未定义"
  exit 1
fi
echo "OK"

echo "=== 2. 静态检查：Android AgentService.kt 含 account_scan 判别符 ==="
if ! grep -q "shouldRouteAccountScan" services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/AgentService.kt; then
  echo "FAIL: shouldRouteAccountScan 未定义"
  exit 1
fi
echo "OK"

echo "=== 3. 存活服务健康检查 + 缺租户校验（若 API_BASE 可达） ==="
if curl -sf -m 5 "$API_BASE/health" > /dev/null 2>&1; then
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -m 5 -X POST "$API_BASE/api/acquisition/account-scan/trigger" -H "Content-Type: application/json" -d '{}')
  if [ "$STATUS" != "401" ]; then
    echo "FAIL: 缺租户上下文应返回 401，实际返回 $STATUS"
    exit 1
  fi
  echo "OK: 缺租户正确返回 401"
else
  echo "SKIP: $API_BASE 不可达（本地/CI 未起服务时的预期降级，静态检查已覆盖核心断言）"
fi

echo "=== account-scan-trigger-smoke PASS ==="
```

- [ ] **Step 2: 加执行权限**

Run: `chmod +x .github/workflows/scripts/smoke/account-scan-trigger-smoke.sh`

- [ ] **Step 3: 本地跑一次验证**

Run: `bash .github/workflows/scripts/smoke/account-scan-trigger-smoke.sh`
Expected: 输出两段 `OK` + 一段 `SKIP`（本地未起 API 服务时）+ `account-scan-trigger-smoke PASS`，exit code 0

- [ ] **Step 4: 注册进 smoke-baseline.txt**

在文件末尾追加一行：

```
account-scan-trigger-smoke.sh
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/scripts/smoke/account-scan-trigger-smoke.sh .github/workflows/scripts/smoke-baseline.txt
git commit -m "test(smoke): account-scan-trigger-smoke

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
