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

  test('非 super admin 不显示管理员专区卡片', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    // VITE_SKIP_AUTH 模式下无 feishu_user_id，isSuperAdmin = false
    await expect(page.getByText('管理员专区')).not.toBeVisible();
  });
});
