/** Current Staff Hub UI + real staff API/guard. External evaluator only is a local fixture. */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
async function identity(context: BrowserContext, email: string) {
  await context.addCookies([{ name: 'user', value: encodeURIComponent(JSON.stringify({ id: email, email, name: email })), url: 'http://127.0.0.1:15315' }]);
}
async function upload(page: Page, name = 'skill.zip') {
  await page.getByTestId('skill-eval-upload').setInputFiles({ name, mimeType: 'application/zip', buffer: Buffer.from('PK\x03\x04') });
  await page.getByTestId('skill-eval-platform').selectOption('Codex');
  await page.getByTestId('skill-eval-journey').selectOption('line00');
  await page.getByTestId('skill-eval-submit').click();
}
test('staff: current /skill-eval navigation, upload, poll and HTML report', async ({ page, context }) => {
  await identity(context, 'staff@example.test');
  await page.goto('/');
  await page.getByRole('link', { name: 'Skill 验收' }).click();
  await expect(page).toHaveURL(/\/skill-eval$/);
  await upload(page);
  await expect(page.getByTestId('skill-eval-report-frame')).toBeVisible();
  await expect(page.frameLocator('[data-testid="skill-eval-report-frame"]').getByRole('heading', { name: 'Fixture report' })).toBeVisible();
});
test('nonstaff: separate identity rejected by actual API and UI reports permission error', async ({ page, context }) => {
  await identity(context, 'outsider@example.test');
  await page.goto('/skill-eval');
  await upload(page);
  await expect(page.getByTestId('skill-eval-error')).toContainText('需要员工账号权限');
  await expect(page.getByTestId('skill-eval-report-frame')).toHaveCount(0);
});
test('anonymous: login shown and protected API rejects without headers', async ({ page, request }) => {
  await page.goto('/skill-eval');
  await expect(page.getByTestId('skill-eval-upload')).toHaveCount(0);
  const response = await request.get('http://127.0.0.1:15311/api/staff/skill-eval/status/fixture-eval-job');
  expect(response.status()).toBe(403);
});
test('staff: upstream timeout shows recoverable error and clears busy state', async ({ page, context }) => {
  await identity(context, 'staff@example.test');
  await page.goto('/skill-eval');
  await upload(page, 'timeout.zip');
  await expect(page.getByTestId('skill-eval-error')).toContainText('网关超时 504');
  await expect(page.getByTestId('skill-eval-submit')).toBeEnabled();
});
