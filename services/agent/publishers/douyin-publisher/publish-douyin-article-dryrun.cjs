#!/usr/bin/env node
/**
 * 抖音文章「dry-run」自检脚本（draft-only wrapper）v2
 *
 * 与 publish-douyin-article.cjs（真发版）严格隔离：
 *   - 本脚本走完 封面上传 / 填标题 / 填正文 全部流程
 *   - **不点最终的「发布」按钮，绝不触发抖音文章发布接口**
 *   - 用于 ZenithJoy Agent 链路自检（中台 → Windows Agent → 抖音创作者后台）
 *
 * 导航流（抖音文章创作入口通过上传页 tab 进入，不能直接跳转）：
 *   /content/upload → 关弹窗 → 点「发布文章」tab → 点「我要发文」→ 编辑器
 *
 * Queue 文件格式：
 *   {"title": "标题", "content": "正文", "cover": "/path/to/cover.jpg", "summary": "可选摘要"}
 *
 * 输出（stdout 最后一行 JSON）：
 *   {"ok":true,"dryRun":true,"title":"...","url":"<当前页 URL>"}
 *   {"ok":false,"error":"..."}
 *
 * 三种模式：
 *   1. DOUYIN_COOKIES env → cookie 注入（CI/GitHub Actions）
 *   2. DOUYIN_PROFILE_DIR env → launchPersistentContext（本地有登录 session）
 *   3. 默认 → CDP 连接 localhost:19222
 */

const _log = console.log.bind(console);
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload';
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
    // Race against font-loading hang (common in headless:false + persistent profile)
    await Promise.race([
      page.screenshot({ path: p, fullPage: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]);
    _log(`[DY-ARTICLE-DRY] 截图: ${p}`);
  } catch (e) {
    _log(`[DY-ARTICLE-DRY] 截图跳过 ${name}: ${e.message.substring(0, 60)}`);
  }
}

