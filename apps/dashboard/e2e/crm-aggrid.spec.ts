/**
 * crm-aggrid.spec.ts — Line04 CRM AG Grid 运营台 UI E2E（windows_cloud，VITE_SKIP_AUTH）
 *
 * AG Grid 是 DOM 渲染：可直接 read 单元格文字（不再需要绕过 canvas）。测策略：
 *  1. 客户名直接出现在 .ag-cell DOM（AG Grid 不用 canvas）
 *  2. 搜索框 quickFilterText → 「N 位客户」计数（DOM data-testid）变化
 *  3. 意向 chip 过滤 → 计数变化
 *  4. 点姓名单元格 → navigate /wechat/crm/:contact（画像页 DOM）
 *  5. 双击意向单元格 → ag-select 行内编辑 → PUT /status
 *
 * 运行：npx playwright test e2e/crm-aggrid.spec.ts
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

test('AG Grid 运营台 — 客户名出现在 DOM（非 canvas）', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // AG Grid DOM 渲染：可直接断言客户名文字（Glide canvas 做不到）
  await expect(page.locator('.ag-cell[col-id="name"]').first()).toContainText('张三', { timeout: 10000 });
  await expect(page.locator('.ag-cell[col-id="name"]').nth(1)).toContainText('李四');
  await expect(page.locator('.ag-cell[col-id="name"]').nth(2)).toContainText('王五');

  // 回归守卫：cellRenderer 必须返回 JSX 不是 HTML 字符串。
  // AgGridReact 会把字符串当文本转义 → 单元格显示成 `<span style=...>` 原始标签（"乱码"）。
  // 断言意向/姓名单元格里看不到原始 HTML 标签文字。
  const intentText = await page.locator('.ag-cell[col-id="status"]').first().innerText();
  expect(intentText).not.toContain('<span');
  expect(intentText).not.toContain('style=');
  expect(intentText).toMatch(/●/); // 正常渲染应有色点 + 标签
  const nameText = await page.locator('.ag-cell[col-id="name"]').first().innerText();
  expect(nameText).not.toContain('<span');
});

test('AG Grid 运营台 — 搜索框 quickFilterText 过滤「N 位客户」计数变化', async ({ page }) => {
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

test('AG Grid 运营台 — A4 意向 chip 过滤', async ({ page }) => {
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

test('AG Grid 运营台 — 双击意向单元格行内编辑，写回 PUT /status', async ({ page }) => {
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

  // 等 AG Grid 行渲染
  await expect(page.locator('.ag-cell[col-id="name"]').first()).toContainText('张三', { timeout: 10000 });

  // 双击意向单元格（第一行，张三，当前 A1）
  await page.locator('.ag-cell[col-id="status"]').first().dblclick();

  // AG Grid select 编辑器出现
  const selectEditor = page.locator('.ag-select-cell-editor select, .ag-cell-editor select, select.ag-select__native-select');
  await expect(selectEditor).toBeVisible({ timeout: 5000 });
  await selectEditor.selectOption('A3');

  // 按 Tab 确认（触发 onCellValueChanged）
  await page.keyboard.press('Tab');

  // PUT /status 被调用，toast 回显
  await waitFor(() => expect(statusBody).toMatchObject({ contact: '张三', status: 'A3' }), page);
  await expect(page.getByTestId('crm-toast')).toContainText('保存成功', { timeout: 8000 });
});

test('AG Grid 运营台 — 点姓名单元格导航到画像页', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 等 AG Grid 行渲染
  await expect(page.locator('.ag-cell[col-id="name"]').first()).toContainText('张三', { timeout: 10000 });

  // 点姓名单元格（onCellClicked → openProfile → navigate）
  await page.locator('.ag-cell[col-id="name"]').first().click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/wechat\/crm\/.+/);
  await expect(page.getByTestId('crm-profile-name')).toContainText('张三');
});

test('画像页暗色皮肤 — AI 画像卡片字段 DOM 断言', async ({ page }) => {
  await stubCrmApis(page);
  // 直接导航到画像页（不走列表）
  await page.goto(`${BASE_URL}/wechat/crm/%E5%BC%A0%E4%B8%89`);
  await page.waitForLoadState('networkidle');

  // 画像页各卡片 DOM 可访问
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

test('AG Grid 运营台 — 「列 ▾」菜单隐藏/显示列（拖列不再误删列）', async ({ page }) => {
  await stubCrmApis(page);
  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.ag-cell[col-id="name"]').first()).toContainText('张三', { timeout: 10000 });

  // 身份列默认可见
  await expect(page.locator('.ag-header-cell[col-id="identity"]')).toBeVisible();

  // 打开「列 ▾」菜单 → 取消勾选「身份」→ 身份列消失（隐藏列的正确入口，不靠拖出网格）
  await page.getByTestId('crm-col-menu-btn').click();
  await expect(page.getByTestId('crm-col-menu')).toBeVisible();
  await page.getByTestId('crm-col-menu').getByText('身份', { exact: true }).click();
  await expect(page.locator('.ag-header-cell[col-id="identity"]')).toHaveCount(0);
});

// 辅助函数：在 Playwright 里 "waitFor" 式断言
async function waitFor(fn: () => void, page: Page, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { fn(); return; } catch { /* retry */ }
    await page.waitForTimeout(200);
  }
  fn(); // 最后一次，让错误抛出
}
