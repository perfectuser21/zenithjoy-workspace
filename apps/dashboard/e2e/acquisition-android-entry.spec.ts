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
