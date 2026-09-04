/**
 * detect-review-issues.test.js — AI 审查🔴严重问题检测器单测
 *
 * 运行: node --test scripts/devgate/__tests__/detect-review-issues.test.js
 *
 * PR #1527 真实事故：DeepSeek V3 审查结果里 "#### 🔴 严重问题\n- **无**"（markdown
 * 四级标题+下一行bullet声明"无"，标题和bullet之间没有冒号）没被现有12条正则任何一条
 * 覆盖，误判为"检测到严重问题"，拦下一个纯CSS修复的PR。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../detect-review-issues.js');

function run(input) {
  return spawnSync('node', [SCRIPT], { input, encoding: 'utf8' });
}

test('PR#1527真实事故复现：DeepSeek "#### 🔴 严重问题\\n- **无**" 格式不应判为有问题', () => {
  const review = [
    '### 代码审查结果',
    '',
    '#### 🔴 严重问题',
    '- **无**',
    '',
    '### 总结',
    '代码质量良好',
  ].join('\n');
  const result = run(review);
  assert.equal(result.status, 0, `应判定通过(exit 0)，实际 exit ${result.status}: ${result.stderr}`);
});

test('真实🔴问题标记(bullet内联，非标题)应正确拦截', () => {
  const review = [
    '#### 🔴 严重问题',
    '- 🔴 SQL 注入风险：用户输入未转义直接拼进查询',
  ].join('\n');
  const result = run(review);
  assert.equal(result.status, 1, 'bullet内的真实问题应判定为FAIL(exit 1)');
});

test('已有的"🔴 严重问题：未发现"格式继续判定通过（不回归）', () => {
  const review = '🔴 严重问题：未发现';
  const result = run(review);
  assert.equal(result.status, 0);
});

test('PR#1539真实事故复现：DeepSeek "没有发现以下问题：\\n- 🔴 没有..." 格式不应判为有问题', () => {
  const review = [
    '这是一个简单的版本号更新变更，我来进行审查：',
    '',
    '🟢 正面反馈：',
    '- 版本号更新符合语义化版本规范',
    '',
    '没有发现以下问题：',
    '- 🔴 没有逻辑问题或安全风险',
    '- 🟡 没有需要优化的代码质量问题',
    '',
    '代码质量良好，变更简单明确。',
  ].join('\n');
  const result = run(review);
  assert.equal(result.status, 0, `应判定通过(exit 0)，实际 exit ${result.status}: ${result.stderr}`);
});

test('PR#1768真实事故复现：DeepSeek "未发现问题：\\n- 🔴 无严重逻辑或安全问题" 格式不应判为有问题', () => {
  const review = [
    '这是一个简单的版本号更新变更，我来进行审查：',
    '',
    '🟢 正面反馈：',
    '- 版本号更新符合语义化版本规范',
    '',
    '未发现问题：',
    '- 🔴 无严重逻辑或安全问题',
    '- 🟡 无优化建议',
  ].join('\n');
  const result = run(review);
  assert.equal(result.status, 0, `应判定通过(exit 0)，实际 exit ${result.status}: ${result.stderr}`);
});
