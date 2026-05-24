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

const ARTICLE_URL = 'https://creator.douyin.com/creator-micro/content/article';

function emitFailure(reason) {
  const out = { ok: false, error: String(reason) };
  _log(JSON.stringify(out));
  process.exit(1);
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

  // cover fail fast — existsSync 检查，cover 不存在则提前退出
  if (!cover || !fs.existsSync(cover)) {
    emitFailure(`封面文件不存在或未指定: ${cover}`);
    return;
  }

  _log('\n[DY-ARTICLE-DRY] 连接到现有浏览器 (localhost:19222)...');
  const browser = await chromium.connectOverCDP('http://localhost:19222');
  const contexts = browser.contexts();
  if (!contexts.length) {
    emitFailure('CDP 没有上下文，确认 Chrome 19222 是否启动');
    return;
  }
  const context = contexts[0];
  const pages = context.pages();
  if (!pages.length) {
    emitFailure('CDP 没有 page');
    return;
  }
  const page = pages[0];
  _log('[DY-ARTICLE-DRY] 已连接到浏览器\n');

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

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('passport')) {
      emitFailure(`抖音未登录，当前 URL: ${currentUrl}`);
      return;
    }

    _log('[DY-ARTICLE-DRY] Step 2: 上传封面 (DOM.setFileInputFiles + backendNodeId)');
    const cdpSession = await context.newCDPSession(page);

    // CDP timeout 5s fail fast
    const { result } = await Promise.race([
      cdpSession.send('Runtime.evaluate', {
        expression: `document.querySelector('input[type="file"]')`,
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('CDP Runtime.evaluate 超时 5s')), 5000)),
    ]);

    if (!result.objectId) {
      emitFailure('未找到封面 file input');
      return;
    }
    const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
    if (!node.backendNodeId) {
      emitFailure('未获取到 file input backendNodeId');
      return;
    }
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId: node.backendNodeId,
      files: [cover],
    });
    _log('[DY-ARTICLE-DRY] 封面已上传');

    await page.waitForTimeout(2000);

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
    }

    await page.waitForTimeout(2000);

    _log('[DY-ARTICLE-DRY] Step 5: 定位发布按钮 (XPath) 但 *不点击*');
    // 使用 XPath 定位发布按钮（不用 Playwright text selector）
    const publishBtn = page.locator('xpath=//button[normalize-space()="发布"]').last();
    const visible = await publishBtn.isVisible().catch(() => false);
    if (!visible) {
      _log('[DY-ARTICLE-DRY] 警告：发布按钮不可见，但流程已走到这里，不影响 dry-run 通过');
    } else {
      _log('[DY-ARTICLE-DRY] 发布按钮已就位（不点击）');
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
