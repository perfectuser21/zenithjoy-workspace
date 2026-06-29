#!/usr/bin/env node
'use strict';
/**
 * qr-bind-douyin-burner.cjs — 抖音「小号(burner)」QR 扫码绑定（外部进程）
 *
 * pkg 二进制内 require('playwright')/import('playwright-core') 在 Node 18+ 报
 * "Invalid host defined options"，本脚本作为独立 Node.js 进程运行，从真实文件系统
 * 加载 playwright-core，绕过 pkg VFS 限制（publisher / qr-bind-operator 同款做法）。
 *
 * 与 Path 1 主号物理隔离：
 *   - user-data-dir：win32 C:\Temp\zj-douyin-burner-v1\<accountLabel>
 *                    其它    ~/.zenithjoy-agent/chrome-profile/douyin-burner/<accountLabel>
 *   - sessionPath ：含 /burner/ 子目录 → <sessionDir>/douyin/burner/<accountLabel>.json
 *   - loginUrl    ：https://creator.douyin.com/
 *
 * Usage:  node qr-bind-douyin-burner.cjs <account_label> [session_dir] [user_data_dir_root] [timeout_ms]
 * Output: 最后一行 stdout JSON → { ok, sessionPath, cookie_local_path, qr_login, account_nickname, error? }
 * Logs:   stderr（不干扰 JSON 解析）
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const [
  ,
  ,
  accountLabel = 'default',
  sessionDirArg = '',
  userDataDirRootArg = '',
  timeoutMsStr = '600000',
] = process.argv;
const timeoutMs = parseInt(timeoutMsStr, 10) || 600000;

const DEFAULT_SESSION_DIR = path.join(os.homedir(), '.zenithjoy-agent', 'sessions');
const sessionDir = sessionDirArg || DEFAULT_SESSION_DIR;
// 关键：含 /burner/ 子目录，与 Path 1 main 隔离（与 handler getBurnerSessionPath 同约定）
const sessionPath = path.join(sessionDir, 'douyin', 'burner', `${accountLabel}.json`);
const loginUrl = 'https://creator.douyin.com/';

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

function getBurnerUserDataDir() {
  if (userDataDirRootArg) return path.join(userDataDirRootArg, accountLabel);
  if (process.platform === 'win32') {
    return path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel);
  }
  return path.join(
    os.homedir(),
    '.zenithjoy-agent',
    'chrome-profile',
    'douyin-burner',
    accountLabel,
  );
}

const SESSION_COOKIE_NAMES = ['sessionid_ss', 'sessionid', 'sid_tt'];

function isSessionCookie(c) {
  return (
    typeof c?.value === 'string' &&
    c.value.length > 0 &&
    typeof c?.domain === 'string' &&
    (c.domain.endsWith('.douyin.com') || c.domain === 'douyin.com') &&
    SESSION_COOKIE_NAMES.includes(c.name)
  );
}

function emit(result) {
  process.stdout.write(JSON.stringify(result) + '\n');
}

async function main() {
  const userDataDir = getBurnerUserDataDir();
  let context = null;
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });

    // 多级浏览器 fallback（headful，用户可见扫码窗口）：
    //   1. executablePath 文件系统探测（findSystemChrome，优先；覆盖任意安装路径）
    //   2. bundled Chromium（pkg 内置，通常是 headless-shell，可能不支持 headful）
    //   3. channel: 'msedge'（注册表查 Edge，最后兜底）
    // 不再用 channel: 'chrome' —— Playwright 注册表路由在部分 Windows 机器上失效。
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    const systemChrome = findSystemChrome();
    if (systemChrome) {
      process.stderr.write(`[qr-bind-douyin-burner] 探测到系统 Chrome: ${systemChrome}\n`);
    }
    for (const opts of [
      ...(systemChrome ? [{ headless: false, executablePath: systemChrome, args: launchArgs }] : []),
      { headless: false, args: launchArgs },
      { headless: false, channel: 'msedge', args: launchArgs },
    ]) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, opts);
        process.stderr.write(`[qr-bind-douyin-burner] 已 launch (${JSON.stringify(opts)})\n`);
        break;
      } catch (e) {
        process.stderr.write(`[qr-bind-douyin-burner] launch 失败 ${JSON.stringify(opts)}: ${e.message}\n`);
      }
    }
    if (!context) {
      throw new Error('无法启动浏览器：system chrome / bundled chromium / msedge 均不可用');
    }

    const existing = context.pages();
    const page = existing.length > 0 ? existing[0] : await context.newPage();
    await page.goto(loginUrl).catch(() => undefined);

    // 轮询 storageState cookie 直到出现抖音 session cookie；timeout 默认 10 分钟（给 user 找小号手机时间）
    const pollIntervalMs = 2000;
    const start = Date.now();
    let storageState = { cookies: [] };
    while (Date.now() - start < timeoutMs) {
      const raw = await context.storageState();
      storageState = raw || {};
      const cookies = storageState.cookies || [];
      if (cookies.some(isSessionCookie)) break;
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    if (!(storageState.cookies || []).some(isSessionCookie)) {
      emit({
        ok: false,
        sessionPath,
        qr_login: 'timeout',
        error: `qr-bind-burner timeout after ${timeoutMs}ms — 用户未完成扫码登录`,
      });
      process.exit(1);
      return;
    }

    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    let accountNickname = accountLabel;
    try {
      const title = await page.title();
      if (title) accountNickname = title.slice(0, 50);
    } catch {
      /* title 不强制 */
    }

    emit({
      ok: true,
      sessionPath,
      cookie_local_path: sessionPath,
      qr_login: 'success',
      account_nickname: accountNickname,
    });
    process.exit(0);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    const isTimeout = /timeout|timed out/i.test(msg);
    emit({
      ok: false,
      sessionPath,
      qr_login: isTimeout ? 'timeout' : 'failed',
      error: msg,
    });
    process.exit(1);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

main().catch((e) => {
  emit({ ok: false, sessionPath, error: String(e) });
  process.exit(1);
});
