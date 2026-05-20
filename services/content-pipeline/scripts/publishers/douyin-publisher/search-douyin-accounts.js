#!/usr/bin/env node
/**
 * 抖音对标账号搜索
 * 用法: node search-douyin-accounts.js <关键词> [--limit <数量>]
 * 示例: node search-douyin-accounts.js "AI创业" --limit 20
 *
 * 前提：Chrome 已以调试模式启动且已登录抖音
 * 启动: open -a "Google Chrome" --args --remote-debugging-port=19222
 */
'use strict';

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CDP_HOST = process.env.DOUYIN_CDP_HOST || 'http://localhost:19222';

// ─── 纯函数（可单元测试） ──────────────────────────────────────

function parseUser(raw) {
  const u = (raw && raw.user_info) ? raw.user_info : (raw || {});
  const uid = u.uid || u.sec_uid || '';
  return {
    uid,
    username: u.nickname || '',
    avatar: u.avatar_thumb?.url_list?.[0] || '',
    followers: u.follower_count ?? 0,
    following: u.following_count ?? 0,
    workCount: u.aweme_count ?? 0,
    description: u.signature || '',
    profileUrl: uid ? `https://www.douyin.com/user/${uid}` : '',
    verified: u.custom_verify || '',
  };
}

function buildSearchUrl(keyword, cursor = 0, count = 10) {
  const params = new URLSearchParams({
    keyword,
    type: '1',
    count: String(count),
    cursor: String(cursor),
    aid: '6383',
    channel: 'channel_pc_web',
  });
  return `https://www.douyin.com/aweme/v1/web/discover/search/?${params.toString()}`;
}

// ─── 导出供测试使用 ────────────────────────────────────────────
module.exports = { parseUser, buildSearchUrl };

// ─── I/O 函数 ──────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function checkLogin(page) {
  return page.evaluate(async () => {
    try {
      const resp = await fetch('https://www.douyin.com/passport/account/info/v2/', { credentials: 'include' });
      const data = await resp.json();
      return data.status_code === 0;
    } catch { return false; }
  });
}

async function waitForLogin(page) {
  console.log('\n⚠️  未检测到登录，请在浏览器中完成抖音登录（扫码/手机号均可）...\n');
  await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  for (let i = 0; i < 36; i++) {
    await sleep(5000);
    if (await checkLogin(page)) { console.log('✅ 登录成功！\n'); return; }
  }
  throw new Error('登录超时（3 分钟），请重新运行脚本');
}

async function fetchAccounts(page, keyword, limit) {
  const results = [];
  const seen = new Set();
  let cursor = 0;
  let pageNum = 0;

  while (results.length < limit) {
    pageNum++;
    const url = buildSearchUrl(keyword, cursor, 10);

    const raw = await page.evaluate(async (fetchUrl) => {
      const resp = await fetch(fetchUrl, { credentials: 'include' });
      return resp.text();
    }, url);

    let data;
    try { data = JSON.parse(raw); } catch {
      console.log(`  第 ${pageNum} 页：响应解析失败，停止翻页`);
      break;
    }

    if (data.status_code !== 0) {
      throw new Error(`抖音 API 错误 status_code=${data.status_code}，message=${data.message || '未知'}`);
    }

    const users = data.user_list || [];
    if (!users.length) { console.log(`  第 ${pageNum} 页：无更多结果`); break; }

    for (const rawUser of users) {
      const user = parseUser(rawUser);
      if (user.uid && !seen.has(user.uid)) {
        seen.add(user.uid);
        results.push(user);
      }
    }

    console.log(`  第 ${pageNum} 页：已采集 ${results.length} / ${limit} 个账号`);

    if (!data.has_more || results.length >= limit) break;
    cursor = data.cursor || 0;
    await sleep(800);
  }

  return results.slice(0, limit);
}

function printResults(accounts) {
  console.log('\n' + '─'.repeat(60));
  accounts.forEach((acc, i) => {
    const fans = acc.followers >= 10000
      ? `${(acc.followers / 10000).toFixed(1)}万`
      : String(acc.followers);
    console.log(`${String(i + 1).padStart(3)}. ${acc.username || '未知'}`);
    console.log(`     粉丝：${fans}  作品：${acc.workCount}`);
    if (acc.verified) console.log(`     认证：${acc.verified}`);
    if (acc.description) console.log(`     简介：${acc.description.slice(0, 60)}`);
    console.log(`     主页：${acc.profileUrl}`);
    console.log();
  });
  console.log('─'.repeat(60));
}

// ─── CLI 入口 ──────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const keywordIdx = args.findIndex(a => !a.startsWith('--'));
  const keyword = keywordIdx >= 0 ? args[keywordIdx] : null;
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 20;

  if (!keyword) {
    console.error('用法: node search-douyin-accounts.js <关键词> [--limit <数量>]');
    console.error('示例: node search-douyin-accounts.js "AI创业" --limit 20');
    process.exit(1);
  }

  console.log(`\n🔍 抖音对标账号搜索`);
  console.log(`   关键词: ${keyword}  |  目标: ${limit} 个`);
  console.log(`   CDP: ${CDP_HOST}\n`);

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP_HOST);
  } catch {
    console.error(`\n❌ 无法连接到 Chrome（${CDP_HOST}）`);
    console.error('   请先启动 Chrome 调试模式：');
    console.error('   open -a "Google Chrome" --args --remote-debugging-port=19222\n');
    process.exit(1);
  }

  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();

  console.log('✅ 已连接到浏览器');

  try {
    await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch { /* 忽略超时，继续检测登录 */ }
  await sleep(1500);

  if (!(await checkLogin(page))) {
    await waitForLogin(page);
  } else {
    console.log('✅ 抖音已登录\n');
  }

  let accounts;
  try {
    accounts = await fetchAccounts(page, keyword, limit);
  } catch (e) {
    console.error(`\n❌ 采集失败：${e.message}\n`);
    process.exit(1);
  }

  if (!accounts.length) {
    console.log(`\n⚠️  关键词「${keyword}」未找到账号结果\n`);
    process.exit(0);
  }

  console.log(`\n✅ 共采集到 ${accounts.length} 个对标账号`);
  printResults(accounts);

  const outDir = path.join(os.homedir(), '.platform-data', 'douyin-competitor');
  fs.mkdirSync(outDir, { recursive: true });
  const safeName = keyword.replace(/[^\w一-龥]/g, '_');
  const outFile = path.join(outDir, `search-${safeName}-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ keyword, total: accounts.length, accounts }, null, 2));
  console.log(`💾 结果已保存：${outFile}\n`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('\n❌ 脚本异常：', e.message);
    process.exit(1);
  });
}
