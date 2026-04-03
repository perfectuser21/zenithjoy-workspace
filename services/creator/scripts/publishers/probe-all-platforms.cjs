#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 全平台发布探针
 *
 * 探测8个平台的 CDP 连通性 + 登录状态，输出简明报告。
 * 用法: node probe-all-platforms.cjs
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const path = require('path');

const PLATFORMS = [
  { name: '抖音',       port: 19222, loginPatterns: ['login', 'passport', 'douyin.com/login'] },
  { name: '快手',       port: 19223, loginPatterns: ['login', 'passport', 'accounts.kuaishou'] },
  { name: '小红书',     port: 19224, loginPatterns: ['login', 'passport', 'sign'] },
  { name: '头条(主)',    port: 19225, loginPatterns: ['login', 'passport', 'sso.toutiao'] },
  { name: '头条(副)',    port: 19226, loginPatterns: ['login', 'passport', 'sso.toutiao'] },
  { name: '微博',       port: 19227, loginPatterns: ['login', 'passport.weibo'] },
  { name: '视频号',     port: 19228, loginPatterns: ['login', 'passport'] },
  { name: '知乎',       port: 19230, loginPatterns: ['login', 'signin', 'passport'] },
  // 微信公众号走 API（publish-wechat-article.cjs），不需要 CDP
];

const PROBE_TIMEOUT = 15000;
const WINDOWS_IP = '100.97.242.124';

async function probePlatform({ name, port, loginPatterns }) {
  const url = `http://${WINDOWS_IP}:${port}`;
  try {
    const browser = await chromium.connectOverCDP(url, { timeout: PROBE_TIMEOUT });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      return { name, port, status: 'no_context', loggedIn: false, pageUrl: '' };
    }
    const pages = context.pages();
    const page = pages[0];
    if (!page) {
      await browser.close();
      return { name, port, status: 'no_page', loggedIn: false, pageUrl: '' };
    }
    const pageUrl = page.url();
    const isLoggedIn = !loginPatterns.some(p => pageUrl.toLowerCase().includes(p));
    await browser.close();
    return { name, port, status: 'connected', loggedIn: isLoggedIn, pageUrl };
  } catch (err) {
    return { name, port, status: 'unreachable', loggedIn: false, pageUrl: '', error: err.message };
  }
}

async function probeWechat() {
  // 微信公众号用 API token，不用 CDP
  try {
    const tokenScript = path.join(__dirname, 'wechat-publisher', 'check-wechat-token.cjs');
    const result = execSync(`node "${tokenScript}" 2>&1`, { timeout: 8000 }).toString().trim();
    const valid = result.includes('有效') || result.includes('valid') || result.includes('ok') || result.includes('✅');
    return { name: '微信公众号', port: 'API', status: 'connected', loggedIn: valid, pageUrl: result.split('\n')[0] || '' };
  } catch (err) {
    return { name: '微信公众号', port: 'API', status: 'unreachable', loggedIn: false, pageUrl: '', error: err.message };
  }
}

function formatResult(r) {
  const portLabel = String(r.port).padEnd(5);
  const nameLabel = r.name.padEnd(6);
  if (r.status === 'unreachable') {
    return `${nameLabel} [${portLabel}] ❌ 未连接    ${r.error ? r.error.substring(0, 50) : ''}`;
  }
  if (r.status === 'no_context' || r.status === 'no_page') {
    return `${nameLabel} [${portLabel}] ⚠️  已连接但无页面`;
  }
  const loginStatus = r.loggedIn ? '✅ 已登录' : '⚠️  未登录';
  const urlShort = r.pageUrl.replace(/^https?:\/\//, '').substring(0, 60);
  return `${nameLabel} [${portLabel}] ${loginStatus}  ${urlShort}`;
}

async function main() {
  _log('=== Publisher Probe Report ===');
  _log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  _log(`目标: ${WINDOWS_IP}`);
  _log('');

  // 并行探测所有 CDP 平台（含微信公众号，现在也走 CDP 19229）
  const allResults = await Promise.all(PLATFORMS.map(probePlatform));

  allResults.forEach(r => _log(formatResult(r)));

  _log('');
  const total = PLATFORMS.length;
  const connected = allResults.filter(r => r.status === 'connected').length;
  const loggedIn = allResults.filter(r => r.loggedIn).length;
  _log(`汇总: ${connected}/${total} 已连接，${loggedIn}/${total} 已登录`);

  const notLoggedIn = allResults.filter(r => r.status === 'connected' && !r.loggedIn);
  if (notLoggedIn.length > 0) {
    _log(`\n⚠️  需要重新登录: ${notLoggedIn.map(r => r.name).join('、')}`);
  }
  const unreachable = allResults.filter(r => r.status === 'unreachable');
  if (unreachable.length > 0) {
    _log(`❌ 无法连接: ${unreachable.map(r => r.name).join('、')}`);
  }
}

main().catch(e => { console.error('探针运行失败:', e.message); process.exit(1); });
