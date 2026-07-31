/**
 * Staff Hub 验收模块 E2E —— 真实后端，禁用 Playwright 请求拦截 API
 *
 * 验收模块决策 fc7b5dc0：Staff Hub 直连 Brain 内网 acceptance 端点（无 stub/mock 层）。
 * Golden Path 三步 + 截图：
 *   01-acceptance-list.png     打开总验收列表页 /acceptance
 *   02-acceptance-detail.png   若列表有待验收单，点开详情页，断言判定矩阵渲染
 *   03-acceptance-history.png  打开验收历史页 /acceptance-history
 *   04-acceptance-history-searched.png 按 gp_id 查询后的结果
 *
 * 变体C 死规则：所有断言打真实 apps/api（无 stub），因此
 *   - Brain 在 CI/沙盒大概率不可达 → 三个端点都会落到 availability=degraded 的降级分支，
 *     属合法路径，不是缺陷——本文件用 locatorA.or(locatorB) 断言"降级提示或正常内容二选一"，
 *     不硬编码某个具体状态；
 *   - 若某次 CI 沙盒恰好能连到 Brain 且确有待验收单，详情页断言分支也要能通过（同样用 or）。
 *
 * 注意：本文件正文与注释都不得出现 Playwright 拦截 API 的字面调用串 —— workflow guard
 * 用纯字符串匹配把关，注释里提一嘴也会误伤。
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots');

function shot(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

test.describe('Staff Hub 验收模块', () => {
  test('总验收列表页渲染，Brain 可达显示待验收单列表，不可达显示降级提示（二选一）', async ({ page }) => {
    await page.goto('/acceptance');
    await expect(page.getByTestId('acceptance-page')).toBeVisible();

    // Brain 不可达 → degraded 提示；可达但暂无待验收单 → empty 提示；两条路径均视为
    // "页面正常渲染、没有白屏/崩溃"的合法证明，不断言具体是哪一种
    const degraded = page.getByTestId('acceptance-degraded-banner');
    const empty = page.getByTestId('acceptance-empty');
    const runList = page.locator('[data-testid^="acceptance-run-"]').first();
    await expect(degraded.or(empty).or(runList)).toBeVisible();

    await page.screenshot({ path: shot('01-acceptance-list.png'), fullPage: true });
  });

  test('若存在待验收单，点开详情页可看到判定矩阵；否则该分支视为合法跳过', async ({ page }) => {
    await page.goto('/acceptance');
    await expect(page.getByTestId('acceptance-page')).toBeVisible();

    const runItems = page.locator('[data-testid^="acceptance-run-"]');
    const count = await runItems.count();
    if (count === 0) {
      // CI 沙盒够不着 Brain 时列表恒为空，没有可点入的验收单——这是本模块的合法降级路径，
      // 不是测试失败；矩阵渲染的正向断言由本文件内 workflow guard 保留在代码里供未来
      // Brain 可达的环境（如本地开发/预发）真跑到。
      return;
    }

    await runItems.first().click();
    await expect(page).toHaveURL(/\/acceptance\/[^/]+$/);

    // 进详情页后同样可能因 Brain 中途不可达而降级；矩阵表格与降级提示二选一
    const matrix = page.getByTestId('acceptance-matrix');
    const detailDegraded = page.getByTestId('acceptance-degraded-banner');
    await expect(matrix.or(detailDegraded)).toBeVisible();

    await page.screenshot({ path: shot('02-acceptance-detail.png'), fullPage: true });
  });

  test('验收历史页可打开并按 gp_id 查询，Brain 不可达/无记录均有对应提示（二选一）', async ({ page }) => {
    await page.goto('/acceptance-history');
    await expect(page.getByTestId('acceptance-history-page')).toBeVisible();
    await expect(page.getByTestId('acceptance-history-gpid-input')).toBeVisible();

    await page.screenshot({ path: shot('03-acceptance-history.png'), fullPage: true });

    await page.getByTestId('acceptance-history-gpid-input').fill('gp-smoke-test');
    await page.getByTestId('acceptance-history-search').click();

    // Brain 不可达 → degraded 提示；可达但该 gp_id 无历史记录 → empty 提示——二选一，
    // 不硬编码具体是哪一种（本模块变体C 死规则）
    const degraded = page.getByTestId('acceptance-degraded-banner');
    const empty = page.getByTestId('acceptance-history-empty');
    await expect(degraded.or(empty)).toBeVisible();

    await page.screenshot({ path: shot('04-acceptance-history-searched.png'), fullPage: true });
  });
});
