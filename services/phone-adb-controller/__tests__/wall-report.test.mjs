// services/phone-adb-controller/__tests__/wall-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash, TINY_JPEG } from './wall-helpers.mjs';

const WR = new URL('../wall-report.sh', import.meta.url).pathname;
// 必须异步：假中台与测试同进程，spawnSync 会阻塞事件循环导致 curl 永远收不到响应
// 用 "$BASH" 而不是 PATH 里的 bash：WALL_TEST_BASH=/bin/bash 时脚本本身才真在 3.2 下跑
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const wr = (env, ...args) => runBash(`"$BASH" "${WR}" ${args.map(q).join(' ')}`, env, { timeoutMs: 15_000 });
const body = (r) => JSON.parse(r.body.toString());
// 与 wall-report.sh 里 PLACEHOLDER_JPEG_B64 同源（1×1 灰 JPEG）
const PLACEHOLDER_JPEG_B64 = TINY_JPEG.toString('base64');

async function setup(t, opts = {}, adbOpts = {}) {
  const dir = makeTmp();
  const api = await startFakeApi(opts);
  t.after(() => api.close());
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, adbOpts), convert: makePassthroughConvert(dir) });
  return { dir, api, env };
}

async function ok(p) {
  const r = await p;
  assert.equal(r.timedOut, false, '15s 内没退出');
  assert.equal(r.status, 0, r.stderr);
  return r;
}

test('start/step/note/done 全链：只带 Bearer 不带 license 头，note 续报当前步 doing', async (t) => {
  const { api, env } = await setup(t);
  await ok(wr(env, 'start', 'SER1', '获客采收·AI', '拉Commander,设备预检,取词单'));
  await ok(wr(env, 'step', 'SER1', '0', 'done'));
  await ok(wr(env, 'step', 'SER1', '1', 'doing', '词1: 学AI'));
  await ok(wr(env, 'note', 'SER1', '视频2: xxx'));
  await ok(wr(env, 'done', 'SER1'));
  const tk = api.requests.find((r) => /\/tasks$/.test(r.url));
  assert.equal(tk.url, `/api/workers/${api.uuid}/tasks`);
  assert.equal(tk.headers.authorization, 'Bearer tok-test');
  assert.equal(tk.headers['x-agent-license'], undefined);
  assert.deepEqual(body(tk), { title: '获客采收·AI', steps: ['拉Commander', '设备预检', '取词单'], executor_id: 'adb-wall' });
  const stepReqs = api.requests.filter((r) => /\/steps$/.test(r.url));
  for (const r of stepReqs) assert.equal(r.url, `/api/workers/tasks/${api.taskId}/steps`);
  const steps = stepReqs.map(body);
  assert.deepEqual(steps.map((s) => [s.step_index, s.status, s.note]), [[0, 'done', ''], [1, 'doing', '词1: 学AI'], [1, 'doing', '视频2: xxx']]);
  for (const s of steps) assert.equal(s.executor_id, 'adb-wall');
  for (const r of api.requests.filter((r) => /\/steps$|\/complete$/.test(r.url))) {
    assert.equal(r.headers.authorization, 'Bearer tok-test');
    assert.equal(r.headers['x-agent-license'], undefined);
  }
  const c = api.requests.find((r) => /\/complete$/.test(r.url));
  assert.equal(c.url, `/api/workers/tasks/${api.taskId}/complete`);
  assert.deepEqual(body(c), { outcome: 'completed', executor_id: 'adb-wall' });
  assert.equal(api.requests.filter((r) => /\/complete$/.test(r.url)).length, 1);
});

