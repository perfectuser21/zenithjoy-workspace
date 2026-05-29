/**
 * douyin-publisher qr-login 共享模块（WS3）
 *
 * 职责：
 *   - 通过 Playwright connectOverCDP 复用客户机上已开的 Chrome (localhost:19222)
 *   - 检测当前是否已登录抖音创作者后台（creator.douyin.com）
 *   - 未登录时打开抖音登录页 → 截屏 QR → throw NEED_QR + qrScreenshotPath
 *   - lead 用手机扫码后再次调用本模块 → 检测登录成功 → resolve
 *
 * 配合 ws4 Dashboard 弹码 UI：Agent 把 QR 截图通过 task.result.qr_screenshot 推回中台。
 *
 * 严禁预置 cookie 跳过扫码（contract Lead 自验防作弊条款）。
 */
const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');
const fs = require('fs');

const CDP_URL = process.env.ZENITHJOY_AGENT_CDP_URL || 'http://localhost:19222';
const LOGIN_URL = 'https://creator.douyin.com/';
const LOGGED_IN_INDICATOR = '[data-testid="user-avatar"], [aria-label*="头像"], [role="img"][alt*="头像"]';
const DEFAULT_TIMEOUT_MS = 90_000;

async function getOrCreatePage(browser) {
  const contexts = browser.contexts();
  if (!contexts.length) throw new Error('CDP 没有上下文，确认 Chrome 19222 是否启动 (--remote-debugging-port=19222)');
  const ctx = contexts[0];
  const pages = ctx.pages();
  return pages.length ? pages[0] : await ctx.newPage();
}

/**
 * 检查并保证已登录抖音创作者后台。
 *
 * 已登录 → resolve()
 * 未登录 → page.screenshot 截屏 QR → throw Error with code='NEED_QR' + qrScreenshotPath
 *
 * @param {object} opts
 * @param {string} [opts.qrScreenshotPath] - QR 截图保存路径（默认 ~/.zenithjoy/cookies/douyin-qr-<ts>.png）
 * @param {number} [opts.timeoutMs=90000] - 等待登录态出现的总超时
 * @param {object} [opts.injectedPage] - 测试注入的 fake page（不连真 CDP）
 */
async function requireLogin(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const qrScreenshotPath =
    opts.qrScreenshotPath ||
    path.join(os.homedir(), '.zenithjoy', 'cookies', `douyin-qr-${Date.now()}.png`);

  let page;
  let browser;
  if (opts.injectedPage) {
    page = opts.injectedPage;
  } else {
    browser = await chromium.connectOverCDP(CDP_URL);
    page = await getOrCreatePage(browser);
  }

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => undefined);

  const url = page.url();
  // 已经在 creator-micro/* 路径 → 已登录
  if (typeof url === 'string' && /creator(-micro)?\.douyin\.com\/(creator-micro|content)/.test(url)) {
    console.log('[qr-login] already logged in:', url);
    return { loggedIn: true };
  }

  // 检查登录指示器
  let indicator = null;
  try {
    indicator = await page.$(LOGGED_IN_INDICATOR);
  } catch {}
  if (indicator) {
    console.log('[qr-login] already logged in via indicator');
    return { loggedIn: true };
  }

  // 未登录：截屏 QR 区域
  fs.mkdirSync(path.dirname(qrScreenshotPath), { recursive: true });
  try {
    await page.screenshot({ path: qrScreenshotPath, fullPage: false });
  } catch (e) {
    console.error('[qr-login] screenshot failed:', e.message);
  }

  // 等用户扫码（轮询登录指示器）
  try {
    await page.waitForSelector(LOGGED_IN_INDICATOR, { timeout: timeoutMs });
    console.log('[qr-login] login detected after scan');
    return { loggedIn: true, qrScreenshotPath };
  } catch (waitErr) {
    const err = new Error(`NEED_QR: 请在 ${Math.round(timeoutMs / 1000)} 秒内用手机抖音 App 扫码登录（QR 截图: ${qrScreenshotPath}）`);
    err.code = 'NEED_QR';
    err.qrScreenshotPath = qrScreenshotPath;
    err.screenshotPath = qrScreenshotPath;
    throw err;
  }
}

module.exports = { requireLogin, CDP_URL };
