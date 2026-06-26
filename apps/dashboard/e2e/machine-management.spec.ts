/**
 * machine-management.spec.ts — Line02 机器管理页 Dashboard E2E（windows_cloud / 干净 VM）
 *
 * windows_cloud 限界（对齐 contract 接缝 #2）：干净 VM 无真后端 → 用 page.route stub
 * 所有 /api/agent/machines* + /api/auth/**，只验 UI 渲染/交互/文案（列表/命名标主副/详情/加号），
 * 不验 cookie→:5200 租户接缝（真后端 leg 另验）。后端逻辑由 mode-A 真 API+真库 BEHAVIOR 覆盖。
 *
 * 截图存 apps/dashboard/screenshots/<step>.png，由 e2e-verify.ps1 归档到 SPRINT_DIR/screenshots/ 供视觉自验。
 */
import { test, expect, type Page } from '@playwright/test';

// ── stub 数据（可变，加号后追加 session）──
const machines = [
  {
    id: 'm-alpha',
    nickname: null as string | null,
    hostname: 'pc-alpha',
    status: 'online',
    version: '1.0.70',
    machine_role: 'main',
    douyin_account_count: 1,
  },
  {
    id: 'm-beta',
    nickname: null as string | null,
    hostname: 'pc-beta',
    status: 'offline',
    version: '1.0.70',
    machine_role: 'sub',
    douyin_account_count: 0,
  },
];

const sessionsByMachine: Record<string, any[]> = {
  'm-alpha': [
    { account_label: 'main', role: 'main', status: 'active', valid: true, account_nickname: '主号', bound_at: null },
  ],
  'm-beta': [],
};

function ok(data: unknown) {
  return JSON.stringify({ success: true, data, timestamp: new Date().toISOString() });
}

async function stubAll(page: Page) {
  // 已登录态（避免 better-auth 噪声；route 设为 requireAuth:false 也可直达）
  await page.route('**/api/auth/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'op-1', email: 'op@zenithjoy.test', name: '运营', emailVerified: true },
        session: { id: 's-1', userId: 'op-1', expiresAt: '2027-01-01T00:00:00Z' },
      }),
    });
  });

  // 所有 machines 接口走一个 handler，按 method + url 分支
  await page.route('**/api/agent/machines**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname; // /api/agent/machines[/:id[/add-douyin]]
    const tail = path.replace(/.*\/api\/agent\/machines/, ''); // '' | '/:id' | '/:id/add-douyin'

    // POST /:id/add-douyin
    if (method === 'POST' && tail.endsWith('/add-douyin')) {
      const id = tail.split('/')[1];
      const body = req.postDataJSON() || {};
      // 回写后该机器多一个 active 小号（模拟 fake-agent qr-bind-result）
      sessionsByMachine[id] = sessionsByMachine[id] || [];
      sessionsByMachine[id].push({
        account_label: body.account_label,
        role: 'burner',
        status: 'active',
        valid: true,
        account_nickname: body.account_label,
        bound_at: null,
      });
      const m = machines.find((x) => x.id === id);
      if (m) m.douyin_account_count += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: ok({ task_id: 't-1' }) });
      return;
    }

    // PUT /:id
    if (method === 'PUT' && tail) {
      const id = tail.slice(1);
      const body = req.postDataJSON() || {};
      const m = machines.find((x) => x.id === id);
      if (m) {
        if (typeof body.nickname === 'string') m.nickname = body.nickname;
        if (body.machine_role) m.machine_role = body.machine_role;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: ok({ id, nickname: body.nickname ?? null, machine_role: body.machine_role ?? m?.machine_role }),
      });
      return;
    }

    // GET /:id（详情）
    if (method === 'GET' && tail) {
      const id = tail.slice(1);
      const m = machines.find((x) => x.id === id);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: ok({ machine: m, sessions: sessionsByMachine[id] || [] }),
      });
      return;
    }

    // GET 列表
    await route.fulfill({ status: 200, contentType: 'application/json', body: ok({ machines }) });
  });
}

test('运营走完机器管理 Golden Path（列表→命名标主副→详情→加号）', async ({ page }) => {
  await stubAll(page);

  // ── Step 1: 列表渲染 ──
  await page.goto('/dashboard/machines');
  await expect(page.getByTestId('machine-row')).toHaveCount(2);
  // 主机器 / 副机器 文案
  await expect(page.getByText('主机器').first()).toBeVisible();
  await expect(page.getByText('副机器').first()).toBeVisible();
  // 号数列
  await expect(page.getByTestId('machine-account-count').first()).toContainText('抖音号');
  // 离线机器标红（文案「离线」+ 红色 class）
  const offlineStatus = page.getByTestId('machine-status').filter({ hasText: '离线' });
  await expect(offlineStatus).toHaveCount(1);
  await expect(offlineStatus).toHaveClass(/text-red-500/);
  await page.screenshot({ path: 'screenshots/01-initial.png', fullPage: true });

  // ── Step 2: 命名 + 标主机器 + 保存 → 成功提示 + 列表名称更新 ──
  await page.getByTestId('machine-nickname-input').first().fill('主力机A');
  await page.getByTestId('machine-role-select').first().selectOption('main');
  await page.getByTestId('machine-save-btn').first().click();
  await expect(page.getByTestId('machine-toast')).toHaveText('保存成功');
  await expect(page.getByText('主力机A').first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/02-action.png', fullPage: true });

  // ── Step 3: 点进详情看抖音号（主号 有效）→ 添加抖音号 → 新号出现 ──
  await page.getByTestId('machine-detail-btn').first().click();
  await expect(page.getByTestId('machine-detail')).toBeVisible();
  await expect(page.getByTestId('douyin-session-row')).toHaveCount(1);
  await expect(page.getByText('主号').first()).toBeVisible();
  await expect(page.getByText('有效').first()).toBeVisible();

  await page.getByTestId('add-douyin-input').fill('小号A');
  await page.getByTestId('add-douyin-btn').click();
  // 派单回写后详情刷新，新号出现（共 2 行）
  await expect(page.getByTestId('douyin-session-row')).toHaveCount(2);
  await expect(page.getByText('小号A').first()).toBeVisible();
  await page.screenshot({ path: 'screenshots/03-result.png', fullPage: true });
});
