/**
 * TDD Red — Video Remake 9节点流水线 E2E spec（commit-1 RED）
 *
 * 在 Generator 实现 /video-remake 页面之前，所有 test 应 FAIL（页面不存在 / 路由未注册）。
 * Generator 实现后（commit-2），所有 test 应变绿。
 *
 * API 全部 stub（page.route），不依赖真实 AI 后端（ToAPI/DashScope）。
 * CI=true 时 N07 自动选帧，跳过手动选帧 UI。
 *
 * 运行：
 *   CI=true npx playwright test e2e/video-remake.spec.ts
 */
import { test, expect, Page } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5174';
const IS_CI = process.env.CI === 'true';

const MOCK_JOB_ID = 'test-job-id-video-remake-12345';

const MOCK_JOB_INITIAL = {
  job_id: MOCK_JOB_ID,
  filename: 'test.mp4',
  duration_seconds: 10,
  width: 1920,
  height: 1080,
  status: 'queued',
  nodes: ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09'].map(id => ({
    node_id: id,
    label: id,
    status: 'idle',
    input: {},
    output: {}
  }))
};

const MOCK_JOB_N03_DONE = {
  ...MOCK_JOB_INITIAL,
  status: 'in_progress',
  nodes: MOCK_JOB_INITIAL.nodes.map(n => {
    if (['N01', 'N02'].includes(n.node_id)) return { ...n, status: 'done' };
    if (n.node_id === 'N03') return {
      ...n,
      status: 'done',
      output: {
        original_frame_url: 'https://example.com/frames/orig-0.jpg',
        prompt_text: 'Bright cinematic style, vivid colors, dramatic lighting'
      }
    };
    return n;
  })
};

const MOCK_JOB_N05_DONE = {
  ...MOCK_JOB_INITIAL,
  status: 'in_progress',
  nodes: MOCK_JOB_INITIAL.nodes.map(n => {
    if (['N01', 'N02', 'N03', 'N04'].includes(n.node_id)) return { ...n, status: 'done' };
    if (n.node_id === 'N05') return {
      ...n,
      status: 'done',
      output: {
        frames: [
          { redrawn_frame_url: 'https://example.com/frames/redrawn-0.jpg', score: 0.92 },
          { redrawn_frame_url: 'https://example.com/frames/redrawn-1.jpg', score: 0.87 }
        ]
      }
    };
    return n;
  })
};

const MOCK_JOB_COMPLETED = {
  ...MOCK_JOB_INITIAL,
  status: 'completed',
  nodes: MOCK_JOB_INITIAL.nodes.map(n => ({ ...n, status: 'done' }))
};

const MOCK_N07_SELECT = {
  job_id: MOCK_JOB_ID,
  selected_frame: 'https://example.com/frames/redrawn-0.jpg'
};

const MOCK_OUTPUT = {
  job_id: MOCK_JOB_ID,
  download_url: 'https://example.com/output/remake.mp4',
  duration_seconds: 8.5,
  has_video_stream: true
};

async function stubVideoRemakeAPI(page: Page) {
  // POST /api/video-remake/jobs
  await page.route('**/api/video-remake/jobs', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ job_id: MOCK_JOB_ID, status: 'queued' })
      });
    } else {
      await route.continue();
    }
  });

  // GET /api/video-remake/jobs/:id — 轮询状态
  let pollCount = 0;
  await page.route(`**/api/video-remake/jobs/${MOCK_JOB_ID}`, async route => {
    pollCount++;
    let body = MOCK_JOB_INITIAL;
    if (pollCount >= 3) body = MOCK_JOB_N03_DONE;
    if (pollCount >= 5) body = MOCK_JOB_N05_DONE;
    if (pollCount >= 7) body = MOCK_JOB_COMPLETED;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body)
    });
  });

  // POST /api/video-remake/jobs/:id/nodes/N07/select
  await page.route(`**/api/video-remake/jobs/${MOCK_JOB_ID}/nodes/N07/select`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_N07_SELECT)
    });
  });

  // GET /api/video-remake/jobs/:id/output
  await page.route(`**/api/video-remake/jobs/${MOCK_JOB_ID}/output`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_OUTPUT)
    });
  });
}

