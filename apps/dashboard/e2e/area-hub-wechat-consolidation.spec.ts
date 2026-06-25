/**
 * area-hub-wechat-consolidation.spec.ts — 私域客服区整合成 5 卡（2026-06-25）E2E
 *
 * 目标环境 windows_cloud（GHA windows-latest，VITE_SKIP_AUTH=true 起 dev/preview）。
 * 打开 /area/wechat 总览页 → 看到正好 5 张下钻卡：客户好友表 / 我的客服机 / 客服工作汇总 /
 * 话术知识库 / 下载客户机；且不再有「客服日报」独立卡；孤儿路由 /wechat/per-cs-config 不可达（落未知区域）。
 *
 * 运行：npx playwright test e2e/area-hub-wechat-consolidation.spec.ts（cwd=apps/dashboard）
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

const BASE_URL = process.env.E2E_BASE_URL || process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = path.join('screenshots', 'area-hub-consolidation');

test('私域客服区总览：正好 5 张卡，无「客服日报」独立卡', async ({ page }) => {
  // auth 走未登录免跳转（AreaHubPage 是纯前端配置驱动，无后端依赖）
  await page.route('**/api/auth/**', (r) =>
    r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }),
  );

  await page.goto(`${BASE_URL}/area/wechat`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(SHOTS, '01-wechat-hub-5-cards.png'), fullPage: true });

  // 主内容区标题 = 私域客服（scope 到 main，避开侧栏/顶栏同名元素）
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: '私域客服' })).toBeVisible();

  // 主内容区正好 5 张下钻卡（卡片是 <a href> 链接），且到对应路由
  const cards = main.locator('a[href]');
  await expect(cards).toHaveCount(5);
  for (const label of ['客户好友表', '我的客服机', '客服工作汇总', '话术知识库', '下载客户机']) {
    await expect(main.getByRole('link', { name: new RegExp(label) })).toBeVisible();
  }
  await expect(main.locator('a[href$="/wechat/crm"]')).toHaveCount(1);
  await expect(main.locator('a[href$="/wechat/setup"]')).toHaveCount(1);
  await expect(main.locator('a[href$="/wechat/cs-stats"]')).toHaveCount(1);
  await expect(main.locator('a[href$="/wechat/cs-config"]')).toHaveCount(1);
  await expect(main.locator('a[href$="/dashboard/agent"]')).toHaveCount(1);

  // 不再有「客服日报」独立卡（已并进客服工作汇总历史 Tab）
  await expect(main.getByRole('link', { name: /客服日报/ })).toHaveCount(0);
  await expect(main.locator('a[href*="cs-daily-report"]')).toHaveCount(0);
});
