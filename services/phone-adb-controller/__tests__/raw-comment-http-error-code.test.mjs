import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createRawCommentDeps } = require('../raw-comment-storage.js');
const { persistRawComments, RAW_COMMENT_FIELDS } = require('../raw-comment-activities.js');
const canary = 'private-response-do-not-emit';
const env = { FEISHU_ACCOUNT: 'main', FEISHU_APP_ID: 'fixture-app', FEISHU_APP_SECRET: 'fixture-secret' };
const input = { run_tag: 'http-code-test', line_key: 'yuesheng', comments: [
  { id: 'fixture-source', fields: { 评论者昵称: '测试', 评论原文: '测试内容' } },
] };

async function fixture(t, { body, authFailure = false, hanging = false }) {
  let writes = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) { /* consume only local synthetic fixture input */ }
    if ((authFailure && req.url.includes('/auth/')) || (req.method === 'POST' && req.url.endsWith('/records'))) {
      if (!authFailure) writes++;
      res.writeHead(403, { 'Content-Type': 'application/json' });
      if (hanging) { res.write('{"code":'); return; }
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url.includes('/auth/') ? { code: 0, tenant_access_token: 'fixture-token' }
      : req.url.includes('/fields') ? { code: 0, data: { items: RAW_COMMENT_FIELDS.map(field_name => ({ field_name, type: 1 })) } }
        : { code: 0, data: { items: [], has_more: false } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const request = (url, options) => {
    assert.equal(new URL(url).hostname, 'open.feishu.cn');
    const target = new URL(url);
    return fetch(`http://127.0.0.1:${server.address().port}${target.pathname}${target.search}`, options);
  };
  return { request, writes: () => writes };
}

for (const authFailure of [false, true]) {
  test(`真实HTTP403保安全整数code：${authFailure ? '初始化' : '逐条入库'}`, async t => {
    const http = await fixture(t, { authFailure, body: JSON.stringify({ code: 1254302, msg: canary, token: canary }) });
    if (authFailure) {
      await assert.rejects(createRawCommentDeps(input, { env, request: http.request }), error => {
        assert.equal(error.reason_code, 'raw_storage_http_failed');
        assert.equal(error.http_status, 403);
        assert.equal(error.feishu_code, 1254302);
        assert.ok(!JSON.stringify(error).includes(canary));
        assert.ok(!error.message.includes(canary));
        return true;
      });
      assert.equal(http.writes(), 0);
    } else {
      const deps = await createRawCommentDeps(input, { env, request: http.request });
      const result = await persistRawComments(input, deps);
      assert.equal(result.status, 'failed');
      assert.equal(result.metrics.pending, 1);
      assert.equal(result.metrics.comments_written, 0);
      assert.equal(result.evidence[0].feishu_code, 1254302);
      assert.equal(result.evidence[0].http_status, 403);
      assert.equal(result.evidence[0].reason_code, 'raw_storage_http_failed');
      assert.equal(deps.seen.size, 0);
      assert.equal(http.writes(), 1);
      assert.ok(!JSON.stringify(result).includes(canary));
    }
  });
}

for (const [name, code, body] of [
  ['零码仍是HTTP失败', 0, '{"code":0}'],
  ['整数上界', 2147483647, '{"code":2147483647}'],
  ['8192字节边界', 1254302, JSON.stringify({ code: 1254302, pad: 'x'.repeat(8167) })],
]) {
  test(`HTTP403 ${name} 安全码保留且不算成功`, async t => {
    if (name === '8192字节边界') assert.equal(Buffer.byteLength(body), 8192);
    const http = await fixture(t, { body });
    const deps = await createRawCommentDeps(input, { env, request: http.request });
    const result = await persistRawComments(input, deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.metrics.pending, 1);
    assert.equal(result.evidence[0].feishu_code, code);
    assert.equal(result.evidence[0].reason_code, 'raw_storage_http_failed');
    assert.equal(http.writes(), 1);
  });
}

for (const [name, body] of [
  ['非JSON', canary], ['字符串码', JSON.stringify({ code: '1254302', msg: canary })],
  ['负数码', JSON.stringify({ code: -1 })], ['超范围码', JSON.stringify({ code: 2147483648 })],
  ['小数码', JSON.stringify({ code: 1.5 })], ['超大响应', JSON.stringify({ code: 1254302, msg: canary.repeat(2000) })],
]) {
  test(`HTTP403 ${name} 保原HTTP失败，不泄露body`, async t => {
    const http = await fixture(t, { body });
    const deps = await createRawCommentDeps(input, { env, request: http.request });
    const result = await persistRawComments(input, deps);
    assert.equal(result.evidence[0].feishu_code, undefined);
    assert.equal(result.evidence[0].reason_code, 'raw_storage_http_failed');
    assert.equal(result.evidence[0].http_status, 403);
    assert.equal(http.writes(), 1);
    assert.ok(!JSON.stringify(result).includes(canary));
  });
}

test('HTTP403响应体悬挂：有界返回HTTP失败，不重试POST', async t => {
  const http = await fixture(t, { hanging: true });
  const deps = await createRawCommentDeps(input, { env, request: http.request });
  const started = Date.now();
  const result = await persistRawComments(input, deps);
  assert.ok(Date.now() - started < 2500);
  assert.equal(result.evidence[0].feishu_code, undefined);
  assert.equal(result.evidence[0].reason_code, 'raw_storage_http_failed');
  assert.equal(http.writes(), 1);
});
