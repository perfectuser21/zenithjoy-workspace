/**
 * Path 4 Sprint 1 ws2 — Dashboard 绑微信按钮 Playwright e2e
 *
 * 路由：/dashboard/agent-machines
 * 3 case：
 *   visible — 按钮真渲染可见可点
 *   happy   — 点击触发 fetch /api/wechat/qr-bind → 200 + task_id
 *   disabled — 通道下拉企微选项 disabled + title "加厚阶段开放"
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npm run dev:dashboard
 *   npx playwright test e2e/wechat-bind-button.spec.ts
 */
import { test, expect } from '@playwright/test';

const TASK_ID = 'aaaa1111-bbbb-2222-cccc-333344445555';

async function stubAgentApi(page: import('@playwright/test').Page) {
  await page.route('**/api/agent/me/status*', async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        agent_id: 'agent-uuid-1',
        hostname: 'mac-mini-01',
        version: '0.1.0',
        last_heartbeat_at: new Date().toISOString(),
      },
    });
  });
  await page.route('**/api/agent/status*', async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        agent_id: 'agent-uuid-1',
        hostname: 'mac-mini-01',
        version: '0.1.0',
        last_heartbeat_at: new Date().toISOString(),
      },
    });
  });
}

test('visible — 绑定微信按钮真渲染可见可点', async ({ page }) => {
  await stubAgentApi(page);
  await page.goto('/dashboard/agent-machines');
  const btn = page.getByRole('button', { name: /绑定微信/ });
  await expect(btn).toBeVisible();
  await expect(btn).toBeEnabled();
});

test('happy — 点击触发 fetch /api/wechat/qr-bind → 200 + task_id', async ({ page }) => {
  await stubAgentApi(page);
  let captured: { platform?: string; agent_id?: string } | null = null;
  await page.route('**/api/wechat/qr-bind', async (route) => {
    const body = route.request().postDataJSON() as { platform: string; agent_id: string };
    captured = body;
    await route.fulfill({ json: { task_id: TASK_ID, status: 'dispatched' } });
  });

  await page.goto('/dashboard/agent-machines');
  await page.getByRole('button', { name: /绑定微信/ }).click();

  await expect.poll(() => captured !== null, { timeout: 5_000 }).toBe(true);
  expect(captured!.platform).toBe('wechat_personal');
  expect(captured!.agent_id).toBeTruthy();
});

test('disabled — 通道下拉企微选项 disabled + title 加厚阶段开放', async ({ page }) => {
  await stubAgentApi(page);
  await page.goto('/dashboard/agent-machines');

  const select = page.getByRole('combobox', { name: /通道/ });
  await expect(select).toBeVisible();

  // 企业微信 option disabled + title
  const enterprise = page.locator('option', { hasText: /企业微信/ }).first();
  await expect(enterprise).toBeAttached();
  await expect(enterprise).toBeDisabled();
  await expect(enterprise).toHaveAttribute('title', /加厚阶段开放/);
});
