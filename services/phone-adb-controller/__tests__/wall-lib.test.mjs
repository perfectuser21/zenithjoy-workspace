// services/phone-adb-controller/__tests__/wall-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash } from './wall-helpers.mjs';

const LIB = new URL('../wall-lib.sh', import.meta.url).pathname;
// 必须异步：假中台与测试同进程，spawnSync 会阻塞事件循环导致 curl 永远收不到响应
const run = (script, env) => runBash(`. "${LIB}"; ${script}`, env);

test('profile→serial 与缓存读写', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  let r = await run('wall_load_env && wall_profile_serial legacy', env);
  assert.equal(r.stdout.trim(), 'SER2');
  r = await run('wall_load_env && wall_cache_put SER1 11111111-1111-4111-8111-111111111111 && wall_cache_put SER1 22222222-2222-4222-8222-222222222222 && wall_cached_uuid SER1 && wc -l < "$WALL_AGENTS_TSV"', env);
  assert.match(r.stdout, /22222222-2222-4222-8222-222222222222/);
  const tsv = readFileSync(join(dir, 'cfg', 'wall-agents.tsv'), 'utf8');
  assert.equal(tsv.split('\n').filter(Boolean).length, 1); // 同一序列号只保留一行
});

test('缓存并发写：三台同时注册互不覆盖（子进程 $$ 相同不能撞临时文件）', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  for (let i = 0; i < 5; i++) { // 竞态间歇触发，多跑几轮
    const r = await run('wall_load_env && rm -f "$WALL_AGENTS_TSV" && ( wall_cache_put A 1 & wall_cache_put B 2 & wall_cache_put C 3 & wait ) && cat "$WALL_AGENTS_TSV"', env);
    assert.equal(r.status, 0, r.stderr);
    const lines = r.stdout.split('\n').filter(Boolean).sort();
    assert.deepEqual(lines, ['A\t1\tphone-A', 'B\t2\tphone-B', 'C\t3\tphone-C']);
  }
});

test('register 传 license/machine_id/hostname=phone-<序列号>，返回 uuid 并写缓存', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi();
  t.after(() => api.close()); // 断言失败也要关假中台，否则测试进程挂住
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = await run('wall_load_env && wall_register SER1', env);
  assert.equal(r.stdout.trim(), api.uuid);
  const reg = api.requests.find((q) => q.url === '/api/agent/register');
  const body = JSON.parse(reg.body.toString());
  assert.equal(body.license_key, 'ZJ-E-TESTTEST');
  assert.equal(body.machine_id, 'SER1');
  assert.equal(body.hostname, 'phone-SER1');
  assert.equal(body.agent_id, 'phone-SER1');
  assert.match(readFileSync(join(dir, 'cfg', 'wall-agents.tsv'), 'utf8'), new RegExp(`^SER1\\t${api.uuid}\\tphone-SER1$`, 'm'));
});

test('抓屏压缩：≤上限成功；超上限两次仍超则返回 2', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  let r = await run('wall_load_env && wall_capture_jpeg SER1 "$ZJ_WALL_TMP/o.jpg" 122880; echo rc=$?', env);
  assert.match(r.stdout, /rc=0/);
  assert.ok(existsSync(join(dir, 'tmp', 'o.jpg')));
  const big = makeTmp();
  const envBig = makeEnv(big, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(big, { jpegBytes: Buffer.alloc(130 * 1024, 0xff) }), convert: makePassthroughConvert(big) });
  r = await run('wall_load_env && wall_capture_jpeg SER1 "$ZJ_WALL_TMP/o.jpg" 122880; echo rc=$?', envBig);
  assert.match(r.stdout, /rc=2/);
  // 两级降质：质量参数依次 55、35
  const calls = readFileSync(join(big, 'convert.calls'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[3]);
  assert.deepEqual(calls, ['55', '35']);
  // 超限帧清理：文件存在 ⇔ 可发
  assert.ok(!existsSync(join(big, 'tmp', 'o.jpg')));
});

test('前台包名从 mCurrentFocus 取', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = await run('wall_load_env && wall_foreground_pkg SER1', env);
  assert.equal(r.stdout.trim(), 'com.ss.android.ugc.aweme');
});
