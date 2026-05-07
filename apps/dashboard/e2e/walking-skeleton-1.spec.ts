/**
 * Walking Skeleton #1 — Dashboard E2E
 *
 * 走完 4 个页面：/dashboard/agent → /dashboard/platforms/douyin →
 *               /dashboard/folder → /dashboard/publish
 * API 全部 stub（page.route），不依赖真实后端。
 *
 * 运行：
 *   npx playwright install chromium  (首次)
 *   npm run dev:dashboard   (另一终端，需要 VITE_SKIP_AUTH=true)
 *   npx playwright test e2e/walking-skeleton-1.spec.ts
 */
import { test, expect } from '@playwright/test';

const TASK_ID = '11111111-2222-3333-4444-555555555555';

test('walking-skeleton-1 客户首次成功路径（4 页贯穿）', async ({ page }) => {
  // ============ API stub ============
  // GET /api/agent/status — 第一次未连接，刷新一次后变已连接
  let statusCallCount = 0;
  await page.route('**/api/agent/status*', async (route) => {
    statusCallCount += 1;
    const body =
      statusCallCount === 1
        ? {
            connected: false,
            agent_id: null,
            hostname: null,
            version: null,
            last_heartbeat_at: null,
            bound_folder_path: null,
          }
        : {
            connected: true,
            agent_id: 'agent-uuid-1',
            hostname: 'mac-mini-01',
            version: '0.1.0',
            last_heartbeat_at: new Date().toISOString(),
            bound_folder_path: '/Users/foo/my-videos',
          };
    await route.fulfill({ json: body });
  });

  // GET /api/agent/platforms — douyin pending → active
  let platformsCount = 0;
  await page.route('**/api/agent/platforms*', async (route) => {
    platformsCount += 1;
    const sessions =
      platformsCount === 1
        ? [{ platform: 'douyin', account_label: 'default', status: 'pending', bound_at: null }]
        : [
            {
              platform: 'douyin',
              account_label: 'default',
              status: 'active',
              bound_at: '2026-05-07T11:00:00Z',
            },
          ];
    await route.fulfill({ json: { sessions } });
  });

  // POST /api/agent/qr-bind
  await page.route('**/api/agent/qr-bind', async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  // POST /api/agent/folder/bind
  await page.route('**/api/agent/folder/bind', async (route) => {
    await route.fulfill({ json: { ok: true } });
  });

  // POST /api/publish/task
  await page.route('**/api/publish/task', async (route) => {
    await route.fulfill({ json: { task_id: TASK_ID, status: 'pending' } });
  });

  // GET /api/publish/tasks — 列表轮询
  let listCount = 0;
  await page.route('**/api/publish/tasks?**', async (route) => {
    listCount += 1;
    const tasks =
      listCount < 2
        ? [
            {
              id: TASK_ID,
              status: 'pending',
              result: null,
              created_at: '2026-05-07T11:30:00Z',
              receipt_at: null,
            },
          ]
        : [
            {
              id: TASK_ID,
              status: 'success',
              result: { url: 'https://www.douyin.com/video/dryrun-abc' },
              created_at: '2026-05-07T11:30:00Z',
              receipt_at: '2026-05-07T11:31:00Z',
            },
          ];
    await route.fulfill({ json: { tasks } });
  });

  // ============ Step 1：Agent 下载页 ============
  await page.goto('/dashboard/agent');
  await expect(page.getByText(/Agent 下载|下载.*Agent/)).toBeVisible();
  await expect(page.getByText(/未连接|已连接/)).toBeVisible();

  // ============ Step 2：抖音绑定页 ============
  await page.goto('/dashboard/platforms/douyin');
  await expect(page.getByRole('button', { name: /扫码绑抖音/ })).toBeVisible();
  await page.getByRole('button', { name: /扫码绑抖音/ }).click();

  // ============ Step 3：文件夹绑定 ============
  await page.goto('/dashboard/folder');
  await page.getByLabel(/本地路径|文件夹/).fill('/Users/foo/my-videos');
  await page.getByRole('button', { name: /绑定|提交/ }).click();
  await expect(page.getByText(/绑定成功|已绑定/)).toBeVisible();

  // ============ Step 4：一键发布 + 回执 ============
  await page.goto('/dashboard/publish');
  await page.getByRole('button', { name: /发布到抖音/ }).click();
  // 等到列表出现 task_id
  await expect(page.getByText(TASK_ID)).toBeVisible();
  // 等到 receipt 显示成功的 URL（轮询切换到第二次返回）
  await expect(page.getByText(/douyin\.com\/video\/dryrun-abc/)).toBeVisible({
    timeout: 15000,
  });
});
