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
const { chromium } = require('playwright');
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

async function publishDouyinVideoReal(queueData) {
  _log('[DY-VIDEO-REAL] 标题:', queueData.title);
  _log('[DY-VIDEO-REAL] video_path:', queueData.video_path);

  if (!fs.existsSync(queueData.video_path)) {
    throw new Error(`video file not found: ${queueData.video_path}`);
  }

  _log('[DY-VIDEO-REAL] 连 CDP...');
  const browser = await chromium.connectOverCDP(process.env.ZENITHJOY_AGENT_CDP_URL || 'http://localhost:19222');
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('CDP 没有上下文');
  const page = ctx.pages()[0] || await ctx.newPage();

  // 强制扫码（lead 自验路径）— 严禁预置 cookie 跳过
  await requireLogin({ injectedPage: page });

  _log('[DY-VIDEO-REAL] 进入视频上传页...');
  try {
    await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=1', {
      waitUntil: 'domcontentloaded',
    });

    _log('[DY-VIDEO-REAL] 上传视频...');
    await uploadVideoFile(page, queueData.video_path);
    _log('[DY-VIDEO-REAL] 等抖音处理...');
    await waitForUploadProcessed(page);
    _log('[DY-VIDEO-REAL] 填标题...');
    await fillTitle(page, queueData.title);

    // R1 风控检测
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

async function uploadVideoFile(page, videoPath) {
  await page.setInputFiles('input[type="file"]', videoPath);
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
  // 优先 getByRole + name 正则；匹配 4 种发布按钮文字应对抖音 UI 改版
  const publishBtn = page.getByRole('button', {
    name: /^(高清发布|发布|提交发布|确认发布)$/,
  }).first();
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
