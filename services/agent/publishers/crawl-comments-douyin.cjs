#!/usr/bin/env node
'use strict';
/**
 * crawl-comments-douyin.cjs — 抖音视频评论区抓取 → commenter 主页 → POST collect/report
 *
 * Usage: node crawl-comments-douyin.cjs <video_url> <task_id> [apiBase] [cdpPort=19222]
 * Output: 末行 stdout JSON → { ok, task_id, video_url, inserted, error? }
 */
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const [, , videoUrl = '', taskId = '', apiBase = 'http://localhost:3000', cdpPortStr = '19222', mode = ''] = process.argv;
const MAIN_CDP_PORT = parseInt(cdpPortStr, 10) || 19222;
const STDOUT_ONLY = mode === '--stdout-only';
const PAGE_TIMEOUT_MS = 30000;

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

function readEnvFile() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
    'C:\\zj-agent\\extracted\\zenithjoy-agent-v2.0.39\\.env',
  ];
  for (const p of candidates) {
    try {
      const vars = {};
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) vars[m[1]] = m[2].trim();
      }
      return vars;
    } catch {}
  }
  return {};
}

function postReport(payload, base) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const url = new URL(`${base}/api/acquisition/collect/report`);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function findMainChrome() {
  // 连接主号 Chrome（CDP）
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${MAIN_CDP_PORT}`);
    return browser;
  } catch {
    return null;
  }
}

async function crawlVideoComments(browser, videoUrl, taskId, apiBase) {
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  const commenters = [];

  try {
    await page.goto(videoUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });

    // Douyin 评论区由 JS 异步 XHR 加载，waitForSelector 最多等 40s
    await page.waitForSelector('[data-e2e="comment-item"]', { timeout: 40000 }).catch(() => {});

    // 收集评论者
    const commentItems = await page.$$('[data-e2e="comment-item"]').catch(() => []);

    for (const item of commentItems.slice(0, 20)) {
      try {
        // data-e2e="comment-user-name" 已从 Douyin 移除，nickname 在 a[href*=/user/] 文本里
        const profileLink = await item.$eval('a[href*="/user/"]', el => el.getAttribute('href') || '').catch(() => '');
        const nickname = await item.$eval('a[href*="/user/"]', el => el.textContent?.trim() || '').catch(() => '');
        const secUidMatch = profileLink.match(/\/user\/([^/?]+)/);
        const secUid = secUidMatch ? secUidMatch[1] : null;

        if (nickname) {
          commenters.push({ sec_uid: secUid, nickname });
        }
      } catch {}
    }

    // --stdout-only 模式：不 POST API，调用方自己处理（keyword 管道用）
    if (STDOUT_ONLY) {
      return { ok: true, commenters, inserted: commenters.length };
    }

    // 上报给 API
    if (commenters.length > 0) {
      await postReport({
        task_id: taskId,
        video_id: videoUrl.split('/').pop() || videoUrl,
        commenters,
        terminal: 'done',
      }, apiBase);
    }

    return { ok: true, inserted: commenters.length };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  if (!videoUrl || !taskId) {
    emit({ ok: false, error: 'Usage: crawl-comments-douyin.cjs <video_url> <task_id> [apiBase] [cdpPort]' });
    process.exit(1);
  }

  const browser = await findMainChrome();
  if (!browser) {
    emit({ ok: false, task_id: taskId, video_url: videoUrl, error: 'Cannot connect to main Chrome CDP' });
    process.exit(1);
  }

  try {
    const result = await crawlVideoComments(browser, videoUrl, taskId, apiBase);
    if (STDOUT_ONLY) {
      emit({ ok: result.ok, video_url: videoUrl, commenters: result.commenters || [], inserted: result.inserted || 0, error: result.error });
    } else {
      emit({ ok: result.ok, task_id: taskId, video_url: videoUrl, inserted: result.inserted || 0, error: result.error });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch(err => {
  emit({ ok: false, task_id: taskId, video_url: videoUrl, error: err.message });
  process.exit(1);
});
