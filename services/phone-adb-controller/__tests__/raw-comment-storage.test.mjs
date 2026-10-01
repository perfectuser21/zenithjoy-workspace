import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const load = () => require('../raw-comment-storage.js');
const env = { FEISHU_ACCOUNT: 'main', FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
const row = (id = 'source') => ({ id, fields: { 评论者昵称: '甲', 评论原文: '想了解',
  抖音号: '123', 主页链接: 'https://example.com/123', 账号类型: '个人',
  用户主页标识: '123 | https://example.com/123 | 个人' } });
const input = comments => ({ run_tag: 'raw-storage', line_key: 'yuesheng', comments: comments || [row()] });
const fields = ['原始评论ID', '运行批次', '采集时间', '命中关键词', '来源视频', '评论作品视频链接',
  '评论原文', '评论者昵称', '用户主页标识', '抖音号', '主页链接', '账号类型', '留言时间', '主页IP', '地区', '处理状态'];
const response = body => ({ ok: true, json: async () => body });
function transport({ records = [], dateType = 5, page, write, fieldItems } = {}) {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    assert.ok(options.signal);
    if (url.includes('/auth/')) return response({ code: 0, tenant_access_token: 'fixture-token' });
    if (url.includes('/fields')) return response({ code: 0, data: { items: fieldItems || fields.map(name => ({ field_name: name, type: name === '采集时间' ? dateType : 1 })) } });
    if (options.method === 'GET') return response({ code: 0, data: page ? page(calls) : { items: records, has_more: false } });
    return write ? write(url, options) : response({ code: 0, data: { record: { record_id: 'pool-new' } } });
  };
  return { request, calls };
}

test('真实适配器只认证/读原始池字段和去重：type5采集时间写毫秒，无线索或评分依赖', async () => {
  const http = transport();
  const deps = await load().createRawCommentDeps(input(), { env, request: http.request });
  const result = await require('../raw-comment-activities.js').persistRawComments(input(), deps);
  assert.equal(result.status, 'completed');
  const post = http.calls.find(c => c.url.includes('/records') && c.options.method === 'POST');
  const body = JSON.parse(post.options.body);
  assert.equal(typeof body.fields.采集时间, 'number');
  assert.equal(body.fields.处理状态, '待分拣');
  assert.equal(http.calls.length, 4);
  assert.ok(http.calls.every(c => !c.url.includes('tblmz52E2GDX0uwu')));
});

test('账号归属先拒绝，错误为fatal/account_mismatch，且不会认证', async () => {
  let called = 0;
  await assert.rejects(load().createRawCommentDeps(input(), {
    env: { ...env, FEISHU_ACCOUNT: 'jinoshengyuan' }, request: async () => { called++; },
  }), error => error.failure_class === 'fatal' && error.reason_code === 'account_mismatch');
  assert.equal(called, 0);
});

test('分页真实读回只收显式rawid，重复重试返回历史持久化ID但不算新写入', async () => {
  const remote = { record_id: 'pool-history', fields: { ...row().fields, 原始评论ID: '甲|123|想了解' } };
  let pages = 0;
  const http = transport({ page: () => ++pages === 1
    ? { items: [{ record_id: 'unrelated', fields: { 原始评论ID: 'unrelated' } }], has_more: true, page_token: 'next page' }
    : { items: [remote], has_more: false } });
  const deps = await load().createRawCommentDeps(input(), { env, request: http.request });
  assert.equal(deps.seen.size, 1);
  const result = await require('../raw-comment-activities.js').persistRawComments(input(), deps);
  assert.equal(result.outputs.comments[0].id, 'pool-history');
  assert.equal(result.metrics.comments_written, 0);
  assert.equal(result.metrics.duplicates, 1);
  assert.ok(http.calls.some(c => c.url.includes('page_token=next%20page')));
});

test('分页token不前进或缺token均拒绝，避免无限请求', async () => {
  for (const page_token of ['loop', undefined]) {
    const http = transport({ page: () => ({ items: [], has_more: true, page_token }) });
    await assert.rejects(load().createRawCommentDeps(input(), { env, request: http.request }), /分页未推进/);
    assert.ok(http.calls.length <= 4);
  }
});

test('写接口HTTP失败安全待重试，返回不含运输层秘密', async () => {
  const http = transport({ write: async () => { throw new Error('fixture-secret fixture-token'); } });
  const deps = await load().createRawCommentDeps(input(), { env, request: http.request });
  const result = await require('../raw-comment-activities.js').persistRawComments(input(), deps);
  assert.equal(result.status, 'failed');
  assert.equal(result.failure_class, 'retryable');
  assert.equal(result.outputs.comments.length, 0);
  assert.equal(result.outputs.pending_comments.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|fixture-token/);
});

