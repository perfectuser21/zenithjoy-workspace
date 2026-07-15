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
// 文件被复制到 smoke/lib/ 后，实现文件在同目录；原 sprint 路径已替换为同目录相对路径
const gatePath = path.resolve(__dirname, './lead-quality-gate.cjs');
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

// ── 回归：ip_location 规则不得误杀真人短评论 ─────────────────────────────────
//
// 2026-07-15 实测：原 re 为 /^(IP属地[:：])?\S{2,6}省?$/ —— `IP属地[:：]` 前缀**可选**，
// 于是该规则实际等于「任何 2-6 个非空白字符的评论正文」，把真人短评论全判违规。
// 「超赞」是库里 胡**v 的**真实评论**（zenithjoy.acquisition_leads 实存）。
// 后果：抓评论修好、lead 全是真人之后，只要有人写句短评论，闸就在**正确数据**上报红 ——
// 守卫在正确数据上报红比没有守卫更糟。
//
// 同时该规则连自己的目标都抓不住：真机 IP 节点文本是 ' · 湖北'（中间有空格，
// 且是独立节点 id=eu6，不在 content 里），`\S{2,6}` 匹配不了整串。
test('回归: 真人短评论「超赞」「好看」不得被 ip_location 误杀', () => {
  const result = checkLeadQuality([
    { nickname: '胡**v', comment_text: '超赞', sec_uid: 'MS4wLjABAAAAxxx' },
    { nickname: '某人', comment_text: '好看', sec_uid: 'MS4wLjABAAAAyyy' },
    { nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'MS4wLjABAAAAzzz' },
  ]);
  assert.strictEqual(
    result.passed,
    true,
    `全真人 lead 必须放行，实际 passed=${result.passed}，误杀: ${JSON.stringify(
      result.violations.map((v) => ({ value: v.value, reason: v.reason }))
    )}`
  );
});

test('回归: ip_location 仍须抓住真机实际格式「· 湖北」与「IP属地：北京」', () => {
  const withDot = checkLeadQuality([
    { nickname: '用户G', comment_text: '· 湖北', sec_uid: null },
  ]);
  assert.strictEqual(withDot.passed, false, '真机格式「· 湖北」应被判违规');
  assert.ok(
    withDot.violations[0].reason.includes('IP属地'),
    `reason 应含"IP属地"，实际: "${withDot.violations[0].reason}"`
  );
});

// ── 回流：2026-07-15 真机实测垃圾（铁律 5 复现判据）─────────────────────────
//
// 这两条是 Seg3 抓评论 bug 真机 dump 里 extractByStructure 实际产出的垃圾
// （fixture: services/agent-android/app/src/test/resources/fixtures/
//   douyin-comment-panel-20260715.xml）：
//   - 商品卡：nickname='客厅多层花架' / comment_text='已售200+'
//   - 博主角标：nickname='波本气泡水' / comment_text='作者'
// 修 ip_location（前缀改必需）之前，「已售200+」是被那条**过宽**规则误打误撞
// 拦下的（reason 竟写"IP属地"）。前缀收紧后它就没规则管了 —— 必须显式建规则，
// 否则闸对本 bug 的真实垃圾反而变松。
test('回流: 商品卡垃圾 nickname="客厅多层花架" comment_text="已售200+" → passed=false', () => {
  const result = checkLeadQuality([
    { nickname: '客厅多层花架', comment_text: '已售200+', sec_uid: null },
  ]);
  assert.strictEqual(result.passed, false, `商品卡必须被拦，实际 passed=${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('商品卡'),
    `violations[0].reason 应含"商品卡"，实际: "${reason}"`
  );
});

test('回流: 博主角标 comment_text="作者" → passed=false', () => {
  const result = checkLeadQuality([
    { nickname: '波本气泡水', comment_text: '作者', sec_uid: null },
  ]);
  assert.strictEqual(result.passed, false, `博主角标必须被拦，实际 passed=${result.passed}`);
  const reason = result.violations[0].reason;
  assert.ok(
    reason.includes('作者角标'),
    `violations[0].reason 应含"作者角标"，实际: "${reason}"`
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
