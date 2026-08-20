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
 * 判据为什么落在**网络层 + 可数的 DOM 变化**，而不是"页面上出现我刚填的名字"：
 * 列表项显示的是 `field.display_label`，而 `zenithjoy.field_definitions` 表根本没有这一列
 * （既有不一致，`apps/api/tests/contract.test.ts` 里那句 NOTE 也写着"dashboard 期待
 * display_label / is_required — API 暂无这两个字段"）。拿它当判据只会红在一个与本刀无关的
 * 老问题上。四个动作的真实回执是 HTTP 方法与状态码，那才是"功能有没有被打断腿"的直接证据。
 *
 * 前置（由 sprints/.../e2e-verify.ps1 准备）：
 *   1. apps/api 起在 5200，真 PG，已跑 migration
 *   2. dashboard 起在 5174（VITE_SKIP_AUTH=true，VITE_API_BASE_URL 指向 apps/api）
 *   3. E2E_FIELDS_MEMBER_ID = 一个在 zenithjoy.tenant_members 里有归属行的成员标识
 */
import { test, expect, type Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:5174';
const MEMBER_ID = process.env.E2E_FIELDS_MEMBER_ID || '';

interface Call {
  method: string;
  status: number;
}

function watchFieldCalls(page: Page): Call[] {
  const calls: Call[] = [];
  page.on('response', (res) => {
    if (!res.url().includes('/api/fields')) return;
    calls.push({ method: res.request().method(), status: res.status() });
  });
  return calls;
}

const denied = (calls: Call[]) => calls.filter((c) => c.status === 401 || c.status === 403);
const okOf = (calls: Call[], method: string) =>
  calls.filter((c) => c.method === method && c.status >= 200 && c.status < 300);

test.describe('给 /api/fields 挂鉴权后 dashboard 字段管理功能不变', () => {
  test.beforeEach(async ({ context }) => {
    // dashboard 的 api client 从 cookie 里的 user 取身份（apps/dashboard/src/api/client.ts），
    // 再把它放进请求头。这不是伪造：那就是 dashboard 生产环境携带身份的通道，
    // 本 spec 只是把登录那一步换成直接写 cookie —— 被测的服务端判定路径一行没变。
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
    const calls = watchFieldCalls(page);
    page.on('dialog', (d) => void d.accept()); // 删除走 window.confirm

    // ── 列表 ──────────────────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/works/fields`);
    // 页面真的渲染出来了（挂鉴权后若一律 401，这里会一直停在 loading 转圈）
    await expect(page.getByRole('button', { name: /新增|添加|新建/ }).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(okOf(calls, 'GET').length, '列表 GET /api/fields 没有拿到 2xx').toBeGreaterThan(0);
    expect(denied(calls), `列表阶段被拒：${JSON.stringify(denied(calls))}`).toHaveLength(0);

    // 自定义字段行数（核心字段没有编辑/删除按钮，所以这个计数只数自定义的）
    const editButtons = page.getByTitle('编辑字段');
    const before = await editButtons.count();

    // ── 新建 ──────────────────────────────────────────────────────────────
    const fieldName = `e2e_regress_${Date.now()}`;
    await page.getByRole('button', { name: /新增|添加|新建/ }).first().click();
    await page.getByPlaceholder('例如: mood').fill(fieldName);
    await page.getByPlaceholder('例如: 心情').fill(`回归-${fieldName}`);
    await page.getByRole('button', { name: /保存|确定|提交/ }).first().click();

    await expect(editButtons).toHaveCount(before + 1, { timeout: 20_000 });
    expect(okOf(calls, 'POST').length, '新建 POST /api/fields 没有拿到 2xx').toBeGreaterThan(0);

    // ── 编辑（刚建的那一行排在最后）───────────────────────────────────────
    await editButtons.last().click();
    await page.getByPlaceholder('例如: 心情').fill(`回归改后-${fieldName}`);
    await page.getByRole('button', { name: /保存|确定|提交/ }).first().click();
    await expect
      .poll(() => okOf(calls, 'PUT').length, {
        message: '编辑 PUT /api/fields/:id 没有拿到 2xx',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);

    // ── 删除 ──────────────────────────────────────────────────────────────
    await page.getByTitle('删除字段').last().click();
    await expect(editButtons).toHaveCount(before, { timeout: 20_000 });
    expect(okOf(calls, 'DELETE').length, '删除 DELETE /api/fields/:id 没有拿到 2xx').toBeGreaterThan(0);

    // ── 全程不许出现 401/403 ──────────────────────────────────────────────
    expect(
      denied(calls),
      `dashboard 携带身份仍被拒绝，鉴权把功能打断腿了：${JSON.stringify(denied(calls))}`
    ).toHaveLength(0);
  });
});
