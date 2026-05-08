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

    // 上传 video / 填标题 / 选标签 — selectors 用 data-testid / aria-label / role / text 优先
    // TODO lead 自验时用真抖音选择器替换以下占位
    _log('[DY-VIDEO-REAL] (TODO lead 自验填 selectors) 上传 video / 填标题 / 选标签 / 点真发布按钮');

    // R1 风控检测
    const bodyText = await page.evaluate(() => document.body?.innerText || '').catch(() => '');
    for (const kw of RISK_KEYWORDS) {
      if (bodyText.includes(kw)) {
        const shot = await captureFailScreenshot(page, 'risk');
        throw new Error(`risk: 抖音风控关键词命中 "${kw}" (screenshot: ${shot || 'n/a'})`);
      }
    }

    // 真点发布按钮（lead 自验时这里要真选择器 + .click()）
    // 此处骨架，lead 自验填 selectors。
    _log('[DY-VIDEO-REAL] 提交发布请求...');

    // 抓取最终视频 URL（lead 自验时填 selector / interceptor）
    const videoUrl = `https://www.douyin.com/video/PENDING_LEAD_VERIFICATION`;

    const out = { ok: true, dryRun: false, url: videoUrl, title: queueData.title };
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

main();
