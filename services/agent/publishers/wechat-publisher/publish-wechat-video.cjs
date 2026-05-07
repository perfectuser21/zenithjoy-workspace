#!/usr/bin/env node
/**
 * 微信公众号视频消息「真发」脚本（production wrapper）
 *
 * !! 警告 — 本脚本会真点公众号编辑器「发表」按钮，会真触达订阅用户。
 *    没有对应的 dryrun 版本（视频消息体量大，dryrun 收益有限）；
 *    需要 dryrun 验证视频流程时优先复用 publish-wechat-image-dryrun.cjs。!!
 *
 * 启用条件：
 *   仅在 ZENITHJOY_AGENT_REAL_PUBLISH=1 / 'true' 时由 wechat-publish.ts spawn 本脚本。
 *
 * 用法：
 *   node publish-wechat-video.cjs <queue-file-path>
 *
 * queue-file 结构（JSON）：
 *   {
 *     "title": "...",      // 视频标题
 *     "content": "...",    // 视频简介
 *     "video": "/path/to/demo.mp4"   // 本地 mp4 路径
 *   }
 *
 * 输出：
 *   stdout 最后一行为 JSON：
 *     {"ok":true,"dryRun":false,"url":"<视频 URL>","title":"...","imagesCount":0}
 *   失败时输出：
 *     {"ok":false,"error":"<具体原因>"}
 *   并 exit 1
 *
 * 注意：
 *   - 公众号视频消息和「视频号」(channels) 是两个不同入口，本脚本走「图文消息→视频」入口
 *   - 视频转码可能需要数分钟，脚本最多等待 5 分钟
 */

'use strict';

const _log = console.log.bind(console);
const fs = require('fs');

const RISK_KEYWORDS = ['风险', '频繁', '违规', '风控', '拦截', '异常', '验证码'];

const WX_VIDEO_EDIT_URL = 'https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&type=video';
const CDP_URL = 'http://localhost:19222';

const VIDEO_TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;

function emit(out) {
  _log(JSON.stringify(out));
  return out;
}

function emitFailure(reason) {
  return emit({ ok: false, error: String(reason || 'unknown') });
}

async function runWechatVideo(queueFilePath, deps) {
  deps = deps || {};
  const chromium = deps.chromium || require('playwright').chromium;

  let queueData;
  try {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  } catch (err) {
    return emitFailure(`读取 queue 文件失败: ${err.message}`);
  }
  const title = queueData.title || `公众号视频 ${Date.now()}`;
  const content = queueData.content || '';
  const videoPath = queueData.video;

  _log('[WX-VIDEO] 标题:', title);
  _log('[WX-VIDEO] 简介:', String(content).substring(0, 50));
  _log('[WX-VIDEO] 视频:', videoPath);

  if (!videoPath || !fs.existsSync(videoPath)) {
    return emitFailure(`视频文件不存在: ${videoPath || '(未提供)'}`);
  }

  let browser;
  try {
    _log('[WX-VIDEO] 连接 chrome CDP', CDP_URL);
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
    _log('[WX-VIDEO] Step 1: 导航到公众号视频消息编辑页');
    await page.goto(WX_VIDEO_EDIT_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const htmlEarly = await page.content().catch(() => '');
    const earlyHit = RISK_KEYWORDS.find((k) => htmlEarly.includes(k));
    if (earlyHit) {
      return emitFailure(`命中风控关键词「${earlyHit}」，发布被拦截`);
    }

    const url1 = page.url();
    if (url1.includes('login') || url1.includes('passport')) {
      return emitFailure(`公众号未登录，当前 URL: ${url1}`);
    }

    _log('[WX-VIDEO] Step 2: 上传 mp4 (DOM.setFileInputFiles)');
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
            files: [videoPath],
          });
          _log('[WX-VIDEO] 已选择 mp4，等待转码（最长 5min）');
        }
      }
      await cdpSession.detach().catch(() => {});
    } catch (err) {
      _log('[WX-VIDEO] 视频上传失败:', err.message);
    }

    // 等待转码完成（页面出现「转码完成」/视频时长 / 视频缩略图）
    try {
      await page.waitForFunction(
        () => {
          const text = document.body ? document.body.innerText || '' : '';
          if (text.includes('转码失败')) return false;
          // 任一信号即可：转码成功提示 / 视频时长格式 / 缩略图节点
          return (
            text.includes('上传成功') ||
            text.includes('转码完成') ||
            /\d{1,2}:\d{2}/.test(text) ||
            !!document.querySelector('video, .video-poster, .thumb')
          );
        },
        { timeout: VIDEO_TRANSCODE_TIMEOUT_MS },
      );
      _log('[WX-VIDEO] 视频转码完成');
    } catch (err) {
      _log('[WX-VIDEO] 转码等待超时（继续尝试发表）:', err.message);
    }

    _log('[WX-VIDEO] Step 3: 填写标题');
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
      _log('[WX-VIDEO] Step 4: 填写简介');
      await page
        .evaluate((c) => {
          const ed = document.querySelector(
            '[contenteditable="true"], textarea[placeholder*="简介"], textarea[placeholder*="描述"]',
          );
          if (ed) {
            ed.focus();
            if (ed.tagName === 'TEXTAREA') {
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                'value',
              ).set;
              setter && setter.call(ed, c);
            } else {
              ed.innerText = c;
            }
            ed.dispatchEvent(new Event('input', { bubbles: true }));
            ed.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, content)
        .catch(() => {});
    }

    await page.waitForTimeout(2000);

    _log('[WX-VIDEO] Step 5: 点击「发表」按钮（真发）');
    const publishBtn = page.locator('button:has-text("发表"), button:has-text("群发")').last();
    try {
      await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
    } catch (err) {
      return emitFailure(`发表按钮未就绪: ${err.message}`);
    }
    const enabled = await publishBtn.isEnabled().catch(() => false);
    if (!enabled) {
      return emitFailure('发表按钮 disabled — 可能视频未转码完成或表单未通过校验');
    }
    await publishBtn.click();
    _log('[WX-VIDEO] 已点击发表，等待跳转');

    let postUrl = page.url();
    try {
      await page.waitForURL(/mp\.weixin\.qq\.com\/(s|mp)/, { timeout: 30000 });
      postUrl = page.url();
      _log('[WX-VIDEO] 跳转完成，URL:', postUrl);
    } catch (err) {
      const html = await page.content().catch(() => '');
      const lateHit = RISK_KEYWORDS.find((k) => html.includes(k));
      if (lateHit) {
        return emitFailure(`命中风控关键词「${lateHit}」`);
      }
      _log('[WX-VIDEO] 跳转超时，回退使用当前 URL');
    }

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
      imagesCount: 0,
    });
  } catch (err) {
    return emitFailure(err.message || String(err));
  }
}

module.exports = { runWechatVideo };

if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-wechat-video.cjs <queue-file-path>');
    process.exit(1);
  }
  runWechatVideo(queueFilePath)
    .then((res) => process.exit(res && res.ok ? 0 : 1))
    .catch((err) => {
      emitFailure(err && err.message ? err.message : String(err));
      process.exit(1);
    });
}
