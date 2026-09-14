// update-keyword-stats.js —— 效果回写:线索表/评论池/视频池 按词统计 → 回写「关键词配置」表
// Manager 层的地基:关键词表从输入表变成经营仪表盘(词的赛马数据),上游出词 Agent 与 Manager 都吃它。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd";
const KW = "tbleP4LgzkcwAhiZ", LEADS = "tblTLFj69CflUqSr", POOL = "tblmrJTyVgzTj89P", VPOOL = "tblKHYTMZceFBwHr";
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : (v && v.name) ? v.name : String(v || ""); }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  async function all(table) {
    const rows = []; let pt = "";
    do {
      const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${table}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
      rows.push(...(r.data.items || []));
      pt = r.data.has_more ? r.data.page_token : "";
    } while (pt);
    return rows;
  }
  const [leads, pool, vids, kws] = await Promise.all([all(LEADS), all(POOL), all(VPOOL), all(KW)]);
  const stat = {}; // 词 -> {leads, dup, comments, videos}
  const bump = (kw, key, n = 1) => { if (!kw) return; stat[kw] = stat[kw] || { leads: 0, dup: 0, comments: 0, videos: 0 }; stat[kw][key] += n; };
  for (const r of leads) {
    const kw = txt(r.fields["命中关键词"]);
    bump(kw, "leads");
    bump(kw, "dup", Number(r.fields["重复命中次数"]) || 0);
  }
  for (const r of pool) bump(txt(r.fields["命中关键词"]), "comments");
  for (const r of vids) bump(txt(r.fields["命中关键词"]), "videos");
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
  const kwIndex = {};
  for (const r of kws) kwIndex[txt(r.fields["抖音获客-关键词配置"])] = r.record_id;
  let upd = 0, created = 0;
  for (const [kw, s] of Object.entries(stat)) {
    const fields = {
      "有效线索数": s.leads, "重复线索数": s.dup,
      "查看评论数": s.comments, "搜索视频数": s.videos,
      "最后测试时间": now,
      "最近效果": `线索${s.leads}(重现${s.dup})/评论${s.comments}/视频${s.videos}`,
    };
    if (kwIndex[kw]) {
      const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/records/${kwIndex[kw]}`, { method: "PUT", headers: H, body: JSON.stringify({ fields }) })).json();
      if (res.code === 0) upd++; else console.log("UPD_FAIL", kw, JSON.stringify(res).slice(0,80));
    } else {
      fields["抖音获客-关键词配置"] = kw;
      fields["是否启用"] = "是";
      fields["备注"] = "效果回写自动建行(实战已用词,原配置表缺失)";
      const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/records`, { method: "POST", headers: H, body: JSON.stringify({ fields }) })).json();
      if (res.code === 0) created++; else console.log("ADD_FAIL", kw, JSON.stringify(res).slice(0,80));
    }
  }
  console.log(`效果回写: 更新${upd}词 | 补建${created}词 | 词效率榜:`);
  Object.entries(stat).sort((a,b)=>b[1].leads-a[1].leads).slice(0,10).forEach(([k,s])=>console.log(`  ${k}: 线索${s.leads} 重现${s.dup} 评论${s.comments} 视频${s.videos}`));
})();