const getPwChromium = () => {
  const localAppData = process.env.LOCALAPPDATA || (process.env.APPDATA || '').replace('Roaming', 'Local');
  const playwrightDir = path.join(localAppData, 'ms-playwright');
  if (!fs.existsSync(playwrightDir)) return undefined;
  const candidates = fs.readdirSync(playwrightDir).filter(d => d.startsWith('chromium')).sort().reverse();
  for (const d of candidates) {
    const exes = [
      path.join(playwrightDir, d, 'chrome-win64', 'chrome.exe'),
      path.join(playwrightDir, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    ];
    const found = exes.find(e => fs.existsSync(e));
    if (found) return found;
  }
  return undefined;
};

async function publishDouyinArticleDryRun(queueFilePath) {
  _log('[DY-ARTICLE-DRY] 读取队列文件:', queueFilePath);

  // BOM-safe JSON parse (PowerShell Out-File utf8 adds BOM)
  const raw = fs.readFileSync(queueFilePath, 'utf-8').replace(/^﻿/, '');
  const queueData = JSON.parse(raw);
  const title = queueData.title || `[DRY] 自检文章 ${Date.now()}`;
  const content = queueData.content || '';
  const cover = queueData.cover || '';
  const summary = queueData.summary || content.substring(0, 30);

  _log('[DY-ARTICLE-DRY] 标题:', title);
  _log('[DY-ARTICLE-DRY] 封面:', cover);

  if (!cover || !fs.existsSync(cover)) {
    emitFailure(`封面文件不存在或未指定: ${cover}`);
    return;
  }

  const cookiesJson = process.env.DOUYIN_COOKIES;
  const profileDir = process.env.DOUYIN_PROFILE_DIR;
  let browser, context, page;

  if (cookiesJson) {
    _log('\n[DY-ARTICLE-DRY] Cookie 注入模式（CI/GitHub Actions）');
    const cookies = JSON.parse(cookiesJson);
    const executablePath = getPwChromium();
    if (executablePath) _log('[DY-ARTICLE-DRY] Chromium:', executablePath);
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
    _log('\n[DY-ARTICLE-DRY] Profile 模式:', profileDir);
    const executablePath = getPwChromium();
    if (executablePath) _log('[DY-ARTICLE-DRY] Chromium:', executablePath);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      executablePath,
      args: ['--no-sandbox', '--no-first-run', '--disable-restore-session-state',
             '--disable-session-crashed-bubble', '--disable-default-apps'],
      viewport: { width: 1280, height: 900 },
    });
    page = context.pages()[0] || await context.newPage();
    browser = null;
    _log('[DY-ARTICLE-DRY] Profile 已加载\n');
  } else {
    _log('\n[DY-ARTICLE-DRY] CDP 模式 localhost:19222...');
    browser = await chromium.connectOverCDP('http://localhost:19222');
    const contexts = browser.contexts();
    if (!contexts.length) { emitFailure('CDP 没有上下文，确认 Chrome 19222 是否启动'); return; }
    context = contexts[0];
    const pages = context.pages();
    if (!pages.length) { emitFailure('CDP 没有 page'); return; }
    page = pages[0];
    _log('[DY-ARTICLE-DRY] 已连接\n');
  }

  // 安全栅栏：监听发布请求，一旦触发说明 dry-run 失守
  const PUBLISH_API_PATTERN = '/web/api/media/article/publish';
  let publishApiHit = false;
  page.on('request', (req) => {
    if (req.url().includes(PUBLISH_API_PATTERN)) {
      publishApiHit = true;
      _log('[DY-ARTICLE-DRY] !! 检测到文章发布 API 调用，dry-run 失守 !!');
    }
  });

  try {
    // ── Step 1: 导航到上传页（文章创作通过 tab 进入，直接跳 article URL 会被重定向）──
    _log('[DY-ARTICLE-DRY] Step 1: 导航到上传页面');
    await page.goto(UPLOAD_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    await takeScreenshot(page, '01-upload-page');

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      emitFailure(`抖音未登录，URL: ${url1}`);
      return;
    }
    const isLoginPage = await page.evaluate(() => {
      const t = document.body?.innerText || '';
      return t.includes('扫码登录') || t.includes('验证码登录');
    }).catch(() => false);
    if (isLoginPage) { emitFailure('检测到登录页面内容'); return; }
    _log('[DY-ARTICLE-DRY] 已登录，URL:', url1);

    // 关弹窗（共创中心通知等），最多重试 3 次
    const dismissBtn = page.locator('button').filter({ hasText: '我知道了' });
    for (let i = 0; i < 3; i++) {
      if (await dismissBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dismissBtn.click();
        _log(`[DY-ARTICLE-DRY] 关闭弹窗 (第 ${i + 1} 次)`);
        await page.waitForTimeout(2000);
      } else break;
    }

    // ── Step 1.5: 等上传类型 tab 加载 → 点击「发布文章」──
    _log('[DY-ARTICLE-DRY] Step 1.5: 等待并点击「发布文章」tab');
    // waitForFunction 比 waitForSelector 更稳定（不依赖 CSS 模块 hash）
    await page.waitForFunction(() => {
      const t = document.body?.innerText || '';
      return t.includes('发布视频') && t.includes('发布文章');
    }, { timeout: 25000 }).catch(() => _log('[DY-ARTICLE-DRY] 等 tab 超时，继续...'));

    // 点击「发布文章」tab（class 方式 → eval 方式 fallback）
    let articleTabClicked = false;
    const tabByClass = page.locator('[class*="tab-item"]').filter({ hasText: '发布文章' });
    if (await tabByClass.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tabByClass.click();
      articleTabClicked = true;
      _log('[DY-ARTICLE-DRY] 点击「发布文章」tab（class）');
    } else {
      const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('div,li,span')].find(e =>
          e.innerText?.trim() === '发布文章' && e.offsetParent !== null
        );
        if (el) { el.click(); return true; }
        return false;
      });
      if (clicked) {
        articleTabClicked = true;
        _log('[DY-ARTICLE-DRY] 点击「发布文章」tab（eval）');
      }
    }
    if (!articleTabClicked) {
      emitFailure('未找到「发布文章」tab — 账号可能未开通文章创作权限');
      return;
    }
    await page.waitForTimeout(3000);

    // ── Step 1.6: 点击「我要发文」进入编辑器 ──
    _log('[DY-ARTICLE-DRY] Step 1.6: 点击「我要发文」');
    const faBtn = page.locator('button').filter({ hasText: '我要发文' });
    await faBtn.waitFor({ state: 'visible', timeout: 10000 });
    await faBtn.click();

    // 等文章编辑器出现（标题 input）
    _log('[DY-ARTICLE-DRY] 等待文章编辑器加载...');
    await page.waitForSelector('input[placeholder*="请输入文章标题"]', { timeout: 30000 });
    await page.waitForTimeout(3000);
    await takeScreenshot(page, '01c-editor-loaded');
    _log('[DY-ARTICLE-DRY] 编辑器就绪，URL:', page.url());

    // 再次关弹窗（导航后可能再次出现）
    if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await dismissBtn.click();
      await page.waitForTimeout(1000);
    }

    // ── Step 2: 上传封面 ──
    _log('[DY-ARTICLE-DRY] Step 2: 上传封面');
    try {
      // 封面上传通过 lf-zt.douyin.com 的 x-storage-web iframe 内部 file input 触发
      // page.waitForEvent('filechooser') 在 CDP 层拦截，可跨 iframe
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        page.locator('text=点击上传封面图').first().click().catch(async () => {
          await page.locator('[class*="cover-container"]').first().click();
        }),
      ]);
      await fileChooser.setFiles(cover);
      _log('[DY-ARTICLE-DRY] 封面已设置:', cover);
      await page.waitForTimeout(3000);
      await takeScreenshot(page, '02-cover-uploaded');
    } catch (coverErr) {
      _log('[DY-ARTICLE-DRY] 封面上传失败（非致命）:', coverErr.message.substring(0, 120));
      await takeScreenshot(page, '02-cover-failed');
    }

    // ── Step 3: 填写标题 ──
    _log('[DY-ARTICLE-DRY] Step 3: 填写标题');
    await page.locator('input[placeholder*="请输入文章标题"]').fill(title);
    await takeScreenshot(page, '03-title-filled');
    _log('[DY-ARTICLE-DRY] 标题已填写');

    // ── Step 4: 填写正文 ──
    if (content) {
      _log('[DY-ARTICLE-DRY] Step 4: 填写正文');
      // 用 evaluate focus + click 绕过可能存在的 overlay 拦截
      const focused = await page.evaluate(() => {
        const editors = [...document.querySelectorAll('div.tiptap.ProseMirror')];
        if (!editors.length) return false;
        editors[0].focus();
        editors[0].click();
        return true;
      });
      if (focused) {
        await page.waitForTimeout(300);
        await page.keyboard.type(content);
        _log('[DY-ARTICLE-DRY] 正文已填写');
      } else {
        _log('[DY-ARTICLE-DRY] 未找到正文编辑器，跳过');
      }
      await takeScreenshot(page, '04-content-filled');
    }

    // ── Step 4.5: 填写摘要（可选）──
    const summaryInput = page.locator('input[placeholder*="添加内容摘要"]');
    if (summary && await summaryInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await summaryInput.fill(summary.substring(0, 30));
      _log('[DY-ARTICLE-DRY] 摘要已填写');
    }

    await page.waitForTimeout(2000);

    // ── Step 5: 确认发布按钮可见（不点击）──
    _log('[DY-ARTICLE-DRY] Step 5: 确认发布按钮（不点击）');
    const publishBtn = page.locator('button').filter({ hasText: /^发布$/ }).last();
    const visible = await publishBtn.isVisible().catch(() => false);
    await takeScreenshot(page, '05-before-publish');
    if (!visible) {
      _log('[DY-ARTICLE-DRY] 警告：发布按钮不可见，流程已完成，不影响 dry-run');
    } else {
      _log('[DY-ARTICLE-DRY] 发布按钮已就位（不点击）');
    }

    if (publishApiHit) {
      emitFailure('dry-run 失守：检测到文章发布 API 调用');
      return;
    }

    const finalUrl = page.url();
    const result_ = { ok: true, dryRun: true, url: finalUrl, title, publishBtnVisible: visible };
    _log(JSON.stringify(result_));
    return result_;
  } catch (err) {
    console.error('[DY-ARTICLE-DRY] 失败:', err.message);
    await takeScreenshot(page, 'error-final').catch(() => {});
    emitFailure(err.message || String(err));
  } finally {
    if (browser) await browser.close().catch(() => {});
    else if (context && !profileDir) await context.close().catch(() => {});
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
