/**
 * Browser-only historical account UI contract for the PR job's Vite-only server.
 * Network responses are isolated fixtures; this does not verify a real backend,
 * customer account, device, or the separately retained manual evaluator.
 */
import { test, expect } from '@playwright/test';

const endpoint = '**/api/agent/burner/sessions';

test('renders retained historical account and machine details without legacy creation controls', async ({ page }) => {
  let requests = 0;
  await page.route(endpoint, async route => {
    expect(route.request().method()).toBe('GET');
    requests += 1;
    await route.fulfill({ status: 200, json: { success: true, data: { sessions: [
      { account_label: 'history-phone', role: 'burner', status: 'active', agent_hostname: 'test-phone', agent_status: 'offline', device_type: 'android' },
      { account_label: 'history-no-machine', role: 'burner', status: 'active', agent_hostname: null },
    ] } } });
  });
  await page.goto('/area/acquisition/accounts');
  await expect(page.getByText('旧版获客已停用，可继续查看历史账号状态。')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '绑定机器' })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId('machine-hostname-cell')).toContainText('test-phone');
  await expect(rows.nth(0).getByTestId('machine-status-offline')).toHaveText('离线');
  await expect(rows.nth(1).getByTestId('machine-hostname-cell')).toHaveText('—');
  await expect(page.getByRole('button', { name: /开始绑定|立即扫描/ })).toHaveCount(0);
  expect(requests).toBeGreaterThan(0);
});

test('a failed account history response is visible and is not shown as an empty history', async ({ page }) => {
  await page.route(endpoint, route => route.fulfill({ status: 503, json: { success: false } }));
  await page.goto('/area/acquisition/accounts');
  await expect(page.getByText('账号历史读取失败，请稍后重试')).toBeVisible();
  await expect(page.getByText('暂无历史小号')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '绑定机器' })).toHaveCount(0);
});

test('legacy Windows bind route redirects away', async ({ page }) => {
  await page.goto('/dashboard/douyin-burner-bind');
  await expect(page).not.toHaveURL(/douyin-burner-bind/);
});
