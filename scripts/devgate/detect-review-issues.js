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
    || /🔴\s*\*\*严重问题\*\*[\s\S]{0,200}未发现/.test(input)
    // DeepSeek V3 实际输出格式：「🔴 严重问题：\n未发现」（无括号、无 bold）
    || /🔴\s*严重问题\s*[:：][\s\S]{0,100}未发现/.test(input)
    || /🔴\s*严重问题\s*[:：][\s\S]{0,100}无$/m.test(input)
    // DeepSeek V3 另一输出格式：「🔴 严重问题：\n1. 没有发现...」
    || /🔴\s*严重问题\s*[:：][\s\S]{0,200}没有发现/.test(input)
    // DeepSeek V3 inline "no-issue" formats: 🔴 comes BEFORE the negative declaration
    || /🔴\s*未发现严重问题/.test(input)
    || /🔴\s*无严重问题/.test(input)
    || /🔴\s*没有严重问题/.test(input)
    || /🔴\s*没有发现严重问题/.test(input)
    // PR#1527 真实事故：DeepSeek V3 markdown 标题+下一行bullet格式，标题与bullet间无冒号
    // 「#### 🔴 严重问题\n- **无**」——按行匹配，标题行含"严重问题"+🔴，
    // 下一行是仅含"无"/"未发现"的独立 bullet 声明。
    // PR #1528 独立复现同一问题，额外覆盖"没有"这个否定词。
    || /^#{0,6}\s*🔴\s*严重问题\s*$\n+^[-*]\s*\*{0,2}(?:无|未发现|没有)\*{0,2}\s*$/m.test(input)
    // PR#1539 真实事故：DeepSeek V3 用"没有发现以下问题："做总起句，🔴 只是下面的分类
    // bullet 前缀（不是"严重问题"标题），bullet 内容本身是否定句——
    // 「没有发现以下问题：\n- 🔴 没有逻辑问题或安全风险」，之前所有模式都要求
    // 🔴 紧跟"严重问题"或直接跟在否定词前，这个格式两者都不满足。
    || /没有发现以下问题\s*[:：][\s\S]{0,50}🔴\s*没有/.test(input)
    // PR#1768 真实事故（第4次同类复发）：「🔴 无严重逻辑或安全问题」——上面几条否定词模式
    // 都要求"严重"后紧跟"问题"，这次"严重"和"问题"之间插了"逻辑或安全"几个字，全部落空。
    // 泛化成"🔴 紧跟否定词(无/没有/未(发现)?) + 严重 + 任意≤20字 + 问题"，覆盖这一整类否定句
    // 变体（"无严重XX问题"/"没有严重XX问题"/"未发现严重XX问题"），不再逐字面精确匹配。
    || /🔴\s*(?:无|没有|未(?:发现)?)严重[^\n]{0,20}问题/.test(input);

  const textWithoutHeadings = input
    .replace(/#+\s*[^🔴\n]*[（(]🔴[)）][^\n]*/g, '')  // section headings: "### 严重问题 (🔴)"
    .replace(/🔴\s*\*\*[^*\n]+\*\*[^\n]*/g, '')        // inline heading-style: "🔴 **issue**"
    .replace(/[（(]🔴[)）]/g, '');                      // parenthesized backreferences: "修复X（🔴）"
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
