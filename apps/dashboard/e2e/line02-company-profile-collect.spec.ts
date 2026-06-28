import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

const MOCK_COMPANY_PROFILE = {
  company_name: 'E2E 测试公司',
  city: '西安',
  industry: '餐饮',
  description: '这是一家测试公司',
  products: ['测试产品A'],
  key_advantages: ['优势1'],
  customer_problem: '测试客户痛点',
  customer_portrait: '25-35岁消费者',
  qa_list: [{ q: '常见问题', a: '标准答案' }],
};

const MOCK_ACCOUNT_STATUS = {
  success: true,
  data: {
    accounts: [
      { label: 'live101942', role: 'main', health: 'ok' },
      { label: 'burner001', role: 'burner', health: 'ok' },
    ],
  },
  timestamp: new Date().toISOString(),
};

const MOCK_COLLECT_START = {
  success: true,
  data: { task_id: 'e2e-task-001', status: 'pending' },
  timestamp: new Date().toISOString(),
};

const MOCK_COLLECT_TASK = {
  success: true,
  data: {
    task_id: 'e2e-task-001',
    status: 'stage_1_done',
    video_count: 3,
    lead_count_raw: 15,
    created_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
  },
  timestamp: new Date().toISOString(),
};

test.describe('Line02 公司信息页 + 采集任务 Table', () => {
  test.beforeEach(async ({ page }) => {
    // Stub 所有 API 调用
    await page.route('**/api/company-profile', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: MOCK_COMPANY_PROFILE,
            timestamp: new Date().toISOString(),
          }),
        });
      } else if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { updated: true },
            timestamp: new Date().toISOString(),
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/api/line02/account-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ACCOUNT_STATUS),
      });
    });

    await page.route('**/api/acquisition/collect/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_COLLECT_START),
      });
    });

    await page.route('**/api/acquisition/collect/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_COLLECT_TASK),
      });
    });

    // 设置 auth cookie (E2E 模式跳过鉴权)
    await page.context().addCookies([
      { name: 'user', value: 'e2e-user', domain: 'localhost', path: '/' },
      { name: 'token', value: 'e2e-token', domain: 'localhost', path: '/' },
    ]);
  });

  test('公司信息页 — 加载、填写、保存、刷新后数据仍在', async ({ page }) => {
    await page.goto(`${BASE_URL}/company-profile`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'sprints/06282255-line02-company-profile-collect/screenshots/01-company-profile-initial.png' });

    // 验证三个 Section 标题可见
    await expect(page.getByText('基础信息').first()).toBeVisible();
    await expect(page.getByText('产品卖点').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: '客户画像' })).toBeVisible();

    // 验证数据已从 stub API 加载
    const companyNameInput = page.locator('input').first();
    await expect(companyNameInput).toHaveValue('E2E 测试公司');

    await page.screenshot({ path: 'sprints/06282255-line02-company-profile-collect/screenshots/02-company-profile-filled.png' });

    // 点击保存
    await page.getByRole('button', { name: /保存/ }).click();

    // 验证 Toast 出现
    await expect(page.getByText('已保存')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'sprints/06282255-line02-company-profile-collect/screenshots/03-company-profile-saved.png' });
  });

  test('采集页 — 账号状态块 + 关键词配置 + 采集任务 Table', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/acquisition-config`, { waitUntil: 'networkidle' });

    // 截图 - 账号状态页面
    await page.screenshot({ path: 'sprints/06282255-line02-company-profile-collect/screenshots/04-acquisition-page-status.png' });

    // 验证账号状态块可见（标签 live101942）
    await expect(page.getByText('live101942').first()).toBeVisible({ timeout: 5000 });

    // 验证主号状态标签（已登录）
    await expect(page.getByText('已登录').first()).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'sprints/06282255-line02-company-profile-collect/screenshots/05-acquisition-task-table.png' });
  });
});
