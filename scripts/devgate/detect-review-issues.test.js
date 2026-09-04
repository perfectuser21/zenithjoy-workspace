// 真机复现（PR #1528）：detect-review-issues.js 对 DeepSeek V3 输出格式
// "#### 🔴 严重问题\n- **无**"（heading 无括号无冒号，后接独立 bullet）误判为有严重问题，
// 阻塞了一个实际上"未发现严重问题"的 PR 合并。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, 'detect-review-issues.js');

function run(input) {
  try {
    execFileSync('node', [SCRIPT], { input, encoding: 'utf8' });
    return 0;
  } catch (err) {
    return err.status;
  }
}

test('PR #1528 真实 DeepSeek 输出格式：heading 无括号/冒号 + 独立 bullet "**无**" → 不阻塞', () => {
  const input = '#### 🔴 严重问题\n- **无**\n\n#### 🟡 建议优化\n- 一些建议';
  assert.equal(run(input), 0);
});

test('同格式，bullet 是"未发现"而非"无" → 不阻塞', () => {
  const input = '#### 🔴 严重问题\n- **未发现**\n\n#### 🟡 建议优化';
  assert.equal(run(input), 0);
});

test('真实有问题的场景：🔴 后面跟具体问题描述 → 阻塞', () => {
  const input = '#### 🔴 严重问题\n- **SQL 注入风险**：第 42 行拼接用户输入\n\n#### 🟡 建议优化';
  assert.equal(run(input), 1);
});

test('原有格式（括号+冒号）仍然正常识别为无问题', () => {
  const input = '严重问题（🔴）\n- **无**';
  assert.equal(run(input), 0);
});

test('PR #1539 真实 DeepSeek 输出格式："没有发现以下问题：\\n- 🔴 没有..." → 不阻塞', () => {
  const input = '没有发现以下问题：\n- 🔴 没有逻辑问题或安全风险\n- 🟡 没有需要优化的代码质量问题';
  assert.equal(run(input), 0);
});

test('PR #1768 真实事故：bullet 是"🔴 无严重逻辑或安全问题"（无+严重+其他词+问题，无冒号无标题）→ 不阻塞', () => {
  const input = '未发现问题：\n- 🔴 无严重逻辑或安全问题\n- 🟡 无优化建议';
  assert.equal(run(input), 0);
});
