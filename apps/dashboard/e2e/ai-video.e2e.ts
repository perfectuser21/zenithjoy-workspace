import { test, expect } from '@playwright/test';
import { setupMockApi } from './fixtures/mock-api';

test.describe('AI Video Generation Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
  });

  test('renders AI video generation form', async ({ page }) => {
    await page.goto('/ai-video');
    await expect(page.locator('h2')).toContainText('AI 视频');
  });

  test('AI video history page renders with mock data', async ({ page }) => {
    await page.goto('/ai-video/history');
    // Layout renders (sidebar visible since authenticated via cookie)
    await expect(page.locator('aside')).toBeVisible();
  });

  test('generate button is present on AI video page', async ({ page }) => {
    await page.goto('/ai-video');
    // The generate button text is '开始生成视频'
    await expect(page.getByText('开始生成视频')).toBeVisible();
  });
});
