#!/usr/bin/env node
// ============================================================================
// detect-review-issues.js — AI 审查结果严重问题检测器
// ============================================================================
// 从 stdin 读取 AI 代码审查结果文本，检测是否包含🔴严重问题标记。
//
// 使用方式：
//   echo "审查结果" | node scripts/devgate/detect-review-issues.js
//
// 退出码：
//   0 — 未检测到严重问题，PR 可以合并
//   1 — 检测到🔴严重问题，阻塞合并
// ============================================================================

'use strict';

let input = '';

process.stdin.setEncoding('utf8');

process.stdin.on('data', (chunk) => {
  input += chunk;
});

process.stdin.on('end', () => {
  // 检测真实的🔴严重问题标记
  // 排除误报场景：
  //   "严重问题（🔴）" — section heading，🔴 在括号内，不代表有实际问题
  //   "- **无**" — bullet 形式的无问题声明
  // 触发场景（表示有真实问题）：
  //   "🔴 **issue**" — 行内标记的实际问题
  //   "- 🔴" — bullet 列表里的问题标记

  const noIssuesDeclared = /[（(]🔴[)）][\s\S]*?[-*]\s*\*\*无\*\*/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,200}无严重问题/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,100}\*\*无\*\*/.test(input)
    || /严重问题\s*[（(]🔴[)）][\s\S]{0,100}-\s*\*\*无\*\*/.test(input)
    || /🔴\s*\*\*严重问题\*\*[\s\S]{0,200}未发现/.test(input);

  const textWithoutHeadings = input
    .replace(/#+\s*[^🔴\n]*[（(]🔴[)）][^\n]*/g, '')
    .replace(/🔴\s*\*\*[^*\n]+\*\*[^\n]*/g, '');
  const hasActualRedFlag = /🔴/.test(textWithoutHeadings) && !noIssuesDeclared;

  if (hasActualRedFlag) {
    process.stderr.write('[detect-review-issues] 检测到🔴严重问题，阻塞 PR 合并\n');
    process.exit(1);
  } else {
    process.stderr.write('[detect-review-issues] 未检测到严重问题，审查通过\n');
    process.exit(0);
  }
});

process.stdin.on('error', (err) => {
  process.stderr.write(`[detect-review-issues] stdin 读取错误: ${err.message}\n`);
  process.exit(1);
});
