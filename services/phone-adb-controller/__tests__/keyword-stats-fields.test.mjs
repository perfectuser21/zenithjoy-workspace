// services/phone-adb-controller/__tests__/keyword-stats-fields.test.mjs
//
// 关键词效果回写的字段构造：列是什么类型，就得写什么类型的值。
//
// ## 0923 实证：悦升 35 个词的效果统计一次都没有过
//
//   | 客户 | 最后测试时间 | 有效线索数 | 搜索视频数 | 最近效果 |
//   |---|---|---|---|---|
//   | 金诺 | 39 行有值 | 2 | 29 | 52 |
//   | 悦升 | **0** | **0** | **0** | **0** |
//
// 这里有**两层**，得分清楚：
//
// 第一层（悦升当前 0 值的真因）：update-keyword-stats.js 把 base/table/account
// 全部写死成金诺，连 line-routes.js 都没 require——0916 那次「按业务线路由」改了
// 四个写库脚本，**漏了这一个**。所以悦升的效果回写从来就没跑过，不是写失败。
//
// 第二层（接上悦升之后必然撞的）：这个脚本写的是
// `"最后测试时间": "2026-09-23 12:00(UTC+8)"`（文本字符串），而悦升那列是 type 5（日期）。
// 飞书对类型不符是**整条记录写入失败**（DatetimeFieldConvFail），不是跳过那一列——
// 「有效线索数」这些本来没问题的列也会跟着一起写不进去。
//
// push-raw-comments.js 和 sort-comments.js 早在 0916 就各自写了一份 `asTime` 自适应
// （踩的就是第二层这个坑），唯独这个脚本一处都没有。
//
// 只修第二层 = 悦升照样一个数都没有；只修第一层 = 接通当晚整批写失败。两层都得修。
//
// ## 还有一个：自建行的「是否启用」写死了"是"
//
// 悦升那一列是单选，选项只有 [启用|停用]，没有"是"。飞书对单选未知值会**自动新增选项**
// （实测 code=0 成功），于是每次自建行都在往客户的下拉框里塞垃圾——
// 悦升线索表的「合规核验状态」已经被这么污染过一次，选项里躺着一整段带时间戳的日志文本。
//
// 所以新建行时该写什么，要看那一列现在长什么样：单选就从已有选项里挑一个「表示启用」的，
// 挑不出来再退回文本"是"。判定复用 keyword-enabled-lib.js，不另造一套同义词表。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatFields, enabledValueFor, tallyFromPool } from '../keyword-stats-lib.js';

const STAT = { leads: 3, dup: 1, comments: 40, videos: 5 };
const NOW = '2026-09-23 12:00(UTC+8)';

/** 金诺：所有列都是文本 */
const JINUO_TYPES = {
  抖音获客关键词配置: 1, 是否启用: 1, 最后测试时间: 1,
  有效线索数: 2, 重复线索数: 2, 查看评论数: 2, 搜索视频数: 2, 最近效果: 1,
};
/** 悦升：最后测试时间是日期型，是否启用是单选 */
const YUESHENG_TYPES = { ...JINUO_TYPES, 最后测试时间: 5, 是否启用: 3 };

// ── 时间列按类型走 ──────────────────────────────────────────────────────

test('日期型的「最后测试时间」必须写时间戳，不是文本（悦升 35 词全灭的原因）', () => {
  const f = buildStatFields({ stat: STAT, now: NOW, fieldTypes: YUESHENG_TYPES, stamp: true });
  assert.equal(typeof f['最后测试时间'], 'number',
    `日期列写了文本 → 飞书 DatetimeFieldConvFail，整条 PUT 失败，连「有效线索数」都跟着写不进去。实际: ${JSON.stringify(f['最后测试时间'])}`);
  assert.ok(f['最后测试时间'] > 1e12, '时间戳得是毫秒');
});

test('文本型的「最后测试时间」照旧写文本（金诺在用，别改坏）', () => {
  const f = buildStatFields({ stat: STAT, now: NOW, fieldTypes: JINUO_TYPES, stamp: true });
  assert.equal(f['最后测试时间'], NOW);
});

