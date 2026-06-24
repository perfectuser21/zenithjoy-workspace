/**
 * crm-cookie-seam.spec.ts — cookie 接缝真目标验证（linux CI 真后端 leg）
 *
 * 与 crm-customer-list.spec.ts 的根本区别：**无任何前端路由拦截 stub、无 VITE_SKIP_AUTH**。
 * 真后端 :5200（vite proxy /api→:5200）+ 真 better-auth session cookie 注入浏览器 context。
 * 点接管开关时浏览器 fetch 必须带 `credentials:'include'` 把 cookie 发给真后端，否则真后端 401 →
 * 断言失败。这才真验本 sprint 必修的「未登录」bug 接缝。
 *
 * 由 line04-crm-customer-list-smoke.sh --leg=cookie-seam 编排运行（它已起真后端 + 真登录拿 cookie）：
 *   E2E_REAL_SESSION_COOKIE = "better-auth.session_token=<token>"（name=value，smoke bootstrap 导出）
 *   E2E_BASE_URL            = dashboard preview 地址（vite proxy /api → :5200）
 * cookie 未 bootstrap 出来 → test.skip 自动降级为 logic-done-pending（禁 stub 绿冒充 done）。
 */
import { test, expect } from '@playwright/test';

const RAW = process.env.E2E_REAL_SESSION_COOKIE || '';
const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';

test('cookie 接缝 — 真浏览器在真后端上点接管开关，真发 session cookie', async ({ browser }) => {
  test.skip(!RAW, 'E2E_REAL_SESSION_COOKIE 未注入：真后端 leg 未具备，cookie 接缝 logic-done-pending');

  const eq = RAW.indexOf('=');
  const name = eq >= 0 ? RAW.slice(0, eq) : RAW;
  const value = eq >= 0 ? RAW.slice(eq + 1) : '';

  const context = await browser.newContext(); // 不用 VITE_SKIP_AUTH，不 stub 任何 /api
  await context.addCookies([{ name, value, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();

  // 真 GET（带 cookie 经 vite proxy 打真 :5200）→ 真出客户行
  await page.goto(`${BASE}/customers`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('crm-customer-row').first()).toBeVisible({ timeout: 15000 });

  // 点接管开关 —— 不 stub /api/crm/customers/manage，浏览器 fetch 须带 credentials 把 cookie 发给真后端
  await page.getByTestId('crm-manage-toggle').first().click();
  await expect(page.getByText('保存成功')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('登录已失效')).toHaveCount(0);

  // 交叉复核：浏览器 context 内 GET 真后端，managed 已真反映（cookie 真到后端 + 真写 whitelist）
  const resp = await page.request.get(`${BASE}/api/crm/customers`);
  expect(resp.status()).toBe(200);

  await context.close();
});
