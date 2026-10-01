'use strict';

const { validateInput } = require('./comment-activities.js');
const { txt } = require('./sort-comments-lib.js');
const { rawCommentId, sameRawComment, RAW_COMMENT_FIELDS } = require('./raw-comment-activities.js');

function refusal(message, reason) {
  return Object.assign(new Error(message), { failure_class: 'fatal', reason_code: reason });
}

// 环境由调用方注入；不从业务配置或输入中读取凭据，且不依赖模型/线索表。
async function createRawCommentDeps(input, { env = process.env, request = fetch } = {}) {
  const route = validateInput(input);
  if (!env.FEISHU_APP_ID || !env.FEISHU_APP_SECRET) throw new Error('落池缺飞书凭据');
  if (env.FEISHU_ACCOUNT !== route.account) throw refusal('落池账号与业务线不符', 'account_mismatch');
  const send = async (url, method, body, token) => {
    let response;
    try {
      response = await request(url, {
        method, signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (_) { throw new Error('飞书 HTTP 请求失败'); }
    if (!response || !response.ok) throw new Error('飞书 HTTP 请求失败');
    let result;
    try { result = await response.json(); } catch (_) { throw new Error('飞书响应未读回'); }
    if (!result || result.code !== 0) throw new Error('飞书未确认操作成功');
    return result;
  };
  const auth = await send('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', 'POST', {
    app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET,
  });
  if (!auth.tenant_access_token) throw new Error('飞书认证未返回 token');
  const feishu = (suffix, method = 'GET', body) => send(
    `https://open.feishu.cn/open-apis/bitable/v1/apps/${route.base}/tables/${route.pool}${suffix}`,
    method, body, auth.tenant_access_token,
  );
  const fieldResult = await feishu('/fields?page_size=100');
  if (!Array.isArray(fieldResult.data && fieldResult.data.items)) throw new Error('飞书原始评论字段未读回');
  const fieldTypes = Object.fromEntries(fieldResult.data.items.map(field => [field.field_name, field.type]));
  if (RAW_COMMENT_FIELDS.some(name => fieldTypes[name] === undefined)) throw new Error('飞书原始评论池缺必要字段');
  const wanted = new Set(input.comments.map(row => rawCommentId(row.fields)));
  const seen = new Map();
  let cursor = '';
  const cursors = new Set();
  if (wanted.size) do {
    const page = await feishu(`/records?page_size=100${cursor ? '&page_token=' + encodeURIComponent(cursor) : ''}`);
    if (!Array.isArray(page.data && page.data.items)) throw new Error('飞书原始评论去重表未读回');
    for (const record of page.data.items) {
      if (!record || !record.fields) throw new Error('飞书原始评论记录字段未读回');
      const rawid = txt(record.fields.原始评论ID);
      if (!wanted.has(rawid)) continue;
      if (typeof record.record_id !== 'string' || !record.record_id.trim()) throw new Error('飞书原始评论记录ID未读回');
      const hit = seen.get(rawid);
      if (hit) {
        if (!sameRawComment(hit.fields, record.fields)) hit.conflict = true;
      } else seen.set(rawid, { id: record.record_id, fields: record.fields });
    }
    cursor = page.data.has_more ? page.data.page_token : '';
    if (page.data.has_more && (typeof cursor !== 'string' || !cursor || cursors.has(cursor))) {
      throw new Error('飞书原始评论去重表分页未推进');
    }
    if (cursor) cursors.add(cursor);
  } while (cursor);
  return {
    seen,
    now: new Date(Date.now() + 8 * 3600e3).toISOString().replace('T', ' ').slice(0, 16) + '(UTC+8)',
    asTime: (name, value) => fieldTypes[name] === 5 ? Date.now() : value,
    postPool: fields => feishu('/records', 'POST', { fields }),
  };
}

module.exports = { createRawCommentDeps };