test('缺少必要写入字段拒绝初始化，不猜类型写库', async () => {
  const http = transport({ fieldItems: [{ field_name: '原始评论ID', type: 1 }] });
  await assert.rejects(load().createRawCommentDeps(input(), { env, request: http.request }), /字段/);
  assert.equal(http.calls.filter(c => c.url.includes('/records')).length, 0);
});

test('文本采集时间保留旧UTC+8字符串，env缺凭据不读取配置', async () => {
  const http = transport({ dateType: 1 });
  const deps = await load().createRawCommentDeps(input(), { env, request: http.request });
  assert.equal(deps.asTime('采集时间', deps.now), deps.now);
  assert.match(deps.now, /\(UTC\+8\)$/);
  await assert.rejects(load().createRawCommentDeps(input(), { env: {}, request: http.request }), /凭据/);
});

test('HTTP边界整条闭环：真实评分、原始池存储及配送适配器按池ID结算', async () => {
  const { scoreComments, deliverComments } = require('../comment-activities.js');
  const { persistRawComments } = require('../raw-comment-activities.js');
  const { createDeliveryDeps } = require('../comment-delivery-storage.js');
  const { routeOf } = require('../line-routes.js');
  const route = routeOf('yuesheng');
  const pool = new Map();
  const leads = new Map();
  const writes = [];
  const request = async (url, options) => {
    if (url.includes('/auth/')) return response({ code: 0, tenant_access_token: 'fixture-token' });
    if (url.includes('/fields')) return response({ code: 0, data: { items: fields.map(field_name => ({ field_name, type: 1 })) } });
    const isPool = url.includes(`/tables/${route.pool}/`);
    const store = isPool ? pool : leads;
    if (options.method === 'GET') {
      const id = url.match(/\/records\/([^/?]+)/)?.[1];
      return response({ code: 0, data: id ? { record: store.get(id) } : { items: [...store.values()], has_more: false } });
    }
    const body = JSON.parse(options.body);
    writes.push({ isPool, method: options.method, fields: body.fields });
    const id = options.method === 'POST' ? (isPool ? 'pool-1' : 'lead-1') : url.split('/').at(-1);
    const record = { record_id: id, fields: { ...store.get(id)?.fields, ...body.fields } };
    store.set(id, record);
    return response({ code: 0, data: { record } });
  };
  const scored = await scoreComments(input(), { judgeOptions: {
    apiKey: 'fixture-model-key', httpPost: async () => ({ answers: { grade: { choice: 'A', confidence: 0.95 } } }),
  } });
  const scoredInput = { ...input(), comments: scored.outputs.comments };
  const persisted = await persistRawComments(scoredInput, await load().createRawCommentDeps(scoredInput, { env, request }));
  const deliveryInput = { ...input(), comments: persisted.outputs.comments };
  const delivered = await deliverComments(deliveryInput, await createDeliveryDeps(deliveryInput, { env, request }));
  assert.equal(delivered.status, 'completed');
  assert.equal(delivered.metrics.leads_written, 1);
  assert.equal(pool.get('pool-1').fields.处理状态, '已分拣');
  assert.deepEqual(writes.map(w => [w.isPool, w.method]), [[true, 'POST'], [false, 'POST'], [true, 'PUT']]);
  const replay = await persistRawComments(scoredInput, await load().createRawCommentDeps(scoredInput, { env, request }));
  assert.equal(replay.metrics.comments_written, 0);
  assert.equal(replay.outputs.comments[0].id, 'pool-1');
  const againInput = { ...input(), comments: replay.outputs.comments };
  const again = await deliverComments(againInput, await createDeliveryDeps(againInput, { env, request }));
  assert.equal(again.metrics.leads_written, 0);
  assert.equal(writes.length, 3);
});

test('跨适配器整批重试只补失败源记录，已写入记录恢复真实ID', async () => {
  const { persistRawComments } = require('../raw-comment-activities.js');
  const comments = [row('one'), { ...row('two'), fields: { ...row().fields, 评论者昵称: '乙' } }];
  const batch = input(comments);
  const records = [];
  let posts = 0;
  const http = transport({ records, write: async (_url, options) => {
    if (++posts === 1) return { ok: false, json: async () => ({ code: 1 }) };
    const record = { record_id: 'pool-' + posts, fields: JSON.parse(options.body).fields };
    records.push(record);
    return response({ code: 0, data: { record } });
  } });
  const first = await persistRawComments(batch, await load().createRawCommentDeps(batch, { env, request: http.request }));
  assert.equal(first.status, 'partial');
  assert.deepEqual(first.outputs.comments.map(r => r.source_id), ['two']);
  assert.deepEqual(first.outputs.pending_comments.map(r => r.source_id), ['one']);
  const retry = await persistRawComments(batch, await load().createRawCommentDeps(batch, { env, request: http.request }));
  assert.equal(retry.status, 'completed');
  assert.deepEqual(retry.metrics, { comments_written: 1, duplicates: 1, pending: 0 });
  assert.deepEqual(retry.outputs.comments.map(r => r.id), ['pool-3', 'pool-2']);
  assert.equal(posts, 3);
});

