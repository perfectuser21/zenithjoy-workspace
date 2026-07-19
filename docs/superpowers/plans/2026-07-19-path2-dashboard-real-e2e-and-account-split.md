# Path2 dashboard 真实 Playwright E2E + 账号绑定页 Android/Windows 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补一个真正驱动浏览器点击"开始采集"按钮的 Playwright E2E spec（此前 golden-path-2-smoke.sh 全是 curl，从未有过），并把账号绑定页里混在一起的 Android/Windows 绑定流程拆开。

**Architecture:** 见 `docs/superpowers/specs/2026-07-19-path2-dashboard-real-e2e-and-account-split-design.md`。

**Tech Stack:** React + TypeScript（dashboard），Playwright（e2e）。

---

### Task 1: 新增 acquisition-tasks-collect-start.spec.ts

**Files:**
- Create: `apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts`

**背景**：`AcquisitionTasksPage.tsx` 的 `TaskListView` 组件（`/area/acquisition/tasks`）在 `useEffect` 里调用 `fetchMachines()`（`GET /api/agent/machines`）和 `fetchBurnerSessions()`（`GET /api/agent/burner/sessions`）；"开始采集"按钮在 `onlineMachines.length === 0` 时禁用（`noOnlineMachine` 变量），所以 stub 必须让 machines 接口返回至少一台 `status:'online'` 的机器，否则按钮点不动。

- [ ] **Step 1: 写测试文件**

```typescript
/**
 * Acquisition Tasks 「开始采集」按钮 E2E — /area/acquisition/tasks
 *
 * 回归背景（2026-07-19）：golden-path-2-smoke.sh 号称覆盖"客户在 dashboard 发起采集"
 * 这一步，但实现全是裸 curl 调 /api/acquisition/collect/start，从未有一个测试真正在
 * 浏览器里填关键词、点"开始采集"按钮。真机验证音频判定 fix 时，用户追问"你验证的时候
 * 客户在页面里操作了吗"才发现这个缺口——这是本项目第一个真正驱动浏览器点击这个按钮的测试。
 *
 * 覆盖场景（契约端点全 page.route stub，不依赖真后端，与 acquisition-config.spec.ts 同构）：
 *   test a: 填关键词 + 点"开始采集" → 真调 POST /api/acquisition/collect/start，
 *           body.keywords 正确 → 成功后重新拉取任务列表
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npx vite --port 5173
 *   npx playwright test e2e/acquisition-tasks-collect-start.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const ONLINE_MACHINE = {
  id: 'm1',
  agent_id: 'agent-1',
  hostname: 'test-machine',
  nickname: null,
  machine_role: 'main',
  status: 'online',
  version: '1.0.0',
  last_seen: new Date().toISOString(),
  session_count: 0,
  os_type: 'android',
};

async function stubBaseline(page: Page) {
  await page.route('**/api/agent/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [ONLINE_MACHINE] }),
    });
  });

  await page.route('**/api/agent/burner/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { sessions: [] } }),
    });
  });

  await page.route('**/api/acquisition/collect-tasks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { tasks: [], total: 0 } }),
    });
  });
}

// test a: 填关键词 + 点"开始采集" → 真调 POST /api/acquisition/collect/start
test('填关键词点开始采集，真实调用collect/start且body.keywords正确', async ({ page }) => {
  await stubBaseline(page);

  let postBody: Record<string, unknown> | null = null;
  await page.route('**/api/acquisition/collect/start', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    postBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { task_id: 'test-task-001', status: 'pending' } }),
    });
  });

  await page.goto('/area/acquisition/tasks');

  // 无在线机器警告不应出现（已 stub 一台 online 机器）
  await expect(page.getByText('无在线机器，无法创建采集任务')).not.toBeVisible();

  const keywordInput = page.getByPlaceholder(/关键词/);
  await keywordInput.fill('装修');

  const startBtn = page.getByRole('button', { name: '开始采集' });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect.poll(() => postBody).not.toBeNull();
  expect((postBody as unknown as { keywords: string[] }).keywords).toEqual(['装修']);

  // 提交成功后关键词输入框被清空（组件 handleStart 里 setKeyword('')）
  await expect(keywordInput).toHaveValue('');
});
```

- [ ] **Step 2: 本地跑一次确认通过**

Run:
```bash
cd apps/dashboard
VITE_SKIP_AUTH=true npx vite --port 5173 &
sleep 3
npx playwright test e2e/acquisition-tasks-collect-start.spec.ts
```
Expected: 1 passed

- [ ] **Step 3: commit**

