// services/phone-adb-controller/__tests__/keyword-enabled.test.mjs
//
// 「这个词要不要跑」的判定。
//
// 0923 实测：悦升的关键词配置表 35 条词，「是否启用」列填的是 **"启用"**，
// 而取词器写死只认 **"是"** —— 一条都选不出来，**悦升的夜批一直在空跑**，
// 而且不报错、日志里只是"本批取 0 词"，没人看得出来。
// 金诺那边填的是「是/否/暂停」，能对上，所以只有悦升受影响。
//
// 根子上是：这一列是**人手填的自由文本**，中文里"开着"有太多种写法。
// 判定必须认这一类说法，而不是精确匹配某一个字。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { isKeywordEnabled } = require_('../next-keywords.js');

test('金诺现在填的「是」要认', () => {
  assert.equal(isKeywordEnabled('是'), true);
});

test('悦升现在填的「启用」也要认——就是它让悦升夜批空跑的', () => {
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

test('「暂停」绝不能被当成启用——它跟「停」一样是关掉', () => {
  // 金诺表里真有 3 条填的是「暂停」，误判会让停掉的词重新开跑。
  assert.equal(isKeywordEnabled('暂停'), false);
});
