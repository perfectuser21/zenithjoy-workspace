// lead-fields-lib.js —— 线索表(LEADS)字段构造 + 去重集合提取(纯函数,CJS)
// 0919 字段收敛: 不再写「抖音昵称/主页链接」合并列、不再写「命中关键词」；
// 「评论原文」→「原始评论」；新增独立「评论作品视频链接」。
"use strict";

function buildLeadCoreFields({ nick, dyid, purl, comment, video, vurl }) {
  return {
    "抖音昵称": nick || "",
    "抖音号": dyid || "",
    "主页链接": (purl && purl.startsWith("http")) ? purl : "",
    "原始评论": comment || "",
    "来源视频": (video || "").slice(0, 80),
    "评论作品视频链接": (vurl && vurl.startsWith("http")) ? vurl : "",
  };
}

function defaultTxt(v) {
  return Array.isArray(v) ? v.map((x) => x.text || x).join("") : String(v || "");
}

// 从线索表已有记录里提取去重用的 {nick, dyid, record_id, dup} 列表(读独立字段,不再解析合并列)
function extractSeenEntries(records, txt) {
  const t = txt || defaultTxt;
  return (records || []).map((it) => ({
    nick: t(it.fields["抖音昵称"]),
    dyid: t(it.fields["抖音号"]),
    record_id: it.record_id,
    dup: Number(it.fields["重复命中次数"]) || 0,
  }));
}

function findByDyid(rows, dyid) {
  return rows.find((r) => r.dyid === dyid) || null;
}

module.exports = { buildLeadCoreFields, extractSeenEntries, findByDyid };
