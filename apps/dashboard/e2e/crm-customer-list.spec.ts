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
 * 运行：npx playwright test e2e/crm-customer-list.spec.ts（cwd=apps/dashboard，由 e2e-verify.ps1 dispatch）
 */
import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots');

const ROWS = [
  { name: '张三', contact: '张三', wechat_id: 'wx_001', status: 'A1', last_contact_at: '2026-06-24T08:00:00.000Z', managed: true, source: 'scan', last_message: '你们这个多少钱' },
  { name: '李四', contact: '李四', wechat_id: 'wx_002', status: 'A2', last_contact_at: '2026-06-23T08:00:00.000Z', managed: true, source: 'scan', last_message: '我考虑下' },
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

// 客服机下拉数据源（整合 2026-06-25）：默认选第一台已配机器，第二台未配应被过滤
const MACHINES = [
  { machine_id: 'm-1', hostname: 'PC-A', wechat_id: 'wx_cs_A', self_name: '客服A', configured: true, online: true },
  { machine_id: 'm-2', hostname: 'PC-NEW', configured: false, online: false },
];

async function stubAuth(page: Page) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/wechat/cs/my-role', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'admin', can_config: true }) }),
  );
  // 客服机下拉（整合）：CustomerListPage 顶部下拉数据源
  await page.route('**/api/wechat/cs/machines', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ machines: MACHINES }) }),
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

  // 1. 列表 2 行，含姓名/状态下拉/接管开关；onboarding 条可见
  await expect(page.getByTestId('crm-customer-row')).toHaveCount(2);
  await expect(page.getByTestId('crm-customer-row').first()).toContainText('张三');
  await expect(page.getByTestId('crm-status-select').first()).toBeVisible();
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeVisible();
  await expect(page.getByTestId('crm-onboarding-bar')).toBeVisible();
  await expect(page.getByTestId('crm-onboarding-step')).toHaveCount(5);
  // 默认全接管：开关勾上、标签「接管中」
  await expect(page.getByTestId('crm-manage-toggle').first()).toBeChecked();
  await expect(page.getByTestId('crm-manage-label').first()).toHaveText('接管中');

  // 2. 勾掉接管 = 加黑名单 → 标签变「已排除」、不见「登录已失效」
  await page.route('**/api/crm/customers/manage', (route) => {
    blacklisted = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, managed: false, message: '已加入黑名单' }) });
  });
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByTestId('crm-manage-label').first()).toHaveText('已排除', { timeout: 10000 });
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

// 整合（2026-06-25）：客服机下拉默认选第一台 + 「立即扫好友」按钮调 trigger 端点并回显
test('客服机下拉默认第一台 + 立即扫好友通知客服机', async ({ page }) => {
  await stubAuth(page);

  await page.route('**/api/crm/customers**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ customers: ROWS, total: 2, cs_wechat_id: 'wx_cs_A' }) }),
  );
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

  // 下拉默认选中第一台已配机器（wx_cs_A），未配的 m-2 被过滤（只 1 个选项）
  const select = page.getByTestId('crm-cs-machine-select');
  await expect(select).toBeVisible();
  await expect(select).toHaveValue('wx_cs_A');
  await expect(select.locator('option')).toHaveCount(1);
  await page.screenshot({ path: path.join(SHOTS, '06-cs-machine-select.png'), fullPage: true });

  // 点「立即扫好友」→ 调 trigger 带 {cs_wechat_id}，回显「已通知客服机」
  await page.getByTestId('crm-force-scan-btn').click();
  await expect(page.getByTestId('crm-toast')).toContainText('已通知客服机', { timeout: 10000 });
  expect(triggerBody).toEqual({ cs_wechat_id: 'wx_cs_A' });
  await page.screenshot({ path: path.join(SHOTS, '07-force-scan.png'), fullPage: true });
});
