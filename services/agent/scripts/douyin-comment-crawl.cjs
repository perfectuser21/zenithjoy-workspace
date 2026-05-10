'use strict';
/**
 * Path 2 Sprint B-1 WS2b — 抖音视频评论抓取脚本
 *
 * 决策 A：抖音公开评论无 open API → Agent CDP 加载视频页 + DOM 解析。
 *
 * 用法（Agent 内部 child_process spawn 调用）：
 *   node services/agent/scripts/douyin-comment-crawl.cjs \
 *     --user-data-dir=/path/to/burner-profile \
 *     --video-url=https://www.douyin.com/video/7xxx \
 *     --max-comments=5
 *
 * 输出（stdout JSON）：
 *   { ok: true, comments: [{commenter_id, text, publish_time}], video_url }
 *   { ok: false, error_code: 'BURNER_SESSION_EXPIRED' | 'VIDEO_NOT_AVAILABLE' | 'CAPTCHA_TRIGGERED', error: '...' }
 *
 * 错误检测：
 *   R4 BURNER_SESSION_EXPIRED — page url 跳到 /login 或 /passport
 *   R2 VIDEO_NOT_AVAILABLE  — comment-item selector waitForSelector 超时
 *   R3 评论 0 早 return     — comments.length === 0 直接返成功 + 空数组
 */

const path = require('path');
const fs = require('fs');

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function loadPlaywright() {
  try {
    return require('playwright');
  } catch (err) {
    return null;
  }
}

async function crawlComments(opts) {
  const playwright = await loadPlaywright();
  if (!playwright || !playwright.chromium) {
    return { ok: false, error_code: 'PLAYWRIGHT_NOT_INSTALLED', error: 'playwright 未装' };
  }

  const userDataDir = opts['user-data-dir'];
  const videoUrl = opts['video-url'];
  const maxComments = parseInt(opts['max-comments'] || '5', 10);

  if (!userDataDir || !videoUrl) {
    return { ok: false, error_code: 'MISSING_ARGS', error: '需 --user-data-dir 与 --video-url' };
  }

  // launchPersistentContext：复用 burner cookie/session（与 Path 1 主号物理隔离）
  // channel 'msedge'：客户机统一用 Edge（已装 Chromium 内核），避免下 Playwright Chromium 包
  const context = await playwright.chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
  });

  let page;
  try {
    page = (context.pages() && context.pages()[0]) || (await context.newPage());

    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // R4 检测：burner cookie 失效 → 跳 login / passport
    const currentUrl = page.url();
    if (/\/login(\b|\/|$)|\/passport/.test(currentUrl)) {
      return {
        ok: false,
        error_code: 'BURNER_SESSION_EXPIRED',
        error: 'burner cookie 失效，页面跳 /login，请重新扫码绑定',
        current_url: currentUrl,
      };
    }

    // 等评论区加载（comment-item selector）
    try {
      await page.waitForSelector('[data-e2e="comment-item"]', { timeout: 30000 });
    } catch (err) {
      // R2: 视频不可访问或评论区结构变了
      const stillLogin = /\/login(\b|\/|$)|\/passport/.test(page.url());
      if (stillLogin) {
        return {
          ok: false,
          error_code: 'BURNER_SESSION_EXPIRED',
          error: '页面跳 /login（DOM 渲染期间触发）',
        };
      }
      // 检查是否是 captcha
      const html = await page.content();
      if (/captcha|verify|安全验证/i.test(html)) {
        return {
          ok: false,
          error_code: 'CAPTCHA_TRIGGERED',
          error: '抖音风控触发验证码，请稍后重试或换号',
        };
      }
      return {
        ok: false,
        error_code: 'VIDEO_NOT_AVAILABLE',
        error: '视频不可访问或评论区无加载: ' + (err.message || String(err)),
      };
    }

    // 解析评论 — 取前 maxComments 条
    const allComments = await page.$$eval('[data-e2e="comment-item"]', (items) => {
      return items.map((el) => {
        const userEl = el.querySelector('[data-e2e="comment-user"], a[href*="/user/"]');
        const textEl = el.querySelector('[data-e2e="comment-content"], .comment-content, p');
        const timeEl = el.querySelector('[data-e2e="comment-time"], time, span.time');
        const commenter_id = userEl
          ? (userEl.getAttribute('href') || userEl.textContent || '').trim()
          : '';
        const text = textEl ? (textEl.textContent || '').trim() : '';
        const publish_time = timeEl
          ? (timeEl.getAttribute('datetime') || timeEl.textContent || '').trim()
          : new Date().toISOString();
        return { commenter_id, text, publish_time };
      });
    });

    // R3 评论 0 早 return — 不抛错，返成功 + 空数组
    if (allComments.length === 0) {
      return {
        ok: true,
        comments: [],
        video_url: videoUrl,
        comment_count: 0,
      };
    }

    const comments = allComments.slice(0, 5);

    return {
      ok: true,
      comments,
      video_url: videoUrl,
      comment_count: comments.length,
    };
  } catch (err) {
    return {
      ok: false,
      error_code: 'CRAWL_FAILED',
      error: err.message || String(err),
    };
  } finally {
    try {
      await context.close();
    } catch (e) {
      // ignore
    }
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  crawlComments(args)
    .then((res) => {
      process.stdout.write(JSON.stringify(res) + '\n');
      process.exit(res.ok ? 0 : 1);
    })
    .catch((err) => {
      process.stdout.write(
        JSON.stringify({ ok: false, error_code: 'UNCAUGHT', error: err.message || String(err) }) + '\n',
      );
      process.exit(2);
    });
}

module.exports = { crawlComments };
