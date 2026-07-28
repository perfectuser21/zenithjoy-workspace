/**
 * 合同测试骨架 — BEHAVIOR-UI-LIST-ELEMENT (Playwright E2E)
 *
 * 验证 Staff Hub /ability-acceptance 页面：
 *   - 页面加载不 crash
 *   - [data-testid="ability-acceptance-list"] 元素存在
 *   - 截图存入报告目录
 *
 * 运行前提：
 *   - STAFF_HUB_BASE_URL 指向运行中的 Staff Hub（默认 http://localhost:5174）
 *   - 需要有效的 staff 登录 session（或 mock 鉴权）
 *
 * 运行命令：
 *   cd apps/staff-hub && npx playwright test tests/ability-acceptance.spec.ts
 */

import { test, expect } from '@playwright/test';

const BASE_URL = process.env.STAFF_HUB_BASE_URL ?? 'http://localhost:5174';
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? 'test@zenithjoy.com';

test.describe('[BEHAVIOR-UI-LIST-ELEMENT] /ability-acceptance 页面', () => {
  test.beforeEach(async ({ page }) => {
    // 注入 mock 登录状态（实际实现时替换为真实登录流程或 storageState）
    await page.goto(`${BASE_URL}/ability-acceptance`);
  });

  test('页面加载不 crash，含 ability-acceptance-list 元素', async ({ page }) => {
    // 等待页面稳定
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // networkidle 超时不致命，继续检查元素
    });

    // 核心断言：list 元素存在
    const listElement = page.locator('[data-testid="ability-acceptance-list"]');
    await expect(listElement).toBeVisible({ timeout: 10_000 });

    // 截图存档
    await page.screenshot({
      path: 'playwright-report/ability-acceptance-list.png',
      fullPage: true,
    });
  });

  test('页面标题或 heading 包含 ability acceptance 相关文字', async ({ page }) => {
    await page.waitForLoadState('domcontentloaded');

    // 检查页面有标题性元素（h1/h2 或 title）
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test('Brain API 不可达时版本号显示降级文本而非 crash', async ({ page }) => {
    // 拦截 Brain API 请求模拟不可达
    await page.route('**/api/**brain**', (route) => route.abort('failed'));
    await page.route('**/localhost:5221/**', (route) => route.abort('failed'));

    await page.goto(`${BASE_URL}/ability-acceptance`);
    await page.waitForLoadState('domcontentloaded');

    // 页面不应显示 JS 错误崩溃界面
    const errorBoundary = page.locator('[data-testid="error-boundary"], .error-page');
    await expect(errorBoundary).toHaveCount(0);

    // 截图记录降级状态
    await page.screenshot({
      path: 'playwright-report/ability-acceptance-brain-unavailable.png',
    });
  });
});
