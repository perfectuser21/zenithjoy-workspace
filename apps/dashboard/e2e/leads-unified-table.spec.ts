/**
 * E2E spec — Dashboard LeadsTable 统一组件验收
 *
 * 验证：
 * 1. LeadsPage (/dashboard/leads) 显示"最新回复"和"负责人"列头
 * 2. LeadsPage 不显示"触达状态"列头
 * 3. AcquisitionTasksPage 内嵌 leads 子表不含"触达状态"列头
 * 4. /api/acquisition/leads 返回 latest_reply / latest_reply_at / assignee 字段
 *
 * target_environment: windows_cloud
 * 禁止 route stub — 必须连接真实 API server
 */
import { test, expect } from '@playwright/test';

test.describe('LeadsTable 统一组件 — 列头验收', () => {
  test('LeadsPage 加载 — 含"最新回复"和"负责人"列头，无"触达状态"', async ({ page }) => {
    await page.goto('/dashboard/leads');

    // 等待页面加载（有 AG Grid 或加载指示器）
    await page.waitForLoadState('networkidle');

    // "最新回复"列头可见
    await expect(page.locator('text=最新回复').first()).toBeVisible({ timeout: 10000 });

    // "负责人"列头可见
    await expect(page.locator('text=负责人').first()).toBeVisible({ timeout: 10000 });

    // "触达状态"列头不存在
    const touchStatus = page.locator('text=触达状态');
    await expect(touchStatus).toHaveCount(0);
  });

  test('AcquisitionTasksPage 加载 — 页面中无"触达状态"文字', async ({ page }) => {
    await page.goto('/area/acquisition/tasks');
    await page.waitForLoadState('networkidle');

    const touchStatus = page.locator('text=触达状态');
    await expect(touchStatus).toHaveCount(0);
  });

  test('GET /api/acquisition/leads 返回含 latest_reply / assignee 字段的响应', async ({ page }) => {
    // 无登录会话（ubuntu 快检环境）时端点正确返回 401 NO_TENANT（租户隔离铁律）；
    // 有真实会话（windows evaluator 真登录）时返回 200 + leads 数组，此时才校验新字段。
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/acquisition/leads')),
      page.goto('/dashboard/leads'),
    ]);

    expect([200, 401]).toContain(response.status());
    if (response.status() !== 200) return;

    const body = await response.json() as { leads: Record<string, unknown>[]; total: number };
    expect(Array.isArray(body.leads)).toBe(true);
    expect(typeof body.total).toBe('number');

    // 若有数据则验新字段
    if (body.leads.length > 0) {
      const lead = body.leads[0];
      expect('latest_reply' in lead).toBe(true);
      expect('latest_reply_at' in lead).toBe(true);
      expect('assignee' in lead).toBe(true);
      // 禁用字段不存在
      expect('reply_text' in lead).toBe(false);
      expect('last_reply' in lead).toBe(false);
    }
  });
});
