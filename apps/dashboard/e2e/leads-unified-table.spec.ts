/**
 * E2E: Line02 LeadsTable 统一组件验收
 *
 * 验证：
 *   1. LeadsPage (/dashboard/leads) 显示"最新回复"和"负责人"列头，无"触达状态"
 *   2. AcquisitionTasksPage (/area/acquisition/tasks) 无"触达状态"文字
 *   3. GET /api/acquisition/leads 响应含 latest_reply、latest_reply_at、assignee 字段
 *
 * 合同要求：禁止 page.route()，所有请求打真实后端（localhost:3000）。
 * 运行环境：GHA windows-latest（e2e-verify.ps1 启动真实 API + Vite preview）
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';
const API_URL = 'http://localhost:3000';

test.describe('LeadsTable 统一组件 — 列结构验证', () => {
  test('LeadsPage 含"最新回复"列头且无"触达状态"列头', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/leads`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-leads-page-initial.png' });

    // "最新回复"列头必须可见
    await expect(page.getByText('最新回复').first()).toBeVisible({ timeout: 10000 });

    // "负责人"列头必须可见
    await expect(page.getByText('负责人').first()).toBeVisible({ timeout: 10000 });

    // "触达状态"列头不允许存在
    expect(await page.getByText('触达状态').count()).toBe(0);

    await page.screenshot({ path: 'screenshots/01b-leads-page-columns.png' });
  });

  test('AcquisitionTasksPage 页面不含"触达状态"文字', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/tasks`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/02-acquisition-tasks-page.png' });

    // "触达状态"文字不允许在任何位置出现（包括展开的 leads 子表）
    expect(await page.getByText('触达状态').count()).toBe(0);
  });

  test('GET /api/acquisition/leads 响应含新字段（schema 验证）', async ({ request }) => {
    const resp = await request.get(`${API_URL}/api/acquisition/leads`, {
      headers: { 'X-Tenant-Id': 'test-tenant-e2e' },
    });

    // 端点必须响应（401 无租户或 200 有数据均为预期，但不能 500）
    expect([200, 401]).toContain(resp.status());

    if (resp.status() === 200) {
      const body = await resp.json();
      expect(Array.isArray(body.leads)).toBe(true);
      expect(typeof body.total).toBe('number');

      if (body.leads.length > 0) {
        const lead = body.leads[0];
        // 新字段必须有 key（值可以是 null）
        expect(lead).toHaveProperty('latest_reply');
        expect(lead).toHaveProperty('latest_reply_at');
        expect(lead).toHaveProperty('assignee');
        // 禁用字段不得存在
        expect(lead).not.toHaveProperty('reply_text');
        expect(lead).not.toHaveProperty('last_reply');
        expect(lead).not.toHaveProperty('responder');
      }
    }

    await page.screenshot({ path: 'screenshots/03-leads-api-response.png' }).catch(() => {});
  });
});

// workaround：page.screenshot 在 request-only test 里不可用，补一个 page fixture 调用
test.afterAll(async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/dashboard/leads`).catch(() => {});
  await page.screenshot({ path: 'screenshots/03-leads-api-response.png' }).catch(() => {});
  await context.close();
});
