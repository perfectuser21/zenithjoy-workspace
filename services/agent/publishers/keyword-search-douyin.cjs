#!/usr/bin/env node
'use strict';
/**
 * keyword-search-douyin.cjs — 搜抖音关键词取热门视频 URL（外部进程）
 *
 * 架构：
 *   1. 从 .env 文件读取 ZJ_MAIN_DATA_DIR（不依赖进程 env 继承）
 *   2. spawn 真 Chrome（不带 --enable-automation）+ --disable-gpu（防 agent 子进程崩溃）
 *   3. CDP 连入，在主号已登录 session 下搜索
 *   4. 兜底：headless-shell（无登录 session，大概率遇验证码）
 *
 * Usage:  node keyword-search-douyin.cjs <keyword> [cdpPort=19222] [maxVideos=5]
 * Output: 末行 stdout JSON → { ok, keyword, video_urls, error? }
 */
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const [, , keyword = '', , maxVideosStr = '5'] = process.argv;
const maxVideos = parseInt(maxVideosStr, 10) || 5;
const BURNER_CDP_PORT = 19225; // 专用端口，避免和 headless-shell 的 19222 冲突

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

// 从 .env 文件读取变量
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
      if (Object.keys(vars).length > 0) return vars;
    } catch (_) {}
  }
  return {};
}

// 始终先读 .env 文件（qr-bind 更新后子进程才能感知最新账号），process.env 仅作兜底
function getBurnerDataDir() {
  const env = readEnvFile();
  const fromFile = env['ZJ_MAIN_DATA_DIR'];
  if (fromFile && fromFile !== 'null') return fromFile;
  const v = process.env.ZJ_MAIN_DATA_DIR;
  return (v && v !== 'null') ? v : null;
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
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  return null;
}

// Agent 启动时后台下载至此路径（ensureChromiumHeadful），与 qr-bind-douyin-burner.cjs 一致。
function findBundledChromium() {
  if (process.platform !== 'win32') return null;
  const userProfile = process.env.USERPROFILE || '';
  if (!userProfile) return null;
  const p = path.join(userProfile, '.zenithjoy-agent', 'chrome-win64', 'chrome.exe');
  return fs.existsSync(p) ? p : null;
}

