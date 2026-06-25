/**
 * crm-customer-list.spec.ts — Line04 CRM 客户好友表三层下钻 Golden Path（windows_cloud，UI 层）
 *
 * CRM 重做（2026-06-25）：入口移进「私域客服」板块 /wechat/crm（旧 /customers 301）。
 * 黑名单语义（修正3）：开关「接管中」默认开，勾掉=「已排除」(managed=false→后端 blacklist)。
 * onboarding 状态条（修正7，O1-O5）。三层下钻（修正2）：层1 列表 → 层2 状态/画像 → 层3 聊天记录。
 *
 * 模式 B（final-e2e windows_cloud 干净 VM，无真后端）：page.route stub 所有 /api/crm + my-role，
 * **只验 UI 渲染/交互/文案**，**不验** cookie 接缝（真目标验证在 crm-cookie-seam.spec.ts）。
 *
 * **per-operator 重做（2026-06-25 契约）**：运营登录即看自己客户。
 *  - GET /customers 走普通 session fetch，**不带 X-User-Email 超管头**、**不带 cs_wechat_id**（后端按租户 scope）。
 *  - **没有「选客服机」下拉**；单微信直接显示。立即扫好友用后端回的 cs_wechat_id。
 *
 * 运行：npx playwright test e2e/crm-customer-list.spec.ts（cwd=apps/dashboard，由 e2e-verify.ps1 dispatch）
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots');

const ROWS = [
  { name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1', last_contact_at: '2026-06-24T08:00:00.000Z', managed: true, source: 'scan', last_message: '你们这个多少钱', add_friend_time: '2026-06-01T08:00:00.000Z', identity: 'customer' },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A2', last_contact_at: '2026-06-23T08:00:00.000Z', managed: true, source: 'scan', last_message: '我考虑下', add_friend_time: '2026-06-02T08:00:00.000Z', identity: 'customer' },
];

const ONBOARDING = {
  step_o1_online: 'ok',
  step_o2_scanned: 'ok',
  scanned_count: 2,
  step_o3_roster: 'ok',
  blacklist_count: 0,
  step_o4_realpublish: 'pending',
  step_o5_replied: 'pending',
};

const PROFILE = {
  name: '张三',
  contact: '张三',
  wechat_id: 'wx_001',
  status: 'A1',
  managed: true,
  last_contact_at: '2026-06-24T08:00:00.000Z',
  portrait: { need: '想买课', budget: '5000 以内', concern: '怕没效果', summary: '高意向新客' },
  timeline: [{ status: 'A1', at: '2026-06-20T08:00:00.000Z', note: '首次进线' }],
  dailies: [{ day: '2026-06-24', summary: '咨询了价格与效果' }],
  messages: [
    { role: 'in', text: '你们这个多少钱', created_at: '2026-06-24T08:00:00.000Z' },
    { role: 'out', text: '您好，2980 元', created_at: '2026-06-24T08:01:00.000Z' },
  ],
};

async function stubAuth(page: Page) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/wechat/cs/my-role', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'admin', can_config: true }) }),
  );
}

test('客户好友表 Golden Path — 列表/黑名单开关/状态下拉/onboarding 条', async ({ page }) => {
  await stubAuth(page);

  let blacklisted = false;
  let lastStatus = 'A1';

  await page.route('**/api/crm/customers**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        customers: [{ ...ROWS[0], status: lastStatus, managed: !blacklisted }, ROWS[1]],
        total: 2,
        cs_wechat_id: 'wx_cs_A',
      }),
    }),
  );
  await page.route('**/api/crm/onboarding/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding: ONBOARDING }) }),
  );

  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, '01-list.png'), fullPage: true });

  // 1. 列表 2 行（6 列：姓名/微信号/加微信时间/意向/最近联系/身份），onboarding 条可见
  await expect(page.getByTestId('crm-customer-row')).toHaveCount(2);
  await expect(page.getByTestId('crm-customer-row').first()).toContainText('张三');
  await expect(page.getByTestId('crm-status-select').first()).toBeVisible();
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeVisible();
  // 6 列表头齐全
  await expect(page.getByRole('columnheader', { name: '姓名' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '微信号' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '加微信时间' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '意向' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '最近联系' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: '身份' })).toBeVisible();
  // 微信号 + 加微信时间 列渲染出真值
  await expect(page.getByTestId('crm-customer-wechat-id').first()).toHaveText('wx_001');
  await expect(page.getByTestId('crm-customer-add-friend-time').first()).not.toHaveText('—');
  await expect(page.getByTestId('crm-onboarding-bar')).toBeVisible();
  await expect(page.getByTestId('crm-onboarding-step')).toHaveCount(5);
  // 默认全接管：开关勾上、身份标签「客户·接管」
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeChecked();
  await expect(page.getByTestId('crm-identity-label').first()).toHaveText('客户·接管');

  // 2. 勾掉接管 = 加黑名单 → 身份标签变「客户·已排除」、不见「登录已失效」
  await page.route('**/api/crm/customers/manage', (route) => {
    blacklisted = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, managed: false, message: '已加入黑名单' }) });
  });
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByTestId('crm-identity-label').first()).toHaveText('客户·已排除', { timeout: 10000 });
  await expect(page.getByText('登录已失效')).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, '02-blacklist.png'), fullPage: true });

  // 3. 改状态 A3 → 刷新仍 A3
  await page.route('**/api/crm/customers/status', (route) => {
    lastStatus = 'A3';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, status: 'A3' }) });
  });
  await page.getByTestId('crm-status-select').first().selectOption('A3');
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-status-select').first()).toHaveValue('A3');
  await page.screenshot({ path: path.join(SHOTS, '03-status.png'), fullPage: true });
});

