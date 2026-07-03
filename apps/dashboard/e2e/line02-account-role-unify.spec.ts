/**
 * Line02 角色统一 & 账号管理页绑定机器列 E2E (Round 2)
 *
 * 变体C 死规则：
 * - 禁止 page.route()，所有请求打真实后端（localhost:3000）
 * - VITE_SKIP_AUTH=true 绕过登录
 *
 * Round 2 修复（问题4）：
 * - 表格单元格内容断言（data-testid="machine-hostname-cell"）
 * - 旧路由测试改 expect().not.toContain 显式断言（移除隐式 process.exit）
 *
 * 运行：
 *   E2E_BASE_URL=http://localhost:5174 E2E_API_URL=http://localhost:3000 npx playwright test e2e/line02-account-role-unify.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.describe('Line02 账号管理页 — 绑定机器列', () => {
  test('GET /api/agent/burner/sessions 响应含 agent_hostname 字段', async ({ request }) => {
    const resp = await request.get(`${API_URL}/api/agent/burner/sessions`, {
      headers: { 'X-Tenant-Id': 'test-tenant-placeholder' },
    });
    expect([200, 401]).toContain(resp.status());
    if (resp.status() === 200) {
      const json = await resp.json();
      expect(json.success).toBe(true);
      expect(Array.isArray(json.data?.sessions)).toBe(true);
      if (json.data.sessions.length > 0) {
        expect(json.data.sessions[0]).toHaveProperty('agent_hostname');
        expect(json.data.sessions[0]).toHaveProperty('agent_nickname');
        expect(json.data.sessions[0]).not.toHaveProperty('hostname');
        expect(json.data.sessions[0]).not.toHaveProperty('nickname');
      }
    }
  });

  test('账号管理页显示"绑定机器"列头，单元格渲染 hostname 或"—"', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/accounts`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-initial.png' });

    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 10000 });

    // Step 1: 列头可见
    await expect(page.getByText('绑定机器').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/02-accounts-table.png' });

    // Step 3 修复（问题4）：断言单元格实际渲染值，不只检查列头
    // generator 必须在"绑定机器"列 <td> 加 data-testid="machine-hostname-cell"
    const rowCount = await page.locator('tbody tr').count();
    if (rowCount > 0) {
      const machineCell = page.locator('[data-testid="machine-hostname-cell"]').first();
      await expect(machineCell).toBeVisible({ timeout: 5000 });
      const cellText = (await machineCell.textContent() ?? '').trim();
      // 值必须是"—"（无绑定机器）或非空 hostname，不允许空字符串/undefined
      expect(cellText).toMatch(/^—$|^\S+/);
    }
  });

  test('旧路由 /dashboard/douyin-burner-bind 访问后 URL 离开旧路径', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/douyin-burner-bind`);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'screenshots/03-old-route-gone.png' });

    // 问题4修复：使用 Playwright expect 断言（不用 process.exit）
    const finalUrl = page.url();
    expect(finalUrl).not.toContain('douyin-burner-bind');
  });
});
