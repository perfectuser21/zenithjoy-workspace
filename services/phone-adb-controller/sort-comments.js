// sort-comments.js —— 评论分拣器(0922重构:去规则闸,评论直接送Jev主判)
// 用法: node sort-comments.js [业务线]
//
// 0922拍板前的老版本有"rules"(正则规则闸)+"write"(agent判完手动喂JSON回写)两个模式,
// 规则闸生产实测只判掉8.3%~9.1%的评论(远低于设计目标70-80%),九成以上早就在走模型
// 判定;而"write"模式依赖人/agent临场手动跑,没有定时触发,是个长期悬空的自动化缺口。
// 现在合并成一个模式:扫池→逐条直接送judge-comment.js(Jev主判+大模型兜底)→写回,
// 不再需要人工中转,也不再有"规则闸判不了才麻烦模型"这道形同虚设的关卡。
"use strict";
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/Users/administrator/.openclaw/clawdbot.json"));
// 0916: 按业务线路由 —— 悦升有独立 base,写死金诺会让它池里的评论永远没人消化(见 line-routes.js)
const { routeOf } = require("./line-routes.js");
const { extractSeenEntries } = require("./lead-fields-lib.js");
// 0923: 「判完之后怎么落账」抽进 sort-comments-lib.js —— 顺序错没错只有注入假飞书
// 跑一遍才看得出来(池状态必须最后推进,否则写线索失败的那条下轮就扫不到了,146条就是这么丢的)。
const { settlePending } = require("./sort-comments-lib.js");
const { judgeComment } = require("./judge-comment.js");

const LINE = process.argv[2] || "";
const ROUTE = routeOf(LINE);
const acc = cfg.channels.feishu.accounts[ROUTE.account];
const B = ROUTE.base, POOL = ROUTE.pool, LEADS = ROUTE.lead;
console.error("line-route: " + ROUTE.key + " base=" + B + " POOL=" + POOL + " LEADS=" + LEADS);

// ⚠️ 跟judge-video.js里的TARGET_PROFILES是同一份数据,暂时各自维护一份(两个PR互相独立
// 开工,合并顺序未定);后续两个PR都进main之后应该抽成共享的target-profiles.js,避免两处
// 各自维护容易漂移。
const TARGET_PROFILES = {
  jinuo: "AI人工智能训练师考证意向人群:关注AI技能证书、求职提升、培训报名的用户",
  yuesheng: "悦升云端目标客户:企业级AI部署决策者/OPC小微主体主/AI办公入门学习者",
};

async function feishu(path, method, body, tok) {
  const r = await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/" + B + path,
    { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || ""); }

(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;

  const targetProfile = TARGET_PROFILES[ROUTE.key];
  if (!targetProfile) { console.error("sort-comments: 未配置" + ROUTE.key + "的目标客户画像,退出"); process.exit(1); }

  // 扫池取「待分拣」行
  let pt = "", pend = [];
  do {
    const r = await feishu(`/tables/${POOL}/records?page_size=100${pt ? "&page_token=" + pt : ""}`, "GET", null, tok);
    for (const it of r.data.items || []) {
      const st = it.fields["处理状态"];
      const sv = typeof st === "string" ? st : (st && st.name) ? st.name : txt(st);
      if (sv !== "待分拣") continue;
      pend.push({ id: it.record_id, fields: it.fields });
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  console.log(`待分拣 ${pend.length} 条`);
  if (!pend.length) return;

  // 0922真机实证: 悦升「采集时间」是日期型(type 5),金诺是文本——写死字符串会在悦升侧
  // 100%炸(DatetimeFieldConvFail),导致判定写回池成功但一条都进不了线索表。
  const LT = {};
  try {
    const fr = await feishu(`/tables/${LEADS}/fields?page_size=100`, "GET", null, tok);
    for (const f of (fr.data && fr.data.items) || []) LT[f.field_name] = f.type;
  } catch (e) { console.error("线索表字段类型读取失败,按文本写入: " + String(e).slice(0, 60)); }
  const asLeadTime = (name, v) => (LT[name] === 5 ? Date.now() : v);

  // 线索表去重映射(token→record) —— 0914 主理人拍板: 重复≠噪音,是强意向信号,要高亮不要扔
  const seen = new Map(); let lp = "";
  do {
    const r = await feishu(`/tables/${LEADS}/records?page_size=100${lp ? "&page_token=" + lp : ""}`, "GET", null, tok);
    for (const e of extractSeenEntries(r.data.items || [], txt)) {
      const val = { id: e.record_id, dup: e.dup };
      if (e.nick) seen.set(e.nick, val);
      if (e.dyid) seen.set(e.dyid, val);
    }
    lp = r.data.has_more ? r.data.page_token : "";
  } while (lp);

  const now = new Date(Date.now() + 8 * 3600e3).toISOString().replace("T", " ").slice(0, 16) + "(UTC+8)";
  let judged = 0, moved = 0, failed = 0, duped = 0, parked = 0;

  for (const row of pend) {
    const f = row.fields;
    const comment = txt(f["评论原文"]);
    const videoCaption = txt(f["来源视频"]);
    let verdict;
    try {
      verdict = await judgeComment(comment, videoCaption, targetProfile);
    } catch (e) {
      failed++;
      console.error(`  判定失败 id=${row.id}: ${String(e.message || e).slice(0, 120)}(留在待分拣,下一轮重试)`);
      continue;
    }
    judged++;
    const r = await settlePending({
      row, verdict, route: ROUTE, seen, now, asLeadTime,
      deps: {
        putPool:  (id, fields) => feishu(`/tables/${POOL}/records/${id}`, "PUT",  { fields }, tok),
        postLead: (fields)     => feishu(`/tables/${LEADS}/records`,      "POST", { fields }, tok),
        putLead:  (id, fields) => feishu(`/tables/${LEADS}/records/${id}`, "PUT", { fields }, tok),
      },
    });
    moved += r.moved;
    duped += r.duped;
    if (r.retryable) {
      parked++;
      // 关键: 池状态没被推进,这条下一轮还在「待分拣」里,会被自然重捞。
      // 原实现在这里只打一行日志就过,而池早已标成「已分拣+进入最终线索=true」——
      // 下一轮 `sv !== "待分拣" → continue` 再也扫不到它,线索就这么没了(金诺41 悦升105)。
      console.log("LEAD_PARKED", txt(row.fields["评论者昵称"]), r.reason, "(留待分拣,下轮重试)");
    }
  }
  console.log(`判定完成 ${judged}/${pend.length} | 搬入线索表 ${moved} 条 | 重复高亮 ${duped} 条 | 判定异常${failed}条(留待分拣) | 搬运失败${parked}条(留待分拣下轮重试)`);
  // 搬运失败不再是"打条日志就算了": 池留在待分拣,下一轮必然重来一次。
  if (parked) console.log(`⚠️ 有 ${parked} 条判定通过但没搬进线索表,已保持待分拣;若连续多轮不降,去查线索表字段/权限`);
})();
