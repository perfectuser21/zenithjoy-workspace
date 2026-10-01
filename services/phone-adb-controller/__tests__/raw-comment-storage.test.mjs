import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

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
