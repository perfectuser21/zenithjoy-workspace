// 0929 获客采收误判 executor_lost 回归测试。
// 事故：harvest-cron 第 3 阶段「采收主体」（batch2）一跑 1~7 小时，服务端租约 10 分钟只靠零星的步骤上报续命，
// 两次上报间隔一超 10 分钟 sweep 就判 failed/executor_lost——西安 M4 日志证实这些批都「批完成 7~42 LEAD + 账本 finalize ok」。
// 修法：wall-report 新增 heartbeat 子命令（纯续租、不改步骤 note）；harvest-cron 在 batch2 期间起后台心跳循环，
// batch2 结束/脚本退出时停；父进程被 kill -9 时心跳自行退出，绝不替死掉的采收永久续租。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash } from './wall-helpers.mjs';

const WR = new URL('../wall-report.sh', import.meta.url).pathname;
const HC = new URL('../harvest-cron.sh', import.meta.url).pathname;
// 7f842d12: harvest-cron.sh 已退成薄壳(exec wf-run.sh keyword_acquisition),源码接线守卫改查实现 wf-run.sh
const HC_IMPL = new URL('../wf-run.sh', import.meta.url).pathname;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const wr = (env, ...args) => runBash(`"$BASH" "${WR}" ${args.map(q).join(' ')}`, env, { timeoutMs: 15_000 });
const ZSH = spawnSync('bash', ['-lc', 'command -v zsh'], { encoding: 'utf8' }).stdout.trim();
const SKIP_ZSH = !ZSH && 'no zsh (CI: sudo apt-get install -y zsh)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup(t, opts = {}) {
  const dir = makeTmp();
  const api = await startFakeApi(opts);
  t.after(() => api.close());
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  return { dir, api, env };
}

test('wall-report heartbeat：POST /heartbeat 纯续租，不发 steps（不覆盖步骤进度 note）', async (t) => {
  const { api, env } = await setup(t);
  await wr(env, 'start', 'SER1', '获客采收·AI', 'a,b,c,d');
  await wr(env, 'step', 'SER1', '3', 'doing', '词2: 学AI');
  const before = api.requests.filter((r) => /\/steps$/.test(r.url)).length;
  const r = await wr(env, 'heartbeat', 'SER1');
  assert.equal(r.status, 0);
  const hb = api.requests.filter((x) => /\/heartbeat$/.test(x.url));
  assert.equal(hb.length, 1);
  assert.equal(hb[0].url, `/api/workers/tasks/${api.taskId}/heartbeat`);
  assert.deepEqual(JSON.parse(hb[0].body.toString()), { executor_id: 'adb-wall' });
  assert.equal(api.requests.filter((x) => /\/steps$/.test(x.url)).length, before, 'heartbeat 不应该再报 step');
});

test('wall-report heartbeat：老服务端没有 /heartbeat（404）→ 退回 note 式续租（当前步 doing），租约照样续上', async (t) => {
  const { api, env } = await setup(t, { heartbeatCode: 404 });
  await wr(env, 'start', 'SER1', 't', 'a,b,c,d');
  await wr(env, 'step', 'SER1', '3', 'doing', '词1');
  await wr(env, 'heartbeat', 'SER1');
  const steps = api.requests.filter((x) => /\/steps$/.test(x.url)).map((x) => JSON.parse(x.body.toString()));
  const last = steps[steps.length - 1];
  assert.equal(steps.length, 2);
  assert.equal(last.step_index, 3);
  assert.equal(last.status, 'doing');
});

// 0929 上线实测：旧版生产 API 对未知路由先过全局鉴权，回的是 401 而不是 404——只认 404 的退回分支在 promote 前不生效
test('wall-report heartbeat：旧服务端对未知路由回 401 → 同样退回 note 式续租', async (t) => {
  const { api, env } = await setup(t, { heartbeatCode: 401 });
  await wr(env, 'start', 'SER1', 't', 'a,b,c,d');
  await wr(env, 'step', 'SER1', '3', 'doing', '词1');
  await wr(env, 'heartbeat', 'SER1');
  assert.equal(api.requests.filter((x) => /\/steps$/.test(x.url)).length, 2);
});

test('wall-report heartbeat：409（任务已结束）→ 不退回 note，执行器该停手', async (t) => {
  const { api, env } = await setup(t, { heartbeatCode: 409 });
  await wr(env, 'start', 'SER1', 't', 'a,b,c,d');
  await wr(env, 'step', 'SER1', '3', 'doing', '词1');
  await wr(env, 'heartbeat', 'SER1');
  assert.equal(api.requests.filter((x) => /\/steps$/.test(x.url)).length, 1);
});

