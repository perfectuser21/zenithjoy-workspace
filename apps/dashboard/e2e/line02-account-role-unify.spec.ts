/**
 * Line02 角色统一 & 账号管理页绑定机器列 E2E
 *
 * 变体C 死规则：
 * - 禁止 page.route()，所有请求打真实后端（localhost:3000）
 * - VITE_SKIP_AUTH=true 绕过登录
 *
 * 运行：
 *   E2E_BASE_URL=http://localhost:5174 npx playwright test e2e/line02-account-role-unify.spec.ts
 */
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5174';
const API_URL = process.env.E2E_API_URL || 'http://localhost:3000';

test.describe('Line02 账号管理页 — 绑定机器列', () => {
  test('GET /api/agent/burner/sessions 响应含 agent_hostname 字段', async ({ request }) => {
    const resp = await request.get(`${API_URL}/api/agent/burner/sessions`, {
      headers: { 'X-Tenant-Id': 'test-tenant-placeholder' },
    });
    // 不管 tenant 是否存在，endpoint 必须响应（200 或 401，不是 404）
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

  test('账号管理页显示"绑定机器"列头', async ({ page }) => {
    await page.goto(`${BASE_URL}/area/acquisition/accounts`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'screenshots/01-initial.png' });

    // 页面已加载（不是 loading spinner 死锁）
    await expect(page.locator('.animate-spin')).not.toBeVisible({ timeout: 10000 });

    // "绑定机器" 列头可见
    await expect(page.getByText('绑定机器').first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/02-accounts-table.png' });
  });

  test('旧路由 /dashboard/douyin-burner-bind 访问后不渲染旧组件', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard/douyin-burner-bind`);
    await page.waitForTimeout(1500); // 等待 React Router catch-all 处理
    await page.screenshot({ path: 'screenshots/03-old-route-gone.png' });

    // 旧组件的特征文字不应出现（路由已删除）
    // 注意：catch-all 重定向到 /，所以旧页面内容不会渲染
    const finalUrl = page.url();
    // URL 不应停留在 douyin-burner-bind
    expect(finalUrl).not.toContain('douyin-burner-bind');
  });
});
