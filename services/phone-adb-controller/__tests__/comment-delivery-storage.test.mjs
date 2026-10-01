import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const load = () => require('../comment-delivery-storage.js');
const env = { FEISHU_ACCOUNT: 'jinoshengyuan', FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
const input = { run_tag: 'smoke', line_key: 'jinuo', comments: [{ id: 'rec1', fields: {
  评论者昵称: '小李', 用户主页标识: '123', 评论原文: '怎么报名', 来源视频: 'AI课程',
}, verdict: { grade: 'A', relevance: '相关', reason: '询问报名' } }] };

test('配送存储适配器验证账号归属，缺凭据/账号不符时不请求远端', async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error('不应请求'); };
  await assert.rejects(load().createDeliveryDeps(input, { env: {}, request }), /凭据/);
  await assert.rejects(load().createDeliveryDeps(input, { env: { ...env, FEISHU_ACCOUNT: 'main' }, request }), /账号/);
  assert.equal(calls, 0);
});

test('独立评分结果可经真实配送适配器落账，读取仅包含显式评论与必要线索去重', async () => {
  const calls = [];
  const request = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method, body });
    let result;
    if (url.includes('/tenant_access_token/')) result = { code: 0, tenant_access_token: 'fixture-token' };
    else if (url.endsWith('/records/rec1') && opts.method === 'GET') result = { code: 0, data: { record: { record_id: 'rec1', fields: input.comments[0].fields } } };
    else if (url.includes('/fields?')) result = { code: 0, data: { items: [{ field_name: '采集时间', type: 5 }] } };
    else if (opts.method === 'GET') result = { code: 0, data: { items: [], has_more: false } };
    else if (opts.method === 'POST') result = { code: 0, data: { record: { record_id: 'lead1' } } };
    else result = { code: 0, data: { record: { record_id: 'rec1', fields: body.fields } } };
    return { ok: true, json: async () => result };
  };
  const context = await load().createDeliveryDeps(input, { env, request });
  const result = await require('../comment-activities.js').deliverComments(input, context);
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.leads_written, 1);
  const post = calls.find(c => c.method === 'POST' && !c.url.includes('/auth/'));
  const put = calls.find(c => c.method === 'PUT');
  assert.ok(calls.indexOf(post) < calls.indexOf(put));
  assert.equal(typeof post.body.fields.采集时间, 'number');
  assert.equal(put.body.fields.处理状态, '已分拣');
  assert.ok(!calls.some(c => c.method === 'GET' && c.url.includes('tblmrJTyVgzTj89P/records?')));
});

test('跨池或已不存在的评论ID在任何写入之前拒绝', async () => {
  let writes = 0;
  const request = async (url, opts) => {
    if (opts.method !== 'GET' && !url.includes('/auth/')) writes++;
    return { ok: true, json: async () => url.includes('/auth/')
      ? { code: 0, tenant_access_token: 'fixture-token' }
      : { code: 1254043, msg: 'RecordIdNotFound' } };
  };
  await assert.rejects(load().createDeliveryDeps(input, { env, request }), /飞书/);
  assert.equal(writes, 0);
});
