'use strict';

const { validateDeliveryInput } = require('./comment-activities.js');
const { extractSeenEntries } = require('./lead-fields-lib.js');
const { txt } = require('./sort-comments-lib.js');

function refusal(message, reason) {
  return Object.assign(new Error(message), { failure_class: 'fatal', reason_code: reason });
}

const receiptMarker = (pool, id) => `[comment-delivery:${pool}:${encodeURIComponent(id)}]`;

// 新旧入口共用；线索写入和凭证同一次请求确认，池失败仍能恢复。
function withDeliveryReceipts(storage, { pool, leadHistory, lead_receipts }) {
  return {
    putPool: storage.putPool,
    putLead: async (id, fields, commentId) => {
      const history = [leadHistory.get(id), fields.重复轨迹, receiptMarker(pool, commentId)].filter(Boolean).join('\n');
      const result = await storage.putLead(id, { ...fields, 重复轨迹: history });
      if (result && result.code === 0) {
        leadHistory.set(id, history);
        lead_receipts.set(commentId, id);
      }
      return result;
    },
    postLead: async (fields, commentId) => {
      const history = receiptMarker(pool, commentId);
      const result = await storage.postLead({ ...fields, 重复轨迹: history });
      if (result && result.code === 0) {
        const id = result.data && result.data.record && result.data.record.record_id;
        if (!id) throw new Error('飞书线索写入未返回 record_id');
        leadHistory.set(id, history);
        lead_receipts.set(commentId, id);
      }
      return result;
    },
  };
}

// 调用方由 1Password/凭据缓存注入环境；不从业务配置文件或输入对象取密钥。
async function createDeliveryDeps(input, { env = process.env, request = fetch } = {}) {
  const route = validateDeliveryInput(input);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('配送缺飞书凭据');
  if (env.FEISHU_ACCOUNT !== route.account) throw refusal('配送账号与业务线不符', 'account_mismatch');
  const send = async (url, method, body, token) => {
    const response = await request(url, {
      method, signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('飞书 HTTP 请求失败');
    const result = await response.json();
    if (result && result.code === 1254043) throw refusal('飞书评论记录不存在', 'record_not_found');
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
  const settled_ids = new Set();
  for (const row of input.comments.filter(row => row.verdict)) {
    const result = await feishu(`/tables/${route.pool}/records/${encodeURIComponent(row.id)}`, 'GET');
    const record = result.data && result.data.record;
    if (!record || record.record_id !== row.id || !record.fields) throw refusal('飞书评论记录读回不符', 'record_mismatch');
    for (const field of ['评论原文', '评论者昵称', '用户主页标识']) {
      if (txt(record.fields[field]) !== txt(row.fields[field])) throw refusal('飞书评论记录与评分输入不符', 'record_mismatch');
    }
    if (txt(record.fields.处理状态) === '已分拣') settled_ids.add(row.id);
  }
  const fieldResult = await feishu(`/tables/${route.lead}/fields?page_size=100`, 'GET');
  if (!Array.isArray(fieldResult.data && fieldResult.data.items)) throw new Error('飞书线索字段未读回');
  const fieldTypes = Object.fromEntries(fieldResult.data.items.map(field => [field.field_name, field.type]));
  const seen = new Map();
  const lead_receipts = new Map();
  const leadHistory = new Map();
  // 复用已有文本字段保留池记录凭证，无需新增生产列。包含池ID防业务线串账。
  const marker = id => receiptMarker(route.pool, id);
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
    for (const record of page.data.items) {
      const history = txt(record.fields.重复轨迹);
      leadHistory.set(record.record_id, history);
      for (const row of input.comments) {
        if (history.includes(marker(row.id))) lead_receipts.set(row.id, record.record_id);
      }
    }
    cursor = page.data.has_more ? page.data.page_token : '';
    if (page.data.has_more && (!cursor || cursors.has(cursor))) throw new Error('飞书去重表分页未推进');
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return {
    seen,
    settled_ids, lead_receipts,
    now: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + '(UTC+8)',
    asLeadTime: (name, value) => fieldTypes[name] === 5 ? Date.now() : value,
    deps: withDeliveryReceipts({
      putPool: (id, fields) => feishu(`/tables/${route.pool}/records/${encodeURIComponent(id)}`, 'PUT', { fields }),
      putLead: (id, fields) => feishu(`/tables/${route.lead}/records/${encodeURIComponent(id)}`, 'PUT', { fields }),
      postLead: fields => feishu(`/tables/${route.lead}/records`, 'POST', { fields }),
    }, { pool: route.pool, leadHistory, lead_receipts }),
  };
}

module.exports = { createDeliveryDeps, withDeliveryReceipts, receiptMarker };
