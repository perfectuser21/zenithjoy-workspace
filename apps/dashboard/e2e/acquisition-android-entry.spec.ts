import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

test('旧获客不再提供旧手机采集入口，通用安卓下载页仍可访问', async ({ page }) => {
  await page.goto(`${BASE_URL}/area/acquisition`);
  await expect(page.getByText(/旧版获客已停用/)).toBeVisible();
  await expect(page.getByRole('link', { name: /下载安卓客户端/ })).toHaveCount(0);
  await page.goto(`${BASE_URL}/dashboard/android`);
  await expect(page.getByRole('heading', { name: '下载安卓客户端' })).toBeVisible();
});
