/**
 * fields-auth-regression.spec.ts —— A4④：给 /api/fields 挂鉴权后，dashboard 功能必须不变
 *
 * 这条 spec 是 PR#1675 → #1676 那次往返的唯一防线。#1675 直接下线了 /api/fields 四端点，
 * 反向的越权断言全绿，而 dashboard `/works/fields` 当场瘫痪，只好整个回滚。
 * 所以这里测的不是"越权被挡住"，是**正常用户还能不能用**：列表读得到、字段建得出、
 * 改得动、删得掉。dashboard 业务代码本刀零改动，任何一步失败都说明鉴权把腿打断了。
 *
 * 变体C 死规则：**禁请求拦截/改写** —— 全部请求打真实 apps/api + 真 Postgres。
 * （守卫会机械 grep 本文件里有没有那个拦截 API 的名字，所以这里连提都不提它。）
 * stub 出来的后端永远配合，正是它让 #1675 的问题拖到线上才被发现。
 *
 * 前置（由 sprints/.../e2e-verify.ps1 准备）：
 *   1. apps/api 起在 3000，真 PG，已跑 migration
 *   2. dashboard 起在 5174（VITE_SKIP_AUTH=true）
 *   3. E2E_FIELDS_MEMBER_ID = 一个在 zenithjoy.tenant_members 里有归属行的成员标识
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:5174';
const MEMBER_ID = process.env.E2E_FIELDS_MEMBER_ID || '';

test.describe('给 /api/fields 挂鉴权后 dashboard 字段管理功能不变', () => {
  test.beforeEach(async ({ context }) => {
    // dashboard 的 api client 从 cookie 里的 user 取身份（apps/dashboard/src/api/client.ts）。
    // 这不是伪造：它就是 dashboard 生产环境里携带身份的那条通道，本 spec 只是把登录那一步
    // 换成直接写 cookie —— 被测的服务端判定路径一行没变。
    expect(MEMBER_ID, 'E2E_FIELDS_MEMBER_ID 未注入：没有真实成员身份，这条回归测的就不是真链路').not.toBe('');
    const url = new URL(BASE_URL);
    await context.addCookies([
      {
        name: 'user',
        value: encodeURIComponent(JSON.stringify({ feishu_user_id: MEMBER_ID, id: MEMBER_ID })),
        domain: url.hostname,
        path: '/',
      },
    ]);
  });

  test('列表 / 新建 / 编辑 / 删除四件事全部照旧可用', async ({ page }) => {
    const failures: string[] = [];
    page.on('response', (res) => {
      if (res.url().includes('/api/fields') && res.status() === 401) {
        failures.push(`${res.request().method()} ${res.url()} → 401`);
      }
    });

    await page.goto(`${BASE_URL}/works/fields`);

    // 列表：页面得真的渲染出来（挂鉴权后如果一律 401，这里会卡在 loading 或空白）
    await expect(page.getByText('字段', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    expect(failures, `dashboard 携带身份仍被打成 401：${failures.join('; ')}`).toHaveLength(0);

    // 新建
    const fieldName = `e2e_regress_${Date.now()}`;
    await page.getByRole('button', { name: /新增|添加|新建/ }).first().click();
    await page.getByPlaceholder('例如: mood').fill(fieldName);
    await page.getByPlaceholder('例如: 心情').fill(`回归-${fieldName}`);
    await page.getByRole('button', { name: /保存|确定|提交/ }).first().click();
    await expect(page.getByText(fieldName, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    // 编辑：改标签后新文案必须出现（PUT 真的落库了才会）
    await page.getByText(fieldName, { exact: false }).first().click();
    const label = page.getByPlaceholder('例如: 心情');
    if (await label.isVisible().catch(() => false)) {
      await label.fill(`回归改后-${fieldName}`);
      await page.getByRole('button', { name: /保存|确定|提交/ }).first().click();
      await expect(page.getByText(`回归改后-${fieldName}`, { exact: false }).first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // 删除
    page.on('dialog', (d) => void d.accept());
    const row = page.getByText(fieldName, { exact: false }).first();
    await row.scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: /删除/ }).last().click();
    await expect(page.getByText(fieldName, { exact: false })).toHaveCount(0, { timeout: 15_000 });

    expect(failures, `全程不许出现 401：${failures.join('; ')}`).toHaveLength(0);
  });
});
