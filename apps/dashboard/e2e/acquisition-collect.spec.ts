/**
 * Path 2 Step4 — 获客页采集闭环 Dashboard E2E（windows_cloud Mode B）
 *
 * 全 API stub（page.route），不依赖真后端/真飞书/真抖音。
 * 走完采集 UI：点采集 → 扩 3 词(ai) → 确认派单 → 看结果(7态/计数/抖音号跳主页/残缺标记) → 失败原因。
 * 4 张截图存 e2e/screenshots/，e2e-verify.ps1 归集进 sprint screenshots/ 供 evaluator 视觉自验。
 *
 * 鉴权：注入 user/token cookie（AuthContext 步骤 2 cookie 兜底）+ stub better-auth get-session，
 * 让 /dashboard/leads 在 vite preview（无后端）下直接渲染，不被 SignIn 拦截。
 */
import { test, expect } from '@playwright/test';

const DOUYIN_NORMAL = 'https://www.douyin.com/user/MS4wNORMAL';

test('获客页采集闭环 4 步 UI（扩词→派单→结果→失败原因）', async ({ page, context }) => {
  // ── 注入鉴权（cookie 兜底）──
  const fakeUser = encodeURIComponent(JSON.stringify({ id: 'e2e-user', name: 'E2E 主理人' }));
  await context.addCookies([
    { name: 'user', value: fakeUser, url: 'http://localhost:5174' },
    { name: 'token', value: 'e2e-token', url: 'http://localhost:5174' },
  ]);
  await page.addInitScript(() => {
    document.cookie = 'token=e2e-token; path=/';
  });

  // stub better-auth get-session → 无 user（落到 cookie 兜底）
  await page.route('**/get-session*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
  });
  // 旧 leads 列表端点（页面 mount 时拉）→ 返空
  await page.route('**/api/acquisition/leads*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leads: [], total: 0 }),
    });
  });

  // ── stub 采集端点 ──
  await page.route('**/api/acquisition/collect/expand', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          degraded: false,
          keywords: [
            { word: '全屋定制', source: 'ai' },
            { word: '环保板材', source: 'ai' },
            { word: '免费量房', source: 'ai' },
          ],
        },
        timestamp: new Date().toISOString(),
      }),
    });
  });

  await page.route('**/api/acquisition/collect/start', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { task_id: 'e2e-task-1', status: 'pending' },
        timestamp: new Date().toISOString(),
      }),
    });
  });

  // GET 状态：先 done(结果)，后切 failed(失败原因)
  let statusBody = {
    success: true,
    data: {
      task_id: 'e2e-task-1',
      status: 'done',
      video_count: 7,
      lead_count_raw: 12,
      lead_count_deduped: 9,
      error_code: null as string | null,
      degraded: false,
      leads: [
        { sec_uid: 'MS4wNORMAL', nickname: '正常号', profile_url: DOUYIN_NORMAL, partial: false },
        { sec_uid: null, nickname: '残缺号', profile_url: null, partial: true },
      ],
    },
    timestamp: new Date().toISOString(),
  };
  await page.route('**/api/acquisition/collect/e2e-task-1', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(statusBody),
    });
  });

  // ── step1: 点采集 → 扩词结果 3 词 + 来源(ai) ──
  await page.goto('/dashboard/leads');
  const collectBtn = page.getByTestId('acq-collect-button');
  await expect(collectBtn).toBeVisible({ timeout: 10_000 });
  await collectBtn.click();
  await expect(page.getByTestId('acq-expand-result')).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('acq-expand-keyword')).toHaveCount(3, { timeout: 5000 });
  await expect(page.getByTestId('acq-keyword-source').first()).toHaveText('ai', { timeout: 5000 });
  await page.screenshot({ path: 'e2e/screenshots/01-expand.png', fullPage: true });

  // ── step2: 确认派单 → 任务状态可见 ──
  await page.getByTestId('acq-confirm-button').click();
  await expect(page.getByTestId('acq-task-status')).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e/screenshots/02-dispatched.png', fullPage: true });

  // ── step3: done 结果 — 计数 + 抖音号跳主页 + 残缺标记 ──
  await expect(page.getByTestId('acq-video-count')).toContainText('7', { timeout: 5000 });
  await expect(page.getByTestId('acq-lead-count-raw')).toContainText('12', { timeout: 5000 });
  await expect(page.getByTestId('acq-lead-count-deduped')).toContainText('9', { timeout: 5000 });
  await expect(page.getByTestId('acq-lead-profile-link').first()).toHaveAttribute(
    'href',
    DOUYIN_NORMAL,
    { timeout: 5000 }
  );
  await expect(page.getByTestId('acq-lead-partial-badge').first()).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: 'e2e/screenshots/03-result.png', fullPage: true });

  // ── step4: 切 failed + error_code DOUYIN_RISK → 失败原因可见 ──
  statusBody = {
    success: true,
    data: {
      task_id: 'e2e-task-1',
      status: 'failed',
      video_count: 7,
      lead_count_raw: 12,
      lead_count_deduped: 9,
      error_code: 'DOUYIN_RISK',
      degraded: false,
      leads: statusBody.data.leads,
    },
    timestamp: new Date().toISOString(),
  };
  await expect(page.getByTestId('acq-error-code')).toContainText('DOUYIN_RISK', { timeout: 8000 });
  await page.screenshot({ path: 'e2e/screenshots/04-failed.png', fullPage: true });
});
