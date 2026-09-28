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

// 0919 真机实证(截图+ui-evidence XML实锤): 消息气泡渲染成功≠真送达——对方设置"仅互关可发消息"
// 时,气泡照样能发出来(grep 得到 send_status=sent),但对方账号侧收不到,界面会追加一行系统提示
// "对方设置了仅和他互关的人可发消息...暂无法给对方发送消息"。outreach-tick.sh 发送后二次核验
// 命中这行提示时调用本函数,不再冒充"是"。
function restrictedFields(note, now) {
  const clip = (s) => s.slice(0, 200);
  return {
    "状态": "已触达",
    "发送状态": "已发送",
    "触达时间": now,
    "成功触达": "否",
    "回复结果": clip("[仅互关限制,消息虽发出但对方收不到]" + note),
  };
}

// ── 0928 护栏纯函数（生产事故：熔断后 20 秒空转 / 预写触达中不校验 / 等级门槛写死） ──
// 所有判断放这里，next-outreach.js 只留网络薄层，便于单测。

// 飞书文本字段读值：文本列是 [{text}] 数组，单选列是 {name}，其余按字符串。
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : (v && v.name) ? v.name : String(v || ""); }

// 线索等级 A 最强…E 最弱；取自 AI判断理由 的开头前缀（形如 "[A级] ..." / "[B..."）。
const GRADE_ORDER = ["A", "B", "C", "D", "E"];
function leadGrade(fields) {
  const m = txt((fields || {})["AI判断理由"]).match(/^\s*\[([A-E])/);
  return m ? m[1] : null;
}
// 排序用：A=0..E=4，取不到/未知=5 排最后（与旧行为「非 A/B 排最后」兼容）
function gradeRank(g) {
  const i = GRADE_ORDER.indexOf(g);
  return i < 0 ? GRADE_ORDER.length : i;
}
// 触达等级门槛（决策 67762358：每个组织自己配，见 line-routes.js outreachGrades）。
// 老数据没有等级前缀（g=null）→ 放行，不因新门槛丢掉老单。
function gradeAllowed(g, allowed) {
  if (g === null || g === undefined) return true;
  return Array.isArray(allowed) && allowed.includes(g);
}

// 从未被排除的发送账号里随机选一个；全被排除返回 null（调用方据此输出 NO_SENDER，且不得动线索）。
function pickSender(senders, excluded, rand = Math.random) {
  const ex = new Set(excluded || []);
  const pool = (senders || []).filter(s => !ex.has(s.profile));
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}
function parseExclude(arg) {
  return String(arg || "").split(",").map(s => s.trim()).filter(Boolean);
}

// 悬空「触达中」：预写后 tick 崩溃/回写失败，单子永远停在触达中。超过 ttl 视为悬空，由选单开头回收。
// 缺 last_modified_time 不猜（返回 false）。
function isStaleInflight(item, nowMs, ttlMs) {
  const it = item || {};
  if (txt((it.fields || {})["状态"]) !== "触达中") return false;
  const t = Number(it.last_modified_time);
  if (!Number.isFinite(t) || !t) return false;
  return nowMs - t > ttlMs;
}

// 预写「触达中」后回读校验：状态/实际分发号/话术ID 三项须与预写一致。
function verifyClaim(fields, expect) {
  const f = fields || {};
  const st = txt(f["状态"]);
  if (st !== "触达中") return { ok: false, reason: "状态=" + (st || "空") };
  if (txt(f["实际分发号"]) !== expect.sender_label_with_id) return { ok: false, reason: "实际分发号不符" };
  if (txt(f["话术ID"]) !== expect.script_id) return { ok: false, reason: "话术ID不符" };
  return { ok: true };
}

module.exports = {
  extractLead, isValidDyid, classifyPending, requeueTransientFields, restrictedFields, TRANSIENT_MARK,
  txt, GRADE_ORDER, leadGrade, gradeRank, gradeAllowed, pickSender, parseExclude, isStaleInflight, verifyClaim,
};
