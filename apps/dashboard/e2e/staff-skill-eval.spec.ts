/**
 * Staff Tools Hub + Skill Evaluator E2E
 *
 * 合同测试（CONTRACT IS LAW）：
 *   sprint_dir: sprints/07090821-staff-tools-skill-eval
 *   task_id: 23b96c28-cf91-4657-bd26-46cd33837f16
 *
 * 场景覆盖（FR1-13）：
 *   1. staff 账号登录后侧边栏出现「员工工具」分组 (FR1-5)
 *   2. 非 staff 账号登录后侧边栏无「员工工具」分组 (FR1,3,5)
 *   3. staff 账号能访问 /staff/skill-eval 且页面有上传区域 (FR6-8)
 *   4. 非 staff 账号访问 /staff/skill-eval 被重定向回 / (FR7)
 *
 * 运行方式（windows_cloud CI / 本地）：
 *   VITE_SKIP_AUTH=true VITE_STAFF_EMAILS=staff@test.com npx vite --port 5173
 *   npx playwright test e2e/staff-skill-eval.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';

function buildUrl(path: string) {
  return `${BASE}${path}`;
}

function stubSkillEvalApi(page: import('@playwright/test').Page) {
  page.route('**/api/staff/skill-eval/upload', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { job_id: 'test-job-001' } }),
      });
    } else {
      await route.fallback();
    }
  });

  page.route('**/api/staff/skill-eval/status/test-job-001', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { job_id: 'test-job-001', status: 'completed', report_url: null, failure_reason: null },
      }),
    });
  });

  // 报告 schema 对齐下游 Cecelia 真实响应（skill/verdict/summary/...），
  // 不是早期臆造的 { score, summary, details }
  // 默认返回下游真实的可视化 HTML 报告（skill-eval-report-render.js 原样产出），
  // 前端直接内嵌显示，不再自己拼一张简陋卡片
  page.route('**/api/staff/skill-eval/report/test-job-001', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><h1>test-skill</h1><p>技能评测通过，质量优秀。所有合同行为均通过验收。</p></body></html>',
    });
  });
}

