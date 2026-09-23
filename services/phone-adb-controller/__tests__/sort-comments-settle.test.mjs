// services/phone-adb-controller/__tests__/sort-comments-settle.test.mjs
//
// 「评论判定通过了，但线索行没建成」这件事到底算不算办完。
//
// ## 0923 真机账本对账：146 条线索是这么没的
//
// 原实现的顺序是——先把池那条标成「已分拣 + 进入最终线索=true」，再去写线索表；
// 写失败只 `console.log("LEAD_FAIL", ...)` 一行就过。
//
// 下一轮扫池的入口是 `if (sv !== "待分拣") continue;`，于是这条**再也不会被扫到**：
// 池子账面上写着"已进入最终线索"，线索表里查无此人，两本账对不上而且没有任何人会发现。
//
// 线上对账（0923，只读统计）：
//
//   | 客户 | 池 进入最终线索=true | 线索表实有 | 对不上 |
//   |---|---|---|---|
//   | 金诺 | 351 | 278 池转入 + 21 重复 | **41** |
//   | 悦升 | 167 | 48 池转入 + 7 重复  | **105** |
//
// 悦升那 105 条集中在 09-16 ~ 09-18（26/42/29），正是 line-routes.js 上线那几天。
// 把其中 3 条原样复刻回写，三条全 code=0 成功——**数据本身没问题，是当时失败后没能重试**。
// 同日真实跑一轮悦升分拣：41 条判定、29 条搬入、0 异常，现役判定链本身是好的。
// 所以要修的不是判定，是"失败之后这条记录还能不能被再捞一次"。
//
// ## 契约
//
// 池状态的推进是**最后一步**，且只在线索真的落地之后才做。
// 线索没落地 → 池保持「待分拣」→ 下一轮自然重试。宁可重判一次（多花一次模型调用），
// 也不能让一条判定通过的线索无声消失。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settlePending } from '../sort-comments-lib.js';

const ROUTE = { key: 'yuesheng', line: '悦升云端', lead: 'tblLEAD', pool: 'tblPOOL' };

/** 造一条池记录 */
const poolRow = (over = {}) => ({
  id: 'recPOOL1',
  fields: {
    评论者昵称: '小小奥',
    用户主页标识: '29428203889 | personal',
    评论原文: '想了解一下企业私有化部署',
    来源视频: '一人公司怎么用 AI',
    评论作品视频链接: '',
    地区: '陕西',
    留言时间: '2026-09-23',
    ...over,
  },
});

/** 记录所有写操作的假飞书 */
function fakeDeps({ leadResult = { code: 0, data: { record: { record_id: 'recLEAD1' } } }, leadThrows = false } = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      putPool: async (recordId, fields) => { calls.push({ op: 'putPool', recordId, fields }); return { code: 0 }; },
      postLead: async (fields) => {
        calls.push({ op: 'postLead', fields });
        if (leadThrows) throw new Error('socket hang up');
        return leadResult;
      },
      putLead: async (recordId, fields) => { calls.push({ op: 'putLead', recordId, fields }); return leadResult; },
    },
  };
}

const baseArgs = (deps, over = {}) => ({
  row: poolRow(),
  verdict: { relevance: '相关', grade: 'A', reason: '明确询问私有化部署' },
  deps,
  route: ROUTE,
  seen: new Map(),
  now: '2026-09-23 11:30(UTC+8)',
  asLeadTime: (_n, v) => v,
  ...over,
});

const poolWrites = (calls) => calls.filter((c) => c.op === 'putPool');
const statusOf = (calls) => poolWrites(calls).map((c) => c.fields['处理状态']);

// ── 核心：失败不许推进池状态 ────────────────────────────────────────────

test('线索表写入失败 → 池绝不能被标「已分拣」（146 条就是这么丢的）', async () => {
  const { deps, calls } = fakeDeps({ leadResult: { code: 1254045, msg: 'FieldNameNotFound' } });
  const r = await settlePending(baseArgs(deps));

  assert.equal(r.moved, 0);
  assert.ok(!statusOf(calls).includes('已分拣'),
    `线索没建成却把池推成「已分拣」，下一轮 sv !== "待分拣" 就再也扫不到它了。实际写了: ${JSON.stringify(statusOf(calls))}`);
  assert.equal(r.retryable, true, '这条必须被标成可重试');
});

