import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('Sidebar Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/');
  });

  test('sidebar renders with navigation links', async ({ page }) => {
    await expect(page.locator('aside')).toBeVisible();
    await expect(page.getByRole('link', { name: '作品管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'AI 视频' })).toBeVisible();
  });

  test('navigates to works page', async ({ page }) => {
    await page.getByRole('link', { name: '作品管理' }).click();
    await expect(page).toHaveURL('/works');
  });

  test('navigates to AI video page', async ({ page }) => {
    await page.getByRole('link', { name: 'AI 视频' }).click();
    await expect(page).toHaveURL('/ai-video');
  });

  test('sidebar collapse button works', async ({ page }) => {
    const collapseBtn = page.locator('button[title="收起侧边栏"]');
    await expect(collapseBtn).toBeVisible();
    await collapseBtn.click();
    await expect(page.locator('aside')).toHaveClass(/w-16/);
  });

  test('active nav item is highlighted', async ({ page }) => {
    await page.goto('/works');
    const worksLink = page.getByRole('link', { name: '作品管理' });
    await expect(worksLink).toHaveClass(/bg-sky-500\/20/);
  });
});