function findHeadlessShell() {
  const envExe = process.env.ZJ_CHROME_EXE;
  if (envExe && fs.existsSync(envExe)) return envExe;
  if (process.platform !== 'win32') return null;
  const userProfile = process.env.USERPROFILE || 'C:\\Users\\asus';
  const p = path.join(userProfile, '.cache', 'hyperframes', 'chrome', 'chrome-headless-shell',
    'win64-131.0.6778.85', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  return fs.existsSync(p) ? p : null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function killPort(port) {
  if (process.platform !== 'win32') return;
  try {
    const out = execSync(`netstat -ano 2>nul | findstr ":${port} "`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const pids = [...new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(p => p && /^\d+$/.test(p)))];
    for (const pid of pids) try { execSync(`taskkill /F /PID ${pid} 2>nul`, { stdio: 'ignore' }); } catch (_) {}
  } catch (_) {}
}

// 读取当前 Chrome 绑定的 user-data-dir（写在 profile lock file 里）
function readActiveBurnerDir() {
  const lockFile = require('os').tmpdir() + '/zj-burner-active-dir.txt';
  try { return require('fs').readFileSync(lockFile, 'utf8').trim(); } catch (_) { return ''; }
}
function writeActiveBurnerDir(dir) {
  const lockFile = require('os').tmpdir() + '/zj-burner-active-dir.txt';
  try { require('fs').writeFileSync(lockFile, dir, 'utf8'); } catch (_) {}
}

async function spawnBurnerChrome(burnerDataDir, chromePath) {
  // 复用已有 Chrome（若端口已在监听且 profile 与当前期望一致）
  try {
    const b = await chromium.connectOverCDP(`http://localhost:${BURNER_CDP_PORT}`);
    if (b.contexts().length > 0) {
      const activeDir = readActiveBurnerDir();
      if (activeDir && activeDir === burnerDataDir) {
        process.stderr.write(`[keyword-search-douyin] 复用已有 burner Chrome (${BURNER_CDP_PORT}, profile 匹配)\n`);
        return { browser: b, spawned: false };
      }
      // profile 不匹配，关闭旧 Chrome 重开
      process.stderr.write(`[keyword-search-douyin] profile 不匹配 (active="${activeDir}" want="${burnerDataDir}")，关闭旧 Chrome 重开\n`);
      try { await b.close(); } catch (_) {}
    } else {
      await b.close();
    }
  } catch (_) {}

  killPort(BURNER_CDP_PORT);
  await sleep(300);

  process.stderr.write(`[keyword-search-douyin] spawn Chrome (无 --enable-automation): ${chromePath}\n`);
  // --disable-gpu: 防止 agent 子进程环境下 GPU 初始化崩溃（已验证必须）
  // 不加 --enable-automation: Chrome 不设 navigator.webdriver=true，规避 bot 检测
  const child = spawn(chromePath, [
    `--user-data-dir=${burnerDataDir}`,
    `--remote-debugging-port=${BURNER_CDP_PORT}`,
    '--remote-allow-origins=*',
    '--disable-blink-features=AutomationControlled',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    'https://www.douyin.com',
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  writeActiveBurnerDir(burnerDataDir);
  process.stderr.write(`[keyword-search-douyin] Chrome PID=${child.pid}, 等待 CDP 就绪...\n`);
  for (let i = 0; i < 20; i++) {
    await sleep(750);
    try {
      const b = await chromium.connectOverCDP(`http://localhost:${BURNER_CDP_PORT}`);
      process.stderr.write(`[keyword-search-douyin] CDP 就绪 (${Math.round((i + 1) * 0.75)}s)\n`);
      return { browser: b, spawned: true };
    } catch (_) {}
  }
  throw new Error('Burner Chrome 启动超时 (15s)');
}

// 从 burner user-data-dir 路径推导 session JSON 文件路径
// 约定：~/.zenithjoy-agent/sessions/douyin/burner/<accountLabel>.json
// accountLabel = path.basename(burnerDataDir)（与 qr-bind-douyin-burner.cjs 保持一致）
function getSessionJsonPath(burnerDataDir) {
  const accountLabel = path.basename(burnerDataDir);
  return path.join(os.homedir(), '.zenithjoy-agent', 'sessions', 'douyin', 'burner', `${accountLabel}.json`);
}

// 从 session JSON 注入 Douyin cookies 到 Playwright context。
// 用于 Chrome profile 里 sessionid 已过期时的 fallback：读 qr-bind 落盘的 JSON 重注入。
// 返回 true 代表注入成功（JSON 存在且含 sessionid 类 cookie），false 代表跳过。
async function injectSessionFromJson(ctx, burnerDataDir) {
  const sessionPath = getSessionJsonPath(burnerDataDir);
  if (!fs.existsSync(sessionPath)) {
    process.stderr.write(`[keyword-search-douyin] session JSON 不存在: ${sessionPath}\n`);
    return false;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  } catch (e) {
    process.stderr.write(`[keyword-search-douyin] 读取 session JSON 失败: ${e.message}\n`);
    return false;
  }
  const douyinCookies = (raw.cookies || []).filter(
    c => c.domain && (c.domain.endsWith('.douyin.com') || c.domain === 'douyin.com'),
  );
  const hasSession = douyinCookies.some(c => ['sessionid', 'sessionid_ss'].includes(c.name) && c.value && c.value.length > 20);
  if (!hasSession) {
    process.stderr.write(`[keyword-search-douyin] session JSON 中无有效 sessionid cookie\n`);
    return false;
  }
  await ctx.addCookies(douyinCookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    expires: (c.expires && c.expires > 0) ? c.expires : -1,
    sameSite: c.sameSite || 'None',
  })));
  process.stderr.write(`[keyword-search-douyin] 已从 session JSON 注入 ${douyinCookies.length} 个 cookies (${sessionPath})\n`);
  return true;
}

async function main() {
  if (!keyword) {
    emit({ ok: false, keyword, video_urls: [], error: 'MISSING_KEYWORD' });
    process.exit(1);
    return;
  }

  const burnerDataDir = getBurnerDataDir();
  const headfulChrome = findSystemChrome() || findBundledChromium();
  process.stderr.write(`[keyword-search-douyin] kw="${keyword}" burner=${burnerDataDir} chrome=${headfulChrome || 'null'}\n`);

  // 有头模式必须有 burner session + Chrome；缺一报错，不走无头（无头走不过验证码且行为不正常）
  if (!burnerDataDir || !headfulChrome) {
    const reason = !burnerDataDir
      ? '缺 ZJ_MAIN_DATA_DIR（请先绑定抖音小号）'
      : '找不到 Chrome 或 bundled Chromium（请等 agent 完成 Chromium 下载，约 2 分钟）';
    emit({ ok: false, keyword, video_urls: [], error: `NO_HEADFUL_CHROME: ${reason}` });
    process.exit(1);
    return;
  }

  let browser = null;
  let spawned = false;
  try {
    {
      // 有头真 Chrome（已登录 Douyin session）
      const r = await spawnBurnerChrome(burnerDataDir, headfulChrome);
      browser = r.browser;
      spawned = r.spawned;
    }

    const contexts = browser.contexts();
    const ctx = contexts.length > 0 ? contexts[0] : await browser.newContext();
    const cookies = await ctx.cookies(['https://www.douyin.com']);
    process.stderr.write(`[keyword-search-douyin] douyin cookies: ${cookies.length}\n`);

    // 检查 Douyin 登录状态：必须有 sessionid（登录凭证）。
    // ttwid/uid_tt 是访客 token，未登录也会有，不能作为"已登录"判据。
    let sessionidCookie = cookies.find(c => c.name === 'sessionid' && c.value);
    if (!sessionidCookie) {
      const cookieNames = cookies.map(c => c.name).join(',');
      process.stderr.write(`[keyword-search-douyin] Douyin sessionid 不存在（当前 cookies: ${cookieNames}），尝试从 session JSON 注入\n`);
      // Fallback：从 qr-bind 落盘的 session JSON 重注入 cookies。
      // 发生场景：Chrome profile 的 Cookies SQLite 未及时落盘（qr-bind 进程 exit 顺序 bug 或首次冷启动），
      // 但 JSON 文件已正确写入 → 重注入后 sessionid 即可被识别，无需用户重新扫码。
      const injected = await injectSessionFromJson(ctx, burnerDataDir);
      if (injected) {
        const newCookies = await ctx.cookies(['https://www.douyin.com']);
        sessionidCookie = newCookies.find(c => c.name === 'sessionid' && c.value);
        if (sessionidCookie) {
          process.stderr.write(`[keyword-search-douyin] session JSON 注入成功，sessionid 已确认\n`);
        } else {
          process.stderr.write(`[keyword-search-douyin] 注入后仍无 sessionid，session JSON 可能已过期\n`);
        }
      }
    }
    if (!sessionidCookie) {
      emit({ ok: false, keyword, video_urls: [], error: 'DOUYIN_SESSION_EXPIRED' });
      process.exit(0);
      return;
    }
    process.stderr.write(`[keyword-search-douyin] sessionid 存在，继续搜索\n`);

    // 优先复用已有 Douyin 页面（避免 newPage 被抖音 bot 检测），没有再开新标签
    const existingPages = ctx.pages();
    const existingDouyin = existingPages.find(p => p.url().includes('douyin.com'));
    const page = existingDouyin || await ctx.newPage();
    const pageIsNew = !existingDouyin;
    process.stderr.write(`[keyword-search-douyin] 使用${pageIsNew ? '新' : '已有'} tab (${page.url().slice(0, 60)})\n`);
    try {
      const searchUrl = `https://www.douyin.com/search/${encodeURIComponent(keyword)}?type=video`;
      const curUrl = page.url();
      const alreadyThere = curUrl === searchUrl || curUrl.startsWith(searchUrl.split('?')[0]);
      process.stderr.write(`[keyword-search-douyin] 导航 ${searchUrl} (alreadyThere=${alreadyThere})\n`);
      if (!alreadyThere) {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } else {
        // 已在目标 URL，用 JS pushState 触发 SPA 路由刷新（不触发完整重载）
        await page.evaluate((url) => {
          window.history.pushState({}, '', url);
          window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
        }, searchUrl).catch(() => null);
      }
      // 等页面渲染（包括首次加载和 SPA 刷新）
      await page.waitForFunction(() => document.title !== '', { timeout: 5000 }).catch(() => null);
      // 固定 6s 等 React 渲染搜索结果
      await new Promise(r => setTimeout(r, 6000));

      const title = await page.title();
      // 空 title 不算验证码（SPA 加载中），只看关键词
      const isCaptcha = title.includes('验证') || title.includes('captcha');
      process.stderr.write(`[keyword-search-douyin] title="${title}" isCaptcha=${isCaptcha}\n`);

      // 已在 goto/pushState 后等了 6s，不需要额外等待

      const videoUrls = await page.evaluate((max) => {
        const seen = new Set(), results = [];
        for (const a of document.querySelectorAll('a[href*="/video/"]')) {
          const m = a.href.match(/douyin\.com\/video\/(\d+)/);
          if (m && !seen.has(m[1])) {
            seen.add(m[1]);
            results.push(`https://www.douyin.com/video/${m[1]}`);
            if (results.length >= max) break;
          }
        }
        return results;
      }, maxVideos);

      process.stderr.write(`[keyword-search-douyin] 找到 ${videoUrls.length} 个视频\n`);
      emit({ ok: true, keyword, video_urls: videoUrls });
    } finally {
      // 复用已有 tab 不关闭（用户正在用）；只关自己新开的
      if (pageIsNew) await page.close().catch(() => null);
    }
  } catch (err) {
    const msg = String(err?.message || err);
    process.stderr.write(`[keyword-search-douyin] keyword="${keyword}" error: ${msg}\n`);
    emit({ ok: false, keyword, video_urls: [], error: msg });
  } finally {
    if (browser) await browser.close().catch(() => null);
    if (spawned) { await sleep(300); killPort(BURNER_CDP_PORT); }
  }
  process.exit(0);
}

main().catch((e) => {
  emit({ ok: false, keyword, video_urls: [], error: String(e) });
  process.exit(1);
});
