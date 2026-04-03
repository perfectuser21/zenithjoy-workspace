#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 全平台掉线告警
 *
 * 检测所有 CDP 平台连通性 + 登录状态，掉线时发飞书 webhook 告警。
 * 全部在线则静默退出。
 * 用法: node alert-offline.cjs
 * 建议: 每 15 分钟通过 LaunchAgent 运行
 */

'use strict';

const { chromium } = require('playwright');
const https = require('https');

const WINDOWS_IP = '100.97.242.124';
const PROBE_TIMEOUT = 8000;
const FEISHU_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/5bde68e0-9879-4a45-88ed-461a88229136';

const PLATFORMS = [
  { name: '抖音',      port: 19222, loginPatterns: ['login', 'passport', 'douyin.com/login'] },
  { name: '快手',      port: 19223, loginPatterns: ['login', 'passport', 'accounts.kuaishou'] },
  { name: '小红书',    port: 19224, loginPatterns: ['login', 'passport', 'sign'] },
  { name: '头条(主)',   port: 19225, loginPatterns: ['login', 'passport', 'sso.toutiao'] },
  { name: '头条(副)',   port: 19226, loginPatterns: ['login', 'passport', 'sso.toutiao'] },
  { name: '微博',      port: 19227, loginPatterns: ['login', 'passport.weibo'] },
  { name: '视频号',    port: 19228, loginPatterns: ['login', 'passport'] },
  { name: '知乎',      port: 19230, loginPatterns: ['login', 'signin', 'passport'] },
];

async function probePlatform({ name, port, loginPatterns }) {
  try {
    const browser = await chromium.connectOverCDP(`http://${WINDOWS_IP}:${port}`, { timeout: PROBE_TIMEOUT });
    const ctx = browser.contexts()[0];
    if (!ctx) { await browser.close(); return { name, port, status: 'no_context' }; }
    const page = ctx.pages()[0];
    if (!page) { await browser.close(); return { name, port, status: 'no_page' }; }
    const url = page.url();
    const loggedIn = !loginPatterns.some(p => url.toLowerCase().includes(p));
    await browser.close();
    return { name, port, status: 'connected', loggedIn, url };
  } catch (err) {
    return { name, port, status: 'unreachable', loggedIn: false, error: err.message };
  }
}

function sendFeishu(title, lines) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      msg_type: 'text',
      content: { text: `${title}\n${lines.join('\n')}` },
    });
    const url = new URL(FEISHU_WEBHOOK);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { _log(`飞书响应: ${d.substring(0, 100)}`); resolve(); });
    });
    req.on('error', (e) => { _log(`飞书发送失败: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

async function main() {
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const results = await Promise.all(PLATFORMS.map(probePlatform));

  const offline = results.filter(r => r.status === 'unreachable');
  const loggedOut = results.filter(r => r.status === 'connected' && !r.loggedIn);
  const online = results.filter(r => r.status === 'connected' && r.loggedIn);
  const problems = [...offline, ...loggedOut];

  if (problems.length === 0) {
    // 全部正常，静默退出
    _log(`[${ts}] ✅ ${online.length}/${PLATFORMS.length} 全部在线`);
    return;
  }

  // 有问题，发告警
  const lines = [];
  lines.push(`时间：${ts}`);
  lines.push('');

  for (const r of offline) {
    lines.push(`❌ ${r.name} [${r.port}] — 未连接`);
  }
  for (const r of loggedOut) {
    lines.push(`⚠️ ${r.name} [${r.port}] — 未登录（需扫码）`);
  }

  lines.push('');
  lines.push(`在线：${online.length}/${PLATFORMS.length}`);

  _log(`[${ts}] 🚨 检测到 ${problems.length} 个平台异常`);
  problems.forEach(r => _log(`  ${r.name} [${r.port}]: ${r.status === 'unreachable' ? '未连接' : '未登录'}`));

  await sendFeishu('🚨 发布平台掉线告警', lines);
}

main().catch(e => { console.error('告警脚本异常:', e.message); process.exit(1); });
