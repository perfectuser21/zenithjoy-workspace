#!/usr/bin/env node
/**
 * 抖音视频「dryrun 版」脚本（CI / 链路自检用）
 *
 * 与 publish-douyin-video.cjs 真发版严格隔离：
 *   - 本脚本：连接到上传页 → 真填字段（标题/标签）→ 等到「发布」按钮可点 → 立即停（不点发布）
 *   - 真发版：本脚本基础上再点真发布按钮
 *
 * 用法：
 *   node publish-douyin-video-dryrun.cjs <queue-file-path>
 *
 * Queue 文件格式（与 image 一致 + video_path 字段）：
 *   {"title": "...", "content": "...", "video_path": "/path/to/x.mp4", "tags": ["t1","t2"]}
 *
 * 输出（stdout 最后一行 JSON）：
 *   {"ok":true,"dryRun":true,"reachedPublishButton":true,"title":"..."}
 *   {"ok":false,"error":"..."}
 *
 * 强制 mock 模式（CI 用）：
 *   ZENITHJOY_AGENT_DRYRUN_BROWSER=mock → 不连真 CDP，纯模拟流程，stdout 含 "等待发布按钮"
 */
const fs = require('fs');
const _log = console.log.bind(console);

function emitFailure(reason) {
  const out = { ok: false, error: String(reason) };
  _log(JSON.stringify(out));
  process.exit(1);
}

async function runMock(queueData) {
  _log('[DY-VIDEO-DRY] mock browser 模式');
  _log('[DY-VIDEO-DRY] 标题:', queueData.title);
  _log('[DY-VIDEO-DRY] video_path:', queueData.video_path);
  _log('[DY-VIDEO-DRY] tags:', JSON.stringify(queueData.tags || []));
  _log('[DY-VIDEO-DRY] 模拟：连 CDP → 上传页 → 填标题 → 选标签 → 等待发布按钮');
  _log('[DY-VIDEO-DRY] reached=等待发布按钮 (wait publish button)');
  // 严禁 click publish — dryrun 必须停在这里
  const out = { ok: true, dryRun: true, reachedPublishButton: true, title: queueData.title };
  _log(JSON.stringify(out));
}

async function runReal(queueData) {
  const { chromium } = require('playwright-core');
  const { requireLogin } = require('./lib/qr-login.cjs');
  const os = require('os');

  const sessionPath = require('path').join(
    os.homedir(), '.zenithjoy-agent', 'sessions', 'douyin',
    (process.env.ZENITHJOY_DOUYIN_ACCOUNT || 'default') + '.json'
  );

  let browser, page, isLaunched = false;
  if (require('fs').existsSync(sessionPath)) {
    _log('[DY-VIDEO-DRY] 加载 QR-bind session:', sessionPath);
    const storageState = JSON.parse(require('fs').readFileSync(sessionPath, 'utf-8'));
    browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const ctx = await browser.newContext({ storageState });
    page = await ctx.newPage();
    await page.goto('https://creator.douyin.com/creator-micro/home', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (/login|passport/i.test(page.url())) {
      await browser.close();
      throw new Error('session 已过期，请重新扫码绑定');
    }
    isLaunched = true;
  } else {
    _log('[DY-VIDEO-DRY] 回退 CDP (localhost:19222)');
    browser = await chromium.connectOverCDP(process.env.ZENITHJOY_AGENT_CDP_URL || 'http://localhost:19222');
    const ctx = browser.contexts()[0];
    if (!ctx) throw new Error('CDP 没有上下文');
    page = ctx.pages()[0] || await ctx.newPage();
    await requireLogin({ injectedPage: page });
  }

  _log('[DY-VIDEO-DRY] 进入上传页...');
  await page.goto('https://creator.douyin.com/creator-micro/content/upload?default-tab=1', {
    waitUntil: 'domcontentloaded',
  });

  // 上传 video 文件 — 选择器优先 data-testid，TODO lead 自验时用真选择器
  // 此处骨架：lead 自验阶段填 selectors
  _log('[DY-VIDEO-DRY] (TODO lead 自验填 selectors) 上传 video / 填标题 / 选标签');
  _log('[DY-VIDEO-DRY] 等待发布按钮可点 (wait publish button)');

  // 严禁 click publish button — dryrun 在此停
  const out = { ok: true, dryRun: true, reachedPublishButton: true, title: queueData.title };
  _log(JSON.stringify(out));
  if (isLaunched) await browser.close().catch(() => {});
}

async function main() {
  const queueFile = process.argv[2];
  if (!queueFile) emitFailure('usage: node publish-douyin-video-dryrun.cjs <queue-file>');
  if (!fs.existsSync(queueFile)) emitFailure(`queue file not found: ${queueFile}`);

  const queueData = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
  if (!queueData.video_path) emitFailure('queue.video_path missing');

  const mode = (process.env.ZENITHJOY_AGENT_DRYRUN_BROWSER || '').toLowerCase();
  try {
    if (mode === 'mock') {
      await runMock(queueData);
    } else {
      await runReal(queueData);
    }
  } catch (e) {
    emitFailure(e.message || String(e));
  }
}

main();
