// next-keywords.js <业务线> <数量> —— 从「关键词配置」表自动出词单(24×7 采收的自动扳机)
// 选词策略: 仅启用词;按 (有效线索数 / max(1,已测轮次)) 效率降序 + 最久未测优先轮换;
// 输出纯文本词单(一行一词),供 M4/M1 夜间采收 cron 直接消费。表是 SSOT: 改表=改策略。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/Users/administrator/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const BIZ = process.argv[2] || "AI人工智能训练师";
const N = parseInt(process.argv[3] || "6", 10);
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", KW = "tbleP4LgzkcwAhiZ";
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : (v && v.name) ? v.name : String(v || ""); }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok };
  const rows = []; let pt = "";
  do {
    const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
    rows.push(...(r.data.items || []));
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  const cand = rows.map(r => {
    const f = r.fields;
    return {
      word: txt(f["抖音获客-关键词配置"]),
      enabled: txt(f["是否启用"]),
      biz: txt(f["业务线"]),
      leads: Number(f["有效线索数"]) || 0,
      videos: Number(f["搜索视频数"]) || 0,
      lastTest: txt(f["最后测试时间"]),
    };
  }).filter(k => k.word && k.enabled === "是" && (!BIZ || k.biz.includes(BIZ) || BIZ.includes(k.biz)));
  // 效率分 = 线索数/轮次近似(视频数/4≈轮次); 未测词(lastTest空)优先探索
  cand.sort((a, b) => {
    const ea = a.videos ? a.leads / (a.videos / 4) : (a.lastTest ? 0 : 99);
    const eb = b.videos ? b.leads / (b.videos / 4) : (b.lastTest ? 0 : 99);
    if (eb !== ea) return eb - ea;
    return (a.lastTest || "").localeCompare(b.lastTest || ""); // 最久未测优先
  });
  cand.slice(0, N).forEach(k => console.log(k.word));
})();
