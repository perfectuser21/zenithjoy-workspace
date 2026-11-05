import { test, expect } from '@playwright/test';

test('旧采集已停用，历史任务可查看且不会发起新采集', async ({ page }) => {
  await page.route('**/api/acquisition/collect-tasks', route => route.fulfill({ json: {
    success: true, data: { tasks: [{ id: 'historical-task', keywords: ['历史词'], status: 'done', video_count: 2,
      lead_count_raw: 1, created_at: null, cancel_phase: null, cooldown_remaining_seconds: 0 }] },
  } }));
  let newTasks = 0;
  await page.route('**/api/acquisition/collect/start', route => { newTasks++; return route.abort(); });
  await page.goto('/area/acquisition/tasks');
  await expect(page.getByText('旧版获客已停用，可继续查看历史任务的视频和评论明细。')).toBeVisible();
  await expect(page.getByText('历史词')).toBeVisible();
  await expect(page.getByRole('link', { name: '查看详情' })).toHaveAttribute('href', '/area/acquisition/tasks/historical-task');
  await expect(page.getByRole('button', { name: '开始采集' })).toHaveCount(0);
  expect(newTasks).toBe(0);
});