test('字段类型读不到时（接口挂了）按文本写，跟改之前一个样', () => {
  const f = buildStatFields({ stat: STAT, now: NOW, fieldTypes: {}, stamp: true });
  assert.equal(f['最后测试时间'], NOW, '读不到类型就该退回原行为，不能自作主张写时间戳');
});

test('本轮没跑过这个词 → 不打时间戳，其余照写', () => {
  const f = buildStatFields({ stat: STAT, now: NOW, fieldTypes: YUESHENG_TYPES, stamp: false });
  assert.ok(!('最后测试时间' in f), '没跑过的词不该被刷新时间戳');
  assert.equal(f['有效线索数'], 3);
});

test('四个计数列和最近效果照常写', () => {
  const f = buildStatFields({ stat: STAT, now: NOW, fieldTypes: YUESHENG_TYPES, stamp: true });
  assert.equal(f['有效线索数'], 3);
  assert.equal(f['重复线索数'], 1);
  assert.equal(f['查看评论数'], 40);
  assert.equal(f['搜索视频数'], 5);
  assert.match(f['最近效果'], /线索3\(重现1\)\/评论40\/视频5/);
});

// ── 自建行的「是否启用」 ────────────────────────────────────────────────

test('单选列：从已有选项里挑一个表示启用的，不硬塞"是"', () => {
  // 悦升实况：选项只有 [启用|停用]
  const v = enabledValueFor({ type: 3, options: ['启用', '停用'] });
  assert.equal(v, '启用',
    '往单选里写选项外的值，飞书会自动新增一个选项——客户的下拉框会被我们一点点塞满垃圾');
});

test('单选列有多个启用类选项 → 取第一个，结果是确定的', () => {
  assert.equal(enabledValueFor({ type: 3, options: ['是', '启用', '否'] }), '是');
  assert.equal(enabledValueFor({ type: 3, options: ['开启', '是', '停'] }), '开启');
});

test('单选列一个启用类选项都没有 → 退回"是"，别静默写个关掉的值', () => {
  const v = enabledValueFor({ type: 3, options: ['停用', '暂停'] });
  assert.equal(v, '是', `挑不出启用值时宁可新增一个选项，也不能写"停用"——那等于把词关掉: ${v}`);
});

test('文本列 → 照旧写"是"', () => {
  assert.equal(enabledValueFor({ type: 1, options: [] }), '是');
  assert.equal(enabledValueFor(undefined), '是', '类型读不到时也得有确定行为');
});

test('启用判定复用 keyword-enabled-lib，不另造一套同义词表', async () => {
  const { isKeywordEnabled } = await import('../keyword-enabled-lib.js');
  // 两边对同一批值的判断必须一致，否则选词和建行会各认各的
  for (const v of ['是', '启用', '开启', '否', '停用', '暂停']) {
    const picked = enabledValueFor({ type: 3, options: [v] });
    assert.equal(picked === v, isKeywordEnabled(v),
      `「${v}」在两处的判断不一致：挑中=${picked === v}，isKeywordEnabled=${isKeywordEnabled(v)}`);
  }
});

test('纯函数文件：在空目录里 require 得干干净净', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const sandbox = mkdtempSync(`${tmpdir()}/kwstats-`);
  const lib = new URL('../keyword-stats-lib.js', import.meta.url).pathname;
  execFileSync(process.execPath,
    ['-e', `const m=require(${JSON.stringify(lib)}); if(typeof m.buildStatFields!=='function') process.exit(9);`],
    { cwd: sandbox, env: { PATH: process.env.PATH, HOME: sandbox }, stdio: 'pipe' });
});

// ── 接线守卫 ──────────────────────────────────────────────────────────

