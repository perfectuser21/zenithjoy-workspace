#!/usr/bin/env node
/**
 * lead-quality-gate.test.cjs — Red 骨架（commit-1 先建，此时无实现）
 *
 * 单测覆盖范围：E1-E6（contract-draft.md 定义的验收项）+ 额外边界场景
 * 运行方式：node lead-quality-gate.test.cjs（无外部依赖，Node.js 14+ 内置 assert）
 * 文件使用 .cjs 扩展名以兼容根目录 package.json "type": "module"
 *
 * 注意：本文件是 Red 状态——lead-quality-gate.cjs 尚未实现时运行会报 MODULE_NOT_FOUND，
 * 这是预期的 TDD 红灯，不是测试本身的 bug。
 */

'use strict';

const assert = require('assert');
const path = require('path');

// 尝试引入判定函数（commit-1 时不存在，报错是预期的 Red 状态）
const gatePath = path.resolve(__dirname, '../../../.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
let checkLeadQuality;
try {
  ({ checkLeadQuality } = require(gatePath));
} catch (e) {
  console.error('[RED] lead-quality-gate.cjs 尚未实现，这是预期的 TDD 红灯状态');
  console.error('      实现 lead-quality-gate.cjs 后本测试应全绿。');
  console.error('      错误详情:', e.message);
  process.exit(1);
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ ${name}`);
    console.error(`     ${e.message}`);
    failed++;
  }
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  lead-quality-gate 单测');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// ── E1：干净评论 → PASS ──────────────────────────────────────────────────
test('E1: 干净评论 → passed=true，violations 为空', () => {
  const result = checkLeadQuality([
    { nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'abc123' }
  ]);
  assert.strictEqual(typeof result, 'object', 'result 必须是对象');
  assert.strictEqual(result.passed, true, `passed 应为 true，实际: ${result.passed}`);
  assert.ok(Array.isArray(result.violations), 'violations 必须是数组');
  assert.strictEqual(result.violations.length, 0, `violations 应为空，实际: ${JSON.stringify(result.violations)}`);
});

// ── E2：购物车 UI 文案 → FAIL ──────────────────────────────────────────────
test('E2: 购物车UI文案 → passed=false，reason 含"购物车/推广UI"', () => {
  const result = checkLeadQuality([
    { nickname: '用户A', comment_text: '视频同款及更多好物在橱窗里 详情', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  assert.ok(result.violations.length >= 1, 'violations 不应为空');
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('购物车/推广UI'),
    `violations[0].reason 应含"购物车/推广UI"，实际: "${reason}"`
  );
});

// ── E3：零宽字符混淆日期 → FAIL（验证归一化有效）──────────────────────────
test('E3: 零宽字符混淆日期（04[U+2060]-[U+200B]07）→ passed=false，reason 含"日期格式"', () => {
  // 构造含零宽字符的"04-07"：04 + U+2060 WORD JOINER + - + U+200B ZERO WIDTH SPACE + 07
  const mixedDate = '04⁠-​07';
  const result = checkLeadQuality([
    { nickname: '用户B', comment_text: mixedDate, sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false,
    `passed 应为 false（零宽字符归一化后应命中日期正则），实际: ${result.passed}`);
  assert.ok(result.violations.length >= 1, 'violations 不应为空');
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('日期格式'),
    `violations[0].reason 应含"日期格式"，实际: "${reason}"`
  );
});

// ── E4：零容忍——混合批次（1干净+1垃圾）→ FAIL ────────────────────────────
test('E4: 混合批次（干净+垃圾各1条）→ passed=false（零容忍）', () => {
  const result = checkLeadQuality([
    { nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'abc123' },
    { nickname: '用户C', comment_text: '视频同款及更多好物在橱窗里 详情', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false,
    `批次含垃圾 passed 应为 false（零容忍），实际: ${result.passed}`);
  assert.strictEqual(result.violations.length, 1,
    `violations 应只含垃圾条目（1 条），实际: ${result.violations.length}`);
  assert.strictEqual(result.violations[0].comment_text, '视频同款及更多好物在橱窗里 详情',
    '违规条目应是垃圾那条，不是干净那条');
});

// ── E5：点赞数格式（nickname）→ FAIL ──────────────────────────────────────
test('E5: nickname="1.2万" → passed=false，reason 含"点赞数格式"', () => {
  const result = checkLeadQuality([
    { nickname: '1.2万', comment_text: '正常的评论内容看看房子', sec_uid: 'xxx' }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('点赞数格式'),
    `violations[0].reason 应含"点赞数格式"，实际: "${reason}"`
  );
});

// ── E6：评论数标题 → FAIL ──────────────────────────────────────────────────
test('E6: nickname="共123条评论" → passed=false，reason 含"评论数标题"', () => {
  const result = checkLeadQuality([
    { nickname: '共123条评论', comment_text: '正常的评论内容', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('评论数标题'),
    `violations[0].reason 应含"评论数标题"，实际: "${reason}"`
  );
});

// ── 额外：sec_uid 辅助信号字段存在 ──────────────────────────────────────────
test('辅助: 返回值包含 sec_uid_coverage 字段（0.0～1.0）', () => {
  const result = checkLeadQuality([
    { nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'abc123' },
    { nickname: '用户D', comment_text: '地板很好看', sec_uid: null }
  ]);
  assert.ok('sec_uid_coverage' in result, 'result 应含 sec_uid_coverage 字段');
  const cov = result.sec_uid_coverage;
  assert.ok(typeof cov === 'number' && cov >= 0 && cov <= 1,
    `sec_uid_coverage 应在 0.0-1.0，实际: ${cov}`);
  // 1 个有 sec_uid，1 个 null → coverage = 0.5
  assert.strictEqual(cov, 0.5, `sec_uid_coverage 应为 0.5（1/2），实际: ${cov}`);
});

// ── 额外：排序 tab → FAIL ────────────────────────────────────────────────────
test('额外: nickname="最新" → passed=false，reason 含"排序tab"', () => {
  const result = checkLeadQuality([
    { nickname: '最新', comment_text: '正常评论内容', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('排序tab'),
    `violations[0].reason 应含"排序tab"，实际: "${reason}"`
  );
});

// ── 额外：IP 属地 → FAIL ─────────────────────────────────────────────────────
test('额外: comment_text="IP属地：北京" → passed=false，reason 含"IP属地"', () => {
  const result = checkLeadQuality([
    { nickname: '用户E', comment_text: 'IP属地：北京', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('IP属地'),
    `violations[0].reason 应含"IP属地"，实际: "${reason}"`
  );
});

// ── 额外：日期格式（无零宽字符版）→ FAIL ───────────────────────────────────
test('额外: comment_text="04-07" → passed=false，reason 含"日期格式"', () => {
  const result = checkLeadQuality([
    { nickname: '用户F', comment_text: '04-07', sec_uid: null }
  ]);
  assert.strictEqual(result.passed, false, `passed 应为 false，实际: ${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('日期格式'),
    `violations[0].reason 应含"日期格式"，实际: "${reason}"`
  );
});

