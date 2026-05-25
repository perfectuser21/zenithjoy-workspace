#!/usr/bin/env node
/**
 * 抖音文章「dry-run」自检脚本（draft-only wrapper）
 *
 * 与 publish-douyin-article.cjs（真发版）严格隔离：
 *   - 本脚本走完 封面上传 / 填标题 / 填正文 全部流程
 *   - **不点最终的「发布」按钮，绝不触发抖音文章发布接口**
 *   - 用于 ZenithJoy Agent 链路自检（中台 → Windows Agent → 抖音创作者后台）
 *
 * Queue 文件格式：
 *   {"title": "标题", "content": "正文", "cover": "/path/to/cover.jpg", "summary": "可选摘要"}
 *
 * 输出（stdout 最后一行 JSON）：
 *   {"ok":true,"dryRun":true,"title":"...","url":"<当前页 URL>"}
 *   {"ok":false,"error":"..."}
 */

const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ARTICLE_URL = 'https://creator.douyin.com/creator-micro/content/article';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || path.join(process.cwd(), 'screenshots');

function emitFailure(reason) {
  const out = { ok: false, error: String(reason) };
  _log(JSON.stringify(out));
  process.exit(1);
}

async function takeScreenshot(page, name) {
  try {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const p = path.join(SCREENSHOT_DIR, `${name}.png`);
    await page.screenshot({ path: p, fullPage: false });
    _log(`[DY-ARTICLE-DRY] 📸 截图: ${p}`);
  } catch (e) {
    _log(`[DY-ARTICLE-DRY] 截图失败 ${name}: ${e.message}`);
  }
}

