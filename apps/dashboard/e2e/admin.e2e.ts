import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Admin Pages — Route Protection', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
  });

  test('admin/users shows 403 for non-super-admin', async ({ page }) => {
    await page.goto('/admin/users');
    // Mock user is not a super admin → page renders 403 内容
    await expect(page.getByText('403')).toBeVisible();
  });

  test('admin/license page loads without crash', async ({ page }) => {
    await page.goto('/admin/license');
    // Page must load — just no 500 or blank page; sidebar or 403 content is acceptable
    await expect(page.locator('body')).not.toBeEmpty();
  });

  test('sidebar renders after authentication', async ({ page }) => {
    await page.goto('/');
    // Auth is resolved via cookie fallback → sidebar should appear
    await expect(page.locator('aside')).toBeVisible();
  });
});
