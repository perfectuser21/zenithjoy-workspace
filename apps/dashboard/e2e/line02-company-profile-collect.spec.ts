import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';

const MOCK_COMPANY_PROFILE = {
  company_name: '烟雨楼测试公司',
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

test.describe('Line02 公司信息页 + 采集任务 Table', () => {
  test.beforeEach(async ({ page }) => {
    // company-profile stub（含 method() 检查，非无条件 stub）
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

    // AcquisitionConfigPage 所需 stubs（无后端时快速响应，防止 networkidle 超时）
    await page.route('**/api/acquisition/config', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            collect_rounds_per_day: 2, keywords_per_round_min: 3, keywords_per_round_max: 8,
            collect_active_start: '09:00', collect_active_end: '22:00',
            burner_count: 3, dm_per_hour: 10, dm_per_day: 50,
            dm_interval_min_sec: 30, dm_interval_max_sec: 120,
            dm_active_start: '10:00', dm_active_end: '21:00',
            nurture_per_day_min: 5, nurture_per_day_max: 15,
            cookie_check_interval_hours: 24,
          },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    await page.route('**/api/acquisition/dispatch/plan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [], timestamp: new Date().toISOString() }),
      });
    });

    await page.route('**/api/acquisition/cookie-health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], alert_count: 0 },
          timestamp: new Date().toISOString(),
        }),
      });
    });

    // 设置 auth cookie (E2E 模式跳过鉴权)
    await page.context().addCookies([
      { name: 'user', value: 'e2e-user', domain: 'localhost', path: '/' },
      { name: 'token', value: 'e2e-token', domain: 'localhost', path: '/' },
    ]);
  });

  test('公司信息页 — 3 Tab 布局 + onBlur 自动保存 + toast', async ({ page }) => {
    await page.goto(`${BASE_URL}/company-profile`, { waitUntil: 'networkidle' });

    // 验证三个 Tab 标签可见
    await expect(page.getByRole('tab', { name: '基础信息' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '产品与价值' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '目标客群' })).toBeVisible();

    // 验证数据已从 stub API 加载（基础信息 Tab 默认展示）
    await expect(page.getByTestId('company_name')).toHaveValue('烟雨楼测试公司');

    await page.screenshot({ path: 'sprints/06291030-line02-profile-tabs-integration/screenshots/01-company-profile-tabs.png' });

    // onBlur 触发自动保存
    await page.getByTestId('company_name').fill('烟雨楼测试公司改');
    await page.getByTestId('company_name').blur();

    // 验证 Toast 出现
    await expect(page.getByText('已保存').or(page.getByTestId('save-toast'))).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'sprints/06291030-line02-profile-tabs-integration/screenshots/02-save-toast.png' });

    // 切换 Tab
    await page.getByRole('tab', { name: '产品与价值' }).click();
    await expect(page.getByText('主营产品')).toBeVisible();

    await page.getByRole('tab', { name: '目标客群' }).click();
    await expect(page.getByText('客户画像描述')).toBeVisible();
  });

  test('EP-3: 保存失败 — PUT 返回 500 时显示红色 toast', async ({ page }) => {
    // 在本测试里单独拦截 PUT → 500（覆盖 beforeEach 的全局 stub）
    await page.route('**/api/company-profile', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: { code: 'SERVER_ERROR', message: '服务器错误' } }),
        });
      } else if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: MOCK_COMPANY_PROFILE, timestamp: new Date().toISOString() }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE_URL}/company-profile`, { waitUntil: 'networkidle' });

    // 填写公司名后 blur 触发保存，服务器返回 500
    await page.getByTestId('company_name').fill('测试保存失败');
    await page.getByTestId('company_name').blur();

    // 验证红色 toast 出现（含"保存失败"或"请重试"）
    await expect(
      page.getByText('保存失败').or(page.getByText('请重试'))
    ).toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: 'sprints/06291030-line02-profile-tabs-integration/screenshots/05-save-error-toast.png' });
  });

  test('采集页 — 账号状态块 + 推荐关键词 chips', async ({ page }) => {
    // 使用 domcontentloaded（比 networkidle 更稳定），再显式等待 React 挂载
    await page.goto(`${BASE_URL}/dashboard/acquisition-config`, { waitUntil: 'domcontentloaded' });
    // 等待 React 根节点有子元素（即 React 已挂载）
    await page.waitForFunction(() => {
      const root = document.getElementById('root');
      return root !== null && root.childElementCount > 0;
    }, { timeout: 15000 });

    // 验证账号状态块区域存在（标题总是渲染，无论有无账号）
    await expect(page.getByText('主号状态').first()).toBeVisible({ timeout: 15000 });

    // 验证推荐关键词 chips 出现（PrepPRD 核心要求：基于 company-profile stub 生成）
    // stub: city=西安, industry=餐饮, products=['测试产品A'] → 推荐词含"西安餐饮"/"餐饮推荐"/"西安美食推荐"
    const anyChip = page.getByText('西安餐饮').or(
      page.getByText('餐饮推荐').or(
        page.getByText('西安美食推荐').or(
          page.getByText('测试产品A')
        )
      )
    );
    await expect(anyChip.first()).toBeVisible({ timeout: 8000 });
  });
});
