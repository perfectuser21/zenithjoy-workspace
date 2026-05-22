/**
 * Content Clipper E2E — 内容采集完整用户路径
 *
 * 覆盖：
 *   1. 打开 /clips → 表单可见 → 提交 → 看到成功提示
 *   2. 列表展示 pending 条目 → 点击 → 跳转详情页
 *   3. 设置 tab → 显示飞书和 Notion 绑定区块
 *
 * API 全部 stub（page.route），不依赖真实后端或 content-service。
 */
import { test, expect } from '@playwright/test';

const CLIP_ID = 'aaaa1111-0000-0000-0000-000000000001';
const DOUYIN_URL = 'https://v.douyin.com/test-abc123/';
const NOTION_URL = 'https://www.notion.so/mydb/abcd1234567890abcdef1234567890ab';

const FAKE_SETTINGS_UNBOUND = {
  defaultOutputUrl: null,
  defaultOutputType: null,
  notionBound: false,
  feishuBound: false,
  feishuUserName: null,
};

const FAKE_CLIP_PENDING = {
  id: CLIP_ID,
  user_id: 'dev-user-001',
  url: DOUYIN_URL,
  platform: 'douyin',
  status: 'pending',
  title: null,
  transcript: null,
  images: [],
  author: null,
  author_id: null,
  like_count: null,
  comment_count: null,
  share_count: null,
  cover_url: null,
  video_url: null,
  output_url: NOTION_URL,
  output_type: 'notion',
  output_status: 'pending',
  error_msg: null,
  retry_count: 0,
  raw_response: null,
  created_at: new Date().toISOString(),
  processed_at: null,
  updated_at: new Date().toISOString(),
};

const FAKE_CLIP_DONE = {
  ...FAKE_CLIP_PENDING,
  status: 'done',
  title: '测试视频标题',
  transcript: '这是一段转写文案，内容来自测试抖音视频。',
  author: '测试博主',
  output_status: 'pushed',
};

test('表单可见 → 提交链接 → 显示成功提示', async ({ page }) => {
  await page.route('**/api/clips/settings', (route) =>
    route.fulfill({ json: FAKE_SETTINGS_UNBOUND })
  );
  await page.route('**/api/clips?**', (route) =>
    route.fulfill({ json: { data: [], total: 0 } })
  );
  await page.route('**/api/clips', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 201, json: FAKE_CLIP_PENDING });
    } else {
      await route.continue();
    }
  });

  await page.goto('/clips');

  await expect(page.locator('h1')).toContainText('内容采集');
  await expect(page.getByText('暂无记录，粘贴链接开始采集')).toBeVisible();

  await page.getByPlaceholder(/粘贴抖音/).fill(DOUYIN_URL);
  await page.getByPlaceholder(/输出链接/).fill(NOTION_URL);
  await page.getByRole('button', { name: /提交采集/ }).click();

  await expect(page.getByText('已提交，正在采集...')).toBeVisible();
});

test('列表展示条目 → 点击跳转详情', async ({ page }) => {
  await page.route('**/api/clips/settings', (route) =>
    route.fulfill({ json: FAKE_SETTINGS_UNBOUND })
  );
  await page.route('**/api/clips?**', (route) =>
    route.fulfill({ json: { data: [FAKE_CLIP_PENDING], total: 1 } })
  );
  await page.route(`**/api/clips/${CLIP_ID}`, (route) =>
    route.fulfill({ json: FAKE_CLIP_DONE })
  );

  await page.goto('/clips');

  await expect(page.locator('span', { hasText: '待处理' }).first()).toBeVisible();
  await expect(page.getByText(DOUYIN_URL)).toBeVisible();

  await page.getByText(DOUYIN_URL).click();
  await expect(page).toHaveURL(new RegExp(`/clips/${CLIP_ID}`));
  await expect(page.getByText('测试视频标题')).toBeVisible();
  await expect(page.getByText('这是一段转写文案')).toBeVisible();
});

test('设置 tab → 显示飞书和 Notion 绑定区块', async ({ page }) => {
  await page.route('**/api/clips/settings', (route) =>
    route.fulfill({ json: FAKE_SETTINGS_UNBOUND })
  );
  await page.route('**/api/clips?**', (route) =>
    route.fulfill({ json: { data: [], total: 0 } })
  );

  await page.goto('/clips');

  await page.getByRole('button', { name: '设置' }).click();

  // 飞书绑定区块
  await expect(page.locator('h3', { hasText: '飞书 Bitable' })).toBeVisible();
  await expect(page.locator('span', { hasText: '未绑定' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: '绑定飞书' })).toBeVisible();

  // Notion 绑定区块
  await expect(page.locator('h3', { hasText: 'Notion' })).toBeVisible();
  await expect(page.locator('input[placeholder*="ntn_"]')).toBeVisible();
});
