/**
 * 对话式创建 Skill — 长跑改造 Playwright E2E（Red 基线 — commit 1）
 *
 * 覆盖合同 [BEHAVIOR] B-17 ~ B-20：
 *   B-17  — [BEHAVIOR] 前端轮询间隔（8s，running/needs_input 状态）
 *   B-18  — [BEHAVIOR] 前端 done 显示下载链接
 *   B-19  — [BEHAVIOR] 前端 needs_input 显示问题 + 输入框 + 提交按钮
 *   B-20  — [BEHAVIOR] 前端 error 显示重试按钮
 *
 * 运行方式（windows_cloud CI / 本地）：
 *   VITE_SKIP_AUTH=true VITE_STAFF_EMAILS=staff@test.com npx vite --port 5173
 *   npx playwright test e2e/skill-create-longrun.spec.ts
 *
 * sprint_dir: sprints/07101942-skill-create-longrun
 * task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
 *
 * 这些测试在实现前**必须是 Red**（全部 fixme 跳过 or 断言失败）。
 * 实现完成后移除 test.fixme() 让测试变为 Green。
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

function buildUrl(path: string) {
  return `${BASE}${path}`;
}

// ─── mock 辅助：stub skill-drafts API（长跑版本）─────────────────────────────

function stubSkillDraftsApiLongrun(
  page: import('@playwright/test').Page,
  options: {
    generateResponse?: { status: string; callback_token?: string };
    pollResponses?: Array<{ status: string; pending_question?: string; result_json?: object }>;
    answerResponse?: { status: string };
  } = {}
) {
  const generateResp = options.generateResponse ?? { status: 'running' };
  const pollSequence = options.pollResponses ?? [
    { status: 'running' },
    { status: 'done', result_json: { zip_path: '/tmp/my-skill.zip' } },
  ];
  let pollIndex = 0;
  let draftStatus = 'chatting';

  // POST /api/staff/skill-drafts → 创建草稿
  page.route('**/api/staff/skill-drafts', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'mock-draft-longrun-001',
            status: 'chatting',
            pending_question: null,
            result_json: null,
          },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  // GET /api/staff/skill-drafts/:id → 轮询
  page.route('**/api/staff/skill-drafts/mock-draft-longrun-001', async (route) => {
    if (route.request().method() === 'GET') {
      const current = pollSequence[pollIndex] ?? pollSequence[pollSequence.length - 1];
      if (pollIndex < pollSequence.length - 1) pollIndex++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: 'mock-draft-longrun-001',
            status: current.status,
            messages_json: [],
            pending_question: current.pending_question ?? null,
            result_json: current.result_json ?? null,
          },
        }),
      });
    } else if (route.request().method() === 'POST') {
      // POST answer
      draftStatus = 'running';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { status: 'running' },
        }),
      });
    } else {
      await route.fallback();
    }
  });

  // POST /api/staff/skill-drafts/:id/generate
  page.route('**/api/staff/skill-drafts/mock-draft-longrun-001/generate', async (route) => {
    draftStatus = 'running';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: generateResp,
      }),
    });
  });

  // POST /api/staff/skill-drafts/:id/answer
  page.route('**/api/staff/skill-drafts/mock-draft-longrun-001/answer', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: options.answerResponse ?? { status: 'running' },
      }),
    });
  });

  // POST /api/staff/skill-drafts/:id/chat → SSE（聊天阶段）
  page.route('**/api/staff/skill-drafts/mock-draft-longrun-001/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'event: done\ndata: {}\n\n',
    });
  });
}

// ─── B-17：前端轮询间隔（running 状态每 8s 一次 GET）────────────────────────

test('[BEHAVIOR] B-17 — 前端 running 状态每 8 秒发一次 GET 轮询', async ({ page }) => {
  test.fixme(true, 'Red: 实现前跳过（commit-2 实现后移除 fixme）');

  stubSkillDraftsApiLongrun(page, {
    generateResponse: { status: 'running' },
    pollResponses: [
      { status: 'running' },
      { status: 'running' },
      { status: 'done', result_json: { zip_path: '/tmp/test.zip' } },
    ],
  });

  await page.goto(buildUrl('/staff/skill-create'));
  await page.waitForSelector('[data-testid="skill-create-input"]');

  // 发送消息触发 generate
  await page.fill('[data-testid="skill-create-input"]', '生成吧');
  await page.click('[data-testid="skill-create-send"]');

  // 等待进入 running 状态
  await page.waitForSelector('[data-testid="skill-create-running"]', { timeout: 5000 });

  // 记录首次 GET 时间
  const getRequests: number[] = [];
  page.on('request', (req) => {
    if (req.method() === 'GET' && req.url().includes('skill-drafts/mock-draft-longrun-001')) {
      getRequests.push(Date.now());
    }
  });

  // 等待至少 2 次 GET
  await page.waitForFunction(() => {
    return true; // 时间判断在收集结束后
  });
  await page.waitForTimeout(20000); // 等待 20s，应该看到 2-3 次请求

  expect(getRequests.length).toBeGreaterThanOrEqual(2);
  if (getRequests.length >= 2) {
    const interval = getRequests[1] - getRequests[0];
    // 应在 7-9s 之间（8s ± 1s 容差）
    expect(interval).toBeGreaterThanOrEqual(7000);
    expect(interval).toBeLessThanOrEqual(9000);
  }
});

