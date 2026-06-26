/**
 * Machine Events E2E — /dashboard/machines 机器详情「模块与日志」块
 *
 * 覆盖场景（events 端点 page.route stub，不依赖真后端）：
 *   test a: 详情视图渲染升级进度条（按 percent 宽度）+ phase/module/message
 *   test b: 渲染最近错误/日志列表，error 级可见
 *   test c: 空态（无 upgrades / 无 logs）显示「暂无升级记录 / 暂无日志」
 *
 * VITE_SKIP_AUTH=true 跳鉴权（页面只 requireAuth），无需 stub session。
 *
 * 契约见 scratchpad/observability-contract.md「Dashboard 侧（T3）」+
 *   GET /api/agent/machines/:id/events 返回 {success,data:{logs,upgrades}}。
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npm run dev:dashboard
 *   npm run -w apps/dashboard e2e -- machine-events
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

const UPGRADES = [
  {
    id: 'up-1',
    module: 'line04',
    phase: 'download',
    percent: 42,
    message: '正在下载模块包 line04 1.0.71',
    created_at: '2026-06-26T07:00:00.000Z',
  },
  {
    id: 'up-2',
    module: 'line02',
    phase: 'done',
    percent: 100,
    message: 'line02 升级完成',
    created_at: '2026-06-26T06:30:00.000Z',
  },
];

const LOGS = [
  {
    id: 'log-1',
    level: 'error',
    module: 'line04',
    message: 'playwright 启动失败：未找到 chromium',
    created_at: '2026-06-26T07:05:00.000Z',
  },
  {
    id: 'log-2',
    level: 'warn',
    module: 'line02',
    message: '心跳延迟超过 30s',
    created_at: '2026-06-26T07:01:00.000Z',
  },
  {
    id: 'log-3',
    level: 'info',
    module: null,
    message: 'agent 已连接中台',
    created_at: '2026-06-26T07:00:00.000Z',
  },
];

async function stubList(page: Page) {
  await page.route('**/api/agent/machines', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [MACHINE_A] }),
    });
  });
}

async function stubDetail(page: Page) {
  await page.route(`**/api/agent/machines/${MACHINE_A.id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { machine: MACHINE_A, sessions: [] } }),
    });
  });
}

async function stubEvents(
  page: Page,
  data: { logs: unknown[]; upgrades: unknown[] } = { logs: LOGS, upgrades: UPGRADES }
) {
  await page.route('**/api/agent/machines/*/events*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data }),
    });
  });
}

// test a: 升级进度条按 percent 渲染
test('详情显示升级进度条（按 percent）+ phase/module', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);
  await stubEvents(page);

  await page.goto('/dashboard/machines');
  await page.getByText('主力机').first().click();

  // 模块与日志块标题
  await expect(page.getByText('模块与日志').first()).toBeVisible();

  // 升级条：module + phase + message
  await expect(page.getByText('line04').first()).toBeVisible();
  await expect(page.getByText(/正在下载模块包 line04/).first()).toBeVisible();

  // 进度条按 percent 宽度（data-testid + style width）
  const bar = page.getByTestId('upgrade-bar-up-1');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('style', /width:\s*42%/);

  // 100% 完成条
  const barDone = page.getByTestId('upgrade-bar-up-2');
  await expect(barDone).toHaveAttribute('style', /width:\s*100%/);
});

// test b: 错误/日志列表渲染，error 级可见
test('详情显示最近错误日志，error 级条目可见', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);
  await stubEvents(page);

  await page.goto('/dashboard/machines');
  await page.getByText('主力机').first().click();

  await expect(page.getByText(/playwright 启动失败/).first()).toBeVisible();
  await expect(page.getByText(/心跳延迟超过/).first()).toBeVisible();
  // error 级标记
  await expect(page.getByTestId('log-level-log-1')).toHaveText(/error/i);
});

// test c: 空态
test('无升级/无日志时显示空态文案', async ({ page }) => {
  await stubList(page);
  await stubDetail(page);
  await stubEvents(page, { logs: [], upgrades: [] });

  await page.goto('/dashboard/machines');
  await page.getByText('主力机').first().click();

  await expect(page.getByText('暂无升级记录').first()).toBeVisible();
  await expect(page.getByText('暂无日志').first()).toBeVisible();
});
