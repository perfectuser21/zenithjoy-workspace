/**
 * 客户管理后台 E2E — Line 10 Golden Path（windows_cloud / 干净 VM Playwright）
 *
 * 4 区用户路径（管理员真实操作）：
 *   1. 打开「客户管理」页 → 公司列表 + 4 区可见            01-customers-page.png
 *   2. 设公司名 → 列表/详情显示新名                        02-company-named.png
 *   3. 建 3 子账号(1 service_agent) → 列表 3 行 + role 标签  03-accounts.png
 *   4. 绑 1 客服到 1 PC → 「客服 @ PC ● 在线/离线」行        04-bound.png
 *   5. 看诊断 → 模块矩阵表格（或空态文案）                  05-diagnosis.png
 *
 * 所有后端端点用 page.route stub（干净 VM 无后端）；维护内存态让建/绑后 GET 反映变化。
 * 超管身份由 build 注入 VITE_SKIP_AUTH=true + VITE_SUPER_ADMIN_EMAILS（见 e2e-verify.ps1）。
 */
import { test, expect, type Page } from '@playwright/test';

const TID = '11111111-1111-1111-1111-111111111111';

interface Acct {
  account_id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: string;
}
interface Binding {
  binding_id: string;
  account_id: string;
  account_email: string;
  machine_id: string;
  hostname: string | null;
  online: boolean;
  bound_at: string;
}

async function stubBackend(page: Page) {
  let companyName = 'Personal-old@zj.test';
  const accounts: Acct[] = [];
  const bindings: Binding[] = [];
  let seq = 0;

  // 公司列表
  await page.route('**/api/admin/customers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [{ tenant_id: TID, email: 'cust@zj.test', name: companyName }],
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

  // 子账号 GET/POST
  await page.route(`**/api/tenant/${TID}/accounts`, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const acc: Acct = {
        account_id: `acc-${++seq}`,
        email: body.email,
        display_name: body.display_name,
        role: body.role,
        created_at: new Date(0).toISOString(),
      };
      accounts.push(acc);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, data: acc }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: accounts, total: accounts.length, quota: { used: accounts.length, limit: 5 } }),
    });
  });

  // 绑定 POST
  await page.route(`**/api/tenant/${TID}/service-agents/*/bind-device`, async (route) => {
    const req = route.request();
    const accountId = req.url().split('/service-agents/')[1].split('/bind-device')[0];
    const body = JSON.parse(req.postData() || '{}');
    const acc = accounts.find((a) => a.account_id === accountId);
    bindings.push({
      binding_id: `b-${++seq}`,
      account_id: accountId,
      account_email: acc?.email ?? 'svc@zj.test',
      machine_id: body.machine_id,
      hostname: 'PC-A',
      online: true,
      bound_at: new Date(0).toISOString(),
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { binding_id: `b-${seq}`, account_id: accountId, machine_id: body.machine_id } }),
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

test('客户管理后台 4 区 Golden Path + 5 截图', async ({ page }) => {
  await stubBackend(page);

  // ── Step 1：打开客户管理页，4 区可见 ──
  await page.goto('/admin/customers');
  await expect(page.getByTestId('customer-admin-page')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('region-company')).toBeVisible();
  await expect(page.getByTestId('region-accounts')).toBeVisible();
  await expect(page.getByTestId('region-bindings')).toBeVisible();
  await expect(page.getByTestId('region-diagnosis')).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/01-customers-page.png', fullPage: true });

  // ── Step 2：设公司名 ──
  await page.getByTestId('company-name-input').fill('晨悦传媒');
  await page.getByTestId('company-name-save').click();
  await expect(page.getByTestId('company-name-display')).toContainText('晨悦传媒');
  await page.screenshot({ path: 'e2e/screenshots/02-company-named.png', fullPage: true });

  // ── Step 3：建 3 子账号（1 service_agent） ──
  const newAccounts = [
    { email: 'admin@cust.test', name: '管理员', role: 'admin' },
    { email: 'op@cust.test', name: '运营', role: 'operator' },
    { email: 'svc@cust.test', name: '客服', role: 'service_agent' },
  ];
  for (const a of newAccounts) {
    await page.getByTestId('account-email').fill(a.email);
    await page.getByTestId('account-display').fill(a.name);
    await page.getByTestId('account-role').selectOption(a.role);
    await page.getByTestId('account-add').click();
    await expect(page.getByTestId('account-row').filter({ hasText: a.email })).toBeVisible();
  }
  await expect(page.getByTestId('account-row')).toHaveCount(3);
  await expect(page.getByTestId('account-role-tag').filter({ hasText: 'service_agent' })).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/03-accounts.png', fullPage: true });

  // ── Step 4：绑 1 客服到 1 PC ──
  await page.getByTestId('bind-account-select').selectOption({ label: 'svc@cust.test' });
  await page.getByTestId('bind-machine-input').fill('PC-001');
  await page.getByTestId('bind-submit').click();
  await expect(page.getByTestId('binding-row')).toHaveCount(1);
  await expect(page.getByTestId('binding-row').first()).toContainText('PC-001');
  await expect(page.getByTestId('binding-online').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/04-bound.png', fullPage: true });

  // ── Step 5：看诊断 ──
  await expect(page.getByTestId('diagnosis-table')).toBeVisible();
  await expect(page.getByTestId('diagnosis-row').first()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/05-diagnosis.png', fullPage: true });
});
