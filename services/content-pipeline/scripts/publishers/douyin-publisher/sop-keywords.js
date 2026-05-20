'use strict';

/**
 * 抖音对标 SOP 关键词配置
 * 三轮固定关键词，用于账号筛选和视频筛选两个 SOP
 */

const KEYWORD_ROUNDS = [
  {
    round: 1,
    label: '一人创业/个人IP',
    keywords: [
      '一人公司',
      '一人创业',
      '个人IP',
      '轻创业',
      '个人品牌',
      '小团队创业',
    ],
  },
  {
    round: 2,
    label: 'AI工具/智能体',
    keywords: [
      'AI员工',
      'AI智能体',
      '智能体',
      'AI助理',
      'AI秘书',
      'AI团队',
      'AI自动化',
      'AI文案',
      'AI脚本',
      'AI选题',
    ],
  },
  {
    round: 3,
    label: '获客/私域运营',
    keywords: [
      '获客',
      '引流',
      '转化',
      '成交',
      '私域运营',
      '社群运营',
      '朋友圈',
      'SOP',
      '模板',
      '工具包',
      '训练营',
      '陪跑',
      '咨询',
    ],
  },
];

/**
 * 获取所有关键词（扁平化，附带 round 信息）
 * @returns {{ round: number, label: string, keyword: string }[]}
 */
function getAllKeywordsFlat() {
  return KEYWORD_ROUNDS.flatMap(r =>
    r.keywords.map(keyword => ({ round: r.round, label: r.label, keyword }))
  );
}

/**
 * 按轮次获取关键词列表
 * @param {number} round 1 | 2 | 3
 * @returns {string[]}
 */
function getKeywordsByRound(round) {
  const r = KEYWORD_ROUNDS.find(x => x.round === round);
  return r ? r.keywords : [];
}

module.exports = { KEYWORD_ROUNDS, getAllKeywordsFlat, getKeywordsByRound };
