// services/phone-adb-controller/__tests__/phone-wall-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash, TINY_JPEG } from './wall-helpers.mjs';

const PUSH = new URL('../phone-wall-push.sh', import.meta.url).pathname;
// 必须异步：假中台与测试同进程，spawnSync 会阻塞事件循环导致 curl 永远收不到响应
// 用 "$BASH" 而不是 PATH 里的 bash：WALL_TEST_BASH=/bin/bash 时脚本本身才真在 3.2 下跑
const runOnce = (env) => runBash(`"$BASH" "${PUSH}"`, env, { timeoutMs: 20_000 });

test('一轮：两台手机各 register 一次 + 各推一帧（image/jpeg、带 license 头、≤120KB）', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi();
  t.after(() => api.close());
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1', 'SER2'] }), convert: makePassthroughConvert(dir) });
  const r = await runOnce(env);
  assert.equal(r.timedOut, false, '20s 内没退出');
  assert.equal(r.status, 0, r.stderr);
  const regs = api.requests.filter((q) => q.url === '/api/agent/register');
  assert.equal(regs.length, 2);
  const frames = api.requests.filter((q) => /\/frame$/.test(q.url));
  assert.equal(frames.length, 2);
  for (const f of frames) {
    assert.equal(f.method, 'POST');
    assert.equal(f.headers['content-type'], 'image/jpeg');
    assert.equal(f.headers['x-agent-license'], 'ZJ-E-TESTTEST');
    assert.ok(f.body.length <= 122880);
    assert.ok(f.body.equals(TINY_JPEG));
    assert.match(f.url, new RegExp(`^/api/workers/${api.uuid}/frame$`));
  }
  assert.match(readFileSync(join(dir, 'cfg', 'wall-agents.tsv'), 'utf8'), /^SER1\t/m);
});

test('帧超 120KB 两次降质仍超 → 跳过该帧，不发请求，退出码 0', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi();
  t.after(() => api.close());
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { jpegBytes: Buffer.alloc(130 * 1024, 0xff) }), convert: makePassthroughConvert(dir) });
  const r = await runOnce(env);
  assert.equal(r.timedOut, false, '20s 内没退出');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(api.requests.filter((q) => q.url === '/api/agent/register').length, 1);
  assert.equal(api.requests.filter((q) => /\/frame$/.test(q.url)).length, 0);
  assert.doesNotMatch(readFileSync(join(dir, 'wall.log'), 'utf8'), /frame HTTP/); // 超限跳帧不是错误，不记日志
});

test('中台不可达：退出码 0，日志有记录', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = await runOnce(env);
  assert.equal(r.timedOut, false, '20s 内没退出');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /register 网络失败 SER1/);
});

test('缺配置文件：退出码 0 不崩', async () => {
  const dir = makeTmp();
  const env = { ...makeEnv(dir, { apiBase: 'x', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) }), ZJ_WALL_ENV: join(dir, 'nope.env') };
  const r = await runOnce(env);
  assert.equal(r.timedOut, false, '20s 内没退出');
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /缺配置/);
});