test('三层下钻 — 点客户 → 状态/画像页（层2）→ 聊天记录（层3）', async ({ page }) => {
  await stubAuth(page);

  await page.route('**/api/crm/customers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: ROWS, total: 2, cs_wechat_id: 'wx_cs_A' }) }),
  );
  await page.route('**/api/crm/onboarding/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding: ONBOARDING }) }),
  );
  await page.route('**/api/crm/customers/*/profile**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: PROFILE }) }),
  );

  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 点客户名 → 下钻层2
  await page.getByTestId('crm-customer-name').first().click();
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/wechat\/crm\/.+/);

  // 层2：画像（需求/预算/顾虑）+ 状态时间线 + 每日小结
  await expect(page.getByTestId('crm-profile-name')).toContainText('张三');
  await expect(page.getByTestId('crm-portrait-need')).toContainText('想买课');
  await expect(page.getByTestId('crm-portrait-budget')).toContainText('5000');
  await expect(page.getByTestId('crm-portrait-concern')).toContainText('怕没效果');
  await expect(page.getByTestId('crm-timeline-event')).toHaveCount(1);
  await expect(page.getByTestId('crm-daily-item')).toHaveCount(1);
  await page.screenshot({ path: path.join(SHOTS, '04-profile.png'), fullPage: true });

  // 层3：按需展开聊天记录 → 逐句气泡（客户 in / 客服 out）
  await expect(page.getByTestId('crm-chat-panel')).toHaveCount(0);
  await page.getByTestId('crm-chat-toggle').click();
  await expect(page.getByTestId('crm-chat-panel')).toBeVisible();
  await expect(page.getByTestId('crm-chat-bubble')).toHaveCount(2);
  await expect(page.getByTestId('crm-chat-bubble').first()).toContainText('你们这个多少钱');
  await expect(page.getByTestId('crm-chat-bubble').nth(1)).toContainText('2980');
  await page.screenshot({ path: path.join(SHOTS, '05-chat.png'), fullPage: true });
});

test('旧顶层 /customers 重定向到板块内 /wechat/crm', async ({ page }) => {
  await stubAuth(page);
  await page.route('**/api/crm/customers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: ROWS, total: 2, cs_wechat_id: 'wx_cs_A' }) }),
  );
  await page.route('**/api/crm/onboarding/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding: ONBOARDING }) }),
  );

  await page.goto(`${BASE_URL}/customers`);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(/\/wechat\/crm$/);
  await expect(page.getByTestId('crm-customer-row').first()).toBeVisible();
});

// per-operator（2026-06-25 契约）：无「选客服机」下拉 + /customers 不带超管头 + 立即扫好友用后端回的 cs_wechat_id
test('per-operator — 无选客服机下拉，/customers 不带超管头，立即扫好友通知客服机', async ({ page }) => {
  await stubAuth(page);

  // 抓 /api/crm/customers 请求的 header/url，断言无 X-User-Email、无 cs_wechat_id
  let customersHeaders: Record<string, string> = {};
  let customersUrl = '';
  await page.route('**/api/crm/customers**', (route) => {
    const req = route.request();
    customersHeaders = req.headers();
    customersUrl = req.url();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: ROWS, total: 2, cs_wechat_id: 'wx_cs_A' }) });
  });
  await page.route('**/api/crm/onboarding/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding: ONBOARDING }) }),
  );

  let triggerBody: unknown = null;
  await page.route('**/api/crm/friend-scan/trigger', (route) => {
    triggerBody = JSON.parse(route.request().postData() || '{}');
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, requested_at: '2026-06-25T00:00:00Z' }) });
  });

  await page.goto(`${BASE_URL}/wechat/crm`);
  await page.waitForLoadState('networkidle');

  // 1. 没有「选客服机」下拉
  await expect(page.getByTestId('crm-cs-machine-select')).toHaveCount(0);
  // 2. /customers 请求不带超管头（X-User-Email）、不带 cs_wechat_id（后端按租户 scope）
  expect(customersHeaders['x-user-email']).toBeUndefined();
  expect(customersUrl).not.toContain('cs_wechat_id');
  await page.screenshot({ path: path.join(SHOTS, '06-per-operator.png'), fullPage: true });

  // 3. 点「立即扫好友」→ 调 trigger 带后端回的 {cs_wechat_id}，回显「已通知客服机」
  await page.getByTestId('crm-force-scan-btn').click();
  await expect(page.getByTestId('crm-toast')).toContainText('已通知客服机', { timeout: 10000 });
  expect(triggerBody).toEqual({ cs_wechat_id: 'wx_cs_A' });
  await page.screenshot({ path: path.join(SHOTS, '07-force-scan.png'), fullPage: true });
});
