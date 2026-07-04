/**
 * Acquisition Config E2E — /dashboard/acquisition-config 智能获客「参数配置」页
 *
 * 覆盖场景（契约端点全 page.route stub，不依赖真后端）：
 *   test a: 配置表单渲染 + 改值保存调 PUT（持久化回显）
 *
 * 注：指派计划表 / 「跑分析指派」按钮 / Cookie 健康三态渲染这三块已随
 * Line02 Dashboard IA 重做（sprints/07041249-line02-dashboard-ia-redesign）
 * 移除——指派改自动触发（不再需要手动按钮），账号健康状态已并入账号管理页
 * （AcquisitionAccountsPage 的「健康状态」列），触达历史移到新的
 * AcquisitionOutreachPage（/area/acquisition/outreach，只读视图，测试见
 * acquisition-ia-redesign.spec.ts）。
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

// test a: 配置表单渲染 + 改值保存调 PUT
test('配置表单渲染 + 改值保存调 PUT 持久化', async ({ page }) => {
  await stubConfig(page);

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
