# 智能获客 Hub 补"下载安卓客户端"入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在"智能获客"Hub 页（`/area/acquisition`）新增一张"下载安卓客户端"卡片，链接到已存在但目前无法从任何菜单/页面到达的安卓装机绑定页 `/dashboard/android`。

**Architecture:** 纯前端改动。`AcquisitionHubPage.tsx` 用一个 `MODULES` 数组渲染卡片列表，新增一条数组项即可增加一张卡片，无需改动路由或后端。用 Playwright e2e 测试断言卡片可见且可点击跳转。

**Tech Stack:** React + TypeScript + react-router-dom（`Link`）+ lucide-react（图标）+ Tailwind CSS（配色）+ Playwright（e2e）。

## Global Constraints

- 不改动 `/dashboard/android` 路由本身或 `AndroidDownloadPage.tsx`（已存在且可用，只是没入口）。
- 不改动现有 4 张卡片的顺序、文案、样式。
- 新卡片配色沿用仓库里 `apps/dashboard/src/pages/AreaHubPage.tsx` 中 `AREA_HUBS.acquisition` 已有的同款卡片定义（`Icon: Smartphone`, `color: 'text-lime-...'`），保持视觉语言一致。
- E2E 测试文件风格照抄已有的 `apps/dashboard/e2e/acquisition-ia-redesign.spec.ts`（`BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174'`）。
- TDD 顺序：commit-1 先写失败的 e2e spec，commit-2 再写实现让其通过。

---

### Task 1: 新增失败的 E2E 测试

**Files:**
- Create: `apps/dashboard/e2e/acquisition-android-entry.spec.ts`

**Interfaces:**
- Consumes: 无（独立测试文件）
- Produces: 无（本任务只写 test，不改实现）

- [ ] **Step 1: 写失败的 e2e spec**

```typescript
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

test.describe('智能获客 Hub — 下载安卓客户端入口', () => {
  test('Hub 页显示"下载安卓客户端"卡片，点击跳转到 /dashboard/android', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition`);

    const card = page.getByText('下载安卓客户端').first();
    await expect(card).toBeVisible();

    await card.click();
    await expect(page).toHaveURL(/\/dashboard\/android/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-android-entry.spec.ts`
Expected: FAIL —— 报错信息包含 `Timed out` 或 `element(s) not found`（因为"下载安卓客户端"文字此时还不存在于页面上）。

> 若本地没有 dev server 在跑（`localhost:5174`），先起 `npm run dev`（或项目约定的 dev 命令）再跑测试；若 CI 环境跑，交由 CI 的 playwright config 自动起服务。

- [ ] **Step 3: Commit（RED）**

```bash
git add apps/dashboard/e2e/acquisition-android-entry.spec.ts
git commit -m "test(line02): 智能获客Hub补下载安卓客户端入口 e2e（RED）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 加卡片让测试变绿

**Files:**
- Modify: `apps/dashboard/src/pages/AcquisitionHubPage.tsx`

**Interfaces:**
- Consumes: Task 1 产出的 `apps/dashboard/e2e/acquisition-android-entry.spec.ts`（无需改动这个测试文件）
- Produces: `MODULES` 数组新增一项（供页面渲染使用，无对外接口）

- [ ] **Step 1: 改 import，加入 Smartphone 图标**

修改文件顶部的 import 行，从：

```typescript
import { KeyRound, Target, Users, Send, Settings } from 'lucide-react';
```

改为：

```typescript
import { KeyRound, Target, Users, Send, Settings, Smartphone } from 'lucide-react';
```

- [ ] **Step 2: 在 MODULES 数组末尾新增卡片**

在 `MODULES` 数组的最后一项（`触达记录`）之后、数组闭合 `];` 之前，新增：

```typescript
  {
    label: '下载安卓客户端',
    desc: '手机装 Agent，扫码自动绑定，手机端采集。',
    to: '/dashboard/android',
    Icon: Smartphone,
    color: 'text-lime-600',
    bgColor: 'bg-lime-50 dark:bg-lime-900/20',
    borderColor: 'border-lime-200 dark:border-lime-800',
  },
```

改完后 `MODULES` 数组应有 5 项，其余 4 项内容不变。

- [ ] **Step 3: 运行测试确认通过**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-android-entry.spec.ts`
Expected: PASS

- [ ] **Step 4: 跑一次已有的 acquisition-ia-redesign.spec.ts 确认无回归**

Run: `cd apps/dashboard && npx playwright test e2e/acquisition-ia-redesign.spec.ts`
Expected: PASS（原有 4 张卡片的断言不受影响，因为该测试用 `.first()` 精确匹配各自文字，新增第 5 张卡片不会导致误匹配）

- [ ] **Step 5: Commit（GREEN）**

```bash
git add apps/dashboard/src/pages/AcquisitionHubPage.tsx
git commit -m "feat(line02): 智能获客Hub补下载安卓客户端入口卡片

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage：**
- 设计文档要求的"新增卡片（label/desc/to/Icon/配色）" → Task 2 Step 2 覆盖。
- 设计文档要求的"新增 e2e 断言可见 + 点击跳转" → Task 1 Step 1 覆盖（一次 test 里覆盖两条断言，逻辑上不可拆分成两个独立可测的子任务，故未拆分）。
- 设计文档要求的"TDD 顺序：先失败测试，再实现" → Task 1（RED）→ Task 2（GREEN）覆盖。
- 设计文档"不影响现有 4 张卡片" → Task 2 Step 4 显式验证无回归。

**占位符检查：** 无 TBD/TODO，所有代码块为完整可直接使用的代码。

**类型一致性：** `Icon` 字段类型沿用文件里已有的 `Module` interface（`Icon: typeof KeyRound`），`Smartphone` 与 `KeyRound` 同为 `lucide-react` 导出的组件类型，兼容。
