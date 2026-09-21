// services/phone-adb-controller/__tests__/device-job-claimer.test.mjs
//
// 领单器是「主理人在页面点一下 → 手机真的动」的最后一环。这里用假中台 + 假 adb
// 把它整条跑一遍，守住四件会真出事的事：
//   · 没活时安静退出（每分钟一轮，不能刷屏也不能空转）
//   · 领到活就在真机上跑，并且**无论成败都回执**（不回执＝页面上永远"执行中"像卡死）
//   · 宿主级互斥：一台 Mac 同时只跑一单（两台手机抢 adb 会互相打架）
//   · 认领请求带的是本机 adb 里真实在线的序列号，不是配置文件里猜的
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { makeTmp, makeFakeAdb, runBash } from './wall-helpers.mjs';

const CLAIMER = new URL('../device-job-claimer.sh', import.meta.url).pathname;

/** 假中台：按脚本发来的请求返回预设的 job，并把收到的请求都记下来 */
function startFakeApi({ job = null, finishStatus = 200 } = {}) {
  const requests = [];
  return new Promise((resolve) => {
    const srv = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        requests.push({ url: req.url, method: req.method, headers: req.headers, body });
        if (req.url === '/api/schedule/claim') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { job } }));
        } else if (/\/finish$/.test(req.url)) {
          res.writeHead(finishStatus, { 'content-type': 'application/json' });
          res.end(JSON.stringify(finishStatus === 200
            ? { success: true, data: { id: 'j1', status: 'completed' } }
            : { success: false, error: 'NOT_RUNNING' }));
        } else {
          res.writeHead(404); res.end('{}');
        }
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${srv.address().port}`, requests, close: () => srv.close() });
    });
  });
}

/** 假 douyin-phone-adb：把收到的参数写进文件，按 EXIT_CODE 决定成败 */
function makeFakePhoneCtl(dir, { exitCode = 0 } = {}) {
  const p = join(dir, 'douyin-phone-adb');
  const argsFile = join(dir, 'phonectl-args.txt');
  writeFileSync(p, `#!/bin/sh\necho "$@" >> ${argsFile}\necho fake-output\nexit ${exitCode}\n`);
  chmodSync(p, 0o755);
  return { path: p, argsFile };
}

function makeEnv(dir, { apiBase, adb, phoneCtl, lockDir }) {
  const conf = join(dir, 'wall.env');
  writeFileSync(conf, `ZJ_API_BASE=${apiBase}\nZJ_INTERNAL_TOKEN=tok-test\n`);
  return {
    // spawn 的 env 是整体替换：不继承就没有 PATH，也没有脚本字符串里的 $BASH
    ...process.env,
    ZJ_CONF: conf,
    ZJ_ADB: adb,
    ZJ_PHONE_CTL: phoneCtl,
    ZJ_CLAIMER_LOG: join(dir, 'claimer.log'),
    ZJ_CLAIMER_LOCK: lockDir ?? join(dir, 'lock.d'),
    WALL_REPORT: join(dir, 'no-such-reporter'), // 上报器缺失必须被吞掉，不影响主流程
    HOME: dir,
  };
}

const run = (env) => runBash(`"$BASH" "${CLAIMER}"`, env, { timeoutMs: 30_000 });
const JOB = {
  id: 'job-1', title: '触达一单', dept: '智能获客', serial: 'SER1',
  params: { action: 'open-search', profile: 'work', arg: 'AI训练师' }, row_version: 0,
};

test('没活时安静退出，不碰手机', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: null });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir);
  const r = await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(existsSync(ctl.argsFile), false, '没活却动了手机');
  assert.equal(api.requests.filter((q) => /finish/.test(q.url)).length, 0);
});

test('认领带的是本机 adb 里真实在线的序列号', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: null });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir);
  await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1', 'SER2'] }), phoneCtl: ctl.path }));
  const claim = api.requests.find((q) => q.url === '/api/schedule/claim');
  assert.ok(claim, '没发认领请求');
  assert.deepEqual(JSON.parse(claim.body).serials, ['SER1', 'SER2']);
  assert.match(claim.headers.authorization, /^Bearer tok-test$/);
});

test('领到活 → 在真机上跑 → 回执 ok=true', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir, { exitCode: 0 });
  const r = await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path }));
  assert.equal(r.status, 0, r.stderr);
  const args = readFileSync(ctl.argsFile, 'utf8');
  assert.match(args, /--profile work open-search AI训练师/);
  const fin = api.requests.find((q) => /\/jobs\/job-1\/finish$/.test(q.url));
  assert.ok(fin, '没回执');
  assert.equal(JSON.parse(fin.body).ok, true);
});

test('真机执行失败也必须回执（不回执＝页面上永远"执行中"像卡死）', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir, { exitCode: 3 });
  const r = await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path }));
  assert.equal(r.status, 0, r.stderr);
  const fin = api.requests.find((q) => /\/finish$/.test(q.url));
  assert.ok(fin, '失败时没回执');
  const body = JSON.parse(fin.body);
  assert.equal(body.ok, false);
  assert.match(body.error_code, /EXEC_RC_3/);
});

test('派单没带动作时判失败并回执，不当成功混过去', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: { ...JOB, params: {} } });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir);
  await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path }));
  const fin = api.requests.find((q) => /\/finish$/.test(q.url));
  assert.equal(JSON.parse(fin.body).ok, false);
  assert.equal(JSON.parse(fin.body).error_code, 'NO_ACTION');
  assert.equal(existsSync(ctl.argsFile), false, '没动作却动了手机');
});

test('回执送不到时重试一次（活跑过了但账上还是执行中，是最危险的失败）', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB, finishStatus: 409 });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir);
  await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path }));
  const fins = api.requests.filter((q) => /\/finish$/.test(q.url));
  assert.equal(fins.length, 2, '回执失败后没重试');
});

test('宿主级互斥：锁在就不跑（一台 Mac 同时只许动一台手机）', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB });
  t.after(() => api.close());
  const lock = join(dir, 'held.d');
  mkdirSync(lock);
  const ctl = makeFakePhoneCtl(dir);
  const r = await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1'] }), phoneCtl: ctl.path, lockDir: lock }));
  assert.equal(r.status, 0);
  assert.equal(api.requests.length, 0, '锁被占着还去认领');
});

test('本机没有在线手机时不认领', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB });
  t.after(() => api.close());
  const ctl = makeFakePhoneCtl(dir);
  const r = await run(makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: [] }), phoneCtl: ctl.path }));
  assert.equal(r.status, 0);
  assert.equal(api.requests.length, 0, '没手机还去认领');
});

test('缺内部 token 时安静跳过，不裸奔发请求', async (t) => {
  const dir = makeTmp();
  const api = await startFakeApi({ job: JOB });
  t.after(() => api.close());
  const conf = join(dir, 'wall.env');
  writeFileSync(conf, `ZJ_API_BASE=${api.url}\n`); // 故意不给 token
  const ctl = makeFakePhoneCtl(dir);
  const r = await runBash(`"$BASH" "${CLAIMER}"`, {
    ...process.env,
    ZJ_CONF: conf, ZJ_ADB: makeFakeAdb(dir, { serials: ['SER1'] }), ZJ_PHONE_CTL: ctl.path,
    ZJ_CLAIMER_LOG: join(dir, 'c.log'), ZJ_CLAIMER_LOCK: join(dir, 'l.d'),
    WALL_REPORT: join(dir, 'nope'), HOME: dir,
  }, { timeoutMs: 20_000 });
  assert.equal(r.status, 0);
  assert.equal(api.requests.length, 0);
});
