#!/usr/bin/env node
/**
 * 微信公众号长文（图文消息正文 markdown / HTML）「真发」脚本
 *
 * !! 警告 — 本脚本会真点公众号编辑器「发表」按钮，会真触达订阅用户。!!
 *
 * 启用条件：
 *   仅在 ZENITHJOY_AGENT_REAL_PUBLISH=1 / 'true' 时由 wechat-publish.ts spawn 本脚本。
 *
 * 用法：
 *   node publish-wechat-article.cjs <queue-file-path>
 *
 * queue-file 结构（JSON）：
 *   {
 *     "title": "长文标题",
 *     "digest": "摘要（可选，默认取标题前 54 字）",
 *     "cover": "/path/to/cover.jpg",       // 封面图（可选）
 *     "markdown_path": "/path/article.md", // 正文 md 路径（与 body_html 二选一）
 *     "body_html": "<p>...</p>"           // 直接给 HTML（与 markdown_path 二选一）
 *   }
 *
 * 输出：
 *   stdout 最后一行为 JSON：
 *     {"ok":true,"dryRun":false,"url":"<长文 URL>","title":"...","imagesCount":N}
 *   失败时输出：
 *     {"ok":false,"error":"<具体原因>"}
 *   并 exit 1
 *
 * 注意：
 *   - markdown 转 HTML 走轻量转换（h1-h3 / 段落 / 列表 / 加粗 / 斜体）
 *   - 复杂语法（图片 / 表格 / 代码块）请预先转 body_html 传入
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

/**
 * 轻量 markdown→HTML（仅覆盖公众号长文常用语法）。
 * 不引入 marked / markdown-it 等第三方依赖，保持 publisher 自包含。
 */
function markdownToHtml(md) {
  if (!md) return '';
  const lines = String(md).split(/\r?\n/);
  const html = [];
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
      continue;
    }
    if (/^###\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h3>${escapeHtml(line.replace(/^###\s+/, ''))}</h3>`);
      continue;
    }
    if (/^##\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2>${escapeHtml(line.replace(/^##\s+/, ''))}</h2>`);
      continue;
    }
    if (/^#\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h1>${escapeHtml(line.replace(/^#\s+/, ''))}</h1>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (inList) { html.push('</ul>'); inList = false; }
    html.push(`<p>${inlineFormat(line)}</p>`);
  }
  if (inList) html.push('</ul>');
  return html.join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineFormat(s) {
  // **bold** 和 *italic*（先粗体再斜体，避免 **a*b** 误伤）
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return out;
}

async function runWechatArticle(queueFilePath, deps) {
  deps = deps || {};
  const chromium = deps.chromium || require('playwright').chromium;

  let queueData;
  try {
    queueData = JSON.parse(fs.readFileSync(queueFilePath, 'utf-8'));
  } catch (err) {
    return emitFailure(`读取 queue 文件失败: ${err.message}`);
  }
  const title = queueData.title || `公众号长文 ${Date.now()}`;
  const digest = queueData.digest || String(title).slice(0, 54);
  const cover = queueData.cover && fs.existsSync(queueData.cover) ? queueData.cover : null;

  // body 来源优先级：body_html > markdown_path
  let bodyHtml = queueData.body_html || '';
  if (!bodyHtml && queueData.markdown_path) {
    try {
      const md = fs.readFileSync(queueData.markdown_path, 'utf-8');
      bodyHtml = markdownToHtml(md);
    } catch (err) {
      return emitFailure(`读取 markdown 失败: ${err.message}`);
    }
  }
  if (!bodyHtml) {
    return emitFailure('body_html / markdown_path 至少需要其一');
  }

  _log('[WX-ARTICLE] 标题:', title);
  _log('[WX-ARTICLE] 摘要:', digest);
  _log('[WX-ARTICLE] 封面:', cover || '(无)');
  _log('[WX-ARTICLE] 正文长度:', bodyHtml.length, '字符');

  let browser;
  try {
    _log('[WX-ARTICLE] 连接 chrome CDP', CDP_URL);
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
    _log('[WX-ARTICLE] Step 1: 导航到公众号图文编辑页');
    await page.goto(WX_EDIT_URL, { waitUntil: 'domcontentloaded' });
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

    let imagesCount = 0;

    if (cover) {
      _log('[WX-ARTICLE] Step 2: 上传封面图');
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
              files: [cover],
            });
            imagesCount = 1;
          }
        }
        await cdpSession.detach().catch(() => {});
      } catch (err) {
        _log('[WX-ARTICLE] 封面上传失败（继续）:', err.message);
      }
      await page.waitForTimeout(2000);
    }

    _log('[WX-ARTICLE] Step 3: 填写标题');
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

    _log('[WX-ARTICLE] Step 4: 填写摘要');
    await page
      .evaluate((d) => {
        const ta = document.querySelector(
          'textarea[placeholder*="摘要"], textarea[placeholder*="描述"], textarea[name="digest"]',
        );
        if (ta) {
          ta.focus();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype,
            'value',
          ).set;
          setter && setter.call(ta, d);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, digest)
      .catch(() => {});

    _log('[WX-ARTICLE] Step 5: 填写正文（HTML）');
    await page
      .evaluate((args) => {
        const ed = document.querySelector(
          '[contenteditable="true"], .ProseMirror, .rich_media_content',
        );
        if (ed) {
          ed.focus();
          ed.innerHTML = args.body;
          ed.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, { body: bodyHtml })
      .catch(() => {});

    await page.waitForTimeout(2000);

    _log('[WX-ARTICLE] Step 6: 点击「发表」按钮（真发）');
    const publishBtn = page.locator('button:has-text("发表"), button:has-text("群发")').last();
    try {
      await publishBtn.waitFor({ state: 'visible', timeout: 10000 });
    } catch (err) {
      return emitFailure(`发表按钮未就绪: ${err.message}`);
    }
    const enabled = await publishBtn.isEnabled().catch(() => false);
    if (!enabled) {
      return emitFailure('发表按钮 disabled — 可能正文未通过校验');
    }
    await publishBtn.click();
    _log('[WX-ARTICLE] 已点击发表，等待跳转');

    let postUrl = page.url();
    try {
      await page.waitForURL(/mp\.weixin\.qq\.com\/(s|mp)/, { timeout: 30000 });
      postUrl = page.url();
      _log('[WX-ARTICLE] 跳转完成，URL:', postUrl);
    } catch (err) {
      const html = await page.content().catch(() => '');
      const lateHit = RISK_KEYWORDS.find((k) => html.includes(k));
      if (lateHit) {
        return emitFailure(`命中风控关键词「${lateHit}」`);
      }
      _log('[WX-ARTICLE] 跳转超时，回退使用当前 URL');
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
      imagesCount,
    });
  } catch (err) {
    return emitFailure(err.message || String(err));
  }
}

module.exports = { runWechatArticle, markdownToHtml };

if (require.main === module) {
  const queueFilePath = process.argv[2];
  if (!queueFilePath) {
    console.error('用法: node publish-wechat-article.cjs <queue-file-path>');
    process.exit(1);
  }
  runWechatArticle(queueFilePath)
    .then((res) => process.exit(res && res.ok ? 0 : 1))
    .catch((err) => {
      emitFailure(err && err.message ? err.message : String(err));
      process.exit(1);
    });
}
