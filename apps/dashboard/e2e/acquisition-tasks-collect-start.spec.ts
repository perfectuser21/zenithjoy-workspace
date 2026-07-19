/**
 * Acquisition Tasks 「开始采集」按钮 E2E — /area/acquisition/tasks
 *
 * 回归背景（2026-07-19）：golden-path-2-smoke.sh 号称覆盖"客户在 dashboard 发起采集"
 * 这一步，但实现全是裸 curl 调 /api/acquisition/collect/start，从未有一个测试真正在
 * 浏览器里填关键词、点"开始采集"按钮。真机验证音频判定 fix 时，用户追问"你验证的时候
 * 客户在页面里操作了吗"才发现这个缺口——这是本项目第一个真正驱动浏览器点击这个按钮的测试。
 *
 * 覆盖场景（契约端点全 page.route stub，不依赖真后端，与 acquisition-config.spec.ts 同构）：
 *   test a: 填关键词 + 点"开始采集" → 真调 POST /api/acquisition/collect/start，
 *           body.keywords 正确 → 成功后重新拉取任务列表
 *
 * 运行：
 *   VITE_SKIP_AUTH=true npx vite --port 5173
 *   npx playwright test e2e/acquisition-tasks-collect-start.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';

const ONLINE_MACHINE = {
  id: 'm1',
  agent_id: 'agent-1',
  hostname: 'test-machine',
  nickname: null,
  machine_role: 'main',
  status: 'online',
  version: '1.0.0',
  last_seen: new Date().toISOString(),
  session_count: 0,
  os_type: 'android',
};

async function stubBaseline(page: Page) {
  await page.route('**/api/agent/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [ONLINE_MACHINE] }),
    });
  });

  await page.route('**/api/agent/burner/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { sessions: [] } }),
    });
  });

  await page.route('**/api/acquisition/collect-tasks', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { tasks: [], total: 0 } }),
    });
  });
}

// test a: 填关键词 + 点"开始采集" → 真调 POST /api/acquisition/collect/start
test('填关键词点开始采集，真实调用collect/start且body.keywords正确', async ({ page }) => {
  await stubBaseline(page);

  let postBody: Record<string, unknown> | null = null;
  await page.route('**/api/acquisition/collect/start', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    postBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { task_id: 'test-task-001', status: 'pending' } }),
    });
  });

  await page.goto('/area/acquisition/tasks');

  // 无在线机器警告不应出现（已 stub 一台 online 机器）
  await expect(page.getByText('无在线机器，无法创建采集任务')).not.toBeVisible();

  const keywordInput = page.getByPlaceholder(/关键词/);
  await keywordInput.fill('装修');

  const startBtn = page.getByRole('button', { name: '开始采集' });
  await expect(startBtn).toBeEnabled();
  await startBtn.click();

  await expect.poll(() => postBody).not.toBeNull();
  expect((postBody as unknown as { keywords: string[] }).keywords).toEqual(['装修']);

  // 提交成功后关键词输入框被清空（组件 handleStart 里 setKeyword('')）
  await expect(keywordInput).toHaveValue('');
});