test('wall-report heartbeat：无进行中任务 → 不发请求', async (t) => {
  const { api, env } = await setup(t);
  const r = await wr(env, 'heartbeat', 'SER1');
  assert.equal(r.status, 0);
  assert.equal(api.requests.length, 0);
});

function fakeWr(dir) {
  const log = join(dir, 'wr.calls');
  const p = join(dir, 'fake-wr.sh');
  writeFileSync(p, `#!/bin/sh\necho "$*" >> "${log}"\n`);
  chmodSync(p, 0o755);
  return { p, count: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => l.startsWith('heartbeat SER1')).length : 0) };
}

test('停止心跳先暂停循环：杀sleep与终止父循环之间不能抢发下一次', { skip: SKIP_ZSH }, async () => {
  const f = fakeWr(makeTmp());
  const result = await runBash(`export WALL_REPORT=${q(f.p)} LEASE_HB_INTERVAL=60;
    HARVEST_CRON_LIB=1 source ${q(HC)};
    pkill(){ command pkill "$@"; /bin/sleep 0.3; }
    lease_heartbeat_start SER1; /bin/sleep 0.2; lease_heartbeat_stop; echo stopped`,
    process.env, { bash: ZSH, timeoutMs: 10000 });
  assert.match(result.stdout, /stopped/);
  assert.equal(f.count(), 0, '提前终止sleep不能产生新心跳');
});

test('harvest-cron lease_heartbeat_start/stop：按间隔发 heartbeat，stop 后不再发', { skip: SKIP_ZSH }, async () => {
  const dir = makeTmp();
  const f = fakeWr(dir);
  const r = await runBash(`export WALL_REPORT=${q(f.p)} LEASE_HB_INTERVAL=1; HARVEST_CRON_LIB=1 source ${q(HC)}; lease_heartbeat_start SER1; /bin/sleep 3.5; lease_heartbeat_stop; echo stopped`, process.env, { bash: ZSH, timeoutMs: 20_000 });
  assert.equal(r.timedOut, false);
  assert.match(r.stdout, /stopped/);
  const n = f.count();
  assert.ok(n >= 2, `3.5 秒内至少心跳 2 次，实际 ${n}`);
  await sleep(2500);
  assert.equal(f.count(), n, 'stop 之后心跳必须停');
});

test('harvest-cron 心跳：父进程死了（kill -9 没走 trap）心跳自行退出，不替死掉的采收永久续租', { skip: SKIP_ZSH }, async () => {
  const dir = makeTmp();
  const f = fakeWr(dir);
  await runBash(`export WALL_REPORT=${q(f.p)} LEASE_HB_INTERVAL=1; HARVEST_CRON_LIB=1 source ${q(HC)}; lease_heartbeat_start SER1; exit 0`, process.env, { bash: ZSH, timeoutMs: 10_000 });
  await sleep(3500);
  assert.ok(f.count() <= 1, `父进程退出后仍在心跳：${f.count()} 次`);
  // 反向对照：同样的起法父进程活着时确实会心跳——否则上面这条在"心跳根本没起来"时也恒绿
  const g = fakeWr(makeTmp());
  await runBash(`export WALL_REPORT=${q(g.p)} LEASE_HB_INTERVAL=1; HARVEST_CRON_LIB=1 source ${q(HC)}; lease_heartbeat_start SER1; /bin/sleep 2.5; lease_heartbeat_stop`, process.env, { bash: ZSH, timeoutMs: 10_000 });
  assert.ok(g.count() >= 1, '对照组：父进程活着时应至少心跳 1 次');
});

test('接线守卫：batch2 调用被心跳 start/stop 包住，且 EXIT trap 会停心跳', () => {
  const src = readFileSync(HC_IMPL, 'utf8');
  const iStart = src.indexOf('lease_heartbeat_start "$SERIAL"');
  const iB2 = src.indexOf('/bin/zsh "$BATCH2"');
  const iStop = src.indexOf('lease_heartbeat_stop', iB2);
  assert.ok(iStart > 0 && iStart < iB2, '心跳必须在 batch2 之前启动');
  assert.ok(iStop > iB2, 'batch2 结束后必须停心跳');
  assert.match(src, /trap '[^']*lease_heartbeat_stop[^']*' EXIT/, 'EXIT trap 必须停心跳（脚本中途退出不能留孤儿心跳）');
});
