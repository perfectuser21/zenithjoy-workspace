#!/usr/bin/env node
/**
 * 抖音图文「真发版」脚本（production wrapper）
 *
 * !! 警告 — 本脚本会真点抖音创作者后台「发布」按钮，会真调
 *    /web/api/media/aweme/create_v2/，会污染抖音公网，会让真账号真发图文 !!
 *
 * 与 publish-douyin-image-dryrun.cjs 严格隔离：
 *   - dryrun 用于开发 / CI smoke / 链路自检（不点发布、断言按钮存在即停）
 *   - 本脚本用于客户机真实发布场景
 *
 * 启用条件（双重保险）：
 *   只有 `services/agent/src/handlers/douyin-publish.ts` 在
 *   `ZENITHJOY_AGENT_REAL_PUBLISH=1`（或 'true'）时才会 spawn 本脚本。
 *   默认走 dryrun 脚本（安全优先），开发机绝不会意外触发本脚本。
 *
 * 用法：
 *   node publish-douyin-image.cjs <queue-file-path>
 *
 * 输出：
 *   stdout 最后一行为 JSON（machine readable）：
 *     {"ok":true,"dryRun":false,"url":"<真实抖音视频 URL>","title":"<标题>","imagesCount":<N>}
 *   失败时输出：
 *     {"ok":false,"error":"<具体原因>"}
 *   并 exit 1（错误兜底，不让脚本崩溃，让 Agent handler 收到结构化错误）
 */

const _log = console.log.bind(console);
const { chromium } = require('playwright');
const fs = require('fs');

// 风控关键词（页面内文出现任一即视作被拦截）
const RISK_KEYWORDS = ['风险', '拦截', '频繁', '异常', '验证码', '风控'];

function emitFailure(reason) {
  const out = { ok: false, error: reason };
  _log(JSON.stringify(out));
  return out;
}

