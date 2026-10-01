#!/usr/bin/env node
'use strict';
// fetch-seen-videos.js <明确业务线>：只读该route的视频池，stdout仍逐行视频ID。
// 凭据只来自显式环境或1Password导出的0600镜像；禁止读取工具私有配置。
const fs = require('node:fs');
const path = require('node:path');
const { routeOf } = require('./line-routes.js');

function refuse(reason) { throw Object.assign(new Error(reason), { reason_code: reason }); }
function credentialsFromMirror() {
  const file = path.join(process.env.HOME || require('node:os').homedir(), '.credentials/feishu.env');
  let stat, text;
  try { stat = fs.lstatSync(file); } catch { refuse('credentials_missing'); }
  if (!stat.isFile() || (stat.mode & 0o7777) !== 0o600) refuse('credentials_mirror_permissions');
  try { text = fs.readFileSync(file, 'utf8'); } catch { refuse('credentials_missing'); }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = /^\s*(?:export\s+)?(FEISHU_APP_ID|FEISHU_APP_SECRET|FEISHU_ACCOUNT)\s*=(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim();
    const quoted = /^'([^']*)'$/.exec(value) || /^"([^"\\]*)"$/.exec(value);
    if (quoted) values[match[1]] = quoted[1];
    else if (/^[^\s'"`$;\\]+$/.test(value)) values[match[1]] = value;
    else refuse('credentials_mirror_invalid');
  }
  return values;
}
function credentials(route) {
  const env = process.env;
  // 明确line固定只读base；既有无account标记镜像兼容，有标记就必须匹配。
  if (env.FEISHU_ACCOUNT && env.FEISHU_ACCOUNT !== route.account) refuse('account_mismatch');
  const selected = env.FEISHU_APP_ID || env.FEISHU_APP_SECRET ? env : credentialsFromMirror();
  if (!selected.FEISHU_APP_ID || !selected.FEISHU_APP_SECRET) refuse('credentials_missing');
  if (selected.FEISHU_ACCOUNT && selected.FEISHU_ACCOUNT !== route.account) refuse('account_mismatch');
  return { app_id: selected.FEISHU_APP_ID, app_secret: selected.FEISHU_APP_SECRET };
}
async function request(url, { method = 'GET', body, token } = {}) {
  let response, value;
  try {
    response = await fetch(url, { method, signal: AbortSignal.timeout(20000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch { refuse('feishu_http_failed'); }
  if (!response.ok) refuse('feishu_http_failed');
  try { value = await response.json(); } catch { refuse('feishu_readback_invalid'); }
  if (!value || value.code !== 0) refuse('feishu_operation_unconfirmed');
  return value;
}
async function main() {
  let route;
  try { route = routeOf(process.argv[2]); } catch { refuse('route_invalid'); }
  if (process.env.FEISHU_ACCOUNT && process.env.FEISHU_ACCOUNT !== route.account) refuse('account_mismatch');
  if (!route.video) return; // 业务线明确未配置视频池，真空历史，无需认证。
  const auth = await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', body: credentials(route),
  });
  if (typeof auth.tenant_access_token !== 'string' || !auth.tenant_access_token) refuse('feishu_auth_unconfirmed');
  let cursor = '';
  const cursors = new Set(), ids = [];
  do {
    const page = await request(`https://open.feishu.cn/open-apis/bitable/v1/apps/${route.base}/tables/${route.video}/records?page_size=100${cursor ? '&page_token=' + encodeURIComponent(cursor) : ''}`, { token: auth.tenant_access_token });
    if (!Array.isArray(page.data?.items)) refuse('history_readback_invalid');
    for (const record of page.data.items) {
      if (!record || !record.fields || typeof record.fields !== 'object') refuse('history_record_invalid');
      const value = record.fields['视频ID'];
      const id = Array.isArray(value) ? value.map(x => x?.text || x).join('') : String(value || '');
      if (id) ids.push(id); // 已知占位原样交给batch处理；其它ID也不在运输层静默丢弃。
    }
    cursor = page.data.has_more ? page.data.page_token : '';
    if (page.data.has_more && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) refuse('history_pagination_unconfirmed');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  if (ids.length) process.stdout.write(ids.join('\n') + '\n');
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`历史读取失败：${error.reason_code || 'history_unavailable'}\n`);
  process.exitCode = 1;
});
