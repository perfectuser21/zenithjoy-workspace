// 参考 spec（契约样板）— generator 复制/落地为 apps/dashboard/e2e/cs-work-stats.spec.ts。
// 约定与仓库一致：page.route 拦 /api/wechat/cs/stats 验渲染 + 今天/昨天切换 + 不串台 + 空卡 4 零。
// data-testid 契约（页面须实现）：
//   cs-stat-card（每客服一张，含 data-cs-wechat-id 属性）
//   cs-stat-received / cs-stat-reply / cs-stat-served / cs-stat-minutes（卡内 4 数）
//   cs-stats-tab-today / cs-stats-tab-yesterday（顶部切换）
import { test, expect } from '@playwright/test';

const TODAY = {
  ok: true,
  date: 'today',
  stats: [
    { cs_wechat_id: 'wxA', cs_name: '客服A', online: true, mode: 'real', received_count: 3, reply_count: 2, served_customers: 2, work_duration_minutes: 20 },
    { cs_wechat_id: 'wxB', cs_name: '客服B', online: false, mode: 'dryrun', received_count: 1, reply_count: 0, served_customers: 1, work_duration_minutes: 0 },
    { cs_wechat_id: 'wxC', cs_name: '客服C', online: true, mode: 'dryrun', received_count: 0, reply_count: 0, served_customers: 0, work_duration_minutes: 0 },
  ],
};
const YESTERDAY = {
  ok: true,
  date: 'yesterday',
  stats: [
    { cs_wechat_id: 'wxA', cs_name: '客服A', online: true, mode: 'real', received_count: 1, reply_count: 1, served_customers: 1, work_duration_minutes: 10 },
  ],
};

test('客服工作汇总：每客服一张卡 4 数 + 今天/昨天切换 + 不串台 + 空卡 4 零', async ({ page }) => {
  await page.route('**/api/wechat/cs/stats?**', async (route) => {
    const isYesterday = route.request().url().includes('date=yesterday');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(isYesterday ? YESTERDAY : TODAY) });
  });

  // 注：实际路由路径以 navigation.config.ts 落地为准（如 /wechat/cs-stats 或 /area/wechat/cs-stats）
  await page.goto('/wechat/cs-stats');
  await expect(page.locator('[data-testid="cs-stat-card"]')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/01-initial.png', fullPage: true });

  const cardA = page.locator('[data-testid="cs-stat-card"][data-cs-wechat-id="wxA"]');
  await expect(cardA.locator('[data-testid="cs-stat-received"]')).toHaveText('3');
  await expect(cardA.locator('[data-testid="cs-stat-reply"]')).toHaveText('2');
  await expect(cardA.locator('[data-testid="cs-stat-served"]')).toHaveText('2');
  await expect(cardA.locator('[data-testid="cs-stat-minutes"]')).toHaveText('20');

  // 不串台：A 卡内不出现 B 的接收数 1
  await expect(cardA.locator('[data-testid="cs-stat-received"]')).not.toHaveText('1');
  const cardB = page.locator('[data-testid="cs-stat-card"][data-cs-wechat-id="wxB"]');
  await expect(cardB.locator('[data-testid="cs-stat-received"]')).toHaveText('1');

  // 空卡（0 消息客服）显示 4 个 0
  const cardC = page.locator('[data-testid="cs-stat-card"][data-cs-wechat-id="wxC"]');
  for (const tid of ['cs-stat-received', 'cs-stat-reply', 'cs-stat-served', 'cs-stat-minutes']) {
    await expect(cardC.locator(`[data-testid="${tid}"]`)).toHaveText('0');
  }

  // 切「昨天」→ 重新请求 date=yesterday → A 卡 received 由 3 变 1
  await page.click('[data-testid="cs-stats-tab-yesterday"]');
  await page.screenshot({ path: 'test-results/02-action.png', fullPage: true });
  await expect(cardA.locator('[data-testid="cs-stat-received"]')).toHaveText('1');
  await expect(cardA.locator('[data-testid="cs-stat-reply"]')).toHaveText('1');
  await page.screenshot({ path: 'test-results/03-result.png', fullPage: true });
});
