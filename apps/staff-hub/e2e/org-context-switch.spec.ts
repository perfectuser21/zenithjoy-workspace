/**
 * org-context-switch.spec.ts —— 多组织切换第一刀 真浏览器全链（windows_cloud）
 *
 * 变体C 死规则：**禁请求拦截/改写** —— 全部请求打真实 apps/api + 真 Postgres。
 * 认证走真会话 cookie（由 e2e-org-switch-run.ps1 先调 /api/staff/feishu-login 拿到再注入到浏览器上下文），
 * 一个身份头都不拼——org 解析的服务端闸压根不读请求头。**不走 VITE_SKIP_AUTH**：本刀要验的正是
 * AuthContext 会话恢复 → 拉归属企业 → 切换器渲染的真链路，SKIP_AUTH 会把它顶成单企业 mock。
 *
 * 两个 test 用 ASCII 标签分派（一个 ps1 step 里 --grep @org- 全跑）：
 *   @org-switch-flow        dave 归属两家 → 未选阻断选择 → 选定A（顶部标识变A）→ 切到B（标识变B）→ 截图 01/02/03
 *   @org-single-transparent alice 单企业 → 透明进入、顶部显当前企业、不出现切换下拉（A8 零回归）→ 截图 04
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5178';
const DAVE_COOKIE = process.env.E2E_ORG_DAVE_COOKIE || '';
const ALICE_COOKIE = process.env.E2E_ORG_ALICE_COOKIE || '';
const SPRINT_DIR = 'sprints/08221800-org-context-switch-core';
const SHOT_DIR = resolve(process.cwd(), '..', '..', SPRINT_DIR, 'screenshots');
const shot = (name: string) => resolve(SHOT_DIR, name);

mkdirSync(SHOT_DIR, { recursive: true });

/** 把 `name=value; ...` 形态的 Set-Cookie 串注入到浏览器上下文（只取第一对 name=value） */
async function addSessionCookie(context: BrowserContext, cookieStr: string) {
  expect(cookieStr, '缺会话 cookie（ps1 未注入 E2E_ORG_*_COOKIE）').not.toBe('');
  const first = cookieStr.split(';')[0].trim();
  const eq = first.indexOf('=');
  const name = first.slice(0, eq);
  const value = first.slice(eq + 1);
  await context.addCookies([{ name, value, url: BASE_URL }]);
}

test.describe('多组织切换 真浏览器', () => {
  test('@org-switch-flow dave 未选阻断→选定A→切到B', async ({ browser }) => {
    const context = await browser.newContext();
    await addSessionCookie(context, DAVE_COOKIE);
    const page = await context.newPage();

    // 1) 归属 ≥2 家且未选 → 阻断式选择界面（未选前进不去数据页）
    await page.goto('/');
    const selection = page.getByTestId('org-selection-required');
    await expect(selection, 'dave 归属两家未选，应出现阻断式企业选择').toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: shot('01-org-selection.png'), fullPage: true });

    // 阻断界面里两个企业选项，取第一个作为"企业A"，记住其文案
    const options = selection.locator('[data-testid^="org-option-"]');
    await expect(options).toHaveCount(2);
    const orgAName = (await options.nth(0).innerText()).trim();
    const orgBName = (await options.nth(1).innerText()).trim();
    expect(orgAName).not.toBe('');

    // 2) 选定企业A → 阻断消失 + 顶部「当前企业」标识含 A 的名字
    await options.nth(0).click();
    const label = page.getByTestId('current-org-label');
    await expect(label).toBeVisible({ timeout: 20_000 });
    await expect(selection).toHaveCount(0); // 选完不再阻断
    await expect(label).toContainText(orgAName.split('（')[0].trim());
    await page.screenshot({ path: shot('02-org-selected-A.png'), fullPage: true });

    // 3) 打开切换下拉 → 切到企业B → 顶部标识变为 B 的名字（旧企业标识即刻切走）
    await page.getByTestId('org-switcher-trigger').click();
    const menu = page.getByTestId('org-switcher-menu');
    await expect(menu).toBeVisible();
    // 菜单里选"另一家"（B）：用 orgBName 前缀匹配
    const bPrefix = orgBName.split('（')[0].trim();
    await menu.locator('[data-testid^="org-option-"]', { hasText: bPrefix }).first().click();
    await expect(label).toContainText(bPrefix, { timeout: 20_000 });
    await page.screenshot({ path: shot('03-org-switched-B.png'), fullPage: true });

    await context.close();
  });

  test('@org-single-transparent alice 单企业透明进入不弹选择器（A8 零回归）', async ({ browser }) => {
    const context = await browser.newContext();
    await addSessionCookie(context, ALICE_COOKIE);
    const page = await context.newPage();

    await page.goto('/');
    // 单企业：不出现阻断选择，直接进；顶部显当前企业标识，且**没有**切换下拉触发器
    await expect(page.getByTestId('org-selection-required')).toHaveCount(0);
    const label = page.getByTestId('current-org-label');
    await expect(label).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('org-switcher-trigger')).toHaveCount(0);
    await page.screenshot({ path: shot('04-org-single-transparent.png'), fullPage: true });

    await context.close();
  });
});