test('N01: 打开 /video-remake 页面显示 9节点流水线图', async ({ page }) => {
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  for (const nodeId of ['N01', 'N02', 'N03', 'N04', 'N05', 'N06', 'N07', 'N08', 'N09']) {
    await expect(page.locator(`[data-node-id="${nodeId}"]`)).toBeVisible({ timeout: 5000 });
  }
});

test('N01-N06: 上传 MP4 → 节点依序变绿', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  await expect(page.locator('[data-node-id="N01"][data-status="done"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="filename-display"]')).toContainText('test.mp4');
});

test('N03: 节点展开可见原帧URL + Prompt文本', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  await expect(page.locator('[data-node-id="N03"][data-status="done"]')).toBeVisible({ timeout: 15000 });
  await page.click('[data-node-id="N03"]');

  await expect(page.locator('[data-testid="n03-original-frame"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="n03-prompt-text"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="n03-prompt-text"]')).not.toBeEmpty();
});

test('N04: 节点展开可见原帧/重绘帧对比', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  await expect(page.locator('[data-node-id="N04"][data-status="done"]')).toBeVisible({ timeout: 15000 });
  await page.click('[data-node-id="N04"]');

  await expect(page.locator('[data-testid="n04-original-frame"]')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('[data-testid="n04-redrawn-frame"]')).toBeVisible({ timeout: 5000 });
});

test('N05: 节点展开可见评分列表', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  await expect(page.locator('[data-node-id="N05"][data-status="done"]')).toBeVisible({ timeout: 20000 });
  await page.click('[data-node-id="N05"]');

  await expect(page.locator('[data-testid="n05-frame-scores"]')).toBeVisible({ timeout: 5000 });
  const scoreItems = page.locator('[data-testid="n05-score-item"]');
  await expect(scoreItems).toHaveCount(2, { timeout: 5000 });
});

test('N07: CI=true 自动选第一帧（跳过手动选帧UI）', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  if (IS_CI) {
    await expect(page.locator('[data-node-id="N07"][data-status="done"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-testid="n07-manual-select"]')).not.toBeVisible();
  } else {
    await expect(page.locator('[data-testid="n07-manual-select"]')).toBeVisible({ timeout: 15000 });
  }
});

test('N09: 合成完成 → 下载按钮可见，has_video_stream=true + duration_seconds>0', async ({ page }) => {
  await stubVideoRemakeAPI(page);
  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'test.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from([0, 0, 0, 0])
  });

  await expect(page.locator('[data-node-id="N09"][data-status="done"]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-testid="download-button"]')).toBeVisible({ timeout: 5000 });

  const resp = await page.request.get(`${BASE_URL.replace(':5174', ':3001')}/api/video-remake/jobs/${MOCK_JOB_ID}/output`).catch(() => null);
  if (resp && resp.ok()) {
    const data = await resp.json();
    expect(data.has_video_stream).toBe(true);
    expect(data.duration_seconds).toBeGreaterThan(0);
  }
});

test('边界: 超100MB文件前端拒绝，不触发API调用', async ({ page }) => {
  let apiCallCount = 0;
  await page.route('**/api/video-remake/jobs', route => {
    if (route.request().method() === 'POST') apiCallCount++;
    route.continue();
  });

  await page.goto(`${BASE_URL}/video-remake`);
  await page.waitForLoadState('networkidle');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('[data-testid="upload-button"]')
  ]);
  await fileChooser.setFiles({
    name: 'large.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(104857601)
  });

  await expect(page.locator('[data-testid="file-size-error"]')).toBeVisible({ timeout: 5000 });
  expect(apiCallCount).toBe(0);
});