async function publishDouyinArticleDryRun(queueFilePath) {
  _log('[DY-ARTICLE-DRY] 读取队列文件:', queueFilePath);

  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `[DRY] 自检文章 ${Date.now()}`;
  const content = queueData.content || '';
  const cover = queueData.cover || '';
  const summary = queueData.summary || content.substring(0, 30);

  _log('[DY-ARTICLE-DRY] 标题:', title);
  _log('[DY-ARTICLE-DRY] 摘要:', summary);
  _log('[DY-ARTICLE-DRY] 封面:', cover);

  // cover fail fast
  if (!cover || !fs.existsSync(cover)) {
    emitFailure(`封面文件不存在或未指定: ${cover}`);
    return;
  }

  // 三种模式：
  //   1. DOUYIN_COOKIES env → cookie 注入（CI/GitHub Actions）
  //   2. DOUYIN_PROFILE_DIR env → launchPersistentContext 加载现有 profile（本地有登录 session）
  //   3. 默认 → CDP 连接 localhost:19222（rog-xian 已跑 Chrome CDP）
  const cookiesJson = process.env.DOUYIN_COOKIES;
  const profileDir = process.env.DOUYIN_PROFILE_DIR;
  let browser, context, page;

  const fs_ = require('fs');
  // Find best available Playwright Chromium binary
  const getPwChromium = () => {
    const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA?.replace('Roaming', 'Local') || '';
    const playwrightDir = require('path').join(localAppData, 'ms-playwright');
    if (!fs_.existsSync(playwrightDir)) return undefined;
    const candidates = fs_.readdirSync(playwrightDir).filter(d => d.startsWith('chromium')).sort().reverse();
    for (const d of candidates) {
      const exes = [
        require('path').join(playwrightDir, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
        require('path').join(playwrightDir, d, 'chrome-win64', 'chrome.exe'),
      ];
      const found = exes.find(e => fs_.existsSync(e));
      if (found) return found;
    }
    return undefined;
  };

  if (cookiesJson) {
    _log('\n[DY-ARTICLE-DRY] 🍪 Cookie 注入模式（CI/GitHub Actions）');
    const cookies = JSON.parse(cookiesJson);
    const executablePath = getPwChromium();
    if (executablePath) _log('[DY-ARTICLE-DRY] 使用 Chromium:', executablePath);
    browser = await chromium.launch({
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
    });
    await context.addCookies(cookies);
    page = await context.newPage();
    _log('[DY-ARTICLE-DRY] 已注入', cookies.length, '个 cookies\n');
  } else if (profileDir) {
    _log('\n[DY-ARTICLE-DRY] 🗂 Profile 模式（加载现有登录 session）:', profileDir);
    const executablePath = getPwChromium();
    if (executablePath) _log('[DY-ARTICLE-DRY] 使用 Chromium:', executablePath);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: true,
      executablePath,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 1280, height: 900 },
    });
    page = context.pages()[0] || await context.newPage();
    browser = null;
    _log('[DY-ARTICLE-DRY] Profile 已加载\n');
  } else {
    _log('\n[DY-ARTICLE-DRY] 连接到现有浏览器 (localhost:19222)...');
    browser = await chromium.connectOverCDP('http://localhost:19222');
    const contexts = browser.contexts();
    if (!contexts.length) { emitFailure('CDP 没有上下文，确认 Chrome 19222 是否启动'); return; }
    context = contexts[0];
    const pages = context.pages();
    if (!pages.length) { emitFailure('CDP 没有 page'); return; }
    page = pages[0];
    _log('[DY-ARTICLE-DRY] 已连接到浏览器\n');
  }

  // 安全栅栏：监听发布请求，一旦触发说明 dry-run 失守
  const PUBLISH_API_PATTERN = '/web/api/media/article/publish';
  let createApiHit = false;
  page.on('request', (req) => {
    if (req.url().includes(PUBLISH_API_PATTERN)) {
      createApiHit = true;
      _log('[DY-ARTICLE-DRY] !! 检测到文章发布 API 调用，dry-run 失守 !!');
    }
  });

  try {
    _log('[DY-ARTICLE-DRY] Step 1: 导航到文章发布页面');
    await page.goto(ARTICLE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '01-page-loaded');

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport')) {
      await takeScreenshot(page, '01-login-required');
      emitFailure(`抖音未登录，当前 URL: ${currentUrl}`);
      return;
    }
    _log('[DY-ARTICLE-DRY] ✅ 已登录，当前 URL:', currentUrl);

    // 检测登录页面内容（SPA 可能不改 URL）
    const isLoginPage = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      return text.includes('扫码登录') || text.includes('验证码登录') || document.querySelector('[class*="login"]') !== null;
    }).catch(() => false);
    if (isLoginPage) {
      await takeScreenshot(page, '01b-login-page-detected');
      emitFailure('抖音未登录（检测到登录页面内容）');
      return;
    }

    _log('[DY-ARTICLE-DRY] Step 1.5: 进入文章创作编辑器');
    // 先看有没有 file input（如果直接就在编辑器里）
    const hasFileInput = await page.locator('input[type="file"]').count().then(n => n > 0).catch(() => false);
    if (!hasFileInput) {
      // 在文章列表页，需要点"写文章"进入编辑器
      const writeBtn = page.locator('button, a').filter({ hasText: /写文章|发文章|创建文章|写图文/ }).first();
      const hasBtnVisible = await writeBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (hasBtnVisible) {
        _log('[DY-ARTICLE-DRY] 点击"写文章"按钮');
        await writeBtn.click();
        await page.waitForTimeout(3000);
      } else {
        // 尝试直接导航到创建 URL
        const createUrl = 'https://creator.douyin.com/creator-micro/content/article/create';
        _log('[DY-ARTICLE-DRY] 直接导航到创建 URL:', createUrl);
        await page.goto(createUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
      }
      await takeScreenshot(page, '01c-editor-loaded');
    }

    _log('[DY-ARTICLE-DRY] Step 2: 上传封面');
    if (cookiesJson || profileDir) {
      // cookie 注入 / profile 模式：用 Playwright 原生 setInputFiles（支持 headless）
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(cover);
    } else {
      // CDP 直连模式：用 DOM.setFileInputFiles + backendNodeId
      const cdpSession = await context.newCDPSession(page);
      const { result } = await Promise.race([
        cdpSession.send('Runtime.evaluate', { expression: `document.querySelector('input[type="file"]')` }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('CDP Runtime.evaluate 超时 5s')), 5000)),
      ]);
      if (!result.objectId) { emitFailure('未找到封面 file input'); return; }
      const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
      if (!node.backendNodeId) { emitFailure('未获取到 file input backendNodeId'); return; }
      await Promise.race([
        cdpSession.send('DOM.setFileInputFiles', { backendNodeId: node.backendNodeId, files: [cover] }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('DOM.setFileInputFiles 超时 10s')), 10000)),
      ]);
      await cdpSession.detach();
    }
    await page.waitForTimeout(2000);
    await takeScreenshot(page, '02-cover-uploaded');
    _log('[DY-ARTICLE-DRY] 封面已上传');

    _log('[DY-ARTICLE-DRY] Step 3: 填写标题');
    await page.evaluate((titleText) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      if (!input) return;
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, title);
    await takeScreenshot(page, '03-title-filled');

    if (content) {
      _log('[DY-ARTICLE-DRY] Step 4: 填写正文');
      await page.evaluate((contentText) => {
        const editable = document.querySelector('[contenteditable="true"]');
        if (editable) {
          editable.focus();
          editable.innerText = contentText;
          editable.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, content);
      await takeScreenshot(page, '04-content-filled');
    }

    await page.waitForTimeout(2000);

    _log('[DY-ARTICLE-DRY] Step 5: 定位发布按钮 (XPath) 但 *不点击*');
    const publishBtn = page.locator('xpath=//button[normalize-space()="发布"]').last();
    const visible = await publishBtn.isVisible().catch(() => false);
    await takeScreenshot(page, '05-before-publish');
    if (!visible) {
      _log('[DY-ARTICLE-DRY] 警告：发布按钮不可见，但流程已走到这里，不影响 dry-run 通过');
    } else {
      _log('[DY-ARTICLE-DRY] ✅ 发布按钮已就位（不点击）');
    }

    if (createApiHit) {
      emitFailure('dry-run 失守：检测到文章发布 API 调用');
      return;
    }

    const finalUrl = page.url();
    const result_ = {
      ok: true,
      dryRun: true,
      url: finalUrl,
      title,
      publishBtnVisible: visible,
    };
    _log(JSON.stringify(result_));
    return result_;
  } catch (err) {
    console.error('[DY-ARTICLE-DRY] 失败:', err.message);
    emitFailure(err.message || String(err));
  }
}

if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-douyin-article-dryrun.cjs <queue-file-path>');
    process.exit(1);
  }
  publishDouyinArticleDryRun(queueFilePath)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