```bash
git add apps/dashboard/e2e/acquisition-tasks-collect-start.spec.ts
git commit -m "test(dashboard): 新增真实Playwright点击开始采集按钮的E2E（此前golden-path-2-smoke全是curl从未真点过）"
```

---

### Task 2: AcquisitionAccountsPage.tsx 拆分 Android/Windows 绑定流程

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionAccountsPage.tsx`

**背景**："绑定新小号"区块目前只有一个 Windows/PC 专属的"开始绑定（弹独立Chrome扫码）"流程，Android 小号绑定实际是人在手机上切换账号、中台被动检测（`DeviceAccountScanService`），页面完全没说明区别。

- [ ] **Step 1: 拆分区块（纯 JSX 改动，不改任何 state/逻辑）**

把文件末尾这一段（当前的"绑定新小号"section，从 `<section className="rounded-xl border ...">` 开始，含 `<KeyRound>` 标题、`atCap` 判断、input+按钮）：

```tsx
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-orange-600" />
          绑定新小号
        </h3>
        {atCap ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            已达 {MAX_BURNER_ACCOUNTS} 个小号上限，联系升级套餐以绑定更多。
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="account_label（小号名，例：装修小号1）"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={accountLabel}
              onChange={(e) => onLabelChange(e.target.value)}
            />
            {labelError ? <div className="text-xs text-red-600">{labelError}</div> : null}
            <button
              type="button"
              disabled={!accountLabel || accountLabel === 'default' || submitting}
              onClick={handleStartBind}
              className="rounded bg-orange-600 px-4 py-2 text-white text-sm disabled:bg-gray-300 dark:disabled:bg-slate-700"
            >
              开始绑定（弹独立 Chrome 扫码）
            </button>
          </div>
        )}
      </section>
```

改为（Windows/PC 子区块保留原逻辑，Android 子区块纯说明文字新增，两者并列在同一个外层 section 下，用 `<hr>` 分隔）：

```tsx
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900 dark:text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-orange-600" />
          绑定新小号
        </h3>

        <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">💻 Windows / PC 绑定</div>
        {atCap ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">
            已达 {MAX_BURNER_ACCOUNTS} 个小号上限，联系升级套餐以绑定更多。
          </div>
        ) : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="account_label（小号名，例：装修小号1）"
              className="w-full rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm"
              value={accountLabel}
              onChange={(e) => onLabelChange(e.target.value)}
            />
            {labelError ? <div className="text-xs text-red-600">{labelError}</div> : null}
            <button
              type="button"
              disabled={!accountLabel || accountLabel === 'default' || submitting}
              onClick={handleStartBind}
              className="rounded bg-orange-600 px-4 py-2 text-white text-sm disabled:bg-gray-300 dark:disabled:bg-slate-700"
            >
              开始绑定（弹独立 Chrome 扫码）
            </button>
          </div>
        )}

        <hr className="my-4 border-slate-200 dark:border-slate-700" />

        <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">📱 Android 绑定</div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          在手机 ZenithJoy Agent App 里，切换到你要绑定的抖音小号——中台会自动检测到并出现在上方账号列表里，无需在此操作。
        </p>
      </section>
```

（这是纯展示层拆分：`atCap`/`accountLabel`/`labelError`/`submitting`/`onLabelChange`/`handleStartBind` 等所有 state 和函数完全不动，只是把原来的单一 section 内容拆成两个带小标题的子区块。）

- [ ] **Step 2: 编译验证**

Run: `cd apps/dashboard && npx tsc --noEmit`
Expected: 无新增类型错误

- [ ] **Step 3: 跑现有 Playwright spec 确认无回归**

Run:
```bash
cd apps/dashboard
VITE_SKIP_AUTH=true npx vite --port 5173 &
sleep 3
npx playwright test e2e/acquisition-ia-redesign.spec.ts e2e/acquisition-config.spec.ts e2e/acquisition-tasks-collect-start.spec.ts
```
Expected: 全部 passed（`acquisition-ia-redesign.spec.ts` 里"账号管理页无'抖音昵称'列头，含'绑定机器'列"这条断言的是表格列头，不受本次绑定区块拆分影响）

- [ ] **Step 4: commit**

```bash
git add apps/dashboard/src/pages/AcquisitionAccountsPage.tsx
git commit -m "fix(dashboard): 账号绑定页拆分Android/Windows流程，此前混在一起看不出区别"
```

---

## 收尾

- [ ] 全量跑一次 dashboard 的 Playwright e2e 套件（如果 CI 有对应 job，本地可选跑关键几个文件）确认无回归
- [ ] 用 `superpowers:finishing-a-development-branch` 收尾（Tier-1 自主默认 Option 2：push + PR）
