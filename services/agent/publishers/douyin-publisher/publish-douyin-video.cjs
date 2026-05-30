#!/usr/bin/env node
/**
 * 抖音视频「真发版」脚本（production wrapper）
 *
 * !! 警告 — 本脚本会真点抖音「发布」按钮，会把视频真发到抖音公网 !!
 *
 * 启用条件：
 *   只有 `services/agent/src/handlers/douyin-publish.ts` 在
 *   ZENITHJOY_AGENT_REAL_PUBLISH=1 + payload.type=video 时 spawn 本脚本。
 *   默认走 dryrun 脚本，开发机绝不会意外触发本脚本。
 *
 * 用法：
 *   node publish-douyin-video.cjs <queue-file-path>
 *
 * Queue 文件格式（同 dryrun）：
 *   {"title": "...", "content": "...", "video_path": "/path/to/x.mp4", "tags": ["t1","t2"]}
 *
 * 输出：
 *   stdout 最后一行 JSON：
 *     {"ok":true,"dryRun":false,"url":"<抖音视频 URL>","title":"..."}
 *     {"ok":false,"error":"..."}
 *
 * Risks (contract R1-R5):
 *   R1 抖音风控  → 输出 ok:false + error 含 'risk' 关键词，由 Agent 触发 ASSUMPTION 5 降级
 *   R3 UI 改版   → selector 失败时 page.screenshot 存 ~/.zenithjoy/agent-fail-screenshots/
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const _log = console.log.bind(console);
const { chromium } = require('playwright-core');
const { requireLogin } = require('./lib/qr-login.cjs');

const RISK_KEYWORDS = ['风险', '拦截', '频繁', '异常', '验证码', '风控'];
const FAIL_SCREENSHOT_DIR = path.join(os.homedir(), '.zenithjoy', 'agent-fail-screenshots');

function emitFailure(reason) {
  const out = { ok: false, error: String(reason) };
  _log(JSON.stringify(out));
  process.exit(1);
}

async function captureFailScreenshot(page, taskHint) {
  try {
    fs.mkdirSync(FAIL_SCREENSHOT_DIR, { recursive: true });
    const p = path.join(FAIL_SCREENSHOT_DIR, `${taskHint}-${Date.now()}.png`);
    await page.screenshot({ path: p, fullPage: true });
    return p;
  } catch (e) {
    return null;
  }
}

async function getBrowserAndPage() {
  // Cookie injection mode (GitHub Actions / CI sandbox)
  const cookiesJson = process.env.DOUYIN_COOKIES;
  if (cookiesJson) {
    _log('[DY-VIDEO-REAL] Cookie 注入模式（GitHub Actions）');
    const _parsed = JSON.parse(cookiesJson);
    const cookies = Array.isArray(_parsed) ? _parsed : (_parsed.cookies ?? []);
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    await ctx.addCookies(cookies);
    const page = await ctx.newPage();
    _log('[DY-VIDEO-REAL] 已注入', cookies.length, '个 cookies');
    // Auth check: navigate to home and verify React renders logged-in UI (not login form).
    // Douyin creator SPA does NOT redirect URL on auth failure — it renders the login form
    // at whatever URL you navigate to. We must wait for React hydration and check body text.
    await page.goto('https://creator.douyin.com/creator-micro/home', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const homeUrl = page.url();
    _log('[DY-VIDEO-REAL] home URL:', homeUrl);
    if (/login|passport|sign/i.test(homeUrl)) {
      const shot = await captureFailScreenshot(page, 'cookie-auth-fail');
      await browser.close();
      throw new Error(`DOUYIN_COOKIES 无效（URL 重定向到登录页）: ${homeUrl}，请更新 GitHub secret DOUYIN_COOKIES (screenshot: ${shot || 'n/a'})`);
    }
    // Wait for React to hydrate — the SPA starts with landing/login page HTML,
    // then after client-side auth check renders either the creator UI or the login form.
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    const homeBodyText = await page.evaluate(() => document.body.innerText.substring(0, 300)).catch(() => '');
    _log('[DY-VIDEO-REAL] home bodyText(300):', homeBodyText.replace(/\n/g, '|'));
    const isLoginFormShowing = /扫码登录|密码登录|验证码登录|账号登录/.test(homeBodyText);
    if (isLoginFormShowing) {
      const shot = await captureFailScreenshot(page, 'cookie-auth-content-fail');
      await browser.close();
      throw new Error(
        'DOUYIN_COOKIES 无效或已过期：首页 React 渲染后仍显示登录表单（扫码登录/密码登录），' +
        '请重新导出抖音 creator center 的 cookies 并更新 GitHub secret DOUYIN_COOKIES ' +
        `(screenshot: ${shot || 'n/a'})`
      );
    }
    _log('[DY-VIDEO-REAL] ✓ 首页 auth 验证通过（未见登录表单）');
    return { browser, page, context: ctx, isLaunched: true };
  }
  const sessionPath = path.join(
    os.homedir(), '.zenithjoy-agent', 'sessions', 'douyin',
    (process.env.ZENITHJOY_DOUYIN_ACCOUNT || 'default') + '.json'
  );
  if (fs.existsSync(sessionPath)) {
    _log('[DY-VIDEO-REAL] 加载 QR-bind session:', sessionPath);
    const storageState = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    const browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const ctx = await browser.newContext({ storageState });
    const page = await ctx.newPage();
    await page.goto('https://creator.douyin.com/creator-micro/home', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    const url = page.url();
    if (/login|passport/i.test(url)) {
      await browser.close();
      throw new Error('session 已过期，请在 Dashboard 重新扫码绑定抖音账号');
    }
    _log('[DY-VIDEO-REAL] session 有效，已到:', url);
    return { browser, page, context: ctx, isLaunched: true };
  }
  _log('[DY-VIDEO-REAL] 无保存 session，回退 CDP (localhost:19222)');
  const browser = await chromium.connectOverCDP(
    process.env.ZENITHJOY_AGENT_CDP_URL || 'http://localhost:19222'
  );
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('CDP 没有上下文');
  const page = ctx.pages()[0] || await ctx.newPage();
  const currentUrl = page.url();
  if (!/creator(-micro)?\.douyin\.com\/(creator-micro|content)/.test(currentUrl)) {
    await requireLogin({ injectedPage: page });
  }
  return { browser, page, context: null, isLaunched: false };
}

async function publishDouyinVideoReal(queueData) {
  _log('[DY-VIDEO-REAL] 标题:', queueData.title);
  _log('[DY-VIDEO-REAL] video_path:', queueData.video_path);

  if (!fs.existsSync(queueData.video_path)) {
    throw new Error(`video file not found: ${queueData.video_path}`);
  }

  const { browser, page, context, isLaunched } = await getBrowserAndPage();
  try {
    _log('[DY-VIDEO-REAL] 进入视频上传页...');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=1', {
      waitUntil: 'domcontentloaded',
    });
    const uploadUrl = page.url();
    _log('[DY-VIDEO-REAL] 上传页 URL:', uploadUrl);
    if (/login|passport|sign/i.test(uploadUrl)) {
      const shot = await captureFailScreenshot(page, 'upload-login-redirect');
      throw new Error(`上传页重定向到登录: ${uploadUrl} (screenshot: ${shot || 'n/a'})`);
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Wait for upload UI to appear OR detect login-page state.
    // Douyin SPA renders landing/login page initially, then hydrates to the actual UI.
    // We can't rely on [data-e2e] since upload page may not use it — instead detect
    // login form text as a failure signal, or upload-related elements as success.
    _log('[DY-VIDEO-REAL] 等待上传界面出现 (最多 20s)...');
    const uploadReady = await page.waitForFunction(() => {
      const text = document.body.innerText;
      if (/扫码登录|密码登录|验证码登录/.test(text)) return 'login';
      if (document.querySelectorAll('[class*="upload"],[class*="Upload"],[data-e2e]').length > 0) return 'upload';
      return false;
    }, { timeout: 20000 }).catch(() => null);
    const uploadReadyVal = uploadReady ? await uploadReady.jsonValue().catch(() => null) : null;
    _log('[DY-VIDEO-REAL] uploadReady:', uploadReadyVal);
    if (uploadReadyVal === 'login') {
      const shot = await captureFailScreenshot(page, 'upload-page-login-form');
      throw new Error(
        '上传页 React 仍显示登录表单，DOUYIN_COOKIES 已过期，' +
        `请重新导出 creator center cookies 更新 GitHub secret (screenshot: ${shot || 'n/a'})`
      );
    }

    _log('[DY-VIDEO-REAL] 上传视频...');
    await uploadVideoFile(page, context, queueData.video_path);
    _log('[DY-VIDEO-REAL] 等抖音处理...');
    await waitForUploadProcessed(page);
    _log('[DY-VIDEO-REAL] 填标题...');
    await fillTitle(page, queueData.title);

    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    for (const kw of RISK_KEYWORDS) {
      if (bodyText.includes(kw)) {
        const shot = await captureFailScreenshot(page, 'risk');
        throw new Error(`risk: 抖音风控关键词命中 "${kw}" (screenshot: ${shot || 'n/a'})`);
      }
    }

    _log('[DY-VIDEO-REAL] 点击发布按钮...');
    await clickPublishButton(page);

    _log('[DY-VIDEO-REAL] 抓最终视频 URL...');
    const { url, urlFallback } = await extractPublishedUrl(page);

    const out = { ok: true, dryRun: false, url, urlFallback, title: queueData.title };
    _log(JSON.stringify(out));
  } catch (e) {
    const shot = await captureFailScreenshot(page, 'fail');
    throw new Error(`${e.message} (screenshot: ${shot || 'n/a'})`);
  } finally {
    if (isLaunched) await browser.close().catch(() => {});
  }
}

async function main() {
  const queueFile = process.argv[2];
  if (!queueFile) emitFailure('usage: node publish-douyin-video.cjs <queue-file>');
  if (!fs.existsSync(queueFile)) emitFailure(`queue file not found: ${queueFile}`);

  const queueData = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  if (!queueData.video_path) emitFailure('queue.video_path missing');

  try {
    await publishDouyinVideoReal(queueData);
  } catch (e) {
    emitFailure(e.message || String(e));
  }
}

// ============================================================================
// 5 个抽出的 DOM selector 函数（playwright 等价封装 user-skill raw CDP 实现）
// ============================================================================

const REACT_HYDRATE_WAIT_MS = 3000;
const FILE_CHOOSER_TIMEOUT_MS = 3000;
const CLICK_TIMEOUT_MS = 800;
const FILE_INPUT_FALLBACK_TIMEOUT_MS = 60000;

async function uploadVideoFile(page, context, videoPath) {
  // Wait for React upload component to mount — Douyin creator SPA needs time after domcontentloaded
  await page.waitForTimeout(REACT_HYDRATE_WAIT_MS);

  // Diagnostic — body text + readyState to understand page state
  const diag = await page.evaluate(() => {
    const fileInputCount = document.querySelectorAll('input[type="file"]').length;
    const uploadEls = [...document.querySelectorAll('[class*="upload"],[class*="Upload"],[class*="drag"],[data-e2e]')];
    const allEls = document.querySelectorAll('*').length;
    const title = document.title || '';
    const bodyText = document.body.innerText.substring(0, 500);
    const readyState = document.readyState;
    return {
      fileInputCount,
      allEls,
      title,
      readyState,
      uploadEls: uploadEls.slice(0, 8).map(e => `${e.tagName}[de2e="${e.getAttribute('data-e2e')||''}"][cls="${(e.className||'').substring(0,30)}"]`),
      bodyText,
    };
  }).catch(e => ({ error: e.message }));
  _log('[DY-VIDEO-REAL] 页面诊断:', JSON.stringify(diag).substring(0, 1200));

  const failures = [];

  // Strategy 1: Playwright-native click + FileChooser (survives hashed CSS & shadow DOM)
  const clickSelectors = [
    '[data-e2e="upload-btn"]', '[data-e2e*="upload"]',
    '[class*="upload-btn"]', '[class*="uploadBtn"]',
    '[class*="upload-area"]', '[class*="uploadArea"]',
    '[class*="Upload"]', 'input[type="file"]',
    'text=点击上传', 'text=上传视频', 'text=选择文件', 'text=上传',
  ];
  for (const sel of clickSelectors) {
    let _fcPromise;
    try {
      _fcPromise = page.waitForEvent('filechooser', { timeout: FILE_CHOOSER_TIMEOUT_MS });
      await page.click(sel, { timeout: CLICK_TIMEOUT_MS });
      const fc = await _fcPromise;
      await fc.setFiles(videoPath);
      _log('[DY-VIDEO-REAL] ✓ FileChooser 成功 selector:', sel);
      return;
    } catch (e) {
      if (_fcPromise) _fcPromise.catch(() => {});
      failures.push(`FC(${sel}): ${e.message.substring(0, 60)}`);
    }
  }
  _log('[DY-VIDEO-REAL] Strategy 1 全失败，尝试 CDP...');

  // Strategy 2: CDP with recursive shadow DOM traversal
  if (context) {
    try {
      const cdpSession = await context.newCDPSession(page);
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: `(function f(r){var i=r.querySelector('input[type="file"]');if(i)return i;for(var e of r.querySelectorAll('*'))if(e.shadowRoot){var x=f(e.shadowRoot);if(x)return x;}return null;})(document)`,
      });
      if (!result.objectId) throw new Error('file input 在完整 shadow DOM 树中也不存在');
      const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
      await cdpSession.send('DOM.setFileInputFiles', {
        backendNodeId: node.backendNodeId,
        files: [videoPath],
      });
      _log('[DY-VIDEO-REAL] ✓ CDP shadow DOM 成功');
      return;
    } catch (e2) {
      failures.push(`CDP: ${e2.message.substring(0, 80)}`);
      _log('[DY-VIDEO-REAL] Strategy 2 失败:', e2.message.substring(0, 120));
    }
  } else {
    failures.push('CDP: context 未定义（getBrowserAndPage 未传递 context）');
    _log('[DY-VIDEO-REAL] context 未定义，跳过 CDP');
  }

  // Strategy 3: setInputFiles fallback — last resort, fails fast with full error context
  _log('[DY-VIDEO-REAL] Strategy 3: setInputFiles fallback...');
  try {
    await page.setInputFiles('input[type="file"]', videoPath, { timeout: FILE_INPUT_FALLBACK_TIMEOUT_MS });
    _log('[DY-VIDEO-REAL] ✓ setInputFiles 成功');
  } catch (e3) {
    failures.push(`setInputFiles: ${e3.message.substring(0, 80)}`);
    throw new Error(
      `视频上传全部策略均失败（共 ${failures.length} 次），抖音页面可能已改版或未正常加载。` +
      `诊断: fileInputCount=${diag.fileInputCount}。失败摘要: ${failures.slice(-3).join(' | ')}`
    );
  }
}

async function waitForUploadProcessed(page, timeoutMs = 60_000) {
  // 抖音上传完成后会跳到 /creator-micro/content/post/video，标题输入框 hydrate 出来
  await page.waitForSelector('input[placeholder*="标题"]', { timeout: timeoutMs });
}

async function fillTitle(page, title) {
  const titleInput = page.locator('input[placeholder*="标题"]').first();
  await titleInput.waitFor({ state: 'visible', timeout: 10_000 });
  await titleInput.fill(title);
}

async function clickPublishButton(page) {
  // exact: true 严格 match button text="发布"，排除 nav bar "高清发布" + dropdown "发布视频/图文/全景/文章"
  // 抖音真发布按钮是视频处理完后 fixed bottom 那个 text="发布"，不是 nav bar 40x40 图标
  const publishBtn = page.getByRole('button', { name: '发布', exact: true }).first();
  await publishBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await publishBtn.click();
}

async function extractPublishedUrl(page) {
  // 等跳到 manage 或 home（最多 60s）
  try {
    await page.waitForURL(/\/creator-micro\/(content\/manage|home)/, { timeout: 60_000 });
  } catch {
    // 没跳转也不算 fail，继续看能不能从当前 page 提 URL
  }
  // 从作品列表抓最近一条的公开 URL
  const videoHref = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="douyin.com/video/"]'));
    if (!links.length) return null;
    let href = links[0].getAttribute('href') || '';
    if (href.startsWith('//')) href = 'https:' + href;
    return href;
  });
  if (!videoHref) {
    // fallback: 列表 hydrate 滞后时返回管理页 URL，lead 肉眼能看到刚发的视频在列表第一条
    return { url: page.url(), urlFallback: true };
  }
  return { url: videoHref, urlFallback: false };
}

// 暴露给单测
module.exports = {
  uploadVideoFile,
  waitForUploadProcessed,
  fillTitle,
  clickPublishButton,
  extractPublishedUrl,
};

if (require.main === module) {
  main();
}
