// sort-comments.js —— 异步分拣器·机械部分(规则闸)。分拣 agent(便宜模型)按 SOP 调用本脚本。
// 用法:
//   node sort-comments.js rules            → 扫池内「待分拣」行: 规则能直判的当场写回;
//                                            拿不准的输出 JSON 清单(NEED_LLM 行)给 agent 逐条判
//   node sort-comments.js write <json文件>  → 把 agent 的判定批量写回池 + 合格线索写线索表
// 判定字段: 业务相关性(相关/不相关) 意向等级(A/B/C) AI判定理由 排除原因 处理状态(已分拣)
// 规则来源: 0914 KPI 夜 102 条人工判例提炼(memory handoff_0914)。规则闸目标≈判掉 70-80%。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", POOL = "tblmrJTyVgzTj89P", LEADS = "tblTLFj69CflUqSr";
const MODE = process.argv[2] || "rules";

// —— 规则表(0914 主理人理念修正: 能看到视频还留言的=天然画像内人群,**分级不丢弃**) ——
// 只有两类真排除: 同行企业号 / 广告引流号。寒暄表情=C级(精准低意向),不是垃圾。
const GOLD = /怎么考|如何报|报名|多少钱|多少米|费用|价格|求资料|要资料|领资料|证书有用|好考吗|报考|想学|想考|怎么报|哪里申请|已经投递|怎么用|考下来|难不难|有用吗|靠谱吗|通过率|含金量/;
const JUNK_WORDS = /接单|引流|互关|互粉|回关|广告|加微|软件推广|拍同款/;
const CHITCHAT = /^(哈哈+|呵呵+|笑死|太难了|加油|支持|厉害|漂亮|真棒|老乡|沙发|路过|顶|赞)[!!。.~]*$/;
const WRONG_AI = /音标|英语|插画|illustrator|修图|绘画课/i; // 同名陷阱: 该信号也说明词/视频吸错人,回流关键词效果

function ruleJudge(row) {
  const c = (row.comment || "").trim();
  const ident = row.ident || "";
  if (ident.includes("organization")) return { verdict: "弃", reason: "企业号(同行)", rel: "不相关", grade: "C" };
  if (JUNK_WORDS.test(c)) return { verdict: "弃", reason: "广告/引流号", rel: "不相关", grade: "C" };
  if (WRONG_AI.test(c)) return { verdict: "弃", reason: "同名陷阱(非人工智能语境,关键词效果信号)", rel: "不相关", grade: "C" };
  if (GOLD.test(c)) return { verdict: "留", reason: "主动问价/问报名/求资料", rel: "相关", grade: "A" };
  const noEmoji = c.replace(/\[[^\]]{1,8}\]/g, "").replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim();
  if (noEmoji.length < 2) return { verdict: "留", reason: "纯表情互动——画像内人群,低意向留档", rel: "相关", grade: "C" };
  if (CHITCHAT.test(noEmoji)) return { verdict: "留", reason: "寒暄互动——画像内人群,低意向留档", rel: "相关", grade: "C" };
  return null; // 中间地带 → 判定agent(输入=原视频文案+目标人群+留言)
}

async function feishu(path, method, body, tok) {
  const r = await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/" + B + path,
    { method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || ""); }

