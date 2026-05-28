/**
 * Operator Sessions E2E — /operator 运营员控制台 Session 状态矩阵
 *
 * 覆盖场景：
 *   test 1: 运营员视角 — 8 平台行存在断言 + status badge + 登录按钮
 *   test 2: status 三态渲染 — active(🟢) / expired(🔴) / missing(⚫)
 *   test 3: 登录按钮触发 POST /api/operator/sessions/trigger-bind
 *   test 4: 非运营员 redirect 守卫 — 非 xuxiao21xx@icloud.com 访问被重定向
 *
 * API 全部 page.route stub，不依赖真实后端，适合 windows_cloud 干净 VM。
 *
 * 运行：
 *   VITE_SKIP_AUTH=false npm run dev:dashboard
 *   npx playwright test e2e/operator-sessions.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const OPERATOR_EMAIL = 'xuxiao21xx@icloud.com';

const SESSIONS_DATA = [
  { platform: 'douyin',      secretName: 'DOUYIN_COOKIES',      status: 'active',  lastCheckedAt: '2026-05-27T10:00:00Z', lastValidAt: '2026-05-27T10:00:00Z' },
  { platform: 'kuaishou',    secretName: 'KUAISHOU_COOKIES',    status: 'expired', lastCheckedAt: '2026-05-27T09:00:00Z', lastValidAt: '2026-05-26T10:00:00Z' },
  { platform: 'xiaohongshu', secretName: 'XIAOHONGSHU_COOKIES', status: 'missing', lastCheckedAt: null,                   lastValidAt: null },
  { platform: 'shipinhao',   secretName: 'SHIPINHAO_COOKIES',   status: 'active',  lastCheckedAt: '2026-05-27T10:00:00Z', lastValidAt: '2026-05-27T10:00:00Z' },
  { platform: 'toutiao',     secretName: 'TOUTIAO_COOKIES',     status: 'active',  lastCheckedAt: '2026-05-27T10:00:00Z', lastValidAt: '2026-05-27T10:00:00Z' },
  { platform: 'weibo',       secretName: 'WEIBO_COOKIES',       status: 'missing', lastCheckedAt: null,                   lastValidAt: null },
  { platform: 'zhihu',       secretName: 'ZHIHU_COOKIES',       status: 'expired', lastCheckedAt: '2026-05-27T08:00:00Z', lastValidAt: '2026-05-25T10:00:00Z' },
  { platform: 'gongzhonghao',secretName: 'GONGZHONGHAO_COOKIES',status: 'active',  lastCheckedAt: '2026-05-27T10:00:00Z', lastValidAt: '2026-05-27T10:00:00Z' },
];

async function stubAuthAsOperator(page: Page) {
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'operator-001', email: OPERATOR_EMAIL, name: '运营员', emailVerified: true },
        session: { id: 'sess-001', userId: 'operator-001', expiresAt: '2027-01-01T00:00:00Z' },
      }),
    });
  });
}

async function stubAuthAsRegularUser(page: Page) {
  await page.route('**/api/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'user-002', email: 'regular@zenjoymedia.media', name: '普通用户', emailVerified: true },
        session: { id: 'sess-002', userId: 'user-002', expiresAt: '2027-01-01T00:00:00Z' },
      }),
    });
  });
}

async function stubSessionsApi(page: Page) {
  await page.route('**/api/operator/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SESSIONS_DATA),
      });
    } else {
      await route.continue();
    }
  });
}

// test 1: 运营员视角 — 8 平台行 + status badge + 登录按钮
test('运营员视角：8 平台行全部渲染（抖音/快手/小红书/视频号/头条/微博/知乎/公众号）', async ({ page }) => {
  await stubAuthAsOperator(page);
  await stubSessionsApi(page);

  await page.goto('/operator');

  // 8 平台名必须全部可见
  for (const label of ['抖音', '快手', '小红书', '视频号', '头条', '微博', '知乎', '公众号']) {
    await expect(page.getByText(label).first()).toBeVisible();
  }

  // 每行含登录按钮
  const loginBtns = page.getByRole('button', { name: /登录/ });
  await expect(loginBtns.first()).toBeVisible();
  const count = await loginBtns.count();
  expect(count).toBeGreaterThanOrEqual(8);
});

// test 2: status 三态 badge 渲染 — active/expired/missing
test('status badge 三态渲染：active(🟢在线) / expired(🔴离线) / missing(⚫未配置)', async ({ page }) => {
  await stubAuthAsOperator(page);
  await stubSessionsApi(page);

  await page.goto('/operator');

  // active 平台显示 🟢 在线
  await expect(page.getByText('🟢 在线').first()).toBeVisible();

  // expired 平台显示 🔴 离线
  await expect(page.getByText('🔴 离线').first()).toBeVisible();

  // missing 平台显示 ⚫ 未配置
  await expect(page.getByText('⚫ 未配置').first()).toBeVisible();
});

// test 3: 登录按钮触发 POST trigger-bind
test('登录按钮触发 POST /api/operator/sessions/trigger-bind', async ({ page }) => {
  await stubAuthAsOperator(page);
  await stubSessionsApi(page);

  let capturedBody: { platform?: string } | null = null;
  await page.route('**/api/operator/sessions/trigger-bind', async (route) => {
    capturedBody = route.request().postDataJSON() as { platform: string };
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, taskId: 'task-abc-123', platform: 'douyin' }),
    });
  });

  await page.goto('/operator');

  // 点击抖音行的登录按钮（第一个）
  const firstLoginBtn = page.getByRole('button', { name: /登录/ }).first();
  await expect(firstLoginBtn).toBeVisible();
  await firstLoginBtn.click();

  // 验证 trigger-bind 被调用
  await expect.poll(() => capturedBody !== null, { timeout: 5_000 }).toBe(true);
  expect(capturedBody!.platform).toBeTruthy();
});

// test 4: 非运营员 redirect 守卫
test('非运营员 redirect 守卫：非 xuxiao21xx@icloud.com 访问 /operator 被重定向', async ({ page }) => {
  await stubAuthAsRegularUser(page);

  const redirected: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      redirected.push(frame.url());
    }
  });

  await page.goto('/operator');

  // 等待导航完成后，当前路径应不再是 /operator（已 redirect 到 /）
  await page.waitForURL((url) => !url.pathname.startsWith('/operator'), { timeout: 5_000 }).catch(() => null);

  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).not.toBe('/operator');
});
