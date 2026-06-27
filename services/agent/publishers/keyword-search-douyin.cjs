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

async function main() {
  if (!keyword) {
    emit({ ok: false, keyword, video_urls: [], error: 'MISSING_KEYWORD' });
    process.exit(1);
    return;
  }
  let browser = null;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      emit({ ok: false, keyword, video_urls: [], error: 'NO_CDP_CONTEXT' });
      process.exit(1);
      return;
    }
    const ctx = contexts[0];
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
      process.exit(0);
    } finally {
      await page.close().catch(() => null);
    }
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    process.stderr.write(`[keyword-search-douyin] keyword="${keyword}" error: ${msg}\n`);
    emit({ ok: false, keyword, video_urls: [], error: msg });
    process.exit(1);
  } finally {
    if (browser) await browser.close().catch(() => null);
  }
}

main().catch((e) => {
  emit({ ok: false, keyword, video_urls: [], error: String(e) });
  process.exit(1);
});
