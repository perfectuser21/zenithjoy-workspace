#!/usr/bin/env node
'use strict';
/**
 * crawl-comments-douyin.cjs — 抖音视频评论区抓取 → commenter 信息 → POST collect/report
 *
 * Usage: node crawl-comments-douyin.cjs <video_url> <task_id> [apiBase] [unused] [--stdout-only]
 * Output: 末行 stdout JSON → { ok, task_id, video_url, inserted, error? }
 *
 * v2.0.0: 改用 burner user-data-dir 自动启动 Edge（launchPersistentContext），
 *         cookies 从绑定时保存的 profile 自动加载，不再依赖外部已运行的 Chrome CDP。
 */
const { chromium } = require('playwright-core');
const https = require('https');
const http = require('http');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 滚动参数
const STABLE_ROUNDS = 3;
const SCROLL_PAUSE_MS = 1500;
const MAX_SCROLL_ROUNDS = 15; // ~22 秒/视频，避免热门视频卡死

const [, , videoUrl = '', taskId = '', apiBase = 'http://localhost:3000', , mode = ''] = process.argv;
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

function findSystemChrome() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH || '',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : '',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function findBundledChromium() {
  const exe = path.join(os.homedir(), '.zenithjoy-agent', 'chrome-win64', 'chrome.exe');
  return fs.existsSync(exe) ? exe : null;
}

// 从 .env 文件读取变量（始终先读文件，拿到 qr-bind 写入的最新账号路径）
function readEnvFile() {
  const candidates = [
    path.join(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    try {
      const vars = {};
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (m) vars[m[1]] = m[2].trim();
      }
      if (Object.keys(vars).length > 0) return vars;
    } catch (_) {}
  }
  return {};
}

/**
 * 自动发现 burner Chrome profile 目录（由 qr-bind-douyin-burner 在绑定时创建）。
 * 优先级：1. .env 文件里的 ZJ_MAIN_DATA_DIR（始终重读，保证 qr-bind 更新后立即生效）
 *          2. process.env.ZJ_MAIN_DATA_DIR（兜底）
 *          3. 扫根目录取第一个子目录（单账号兜底）
 * Windows: C:\Temp\zj-douyin-burner-v1\<account_label>
 * Mac/Linux: ~/.zenithjoy-agent/chrome-profile/douyin-burner/<account_label>
 */
function resolveBurnerProfileDir() {
  // 始终先读 .env 文件（qr-bind 更新后子进程才能感知最新账号）
  const envFile = readEnvFile();
  const fromFile = envFile['ZJ_MAIN_DATA_DIR'];
  if (fromFile && fromFile !== 'null' && fs.existsSync(fromFile)) {
    return fromFile;
  }
  // 兜底：process.env（agent 启动时的继承值）
  if (process.env.ZJ_MAIN_DATA_DIR && fs.existsSync(process.env.ZJ_MAIN_DATA_DIR)) {
    return process.env.ZJ_MAIN_DATA_DIR;
  }
  let root;
  if (process.platform === 'win32') {
    root = path.join('C:\\Temp', 'zj-douyin-burner-v1');
  } else {
    root = path.join(os.homedir(), '.zenithjoy-agent', 'chrome-profile', 'douyin-burner');
  }
  if (!fs.existsSync(root)) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const dir = entries.find(e => e.isDirectory());
  return dir ? path.join(root, dir.name) : null;
}

/**
 * 滚动评论区直到稳定（连续 STABLE_ROUNDS 轮无新评论出现）
 */
