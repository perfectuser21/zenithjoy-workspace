#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 全平台心跳保活
 *
 * 两档策略：
 *   --frequent  视频号专用，每 30 分钟跑一次（LaunchAgent 控制频率）
 *   --normal    其他 6 平台，每 12 小时跑一次
 *
 * 用法:
 *   node keepalive-all.cjs --frequent   # 视频号（30分钟）
 *   node keepalive-all.cjs --normal     # 其他平台（12小时）
 *   node keepalive-all.cjs              # 全部跑一遍
 */

'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const WINDOWS_IP = '100.97.242.124';
const CONNECT_TIMEOUT = 15000;
const COOKIE_BACKUP_DIR = path.join(__dirname, '.cookie-backups');

const SHIPINHAO = {
  name: '视频号', port: 19228,
  loginPatterns: ['login', 'passport'],
  pages: [
    '/platform/post/list',
    '/platform/live/livelist',
    '/platform',
  ].map(p => 'https://channels.weixin.qq.com' + p),
};

const OTHERS = [
  { name: '抖音', port: 19222, loginPatterns: ['login', 'passport', 'douyin.com/login'],
    pages: ['https://creator.douyin.com/creator-micro/content/manage', 'https://creator.douyin.com/creator-micro/data/overview'] },
  { name: '快手', port: 19223, loginPatterns: ['login', 'passport', 'accounts.kuaishou'],
    pages: ['https://cp.kuaishou.com/article/publish/single', 'https://cp.kuaishou.com/profile'] },
  { name: '小红书', port: 19224, loginPatterns: ['login', 'passport', 'sign'],
    pages: ['https://creator.xiaohongshu.com/publish/publish', 'https://creator.xiaohongshu.com/statistics/data-analysis'] },
  { name: '头条(主)', port: 19225, loginPatterns: ['login', 'passport', 'sso.toutiao'],
    pages: ['https://mp.toutiao.com/profile_v4/graphic/publish', 'https://mp.toutiao.com/profile_v4/index'] },
  { name: '头条(副)', port: 19226, loginPatterns: ['login', 'passport', 'sso.toutiao'],
    pages: ['https://mp.toutiao.com/profile_v4/graphic/publish', 'https://mp.toutiao.com/profile_v4/index'] },
  { name: '微博', port: 19227, loginPatterns: ['login', 'passport.weibo'],
    pages: ['https://weibo.com/', 'https://weibo.com/mygroups'] },
  { name: '知乎', port: 19230, loginPatterns: ['login', 'signin', 'passport'],
    pages: ['https://www.zhihu.com/creator/manage/creation/all', 'https://www.zhihu.com/creator'] },
];

async function keepalivePlatform(platform) {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${platform.port}`, { timeout: CONNECT_TIMEOUT });
  } catch (err) {
    _log(`  ❌ ${platform.name} [${platform.port}] CDP 连接失败`);
    return { name: platform.name, ok: false, reason: 'unreachable' };
  }

  try {
    const ctx = browser.contexts()[0];
    const page = ctx?.pages()[0];
    if (!ctx || !page) {
      return { name: platform.name, ok: false, reason: 'no_page' };
    }

    // 检查初始登录态
    const url = page.url();
    if (platform.loginPatterns.some(p => url.toLowerCase().includes(p))) {
      _log(`  ⚠️  ${platform.name} — 已掉线`);
      return { name: platform.name, ok: false, reason: 'logged_out' };
    }

    // 点几个页面模拟活跃
    for (const target of platform.pages) {
      try {
        await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);
      } catch (_) {}
    }

    // 验证最终状态
    const finalUrl = page.url();
    const still = !platform.loginPatterns.some(p => finalUrl.toLowerCase().includes(p));
    if (!still) {
      _log(`  ⚠️  ${platform.name} — 心跳后掉线`);
      return { name: platform.name, ok: false, reason: 'expired_after_nav' };
    }

    // cookie 备份
    try {
      if (!fs.existsSync(COOKIE_BACKUP_DIR)) fs.mkdirSync(COOKIE_BACKUP_DIR, { recursive: true });
      const cookies = await ctx.cookies();
      const dateStr = new Date().toISOString().split('T')[0];
      const backupFile = path.join(COOKIE_BACKUP_DIR, `${platform.name}-${dateStr}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(cookies, null, 2));
    } catch (_) {}

    _log(`  ✅ ${platform.name} — session 有效`);
    return { name: platform.name, ok: true };

  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const mode = process.argv[2] || '--all';
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

  let targets;
  if (mode === '--frequent') {
    targets = [SHIPINHAO];
    _log(`[${ts}] 心跳保活（视频号 - 高频）`);
  } else if (mode === '--normal') {
    targets = OTHERS;
    _log(`[${ts}] 心跳保活（6平台 - 常规）`);
  } else {
    targets = [SHIPINHAO, ...OTHERS];
    _log(`[${ts}] 心跳保活（全部 8 连接）`);
  }

  // 串行执行（避免同时连 8 个 CDP 导致超时）
  const results = [];
  for (const t of targets) {
    results.push(await keepalivePlatform(t));
  }

  const ok = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok);
  _log(`\n结果: ${ok}/${results.length} 正常`);
  if (fail.length > 0) {
    _log(`异常: ${fail.map(r => r.name).join('、')}`);
    process.exit(1);
  }

  // 清理超过 7 天的 cookie 备份
  try {
    const files = fs.readdirSync(COOKIE_BACKUP_DIR).sort().reverse();
    for (const f of files.slice(56)) { // 8 platforms * 7 days
      fs.unlinkSync(path.join(COOKIE_BACKUP_DIR, f));
    }
  } catch (_) {}
}

main();