test('线索表写入抛异常（网络断） → 同样不许推进池状态', async () => {
  const { deps, calls } = fakeDeps({ leadThrows: true });
  const r = await settlePending(baseArgs(deps));

  assert.equal(r.moved, 0);
  assert.ok(!statusOf(calls).includes('已分拣'),
    'POST 抛异常时池被推进了——夜批网络抖一下就是一条线索永久消失');
  assert.equal(r.retryable, true);
});

test('重复客户高亮写失败 → 也不许推进池状态', async () => {
  // 原实现里 DUP 分支的 PUT 连返回值都不看，hit.id 无效时这条静默消失且 dup 也没加上
  const { deps, calls } = fakeDeps({ leadResult: { code: 1254043, msg: 'RecordIdNotFound' } });
  const seen = new Map([['小小奥', { id: 'recSTALE', dup: 2 }]]);
  const r = await settlePending(baseArgs(deps, { seen }));

  assert.equal(r.duped, 0, '高亮失败却记成已去重');
  assert.ok(!statusOf(calls).includes('已分拣'), '高亮没写成却把池推进了');
  assert.equal(r.retryable, true);
});

// ── 成功路径 ──────────────────────────────────────────────────────────

test('线索建成后才推进池状态，且顺序是「先线索、后池」', async () => {
  const { deps, calls } = fakeDeps();
  const r = await settlePending(baseArgs(deps));

  assert.equal(r.moved, 1);
  const iLead = calls.findIndex((c) => c.op === 'postLead');
  const iDone = calls.findIndex((c) => c.op === 'putPool' && c.fields['处理状态'] === '已分拣');
  assert.ok(iLead >= 0 && iDone > iLead,
    `顺序反了：池必须在线索落地之后才推进（postLead@${iLead} 应早于 已分拣@${iDone}）`);
  assert.equal(calls[iDone].fields['进入最终线索'], true);
});

test('判定不相关 → 一次写完池，不碰线索表', async () => {
  const { deps, calls } = fakeDeps();
  const r = await settlePending(baseArgs(deps, {
    verdict: { relevance: '不相关', grade: '无', reason: '同行推广' },
  }));

  assert.equal(r.moved, 0);
  assert.equal(r.retryable, false, '判定不相关是终态，不该反复重试');
  assert.ok(!calls.some((c) => c.op === 'postLead' || c.op === 'putLead'), '不相关的评论不该碰线索表');
  assert.deepEqual(statusOf(calls), ['已分拣']);
  assert.equal(poolWrites(calls)[0].fields['进入最终线索'], false);
});

test('重复客户高亮成功 → 次数 +1、池推进、不新建行', async () => {
  const { deps, calls } = fakeDeps();
  const seen = new Map([['小小奥', { id: 'recLEADX', dup: 2 }]]);
  const r = await settlePending(baseArgs(deps, { seen }));

  assert.equal(r.duped, 1);
  assert.equal(r.moved, 0);
  assert.ok(!calls.some((c) => c.op === 'postLead'), '重复客户不该新建行');
  assert.equal(calls.find((c) => c.op === 'putLead').fields['重复命中次数'], 3);
  assert.deepEqual(statusOf(calls), ['已分拣']);
});

// ── 客户语义不许写死 ──────────────────────────────────────────────────
//
// 原实现把金诺的业务语义写死在搬运里：
//   "搜索意图": "证书/学习/求职", "目标人群": "考证人群", "关键词层级": "精准词"
// 于是悦升（企业 AI 部署）线索表里每一条都写着"考证人群"——主理人按人群筛选时
// 看到的是另一家客户的标签。隔离点在「活」上，客户语义就得跟着客户走。

