#!/usr/bin/env node
'use strict';
/**
 * qr-bind-douyin.cjs — 抖音 QR 扫码绑定（外部进程）
 *
 * pkg 二进制内 require('playwright') 在 Node 18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node.js 进程运行，从真实文件系统加载 playwright-core，绕过 pkg VFS 限制。
 *
 * Usage: node qr-bind-douyin.cjs <account_label> [session_dir] [timeout_ms]
 * Output: 最后一行 stdout JSON → { ok, sessionPath, cookie_local_path, qr_login, error? }
 * Logs:   stderr
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

const [,, accountLabel = 'default', sessionDirArg = '', timeoutMsStr = '300000'] = process.argv;
const timeoutMs = parseInt(timeoutMsStr, 10) || 300000;

const DEFAULT_SESSION_DIR = path.join(os.homedir(), '.zenithjoy-agent', 'sessions');
const sessionDir = sessionDirArg || DEFAULT_SESSION_DIR;
const sessionPath = path.join(sessionDir, 'douyin', `${accountLabel}.json`);
const loginUrl = 'https://creator.douyin.com/creator-micro/home';

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
  let browser = null;
  try {
    browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(loginUrl);

    const pollIntervalMs = 1500;
    const start = Date.now();
    let storageState = { cookies: [] };

    while (Date.now() - start < timeoutMs) {
      const raw = await ctx.storageState();
      storageState = (raw || {});
      const cookies = storageState.cookies || [];
      if (cookies.some(isSessionCookie)) break;
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!(storageState.cookies || []).some(isSessionCookie)) {
      emit({
        ok: false,
        sessionPath,
        qr_login: 'timeout',
        error: `qr-bind timeout after ${timeoutMs}ms — 用户未完成扫码登录`,
      });
      process.exit(1);
      return;
    }

    fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
    fs.writeFileSync(sessionPath, JSON.stringify(storageState, null, 2));

    emit({ ok: true, sessionPath, cookie_local_path: sessionPath, qr_login: 'success' });
    process.exit(0);
  } catch (err) {
    emit({ ok: false, sessionPath, error: String(err) });
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

main().catch(e => {
  emit({ ok: false, sessionPath, error: String(e) });
  process.exit(1);
});
