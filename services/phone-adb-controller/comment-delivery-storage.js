'use strict';

const { validateInput } = require('./comment-activities.js');
const { extractSeenEntries } = require('./lead-fields-lib.js');
const { txt } = require('./sort-comments-lib.js');

// 调用方由 1Password/凭据缓存注入环境；不从业务配置文件或输入对象取密钥。
async function createDeliveryDeps(input, { env = process.env, request = fetch } = {}) {
  const route = validateInput(input);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('配送缺飞书凭据');
  if (env.FEISHU_ACCOUNT !== route.account) throw new Error('配送账号与业务线不符');
  const send = async (url, method, body, token) => {
    const response = await request(url, {
      method, signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('飞书 HTTP 请求失败');
    const result = await response.json();
    if (!result || result.code !== 0) throw new Error('飞书未确认操作成功');
    return result;
  };
  const auth = await send('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', 'POST', {
    app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET,
  });
  if (!auth.tenant_access_token) throw new Error('飞书认证未返回 token');
  const feishu = (path, method, body) => send(
    'https://open.feishu.cn/open-apis/bitable/v1/apps/' + route.base + path,
    method, body, auth.tenant_access_token,
  );
  // 本单元只结算已落池记录。先读回所有显式ID，防止错误业务线/本地临时ID写入别人的表。
  for (const row of input.comments.filter(row => row.verdict)) {
    const result = await feishu(`/tables/${route.pool}/records/${encodeURIComponent(row.id)}`, 'GET');
    const record = result.data && result.data.record;
    if (!record || record.record_id !== row.id || !record.fields) throw new Error('飞书评论记录读回不符');
    for (const field of ['评论原文', '评论者昵称', '用户主页标识']) {
      if (txt(record.fields[field]) !== txt(row.fields[field])) throw new Error('飞书评论记录与评分输入不符');
    }
  }
  const fieldResult = await feishu(`/tables/${route.lead}/fields?page_size=100`, 'GET');
  if (!Array.isArray(fieldResult.data && fieldResult.data.items)) throw new Error('飞书线索字段未读回');
  const fieldTypes = Object.fromEntries(fieldResult.data.items.map(field => [field.field_name, field.type]));
  const seen = new Map();
  let cursor = '';
  const cursors = new Set();
  do {
    const page = await feishu(`/tables/${route.lead}/records?page_size=100${cursor ? '&page_token=' + encodeURIComponent(cursor) : ''}`, 'GET');
    if (!Array.isArray(page.data && page.data.items)) throw new Error('飞书线索去重表未读回');
    for (const row of extractSeenEntries(page.data.items, txt)) {
      const value = { id: row.record_id, dup: row.dup };
      if (row.nick) seen.set(row.nick, value);
      if (row.dyid) seen.set(row.dyid, value);
    }
    cursor = page.data.has_more ? page.data.page_token : '';
    if (page.data.has_more && (!cursor || cursors.has(cursor))) throw new Error('飞书去重表分页未推进');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return {
    seen,
    now: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + '(UTC+8)',
    asLeadTime: (name, value) => fieldTypes[name] === 5 ? Date.now() : value,
    deps: {
      putPool: (id, fields) => feishu(`/tables/${route.pool}/records/${encodeURIComponent(id)}`, 'PUT', { fields }),
      putLead: (id, fields) => feishu(`/tables/${route.lead}/records/${encodeURIComponent(id)}`, 'PUT', { fields }),
      postLead: async fields => {
        const result = await feishu(`/tables/${route.lead}/records`, 'POST', { fields });
        if (!(result.data && result.data.record && result.data.record.record_id)) {
          throw new Error('飞书线索写入未返回 record_id');
        }
        return result;
      },
    },
  };
}

module.exports = { createDeliveryDeps };
