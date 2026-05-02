import type { Page } from '@playwright/test';

export const MOCK_USER = {
  id: 'e2e-test-user',
  name: 'E2E测试用户',
  email: 'e2e@zenjoymedia.media',
};

export const MOCK_WORKS = [
  {
    id: 'work-e2e-001',
    title: '测试视频作品 1',
    content_type: 'video',
    status: 'published',
    created_at: '2026-05-01T08:00:00Z',
    updated_at: '2026-05-01T08:00:00Z',
  },
  {
    id: 'work-e2e-002',
    title: '测试图文作品 2',
    content_type: 'image',
    status: 'draft',
    created_at: '2026-05-01T09:00:00Z',
    updated_at: '2026-05-01T09:00:00Z',
  },
];

export const MOCK_AI_GENERATIONS = [
  {
    id: 'gen-e2e-001',
    prompt: '海边日落风景视频',
    model: 'kling-v2-master',
    status: 'completed',
    video_url: 'https://example.com/video/gen-e2e-001.mp4',
    created_at: '2026-05-01T08:00:00Z',
  },
];

/**
 * 设置 mock API 拦截器 + 注入 auth cookie。
 *
 * .env.development 在 CI 里不提交（.gitignore 屏蔽了 .env.*），所以
 * VITE_SKIP_AUTH 不一定生效。双保险：
 *   1. page.route 拦截 /api/auth/get-session → 返回 mock session
 *   2. addCookies 注入 user/token cookie → AuthContext cookie fallback 路径
 */
export async function setupMockApi(page: Page) {
  // ── Auth cookie 注入（AuthContext cookie fallback 路径）──────────────────
  await page.context().addCookies([
    {
      name: 'user',
      value: encodeURIComponent(JSON.stringify(MOCK_USER)),
      url: 'http://localhost:3001',
    },
    {
      name: 'token',
      value: 'e2e-test-token',
      url: 'http://localhost:3001',
    },
  ]);

  // ── API 拦截器（顺序敏感：精确 pattern 在 catch-all 之前）─────────────────

  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: MOCK_USER,
        session: { token: 'mock-session-token' },
      }),
    });
  });

  await page.route('**/api/works**', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_WORKS),
      });
    } else {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'work-e2e-new', ...JSON.parse(route.request().postData() ?? '{}') }),
      });
    }
  });

  await page.route('**/api/ai-video**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_AI_GENERATIONS),
    });
  });

  await page.route('**/api/credits/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ balance: 500, used: 100 }),
    });
  });

  await page.route('**/api/brain/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  await page.route('**/api/admin/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: null }),
    });
  });
}
