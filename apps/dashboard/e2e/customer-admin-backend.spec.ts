/**
 * 客户管理后台 E2E — Line 10 Golden Path（windows_cloud / 干净 VM Playwright）
 *
 * #816 合并去重后：账号模型统一到 better-auth user + tenant_members（废 tenant_sub_accounts）。
 * 用户路径（管理员真实操作）：
 *   1. 打开「客户管理」页 → 公司表格（name/成员数）+ 各区可见       01-customers-page.png
 *   2. 改公司名 → 表格该行显示新名                                  02-company-named.png
 *   3. ① 成员区：按 email 拉成员进公司 → 成员行出现                 03-members.png
 *   4. ② 绑 1 成员到 1 PC → 「成员 @ PC ● 在线/离线」行            04-bound.png
 *   5. ③ 看诊断 → 模块矩阵表格（或空态文案）                       05-diagnosis.png
 *
 * 所有后端端点用 page.route stub（干净 VM 无后端）；维护内存态让加/绑后 GET 反映变化。
 * 超管身份由 build 注入 VITE_SKIP_AUTH=true + VITE_SUPER_ADMIN_EMAILS（见 e2e-verify.ps1）。
 */
import { test, expect, type Page } from '@playwright/test';

const TID = '11111111-1111-1111-1111-111111111111';

interface Member {
  user_id: string;
  email: string;
  name: string;
  role: string;
  joined_at: string;
}
interface Binding {
  binding_id: string;
  member_user_id: string;
  member_email: string;
  machine_id: string;
  hostname: string | null;
  online: boolean;
  bound_at: string;
}

async function stubBackend(page: Page) {
  let companyName = 'Personal-old@zj.test';
  const members: Member[] = [];
  const bindings: Binding[] = [];
  let seq = 0;

  // 公司列表（含 name + member_count）
  await page.route('**/api/admin/customers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ tenant_id: TID, email: 'cust@zj.test', name: companyName, member_count: members.length, license_status: 'matrix' }],
        total: 1,
      }),
    });
  });

  // 诊断（module-health）
  await page.route('**/api/agent/module-health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: [
          {
            agent_id: 'agent-001',
            hostname: '客户机器A',
            module_status: {
              'line01-publish': { ok: true },
              'line04-wechat-cs': { ok: false, reason: '微信版本不支持' },
            },
            updated_at: '2026-06-22T09:00:00Z',
          },
        ],
      }),
    });
  });

  // 成员 GET/POST（POST 按 email 拉注册用户进公司）
  await page.route(`**/api/tenant/${TID}/members`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const mem: Member = {
        user_id: `usr-${++seq}`,
        email: body.email,
        name: body.email.split('@')[0],
        role: body.role || 'member',
        joined_at: new Date(0).toISOString(),
      };
      members.push(mem);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user_id: mem.user_id, email: mem.email, role: mem.role } }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: members, total: members.length }),
    });
  });

  // 绑定 POST（绑真实成员 :userId）
  await page.route(`**/api/tenant/${TID}/service-agents/*/bind-device`, async (route) => {
    const req = route.request();
    const memberUserId = req.url().split('/service-agents/')[1].split('/bind-device')[0];
    const body = JSON.parse(req.postData() || '{}');
    const mem = members.find((m) => m.user_id === memberUserId);
    bindings.push({
      binding_id: `b-${++seq}`,
      member_user_id: memberUserId,
      member_email: mem?.email ?? 'svc@zj.test',
      machine_id: body.machine_id,
      hostname: 'PC-A',
      online: true,
      bound_at: new Date(0).toISOString(),
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { binding_id: `b-${seq}`, member_user_id: memberUserId, machine_id: body.machine_id } }),
    });
  });

  // 绑定 GET
  await page.route(`**/api/tenant/${TID}/service-agents`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: bindings, total: bindings.length }),
    });
  });

  // 改公司名 PUT
  await page.route(`**/api/tenant/${TID}`, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() || '{}');
      companyName = body.name;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { tenant_id: TID, name: companyName } }) });
      return;
    }
    await route.fallback();
  });
}

test('客户管理后台 Golden Path + 5 截图（成员统一到注册用户）', async ({ page }) => {
  await stubBackend(page);

  // ── Step 1：打开客户管理页，各区可见 ──
  await page.goto('/admin/customers');
  await expect(page.getByTestId('customer-admin-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('region-companies')).toBeVisible();
  await expect(page.getByTestId('companies-table')).toBeVisible();
  await expect(page.getByTestId('region-members')).toBeVisible();
  await expect(page.getByTestId('region-bindings')).toBeVisible();
  await expect(page.getByTestId('region-diagnosis')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/01-customers-page.png', fullPage: true });

  // ── Step 2：改公司名 ──
  await page.getByTestId('company-row').first().click();
  await page.getByTestId('company-name-input').first().fill('晨悦传媒');
  await page.getByTestId('company-name-save').first().click();
  await expect(page.getByTestId('company-name').filter({ hasText: '晨悦传媒' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/02-company-named.png', fullPage: true });

  // ── Step 3：① 按 email 拉成员进公司 ──
  const newMembers = [
    { email: 'admin@cust.test', role: 'admin' },
    { email: 'svc@cust.test', role: 'member' },
  ];
  for (const m of newMembers) {
    await page.getByTestId('member-email-input').fill(m.email);
    await page.getByTestId('member-role-select').selectOption(m.role);
    await page.getByTestId('member-add').click();
    await expect(page.getByTestId('member-row').filter({ hasText: m.email })).toBeVisible();
  }
  await expect(page.getByTestId('member-row')).toHaveCount(2);
  await page.screenshot({ path: 'e2e/screenshots/03-members.png', fullPage: true });

  // ── Step 4：② 绑 1 成员到 1 PC ──
  await page.getByTestId('bind-member-select').selectOption({ label: 'svc@cust.test' });
  await page.getByTestId('bind-machine-input').fill('PC-001');
  await page.getByTestId('bind-submit').click();
  await expect(page.getByTestId('binding-row')).toHaveCount(1);
  await expect(page.getByTestId('binding-row').first()).toContainText('PC-001');
  await expect(page.getByTestId('binding-online').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/04-bound.png', fullPage: true });

  // ── Step 5：③ 看诊断 ──
  await expect(page.getByTestId('diagnosis-table')).toBeVisible();
  await expect(page.getByTestId('diagnosis-row').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/05-diagnosis.png', fullPage: true });
});
