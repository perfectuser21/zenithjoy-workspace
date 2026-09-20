/**
 * 工作机控制塔 E2E — /dashboard/workers 总览 + /dashboard/workers/:id 详情
 * API 用 page.route stub（与 machine-events.spec.ts 同法，不依赖真后端）；VITE_SKIP_AUTH=true。
 * 运行：VITE_SKIP_AUTH=true npm run dev:dashboard && npm run -w apps/dashboard e2e -- workers
 */
import { test, expect } from '@playwright/test';
const workers = [
  { id: 'a1', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: '小龙虾', os_type: 'android', status: 'online',
    running: { task_id: 't1', title: '发布视频到抖音', current_step: 3, steps_total: 5 }, completed_today: 1, last_seen: null },
  { id: 'w1', agent_id: 'ag2', hostname: 'XX-ROG', nickname: null, os_type: 'win32', status: 'online', running: null, completed_today: 0, last_seen: null },
];
const activity = (frameAgeMs: number | null) => ({
  current: { id: 't1', title: '发布视频到抖音', status: 'running', steps_total: 5, current_step: 3, started_at: new Date().toISOString(), finished_at: null, failed_step: null, error_code: null },
  steps: [
    { step_index: 0, title: '打开抖音', status: 'done', screenshot_url: null },
    { step_index: 1, title: '选择视频', status: 'done', screenshot_url: null },
    { step_index: 2, title: '填写文案', status: 'done', screenshot_url: null },
    { step_index: 3, title: '设置可见范围', status: 'doing', screenshot_url: null },
    { step_index: 4, title: '点击发布', status: 'pending', screenshot_url: null },
  ],
  history: [], frame_age_ms: frameAgeMs,
});
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=', 'base64');
test.beforeEach(async ({ page }) => {
  await page.route('**/api/workers', (r) => r.fulfill({ json: { success: true, data: workers } }));
  await page.route('**/api/workers/a1/live', (r) => r.fulfill({ contentType: 'image/jpeg', body: JPEG }));
});
// 0920 三改：右侧日历 → 按部门分组的 table（主理人：「我觉得一个 table 的形式会比较好，
// 每个部门从早到晚是怎么排的，以 table 的形式去分；页面的高度是定的就这一页，
// 里面可以加一个上下滑杆」）
test('工作机页一屏一台：芯片切机，左实时画面右部门分组任务表', async ({ page }) => {
  await page.goto('/dashboard/workers');
  await expect(page.getByText('小龙虾').first()).toBeVisible();
  await expect(page.getByTestId('device-chip')).toHaveCount(2);
  await expect(page.getByTestId('dept-task-table')).toHaveCount(1);
  await expect(page.getByRole('img', { name: '实时画面' })).toHaveAttribute('src', /\/api\/workers\/a1\/live/);
  await expect(page.getByText(/正在跑：发布视频到抖音/)).toBeVisible();
  await expect(page.getByText(/第 3\/5 步/)).toBeVisible();
  // 表格容器高度钉死，滚动发生在表格内部而不是整页
  const box = page.getByTestId('table-scroll');
  const fixed = await box.evaluate((el) => el.getBoundingClientRect().height < 900);
  expect(fixed).toBe(true);
  // 日历与旧表格都不该再出现
  await expect(page.getByTestId('day-calendar')).toHaveCount(0);
  await expect(page.getByTestId('device-task-table')).toHaveCount(0);
  await expect(page.getByTestId('schedule-gantt')).toHaveCount(0);
});

test('排了活的机子按部门分组，组内从早到晚，同时段的标出并行', async ({ page }) => {
  // 小龙虾机：客服 10:00-20:00 是常驻轮询，19:00 那条朋友圈发布落在它区间里 —— 真并行。
  // （触达是一单一行的前台操作，同一时刻只有一个，本来就不该互相并行）
  await page.route('**/api/workers', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: [
          { id: '4c6c15fc-0b2f-479f-a32f-98ca33aaed1d', agent_id: 'ag3', hostname: 'MAA-AN00', nickname: null,
            os_type: 'android', status: 'online', running: null, completed_today: 0, last_seen: null },
        ],
      },
    }),
  );
  await page.goto('/dashboard/workers');
  await expect(page.getByText('小龙虾机').first()).toBeVisible();
  expect(await page.getByTestId('dept-head').count()).toBeGreaterThan(1);
  await expect(page.getByTestId('task-row').first()).toBeVisible();
  expect(await page.getByTestId('parallel-badge').count()).toBeGreaterThan(0);
  await expect(page.getByText(/同时在跑：/).first()).toBeVisible();
  // 高度钉死在表格上：活再多也只在这块里滚，页面本身不变长
  const box = await page.getByTestId('table-scroll').evaluate((el) => ({
    clientH: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(box.clientH).toBeLessThanOrEqual(620);
  expect(box.overflowY).toBe('auto');
});

test('活铺满一天时表格里真的出现滑杆，页面本身不变长', async ({ page }) => {
  // 金诺机：样例照真机实测的量铺，当天二十多件，内容必定超出 620px
  await page.route('**/api/workers', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: [
          { id: '8e802deb-247d-4346-8028-03c265959431', agent_id: 'ag1', hostname: 'MAA-AN00', nickname: null,
            os_type: 'android', status: 'online', running: null, completed_today: 0, last_seen: null },
        ],
      },
    }),
  );
  await page.goto('/dashboard/workers');
  await expect(page.getByText('金诺工作机').first()).toBeVisible();
  expect(await page.getByTestId('task-row').count()).toBeGreaterThan(15);
  // 触达一单一行，不再是那条压成一整天的「今日额度」
  expect(await page.getByText(/触达 · 单#/).count()).toBeGreaterThan(10);
  await expect(page.getByText(/今日额度/)).toHaveCount(0);
  const m = await page.getByTestId('table-scroll').evaluate((el) => ({ c: el.clientHeight, s: el.scrollHeight }));
  expect(m.s).toBeGreaterThan(m.c); // 滑杆真的出现
  const pageGrew = await page.evaluate(() => document.body.scrollHeight > window.innerHeight + 40);
  expect(pageGrew).toBe(false); // 页面本身没被撑长
});
test('详情页：3 个 ✅ 1 个 ▶️，画面正常无"画面不可用"', async ({ page }) => {
  await page.route('**/api/workers/a1/activity', (r) => r.fulfill({ json: { success: true, data: activity(500) } }));
  await page.goto('/dashboard/workers/a1');
  await expect(page.getByText('发布视频到抖音')).toBeVisible();
  await expect(page.locator('li', { hasText: '打开抖音' })).toContainText('✅');
  await expect(page.locator('li', { hasText: '设置可见范围' })).toContainText('▶️');
  await expect(page.locator('li', { hasText: '点击发布' })).toContainText('⬜');
  await expect(page.getByRole('img', { name: '实时画面' })).toBeVisible();
  await expect(page.getByText('画面不可用')).toHaveCount(0);
});
test('帧龄超 15 秒显示"画面不可用"', async ({ page }) => {
  await page.route('**/api/workers/a1/activity', (r) => r.fulfill({ json: { success: true, data: activity(20_000) } }));
  await page.goto('/dashboard/workers/a1');
  await expect(page.getByText('画面不可用')).toBeVisible();
});
