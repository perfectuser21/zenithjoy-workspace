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

// 保留远端写入状态，真实适配器重建去重上下文；只替换HTTP运输边界。
function remote({ existing = false, failPoolOnce = false } = {}) {
  const pool = new Map(input.comments.map(row => [row.id, { ...row.fields, 处理状态: '待分拣' }]));
  const leads = existing ? [{ record_id: 'lead1', fields: { 抖音昵称: '小李', 抖音号: '123', 重复命中次数: 0 } }] : [];
  const writes = [];
  let fail = failPoolOnce;
  const request = async (url, opts) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    let result;
    if (url.includes('/auth/')) result = { code: 0, tenant_access_token: 'fixture-token' };
    else if (url.includes('/fields?')) result = { code: 0, data: { items: [] } };
    else if (opts.method === 'GET' && url.includes('/records?')) result = { code: 0, data: { items: structuredClone(leads), has_more: false } };
    else if (opts.method === 'GET') {
      const id = url.split('/').at(-1);
      result = { code: 0, data: { record: { record_id: id, fields: structuredClone(pool.get(id)) } } };
    } else {
      writes.push({ url, method: opts.method, fields: body.fields });
      const id = url.split('/').at(-1);
      if (opts.method === 'POST') {
        leads.push({ record_id: 'lead1', fields: structuredClone(body.fields) });
        result = { code: 0, data: { record: { record_id: 'lead1' } } };
      } else if (pool.has(id)) {
        if (fail && body.fields.处理状态 === '已分拣') { fail = false; result = { code: 1255001 }; }
        else { Object.assign(pool.get(id), body.fields); result = { code: 0 }; }
      } else {
        Object.assign(leads.find(row => row.record_id === id).fields, body.fields);
        result = { code: 0 };
      }
    }
    return { ok: true, json: async () => result };
  };
  const deliver = async (batch = input) => require('../comment-activities.js').deliverComments(batch,
    await load().createDeliveryDeps(batch, { env, request }));
  return { pool, leads, writes, deliver };
}

test('成功配送后重放同批不再写线索或增加重复次数', async () => {
  const state = remote({ existing: true });
  assert.equal((await state.deliver()).metrics.duplicates_highlighted, 1);
  const before = state.writes.length;
  const replay = await state.deliver();
  assert.equal(replay.status, 'completed');
  assert.equal(replay.metrics.duplicates_highlighted, 0);
  assert.equal(state.writes.length, before);
  assert.equal(state.leads[0].fields.重复命中次数, 1);
});

for (const existing of [false, true]) {
  test(`线索${existing ? '高亮' : '创建'}成功而池失败，重试只补池；新评论仍计重复`, async () => {
    const state = remote({ existing, failPoolOnce: true });
    assert.equal((await state.deliver()).status, 'failed');
    assert.equal(state.pool.get('rec1').处理状态, '待分拣');
    const repaired = await state.deliver();
    assert.equal(repaired.status, 'completed');
    assert.equal(repaired.metrics.leads_written, 0);
    assert.equal(repaired.metrics.duplicates_highlighted, 0);
    assert.equal(state.leads.length, 1);
    assert.equal(state.leads[0].fields.重复命中次数 || 0, existing ? 1 : 0);
    assert.equal(state.pool.get('rec1').处理状态, '已分拣');
    const second = { ...input, comments: [{ ...input.comments[0], id: 'rec2' }] };
    state.pool.set('rec2', { ...input.comments[0].fields, 处理状态: '待分拣' });
    assert.equal((await state.deliver(second)).metrics.duplicates_highlighted, 1);
    assert.equal(state.leads[0].fields.重复命中次数, existing ? 2 : 1);
    // 即使池状态回退，先前结算凭证仍能阻止同一评论再次计数。
    state.pool.get('rec1').处理状态 = '待分拣';
    assert.equal((await state.deliver()).metrics.duplicates_highlighted, 0);
    assert.equal(state.leads[0].fields.重复命中次数, existing ? 2 : 1);
  });
}