// ── 额外：空批次 → PASS（无 lead 不算垃圾）──────────────────────────────────
test('额外: 空批次 → passed=true，violations 为空', () => {
  const result = checkLeadQuality([]);
  assert.strictEqual(result.passed, true, `空批次应 passed=true，实际: ${result.passed}`);
  assert.strictEqual(result.violations.length, 0, 'violations 应为空');
});

// ── 额外：零宽字符归一化覆盖 U+200C/200D/FEFF ────────────────────────────
test('额外: U+200C/200D/FEFF 混淆日期 → passed=false（归一化覆盖完整）', () => {
  // U+200C ZERO WIDTH NON-JOINER + U+200D ZERO WIDTH JOINER + U+FEFF BOM
  const mixedDate2 = '04‌-‍07';
  const mixedDate3 = '04﻿-07';
  const result1 = checkLeadQuality([{ nickname: '用户G', comment_text: mixedDate2, sec_uid: null }]);
  const result2 = checkLeadQuality([{ nickname: '用户H', comment_text: mixedDate3, sec_uid: null }]);
  assert.strictEqual(result1.passed, false, `U+200C/200D 混淆日期应 passed=false，实际: ${result1.passed}`);
  assert.strictEqual(result2.passed, false, `U+FEFF 混淆日期应 passed=false，实际: ${result2.passed}`);
});

// ── 汇总 ─────────────────────────────────────────────────────────────────────
console.log('');
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  结果: ${passed} 通过，${failed} 失败`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log('');

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
