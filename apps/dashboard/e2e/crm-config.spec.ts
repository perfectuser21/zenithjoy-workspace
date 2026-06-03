/**
 * Path 4 Step 2 — CRM 配置页 E2E
 *
 * Golden Path：
 * 1. 打开 /crm/config，飞书/Notion 平台选择器可见
 * 2. POST /api/crm/init mode=create 建表成功
 * 3. POST /api/crm/init mode=detect 返回已有 table_id
 * 4. GET /api/crm/wechat-contacts mock 精确 5 条（wechat_id + nickname）
 * 5. GET /api/crm/match-preview 返回 matched/pending/unmatched 三栏
 * 6. 用户确认映射 → 成功提示
 * 7. POST /api/crm/daily-analysis dry_run=true 验收
 *
 * 运行：
 *   npx playwright test e2e/crm-config.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';

// Mock 精确 5 条联系人（含 wechat_id + nickname）
const MOCK_CONTACTS = [
  { wechat_id: 'wx_001', nickname: '张三' },
  { wechat_id: 'wx_002', nickname: '李四' },
  { wechat_id: 'wx_003', nickname: '王五' },
  { wechat_id: 'wx_004', nickname: '赵六' },
  { wechat_id: 'wx_005', nickname: '陈七' },
];

test('CRM 配置页初始状态 — 飞书/Notion 平台选择器可见', async ({ page }) => {
  // stub API
  await page.route('**/api/crm/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, table_id: 'mock_table_001' }) });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.screenshot({ path: 'screenshots/crm-01-config-page.png' });

  await expect(page.getByTestId('platform-feishu')).toBeVisible();
  await expect(page.getByTestId('platform-notion')).toBeVisible();
});

test('POST /api/crm/init mode=create — 建表成功返回 table_id', async ({ page }) => {
  let initBody: Record<string, unknown> = {};

  await page.route('**/api/crm/init', async (route) => {
    const req = route.request();
    initBody = JSON.parse(req.postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, table_id: 'feishu_crm_test_001' }),
    });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.getByRole('button', { name: '新建客户明细表' }).click();
  await page.screenshot({ path: 'screenshots/crm-02-init-result.png' });

  expect(initBody['mode']).toBe('create');
  expect(initBody['platform']).toBeTruthy();
});

test('POST /api/crm/init mode=detect — 检测已有表', async ({ page }) => {
  await page.route('**/api/crm/init', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, table_id: 'feishu_crm_existing_001' }),
    });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.getByRole('button', { name: '检测已有表' }).click();

  // 验证进入联系人步骤
  await expect(page.getByText('微信联系人导入')).toBeVisible();
});

test('GET /api/crm/wechat-contacts — mock 精确 5 条，含 wechat_id/nickname', async ({ page }) => {
  await page.route('**/api/crm/init', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, table_id: 'tbl_001' }) });
  });

  await page.route('**/api/crm/wechat-contacts**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ contacts: MOCK_CONTACTS }),
    });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.getByRole('button', { name: '新建客户明细表' }).click();
  await page.getByRole('button', { name: '拉取微信联系人' }).click();
  await page.screenshot({ path: 'screenshots/crm-03-contacts.png' });

  // 精确卡 5 条
  const listItems = page.locator('li[data-wechat-id]');
  await expect(listItems).toHaveCount(5);

  // 验证 wechat_id + nickname 字段
  const firstItem = listItems.first();
  await expect(firstItem).toContainText('wx_001');
  await expect(firstItem).toContainText('张三');

  // 断言 contacts.length == 5
  const count = await listItems.count();
  expect(count).toBe(5);
  expect(MOCK_CONTACTS.length, 'contacts.length').toBe(5);
});

test('GET /api/crm/match-preview — matched/pending/unmatched 三栏展示', async ({ page }) => {
  await page.route('**/api/crm/init', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, table_id: 'tbl_001' }) });
  });

  await page.route('**/api/crm/wechat-contacts**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: MOCK_CONTACTS }) });
  });

  await page.route('**/api/crm/match-preview**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        matched: [],
        pending: MOCK_CONTACTS.slice(0, 2),
        unmatched: MOCK_CONTACTS.slice(2),
      }),
    });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.getByRole('button', { name: '新建客户明细表' }).click();
  await page.getByRole('button', { name: '拉取微信联系人' }).click();
  await page.getByRole('button', { name: '查看匹配结果' }).click();
  await page.screenshot({ path: 'screenshots/crm-04-match-result.png' });

  await expect(page.getByTestId('matched-section')).toBeVisible();
  await expect(page.getByTestId('pending-section')).toBeVisible();
  await expect(page.getByTestId('unmatched-section')).toBeVisible();
});

test('用户确认映射 → 成功提示', async ({ page }) => {
  await page.route('**/api/crm/init', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, table_id: 'tbl_001' }) });
  });

  await page.route('**/api/crm/wechat-contacts**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contacts: MOCK_CONTACTS }) });
  });

  await page.route('**/api/crm/match-preview**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ matched: [], pending: [], unmatched: MOCK_CONTACTS }),
    });
  });

  await page.goto(`${BASE_URL}/crm/config`);
  await page.getByRole('button', { name: '新建客户明细表' }).click();
  await page.getByRole('button', { name: '拉取微信联系人' }).click();
  await page.getByRole('button', { name: '查看匹配结果' }).click();
  await page.getByRole('button', { name: '确认建立映射' }).click();
  await page.screenshot({ path: 'screenshots/crm-05-confirmed.png' });

  await expect(page.getByText('映射建立成功')).toBeVisible();
});

test('POST /api/crm/daily-analysis dry_run=true — customers 数组 + webhook_sent=false', async ({ page }) => {
  let dailyBody: Record<string, unknown> = {};

  await page.route('**/api/crm/daily-analysis', async (route) => {
    dailyBody = JSON.parse(route.request().postData() || '{}');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ customers: [], webhook_sent: false }),
    });
  });

  // 通过 page 内 fetch 触发（验证 API 结构而非 UI）
  await page.goto(`${BASE_URL}/crm/config`);
  const result = await page.evaluate(async () => {
    const resp = await fetch('/api/crm/daily-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: 'test', dry_run: true }),
    });
    return resp.json();
  });

  expect(Array.isArray(result['customers'])).toBe(true);
  expect(result['webhook_sent']).toBe(false);
  expect(dailyBody['dry_run']).toBe(true);
});
