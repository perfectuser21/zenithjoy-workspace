// services/phone-adb-controller/__tests__/keyword-enabled.test.mjs
//
// 「这个词要不要跑」的判定。
//
// 0923 真机实测两家「是否启用」列的实际填法：
//   金诺 58 条：是 37 / 启用 9 / 暂停 7 / 否 5
//   悦升 35 条：启用 35
// 而取词器写死 `k.enabled === "是"` —— 填「启用」的一律被静默过滤掉。
//
// 实测取词数（同一份表，只换判定）：
//   金诺 31 → 40  （+9，那 9 条填「启用」的被埋了）
//   悦升 19 → 19  （它那 35 条另有 biz 字段不匹配的问题，与本判定无关）
//
// 被埋掉不报错：日志只显示"本批取 N 词"，没有任何东西指出有词因写法被过滤。
//
// 根子上是：这一列是**人手填的自由文本**，中文里"开着"有太多种写法。
// 判定必须认这一类说法，而不是精确匹配某一个字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { isKeywordEnabled } = require_('../keyword-enabled-lib.js');

test('金诺现在填的「是」要认', () => {
  assert.equal(isKeywordEnabled('是'), true);
});

test('「启用」也要认——金诺有 9 条这么填的，一直被静默埋掉', () => {
  assert.equal(isKeywordEnabled('启用'), true);
});

test('其它常见的「开着」写法都认', () => {
  for (const v of ['开', '开启', 'Y', 'y', 'yes', 'YES', 'true', 'TRUE', '1', '✅']) {
    assert.equal(isKeywordEnabled(v), true, `「${v}」应该算启用`);
  }
});

test('明确关掉的一律不跑', () => {
  for (const v of ['否', '停', '暂停', '关', '关闭', 'N', 'no', 'false', '0', '']) {
    assert.equal(isKeywordEnabled(v), false, `「${v}」不该被当成启用`);
  }
});

test('空值/未填不跑——没表态就别动客户的号', () => {
  // 宁可漏跑一个词，也不能因为某人忘了填就去真发私信。
  for (const v of [undefined, null, '   ']) {
    assert.equal(isKeywordEnabled(v), false);
  }
});

test('前后空格和大小写不影响判定（手填必然带空格）', () => {
  assert.equal(isKeywordEnabled('  是  '), true);
  assert.equal(isKeywordEnabled(' 启用\t'), true);
  assert.equal(isKeywordEnabled(' Yes '), true);
});

test('「暂停」绝不能被当成启用——哪怕将来改成宽松匹配', () => {
  // 金诺表里真有 3 条填的是「暂停」，误判会让停掉的词重新开跑、去真发私信。
  //
  // 白名单实现下这条本来是废的（"暂停"本就不在白名单里，变异实测零报红）。
  // 真正的风险是将来有人嫌白名单不够灵活，改成"含『启』就算启用"之类的宽松匹配
  // ——那时「暂停」不会中招，但「暂停启用」「已暂停」这类写法会。
  // 所以这里连同**含启用字样但语义是关掉**的几种写法一起钉住。
  for (const v of ['暂停', '暂停启用', '已暂停', '停用', '暂不启用', '未启用']) {
    assert.equal(isKeywordEnabled(v), false, `「${v}」语义是关掉，不能放它跑`);
  }
});
