import { test, expect } from '@playwright/test';

test.describe('Authentication Pages', () => {
  test('login page renders with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('textbox', { name: /邮箱|email/i })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('login page shows submit button', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('signup page renders', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('forgot password page renders with email field', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.locator('input[type="email"], input[name="email"]')).toBeVisible();
  });
});
