/**
 * Module Health E2E — /module-health 客户机器 × Line 模块健康矩阵
 *
 * 覆盖场景：
 *   test 1: 机器行渲染（hostname + agent_id）+ 四条 Line 表头
 *   test 2: 单元格三态 — ok:true(🟢) / ok:false(🔴+reason) / 无数据(⚪)
 *   test 3: API 失败时显示错误提示
 *
 * API 全部 page.route stub，不依赖真实后端，适合 windows_cloud 干净 VM。
 * 复用运营员超管邮箱（与 operator-sessions.spec 同款，CI 的
 * VITE_SUPER_ADMIN_EMAILS 已含此邮箱）以通过 requireSuperAdmin 路由守卫。
 *
 * 运行：
 *   VITE_SKIP_AUTH=false npm run dev:dashboard
 *   npx playwright test e2e/module-health.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const SUPER_ADMIN_EMAIL = 'xuxiao21xx@icloud.com';

const HEALTH_DATA = {
  ok: true,
  data: [
    {
      agent_id: 'agent-001',
      hostname: '客户机器A',
      module_status: {
        'line04-wechat-cs': { ok: false, reason: '微信版本 4.2.0 不支持，请降级至 4.1.8' },
        'line01-publish': { ok: true },
        'line02-lead-gen': { ok: true },
        // line05-video 缺省 → ⚪ 无数据
      },
      updated_at: '2026-06-08T09:57:00Z',
    },
  ],
};

async function stubAuthAsSuperAdmin(page: Page) {
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'operator-001', email: SUPER_ADMIN_EMAIL, name: '运营员', emailVerified: true },
        session: { id: 'sess-001', userId: 'operator-001', expiresAt: '2027-01-01T00:00:00Z' },
      }),
    });
  });
}

async function stubModuleHealth(page: Page, body: unknown = HEALTH_DATA) {
  await page.route('**/api/agent/module-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

// test 1: 机器行 + 四条 Line 表头
test('渲染机器行（hostname + agent_id）+ 四条 Line 表头', async ({ page }) => {
  await stubAuthAsSuperAdmin(page);
  await stubModuleHealth(page);

  await page.goto('/module-health');

  await expect(page.getByText('客户机器A').first()).toBeVisible();
  await expect(page.getByText('agent-001').first()).toBeVisible();

  for (const line of ['智能发布', '智能获客', '微信AI客服', '视频剪辑']) {
    await expect(page.getByText(line, { exact: false }).first()).toBeVisible();
  }
});

// test 2: 单元格三态渲染
test('单元格三态：ok(🟢) / 失败(🔴 + reason) / 无数据(⚪)', async ({ page }) => {
  await stubAuthAsSuperAdmin(page);
  await stubModuleHealth(page);

  await page.goto('/module-health');

  // line01 / line02 ok → 🟢
  await expect(page.getByText('🟢').first()).toBeVisible();
  // line04 失败 → 🔴 + reason 文字
  await expect(page.getByText('🔴').first()).toBeVisible();
  await expect(page.getByText(/微信版本 4.2.0 不支持/).first()).toBeVisible();
  // line05 无上报 → ⚪
  await expect(page.getByText('⚪').first()).toBeVisible();
});

// test 3: API 失败时错误提示
test('API 失败时显示错误提示', async ({ page }) => {
  await stubAuthAsSuperAdmin(page);
  await page.route('**/api/agent/module-health', async (route) => {
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/module-health');

  await expect(page.getByText(/加载失败/).first()).toBeVisible();
});
