// keyword-stats-lib.js —— 关键词效果回写的字段构造（按目标列的真实类型走）
//
// 0923 实证：悦升 35 个词的效果统计从来没写成功过一次。
//
//   | 客户 | 最后测试时间 | 有效线索数 | 搜索视频数 | 最近效果 |
//   |---|---|---|---|---|
//   | 金诺（列全是文本） | 39 行有值 | 2 | 29 | 52 |
//   | 悦升（最后测试时间是日期型） | 0 | 0 | 0 | 0 |
//
// update-keyword-stats.js 写的是文本字符串 `"2026-09-23 12:00(UTC+8)"`，而悦升那列是
// type 5（日期）。飞书对类型不符是**整条记录写入失败**（DatetimeFieldConvFail），
// 不是跳过那一列——「有效线索数」这些本来没问题的列也跟着一起没写进去。
//
// push-raw-comments.js 和 sort-comments.js 早在 0916 就各自写了一份 asTime 自适应
// （同一个坑），唯独这个脚本一处都没有。这里抽成共享的一份。

'use strict';

const { isKeywordEnabled } = require('./keyword-enabled-lib.js');

/** 飞书字段类型：1=文本 2=数字 3=单选 5=日期 */
const T_SINGLE_SELECT = 3;
const T_DATETIME = 5;

/**
 * 构造效果回写的 fields。
 *
 * @param {{leads:number, dup:number, comments:number, videos:number}} a.stat
 * @param {string} a.now         文本时间戳，如 "2026-09-23 12:00(UTC+8)"
 * @param {Object<string,number>} a.fieldTypes  列名 → 飞书字段类型。读不到就传 {}，
 *                                              一律退回文本写法（跟改之前一个样）。
 * @param {boolean} a.stamp      本轮是否真跑过这个词——没跑过就不刷新时间戳
 */
function buildStatFields({ stat, now, fieldTypes, stamp }) {
  const ft = fieldTypes || {};
  const fields = {
    有效线索数: stat.leads,
    重复线索数: stat.dup,
    查看评论数: stat.comments,
    搜索视频数: stat.videos,
    最近效果: `线索${stat.leads}(重现${stat.dup})/评论${stat.comments}/视频${stat.videos}`,
  };
  if (stamp) {
    // 日期列要毫秒时间戳，文本列要原来的文本。读不到类型时按文本——
    // 自作主张写时间戳会把金诺那一列（文本）变成一串数字。
    fields['最后测试时间'] = ft['最后测试时间'] === T_DATETIME ? Date.now() : now;
  }
  return fields;
}

/**
 * 自建行时「是否启用」该写什么值。
 *
 * 原实现写死 "是"。悦升那列是单选、选项只有 [启用|停用]，飞书对单选未知值会
 * **自动新增选项**（实测 code=0 成功），于是每次自建行都往客户的下拉框里塞垃圾——
 * 悦升线索表的「合规核验状态」已经被这么污染过，选项里躺着一整段带时间戳的日志文本。
 *
 * @param {{type:number, options:string[]}|undefined} meta 那一列的字段元信息
 */
function enabledValueFor(meta) {
  if (!meta || meta.type !== T_SINGLE_SELECT) return '是';
  // 同义词判定复用选词那一套，不另造一张表——两处各认各的，会出现
  // 「建行时写的值，下一轮选词时不认」这种自相矛盾。
  const hit = (meta.options || []).find((o) => isKeywordEnabled(o));
  // 一个启用类选项都没有时退回 "是"（会新增一个选项）。宁可多一个选项，
  // 也不能从 [停用|暂停] 里挑一个写进去——那等于建完行就把这个词关掉了。
  return hit || '是';
}

module.exports = { buildStatFields, enabledValueFor, T_SINGLE_SELECT, T_DATETIME };