(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;

  if (MODE === "rules") {
    let pt = "", pend = [];
    do {
      const r = await feishu(`/tables/${POOL}/records?page_size=100${pt ? "&page_token=" + pt : ""}`, "GET", null, tok);
      for (const it of r.data.items || []) {
        const st = it.fields["处理状态"];
        const sv = typeof st === "string" ? st : (st && st.name) ? st.name : txt(st);
        if (sv !== "待分拣") continue;
        pend.push({ id: it.record_id, comment: txt(it.fields["评论原文"]), nick: txt(it.fields["评论者昵称"]), ident: txt(it.fields["用户主页标识"]), kw: txt(it.fields["命中关键词"]), region: txt(it.fields["地区"]), video: txt(it.fields["来源视频"]) });
      }
      pt = r.data.has_more ? r.data.page_token : "";
    } while (pt);
    let ruled = 0; const need = [];
    for (const row of pend) {
      const j = ruleJudge(row);
      if (!j) { need.push(row); continue; }
      await feishu(`/tables/${POOL}/records/${row.id}`, "PUT", { fields: {
        "处理状态": "已分拣", "业务相关性": j.rel, "意向等级": j.grade,
        "AI判定理由": "[规则闸] " + j.reason,
        "排除原因": j.verdict === "弃" ? j.reason : "",
        "进入最终线索": j.verdict === "留",
        "目标人群": "AI人工智能训练师考证意向人群",
      }}, tok);
      ruled++;
    }
    console.log(`待分拣 ${pend.length} | 规则直判 ${ruled} | 需模型 ${need.length}`);
    if (need.length) console.log("NEED_LLM " + JSON.stringify(need));
  }

  if (MODE === "write") {
    // 输入: [{id, rel:"相关|不相关", grade:"A|B|C", reason:"一句真实理由"}]
    const items = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    // 线索表去重映射(token→record) —— 0914 主理人拍板: 重复≠噪音,是强意向信号,要高亮不要扔
    const seen = new Map(); let lp = "";
    do {
      const r = await feishu(`/tables/${LEADS}/records?page_size=100${lp ? "&page_token=" + lp : ""}`, "GET", null, tok);
      for (const it of r.data.items || []) {
        const dup = it.fields["重复命中次数"] || 0;
        txt(it.fields["抖音昵称/主页链接"]).split("/").forEach(s => { const t = s.trim(); if (t) seen.set(t, { id: it.record_id, dup }); });
      }
      lp = r.data.has_more ? r.data.page_token : "";
    } while (lp);
    const now = new Date(Date.now() + 8*3600e3).toISOString().replace("T", " ").slice(0, 16) + "(UTC+8)";
    let n = 0, moved = 0;
    for (const it of items) {
      const keep = it.rel === "相关"; // 0914理念: 相关即留档(含C级),触达按等级排序;仅同行/广告排除
      await feishu(`/tables/${POOL}/records/${it.id}`, "PUT", { fields: {
        "处理状态": "已分拣", "业务相关性": it.rel, "意向等级": it.grade,
        "AI判定理由": "[模型] " + (it.reason || ""),
        "排除原因": keep ? "" : (it.reason || "模型判不相关"),
        "进入最终线索": keep,
      }}, tok);
      n++;
      if (!keep) continue;
      // 搬运: 池行 → 线索表(读回池行拿完整字段)
      const row = await feishu(`/tables/${POOL}/records/${it.id}`, "GET", null, tok);
      const f = row.data ? row.data.record.fields : row.record ? row.record.fields : {};
      const nick = txt(f["评论者昵称"]), ident = txt(f["用户主页标识"]);
      const [dyid, purl] = ident.split(" | ");
      const hit = (dyid && seen.get(dyid.trim())) || seen.get(nick);
      if (hit) {
        // 重复客户 = 强意向信号: 高亮回写已有行(次数+1 + 轨迹追加),不新建不静默
        const newDup = (hit.dup || 0) + 1;
        await feishu(`/tables/${LEADS}/records/${hit.id}`, "PUT", { fields: {
          "重复命中次数": newDup,
          "重复轨迹": `[再现${newDup}] 又在《${txt(f["来源视频"]).slice(0,40)}》评论: ${txt(f["评论原文"]).slice(0,50)} (${it.grade}级判定)`,
        }}, tok);
        hit.dup = newDup;
        console.log("DUP_HIGHLIGHT", nick, "x" + newDup);
        continue;
      }
      const key = nick + " / " + (dyid || "id待核验");
      const res = await feishu(`/tables/${LEADS}/records`, "POST", { fields: {
        "抖音获客-线索表": key,
        "抖音昵称/主页链接": key + (purl && purl.startsWith("http") ? " / " + purl : ""),
        "业务线": "AI人工智能训练师", "命中关键词": txt(f["命中关键词"]), "关键词层级": "精准词",
        "评论原文": txt(f["评论原文"]),
        "AI判断理由": `[${it.grade}级] ` + (it.reason || ""),
        "状态": "待触达", "发送状态": "未发送",
        "来源视频": txt(f["来源视频"]).slice(0, 80), "搜索账号": "池转入(异步判定)",
        "搜索意图": "证书/学习/求职", "目标人群": "考证人群", "采集时间": now,
        "合规核验状态": "异步判定agent分级入表(" + now + ")｜评论区采集｜仅内部写入,未触达。",
      }}, tok);
      if (res.code === 0) { moved++; seen.add(nick); if (dyid) seen.add(dyid.trim()); }
      else console.log("LEAD_FAIL", nick, JSON.stringify(res).slice(0, 100));
    }
    console.log(`模型判定写回 ${n} 条 | 搬入线索表 ${moved} 条`);
  }
})();
