/**
 * Machine Management E2E — /dashboard/machines 机器管理页
 *
 * 覆盖场景（契约三端点全 page.route stub，不依赖真后端）：
 *   test a: 列表渲染机器（hostname/nickname + 主/副标签 + online/offline + version + N 个号）
 *   test b: 点机器行进详情，显示该机器抖音号列表
 *   test c: 详情「添加抖音号」点击后派 qr-bind 单（复用 DouyinBurner qr-bind 逻辑），号出现
 *   test d: 重命名 + 设为主/副，PUT 返回新值后 UI 更新（持久化）
 *
 * VITE_SKIP_AUTH=true 跳鉴权（页面只 requireAuth，非 super-admin），无需 stub session。
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npm run dev:dashboard
 *   npm run -w apps/dashboard e2e -- agent-machines
 */
import { test, expect, type Page } from '@playwright/test';

interface Machine {
  id: string;
  agent_id: string;
  hostname: string;
  nickname: string | null;
  machine_role: 'main' | 'sub';
  status: 'online' | 'offline';
  version: string;
  last_seen: string;
  session_count: number;
}

const MACHINE_A: Machine = {
  id: 'uuid-aaa',
  agent_id: 'agent-aaa',
  hostname: 'DESKTOP-AAA',
  nickname: '主力机',
  machine_role: 'main',
  status: 'online',
  version: '1.0.70',
  last_seen: '2026-06-26T06:00:00.000Z',
  session_count: 2,
};

const MACHINE_B: Machine = {
  id: 'uuid-bbb',
  agent_id: 'agent-bbb',
  hostname: 'DESKTOP-BBB',
  nickname: null,
  machine_role: 'sub',
  status: 'offline',
  version: '1.0.69',
  last_seen: '2026-06-25T06:00:00.000Z',
  session_count: 0,
};

const MACHINE_A_SESSIONS = [
  {
    account_label: 'perfect-01',
    role: 'main',
    status: 'active',
    platform: 'douyin',
    account_nickname: '默易',
    bound_at: '2026-06-20T00:00:00.000Z',
  },
  {
    account_label: 'perfect-02',
    role: 'burner',
    status: 'active',
    platform: 'douyin',
    account_nickname: '小号A',
    bound_at: '2026-06-21T00:00:00.000Z',
  },
];

async function stubList(page: Page, machines: Machine[] = [MACHINE_A, MACHINE_B]) {
  await page.route('**/api/agent/machines', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: machines }),
    });
  });
}

async function stubDetail(
  page: Page,
  machine: Machine = MACHINE_A,
  sessions = MACHINE_A_SESSIONS
) {
  await page.route(`**/api/agent/machines/${machine.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { machine, sessions } }),
    });
  });
}

// test a: 列表渲染
test('列表渲染机器 + 主/副标签 + 在线状态 + N 个号', async ({ page }) => {
  await stubList(page);
  await page.goto('/dashboard/machines');

  await expect(page.getByText('主力机').first()).toBeVisible();
  await expect(page.getByText('DESKTOP-BBB').first()).toBeVisible();
  // 主/副标签
  await expect(page.getByText('主机', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('副机', { exact: false }).first()).toBeVisible();
  // version
  await expect(page.getByText('1.0.70').first()).toBeVisible();
  // session_count「N 个号」
  await expect(page.getByText('2 个号').first()).toBeVisible();
  await expect(page.getByText('0 个号').first()).toBeVisible();
});

// test b: 点机器进详情，显示抖音号列表
test('点机器进详情，显示其抖音号列表', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);
  await page.goto('/dashboard/machines');

  await page.getByText('主力机').first().click();

  // 详情里渲染该机器的抖音号
  await expect(page.getByText('perfect-01').first()).toBeVisible();
  await expect(page.getByText('默易').first()).toBeVisible();
  await expect(page.getByText('perfect-02').first()).toBeVisible();
});

// test c: 添加抖音号 → 派 qr-bind 单
test('详情「添加抖音号」派 qr-bind 单后号出现', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);

  let qrBindCalled = false;
  await page.route('**/api/agent/burner/qr-bind', async (route) => {
    qrBindCalled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { task_id: 'task-1' } }),
    });
  });

  await page.goto('/dashboard/machines');
  await page.getByText('主力机').first().click();

  // 填小号名 + 点添加
  await page.getByPlaceholder(/小号名|account_label/).fill('新小号1');
  await page.getByRole('button', { name: /添加抖音号/ }).click();

  await expect.poll(() => qrBindCalled).toBe(true);
  // 派单成功提示
  await expect(page.getByText(/已派|绑定任务|弹出登录/).first()).toBeVisible();
});

// test d: 重命名 + 设主副，PUT 返回新值后 UI 更新
test('重命名 + 设为副机器，PUT 返回新值后 UI 更新', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);

  await page.route(`**/api/agent/machines/${MACHINE_A.id}`, async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON() as {
      nickname?: string;
      machine_role?: string;
    };
    const updated: Machine = {
      ...MACHINE_A,
      nickname: body.nickname ?? MACHINE_A.nickname,
      machine_role: (body.machine_role as 'main' | 'sub') ?? MACHINE_A.machine_role,
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: updated }),
    });
  });

  await page.goto('/dashboard/machines');
  await page.getByText('主力机').first().click();

  // 重命名
  await page.getByPlaceholder(/机器显示名|新名|nickname/).fill('改名后的机器');
  await page.getByRole('button', { name: /重命名/ }).click();
  await expect(page.getByText('改名后的机器').first()).toBeVisible();

  // 设为副机器
  await page.getByRole('button', { name: /设为副|设副机器/ }).click();
  await expect(page.getByText('副机', { exact: false }).first()).toBeVisible();
});
