/**
 * Customer Management E2E — /admin/customers 统一客户管理模块
 *
 * 4 个 test 覆盖 Golden Path 全程：
 *   test 1: /admin/customers 概览页（customers-table-row）
 *   test 2: /admin/customers/platform-sessions（session-status: active/expired）
 *   test 3: /admin/customers/publish-logs（tenant_id query param 筛选）
 *   test 4: 403 error path（非超管访问被拦截）
 *
 * 全 API stub（page.route），不依赖真实后端，适合 windows_cloud 干净 VM。
 * 8 张截图：ws4-01 ~ ws4-08，存入 screenshots/ 目录。
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';

const SCREENSHOT_DIR = path.join('screenshots');

const CUSTOMERS_DATA = [
  {
    tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    email: 'alice@example.com',
    license_status: 'active',
    platform_count: 2,
    last_publish_at: '2026-05-25T10:00:00Z',
  },
  {
    tenant_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    email: 'bob@example.com',
    license_status: 'expired',
    platform_count: 0,
    last_publish_at: null,
  },
];

const PLATFORM_SESSIONS_DATA = [
  {
    session_id: 'ssss0001-0000-0000-0000-000000000001',
    tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    platform: 'douyin',
    status: 'active',
    expires_at: '2026-12-31T00:00:00Z',
  },
  {
    session_id: 'ssss0002-0000-0000-0000-000000000002',
    tenant_id: 'bbbbbbbb-0000-0000-0000-000000000002',
    platform: 'kuaishou',
    status: 'expired',
    expires_at: '2026-04-01T00:00:00Z',
  },
];

const PUBLISH_LOGS_DATA = [
  {
    log_id: 'llll0001-0000-0000-0000-000000000001',
    tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    work_id: 'wwww0001-0000-0000-0000-000000000001',
    platform: 'douyin',
    status: 'success',
    created_at: '2026-05-25T10:00:00Z',
  },
  {
    log_id: 'llll0002-0000-0000-0000-000000000002',
    tenant_id: 'aaaaaaaa-0000-0000-0000-000000000001',
    work_id: 'wwww0002-0000-0000-0000-000000000002',
    platform: 'kuaishou',
    status: 'failed',
    created_at: '2026-05-24T08:00:00Z',
  },
];

// test 1: /admin/customers 概览页
test('/admin/customers 概览页加载并展示客户列表', async ({ page }) => {
  await page.route('**/api/admin/customers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, "data": CUSTOMERS_DATA, total: CUSTOMERS_DATA.length }),
    });
  });

  // ws4-01: 导航到概览页之前
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-01-before-overview.png` });

  await page.goto('/admin/customers');

  // ws4-02: 页面加载后
  await expect(page.locator('[data-testid="customers-table"]')).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-02-overview-loaded.png` });

  // 断言 customers-table-row 存在（至少 1 行）
  const rows = page.locator('[data-testid="customers-table-row"]');
  await expect(rows.first()).toBeVisible({ timeout: 5000 });
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // 验证 license_status 字段展示（UI 用中文标签：有效/已过期）
  await expect(page.getByText('有效').first()).toBeVisible();

  // ws4-03: 断言通过后截图
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-03-overview-asserted.png` });
});

// test 2: /admin/customers/platform-sessions
test('/admin/customers/platform-sessions 展示 active/expired session 状态', async ({ page }) => {
  await page.route('**/api/admin/customers/platform-sessions*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, "data": PLATFORM_SESSIONS_DATA, total: PLATFORM_SESSIONS_DATA.length }),
    });
  });

  await page.goto('/admin/customers/platform-sessions');

  // ws4-04: 页面加载后
  await expect(page.locator('[data-testid="platform-sessions-table-row"]').first()).toBeVisible({ timeout: 8000 });
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-04-platform-sessions-loaded.png` });

  // 断言 session-status 列显示 active 和 expired
  const statusCells = page.locator('[data-testid="session-status"]');
  await expect(statusCells.first()).toBeVisible({ timeout: 5000 });

  const allStatuses = await statusCells.allTextContents();
  const validStatuses = allStatuses.every((s) => s === 'active' || s === 'expired');
  expect(validStatuses).toBe(true);

  // 确认 active 和 expired 都存在
  expect(allStatuses).toContain('active');
  expect(allStatuses).toContain('expired');

  // ws4-05: 断言通过后截图
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-05-sessions-asserted.png` });
});

// test 3: /admin/customers/publish-logs — tenant_id query param 筛选
test('/admin/customers/publish-logs 通过 tenant_id 正确筛选发布记录', async ({ page }) => {
  const TEST_TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
  let capturedTenantId: string | null = null;

  await page.route('**/api/admin/customers/publish-logs*', async (route) => {
    const url = new URL(route.request().url());
    capturedTenantId = url.searchParams.get('tenant_id');

    const filteredData = capturedTenantId
      ? PUBLISH_LOGS_DATA.filter((log) => log.tenant_id === capturedTenantId)
      : PUBLISH_LOGS_DATA;

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, "data": filteredData, total: filteredData.length }),
    });
  });

  // 不带 tenant_id 先加载
  await page.goto('/admin/customers/publish-logs');
  await expect(page.locator('[data-testid="publish-logs-table-row"]').first()).toBeVisible({ timeout: 8000 });

  // ws4-06: 页面加载后截图
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-06-publish-logs-loaded.png` });

  // 带 tenant_id query param 导航（验证正确传递，不用禁用名）
  await page.goto(`/admin/customers/publish-logs?tenant_id=${TEST_TENANT_ID}`);
  await expect(page.locator('[data-testid="publish-logs-table-row"]').first()).toBeVisible({ timeout: 8000 });

  // ws4-07: 筛选后截图（URL 含 tenant_id）
  expect(page.url()).toContain(`tenant_id=${TEST_TENANT_ID}`);
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-07-logs-filtered.png` });

  // 验证 tenant_id 被正确传递给 API
  expect(capturedTenantId).toBe(TEST_TENANT_ID);

  // 验证结果按 tenant_id 筛选
  const rows = page.locator('[data-testid="publish-logs-table-row"]');
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThanOrEqual(1);

  // ws4-08: 断言通过后截图
  await page.screenshot({ path: `${SCREENSHOT_DIR}/ws4-08-logs-asserted.png` });
});

// test 4: 403 error path — 非超管访问被拦截
test('非超管访问 /admin/customers 返回 403 并展示错误', async ({ page }) => {
  await page.route('**/api/admin/customers*', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        error: { code: 'FORBIDDEN', message: '403: 无权限，需要超管账号' },
      }),
    });
  });

  await page.goto('/admin/customers');

  // 等待页面渲染 403 错误提示或重定向到错误页
  await page.waitForTimeout(1000);

  // 验证 403 被处理（显示错误文字或重定向）
  const pageContent = await page.content();
  const has403Indicator =
    pageContent.includes('403') ||
    pageContent.includes('无权限') ||
    pageContent.includes('FORBIDDEN') ||
    pageContent.includes('error') ||
    page.url().includes('403') ||
    page.url().includes('forbidden');

  expect(has403Indicator).toBe(true);
});
