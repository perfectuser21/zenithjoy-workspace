/**
 * crm-customer-list.spec.ts — Line04 中台 CRM 客户列表页 Golden Path（windows_cloud，UI 层）
 *
 * 模式 B（final-e2e windows_cloud 干净 VM，无真后端）：用 page.route stub 所有 /api/crm + my-role，
 * **只验 UI 渲染/交互/文案**（列表行 / 状态下拉 / 接管开关 / 「保存成功」），**不验** cookie 接缝。
 * cookie 接缝（真浏览器向真 :5200 发 better-auth cookie）的真目标验证在 crm-cookie-seam.spec.ts。
 *
 * 运行：npx playwright test e2e/crm-customer-list.spec.ts（cwd=apps/dashboard，由 e2e-verify.ps1 dispatch）
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots');

const ROWS = [
  { name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1', last_contact_at: '2026-06-24T08:00:00.000Z', managed: false },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A2', last_contact_at: '2026-06-23T08:00:00.000Z', managed: true },
];

async function stubAuth(page: Page) {
  // 让 auth 判定不阻塞渲染（requireAuth:false 路由直接渲染，真鉴权在后端）
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/wechat/cs/my-role', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'admin', can_config: true }) }),
  );
}

test('客户列表 Golden Path — 列表/接管开关/状态下拉', async ({ page }) => {
  await stubAuth(page);

  let lastStatus = 'A1';
  // 列表 GET（状态改后 re-GET 反映 lastStatus，验「刷新仍 A3」）
  await page.route('**/api/crm/customers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ customers: [{ ...ROWS[0], status: lastStatus }, ROWS[1]], total: 2, cs_wechat_id: 'wx_cs_A' }),
    }),
  );

  await page.goto(`${BASE_URL}/customers`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, '01-initial.png'), fullPage: true });

  // 1. 列表 ≥1 行，含姓名/状态下拉/接管开关
  await expect(page.getByTestId('crm-customer-row')).toHaveCount(2);
  await expect(page.getByTestId('crm-customer-row').first()).toContainText('张三');
  await expect(page.getByTestId('crm-status-select').first()).toBeVisible();
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeVisible();

  // 2. 勾接管 → 见「保存成功」、不见「登录已失效」（接缝 1 的 UI 文案层）
  await page.route('**/api/crm/customers/manage', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, managed: true, message: '保存成功' }) }),
  );
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByText('保存成功')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('登录已失效')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, '02-action.png'), fullPage: true });

  // 3. 改状态 A3 → 刷新仍 A3
  await page.route('**/api/crm/customers/status', (route) => {
    lastStatus = 'A3';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, status: 'A3' }) });
  });
  await page.getByTestId('crm-status-select').first().selectOption('A3');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-status-select').first()).toHaveValue('A3');
  await page.screenshot({ path: path.join(SHOTS, '03-result.png'), fullPage: true });
});
