/**
 * Playwright E2E spec — Line02 角色统一 & 账号管理页绑定机器列
 * Sprint: 07032332-line02-account-role-unify
 * target_environment: windows_cloud (windows-latest + 真实后端，禁网络拦截)
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

test.describe('Line02 账号管理 — 绑定机器列', () => {
  test('账号管理页加载，"绑定机器"列头可见', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/accounts`);
    await page.screenshot({ path: 'screenshots/01-initial.png' });

    await expect(page.locator('text=绑定机器')).toBeVisible({ timeout: 10000 });
  });

  test('表格单元格含 machine-hostname-cell，值为 hostname 或"—"', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/accounts`);
    await page.waitForSelector('tbody tr', { timeout: 10000 }).catch(() => null);
    await page.screenshot({ path: 'screenshots/02-accounts-table.png' });

    const rowCount = await page.locator('tbody tr').count();
    if (rowCount > 0) {
      const machineCell = page.locator('[data-testid="machine-hostname-cell"]').first();
      await expect(machineCell).toBeVisible({ timeout: 5000 });

      const cellText = (await machineCell.textContent() ?? '').trim();
      expect(cellText).toMatch(/^—$|^\S+/);

      const offlineBadge = page.locator('[data-testid="machine-status-offline"]');
      const offlineCount = await offlineBadge.count();
      if (offlineCount > 0) {
        await expect(offlineBadge.first()).toBeVisible({ timeout: 5000 });
        await expect(offlineBadge.first()).toHaveText('离线');
      }
    }
  });

  test('旧路由 /dashboard/douyin-burner-bind 已下线，URL 离开旧路径', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/douyin-burner-bind`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/03-old-route-gone.png' });

    const finalUrl = page.url();
    if (finalUrl.includes('douyin-burner-bind')) {
      throw new Error(`FAIL: 路由未下线，URL 仍为 ${finalUrl}`);
    }
  });
});
