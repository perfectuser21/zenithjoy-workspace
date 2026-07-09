/**
 * 对话式创建 Skill — Playwright E2E（Red 基线 — commit 1）
 *
 * 合同 [BEHAVIOR] 8（Golden Path）+ [BEHAVIOR] 10（mmv 不可达错误）
 *
 * 运行方式（windows_cloud CI / 本地）：
 *   VITE_SKIP_AUTH=true VITE_STAFF_EMAILS=staff@test.com npx vite --port 5173
 *   npx playwright test e2e/skill-create.spec.ts
 *
 * sprint_dir: sprints/07091721-conversational-skill-creation
 * task_id: 8541996f-7bc1-43c5-aac7-cec5ef8cb398
 *
 * 这些测试在实现前**必须是 Red**（全部 fixme 跳过 or 断言失败）。
 * 实现完成后移除 test.fixme() 让测试变为 Green。
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

function buildUrl(path: string) {
  return `${BASE}${path}`;
}

// ─── mock 辅助：stub skill-drafts API ─────────────────────────────────────────

function stubSkillDraftsApi(page: import('@playwright/test').Page, initialMessageCount = 0) {
  let messageCount = initialMessageCount;

  // POST /api/staff/skill-drafts → 创建草稿
  page.route('**/api/staff/skill-drafts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { id: 'mock-draft-001', status: 'chatting' },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  // GET /api/staff/skill-drafts/:id → 历史消息
  page.route('**/api/staff/skill-drafts/mock-draft-001', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'mock-draft-001',
            status: 'chatting',
            messages_json: messageCount > 0
              ? [
                  { role: 'user', content: '你好，我想创建一个发布抖音视频的 skill' },
                  { role: 'assistant', content: '好的，请告诉我更多需求...' },
                ]
              : [],
          },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  // POST /api/staff/skill-drafts/:id/chat → SSE（用 text/plain 模拟简单文本流）
  page.route('**/api/staff/skill-drafts/mock-draft-001/chat', async (route) => {
    if (route.request().method() === 'POST') {
      messageCount++;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'data: {"type":"text","text":"好的，请告诉我更多需求..."}\n\n',
          'event: done\ndata: {}\n\n',
        ].join(''),
      });
    } else {
      await route.fallback();
    }
  });

  // POST /api/staff/skill-drafts/:id/generate → 生成完成
  page.route('**/api/staff/skill-drafts/mock-draft-001/generate', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'done', job_id: 'gen-job-001' },
        }),
      });
    } else {
      await route.fallback();
    }
  });
}

// ─── [BEHAVIOR] 8：Golden Path ────────────────────────────────────────────────

test(
  '[BEHAVIOR] 8 — Golden Path：staff 登录 → 创建 Skill tab → 聊天 → 生成 → 跳转报告页',
  async ({ page }) => {
    stubSkillDraftsApi(page);
    await page.goto(buildUrl('/staff/skill-eval'));

    // Step 1：「创建 Skill」Tab 可见
    await expect(page.locator('text=创建 Skill')).toBeVisible({ timeout: 10000 });

    // Step 2：点击 Tab，输入框可见
    await page.locator('text=创建 Skill').click();
    await expect(
      page.locator('[data-testid="skill-create-input"]').or(page.locator('textarea[placeholder*="描述"]'))
    ).toBeVisible({ timeout: 5000 });

    // Step 3：发送一条消息 → AI 气泡出现
    const input = page
      .locator('[data-testid="skill-create-input"]')
      .or(page.locator('textarea[placeholder*="描述"]'));
    await input.fill('你好，我想创建一个发布抖音视频的 skill');
    await page
      .locator('[data-testid="skill-create-send"]')
      .or(page.locator('button:has-text("发送")'))
      .click();

    // 用户气泡出现
    await expect(page.locator('text=你好，我想创建一个发布抖音视频的 skill')).toBeVisible({ timeout: 5000 });
    // AI 回复气泡出现（SSE 流式渲染）
    await expect(page.locator('text=好的，请告诉我更多需求')).toBeVisible({ timeout: 10000 });

    // Step 4：发送"生成吧" → 出现"正在生成..."状态提示
    await input.fill('生成吧');
    await page
      .locator('[data-testid="skill-create-send"]')
      .or(page.locator('button:has-text("发送")'))
      .click();

    await expect(
      page.locator('text=正在生成').or(page.locator('[data-testid="skill-create-generating"]'))
    ).toBeVisible({ timeout: 5000 });

    // Step 5：mock generate 完成 → 页面跳转到报告页，URL 含 job_id
    await expect(page).toHaveURL(/job_id=gen-job-001/, { timeout: 15000 });
  }
);

// ─── [BEHAVIOR] 10：mmv 不可达错误 ────────────────────────────────────────────

test(
  '[BEHAVIOR] 10 — mmv 不可达：前端显示"AI 暂时连不上，稍后重试"，不出现无限 loading',
  async ({ page }) => {
    // mock /chat 返回 event: error
    page.route('**/api/staff/skill-drafts', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { id: 'mock-draft-err', status: 'chatting' } }),
        });
      } else {
        await route.fallback();
      }
    });

    page.route('**/api/staff/skill-drafts/mock-draft-err/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'event: error\ndata: {"message":"AI 暂时连不上，稍后重试"}\n\n',
      });
    });

    await page.goto(buildUrl('/staff/skill-eval'));
    await page.locator('text=创建 Skill').click();

    const input = page
      .locator('[data-testid="skill-create-input"]')
      .or(page.locator('textarea[placeholder*="描述"]'));
    await input.fill('测试错误场景');
    await page
      .locator('[data-testid="skill-create-send"]')
      .or(page.locator('button:has-text("发送")'))
      .click();

    // 应显示错误提示
    await expect(
      page.locator('text=AI 暂时连不上，稍后重试').or(page.locator('text=AI 暂时连不上'))
    ).toBeVisible({ timeout: 15000 });

    // 不应出现无限 loading（确认 loading spinner 最终消失）
    const loadingSpinner = page.locator('[data-testid="skill-create-loading"]');
    if (await loadingSpinner.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(loadingSpinner).not.toBeVisible({ timeout: 10000 });
    }
  }
);

// ─── [BEHAVIOR] 8 辅助：断点续聊（Tab 重开后历史可见）─────────────────────────

test(
  '[BEHAVIOR] 断点续聊：刷新页面后从 localStorage 恢复 draft_id，历史消息可见',
  async ({ page }) => {
    // initialMessageCount=1：模拟"上次已经聊过一轮"，本测试验证的是刷新后
    // 历史可见，不是发消息这个动作本身（发消息由 BEHAVIOR 8 覆盖）
    stubSkillDraftsApi(page, 1);
    await page.goto(buildUrl('/staff/skill-eval'));

    // 模拟已有 draft_id 在 localStorage
    await page.evaluate(() => {
      localStorage.setItem('skill_draft_id', 'mock-draft-001');
    });

    // 重新加载（模拟次日打开）
    await page.reload();
    await page.locator('text=创建 Skill').click();

    // 历史消息应从 GET /skill-drafts/mock-draft-001 加载并渲染
    // （mock 返回 messages_json 含 2 条：用户消息 + AI 回复）
    await expect(page.locator('text=你好，我想创建一个发布抖音视频的 skill')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('text=好的，请告诉我更多需求')).toBeVisible({ timeout: 5000 });
  }
);
