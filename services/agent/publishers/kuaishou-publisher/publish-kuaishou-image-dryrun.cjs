#!/usr/bin/env node
/**
 * 快手图文「dry-run」自检脚本（draft-only wrapper）
 *
 * 三模式（优先级：KUAISHOU_COOKIES > KUAISHOU_PROFILE_DIR > CDP 兜底）：
 *   1. KUAISHOU_COOKIES → chromium.launch headless + context.addCookies
 *   2. KUAISHOU_PROFILE_DIR → chromium.launchPersistentContext
 *   3. 默认 → connectOverCDP 端口 19223
 *
 * 安全约束：
 *   - **绝不上传图片、绝不填表单、绝不点击发布按钮**
 *   - page.route 拦截疑似发布 API，命中即 dry-run 失守 → exit 1
 *
 * 用法：
 *   node publish-kuaishou-image-dryrun.cjs <queue-file-path>
 *
 * 输出：
 *   stdout 最后一行为 JSON：
 *     {"ok":true,"dryRun":true,"url":"<最终页面 URL>","title":"<标题>","imagesCount":<N>}
 *   失败时 exit code 非 0。
 */

'use strict';

const _log = console.log.bind(console);
const { chromium } = require('playwright-core');
const fs = require('fs');

const CDP_URL = 'http://localhost:19223';
const PUBLISH_URL = 'https://cp.kuaishou.com/article/publish/photo';
const FORBIDDEN_API_PATTERNS = [
  '/rest/cp/works/',
  '/rest/cp/photo/publish',
];

async function buildContext() {
  const cookiesEnv = process.env.KUAISHOU_COOKIES;
  const profileDir = process.env.KUAISHOU_PROFILE_DIR;

  if (cookiesEnv) {
    _log('[KS-DRY] 模式: KUAISHOU_COOKIES（chromium.launch + addCookies）');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const cookies = JSON.parse(cookiesEnv);
    await context.addCookies(cookies);
    return { browser, context };
  }

  if (profileDir) {
    _log('[KS-DRY] 模式: KUAISHOU_PROFILE_DIR（launchPersistentContext）');
    const context = await chromium.launchPersistentContext(profileDir, { headless: false });
    return { browser: null, context };
  }

  _log('[KS-DRY] 模式: CDP connectOverCDP', CDP_URL);
  const browser = await chromium.connectOverCDP(CDP_URL);
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP 没有上下文，确认 Chrome 19223 是否登录快手');
  return { browser, context: contexts[0] };
}

async function main(queueFilePath) {
  _log('[KS-DRY] 读取队列文件:', queueFilePath);
  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `[DRY] 自检 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter((f) => fs.existsSync(f));

  _log('[KS-DRY] 标题:', title);
  _log('[KS-DRY] 文案:', content.substring(0, 50));
  _log('[KS-DRY] 图片(本地):', localImages.length, '张');

  const { browser, context } = await buildContext();

  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();
  _log('[KS-DRY] 已获取 page');

  // page.route 安全栅栏 — 拦截发布 API，命中即 dry-run 失守
  let forbiddenApiHit = null;
  await page.route(/\/(rest\/cp\/works\/|rest\/cp\/photo\/publish)/, async (route) => {
    const method = route.request().method();
    const url = route.request().url();
    if (method === 'POST' || method === 'PUT') {
      forbiddenApiHit = `${method} ${url}`;
      _log('[KS-DRY] !! 检测到疑似发布 API !!', forbiddenApiHit);
      await route.abort();
      return;
    }
    await route.continue();
  });

  try {
    _log('[KS-DRY] Step 1: 导航到发布图文页');
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      throw new Error(`快手未登录，当前 URL: ${url1}`);
    }

    _log('[KS-DRY] Step 2: 验证页面已就位（不操作 DOM）');
    await page.waitForTimeout(2000);
    const finalUrl = page.url();
    _log('[KS-DRY] 当前 URL:', finalUrl);

    if (forbiddenApiHit) {
      throw new Error(`dry-run 失守：检测到 ${forbiddenApiHit}`);
    }

    const result = {
      ok: true,
      dryRun: true,
      url: finalUrl,
      title: title,
      imagesCount: localImages.length,
    };
    _log(JSON.stringify(result));

    if (browser) await browser.close();
    else await context.close();

    return result;
  } catch (err) {
    console.error('[KS-DRY] 失败:', err.message);
    if (browser) await browser.close().catch(() => {});
    else await context.close().catch(() => {});
    throw err;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-kuaishou-image-dryrun.cjs <queue-file-path>');
  process.exit(1);
}

main(queueFilePath)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
