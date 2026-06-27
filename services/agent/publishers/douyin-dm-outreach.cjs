#!/usr/bin/env node
'use strict';
/**
 * douyin-dm-outreach.cjs — 抖音 burner 号私信主动触达（外部进程，承载完整三态编排）
 *
 * pkg 二进制内 require/import playwright-core 在 Node18+ 报 "Invalid host defined options"，
 * 本脚本作为独立 Node 进程从真实 FS require('playwright-core') 绕过（同 qr-bind-douyin-burner.cjs）。
 *
 * Usage:  node douyin-dm-outreach.cjs <profile_url> <message> <account_label> [user_data_dir_root]
 * Output: 末行 stdout JSON → { ok, status, account_label, profile_url, error_code?, error? }；stderr 打日志
 *   status: sent=已发出 / limited=仅互关受限 / failed=失败
 */
const { chromium } = require('playwright-core');
const path = require('path');
const os = require('os');

const [, , profileUrl = '', message = '', accountLabel = '', userDataDirRootArg = ''] = process.argv;

// burner profile user-data-dir，与 qr-bind-douyin-burner getBurnerUserDataDir 同约定
function getBurnerUserDataDir() {
  if (userDataDirRootArg) return path.join(userDataDirRootArg, accountLabel);
  if (process.platform === 'win32') {
    return path.join('C:\\Temp', 'zj-douyin-burner-v1', accountLabel);
  }
  return path.join(os.homedir(), '.zenithjoy-agent', 'chrome-profile', 'douyin-burner', accountLabel);
}

// 抖音私信按钮（Semi UI）+ contenteditable 输入框
const DM_BUTTON_SELECTORS = [
  'button.semi-button-secondary:has-text("私信")',
  'button:has-text("私信")',
  'a[href*="/message"]',
];
const EDITOR_SELECTOR = 'div[contenteditable="true"]';

function emit(r) {
  process.stdout.write(JSON.stringify(r) + '\n');
}

async function main() {
  if (!profileUrl) {
    emit({ ok: false, status: 'failed', account_label: accountLabel, error_code: 'MISSING_PROFILE_URL', error: 'profile_url 必填' });
    process.exit(1);
    return;
  }
  if (!message) {
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'MISSING_MESSAGE', error: 'message 必填' });
    process.exit(1);
    return;
  }

  const userDataDir = getBurnerUserDataDir();
  let context = null;
  try {
    // 多级浏览器 fallback：bundled chromium → system Chrome → system Edge（headful 真发）
    const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox'];
    for (const opts of [
      { headless: false, args: launchArgs },
      { headless: false, channel: 'chrome', args: launchArgs },
      { headless: false, channel: 'msedge', args: launchArgs },
    ]) {
      try {
        context = await chromium.launchPersistentContext(userDataDir, opts);
        process.stderr.write(`[douyin-dm-outreach] 已 launch (${JSON.stringify(opts)})\n`);
        break;
      } catch (e) {
        process.stderr.write(`[douyin-dm-outreach] launch 失败 ${JSON.stringify(opts)}: ${e.message}\n`);
      }
    }
    if (!context) {
      emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'PAGE_LAUNCH_FAILED', error: '无法启动浏览器：bundled chromium / system chrome / system edge 均不可用' });
      process.exit(1);
      return;
    }

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // 进主页 + 模拟滑动随机停留降风控
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
    await page.mouse.wheel(0, 600).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500 + (message.length % 5) * 300));

    // 点私信按钮；不可点 = 仅互关受限 → 如实标 limited（禁止假 sent）
    let canDm = false;
    for (const sel of DM_BUTTON_SELECTORS) {
      const loc = page.locator(sel).first();
      try {
        if ((await loc.count()) > 0 && (await loc.isEnabled())) {
          await loc.click({ timeout: 5000 });
          canDm = true;
          break;
        }
      } catch {
        // 该 selector 不可点，试下一个
      }
    }
    if (!canDm) {
      emit({ ok: false, status: 'limited', account_label: accountLabel, profile_url: profileUrl });
      process.exit(0);
      return;
    }

    // 输入文案 + 回车
    const editor = page.locator(EDITOR_SELECTOR).first();
    await editor.click({ timeout: 5000 });
    await editor.fill(message);
    await page.keyboard.press('Enter');

    // 气泡出现 = 真发出
    let sent = false;
    try {
      const bubble = page.locator(`text=${message}`).first();
      await bubble.waitFor({ state: 'visible', timeout: 5000 });
      sent = true;
    } catch {
      sent = false;
    }
    if (sent) {
      emit({ ok: true, status: 'sent', account_label: accountLabel, profile_url: profileUrl });
      process.exit(0);
      return;
    }
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'NO_BUBBLE', error: '回车后未见消息气泡' });
    process.exit(0);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    process.stderr.write(`[douyin-dm-outreach] error: ${msg}\n`);
    emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'SEND_ERROR', error: msg });
    process.exit(1);
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

main().catch((e) => {
  emit({ ok: false, status: 'failed', account_label: accountLabel, profile_url: profileUrl, error_code: 'SEND_ERROR', error: String(e) });
  process.exit(1);
});
