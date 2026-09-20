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
// 0920 二改：每台一张表往下堆 → 一屏只看一台（主理人：「左边一个手机，右边是固定的窗口
// 高度，页面不能随任务变多越来越长；要的是类似 Calendar 的从上到下时间分割」）
test('工作机页一屏一台：芯片切机，左实时画面右纵向日历', async ({ page }) => {
  await page.goto('/dashboard/workers');
  await expect(page.getByText('小龙虾')).toBeVisible();
  await expect(page.getByTestId('device-chip')).toHaveCount(2);
  // 同时只有一张日历，左边挂着这台机的实时画面
  await expect(page.getByTestId('day-calendar')).toHaveCount(1);
  await expect(page.getByRole('img', { name: '实时画面' })).toHaveAttribute('src', /\/api\/workers\/a1\/live/);
  await expect(page.getByText(/正在跑：发布视频到抖音/)).toBeVisible();
  await expect(page.getByText(/第 3\/5 步/)).toBeVisible();
  // 整点刻度画满一天，日历自己滚不撑长页面
  await expect(page.getByTestId('hour-tick')).toHaveCount(24);
  const box = page.getByTestId('calendar-scroll');
  const scrollable = await box.evaluate((el) => el.scrollHeight > el.clientHeight + 10);
  expect(scrollable).toBe(true);
  // 旧的表格与甘特都不该再出现
  await expect(page.getByTestId('device-task-table')).toHaveCount(0);
  await expect(page.getByTestId('schedule-gantt')).toHaveCount(0);
});

test('排了活的机子把当天的活画成块，同时段的并排分列', async ({ page }) => {
  // 用样例排程里真实存在的 agent_id，才能拿到当天的活
  await page.route('**/api/workers', (r) =>
    r.fulfill({
      json: {
        success: true,
        data: [
          { id: '657dfabc-802c-478d-9de3-c05b7db847df', agent_id: 'ag3', hostname: 'MAA-AN00', nickname: null,
            os_type: 'android', status: 'online', running: null, completed_today: 0, last_seen: null },
        ],
      },
    }),
  );
  await page.goto('/dashboard/workers');
  await expect(page.getByText('悦升工作机')).toBeVisible();
  await expect(page.getByTestId('cal-block').first()).toBeVisible();
  await expect(page.getByText('触达 · 私信今日额度').first()).toBeVisible();
  // 触达跑一整天，中间插发布 → 至少有一块不是满宽
  const widths = await page.getByTestId('cal-block').evaluateAll((els) => els.map((e) => e.style.width));
  expect(widths.some((w) => w !== '100%')).toBe(true);
  // 今天有「现在」这条线
  await expect(page.getByTestId('now-line')).toBeVisible();
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