test('旧push入口复用真实活动/适配器，仍输出PUSH_COMMENTS_STATS与全失败exit语义', async () => {
  assert.match(readFileSync(new URL('../push-raw-comments.js', import.meta.url), 'utf8'), /module\.exports\s*=\s*\{\s*runLegacyPush\s*\}/);
  const { runLegacyPush } = require('../push-raw-comments.js');
  const config = { channels: { feishu: { accounts: { main: { appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET } } } } };
  const tsv = 'LEAD\t甲\t123\t个人\t想了解\t昨天\t广东\t视频\t关键词\t深圳\thttps://example.com/123\thttps://example.com/v';
  for (const fail of [false, true]) {
    const logs = [];
    const http = transport({ write: fail ? async () => response({ code: 1 }) : undefined });
    const outcome = await runLegacyPush(tsv, 'legacy-batch', 'yuesheng', {
      config, request: http.request, log: line => logs.push(line), error: () => {},
    });
    assert.equal(outcome.exitCode, fail ? 1 : 0);
    assert.equal(outcome.result.metrics.comments_written, fail ? 0 : 1);
    const stats = logs.find(line => line.startsWith('PUSH_COMMENTS_STATS '));
    assert.ok(stats);
    assert.deepEqual(JSON.parse(stats.slice('PUSH_COMMENTS_STATS '.length)),
      { created: fail ? 0 : 1, dup: 0, input: 1 });
  }
});

for (const [label, dyid, purl] of [
  ['只有账号类型', '', ''],
  ['只有主页URL及账号类型', '', 'https://example.com/user'],
  ['有抖音号但无主页URL', '123', ''],
]) {
  test(`HTTP读回省略空独立字段仍能重试：${label}，昵称含竖线`, async () => {
    const { persistRawComments } = require('../raw-comment-activities.js');
    const source = { id: 'source', fields: { 评论者昵称: '甲|乙', 评论原文: '想了解',
      抖音号: dyid, 主页链接: purl, 账号类型: '个人',
      用户主页标识: [dyid, purl, '个人'].filter(Boolean).join(' | ') } };
    const batch = input([source]);
    const records = [];
    let writes = 0;
    const http = transport({ records, write: async (_url, options) => {
      writes++;
      const fields = Object.fromEntries(Object.entries(JSON.parse(options.body).fields).filter(([, value]) => value !== ''));
      const record = { record_id: 'pool-sparse', fields };
      records.push(record);
      return response({ code: 0, data: { record } });
    } });
    const run = async () => persistRawComments(batch, await load().createRawCommentDeps(batch, { env, request: http.request }));
    assert.equal((await run()).status, 'completed');
    const assertReplay = result => {
      assert.equal(result.status, 'completed');
      assert.equal(result.outputs.comments[0].id, 'pool-sparse');
      assert.deepEqual(result.metrics, { comments_written: 0, duplicates: 1, pending: 0 });
    };
    assertReplay(await run());
    // 存量仅有原始ID与旧过滤空项的主页拼串，也能恢复三独立身份字段。
    for (const name of ['抖音号', '主页链接', '账号类型']) delete records[0].fields[name];
    assertReplay(await run());
    assert.equal(writes, 1);
    records[0].fields.用户主页标识 += ' | 其他类型';
    const conflict = await run();
    assert.equal(conflict.failure_class, 'fatal');
    assert.equal(conflict.outputs.comments.length, 0);
    assert.equal(conflict.evidence[0].reason_code, 'rawid_conflict');
    assert.equal(writes, 1);
  });
}

function settlementHttp() {
  const pool = new Map(), leads = new Map();
  const writes = [];
  const request = async (url, options) => {
    if (url.includes('/auth/')) return response({ code: 0, tenant_access_token: 'fixture-token' });
    if (url.includes('/fields')) return response({ code: 0, data: { items: fields.map(field_name => ({ field_name, type: 1 })) } });
    const isPool = url.includes('/tables/tblQzIHcmGSPUAZm/');
    const store = isPool ? pool : leads;
    if (options.method === 'GET') {
      const id = url.match(/\/records\/([^/?]+)/)?.[1];
      return response({ code: 0, data: id ? { record: store.get(id) } : { items: [...store.values()], has_more: false } });
    }
    const body = JSON.parse(options.body);
    writes.push({ isPool, method: options.method, fields: body.fields });
    const id = options.method === 'POST' ? `${isPool ? 'pool' : 'lead'}-${store.size + 1}` : url.split('/').at(-1);
    const record = { record_id: id, fields: { ...store.get(id)?.fields, ...body.fields } };
    store.set(id, record);
    return response({ code: 0, data: { record } });
  };
  const run = async batch => require('../raw-comment-delivery.js').deliverRawComments(batch, {
    persistDeps: await load().createRawCommentDeps(batch, { env, request }),
    createDeliveryDeps: payload => require('../comment-delivery-storage.js').createDeliveryDeps(payload, { env, request }),
  });
  return { pool, leads, writes, request, run };
}

