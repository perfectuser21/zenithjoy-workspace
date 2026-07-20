import { test, expect } from '@playwright/test';

/**
 * Path2 账号扫描手动触发按钮（sprint 07192358）。stub 后端响应，验证真实浏览器
 * 交互：点击 → 调用真实端点 → 60秒内本地禁用 → 离线态错误提示，不 mock 组件本身。
 */
test.describe('账号管理页 — 立即扫描按钮', () => {
  test('点击后调用触发端点，展示成功提示并禁用按钮', async ({ page }) => {
    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    let triggerCalled = false;
    await page.route('/api/acquisition/account-scan/trigger', (route) => {
      triggerCalled = true;
      return route.fulfill({ json: { success: true, data: { task_id: 'task-1' } } });
    });

    await page.goto('/area/acquisition/accounts');
    const btn = page.getByRole('button', { name: '立即扫描' });
    await expect(btn).toBeVisible();
    await btn.click();

    expect(triggerCalled).toBe(true);
    await expect(page.getByText(/已发送.*最长.*30秒/)).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test('无在线设备时点击 → 展示明确错误提示', async ({ page }) => {
    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    await page.route('/api/acquisition/account-scan/trigger', (route) =>
      route.fulfill({
        status: 400,
        json: { success: false, error: { code: 'NO_ONLINE_ANDROID_AGENT', message: '未检测到在线的安卓设备，请先确认手机 App 在运行' } },
      })
    );

    await page.goto('/area/acquisition/accounts');
    await page.getByRole('button', { name: '立即扫描' }).click();

    await expect(page.getByText('未检测到在线的安卓设备，请先确认手机 App 在运行')).toBeVisible();
  });
});
