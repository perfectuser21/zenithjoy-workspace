/**
 * WS1 Settings Sidebar E2E — TDD Red Spec
 *
 * 验收：侧边栏3分组 + /settings 统一入口 + SettingsPage 卡片
 *
 * 运行：
 *   1. 另开终端：VITE_SKIP_AUTH=true npm run dev:dashboard
 *   2. npx playwright test e2e/settings-sidebar.spec.ts
 */
import { test, expect } from '@playwright/test';

test.describe('WS1 侧边栏分组 + 统一设置入口', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  test('侧边栏展示"核心功能"/"账号绑定"/"系统"三个分组标题', async ({ page }) => {
    await expect(page.getByText('核心功能')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('账号绑定')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('系统')).toBeVisible({ timeout: 5000 });
  });

  test('点击"设置"菜单项导航到 /settings', async ({ page }) => {
    await page.getByRole('link', { name: '设置' }).click();
    await expect(page).toHaveURL(/\/settings/, { timeout: 5000 });
  });

  test('/settings 页面显示 License 卡片', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('License')).toBeVisible({ timeout: 5000 });
  });

  test('非 super admin 不显示管理员专区卡片（VITE_SKIP_AUTH 模式 isSuperAdmin=false）', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('管理员专区')).not.toBeVisible();
  });
});
