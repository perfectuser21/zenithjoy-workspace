import { test, expect } from '@playwright/test';
import { setupMockApi, MOCK_WORKS } from './fixtures/mock-api';

test.describe('Works List Page', () => {
  test.beforeEach(async ({ page }) => {
    await setupMockApi(page);
    await page.goto('/works');
  });

  test('renders works list with mock data', async ({ page }) => {
    await expect(page.getByText(MOCK_WORKS[0].title)).toBeVisible();
    await expect(page.getByText(MOCK_WORKS[1].title)).toBeVisible();
  });

  test('shows published status badge', async ({ page }) => {
    await expect(page.getByText('published').first()).toBeVisible();
  });

  test('shows draft status badge', async ({ page }) => {
    await expect(page.getByText('draft').first()).toBeVisible();
  });

  test('page title shows 作品管理', async ({ page }) => {
    await expect(page.locator('h2')).toContainText('作品管理');
  });
});
