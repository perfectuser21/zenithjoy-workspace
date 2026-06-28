/**
 * Acquisition Config E2E — /dashboard/acquisition-config 智能获客「分析+指派」配置页
 *
 * 覆盖场景（契约端点全 page.route stub，不依赖真后端）：
 *   test a: 配置表单渲染 + 改值保存调 PUT（持久化回显）
 *   test b: 指派计划表渲染（客户 nickname+relevance_score × 小号 × 排期 × 状态）
 *   test c: 「跑分析指派」按钮调 POST /dispatch/build
 *   test d: Cookie 健康三态渲染（healthy / stale / expired + expired 显「需重扫」）
 *
 * VITE_SKIP_AUTH=true 跳鉴权（页面 requireAuth，非 super-admin），无需 stub session。
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npx vite --port 5173
 *   npx playwright test e2e/acquisition-config.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const CONFIG = {
  tenant_id: 't1',
  collect_rounds_per_day: 2,
  keywords_per_round_min: 3,
  keywords_per_round_max: 5,
  collect_active_start: '09:00',
  collect_active_end: '21:00',
  burner_count: 3,
  dm_per_hour: 5,
  dm_per_day: 30,
  dm_interval_min_sec: 300,
  dm_interval_max_sec: 900,
  dm_active_start: '09:00',
  dm_active_end: '22:00',
  nurture_per_day_min: 1,
  nurture_per_day_max: 2,
  cookie_check_interval_hours: 6,
};

const PLAN = [
  {
    id: 'as-1',
    lead_id: 'lead-1',
    nickname: '健身教练阿强',
    relevance_score: 92,
    profile_url: 'https://douyin.com/user/aqiang',
    account_label: 'perfect-02',
    status: 'queued',
    scheduled_for: '2026-06-26T10:30:00.000Z',
  },
  {
    id: 'as-2',
    lead_id: 'lead-2',
    nickname: '瑜伽馆老板',
    relevance_score: 70,
    profile_url: 'https://douyin.com/user/yujia',
    account_label: 'perfect-03',
    status: 'dispatched',
    scheduled_for: '2026-06-26T11:00:00.000Z',
  },
];

const COOKIE_HEALTH = {
  items: [
    { account_label: 'perfect-01', role: 'main', health: 'healthy', bound_at: '2026-06-26T00:00:00.000Z', needs_rescan: false },
    { account_label: 'perfect-02', role: 'burner', health: 'stale', bound_at: '2026-06-20T00:00:00.000Z', needs_rescan: false },
    { account_label: 'perfect-03', role: 'burner', health: 'expired', bound_at: null, needs_rescan: true },
  ],
  alert_count: 1,
};

async function stubConfig(page: Page, config = CONFIG) {
  await page.route('**/api/acquisition/config', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: config }),
    });
  });
}

async function stubPlan(page: Page, plan = PLAN) {
  await page.route('**/api/acquisition/dispatch/plan**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: plan }),
    });
  });
}

async function stubCookieHealth(page: Page, result = COOKIE_HEALTH) {
  await page.route('**/api/acquisition/cookie-health', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: result }),
    });
  });
}

async function stubAccountStatus(page: Page) {
  await page.route('**/api/line02/account-status', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { accounts: [] } }),
    });
  });
}

async function stubAll(page: Page) {
  await stubConfig(page);
  await stubPlan(page);
  await stubCookieHealth(page);
  await stubAccountStatus(page);
}

// test a: 配置表单渲染 + 改值保存调 PUT
test('配置表单渲染 + 改值保存调 PUT 持久化', async ({ page }) => {
  await stubAll(page);

  let putBody: Record<string, unknown> | null = null;
  await page.route('**/api/acquisition/config', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    putBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { ...CONFIG, ...putBody } }),
    });
  });

  await page.goto('/dashboard/acquisition-config');

  // 表单渲染：每天每号私信上限字段显示默认 30
  const dmPerDay = page.getByLabel(/每天每号私信上限|dm_per_day/);
  await expect(dmPerDay).toHaveValue('30');

  // 改值
  await dmPerDay.fill('25');
  await page.getByRole('button', { name: /保存配置|保存/ }).first().click();

  await expect.poll(() => putBody).not.toBeNull();
  expect((putBody as unknown as { dm_per_day: number }).dm_per_day).toBe(25);
  await expect(page.getByText(/已保存|保存成功/).first()).toBeVisible();
});

// test b: 指派计划表渲染（含 relevance_score）
test('指派计划表渲染 客户+分数×小号×排期×状态', async ({ page }) => {
  await stubAll(page);
  await page.goto('/dashboard/acquisition-config');

  await expect(page.getByText('健身教练阿强').first()).toBeVisible();
  // relevance_score
  await expect(page.getByText('92').first()).toBeVisible();
  // 小号 account_label
  await expect(page.getByText('perfect-02').first()).toBeVisible();
  // 状态
  await expect(page.getByText(/queued|排队/).first()).toBeVisible();
  await expect(page.getByText('瑜伽馆老板').first()).toBeVisible();
});

// test c: 跑分析指派按钮调 build
test('「跑分析指派」按钮调 POST /dispatch/build', async ({ page }) => {
  await stubAll(page);

  let buildCalled = false;
  await page.route('**/api/acquisition/dispatch/build', async (route) => {
    buildCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { scored: 4, assigned: 6 } }),
    });
  });

  await page.goto('/dashboard/acquisition-config');
  await page.getByRole('button', { name: /跑分析指派/ }).click();

  await expect.poll(() => buildCalled).toBe(true);
  await expect(page.getByText(/已指派|scored|分析完成/).first()).toBeVisible();
});

// test d: Cookie 健康三态渲染
test('Cookie 健康三态渲染 + expired 显「需重扫」', async ({ page }) => {
  await stubAll(page);
  await page.goto('/dashboard/acquisition-config');

  await expect(page.getByText('perfect-01').first()).toBeVisible();
  // 三态文字
  await expect(page.getByText(/健康|healthy/).first()).toBeVisible();
  await expect(page.getByText(/陈旧|stale/).first()).toBeVisible();
  await expect(page.getByText(/过期|expired/).first()).toBeVisible();
  // expired 号需重扫
  await expect(page.getByText('需重扫').first()).toBeVisible();
});