test('fail 必带三件套（前台包名 + 诊断行 + JPEG base64）并 complete failed', async (t) => {
  const { api, env } = await setup(t);
  await ok(wr(env, 'start', 'SER1', 't', 'a,b'));
  await ok(wr(env, 'fail', 'SER1', '1', 'device_offline', 'adb get-state 失败'));
  const s = body(api.requests.find((r) => /\/steps$/.test(r.url)));
  assert.equal(s.status, 'failed');
  assert.equal(s.step_index, 1);
  assert.equal(s.note, 'device_offline');
  assert.equal(s.foreground_pkg, 'com.ss.android.ugc.aweme');
  assert.equal(s.diag_line, 'adb get-state 失败');
  assert.equal(s.screenshot_jpeg_b64, TINY_JPEG.toString('base64'));
  const c = body(api.requests.find((r) => /\/complete$/.test(r.url)));
  assert.deepEqual(c, { outcome: 'failed', executor_id: 'adb-wall', error_code: 'device_offline', failed_step: 1 });
});

test('fail 缺 diag 时 diag_line 退回 error_code；锁屏 mCurrentFocus=null 时 foreground_pkg=unknown', async (t) => {
  const { api, env } = await setup(t, {}, { focusLine: '  mCurrentFocus=null' });
  await ok(wr(env, 'start', 'SER1', 't', 'a,b'));
  await ok(wr(env, 'fail', 'SER1', '0', 'screen_locked'));
  const s = body(api.requests.find((r) => /\/steps$/.test(r.url)));
  assert.equal(s.status, 'failed');
  assert.equal(s.foreground_pkg, 'unknown');
  assert.equal(s.diag_line, 'screen_locked');
  assert.equal(s.note, 'screen_locked');
  assert.equal(s.screenshot_jpeg_b64, TINY_JPEG.toString('base64'));
  const c = body(api.requests.find((r) => /\/complete$/.test(r.url)));
  assert.deepEqual(c, { outcome: 'failed', executor_id: 'adb-wall', error_code: 'screen_locked', failed_step: 0 });
});

test('抓屏失败（adb 输出空）→ 占位 JPEG 且 note 截到 170 后仍带标注', async (t) => {
  const { api, env } = await setup(t, {}, { jpegBytes: Buffer.alloc(0) });
  await ok(wr(env, 'start', 'SER1', 't', 'a,b'));
  await ok(wr(env, 'fail', 'SER1', '1', 'x'.repeat(250)));
  const s = body(api.requests.find((r) => /\/steps$/.test(r.url)));
  assert.equal(s.status, 'failed');
  assert.equal(s.screenshot_jpeg_b64, PLACEHOLDER_JPEG_B64);
  assert.equal(s.note, `${'x'.repeat(170)} [截图失败,占位图]`);
  assert.equal(s.diag_line, 'x'.repeat(250));
  const c = body(api.requests.find((r) => /\/complete$/.test(r.url)));
  assert.equal(c.outcome, 'failed');
});

test('idx 非数字：step/fail 不 POST 不改状态，只记日志；随后 done 仍能正常收尾', async (t) => {
  const { dir, api, env } = await setup(t);
  await ok(wr(env, 'start', 'SER1', 't', 'a,b'));
  await ok(wr(env, 'step', 'SER1', 'abc', 'doing', 'n'));
  await ok(wr(env, 'fail', 'SER1', '1x', 'boom'));
  assert.equal(api.requests.filter((r) => /\/steps$|\/complete$/.test(r.url)).length, 0);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /idx 非数字/);
  await ok(wr(env, 'done', 'SER1'));
  assert.equal(api.requests.filter((r) => /\/complete$/.test(r.url)).length, 1);
});

test('note/fail 无进行中任务：不发请求，记一行日志', async (t) => {
  const { dir, api, env } = await setup(t);
  await ok(wr(env, 'note', 'SER1', 'x'));
  await ok(wr(env, 'fail', 'SER1', '0', 'boom'));
  assert.equal(api.requests.length, 0);
  const log = readFileSync(join(dir, 'wall.log'), 'utf8');
  assert.equal((log.match(/无进行中任务,忽略/g) || []).length, 2);
});

