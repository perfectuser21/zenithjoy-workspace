#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 视频号心跳保活
 *
 * 定期连接视频号 CDP，模拟用户活跃，延长 session 有效期。
 * 用法: node keepalive.cjs
 * 建议: 每 30 分钟通过 LaunchAgent 运行
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'http://localhost:19228';
const CONNECT_TIMEOUT = 10000;
const COOKIE_BACKUP_DIR = path.join(__dirname, '.cookie-backups');
const LOGIN_PATTERNS = ['login', 'passport'];

async function main() {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  _log(`[${ts}] 视频号心跳保活开始`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: CONNECT_TIMEOUT });
  } catch (err) {
    _log(`❌ CDP 连接失败: ${err.message}`);
    process.exit(1);
  }

  try {
    const ctx = browser.contexts()[0];
    if (!ctx) { _log('❌ 无浏览器上下文'); process.exit(1); }
    const page = ctx.pages()[0];
    if (!page) { _log('❌ 无页面'); process.exit(1); }

    const url = page.url();
    _log(`当前 URL: ${url}`);

    // 检查登录态
    const isLoggedOut = LOGIN_PATTERNS.some(p => url.toLowerCase().includes(p));
    if (isLoggedOut) {
      _log('⚠️ 视频号已掉线（URL 含 login/passport），需重新扫码');
      process.exit(1);
    }

    // 模拟用户活跃：导航到几个不同页面
    const pages_to_visit = [
      'https://channels.weixin.qq.com/platform/post/list',
      'https://channels.weixin.qq.com/platform/live/livelist',
      'https://channels.weixin.qq.com/platform',
    ];

    for (const target of pages_to_visit) {
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        _log(`  ✅ 访问: ${target.replace('https://channels.weixin.qq.com', '')}`);
      } catch (e) {
        _log(`  ⚠️ 访问失败: ${e.message.substring(0, 60)}`);
      }
    }

    // 验证最终登录态
    const finalUrl = page.url();
    const stillLoggedIn = !LOGIN_PATTERNS.some(p => finalUrl.toLowerCase().includes(p));

    if (stillLoggedIn) {
      _log('✅ 心跳完成，session 仍有效');

      // 备份 cookies
      try {
        if (!fs.existsSync(COOKIE_BACKUP_DIR)) fs.mkdirSync(COOKIE_BACKUP_DIR, { recursive: true });
        const cookies = await ctx.cookies();
        const backupFile = path.join(COOKIE_BACKUP_DIR, `cookies-${new Date().toISOString().split('T')[0]}.json`);
        fs.writeFileSync(backupFile, JSON.stringify(cookies, null, 2));
        _log(`📦 Cookie 备份: ${backupFile}`);

        // 只保留最近 7 天的备份
        const files = fs.readdirSync(COOKIE_BACKUP_DIR).sort().reverse();
        for (const f of files.slice(7)) {
          fs.unlinkSync(path.join(COOKIE_BACKUP_DIR, f));
        }
      } catch (e) {
        _log(`  ⚠️ Cookie 备份失败: ${e.message}`);
      }
    } else {
      _log('❌ 心跳后 session 已失效');
      process.exit(1);
    }

  } catch (err) {
    _log(`❌ 心跳过程异常: ${err.message}`);
    process.exit(1);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
