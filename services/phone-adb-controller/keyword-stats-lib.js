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

const txt = (v) => (Array.isArray(v)
  ? v.map((x) => x.text || x.name || x).join('')
  : (v && v.text) || (v && v.name) || String(v == null ? '' : v));

/**
 * 从评论池按词汇总。
 *
 * 0923 实测：原实现按 `线索表.fields["命中关键词"]` 数有效线索，而**两家的线索表都没有
 * 这一列**（各 34 列，逐列查过）。于是 `if (!kw) return;` 每次都命中，有效线索数和
 * 重复线索数永远是 0——金诺 58 行里只有 2 行有值，那 2 行是人手填的。
 *
 * 不给客户的表加列（要在每个 base 各建一次，老数据还没有）：线索本来就是从池里搬过去的，
 * 池里「进入最终线索=true」就是有效线索的定义。PR #1961 之后两本账已经对平（孤儿 0），
 * 这么数是准的。
 *
 * @param {Array<{fields:object}>} poolRows 评论池全量行
 * @returns {Object<string,{leads:number,dup:number,comments:number,videos:number}>}
 */
function tallyFromPool(poolRows) {
  const stat = {};
  const seenByKw = {}; // 词 → (人 → 出现次数)，用来数"同一个人再次出现"
  for (const r of poolRows || []) {
    const kw = txt(r.fields && r.fields['命中关键词']);
    if (!kw) continue;
    stat[kw] = stat[kw] || { leads: 0, dup: 0, comments: 0, videos: 0 };
    stat[kw].comments++;
    if ((r.fields && r.fields['进入最终线索']) !== true) continue;
    stat[kw].leads++;
    // 重复客户 = 强意向信号（0914 主理人拍板：重复≠噪音），照样计入 leads，
    // 另外单独记一笔 dup。跨词不算重复——同一个人在两个词下出现是两条独立线索。
    const who = txt(r.fields['评论者昵称']) || txt(r.fields['抖音号']);
    if (!who) continue;
    seenByKw[kw] = seenByKw[kw] || {};
    seenByKw[kw][who] = (seenByKw[kw][who] || 0) + 1;
    if (seenByKw[kw][who] > 1) stat[kw].dup++;
  }
  return stat;
}

module.exports = { buildStatFields, enabledValueFor, tallyFromPool, T_SINGLE_SELECT, T_DATETIME };
