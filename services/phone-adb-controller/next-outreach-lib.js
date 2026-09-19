// next-outreach-lib.js —— 选单器纯函数(CJS)。与 next-outreach.js 同目录同批部署:
// 网关副本 /opt/openclaw/state/ 漏发本文件 = 首个 tick MODULE_NOT_FOUND 全线选单挂。
// 0919 字段收敛: 「抖音昵称/主页链接」合并列已删,选单器直接读线索表独立字段
// 抖音昵称/抖音号/主页链接,不再拼串解析。
"use strict";

const DYID_RE = /^[A-Za-z0-9._]{4,}$/;
const TRANSIENT_MARK = "[瞬时败]";

function extractLead(fields) {
  const f = fields || {};
  return {
    nick: String(f["抖音昵称"] || ""),
    dyid: String(f["抖音号"] || ""),
    profileUrl: String(f["主页链接"] || ""),
  };
}

function isValidDyid(dyid) {
  return !!dyid && dyid !== "id待核验" && DYID_RE.test(dyid);
}

// 出单资格(决策 c5828297): 主页链接=必备件;dyid 供主页强校验闸,同为必备。
function classifyPending(fields) {
  const { dyid, profileUrl } = extractLead(fields);
  if (!profileUrl.startsWith("https://")) return "no_link";
  if (!isValidDyid(dyid)) return "no_link";
  return "ok";
}

// 瞬时失败两轮状态机(决策 c5828297): 执行内10次用尽=1轮回队;再来一轮仍败=受阻。
function requeueTransientFields(prevReply, note, now) {
  const prev = String(prevReply || "");
  const clip = (s) => s.slice(0, 200);
  if (prev.includes(TRANSIENT_MARK)) {
    return {
      "状态": "触达受阻",
      "发送状态": "发送失败",
      "回复结果": clip(prev + " | [瞬时败2轮转受阻 " + now + "]" + note),
    };
  }
  return {
    "状态": "待触达",
    "回复结果": clip(TRANSIENT_MARK + "[1轮 " + now + "]" + note),
  };
}

module.exports = { extractLead, isValidDyid, classifyPending, requeueTransientFields, TRANSIENT_MARK };