test('接线守卫：update-keyword-stats.js 必须真的读字段类型并走 lib', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../update-keyword-stats.js', import.meta.url).pathname, 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');

  // 第一层：必须按业务线路由，不能再写死金诺
  assert.match(code, /line-routes/,
    'update-keyword-stats.js 还在写死 base/table —— 0916「按业务线路由」漏改的就是它，' +
    '悦升的效果回写因此从来没跑过（关键词表四列全 0）');
  assert.ok(!/const B = "GN[A-Za-z0-9]+"/.test(code),
    '金诺的 base 仍被写死在代码里');

  // 第二层：必须读字段类型
  assert.match(code, /\/fields\?page_size/,
    '没去读关键词表的字段类型 —— 接通悦升当晚那条日期列就会把整批写入打回');
  assert.match(code, /buildStatFields/, '字段构造没走 lib');
  assert.match(code, /enabledValueFor/, '自建行的「是否启用」还是写死值');
  assert.ok(!/"最后测试时间":\s*now/.test(code),
    'update-keyword-stats.js 仍在直接把文本 now 写进「最后测试时间」——正是悦升全灭的那一行');
});

// ── 有效线索数从哪儿数 ────────────────────────────────────────────────
//
// 0923 实测第三层：`update-keyword-stats.js` 按 `线索表.fields["命中关键词"]` 统计
// 有效线索数，而**两家的线索表都没有这一列**（各 34 列，逐列查过）。于是
// `if (!kw) return;` 每次都命中，有效线索数/重复线索数永远是 0——金诺 58 行里只有
// 2 行有值，那 2 行是人手填的。评论池和视频池有这列，所以「查看评论数」「搜索视频数」
// 一直是对的，只有这两个数是死的。
//
// 修法不动客户的表结构（给线索表加列要在每个 base 各建一次，老数据还没有）：
// 线索本来就是从池里搬过去的，池里「进入最终线索=true」就是有效线索的定义。
// PR #1961 之后两本账已经对平（孤儿 0），这么数是准的。

const poolRow = (kw, keep, nick) => ({ fields: { 命中关键词: kw, 进入最终线索: keep, 评论者昵称: nick } });

test('有效线索数 = 池里该词「进入最终线索=true」的条数', () => {
  const t = tallyFromPool([
    poolRow('AI获客', true, 'a'), poolRow('AI获客', true, 'b'),
    poolRow('AI获客', false, 'c'), poolRow('数字员工', true, 'd'),
  ]);
  assert.equal(t['AI获客'].leads, 2, '判定不通过的也被算成线索了');
  assert.equal(t['数字员工'].leads, 1);
});

test('查看评论数 = 该词下池里的全部条数（不看判定结果）', () => {
  const t = tallyFromPool([
    poolRow('AI获客', true, 'a'), poolRow('AI获客', false, 'b'), poolRow('AI获客', false, 'c'),
  ]);
  assert.equal(t['AI获客'].comments, 3);
});

test('重复线索数 = 同一个词下同一个人再次出现的次数（重复是强意向，不是噪音）', () => {
  const t = tallyFromPool([
    poolRow('AI获客', true, '小明'), poolRow('AI获客', true, '小明'), poolRow('AI获客', true, '小明'),
    poolRow('AI获客', true, '小红'),
  ]);
  assert.equal(t['AI获客'].leads, 4, '重复的也是有效线索，别少算');
  assert.equal(t['AI获客'].dup, 2, '小明出现 3 次 = 重复 2 次');
});

test('跨词不算重复：同一个人在两个词下各出现一次', () => {
  const t = tallyFromPool([poolRow('AI获客', true, '小明'), poolRow('数字员工', true, '小明')]);
  assert.equal(t['AI获客'].dup, 0);
  assert.equal(t['数字员工'].dup, 0);
});

test('命中关键词为空的行直接跳过，不产生「(空)」这种词', () => {
  const t = tallyFromPool([poolRow('', true, 'a'), poolRow(null, true, 'b'), poolRow('AI获客', true, 'c')]);
  assert.deepEqual(Object.keys(t), ['AI获客']);
});

test('接线守卫：leads 不许再从线索表的「命中关键词」数（那列根本不存在）', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../update-keyword-stats.js', import.meta.url).pathname, 'utf8');
  const code = src.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  assert.match(code, /tallyFromPool/, '有效线索数没走 tallyFromPool');
  assert.ok(!/for \(const r of leads\)/.test(code),
    '还在遍历线索表统计关键词 —— 线索表没有「命中关键词」列，数出来永远是 0');
});
