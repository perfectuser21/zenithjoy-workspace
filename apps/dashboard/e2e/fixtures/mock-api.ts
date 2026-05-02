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

const MOCK_USER_JSON = JSON.stringify(MOCK_USER);

/**
 * 注入 mock auth + API 拦截。
 *
 * 双重保险：
 *   1. addInitScript  — 在页面 JS 运行前写入 localStorage（AuthContext 迁移路径）
 *   2. page.route     — 拦截 /api/auth/** 返回 mock session
 *
 * .env.development 在 CI 里不提交（.gitignore 屏蔽 .env.*），
 * VITE_SKIP_AUTH 不生效，必须有别的 auth fallback。
 */
export async function setupMockApi(page: Page) {
  // ── 1. localStorage 注入（页面 JS 运行前执行）─────────────────────────────
  //    AuthContext 步骤 3 读取 localStorage 并迁移到 cookie
  await page.addInitScript((userJson: string) => {
    localStorage.setItem('user', userJson);
    localStorage.setItem('token', 'e2e-test-token');
  }, MOCK_USER_JSON);

  // ── 2. API 拦截器（顺序敏感：精确 pattern 在 catch-all 之前）─────────────

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
        body: JSON.stringify({ data: MOCK_WORKS, total: MOCK_WORKS.length, limit: 20, offset: 0 }),
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
      body: JSON.stringify({ data: MOCK_AI_GENERATIONS, total: MOCK_AI_GENERATIONS.length }),
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
