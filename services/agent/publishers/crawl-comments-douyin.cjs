#!/usr/bin/env node
'use strict';
/**
 * crawl-comments-douyin.cjs — 抖音视频评论区全量抓取 → commenter 主页 → POST collect/report
 *
 * Usage: node crawl-comments-douyin.cjs <video_url> <task_id> [apiBase] [cdpPort=19222]
 * Output: 末行 stdout JSON → { ok, task_id, video_url, inserted, error? }
 *
 * v1.0.10: 滚动加载全量评论（无上限），连续 3 轮无新评论才停
 */
const { chromium } = require('playwright-core');
const https = require('https');
const http = require('http');

// 滚动参数
const STABLE_ROUNDS = 3;   // 连续N轮无新评论 → 到底了
const SCROLL_PAUSE_MS = 2000;
const MAX_SCROLL_ROUNDS = 300; // 保底防死循环

const [, , videoUrl = '', taskId = '', apiBase = 'http://localhost:3000', cdpPortStr = '19222', mode = ''] = process.argv;
const MAIN_CDP_PORT = parseInt(cdpPortStr, 10) || 19222;
const STDOUT_ONLY = mode === '--stdout-only';
const PAGE_TIMEOUT_MS = 30000;

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
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
  try {
    return await chromium.connectOverCDP(`http://localhost:${MAIN_CDP_PORT}`);
  } catch {
    return null;
  }
}

/**
 * 滚动评论区直到稳定（连续 STABLE_ROUNDS 轮无新评论出现）
 */
async function scrollUntilStable(page) {
  let stableCount = 0;
  let prevCount = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    await page.evaluate(() => {
      // 依次尝试已知抖音评论容器，找到可滚动的就滚到底
      const selectors = [
        '[data-e2e="comment-list"]',
        '.comment-mainContainer',
        '.DivCommentListContainer',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.scrollHeight > el.clientHeight + 10) {
          el.scrollTop = el.scrollHeight;
          return;
        }
      }
      window.scrollTo(0, document.body.scrollHeight);
    });

    await new Promise(r => setTimeout(r, SCROLL_PAUSE_MS));

    const count = await page.$$eval('[data-e2e="comment-item"]', els => els.length).catch(() => 0);

    if (count > prevCount) {
      stableCount = 0;
      prevCount = count;
    } else {
      stableCount++;
      if (stableCount >= STABLE_ROUNDS) break;
    }
  }
}

async function crawlVideoComments(browser, videoUrl, taskId, apiBase) {
  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();
  const commenters = [];

  try {
    await page.goto(videoUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });

    // 等第一批评论出现（最多 40s，抖音评论由 XHR 异步加载）
    await page.waitForSelector('[data-e2e="comment-item"]', { timeout: 40000 }).catch(() => {});

    // 滚动加载全量评论（连续 3 轮无新评论才停）
    await scrollUntilStable(page);

    // 收集所有评论者（无上限）
    const commentItems = await page.$$('[data-e2e="comment-item"]').catch(() => []);

    for (const item of commentItems) {
      try {
        // data-e2e="comment-user-name" 已从 Douyin 移除，nickname 在 a[href*=/user/] 文本里
        const profileLink = await item.$eval('a[href*="/user/"]', el => el.getAttribute('href') || '').catch(() => '');
        const nickname = await item.$eval('a[href*="/user/"]', el => el.textContent?.trim() || '').catch(() => '');
        const secUidMatch = profileLink.match(/\/user\/([^/?]+)/);
        const secUid = secUidMatch ? secUidMatch[1] : null;

        const commentText = await item.$eval(
          '[data-e2e="comment-item-content"], [class*="CommentContent"], [class*="comment-content"], [class*="commentItem"] span',
          el => el.textContent?.trim() || ''
        ).catch(() => '');

        if (nickname) {
          commenters.push({ sec_uid: secUid, nickname, comment_text: commentText });
        }
      } catch {}
    }

    if (STDOUT_ONLY) {
      return { ok: true, commenters, inserted: commenters.length };
    }

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
