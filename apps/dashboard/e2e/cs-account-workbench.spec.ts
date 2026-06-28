/**
 * cs-account-workbench.spec.ts — 微信客服「以号为中心」IA 重设计刀2 E2E
 *
 * 目标环境 windows_cloud（GHA windows-latest，VITE_SKIP_AUTH=true 起 dev/preview）。
 * 验证新 IA：
 *   1. 多号 → /area/wechat 落「客服号总览」表，每号一行；点行下钻进单号工作台。
 *   2. 单号工作台：顶部状态条 + 5 Tab（人设话术/知识库/运营设置/客户/成效），切 Tab 内容随之切换。
 *   3. 运营名下正好 1 个号 → /area/wechat 直接重定向进该号工作台（跳过总览）。
 *   4. 可见性兜底：URL 直敲不在 scoped 列表里的号 → 「无权访问该客服号」。
 *
 * 所有后端接口 page.route stub，不依赖外部服务。e2e 用户非 super-admin（走运营路径）。
 * 运行（CI windows runner）：npx playwright test e2e/cs-account-workbench.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://localhost:5173';

const WID_A = 'cs-mid-a';
const WID_B = 'cs-mid-b';

const MACHINE_A = {
  machine_id: 'mid-aaa',
  hostname: 'xian-pc',
  configured: true,
  wechat_id: WID_A,
  real_wechat_id: 'perfect-01',
  self_name: '小苏',
  online: true,
  found_window: true,
  auto_agent_enabled: true,
};
const MACHINE_B = {
  machine_id: 'mid-bbb',
  hostname: 'xian-rog',
  configured: true,
  wechat_id: WID_B,
  real_wechat_id: 'perfect-02',
  self_name: '小张',
  online: false,
  found_window: false,
  auto_agent_enabled: false,
};

const MOCK_PERSONA = {
  self_name: '小苏',
  address_style: '亲',
  tone: '热情',
  sentence_style: '短句',
  use_emoji: '偶尔',
  banned_phrases: [],
  few_shot: [],
};
const MOCK_KB = {
  company: { name: 'ZenithJoy', what_we_do: '内容运营', value_prop: '自动获客', contact: 'wx' },
  products: [],
  audience_segments: [],
  qa_docs: [],
};

// 公共 stub：machines（按入参决定几号）+ stats + 每号配置 + crm + 心跳。
async function stub(page: Page, machines: object[]) {
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/wechat/cs/machines', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ machines }) }),
  );
  await page.route('**/api/wechat/cs/stats**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        date: 'today',
        stats: [
          { cs_wechat_id: WID_A, received_count: 10, reply_count: 8, served_customers: 3, work_duration_minutes: 42, self_name: '小苏', online: true, auto_agent_enabled: true },
          { cs_wechat_id: WID_B, received_count: 0, reply_count: 0, served_customers: 0, work_duration_minutes: 0, self_name: '小张', online: false },
        ],
      }),
    }),
  );
  await page.route('**/api/wechat/cs/config/**', (r) => {
    if (r.request().method() === 'GET') {
      return r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ wechat_id: WID_A, persona: MOCK_PERSONA, business_kb: MOCK_KB }),
      });
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
  });
  await page.route('**/api/wechat/listener-heartbeat', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ listeners: [] }) }),
  );
  await page.route('**/api/crm/customers**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ cs_wechat_id: WID_A, customers: [], managed: true }),
    }),
  );
  await page.route('**/api/crm/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, data: {} }) }),
  );
}

test('多号 → 客服号总览表，点号下钻进单号工作台 + 5 Tab 切换', async ({ page }) => {
  await stub(page, [MACHINE_A, MACHINE_B]);

  await page.goto(`${BASE_URL}/area/wechat`);
  await page.waitForLoadState('networkidle');

  // 1. 落总览：两行号
  const overview = page.getByTestId('cs-overview');
  await expect(overview).toBeVisible();
  const rows = page.getByTestId('cs-overview-row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="cs-overview-row"][data-machine-id="mid-aaa"]')).toBeVisible();

  // 2. 点第一行 → 进该号工作台
  await page.locator('[data-testid="cs-overview-row"][data-machine-id="mid-aaa"]').click();
  await expect(page).toHaveURL(/\/wechat\/account\/mid-aaa/);
  await expect(page.getByTestId('cs-workbench')).toBeVisible();
  await expect(page.getByTestId('cs-workbench-title')).toHaveText('小苏');
  await expect(page.getByTestId('cs-workbench-statusbar')).toBeVisible();

  // 3. 5 个 Tab 都在
  for (const key of ['persona', 'kb', 'settings', 'customers', 'stats']) {
    await expect(page.getByTestId(`cs-tab-${key}`)).toBeVisible();
  }

  // 4. 默认人设话术 Tab（复用 WechatCustomerServiceConfigPage，按号自称预填）
  await expect(page.getByTestId('cs-tab-panel-persona')).toBeVisible();
  await expect(page.getByTestId('persona-self-name')).toHaveValue('小苏');
  // 工作台内不应再出现该页自己的号选择器（号已由工作台固定）
  await expect(page.getByTestId('cs-account-selector')).toHaveCount(0);

  // 5. 切「运营设置」Tab（复用 CsOneClickSetupPage embedded）→ 出现真发开关，但藏掉选机器列表
  await page.getByTestId('cs-tab-settings').click();
  await expect(page.getByTestId('cs-tab-panel-settings')).toBeVisible();
  await expect(page.getByTestId('setup-auto-agent')).toBeVisible();
  await expect(page.getByTestId('machine-radio')).toHaveCount(0);

  // 6. 切「成效」Tab（复用 CsWorkStatsPage，按号过滤 → 只本号一张卡）
  await page.getByTestId('cs-tab-stats').click();
  await expect(page.getByTestId('cs-tab-panel-stats')).toBeVisible();
  await expect(page.getByTestId(`cs-stat-card-${WID_A}`)).toBeVisible();
  await expect(page.getByTestId(`cs-stat-card-${WID_B}`)).toHaveCount(0);
});

test('运营名下正好 1 个号 → /area/wechat 直接进该号工作台（跳过总览）', async ({ page }) => {
  await stub(page, [MACHINE_A]);

  await page.goto(`${BASE_URL}/area/wechat`);
  await page.waitForLoadState('networkidle');

  // 重定向进工作台，不停在总览
  await expect(page).toHaveURL(/\/wechat\/account\/mid-aaa/);
  await expect(page.getByTestId('cs-workbench')).toBeVisible();
  await expect(page.getByTestId('cs-overview')).toHaveCount(0);
});

test('可见性兜底：URL 直敲不在 scoped 列表里的号 → 无权访问', async ({ page }) => {
  await stub(page, [MACHINE_A]); // 列表里只有 mid-aaa

  await page.goto(`${BASE_URL}/wechat/account/mid-not-mine`);
  await page.waitForLoadState('networkidle');

  await expect(page.getByTestId('cs-workbench-forbidden')).toBeVisible();
  await expect(page.getByTestId('cs-workbench')).toHaveCount(0);
});