const scoredSource = (id, nick, dyid = '', purl = '', comment = '想了解') => ({ id,
  fields: { 评论者昵称: nick, 评论原文: comment, 抖音号: dyid, 主页链接: purl,
    账号类型: '个人', 用户主页标识: [dyid, purl, '个人'].filter(Boolean).join(' | ') },
  verdict: { grade: 'A', relevance: '相关', reason: '主动咨询' }, score_status: 'completed' });

test('真实落池配送HTTP闭环：两个不同昵称的无ID个人各自建线索，不以类型当抖音号误合并', async () => {
  const http = settlementHttp();
  const result = await http.run(input([scoredSource('one', '甲'), scoredSource('two', '乙')]));
  assert.equal(result.status, 'completed');
  assert.equal(result.metrics.leads_written, 2);
  assert.equal(result.metrics.duplicates_highlighted, 0);
  assert.deepEqual([...http.leads.values()].map(r => [r.fields.抖音昵称, r.fields.抖音号, r.fields.主页链接]),
    [['甲', '', ''], ['乙', '', '']]);
});

test('真实落池配送HTTP闭环：无抖音号的主页URL写到独立主页列', async () => {
  const http = settlementHttp();
  const result = await http.run(input([scoredSource('one', '丙', '', 'https://example.com/user')]));
  assert.equal(result.status, 'completed');
  assert.equal(http.leads.get('lead-1').fields.抖音号, '');
  assert.equal(http.leads.get('lead-1').fields.主页链接, 'https://example.com/user');
});

test('真实落池配送HTTP闭环：有抖音号但无URL时不把账号类型写进主页列', async () => {
  const http = settlementHttp();
  const result = await http.run(input([scoredSource('one', '丁', '456')]));
  assert.equal(result.status, 'completed');
  assert.equal(http.leads.get('lead-1').fields.抖音号, '456');
  assert.equal(http.leads.get('lead-1').fields.主页链接, '');
});

test('真实结算HTTP：旧稀疏池身份fallback不把个人或URL当ID', async () => {
  const http = settlementHttp();
  const sources = [scoredSource('one', '甲'), scoredSource('two', '乙', '', 'https://example.com/user'), scoredSource('three', '丙', '789')];
  for (const [index, source] of sources.entries()) {
    const fields = { ...source.fields, 原始评论ID: `${source.fields.评论者昵称}|${source.fields.抖音号 || 'noid'}|想了解` };
    for (const name of ['抖音号', '主页链接', '账号类型']) delete fields[name];
    const id = 'legacy-' + index;
    http.pool.set(id, { record_id: id, fields });
    source.id = id; source.fields = fields;
  }
  const batch = input(sources);
  const deps = await require('../comment-delivery-storage.js').createDeliveryDeps(batch, { env, request: http.request });
  const result = await require('../comment-activities.js').deliverComments(batch, deps);
  assert.equal(result.metrics.leads_written, 3);
  assert.deepEqual([...http.leads.values()].map(r => [r.fields.抖音号, r.fields.主页链接]),
    [['', ''], ['', 'https://example.com/user'], ['789', '']]);
});

test('真实落池配送HTTP闭环：昵称/抖音号去重键trim一致并共享重复次数', async () => {
  const http = settlementHttp();
  const sources = [scoredSource('one', ' 丁 ', ' 456 ', '', '一'),
    scoredSource('two', '丁', '456', '', '二'), scoredSource('three', '丁', '', '', '三')];
  const result = await http.run(input(sources));
  assert.equal(result.metrics.leads_written, 1);
  assert.equal(result.metrics.duplicates_highlighted, 2);
  assert.equal(http.leads.get('lead-1').fields.重复命中次数, 2);
  // 远端历史字段带空白，重新初始化适配器后也必须按同一规范查找。
  http.leads.get('lead-1').fields.抖音昵称 = ' 丁 ';
  http.leads.get('lead-1').fields.抖音号 = ' 456 ';
  const retry = await http.run(input([scoredSource('four', '丁', '456', '', '四')]));
  assert.equal(retry.metrics.leads_written, 0);
  assert.equal(retry.metrics.duplicates_highlighted, 1);
  assert.equal(http.leads.get('lead-1').fields.重复命中次数, 3);
});