test('线索行的客户语义来自 route，不是写死的金诺值', async () => {
  const { deps, calls } = fakeDeps();
  await settlePending(baseArgs(deps, {
    route: { ...ROUTE, intent: '私有化部署/降本', audience: '企业决策者' },
  }));
  const f = calls.find((c) => c.op === 'postLead').fields;

  assert.equal(f['业务线'], '悦升云端');
  assert.equal(f['搜索意图'], '私有化部署/降本');
  assert.equal(f['目标人群'], '企业决策者');
  assert.notEqual(f['目标人群'], '考证人群', '悦升的线索被打上金诺的人群标签');
});

test('route 没配客户语义时留空，绝不回落成金诺的值', async () => {
  const { deps, calls } = fakeDeps();
  await settlePending(baseArgs(deps));
  const f = calls.find((c) => c.op === 'postLead').fields;

  assert.equal(f['搜索意图'], '', `未配就该留空，回落成具体值 = 把一家客户的标签盖到另一家头上: ${f['搜索意图']}`);
  assert.equal(f['目标人群'], '');
});

// ── 判定结果的可观察性 ────────────────────────────────────────────────

test('搬运失败时把原因写回池，别让人对着「待分拣」猜为什么不动', async () => {
  const { deps, calls } = fakeDeps({ leadResult: { code: 1254045, msg: 'FieldNameNotFound' } });
  await settlePending(baseArgs(deps));

  const last = poolWrites(calls).at(-1);
  assert.ok(last, '失败时一次池都没写，卡住的原因无处可查');
  assert.notEqual(last.fields['处理状态'], '已分拣');
  assert.match(String(last.fields['AI判定理由'] || ''), /搬运线索表失败/,
    '失败原因没落到池上，人看到的只是一条一直「待分拣」的记录');
  assert.match(String(last.fields['AI判定理由'] || ''), /1254045|FieldNameNotFound/,
    '没带上飞书的错误码/信息，排查时还得去翻日志');
});

test('纯函数文件：在空目录里 require 得干干净净（判定不许带副作用）', async () => {
  // 跟 keyword-enabled-lib.js 同一条规矩：CI 的 node --test 会 require 它，
  // 顶层读 clawdbot.json / 发飞书请求的文件一 require 就 ENOENT。
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const sandbox = mkdtempSync(`${tmpdir()}/sortlib-`);
  const lib = new URL('../sort-comments-lib.js', import.meta.url).pathname;
  execFileSync(process.execPath,
    ['-e', `const m=require(${JSON.stringify(lib)}); if(typeof m.settlePending!=='function') process.exit(9);`],
    { cwd: sandbox, env: { PATH: process.env.PATH, HOME: sandbox }, stdio: 'pipe' });
});

// ── 接线守卫 ──────────────────────────────────────────────────────────
//
// 上面锁的是 lib「顺序对不对」。但本 bug 的形状是**调用方**把顺序搞反的：
// 把 sort-comments.js 的循环改回「先 PUT 池已分拣、再 POST 线索」，上面 10 条依然全绿。
// 所以必须另外锁住接线本身。

test('接线守卫：sort-comments.js 的搬运必须走 settlePending，不许自己直接写线索表', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../sort-comments.js', import.meta.url).pathname, 'utf8');
  // 只看代码行——注释里正引用旧写法当反面教材，扫全文会被自己绊倒（0922 已栽过一次）
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  assert.match(code, /settlePending\(/, '搬运没走 settlePending —— 顺序保证就回到了调用方自觉');

  // 池状态的推进只能发生在 lib 里。调用方一旦自己写「已分拣」，就绕开了"线索先落地"的保证。
  assert.ok(!/["\u2018\u2019'`]已分拣["\u2018\u2019'`]/.test(code),
    'sort-comments.js 自己写了「已分拣」——池状态的推进必须留在 settlePending 里，' +
    '否则失败路径又会把没搬成的记录推成已分拣，下一轮就再也扫不到了');

  // 建线索行也只能在 lib 里
  assert.ok(!/\/records`,\s*"POST"/.test(code.replace(/\s+/g, ' ')) || /deps:/.test(code),
    '调用方在 settlePending 之外自己 POST 线索表');
});