async function scrollUntilStable(page) {
  let stableCount = 0;
  let prevCount = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
    await page.evaluate(() => {
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

async function crawlVideoComments(context, videoUrl, taskId, apiBase) {
  const page = (context.pages()[0]) || await context.newPage();
  const commenters = [];

  try {
    await page.goto(videoUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });

    // 检测 burner cookie 失效 → 页面跳转到 /login 或 /passport
    const currentUrl = page.url();
    if (/\/login(\b|\/|$)|\/passport/.test(currentUrl)) {
      return { ok: false, error: 'BURNER_SESSION_EXPIRED: cookie 失效，请重新扫码绑定小号' };
    }

    // 等第一批评论出现（最多 40s，抖音评论由 XHR 异步加载）
    await page.waitForSelector('[data-e2e="comment-item"]', { timeout: 40000 }).catch(() => {});

    // 滚动加载更多评论
    await scrollUntilStable(page);

    // 收集评论者信息
    const commentItems = await page.$$('[data-e2e="comment-item"]').catch(() => []);

    for (const item of commentItems) {
      try {
        const profileLink = await item.$eval('a[href*="/user/"]', el => el.getAttribute('href') || '').catch(() => '');
        const nickname = await item.$eval('a[href*="/user/"]', el => el.textContent?.trim() || '').catch(() => '');
        const secUidMatch = profileLink.match(/\/user\/([^/?]+)/);
        const secUid = secUidMatch ? secUidMatch[1] : null;

        const commentText = await item.evaluate(el => {
          const spans = el.querySelectorAll('span');
          for (const span of spans) {
            if (span.children.length > 0) continue;
            const t = span.textContent?.trim() || '';
            if (!t) continue;
            if (span.closest('a[href*="/user/"]')) continue;
            if (t.includes('·') || /^[\d]+[天月年小时前]/.test(t)) continue;
            if (/^\d+$/.test(t)) continue;
            if (['分享', '回复', '举报', '...', 'share', 'reply'].includes(t)) continue;
            if (/^展开.+回复$/.test(t)) continue;
            return t;
          }
          return '';
        }).catch(() => '');

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
    emit({ ok: false, error: 'Usage: crawl-comments-douyin.cjs <video_url> <task_id> [apiBase]' });
    process.exit(1);
  }

  const userDataDir = resolveBurnerProfileDir();
  if (!userDataDir) {
    emit({
      ok: false,
      task_id: taskId,
      video_url: videoUrl,
      error: 'BURNER_PROFILE_NOT_FOUND: 未找到已绑定的抖音小号 profile，请先在客户端扫码绑定小号',
    });
    process.exit(1);
  }

  // 与 qr-bind-douyin-burner 保持相同浏览器选择优先级，避免跨浏览器 DPAPI 加密不兼容（
  // Chrome 绑 → Edge 读 = cookie 解密失败 → 强制扫码）
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
  const systemChrome = findSystemChrome();
  const bundledChrome = findBundledChromium();
  let context = null;
  for (const opts of [
    ...(systemChrome  ? [{ headless: false, executablePath: systemChrome,  args: launchArgs }] : []),
    ...(bundledChrome ? [{ headless: false, executablePath: bundledChrome, args: launchArgs }] : []),
    { headless: false, args: launchArgs },
    { headless: false, channel: 'msedge', args: launchArgs },
  ]) {
    try {
      context = await chromium.launchPersistentContext(userDataDir, opts);
      break;
    } catch (e) {
      process.stderr.write(`[crawl-comments] launch 失败 ${JSON.stringify(opts)}: ${e.message}\n`);
    }
  }
  if (!context) {
    emit({ ok: false, task_id: taskId, video_url: videoUrl, error: '无法启动浏览器（Chrome/bundledChromium/msedge 均不可用）' });
    process.exit(1);
  }

  try {
    const result = await crawlVideoComments(context, videoUrl, taskId, apiBase);
    if (STDOUT_ONLY) {
      emit({ ok: result.ok, video_url: videoUrl, commenters: result.commenters || [], inserted: result.inserted || 0, error: result.error });
    } else {
      emit({ ok: result.ok, task_id: taskId, video_url: videoUrl, inserted: result.inserted || 0, error: result.error });
    }
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch(err => {
  emit({ ok: false, task_id: taskId, video_url: videoUrl, error: err.message });
  process.exit(1);
});