test('--profile 解析序列号；409 时先把旧任务 complete superseded 再重试', async (t) => {
  const { api, env } = await setup(t, { busyCodes: [201, 409, 201] });
  await ok(wr(env, 'start', '--profile', 'legacy', 't1', 'a')); // 201
  await ok(wr(env, 'start', '--profile', 'legacy', 't2', 'a')); // 409 → superseded → 201
  const completes = api.requests.filter((r) => /\/complete$/.test(r.url)).map(body);
  assert.deepEqual(completes, [{ outcome: 'failed', executor_id: 'adb-wall', error_code: 'superseded', failed_step: 0 }]);
  assert.equal(api.requests.filter((r) => /\/tasks$/.test(r.url)).length, 3);
  const reg = body(api.requests.find((r) => r.url === '/api/agent/register'));
  assert.equal(reg.machine_id, 'SER2');
});

test('两条链交错（WALL_NS）：状态文件按命名空间隔离，409 时收尾对方链并使其退化为忽略', async (t) => {
  const { dir, api, env } = await setup(t, { busyCodes: [201, 409, 201], taskIds: ['task-h', 'task-o'] });
  const harvest = { ...env, WALL_NS: 'harvest' };
  const outreach = { ...env, WALL_NS: 'outreach' };
  await ok(wr(harvest, 'start', 'SER1', '采收', 'a,b'));                 // 201 → task-h
  assert.ok(existsSync(join(dir, 'tmp', 'task-SER1-harvest')));
  await ok(wr(outreach, 'start', 'SER1', '触达', 'c'));                  // 409 → 收尾 task-h → 201 task-o
  const completes = api.requests.filter((r) => /\/complete$/.test(r.url));
  assert.equal(completes.length, 1);
  assert.equal(completes[0].url, '/api/workers/tasks/task-h/complete');
  assert.deepEqual(body(completes[0]), { outcome: 'failed', executor_id: 'adb-wall', error_code: 'superseded', failed_step: 0 });
  assert.ok(!existsSync(join(dir, 'tmp', 'task-SER1-harvest')), '对方链状态文件没删');
  assert.ok(existsSync(join(dir, 'tmp', 'task-SER1-outreach')));
  const before = api.requests.length;
  await ok(wr(harvest, 'step', 'SER1', '1', 'done'));                     // 采收链后续退化为忽略，不劫持触达任务
  await ok(wr(harvest, 'done', 'SER1'));
  assert.equal(api.requests.length, before);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /无进行中任务,忽略/);
  assert.ok(existsSync(join(dir, 'tmp', 'task-SER1-outreach')), '触达链状态被采收链误删');
  await ok(wr(outreach, 'done', 'SER1'));
  const last = api.requests[api.requests.length - 1];
  assert.equal(last.url, '/api/workers/tasks/task-o/complete');
  assert.deepEqual(body(last), { outcome: 'completed', executor_id: 'adb-wall' });
  assert.ok(!existsSync(join(dir, 'tmp', 'task-SER1-outreach')));
});

test('缺 ZJ_INTERNAL_TOKEN / 中台不可达：都退出 0 不发请求或只记日志', async (t) => {
  const { dir, api, env } = await setup(t);
  const noTok = { ...env, ZJ_WALL_ENV: join(dir, 'cfg', 'notok.env') };
  writeFileSync(noTok.ZJ_WALL_ENV, `ZJ_API_BASE=${api.url}\nZJ_LICENSE=ZJ-E-TESTTEST\n`);
  await ok(wr(noTok, 'start', 'SER1', 't', 'a'));
  assert.equal(api.requests.length, 0);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /缺 ZJ_INTERNAL_TOKEN/);
  const dead = { ...env, ZJ_WALL_ENV: join(dir, 'cfg', 'dead.env') };
  writeFileSync(dead.ZJ_WALL_ENV, 'ZJ_API_BASE=http://127.0.0.1:1\nZJ_LICENSE=ZJ-E-TESTTEST\nZJ_INTERNAL_TOKEN=t\n');
  await ok(wr(dead, 'start', 'SER1', 't', 'a'));
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /register 网络失败 SER1/);
  assert.equal(api.requests.length, 0);
});