// ─── B-18：前端 done 状态显示下载链接 ─────────────────────────────────────────

test('[BEHAVIOR] B-18 — 前端 done 状态显示下载链接', async ({ page }) => {
  test.fixme(true, 'Red: 实现前跳过（commit-2 实现后移除 fixme）');

  stubSkillDraftsApiLongrun(page, {
    generateResponse: { status: 'running' },
    pollResponses: [
      { status: 'done', result_json: { zip_path: '/tmp/my-skill.zip' } },
    ],
  });

  await page.goto(buildUrl('/staff/skill-create'));
  await page.waitForSelector('[data-testid="skill-create-input"]');

  await page.fill('[data-testid="skill-create-input"]', '生成吧');
  await page.click('[data-testid="skill-create-send"]');

  // 等待 done 状态 UI 出现（含下载链接）
  await page.waitForSelector('[data-testid="skill-create-download-link"]', { timeout: 15000 });
  const link = page.locator('[data-testid="skill-create-download-link"]');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /my-skill\.zip/);
});

// ─── B-19：前端 needs_input 显示问题 + 输入框 + 提交按钮 ──────────────────────

test('[BEHAVIOR] B-19 — 前端 needs_input 状态显示问题 + 输入框 + 提交按钮', async ({ page }) => {
  test.fixme(true, 'Red: 实现前跳过（commit-2 实现后移除 fixme）');

  stubSkillDraftsApiLongrun(page, {
    generateResponse: { status: 'running' },
    pollResponses: [
      {
        status: 'needs_input',
        pending_question: '请问你想要记账功能还是理财功能？',
      },
    ],
    answerResponse: { status: 'running' },
  });

  await page.goto(buildUrl('/staff/skill-create'));
  await page.waitForSelector('[data-testid="skill-create-input"]');

  await page.fill('[data-testid="skill-create-input"]', '生成吧');
  await page.click('[data-testid="skill-create-send"]');

  // 等待 needs_input 状态 UI 出现
  await page.waitForSelector('[data-testid="skill-create-needs-input"]', { timeout: 15000 });

  // 验证问题文本
  const questionText = page.locator('[data-testid="skill-create-question"]');
  await expect(questionText).toBeVisible();
  await expect(questionText).toContainText('请问你想要记账功能还是理财功能？');

  // 验证输入框
  const answerInput = page.locator('[data-testid="skill-create-answer-input"]');
  await expect(answerInput).toBeVisible();

  // 验证提交按钮
  const submitBtn = page.locator('[data-testid="skill-create-answer-submit"]');
  await expect(submitBtn).toBeVisible();

  // 提交答案
  await answerInput.fill('我想要记账功能');
  await submitBtn.click();

  // 应该回到 running 状态
  await page.waitForSelector('[data-testid="skill-create-running"]', { timeout: 5000 });
});

// ─── B-20：前端 error 状态显示重试按钮 ──────────────────────────────────────

test('[BEHAVIOR] B-20 — 前端 error 状态显示错误信息 + 重新开始按钮', async ({ page }) => {
  test.fixme(true, 'Red: 实现前跳过（commit-2 实现后移除 fixme）');

  stubSkillDraftsApiLongrun(page, {
    generateResponse: { status: 'running' },
    pollResponses: [
      {
        status: 'error',
        result_json: { error_message: 'skill-creator 调用失败：网络超时' },
      },
    ],
  });

  await page.goto(buildUrl('/staff/skill-create'));
  await page.waitForSelector('[data-testid="skill-create-input"]');

  await page.fill('[data-testid="skill-create-input"]', '生成吧');
  await page.click('[data-testid="skill-create-send"]');

  // 等待 error 状态 UI 出现
  await page.waitForSelector('[data-testid="skill-create-error"]', { timeout: 15000 });

  // 验证错误信息
  const errorMsg = page.locator('[data-testid="skill-create-error-message"]');
  await expect(errorMsg).toBeVisible();
  await expect(errorMsg).toContainText('skill-creator 调用失败');

  // 验证重新开始按钮
  const retryBtn = page.locator('[data-testid="skill-create-retry"]');
  await expect(retryBtn).toBeVisible();
  await expect(retryBtn).toContainText('重新开始');
});
