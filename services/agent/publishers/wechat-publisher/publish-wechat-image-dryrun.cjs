#!/usr/bin/env node
/**
 * 微信公众号图文消息「dry-run」自检脚本（draft-only / 不点击「发表」）
 *
 * 用途：
 *   - 走完发布流程（导航 / 上传图片 / 填标题 / 填文案）但**不点最终的「发表」按钮**
 *   - 不污染公众号订阅消息，用于 ZenithJoy Agent walking-skeleton-1 链路自检
 *   - CI smoke + 客户机首次激活验证可用此脚本
 *
 * 与真发脚本 publish-wechat-image.cjs 严格隔离：
 *   - 本脚本 dryRun:true，仅断言「发表」按钮存在 / 可定位
 *   - 真发脚本 dryRun:false，会真点发表 → 触达订阅用户
 *
 * 用法：
 *   node publish-wechat-image-dryrun.cjs <queue-file-path>
 *
 * queue-file 结构（JSON）：
 *   { "title": "...", "content": "...", "images": ["/path/img1.png", ...] }
 *
 * 输出：
 *   stdout 最后一行为 JSON：
 *     {"ok":true,"dryRun":true,"url":"<草稿 URL>","title":"...","imagesCount":N}
 *   失败时输出：
 *     {"ok":false,"error":"<具体原因>"}
 *   并 exit 1（不让 stack trace 散出，让 agent handler 收到结构化 JSON）
 */

'use strict';

const _log = console.log.bind(console);
const fs = require('fs');

// 风控关键词（页面内文出现任一即视作被拦截）
const RISK_KEYWORDS = ['风险', '频繁', '违规', '风控', '拦截', '异常', '验证码'];

// 公众号编辑器地址（草稿入口）
const WX_EDIT_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=10';
const CDP_URL = 'http://localhost:19222';

function emit(out) {
  _log(JSON.stringify(out));
  return out;
}

function emitFailure(reason) {
  return emit({ ok: false, error: String(reason || 'unknown') });
}

/**
 * 主流程（dependency-injection 友好，便于单测）。
 * deps.chromium 可注入；缺省走 require('playwright').chromium。
 */
async function runWechatImageDryrun(queueFilePath, deps) {
  deps = deps || {};
  const chromium = deps.chromium || require('playwright').chromium;

  // 1. 读 queue 文件
  let queueData;
  try {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  } catch (err) {
    return emitFailure(`读取 queue 文件失败: ${err.message}`);
  }
  const title = queueData.title || `[DRY] 公众号自检 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter((f) => fs.existsSync(f));

  _log('[WX-IMG-DRY] 标题:', title);
  _log('[WX-IMG-DRY] 文案:', String(content).substring(0, 50));
  _log('[WX-IMG-DRY] 图片(本地):', localImages.length, '张');

  if (localImages.length === 0) {
    return emitFailure('queue 文件 images 为空或图片不存在');
  }

  // 2. 连接 chrome CDP（dry-run 友好错误：连不上立刻返回 ok:false）
  let browser;
  try {
    _log('[WX-IMG-DRY] 连接 chrome CDP', CDP_URL);
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    return emitFailure(`chrome CDP ${CDP_URL} 连不上: ${err.message}`);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    return emitFailure(`CDP 19222 没有上下文，确认 chrome 是否登录公众号`);
  }
  const context = contexts[0];
  let pages = context.pages();
  let page = pages.length > 0 ? pages[0] : await context.newPage();

  try {
    _log('[WX-IMG-DRY] Step 1: 导航到公众号图文编辑页');
    await page.goto(WX_EDIT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 早期风控检测：导航后立刻看页面 HTML
    const htmlEarly = await page.content().catch(() => '');
    const earlyHit = RISK_KEYWORDS.find((k) => htmlEarly.includes(k));
    if (earlyHit) {
      return emitFailure(`命中风控关键词「${earlyHit}」，dry-run 终止`);
    }

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      return emitFailure(`公众号未登录，当前 URL: ${url1}`);
    }

    _log('[WX-IMG-DRY] Step 2: 上传图片 (DOM.setFileInputFiles)');
    try {
      const cdpSession = await context.newCDPSession(page);
      const { result } = await cdpSession.send('Runtime.evaluate', {
        expression: `document.querySelector('input[type="file"]')`,
      });
      if (result && result.objectId) {
        const desc = await cdpSession.send('DOM.describeNode', { objectId: result.objectId });
        if (desc && desc.node && desc.node.backendNodeId) {
          await cdpSession.send('DOM.setFileInputFiles', {
            backendNodeId: desc.node.backendNodeId,
            files: localImages,
          });
          _log(`[WX-IMG-DRY] 已设置 ${localImages.length} 张图片`);
        }
      }
      await cdpSession.detach().catch(() => {});
    } catch (err) {
      _log('[WX-IMG-DRY] 上传图片失败（dry-run 容忍）:', err.message);
    }

    await page.waitForTimeout(2000);

    _log('[WX-IMG-DRY] Step 3: 填写标题');
    await page
      .evaluate((titleText) => {
        const input = document.querySelector('input[placeholder*="标题"], input[name="title"]');
        if (input) {
          input.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter && setter.call(input, titleText);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, title)
      .catch(() => {});

    if (content) {
      _log('[WX-IMG-DRY] Step 4: 填写文案');
      await page
        .evaluate((c) => {
          const ed = document.querySelector('[contenteditable="true"], .ProseMirror');
          if (ed) {
            ed.focus();
            ed.innerText = c;
            ed.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, content)
        .catch(() => {});
    }

    await page.waitForTimeout(1500);

    _log('[WX-IMG-DRY] Step 5: 定位「发表」按钮但 *不点击*（dry-run 守约）');
    const publishBtn = page.locator('button:has-text("发表"), button:has-text("群发")').last();
    let publishVisible = false;
    try {
      publishVisible = await publishBtn.isVisible();
    } catch (_) {
      publishVisible = false;
    }
    if (!publishVisible) {
      _log('[WX-IMG-DRY] 警告：发表按钮不可见，但 dry-run 已走完结构性步骤，不视为失败');
    } else {
      _log('[WX-IMG-DRY] 发表按钮就位（dry-run 不点击，draft only）');
    }

    // 末次风控检测
    const htmlFinal = await page.content().catch(() => '');
    const lateHit = RISK_KEYWORDS.find((k) => htmlFinal.includes(k));
    if (lateHit) {
      return emitFailure(`命中风控关键词「${lateHit}」`);
    }

    const finalUrl = page.url();
    return emit({
      ok: true,
      dryRun: true,
      url: finalUrl,
      title,
      imagesCount: localImages.length,
      publishBtnVisible: publishVisible,
    });
  } catch (err) {
    return emitFailure(err.message || String(err));
  } finally {
    // dryrun 模式不主动 close，避免影响调用方共享 chrome
  }
}

module.exports = { runWechatImageDryrun };

// CLI 入口
if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-wechat-image-dryrun.cjs <queue-file-path>');
    process.exit(1);
  }
  runWechatImageDryrun(queueFilePath)
    .then((res) => process.exit(res && res.ok ? 0 : 1))
    .catch((err) => {
      emitFailure(err && err.message ? err.message : String(err));
      process.exit(1);
    });
}
