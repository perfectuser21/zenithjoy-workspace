import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { startAuditSnapshot, remediateBulk } from '../picomatch-audit-proxy.mjs';

const target = { id: 1247710, url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
  severity: 'high', vulnerable_versions: '<=4.0.7', title: 'picomatch repeated extglobs', cwe: ['CWE-1333'] };
const other = { ...target, id: 123, url: 'https://github.com/advisories/GHSA-other', severity: 'critical' };
const bulkPath = '/-/npm/v1/security/advisories/bulk';
const versions = ['2.3.2', '4.0.5'];

test('只移除已修复的准确公告，原报告与其他独立漏洞逐字段保留', () => {
  const input = { picomatch: [target, other], another: [{ ...other, arbitrary: { value: 1 } }] };
  const original = structuredClone(input), output = remediateBulk(input);
  assert.deepEqual(input, original);
  assert.deepEqual(output, { picomatch: [other], another: original.another });
});

for (const change of [x => { x.severity = 'critical'; }, x => { x.vulnerable_versions = '<=5'; },
  x => { x.id = 999; }, x => { x.cwe = ['CWE-94']; }]) {
  test('公告语义变化拒绝沿用旧修补证明', () => {
    const changed = structuredClone(target); change(changed);
    assert.throws(() => remediateBulk({ picomatch: [changed] }), /ADVISORY_CHANGED/);
  });
}

for (const input of [null, [], { picomatch: {} }, { picomatch: [null] }, { error: 'registry failure' }]) {
  test('无效上游响应不得变成干净报告', () => assert.throws(() => remediateBulk(input), /REPORT/));
}

test('两次审计使用同一上游快照，gzip请求可解析，未知请求和额外版本失败', async t => {
  let calls = 0;
  const proxy = await startAuditSnapshot({ versions, upstream: async ({ method }) => {
    calls++; return method === 'POST' ? { picomatch: [target, other] } : { name: 'picomatch', versions: {} };
  } });
  t.after(() => proxy.close());
  const body = JSON.stringify({ picomatch: versions });
  const request = (phase, path = bulkPath, payload = body) => fetch(proxy.origin + '/' + phase + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body: gzipSync(payload),
  });
  assert.deepEqual(await (await request('original')).json(), { picomatch: [target, other] });
  assert.equal((await fetch(proxy.origin + '/original/picomatch')).status, 200);
  proxy.activateRemediation();
  assert.deepEqual(await (await request('remediated')).json(), { picomatch: [other] });
  assert.equal((await fetch(proxy.origin + '/remediated/picomatch')).status, 200);
  assert.equal(calls, 2, '修复后审计不能另取变化中的上游数据');
  assert.equal((await request('remediated', bulkPath, JSON.stringify({ picomatch: ['9.9.9'] }))).status, 502);
  assert.equal((await request('remediated', '/-/npm/v1/security/audits/quick')).status, 502);
  assert.equal((await fetch(proxy.origin + '/remediated/unseen')).status, 502);
  assert.throws(() => proxy.assertHealthy(), /SNAPSHOT/);
});

test('没有原始审计快照不允许过滤，失败上游不提供空报告', async t => {
  const proxy = await startAuditSnapshot({ versions, upstream: async () => { throw Error('network failed'); } });
  t.after(() => proxy.close());
  assert.throws(() => proxy.activateRemediation(), /SNAPSHOT/);
  const reply = await fetch(proxy.origin + '/original' + bulkPath, { method: 'POST', body: JSON.stringify({ picomatch: versions }) });
  assert.equal(reply.status, 502);
  assert.throws(() => proxy.assertHealthy(), /SNAPSHOT/);
});

test('原始请求尚未完成时不能切换过滤阶段', async t => {
  let release, arrived;
  const pending = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  const proxy = await startAuditSnapshot({ versions, upstream: async ({ method }) => {
    if (method === 'POST') return { picomatch: [target] };
    arrived(); await pending; return { name: 'picomatch' };
  } });
  t.after(() => proxy.close());
  await (await fetch(proxy.origin + '/original' + bulkPath, { method: 'POST', body: JSON.stringify({ picomatch: versions }) })).json();
  const reply = fetch(proxy.origin + '/original/picomatch');
  await started;
  assert.throws(() => proxy.activateRemediation(), /SNAPSHOT/);
  release();
  assert.deepEqual(await (await reply).json(), { name: 'picomatch' });
  proxy.activateRemediation();
});
