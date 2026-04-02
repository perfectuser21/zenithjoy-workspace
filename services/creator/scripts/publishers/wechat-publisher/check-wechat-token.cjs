const _log = console.log.bind(console);
#!/usr/bin/env node
/**
 * 微信公众号 Token 有效性检查
 *
 * 用途：发布前快速检查 Token 状态（无需实际调用 API）
 *
 * 退出码：
 *   0 - Token 有效，可以发布
 *   1 - Token 无效或已过期（需重新获取，在 publish 时自动完成）
 *   2 - 凭据缺失（需配置 ~/.credentials/wechat.env）
 *
 * 用法：
 *   node check-wechat-token.cjs
 *
 *   # 与其他检查一起用（check token, then publish）：
 *   node check-wechat-token.cjs && node publish-wechat-article.cjs ...
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const TOKEN_CACHE_FILE = '/tmp/wechat_token.json';
const CREDENTIALS_FILE = path.join(os.homedir(), '.credentials', 'wechat.env');
const TOKEN_MARGIN_SECONDS = 300;

function parseEnvFile(content) {
  if (!content || typeof content !== 'string') return {};
  const result = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

function checkCredentials() {
  let appId = process.env.WECHAT_APPID;
  let appSecret = process.env.WECHAT_APPSECRET;

  if (!appId || !appSecret) {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const content = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
      const env = parseEnvFile(content);
      appId = appId || env.WECHAT_APPID;
      appSecret = appSecret || env.WECHAT_APPSECRET;
    }
  }

  return { appId, appSecret };
}

function main() {
  _log('🔍 微信公众号 Token 检查\n');

  // 检查凭据
  const { appId, appSecret } = checkCredentials();
  if (!appId || !appSecret) {
    console.error('[TOKEN_MISSING_CREDENTIALS] 缺少公众号凭据');
    console.error('');
    console.error('请创建 ~/.credentials/wechat.env：');
    console.error('  WECHAT_APPID=wx1234567890abcdef');
    console.error('  WECHAT_APPSECRET=your_app_secret_here');
    process.exit(2);
  }

  _log(`📋 AppID: ${appId.slice(0, 8)}...`);
  _log(`🔑 AppSecret: ${'*'.repeat(appSecret.length > 8 ? 8 : appSecret.length)}...`);
  _log('');

  // 检查 Token 缓存
  if (!fs.existsSync(TOKEN_CACHE_FILE)) {
    _log('[TOKEN_EXPIRED] 无缓存 Token，需要获取（首次运行 publish 时自动完成）');
    process.exit(1);
  }

  let cached;
  try {
    cached = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, 'utf8'));
  } catch (err) {
    console.error(`[TOKEN_EXPIRED] Token 缓存解析失败: ${err.message}`);
    process.exit(1);
  }

  if (!cached.access_token || typeof cached.access_token !== 'string') {
    console.error('[TOKEN_EXPIRED] 缓存中无有效 access_token');
    process.exit(1);
  }

  if (typeof cached.expires_at !== 'number') {
    console.error('[TOKEN_EXPIRED] 缓存中无 expires_at，无法判断有效期');
    process.exit(1);
  }

  const now = Date.now();
  const remainMs = cached.expires_at - now;
  const remainSec = Math.floor(remainMs / 1000);
  const remainMin = Math.floor(remainSec / 60);

  if (remainMs <= TOKEN_MARGIN_SECONDS * 1000) {
    _log(`[TOKEN_EXPIRED] Token 已过期或即将过期（剩余 ${remainSec}s < 阈值 ${TOKEN_MARGIN_SECONDS}s）`);
    _log('   publish 时将自动重新获取');
    process.exit(1);
  }

  const obtainedAt = cached.obtained_at
    ? new Date(cached.obtained_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    : '未知';

  _log('[SESSION_OK] Token 有效 ✅');
  _log(`   Token 片段: ${cached.access_token.slice(0, 16)}...`);
  _log(`   剩余时间: ${remainMin} 分钟 (${remainSec}s)`);
  _log(`   获取时间: ${obtainedAt}`);
  process.exit(0);
}

main();
