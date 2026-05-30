#!/usr/bin/env node
/**
 * 抖音文章「真发版」脚本（production wrapper）
 *
 * !! 警告 — 本脚本会真点抖音创作者后台「发布」按钮，会真发布文章，会污染抖音公网 !!
 *
 * 与 publish-douyin-article-dryrun.cjs 严格隔离：
 *   - dryrun 用于开发 / CI smoke / 链路自检（不点发布、断言就位即停）
 *   - 本脚本用于客户机真实发布场景
 *
 * 启用条件（双重保险）：
 *   只有在 ZENITHJOY_AGENT_REAL_PUBLISH=1 时才会 spawn 本脚本。
 *   默认走 dryrun 脚本（安全优先）。
 *
 * Queue 文件格式：
 *   {"title": "标题", "content": "正文", "cover": "/path/to/cover.jpg", "summary": "可选摘要"}
 *
 * 输出（stdout 最后一行 JSON）：
 *   {"ok":true,"dryRun":false,"title":"...","url":"..."}
 *   {"ok":false,"error":"..."}
 *   并 exit 1（错误兜底，让 Agent handler 收到结构化错误）
 */

const _log = console.log.bind(console);
const { chromium } = require('playwright-core');
const fs = require('fs');

const ARTICLE_URL = 'https://creator.douyin.com/creator-micro/content/article';

function emitFailure(reason) {
  const out = { ok: false, error: String(reason) };
  _log(JSON.stringify(out));
  return out;
}

async function publishDouyinArticleReal(queueFilePath) {
  _log('[DY-ARTICLE] 读取队列文件:', queueFilePath);

  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `自动发布文章 ${Date.now()}`;
  const content = queueData.content || '';
  const cover = queueData.cover || '';
  const summary = queueData.summary || content.substring(0, 30);

  _log('[DY-ARTICLE] 标题:', title);
  _log('[DY-ARTICLE] 摘要:', summary);
  _log('[DY-ARTICLE] 封面:', cover);

  // cover fail fast — existsSync 检查，cover 不存在则提前退出
  if (!cover || !fs.existsSync(cover)) {
    return emitFailure(`封面文件不存在或未指定: ${cover}`);
  }

  let browser, context, page;
  const cookiesJson = process.env.DOUYIN_COOKIES;
  if (cookiesJson) {
    _log('[DY-ARTICLE] Cookie 注入模式（GitHub Actions）');
    const _parsed = JSON.parse(cookiesJson);
    const cookies = Array.isArray(_parsed) ? _parsed : (_parsed.cookies ?? []);
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies(cookies);
    page = await context.newPage();
    _log('[DY-ARTICLE] 已注入', cookies.length, '个 cookies\n');
  } else {
    _log('\n[DY-ARTICLE] 连接到现有浏览器 (localhost:19222)...');
    browser = await chromium.connectOverCDP('http://localhost:19222');
    const ctxList = browser.contexts();
    if (!ctxList.length) {
      return emitFailure('CDP 没有上下文，确认 Chrome 19222 是否启动');
    }
    context = ctxList[0];
    const pageList = context.pages();
    if (!pageList.length) {
      return emitFailure('CDP 没有 page');
    }
    page = pageList[0];
    _log('[DY-ARTICLE] 已连接到浏览器\n');
  }

  try {
    _log('[DY-ARTICLE] Step 1: 导航到文章发布页面');
    await page.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded' });
    const currentUrl = page.url();
    _log('[DY-ARTICLE] 文章页 URL:', currentUrl);
    if (currentUrl.includes('login') || currentUrl.includes('passport') || currentUrl.includes('sign')) {
      return emitFailure(`抖音未登录 (DOUYIN_COOKIES 无效/过期)，当前 URL: ${currentUrl}，请更新 GitHub secret`);
    }
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    _log('[DY-ARTICLE] Step 2: 上传封面 (DOM.setFileInputFiles + backendNodeId)');
    const cdpSession = await context.newCDPSession(page);

    // CDP timeout 5s fail fast — 超时说明页面结构异常
    const { result } = await Promise.race([
      cdpSession.send('Runtime.evaluate', {
        expression: `document.querySelector('input[type="file"]')`,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP Runtime.evaluate 超时 5s')), 5000)),
    ]);

    if (!result.objectId) {
      return emitFailure('未找到封面 file input');
    }
    const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
    if (!node.backendNodeId) {
      return emitFailure('未获取到 file input backendNodeId');
    }
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId: node.backendNodeId,
      files: [cover],
    });
    _log('[DY-ARTICLE] 封面已上传');

    await page.waitForTimeout(2000);

    _log('[DY-ARTICLE] Step 3: 填写标题');
    await page.evaluate((titleText) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      if (!input) return;
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, title);

    if (content) {
      _log('[DY-ARTICLE] Step 4: 填写正文');
      await page.evaluate((contentText) => {
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.focus();
          editable.innerText = contentText;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, content);
    }

    await page.waitForTimeout(2000);

    _log('[DY-ARTICLE] Step 5: 点击发布按钮 (XPath)');
    // 使用 XPath 定位发布按钮（不用 Playwright text selector）
    const publishBtn = page.locator('xpath=//button[normalize-space()="发布"]').last();

    try {
      await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      return emitFailure(`发布按钮未就绪: ${e.message}`);
    }

    const enabled = await publishBtn.isEnabled().catch(() => false);
    if (!enabled) {
      return emitFailure('发布按钮存在但 disabled — 可能表单未通过校验');
    }

    _log('[DY-ARTICLE] 点击发布');
    await publishBtn.click();

    _log('[DY-ARTICLE] 等待发布完成 (30s 超时)');
    let postUrl = '';
    try {
      await Promise.race([
        page.waitForURL(/\/content\/manage/, { timeout: 30000 }),
        page.waitForURL(/\/creator-micro\/content\/manage/, { timeout: 30000 }),
      ]);
      postUrl = page.url();
      _log('[DY-ARTICLE] 跳转完成:', postUrl);
    } catch (e) {
      return emitFailure(`30s 内未跳转到发布完成页: ${e.message}`);
    }

    const out = { ok: true, dryRun: false, url: postUrl, title };
    _log(JSON.stringify(out));
    return out;
  } catch (err) {
    console.error('[DY-ARTICLE] 失败:', err.message);
    emitFailure(err.message || String(err));
    throw err;
  }
}

if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-douyin-article.cjs <queue-file-path>');
    process.exit(1);
  }
  publishDouyinArticleReal(queueFilePath)
    .then((res) => process.exit(res && res.ok ? 0 : 1))
    .catch(() => process.exit(1));
}
