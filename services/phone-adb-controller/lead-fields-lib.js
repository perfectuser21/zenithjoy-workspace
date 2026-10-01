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
  return Array.isArray(v) ? v.map((x) => x.text || x.name || x).join("")
    : (v && v.text) || (v && v.name) || String(v == null ? "" : v);
}

// 原始池与线索结算共用。旧主页拼串过滤过空项，位置不是固定三列。
function readCommentIdentity(fields, text = defaultTxt) {
  const nick = text(fields.评论者昵称), comment = text(fields.评论原文);
  const parts = text(fields.用户主页标识).split(' | ').filter(Boolean);
  const rawid = text(fields.原始评论ID);
  const prefix = nick + '|', suffix = '|' + comment.slice(0, 20);
  // 持久化rawid补足「只有类型」的歧义；完整昵称前缀允许昵称自身含竖线。
  const hint = rawid.startsWith(prefix) && rawid.endsWith(suffix)
    ? rawid.slice(prefix.length, rawid.length - suffix.length) : undefined;
  const dyid = text(fields.抖音号 !== undefined ? fields.抖音号
    : hint !== undefined ? (hint === 'noid' ? '' : hint)
      : (parts.length > 1 && !parts[0].startsWith('http') ? parts[0] : ''));
  const purl = text(fields.主页链接 !== undefined ? fields.主页链接 : parts.find(value => value.startsWith('http')));
  const remaining = [...parts];
  if (dyid && remaining[0] === dyid) remaining.shift();
  if (purl && remaining[0] === purl) remaining.shift();
  const atype = text(fields.账号类型 !== undefined ? fields.账号类型 : remaining.join(' | '));
  return { nick, dyid, purl, atype, comment,
    profile: fields.用户主页标识 !== undefined ? text(fields.用户主页标识) : [dyid, purl, atype].filter(Boolean).join(' | ') };
}

// 从线索表已有记录里提取去重用的 {nick, dyid, record_id, dup} 列表(读独立字段,不再解析合并列)
function extractSeenEntries(records, txt) {
  const t = txt || defaultTxt;
  return (records || []).map((it) => ({
    nick: t(it.fields["抖音昵称"]).trim(),
    dyid: t(it.fields["抖音号"]).trim(),
    record_id: it.record_id,
    dup: Number(it.fields["重复命中次数"]) || 0,
  }));
}

function findByDyid(rows, dyid) {
  return rows.find((r) => r.dyid === dyid) || null;
}

module.exports = { buildLeadCoreFields, extractSeenEntries, findByDyid, readCommentIdentity };
