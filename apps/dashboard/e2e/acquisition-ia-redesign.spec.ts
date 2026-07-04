import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

test.describe('Line02 Dashboard IA 重做 — Hub GP 顺序 + 触达记录视图', () => {
  test('Hub 页显示 4 张 GP 顺序卡片，无"即将上线"标签', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition`);
    await page.screenshot({ path: 'sprints/07041249-line02-dashboard-ia-redesign/screenshots/01-hub-page.png', fullPage: true });

    await expect(page.getByText('绑抖音小号').first()).toBeVisible();
    await expect(page.getByText('采集').first()).toBeVisible();
    await expect(page.getByText('看线索').first()).toBeVisible();
    await expect(page.getByText('触达记录').first()).toBeVisible();
    await expect(page.getByText('即将上线')).not.toBeVisible();
  });

  test('账号管理页无"抖音昵称"列头，含"绑定机器"列', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/accounts`);
    await page.screenshot({ path: 'sprints/07041249-line02-dashboard-ia-redesign/screenshots/02-accounts-page.png', fullPage: true });

    const nicknameTh = page.locator('th', { hasText: '抖音昵称' });
    await expect(nicknameTh).not.toBeVisible();
    await expect(page.locator('th', { hasText: '绑定机器' })).toBeVisible();
  });

  test('看线索路由正确 — 进入 Leads 页', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/leads`);
    await page.screenshot({ path: 'sprints/07041249-line02-dashboard-ia-redesign/screenshots/03-leads-page.png', fullPage: true });

    expect(page.url()).toContain('/leads');
    await expect(page.locator('body')).toBeVisible();
  });

  test('触达记录页加载，显示列表或"暂无触达记录"空状态', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/outreach`);
    await page.screenshot({ path: 'sprints/07041249-line02-dashboard-ia-redesign/screenshots/04-outreach-page.png', fullPage: true });

    expect(page.url()).toContain('/outreach');
    const hasItems = await page.locator('table').count() > 0;
    if (!hasItems) {
      await expect(page.getByText('暂无触达记录')).toBeVisible();
    } else {
      await expect(page.locator('table')).toBeVisible();
    }
  });

  test('设置入口存在，可进入 AcquisitionConfigPage，无"指派计划"区块', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/acquisition-config`);
    await page.screenshot({ path: 'sprints/07041249-line02-dashboard-ia-redesign/screenshots/05-config-page.png', fullPage: true });

    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText('指派计划')).not.toBeVisible();
  });
});
