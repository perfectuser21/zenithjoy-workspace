'use strict';

/**
 * lead-quality-gate.cjs — 抓评论 lead 语义质量闸门
 *
 * 黑名单 6 类正则，零容忍：violations.length >= 1 → passed = false
 * 兼容根目录 package.json "type": "module"（.cjs 扩展名）
 */

// 零宽字符集：U+2060, U+200B, U+200C, U+200D, U+FEFF, U+FFFE
const ZERO_WIDTH_RE = /[⁠​‌‍﻿￾]/g;

/**
 * strip 零宽字符
 * @param {string} str
 * @returns {string}
 */
function stripZeroWidth(str) {
  if (typeof str !== 'string') return '';
  return str.replace(ZERO_WIDTH_RE, '');
}

/**
 * 黑名单规则定义
 * fields: 'both' | 'nickname' | 'comment_text'
 */
const BLACKLIST_RULES = [
  {
    id: 'like_count',
    reason: '点赞数格式',
    fields: 'both',
    re: /^\d+(\.\d+)?[万kK]?\+?$/,
  },
  {
    id: 'comment_count_title',
    reason: '评论数标题',
    fields: 'both',
    re: /^(共)?\d+条评论$/,
  },
  {
    id: 'date_format',
    reason: '日期格式',
    fields: 'both',
    re: /^\d{1,4}-\d{1,2}(-\d{1,2})?$/,
  },
  {
    id: 'sort_tab',
    reason: '排序tab',
    fields: 'both',
    re: /^(最新|最热|置顶)$/,
  },
  {
    id: 'ip_location',
    reason: 'IP属地',
    fields: 'comment_text',
    // 前缀**必需**。原实现把 `IP属地[:：]` 写成可选（`(...)?`），使该规则退化成
    // 「任何 2-6 个非空白字符的评论正文」，把真人短评论（「超赞」「好看」——「超赞」
    // 是 acquisition_leads 里 胡**v 的真实评论）全判违规：抓评论修好后闸会在
    // **正确数据**上报红，比没有守卫更糟。
    // 同时补真机实际格式：UIA dump 里 IP 节点（id=eu6）文本是 ' · 湖北'，
    // 带前导「· 」且含空格，原 `\S{2,6}` 匹配不了整串 —— 该规则连目标都抓不住。
    re: /^(IP属地[:：]\s*|·\s*)\S{2,6}省?$/,
  },
  {
    id: 'shopping_ui',
    reason: '购物车/推广UI',
    fields: 'both',
    re: /(详情|橱窗|同款|更多好物|在橱窗里|立即购买|点击购买)/,
  },
  {
    id: 'product_card',
    reason: '商品卡',
    fields: 'both',
    // 2026-07-15 真机 dump 实测：商品卡被 extractByStructure 配成
    // nickname='客厅多层花架' / comment_text='已售200+' 写进 Lead 表。
    // 「已售N+」是商品卡销量标签，绝不可能是真评论正文。
    re: /^已售\d+(\.\d+)?[万kK]?\+?$/,
  },
  {
    id: 'author_badge',
    reason: '作者角标',
    fields: 'both',
    // 抖音评论区博主本人的「作者」角标（UIA id=eyo）。被相邻配对捞成
    // comment_text='作者' 写进库。真评论正文不会恰好只有「作者」二字。
    re: /^作者$/,
  },
];

/**
 * 检查单个字段值是否命中某条规则
 * @param {string} value - 归一化后的字段值
 * @param {object} rule
 * @param {string} fieldName - 'nickname' | 'comment_text'
 * @returns {boolean}
 */
function matchesRule(value, rule, fieldName) {
  if (rule.fields === 'comment_text' && fieldName !== 'comment_text') return false;
  if (rule.fields === 'nickname' && fieldName !== 'nickname') return false;
  return rule.re.test(value);
}

/**
 * 检查 lead 批次的语义质量
 *
 * @param {Array<{nickname: string, comment_text: string, sec_uid?: string|null, profile_url?: string|null}>} leads
 * @returns {{ passed: boolean, violations: Array<{field: string, value: string, reason: string, comment_text?: string}>, sec_uid_coverage: number, profile_url_coverage: number }}
 */
function checkLeadQuality(leads) {
  if (!Array.isArray(leads) || leads.length === 0) {
    return { passed: true, violations: [], sec_uid_coverage: 0, profile_url_coverage: 0 };
  }

  const violations = [];
  let secUidCount = 0;
  let profileUrlCount = 0;

  for (const lead of leads) {
    const nickname = typeof lead.nickname === 'string' ? lead.nickname : '';
    const commentText = typeof lead.comment_text === 'string' ? lead.comment_text : '';

    // sec_uid 统计（UIA 树不含 sec_uid，预期恒为 0，仅供诊断）
    if (lead.sec_uid) secUidCount++;
    // profile_url 统计：方案A 下无 sec_uid 时应回退为昵称，覆盖率应为 100%
    if (lead.profile_url) profileUrlCount++;

    const normalizedNickname = stripZeroWidth(nickname);
    const normalizedComment = stripZeroWidth(commentText);

    let leadViolated = false;

    for (const rule of BLACKLIST_RULES) {
      // 检查 nickname
      if (!leadViolated && (rule.fields === 'both' || rule.fields === 'nickname')) {
        if (matchesRule(normalizedNickname, rule, 'nickname')) {
          violations.push({
            field: 'nickname',
            value: nickname,
            reason: rule.reason,
            comment_text: commentText,
          });
          leadViolated = true;
          continue;
        }
      }
      // 检查 comment_text
      if (!leadViolated && (rule.fields === 'both' || rule.fields === 'comment_text')) {
        if (matchesRule(normalizedComment, rule, 'comment_text')) {
          violations.push({
            field: 'comment_text',
            value: commentText,
            reason: rule.reason,
            comment_text: commentText,
          });
          leadViolated = true;
        }
      }
    }
  }

  const secUidCoverage = leads.length > 0 ? secUidCount / leads.length : 0;
  const profileUrlCoverage = leads.length > 0 ? profileUrlCount / leads.length : 0;

  return {
    passed: violations.length === 0,
    violations,
    sec_uid_coverage: secUidCoverage,
    profile_url_coverage: profileUrlCoverage,
  };
}

module.exports = { checkLeadQuality };
