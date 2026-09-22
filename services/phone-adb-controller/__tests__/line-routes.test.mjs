// services/phone-adb-controller/__tests__/line-routes.test.mjs
//
// 回填路由：一批采收的产出该写进谁的飞书表。
//
// 0922 主理人定的模型：**隔离点在「活」上，不在「机器」上**。
//   「其实我们不应该绑手机⋯⋯只是回填数据的时候看用哪一套信号走。
//     生产要求你生产回填哪，研发要求你研发回填哪，这两个不一样。」
//
// 原实现按 profile（手机）路由，两个后果：
//   1. 一台手机只能服务一个租户——生产排满了想拿研发机顶上，做不到；
//   2. **认不出的 profile 一律兜底倒进金诺**（ROUTES[0]），美其名曰"避免静默丢数据"，
//      实际是静默污染别人的库。小彩(xiaolongxia)就不在任何 route 里，
//      它一旦开跑，悦升研发机的数据会全部写进金诺生产表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { routeOf, isFallback, ROUTES, devBatchTag } = require_('../line-routes.js');

test('按业务线名路由（活自己带的标记）', () => {
  assert.equal(routeOf('AI人工智能训练师').key, 'jinuo');
  assert.equal(routeOf('悦升云端').key, 'yuesheng');
});

test('按 key 路由', () => {
  assert.equal(routeOf('jinuo').key, 'jinuo');
  assert.equal(routeOf('yuesheng').key, 'yuesheng');
});

test('历史用法：按 profile 名路由仍然认（夜批还在这么传）', () => {
  // 不能一刀切断——夜批 batch2.sh 现在传的就是 profile 名。
  assert.equal(routeOf('jinoshengyuan-work').key, 'jinuo');
  assert.equal(routeOf('yueshengyun-work').key, 'yuesheng');
});

test('认不出的标记必须拒收，不能兜底倒进金诺', () => {
  // 这是本次要改的核心：旧实现 return ROUTES[0]，把认不出的数据全塞给金诺。
  // 「避免静默丢数据」的初衷是对的，但代价是静默污染别人的库——
  // 抛错更安全：数据不会丢（脚本会红、人看得见），也不会写错地方。
  assert.throws(() => routeOf('xiaolongxia'), /未配路由|unknown route/,
    'xiaolongxia 不在任何 route 里，却被兜底倒进金诺——悦升研发机会污染金诺生产表');
  assert.throws(() => routeOf('某个没见过的标记'), /未配路由|unknown route/);
});

test('空标记也拒收，不猜', () => {
  assert.throws(() => routeOf(''), /未配路由|unknown route/);
  assert.throws(() => routeOf(undefined), /未配路由|unknown route/);
});

// ── 研发是标签，不是客户（主理人 0922 纠正）──────────────────────────────
// 「金诺是一个客户表，悦升云端也是个客户表。研发只是个标签呀。
//   金诺的研发就在金诺里面，悦升的研发就在悦升里面。
//   你这个活标记应该就是客户嘛。」
//
// 上一版把 dev 做成与 jinuo/yuesheng 并列的第三条路由、base=null，
// 等于①把研发变成第三个客户 ②金诺的研发活数据直接丢失、无处可查。

test('路由表里只有客户，没有 dev——研发不是客户', () => {
  const keys = ROUTES.map((r) => r.key);
  assert.ok(!keys.includes('dev'), 'dev 还在路由表里当客户站着');
  assert.deepEqual(keys.sort(), ['jinuo', 'yuesheng']);
});

test('每条客户路由都必须有 base——没有"不落库的客户"这种东西', () => {
  for (const r of ROUTES) {
    assert.ok(r.base, `${r.key} 没有 base：数据会静默丢失，无处可查`);
    assert.ok(r.lead, `${r.key} 没有线索表`);
  }
});

test('研发活照样落到它所属客户的库里', () => {
  // 金诺的研发活 → 金诺的 base；悦升的研发活 → 悦升的 base。不是丢掉。
  const jinuo = routeOf('AI人工智能训练师');
  const yue = routeOf('悦升云端');
  assert.equal(routeOf('AI人工智能训练师', { dev: true }).base, jinuo.base);
  assert.equal(routeOf('悦升云端', { dev: true }).base, yue.base);
});

test('研发是正交的标签：同一个客户，标签变了路由不变', () => {
  assert.equal(routeOf('jinuo').base, routeOf('jinuo', { dev: true }).base);
});

test('标签落到线索表已有的「实验批次」列，不新造字段', () => {
  // 两个客户库结构一致、都有这一列（0922 实测各 34 列），复用即可。
  assert.equal(devBatchTag(true), '研发');
  assert.equal(devBatchTag(false), '');
});

test('isFallback 退场：不再有 fallback 这回事', () => {
  // 保留导出以免调用方炸，但语义改成"永远 false"——因为已经不存在兜底了。
  assert.equal(isFallback('xiaolongxia'), false);
  assert.equal(isFallback('AI人工智能训练师'), false);
});

// ── 接线守卫 ──────────────────────────────────────────────────────────────
// 路由拒收未知标记之后，调用方就不能再传空值了。0922 实测：harvest-keyword.sh
// 写的是 LINE="${6:-}"，而 batch2.sh 只传 5 个参数——$LINE 一直是空的，
// 被旧兜底默默接成金诺。后果：**悦升那台跑夜批时，去重查的是金诺的已采视频列表**，
// 去重一直是错的，而且没人看得见。
import { readFileSync } from 'node:fs';

test('接线守卫：采收脚本必须给出真实的回填标记，不能传空', () => {
  // 只看代码行：注释里会引用旧写法当反面教材，连注释一起扫会把自己绊倒（第一版就是）。
  const hk = readFileSync(new URL('../harvest-keyword.sh', import.meta.url), 'utf8')
    .split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.ok(!/LINE="\$\{6:-\}"/.test(hk),
    'harvest-keyword.sh 又把 LINE 缺省成空值了——空值会被路由拒收，整条采收链会红');
  assert.match(hk, /LINE="\$\{6:-\$P\}"/,
    'LINE 缺省应退回 profile 名（profile 也能路由），而不是空');
});

test('接线守卫：batch2 要把回填标记透传给采收与落池', () => {
  const b2 = readFileSync(new URL('../batch2.sh', import.meta.url), 'utf8');
  assert.match(b2, /LINE="\$\{6:-\$P\}"/, 'batch2 没有接收业务线标记');
  assert.match(b2, /harvest-keyword\.sh[^\n]*"\$LINE"/, '没把标记透传给 harvest-keyword');
  assert.match(b2, /push-videos\.js[^\n]*\$LINE/, '落池仍按 profile 路由，没用标记');
  assert.match(b2, /push-raw-comments\.js[^\n]*\$LINE/, '评论池仍按 profile 路由');
  assert.ok(!/push-videos\.js \/tmp\/\$TAG\.tsv \$TAG \$P\b/.test(b2),
    '落池还在传 profile——回填就还是绑在机器上，不是绑在活上');
});