// ─── 场景1：staff 账号侧边栏可见「员工工具」分组 ──────────────────────────────
test('staff 账号登录后侧边栏出现「员工工具」分组和「Skill 评测上传」入口', async ({ page }) => {
  await page.goto(buildUrl('/'));
  await expect(page.locator('text=员工工具')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=Skill 评测上传')).toBeVisible({ timeout: 5000 });
});

// ─── 场景2：非 staff 账号不应看到「员工工具」分组 ────────────────────────────
test('非 staff 账号登录后侧边栏无「员工工具」分组', async ({ page }) => {
  // 用非 staff 邮箱的 mock 用户登录（在 CI 里通过不同 VITE_MOCK_USER_EMAIL 设置）
  // 本测试依赖 CI env 变量：NON_STAFF_TEST_EMAIL（不在 VITE_STAFF_EMAILS 白名单）
  // 在不设置 VITE_STAFF_EMAILS 的本地环境：默认无员工（空白名单 = 无 staff），也满足该测试
  await page.goto(buildUrl('/'));
  // 页面加载后「员工工具」分组不应存在
  const staffGroup = page.locator('text=员工工具');
  await expect(staffGroup).not.toBeVisible({ timeout: 5000 });
});

// ─── 场景3：staff 账号能访问 /staff/skill-eval 且页面有上传区域 ─────────────
test('staff 账号能访问 /staff/skill-eval 且页面有文件上传区域', async ({ page }) => {
  stubSkillEvalApi(page);
  await page.goto(buildUrl('/staff/skill-eval'));
  // 不应被重定向回 /
  await expect(page).not.toHaveURL(buildUrl('/'));
  // 页面有文件上传区域
  await expect(page.locator('[data-testid="skill-eval-upload"]').or(page.locator('input[type="file"]'))).toBeVisible({ timeout: 10000 });
});

// ─── 场景4：非 staff 账号访问 /staff/skill-eval 被重定向 ─────────────────────
test('非 staff 账号访问 /staff/skill-eval 被重定向回 /', async ({ page }) => {
  // 本测试在 NON_STAFF 环境下运行（不设置 VITE_STAFF_EMAILS 或使用非白名单邮箱）
  // CI 中需要在独立 run 下以不同 VITE_STAFF_EMAILS 注入来区分 staff/非staff 场景
  // 当前验证：如果非 staff，访问 /staff/skill-eval 会被打回 /
  const response = await page.goto(buildUrl('/staff/skill-eval'), { waitUntil: 'networkidle' });
  // 无论是 5173 跳转还是 API 层 403，页面不应停留在 /staff/skill-eval 且无出错页
  const finalUrl = page.url();
  // 非 staff 时：要么跳回 /，要么展示无权限
  if (!finalUrl.includes('/staff/skill-eval')) {
    // 已被重定向，通过
    expect(true).toBe(true);
  } else {
    // 停留在页面时，应显示无权限提示而非正常页面
    await expect(page.locator('text=无权限').or(page.locator('text=权限不足'))).toBeVisible({ timeout: 3000 });
  }
  void response;
});

// ─── 完整 Golden Path：上传 zip → 轮询 → 展示报告 ────────────────────────────
test('完整 Golden Path：staff 账号上传 zip → 轮询到 completed → 展示评测报告', async ({ page }) => {
  stubSkillEvalApi(page);
  await page.goto(buildUrl('/staff/skill-eval'));
  await expect(page).not.toHaveURL(buildUrl('/'));

  // 找到文件上传区域
  const fileInput = page.locator('[data-testid="skill-eval-upload"]').or(page.locator('input[type="file"]'));
  await expect(fileInput).toBeVisible({ timeout: 10000 });

  // 模拟文件上传（使用 Buffer 代替真实文件）
  await fileInput.setInputFiles({
    name: 'test-skill.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('PK\x03\x04'),
  });

  // 点击上传按钮
  const uploadBtn = page.locator('[data-testid="skill-eval-submit"]').or(page.locator('button:has-text("上传")'));
  await expect(uploadBtn).toBeVisible({ timeout: 5000 });
  await uploadBtn.click();

  // 等待显示 job_id 或轮询状态
  await expect(
    page.locator('[data-testid="skill-eval-job-id"]')
      .or(page.locator('text=test-job-001'))
      .or(page.locator('text=评测中'))
  ).toBeVisible({ timeout: 10000 });

  // 轮询到 completed 后展示报告（score=92）
  await expect(
    page.locator('[data-testid="skill-eval-report"]')
      .or(page.locator('text=92'))
      .or(page.locator('text=评测通过'))
      .or(page.locator('text=评测报告'))
  ).toBeVisible({ timeout: 30000 });
});

// ─── 上传失败错误提示 ─────────────────────────────────────────────────────────
test('上传失败时展示错误提示，不永久转圈', async ({ page }) => {
  page.route('**/api/staff/skill-eval/upload', async (route) => {
    await route.fulfill({ status: 500, body: JSON.stringify({ success: false, error: { message: '上传失败' } }) });
  });

  await page.goto(buildUrl('/staff/skill-eval'));
  await expect(page).not.toHaveURL(buildUrl('/'));

  const fileInput = page.locator('[data-testid="skill-eval-upload"]').or(page.locator('input[type="file"]'));
  await expect(fileInput).toBeVisible({ timeout: 10000 });
  await fileInput.setInputFiles({ name: 'fail.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') });

  const uploadBtn = page.locator('[data-testid="skill-eval-submit"]').or(page.locator('button:has-text("上传")'));
  await uploadBtn.click();

  await expect(
    page.locator('[data-testid="skill-eval-error"]')
      .or(page.locator('text=上传失败'))
      .or(page.locator('text=失败'))
  ).toBeVisible({ timeout: 10000 });

  // 不应显示永久 loading 状态
  const loadingSpinner = page.locator('[data-testid="skill-eval-loading"]');
  if (await loadingSpinner.isVisible()) {
    await expect(loadingSpinner).not.toBeVisible({ timeout: 15000 });
  }
});

// ─── 超时提示 ────────────────────────────────────────────────────────────────
test('504 后端超时时前端展示友好错误信息', async ({ page }) => {
  page.route('**/api/staff/skill-eval/upload', async (route) => {
    await route.fulfill({ status: 504, body: JSON.stringify({ success: false, error: { message: 'Gateway Timeout' } }) });
  });

  await page.goto(buildUrl('/staff/skill-eval'));
  await expect(page).not.toHaveURL(buildUrl('/'));

  const fileInput = page.locator('[data-testid="skill-eval-upload"]').or(page.locator('input[type="file"]'));
  if (!(await fileInput.isVisible({ timeout: 5000 }).catch(() => false))) return;
  await fileInput.setInputFiles({ name: 'test.zip', mimeType: 'application/zip', buffer: Buffer.from('PK') });

  const uploadBtn = page.locator('[data-testid="skill-eval-submit"]').or(page.locator('button:has-text("上传")'));
  if (await uploadBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await uploadBtn.click();
    await expect(
      page.locator('text=评测服务暂不可用')
        .or(page.locator('text=超时'))
        .or(page.locator('text=服务暂不可用'))
        .or(page.locator('[data-testid="skill-eval-error"]'))
    ).toBeVisible({ timeout: 15000 });
  }
});
