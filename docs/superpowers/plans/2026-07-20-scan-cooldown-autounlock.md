# scan-cooldown-autounlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix a real, user-reproduced bug: the "立即扫描" (scan now) button on the Dashboard's account management page permanently stays disabled after its 60-second cooldown period elapses, because the cooldown check is a pure derived value with nothing forcing a re-render once the cooldown time passes.

**Architecture:** Add a one-shot `setTimeout` when the cooldown starts, that forces a state update (and thus a re-render) exactly when the cooldown should end. Clean up the timer on unmount to avoid a React warning about setting state on an unmounted component.

**Tech Stack:** React (TypeScript), Playwright.

## Global Constraints

- TDD 铁律：每个 task 先写失败测试（commit-1），再写实现让测试变绿（commit-2）
- 不改服务端限流逻辑（60秒/租户的 rate limit 保持不变，这是纯前端 UI 状态同步问题）
- 不改扫描本体/结果上报逻辑
- 测试用真实等待（`page.waitForTimeout`），不用 Playwright 的 `page.clock` 时钟 mock API（该 API 需要 Playwright ≥1.45，本仓库 `@playwright/test` 是 `^1.40.0` 的 caret range，实际锁定版本未经核实，用真实等待更可靠、不引入版本兼容性风险）

---

### Task 1: 加定时器强制冷却期满后重渲染

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`
- Modify: `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts`（追加用例）

**Interfaces:**
- Consumes：无新依赖，`useRef` 从现有的 `react` import 里补充（当前文件顶部只 import 了 `useEffect, useState`）
- Produces：无新导出，纯组件内部行为修复

**当前文件相关代码现状（`apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`）：**

顶部 import（第7行）：
```tsx
import { useEffect, useState } from 'react';
```

State 声明（105-115行区域）：
```tsx
export default function AcquisitionAccountsPage() {
  const [sessions, setSessions] = useState<BurnerSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountLabel, setAccountLabel] = useState('');
  const [labelError, setLabelError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [scanTriggering, setScanTriggering] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  const [scanError, setScanError] = useState('');
  const [scanCooldownUntil, setScanCooldownUntil] = useState(0);
```

`handleTriggerScan`（162-179行）：
```tsx
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

**当前 `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts` 完整内容：**

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

- [ ] **Step 1: 写失败测试 — 追加到 `apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts` 文件末尾**

```typescript
  test('60秒冷却期满后按钮自动重新可点，能再次触发', async ({ page }) => {
    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    let triggerCount = 0;
    await page.route('/api/acquisition/account-scan/trigger', (route) => {
      triggerCount += 1;
      return route.fulfill({ json: { success: true, data: { task_id: `task-${triggerCount}` } } });
    });

    await page.goto('/area/acquisition/accounts');
    const btn = page.getByRole('button', { name: '立即扫描' });
    await btn.click();
    await expect(btn).toBeDisabled();
    expect(triggerCount).toBe(1);

    // 真实等待冷却期满（61秒，留1秒余量），不用 page.clock（版本兼容性未知，真实等待更可靠）
    await page.waitForTimeout(61_000);

    await expect(btn).toBeEnabled();
    await btn.click();
    expect(triggerCount).toBe(2);
  });
```

- [ ] **Step 2: 跑测试确认报红**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-account-scan-trigger.spec.ts -g "60秒冷却期满"`
Expected: FAIL —`await expect(btn).toBeEnabled()` 超时失败（按钮仍然 disabled，因为当前代码没有定时器解除冷却）

- [ ] **Step 3: 实现 — 修改 `AcquisitionAccountsPage.tsx`**

顶部 import 改为：

```tsx
import { useEffect, useRef, useState } from 'react';
```

在组件内 state 声明区（`scanCooldownUntil` 之后）追加一个 ref：

```tsx
  const [scanCooldownUntil, setScanCooldownUntil] = useState(0);
  const scanCooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

在组件内追加一个 cleanup effect（放在现有 `useEffect(() => { load(); }, []);` 之后）：

```tsx
  useEffect(() => {
    return () => {
      if (scanCooldownTimerRef.current) clearTimeout(scanCooldownTimerRef.current);
    };
  }, []);
```

修改 `handleTriggerScan` 的成功分支，在 `setScanCooldownUntil(Date.now() + 60_000);` 之后追加：

```tsx
      } else {
        setScanMessage('已发送扫描请求，最长等待约30秒后刷新本页查看');
        setScanCooldownUntil(Date.now() + 60_000);
        if (scanCooldownTimerRef.current) clearTimeout(scanCooldownTimerRef.current);
        scanCooldownTimerRef.current = setTimeout(() => setScanCooldownUntil(0), 60_000);
      }
```

- [ ] **Step 4: 跑测试确认变绿**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-account-scan-trigger.spec.ts -g "60秒冷却期满"`
Expected: PASS（耗时约61秒，属预期）

- [ ] **Step 5: 跑全文件回归**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-account-scan-trigger.spec.ts`
Expected: 3 个用例（原有2个 + 新增1个）全部 PASS

- [ ] **Step 6: 类型检查**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: 无报错

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/e2e/acquisition-account-scan-trigger.spec.ts
git commit -m "test(dashboard): add failing E2E for scan-cooldown auto-unlock

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
git add apps/dashboard/src/pages/AcquisitionAccountsPage.tsx
git commit -m "fix(dashboard): 立即扫描按钮60秒冷却后自动解锁，不再永久卡死

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
