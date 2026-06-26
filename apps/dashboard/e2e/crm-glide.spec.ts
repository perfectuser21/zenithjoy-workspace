/**
 * crm-glide.spec.ts — Line04 CRM Glide 运营台 UI E2E（windows_cloud，VITE_SKIP_AUTH）
 *
 * Glide 是 canvas：不能直接 read 单元格文字。测策略：
 *  1. 搜索框 → 「N 位客户」计数（DOM data-testid）变化
 *  2. 意向 chip 过滤 → 计数变化
 *  3. 编辑面板（DOM，自动选中首行）→ 状态/身份下拉可见，可改值
 *  4. 点客户名导航到画像页 → 画像页卡片字段是真 DOM
 *
 * 运行：npx playwright test e2e/crm-glide.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:5174';

const ROWS = [
  {
    name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1',
    last_contact_at: '2026-06-24T08:00:00.000Z', managed: true, source: 'scan',
    last_message: '你们这个多少钱', add_friend_time: '2026-06-01T08:00:00.000Z', identity: 'customer',
  },
  {
    name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A4',
    last_contact_at: '2026-06-23T08:00:00.000Z', managed: true, source: 'scan',
    last_message: '我成交了', add_friend_time: '2026-06-02T08:00:00.000Z', identity: 'customer',
  },
  {
    name: '王五', contact: '王五', wechat_id: 'wx_003', status: 'A3',
    last_contact_at: '2026-06-20T08:00:00.000Z', managed: true, source: 'scan',
    last_message: '考虑中', add_friend_time: '2026-06-03T08:00:00.000Z', identity: 'customer',
  },
];

const PROFILE = {
  name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1',
  managed: true, last_contact_at: '2026-06-24T08:00:00.000Z',
  portrait: { need: '想买课程', budget: '5000 以内', concern: '怕没效果', summary: '高意向新客' },
  timeline: [{ status: 'A1', at: '2026-06-20T08:00:00.000Z', note: '首次进线' }],
  dailies: [{ day: '2026-06-24', summary: '咨询了价格与效果' }],
  messages: [
    { role: 'in', text: '你们这个多少钱', created_at: '2026-06-24T08:00:00.000Z' },
    { role: 'out', text: '您好，2980 元', created_at: '2026-06-24T08:01:00.000Z' },
  ],
};

async function stubCrmApis(page: Page) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/wechat/cs/my-role', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ role: 'admin', can_config: true }),
    }),
  );
  await page.route('**/api/crm/customers**', (route) => {
    const url = route.request().url();
    const method = route.request().method();
    if (method === 'GET' && !url.includes('/profile') && !url.includes('/status') &&
        !url.includes('/identity') && !url.includes('/friend-scan')) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ customers: ROWS, total: 3, cs_wechat_id: 'wx_cs_A' }),
      });
    }
    return route.continue();
  });
  await page.route('**/api/crm/onboarding/**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        onboarding: {
          step_o1_online: 'ok', step_o2_scanned: 'ok', scanned_count: 3,
          step_o3_roster: 'ok', blacklist_count: 0,
          step_o4_realpublish: 'pending', step_o5_replied: 'pending',
        },
      }),
    }),
  );
  await page.route('**/api/crm/customers/*/profile**', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ profile: PROFILE }),
    }),
  );
}

test('Glide 运营台 — 搜索框过滤「N 位客户」计数变化', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 初始计数 = 3
  await expect(page.getByTestId('crm-customer-count')).toContainText('3', { timeout: 8000 });

  // 搜索"李四" → 计数变 1
  await page.getByTestId('crm-search').fill('李四');
  await expect(page.getByTestId('crm-customer-count')).toContainText('1', { timeout: 5000 });

  // 清空搜索 → 计数恢复 3
  await page.getByTestId('crm-search').fill('');
  await expect(page.getByTestId('crm-customer-count')).toContainText('3', { timeout: 5000 });
});

test('Glide 运营台 — A4 意向 chip 过滤', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 初始 3 位客户
  await expect(page.getByTestId('crm-customer-count')).toContainText('3', { timeout: 8000 });

  // 点 A4 chip → 只剩 1 位（李四 A4 成交）
  await page.getByTestId('crm-chip-A4').click();
  await expect(page.getByTestId('crm-customer-count')).toContainText('1', { timeout: 5000 });

  // 再点取消 → 恢复 3
  await page.getByTestId('crm-chip-A4').click();
  await expect(page.getByTestId('crm-customer-count')).toContainText('3', { timeout: 5000 });
});

test('Glide 运营台 — 编辑面板自动选中首行，可改状态', async ({ page }) => {
  await stubCrmApis(page);

  let statusBody: unknown = null;
  await page.route('**/api/crm/customers/status', (route) => {
    statusBody = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 编辑面板自动选中首行（张三），状态/身份 select 可见
  await expect(page.getByTestId('crm-status-select')).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('crm-identity-select')).toBeVisible();

  // 修改状态 A3 → 调 PUT /status → toast 显示保存成功
  await page.getByTestId('crm-status-select').selectOption('A3');
  await expect(page.getByTestId('crm-toast')).toContainText('保存成功', { timeout: 8000 });
  expect(statusBody).toMatchObject({ contact: '张三', status: 'A3' });
});

test('Glide 运营台 — 点编辑面板客户名导航到画像页', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 编辑面板自动显示第一行（张三），点名字跳转画像
  await expect(page.getByTestId('crm-customer-name')).toBeVisible({ timeout: 8000 });
  await page.getByTestId('crm-customer-name').click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/wechat\/crm\/.+/);
  await expect(page.getByTestId('crm-profile-name')).toContainText('张三');
});

test('画像页暗色皮肤 — AI 画像卡片字段 DOM 断言', async ({ page }) => {
  await stubCrmApis(page);
  // 直接导航到画像页（不走列表）
  await page.goto(`${BASE_URL}/wechat/crm/%E5%BC%A0%E4%B8%89`);
  await page.waitForLoadState('networkidle');

  // 画像页各卡片 DOM 可访问（不依赖 canvas）
  await expect(page.getByTestId('crm-profile-name')).toContainText('张三');
  await expect(page.getByTestId('crm-profile-basic')).toBeVisible();
  await expect(page.getByTestId('crm-profile-portrait')).toBeVisible();
  await expect(page.getByTestId('crm-portrait-need')).toContainText('想买课程');
  await expect(page.getByTestId('crm-portrait-budget')).toContainText('5000');
  await expect(page.getByTestId('crm-portrait-concern')).toContainText('怕没效果');
  await expect(page.getByTestId('crm-profile-timeline')).toBeVisible();
  await expect(page.getByTestId('crm-profile-dailies')).toBeVisible();

  // 聊天记录展开
  await page.getByTestId('crm-chat-toggle').click();
  await expect(page.getByTestId('crm-chat-bubble')).toHaveCount(2);
  await expect(page.getByTestId('crm-chat-bubble').first()).toContainText('你们这个多少钱');
});
