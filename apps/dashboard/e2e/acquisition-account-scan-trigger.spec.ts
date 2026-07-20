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

  test('60秒冷却期满后按钮自动重新可点，能再次触发', async ({ page }) => {
    // 本用例真实等待 61 秒（config 全局 timeout 30s 不够用），单独放宽超时。
    test.setTimeout(90_000);

    await page.route('/api/agent/burner/sessions', (route) =>
      route.fulfill({ json: { success: true, data: { sessions: [] } } })
    );
    let triggerCount = 0;
    await page.route('/api/acquisition/account-scan/trigger', (route) => {
      triggerCount += 1;
      return route.fulfill({ json: { success: true, data: { task_id: `task-${triggerCount}` } } });
    });

    await page.goto('/area/acquisition/accounts');
    const btn = page.getByRole('button', { name: '立即扫描' });
    await btn.click();
    await expect(btn).toBeDisabled();
    expect(triggerCount).toBe(1);

    // 真实等待冷却期满（61秒，留1秒余量），不用 page.clock（版本兼容性未知，真实等待更可靠）
    await page.waitForTimeout(61_000);

    await expect(btn).toBeEnabled();
    await btn.click();
    expect(triggerCount).toBe(2);
  });
});
