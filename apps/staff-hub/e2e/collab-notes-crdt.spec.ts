/**
 * 路② 协同笔记 CRDT 双人同编 E2E（windows_cloud，变体C 死规则：禁请求拦截/stub，全打真后端）
 *
 * 两个 browser context 模拟甲乙两人（真 cookie 会话，各自 API 登录），四组硬 DOM 断言：
 *   ① 同编不同段落 → 字符级合并双方改动均在（非 409）；
 *   ② 对方 awareness 光标/选区元素（.collab-remote-cursor）可见；
 *   ③ 断连 resync 零丢字：A setOffline(true) 断网、A/B 各自离线输入 α/β、A 只读横幅可见、
 *      A setOffline(false) 重连 → 两 context 最终 DOM 均含 α 与 β（零丢字，不止验横幅存在）；
 *   ④ 设「仅自己」(private) 后第三 context 打开该文档得 404（不存在/无权）。
 *
 * 会话怎么来：spec 在各自 context 内调真 /api/staff/feishu-login（同源，经 vite 反代到 apps/api），
 * cookie 自然落进该 context 的 cookie jar，随后导航即已鉴权 —— 不伪造 cookie、不拦截任何请求。
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5174';
const ALICE = process.env.E2E_ALICE_OPENID || '';
const BOB = process.env.E2E_BOB_OPENID || '';
const SHOT_DIR = process.env.E2E_SHOT_DIR || path.resolve(__dirname, '../../../sprints/08221200-line11-path2-collab-notes/screenshots');

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: true }).catch(() => undefined);
}

async function loginContext(context: BrowserContext, openId: string): Promise<void> {
  const res = await context.request.post(`${BASE}/api/staff/feishu-login`, {
    data: { code: `wb-code-${openId}` },
  });
  expect(res.ok(), `登录失败 ${openId}: ${res.status()}`).toBeTruthy();
}

async function openEditor(page: Page, docId: string): Promise<void> {
  await page.goto(`${BASE}/collab/${docId}`);
  await expect(page.locator('[data-testid="collab-editor"] .ProseMirror')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-testid="collab-status"]')).toContainText('已连接', { timeout: 15000 });
}

async function typeInto(page: Page, text: string): Promise<void> {
  const editor = page.locator('[data-testid="collab-editor"] .ProseMirror');
  await editor.click();
  await page.keyboard.type(text, { delay: 20 });
}

test('双人同编：字符级合并 + 多人光标 + 断连 resync 零丢字 + 仅自己 404', async ({ browser }) => {
  test.setTimeout(120000);

  // ── 甲：登录 + 建文档 ──────────────────────────────────────────────────────
  const ctxA = await browser.newContext();
  await loginContext(ctxA, ALICE);
  const created = await ctxA.request.post(`${BASE}/api/workbench/documents`, {
    data: { title: 'CRDT 双人同编' },
  });
  expect(created.ok()).toBeTruthy();
  const docId = (await created.json()).data.id as string;

  // ── 乙：登录 ───────────────────────────────────────────────────────────────
  const ctxB = await browser.newContext();
  await loginContext(ctxB, BOB);

  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  await openEditor(pageA, docId);
  await openEditor(pageB, docId);
  await shot(pageA, '01-two-editors.png');

  // ① 字符级合并：甲乙各输入可辨识文本，双方 DOM 均含两串（非 409）
  await typeInto(pageA, '甲甲甲AAA');
  await pageA.waitForTimeout(600);
  await typeInto(pageB, '乙乙乙BBB');
  await pageA.waitForTimeout(1200);

  const aText1 = await pageA.locator('[data-testid="collab-editor"] .ProseMirror').innerText();
  const bText1 = await pageB.locator('[data-testid="collab-editor"] .ProseMirror').innerText();
  expect(aText1).toContain('甲甲甲AAA');
  expect(aText1).toContain('乙乙乙BBB');
  expect(bText1).toContain('甲甲甲AAA');
  expect(bText1).toContain('乙乙乙BBB');

  // ② 多人光标：对方光标/选区元素可见
  await expect(pageA.locator('.collab-remote-cursor').first()).toBeVisible({ timeout: 10000 });
  await shot(pageA, '02-merged-cursors.png');

  // ③ 断连 resync 零丢字：A 断网，A/B 各自离线输入 α/β，A 横幅可见，A 重连 → 两端均含 α 与 β
  const ALPHA = 'ΑΛΦΑ阿尔法111';
  const BETA = 'ΒΗΤΑ贝塔222';
  await ctxA.setOffline(true);
  await expect(pageA.locator('[data-testid="offline-banner"]')).toBeVisible({ timeout: 15000 });
  await typeInto(pageA, ALPHA);
  await typeInto(pageB, BETA);
  await pageA.waitForTimeout(800);
  await ctxA.setOffline(false);
  await expect(pageA.locator('[data-testid="collab-status"]')).toContainText('已连接', { timeout: 20000 });
  await pageA.waitForTimeout(2500);

  const aText2 = await pageA.locator('[data-testid="collab-editor"] .ProseMirror').innerText();
  const bText2 = await pageB.locator('[data-testid="collab-editor"] .ProseMirror').innerText();
  expect(aText2, 'A 重连后应含 α 与 β 两串离线文本（零丢字）').toContain(ALPHA);
  expect(aText2).toContain(BETA);
  expect(bText2, 'B 应含 α 与 β 两串离线文本（零丢字）').toContain(ALPHA);
  expect(bText2).toContain(BETA);
  await shot(pageA, '03-resync-merged.png');

  // ④ 设「仅自己」后第三 context 打开该文档得 404
  const setPriv = await ctxA.request.put(`${BASE}/api/workbench/documents/${docId}/visibility`, {
    data: { visibility: 'private' },
  });
  expect(setPriv.ok()).toBeTruthy();

  const ctxC = await browser.newContext();
  await loginContext(ctxC, BOB); // 乙（同组织他人），设 private 后应打不开
  const pageC = await ctxC.newPage();
  await pageC.goto(`${BASE}/collab/${docId}`);
  await expect(pageC.locator('[data-testid="doc-not-found"]')).toBeVisible({ timeout: 15000 });
  await shot(pageC, '04-private-404.png');

  await ctxA.close();
  await ctxB.close();
  await ctxC.close();
});
