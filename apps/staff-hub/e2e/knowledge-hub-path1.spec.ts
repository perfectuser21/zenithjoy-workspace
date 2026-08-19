/**
 * 员工知识中枢 路① 第一刀 —— 真实浏览器 UI E2E
 *
 * 打真后端、真 Postgres、真 Cecelia 账本，**禁止拦截/改写任何网络请求**（既有 e2e 车道内置该守卫，
 * 源码里出现路由拦截 API 即判红）：这条链路的价值全在"用户真能看到自己刚沉淀那条"，
 * 把请求 stub 掉就只剩前端自说自话。
 *
 * VITE_SKIP_AUTH=true 固定的是**前端导航门禁**（AuthContext 的客户端态），
 * 于是本 spec 的唯一变量是**服务端会话**：没有会话 → knowledgeFetch 收 401 → 页面渲染
 * 会话失效提示；有会话 → 列表可见。授权判定 100% 在服务端 knowledgeAuthGuard。
 *
 * 最后一步交叉回读：UI 上看到的那一行，其 testid 里的 entry_id 必须与后端返回的一致，
 * 并落到 kh-e2e-entry-id.txt 供 ps1 回查账本 —— 防的是"前端渲染了一条其实没落库的假条目"。
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const SHOT_DIR = path.resolve(process.cwd(), 'screenshots');

function shot(name: string): string {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  return path.join(SHOT_DIR, name);
}

test('员工走完 Golden Path：登录 → 录入 → 最近沉淀看到本人这条带证据链接', async ({ page }) => {
  const unique = `E2E 结论 ${Date.now()}`;
  const evidenceUrl = `https://github.com/perfectuser21/zenithjoy-workspace/pull/e2e-${Date.now()}`;

  // 1. 有前端门禁但无服务端会话 → 知识页渲染得出来，内容区是会话失效提示
  await page.goto('/knowledge/recent');
  await expect(page.getByTestId('knowledge-session-expired')).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('knowledge-session-expired')).toHaveText('登录已失效，请重新登录');

  // 2. 走真实 feishu-login 拿服务端会话。page.request 与页面共用同一 cookie jar，
  //    经 vite preview 反代打到真 apps/api；不用 /login/feishu 路由——已登录 shell 下它被重定向到 /
  const login = await page.request.post('/api/staff/feishu-login', {
    data: { code: process.env.E2E_LOGIN_CODE },
  });
  expect(login.status()).toBe(200);

  // 3. 录入页提交
  await page.goto('/knowledge/new');
  await page.getByTestId('knowledge-trigger-condition').fill('E2E 触发条件');
  await page.getByTestId('knowledge-conclusion').fill(unique);
  await page.getByTestId('knowledge-evidence-url').fill(evidenceUrl);
  await page.screenshot({ path: shot('01-initial.png') });

  await page.getByTestId('knowledge-submit').click();
  await expect(page.getByTestId('knowledge-submit-result')).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: shot('02-action.png') });

  // 4. 「最近沉淀」页 30 秒内可见该条 + 证据链接可点
  await page.goto('/knowledge/recent');
  const row = page.locator('[data-testid^="knowledge-entry-"]').filter({ hasText: unique }).first();
  await expect(row).toBeVisible({ timeout: 30000 });
  await expect(row.getByRole('link')).toHaveAttribute('href', evidenceUrl);
  await page.screenshot({ path: shot('03-result.png') });

  // 5. 交叉验证后端 + 落下 entry_id 供 ps1 回读账本（防前端撒谎）
  const api = await page.request.get('/api/staff/knowledge/recent');
  expect(api.status()).toBe(200);
  const body = (await api.json()) as { data: { items: Array<{ entry_id: string; conclusion: string }> } };
  const hit = body.data.items.find((i) => i.conclusion === unique);
  if (!hit) throw new Error('FAIL: 后端未见该条');
  expect(await row.getAttribute('data-testid')).toBe(`knowledge-entry-${hit.entry_id}`);

  fs.writeFileSync(path.resolve(process.cwd(), 'kh-e2e-entry-id.txt'), hit.entry_id);
  console.log('KH-E2E ui-entry-id=' + hit.entry_id);
});
