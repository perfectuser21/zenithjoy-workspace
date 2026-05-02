import { test, expect } from '@playwright/test';
import { setupMockApi, MOCK_AI_GENERATIONS } from './fixtures/mock-api';

test.describe('AI Video Generation Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/ai-video');
  });

  test('renders AI video page', async ({ page }) => {
    await expect(page.locator('h2')).toContainText('AI 视频');
  });

  test('shows generation history with mock data', async ({ page }) => {
    await expect(page.getByText(MOCK_AI_GENERATIONS[0].prompt)).toBeVisible();
  });

  test('shows completed status for generated video', async ({ page }) => {
    await expect(page.getByText('completed').first()).toBeVisible();
  });
});