async function publishDouyinImageReal(queueFilePath) {
  _log('[DY-REAL] 读取队列文件:', queueFilePath);

  const queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  const title = queueData.title || `自动发布 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter((f) => fs.existsSync(f));

  _log('[DY-REAL] 标题:', title);
  _log('[DY-REAL] 文案:', content.substring(0, 50));
  _log('[DY-REAL] 图片(本地):', localImages.length, '张');

  if (localImages.length === 0) {
    throw new Error('queue 文件 images 为空或图片不存在');
  }

  _log('\n[DY-REAL] 连接到现有浏览器 (localhost:19222)...');
  const browser = await chromium.connectOverCDP('http://localhost:19222');
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP 没有上下文，确认 Chrome 19222 是否登录抖音');
  const context = contexts[0];
  const pages = context.pages();
  if (!pages.length) throw new Error('CDP 没有 page');
  const page = pages[0];
  _log('[DY-REAL] 已连接到浏览器\n');

  try {
    _log('[DY-REAL] Step 1: 导航到发布图文页面');
    await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=3', {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForTimeout(3000);

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      throw new Error(`抖音未登录，当前 URL: ${url1}`);
    }

    _log('[DY-REAL] Step 2: 上传图片 (DOM.setFileInputFiles)');
    const cdpSession = await context.newCDPSession(page);
    const { result } = await cdpSession.send('Runtime.evaluate', {
      expression: `document.querySelector('input[type="file"]')`,
    });
    if (!result.objectId) throw new Error('未找到 file input');
    const { node } = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
    if (!node.backendNodeId) throw new Error('未获取到 file input backendNodeId');
    await cdpSession.send('DOM.setFileInputFiles', {
      backendNodeId: node.backendNodeId,
      files: localImages,
    });
    _log(`[DY-REAL] 已设置 ${localImages.length} 张图片`);

    _log('[DY-REAL] 等待页面跳转到编辑页 (45s 超时)');
    await page.waitForURL(/\/content\/post\/image/, { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const editUrl = page.url();
    _log('[DY-REAL] 编辑页 URL:', editUrl);

    _log('[DY-REAL] Step 3: 填写标题');
    const titleFilled = await page.evaluate((titleText) => {
      const input = document.querySelector('input[placeholder*="标题"]');
      if (!input) return { success: false, error: '未找到标题 input' };
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, titleText);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { success: true };
    }, title);
    _log('[DY-REAL] 标题填写:', titleFilled.success ? 'OK' : `FAIL ${titleFilled.error}`);

    if (content) {
      _log('[DY-REAL] Step 4: 填写文案');
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

    _log('[DY-REAL] Step 5: 点击发布按钮');
    const publishBtn = page.locator('button:has-text("发布")').last();

    // 等按钮就绪
    try {
      await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
      await publishBtn.waitFor({ state: 'attached', timeout: 5000 });
    } catch (e) {
      return emitFailure(`发布按钮未就绪: ${e.message}`);
    }

    const enabled = await publishBtn.isEnabled().catch(() => false);
    if (!enabled) {
      return emitFailure('发布按钮存在但 disabled — 可能图片未上传完成或表单未通过校验');
    }

    _log('[DY-REAL] 点击发布');
    await publishBtn.click();

    _log('[DY-REAL] 等待页面跳转到作品管理或视频详情页 (30s 超时)');
    let postUrl = '';
    try {
      // 多模式跳转：作品管理（旧）/ creator-micro 作品管理（新）/ 视频详情
      await Promise.race([
        page.waitForURL(/\/content\/manage/, { timeout: 30000 }),
        page.waitForURL(/\/creator-micro\/content\/manage/, { timeout: 30000 }),
        page.waitForURL(/\/video\//, { timeout: 30000 }),
        page.waitForURL(/aweme\/v1\/play/, { timeout: 30000 }),
      ]);
      postUrl = page.url();
      _log('[DY-REAL] 跳转完成，当前 URL:', postUrl);
    } catch (e) {
      // 跳转超时 — 可能撞到风控或仍在审核
      const html = await page.content().catch(() => '');
      const hit = RISK_KEYWORDS.find((k) => html.includes(k));
      if (hit) {
        return emitFailure(`命中风控关键词「${hit}」，发布被拦截`);
      }
      return emitFailure(`30s 内未跳转到发布完成页: ${e.message}`);
    }

    // 如果落在 manage 页，尝试从最近一条作品的 anchor 里抠真实视频 URL
    let finalUrl = postUrl;
    if (/\/content\/manage/.test(postUrl) || /\/creator-micro\/content\/manage/.test(postUrl)) {
      _log('[DY-REAL] 落在作品管理页，尝试提取最新作品视频链接');
      try {
        const videoHref = await page
          .locator('a[href*="/video/"], a[href*="aweme/v1/play"]')
          .first()
          .getAttribute('href', { timeout: 5000 });
        if (videoHref) {
          finalUrl = videoHref.startsWith('http')
            ? videoHref
            : `https://www.douyin.com${videoHref}`;
          _log('[DY-REAL] 提取到视频链接:', finalUrl);
        } else {
          _log('[DY-REAL] 未提取到视频链接，回退使用 manage 页 URL');
        }
      } catch (e) {
        _log('[DY-REAL] 提取视频链接失败，回退使用 manage 页 URL:', e.message);
      }
    }

    const out = {
      ok: true,
      dryRun: false,
      url: finalUrl,
      title,
      imagesCount: localImages.length,
    };
    _log(JSON.stringify(out));
    return out;
  } catch (err) {
    console.error('[DY-REAL] 失败:', err.message);
    emitFailure(err.message || String(err));
    throw err;
  }
}

const queueFilePath = process.argv[2];
if (!queueFilePath) {
  console.error('用法: node publish-douyin-image.cjs <queue-file-path>');
  process.exit(1);
}

publishDouyinImageReal(queueFilePath)
  .then((res) => process.exit(res && res.ok ? 0 : 1))
  .catch(() => process.exit(1));
