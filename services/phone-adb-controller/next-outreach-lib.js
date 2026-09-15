// next-outreach-lib.js —— 选单器纯函数。与 next-outreach.js 同目录同批部署:
// 网关副本 /opt/openclaw/state/ 漏发本文件 = 首个 tick MODULE_NOT_FOUND 全线选单挂。
// 「抖音昵称/主页链接」实况: `昵称 / dyid / https://www.douyin.com/user/MS4w...`
// URL 自身含 "/" —— 取链接必须整体正则,禁止 split("/") 位置切段(parts[2]==="https:")。

const URL_RE = /https?:\/\/\S+/;
const DYID_RE = /^[A-Za-z0-9._]{4,}$/;
const TRANSIENT_MARK = "[瞬时败]";

function extractLead(raw) {
  const s = String(raw || "");
  const parts = s.split("/").map((x) => x.trim());
  const m = s.match(URL_RE);
  return { nick: parts[0] || "", dyid: parts[1] || "", profileUrl: m ? m[0] : "" };
}

function isValidDyid(dyid) {
  return !!dyid && dyid !== "id待核验" && DYID_RE.test(dyid);
}

// 出单资格(决策 c5828297): 主页链接=必备件;dyid 供主页强校验闸,同为必备。
function classifyPending(raw) {
  const { dyid, profileUrl } = extractLead(raw);
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

export default { extractLead, isValidDyid, classifyPending, requeueTransientFields, TRANSIENT_MARK, URL_RE };
export { extractLead, isValidDyid, classifyPending, requeueTransientFields, TRANSIENT_MARK, URL_RE };
