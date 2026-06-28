#!/usr/bin/env node
'use strict';
/**
 * keyword-search-douyin.cjs — 主号 CDP 搜抖音关键词取热门视频 URL（外部进程）
 *
 * pkg 二进制内 require/import playwright-core 在 Node18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node 进程从真实 FS require('playwright-core') 绕过（同 qr-bind-douyin-burner.cjs）。
 *
 * Usage:  node keyword-search-douyin.cjs <keyword> [cdpPort=19222] [maxVideos=5]
 * Output: 末行 stdout JSON → { ok, keyword, video_urls, error? }；stderr 打日志
 */
const { chromium } = require('playwright-core');

const [, , keyword = '', cdpPortStr = '19222', maxVideosStr = '5'] = process.argv;
const cdpPort = parseInt(cdpPortStr, 10) || 19222;
const maxVideos = parseInt(maxVideosStr, 10) || 5;

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

function findHeadlessShell() {
  const fs = require('fs');
  const path = require('path');
  const envExe = process.env.ZJ_CHROME_EXE;
  if (envExe && fs.existsSync(envExe)) return envExe;
  if (process.platform !== 'win32') return null;
  const userProfile = process.env.USERPROFILE || process.env.HOME || 'C:\\Users\\asus';
  const candidates = [
    path.join(userProfile, '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell',
      'win64-131.0.6778.85', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe'),
    path.join(userProfile, 'AppData', 'Local', 'ms-playwright', 'chromium-1148',
      'chrome-win', 'chrome.exe'),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function main() {
  if (!keyword) {
    emit({ ok: false, keyword, video_urls: [], error: 'MISSING_KEYWORD' });
    process.exit(1);
    return;
  }
  let browser = null;
  try {
    let launchMode = false;
    try {
      browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    } catch (_cdpErr) {
      // CDP 不可用（无持久 Chrome），改为直接 launch headless Chrome
      const executablePath = findHeadlessShell() || undefined;
      process.stderr.write(`[keyword-search-douyin] CDP 不可用，改 launch${executablePath ? `（${executablePath}）` : ''}\n`);
      browser = await chromium.launch({ executablePath, headless: true });
      launchMode = true;
    }
    let ctx;
    if (launchMode) {
      ctx = await browser.newContext();
    } else {
      const contexts = browser.contexts();
      if (contexts.length === 0) {
        emit({ ok: false, keyword, video_urls: [], error: 'NO_CDP_CONTEXT' });
        return;
      }
      ctx = contexts[0];
    }
    const page = await ctx.newPage();
    try {
      const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
      await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page
        .waitForSelector('[data-e2e="search-video-card"], [class*="video-card"], a[href*="/video/"]', { timeout: 15000 })
        .catch(() => null);
      const videoUrls = await page.evaluate((max) => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/video/"]'));
        const seen = new Set();
        const results = [];
        for (const a of anchors) {
          const href = a.href;
          const m = href.match(/douyin\.com\/video\/(\d+)/);
          if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            results.push(`https://www.douyin.com/video/${m[1]}`);
            if (results.length >= max) break;
          }
        }
        return results;
      }, maxVideos);
      emit({ ok: true, keyword, video_urls: videoUrls });
    } finally {
      await page.close().catch(() => null);
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    process.stderr.write(`[keyword-search-douyin] keyword="${keyword}" error: ${msg}\n`);
    emit({ ok: false, keyword, video_urls: [], error: msg });
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
  process.exit(0);
}

main().catch((e) => {
  emit({ ok: false, keyword, video_urls: [], error: String(e) });
  process.exit(1);
});
