#!/usr/bin/env node
/**
 * 微信公众号图文消息「真发」脚本（production wrapper）
 *
 * !! 警告 — 本脚本会真点公众号编辑器「发表」按钮（或群发），
 *    会真触达订阅用户、消耗当日发布额度、影响真账号信誉。
 *    与 publish-wechat-image-dryrun.cjs 严格隔离 !!
 *
 * 启用条件（双重保险）：
 *   只有 services/agent/src/handlers/wechat-publish.ts 在 ZENITHJOY_AGENT_REAL_PUBLISH=1
 *   或 'true' 时才会 spawn 本脚本。默认走 dryrun。
 *
 * 用法：
 *   node publish-wechat-image.cjs <queue-file-path>
 *
 * queue-file 结构（JSON）：
 *   { "title": "...", "content": "...", "images": ["/path/img1.png", ...] }
 *
 * 输出：
 *   stdout 最后一行为 JSON：
 *     {"ok":true,"dryRun":false,"url":"<真实公众号 URL>","title":"...","imagesCount":N}
 *   失败时输出：
 *     {"ok":false,"error":"<具体原因>"}
 *   并 exit 1（不让 stack trace 散出，让 agent handler 收到结构化 JSON）
 */

'use strict';

const _log = console.log.bind(console);
const fs = require('fs');

const RISK_KEYWORDS = ['风险', '频繁', '违规', '风控', '拦截', '异常', '验证码'];

const WX_EDIT_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=10';
const CDP_URL = 'http://localhost:19222';

function emit(out) {
  _log(JSON.stringify(out));
  return out;
}

function emitFailure(reason) {
  return emit({ ok: false, error: String(reason || 'unknown') });
}

async function runWechatImage(queueFilePath, deps) {
  deps = deps || {};
  const chromium = deps.chromium || require('playwright-core').chromium;

  let queueData;
  try {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  } catch (err) {
    return emitFailure(`读取 queue 文件失败: ${err.message}`);
  }
  const title = queueData.title || `公众号图文 ${Date.now()}`;
  const content = queueData.content || '';
  const localImages = (queueData.images || []).filter((f) => fs.existsSync(f));

  _log('[WX-IMG-REAL] 标题:', title);
  _log('[WX-IMG-REAL] 文案:', String(content).substring(0, 50));
  _log('[WX-IMG-REAL] 图片(本地):', localImages.length, '张');

  if (localImages.length === 0) {
    return emitFailure('queue 文件 images 为空或图片不存在');
  }

  let browser;
  try {
    _log('[WX-IMG-REAL] 连接 chrome CDP', CDP_URL);
    browser = await chromium.connectOverCDP(CDP_URL);
  } catch (err) {
    return emitFailure(`chrome CDP ${CDP_URL} 连不上: ${err.message}`);
  }

  const contexts = browser.contexts();
  if (!contexts.length) {
    return emitFailure('CDP 19222 没有上下文，确认 chrome 是否登录公众号');
  }
  const context = contexts[0];
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  try {
    _log('[WX-IMG-REAL] Step 1: 导航到公众号图文编辑页');
    await page.goto(WX_EDIT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // 风控关键词检测：进页面立刻扫描
    const htmlEarly = await page.content().catch(() => '');
    const earlyHit = RISK_KEYWORDS.find((k) => htmlEarly.includes(k));
    if (earlyHit) {
      return emitFailure(`命中风控关键词「${earlyHit}」，发布被拦截`);
    }

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      return emitFailure(`公众号未登录，当前 URL: ${url1}`);
    }

    _log('[WX-IMG-REAL] Step 2: 上传图片 (DOM.setFileInputFiles)');
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
          _log(`[WX-IMG-REAL] 已设置 ${localImages.length} 张图片`);
        }
      }
      await cdpSession.detach().catch(() => {});
    } catch (err) {
      _log('[WX-IMG-REAL] 图片上传失败（继续走流程，让按钮校验拦截）:', err.message);
    }

    await page.waitForTimeout(2000);

    _log('[WX-IMG-REAL] Step 3: 填写标题');
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
      _log('[WX-IMG-REAL] Step 4: 填写文案');
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

    await page.waitForTimeout(2000);

    _log('[WX-IMG-REAL] Step 5: 点击「发表」按钮（真发）');
    const publishBtn = page.locator('button:has-text("发表"), button:has-text("群发")').last();
    try {
      await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
    } catch (err) {
      return emitFailure(`发表按钮未就绪: ${err.message}`);
    }
    const enabled = await publishBtn.isEnabled().catch(() => false);
    if (!enabled) {
      return emitFailure('发表按钮 disabled — 可能图片未上传完成或表单未通过校验');
    }
    await publishBtn.click();
    _log('[WX-IMG-REAL] 已点击发表，等待跳转');

    let postUrl = page.url();
    try {
      await page.waitForURL(/mp\.weixin\.qq\.com\/(s|mp)/, { timeout: 30000 });
      postUrl = page.url();
      _log('[WX-IMG-REAL] 跳转完成，URL:', postUrl);
    } catch (err) {
      const html = await page.content().catch(() => '');
      const lateHit = RISK_KEYWORDS.find((k) => html.includes(k));
      if (lateHit) {
        return emitFailure(`命中风控关键词「${lateHit}」，发表被拦截`);
      }
      _log('[WX-IMG-REAL] 跳转超时，回退使用当前 URL');
    }

    // 末次风控检测
    const htmlFinal = await page.content().catch(() => '');
    const finalHit = RISK_KEYWORDS.find((k) => htmlFinal.includes(k));
    if (finalHit) {
      return emitFailure(`命中风控关键词「${finalHit}」`);
    }

    return emit({
      ok: true,
      dryRun: false,
      url: postUrl,
      title,
      imagesCount: localImages.length,
    });
  } catch (err) {
    return emitFailure(err.message || String(err));
  }
}

module.exports = { runWechatImage };

if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-wechat-image.cjs <queue-file-path>');
    process.exit(1);
  }
  runWechatImage(queueFilePath)
    .then((res) => process.exit(res && res.ok ? 0 : 1))
    .catch((err) => {
      emitFailure(err && err.message ? err.message : String(err));
      process.exit(1);
    });
}
