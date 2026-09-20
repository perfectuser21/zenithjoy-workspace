// services/phone-adb-controller/__tests__/wall-smoke-harness.mjs
// smoke 层4：不经 node --test，直接跑推帧器一轮 + 上报器 start/step/done，断言最少请求形状。
// 必须用异步 runBash：假中台与本进程同体，spawnSync 会阻塞事件循环让 curl 永远等不到响应。
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash } from './wall-helpers.mjs';

const PUSH = new URL('../phone-wall-push.sh', import.meta.url).pathname;
const WR = new URL('../wall-report.sh', import.meta.url).pathname;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const die = (m) => { console.error('wall-smoke-harness: ' + m); process.exit(1); };

const dir = makeTmp();
const api = await startFakeApi();
const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
const run = (script, args, timeoutMs) => runBash(`"$BASH" "${script}" ${args.map(q).join(' ')}`, env, { timeoutMs });
const must = async (label, p) => {
  const r = await p;
  if (r.timedOut) die(`${label} 超时未退出`);
  if (r.status !== 0) die(`${label} 退出码 ${r.status}: ${r.stderr}`);
};

await must('推帧器', run(PUSH, [], 20_000));
await must('start', run(WR, ['start', 'SER1', 'smoke', 'a,b'], 15_000));
await must('step', run(WR, ['step', 'SER1', '0', 'doing', '假中台一轮'], 15_000));
await must('done', run(WR, ['done', 'SER1'], 15_000));

const has = (re) => api.requests.some((r) => re.test(r.url));
if (!has(/\/api\/agent\/register$/)) die('无 register');
if (!has(/\/frame$/)) die('无 frame');
if (!has(/\/tasks$/)) die('无 tasks');
if (!has(/\/steps$/)) die('无 steps');
if (!has(/\/complete$/)) die('无 complete');
const frame = api.requests.find((r) => /\/frame$/.test(r.url));
if (frame.headers['content-type'] !== 'image/jpeg' || frame.body.length === 0 || frame.body.length > 122880) die('frame 形状不对');
await api.close();
console.log('wall-smoke-harness: OK');
