import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Admin Pages — Route Protection', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
  });

  test('admin/users page loads with mock data (empty list)', async ({ page }) => {
    await page.goto('/admin/users');
    // Page should load without errors — sidebar visible means auth passed
    await expect(page.locator('aside')).toBeVisible();
  });

  test('admin/license page loads', async ({ page }) => {
    await page.goto('/admin/license');
    await expect(page.locator('aside')).toBeVisible();
  });

  test('sidebar shows admin menu items', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: '会员管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'License 管理' })).toBeVisible();
  });
});
