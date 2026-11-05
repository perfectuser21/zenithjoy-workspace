import { test, expect } from '@playwright/test';

test('旧账号扫描与 Windows 绑定退役，历史账号仍可查看', async ({ page }) => {
  await page.route('**/api/agent/burner/sessions', route => route.fulfill({ json: {
    success: true, data: { sessions: [{ account_label: 'historical-account', role: 'burner', status: 'active', agent_id: null }] },
  } }));
  let legacyWrites = 0;
  await page.route(/\/api\/(acquisition\/account-scan\/trigger|agent\/burner\/qr-bind)/, route => {
    legacyWrites++; return route.abort();
  });
  await page.goto('/area/acquisition/accounts');
  await expect(page.getByText('旧版获客已停用，可继续查看历史账号状态。')).toBeVisible();
  await expect(page.getByText('historical-account')).toBeVisible();
  await expect(page.getByRole('button', { name: /立即扫描|开始绑定/ })).toHaveCount(0);
  expect(legacyWrites).toBe(0);
});
