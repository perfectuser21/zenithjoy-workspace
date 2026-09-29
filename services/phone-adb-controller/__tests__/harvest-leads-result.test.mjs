// 0929 采收结果带线索数回归测试。
// 事故：harvest-cron 收尾 `wr done` 从不带线索数，0 条线索的批次（auto09270230「批完成: 0」）与出 42 条的批次
// 在工作机页 / Brain 上都是同一个 completed，运营无从分辨"跑完了但白跑"。
// 修法：wall-report `done <目标> [leads]` 把本批 LEAD 数作为 evidence.leads 上报；服务端据此标 zero_leads。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, runBash } from './wall-helpers.mjs';

const WR = new URL('../wall-report.sh', import.meta.url).pathname;
const HC = new URL('../harvest-cron.sh', import.meta.url).pathname;
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const wr = (env, ...args) => runBash(`"$BASH" "${WR}" ${args.map(q).join(' ')}`, env, { timeoutMs: 15_000 });

async function setup(t) {
  const dir = makeTmp();
  const api = await startFakeApi();
  t.after(() => api.close());
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  return { api, env };
}
const completeBody = (api) => JSON.parse(api.requests.find((r) => /\/complete$/.test(r.url)).body.toString());

test('wall-report done <目标> 7 → complete 带 evidence.leads=7', async (t) => {
  const { api, env } = await setup(t);
  await wr(env, 'start', 'SER1', '获客采收·AI', 'a,b');
  await wr(env, 'done', 'SER1', '7');
  assert.deepEqual(completeBody(api), { outcome: 'completed', executor_id: 'adb-wall', evidence: { leads: 7 } });
});

test('wall-report done <目标> 0 → evidence.leads=0（零线索也要显式上报，不能省略）', async (t) => {
  const { api, env } = await setup(t);
  await wr(env, 'start', 'SER1', 't', 'a');
  await wr(env, 'done', 'SER1', '0');
  assert.deepEqual(completeBody(api).evidence, { leads: 0 });
});

test('wall-report done 线索数非数字 → 不带 evidence（宁缺勿错）', async (t) => {
  const { api, env } = await setup(t);
  await wr(env, 'start', 'SER1', 't', 'a');
  await wr(env, 'done', 'SER1', 'abc');
  assert.deepEqual(completeBody(api), { outcome: 'completed', executor_id: 'adb-wall' });
});

test('接线守卫：harvest-cron 采收收尾把本批 LEAD 数传给 wr done', () => {
  const src = readFileSync(HC, 'utf8');
  assert.match(src, /NLEAD=\$\(grep -c '\^LEAD' ~\/night-\$TAG\.tsv/, '必须统计本批 night-$TAG.tsv 的 LEAD 行');
  // `grep -c ... || echo 0` 在 0 命中时会输出 "0\n0"（grep -c 本身已打印 0 且退出 1），上报就成了非法值
  assert.doesNotMatch(src, /NLEAD=\$\(grep -c[^)]*\|\| echo 0\)/);
  const last = src.trimEnd().split('\n').pop();
  assert.equal(last, 'wr done "$SERIAL" "$NLEAD"', '采收主路径的最后一步 done 必须带线索数');
});
