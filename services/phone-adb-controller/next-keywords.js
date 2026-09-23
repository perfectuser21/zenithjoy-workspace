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

// 「是否启用」怎么判。
//
// 这一列是人手填在飞书表里的自由文本，中文里"开着"的写法太多：
// 金诺填「是/否/暂停」，悦升填「启用」。原来写死 `=== "是"`，结果
// **悦升 35 条词一条都选不出来，夜批一直空跑**，日志只说"本批取 0 词"，
// 不报错、没人看得出来（0923 实测）。
//
// 所以认一类说法，不认某一个字。但两头都要收住：
//  · 「暂停」绝不能算启用——金诺表里真有 3 条这么填的，误判会让停掉的词重新开跑
//  · 空值/未填一律不跑——没表态就别去动客户的号，宁可漏跑一个词
function isKeywordEnabled(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!v) return false;
  // 先否后是：「暂停」含「停」，必须先被否掉，否则任何含"启"的宽松匹配都可能放过它
  if (['否', '停', '暂停', '关', '关闭', 'n', 'no', 'false', '0', '✖', '❌'].includes(v)) return false;
  return ['是', '启用', '开', '开启', 'y', 'yes', 'true', '1', '✅', '√'].includes(v);
}

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
  }).filter(k => k.word && isKeywordEnabled(k.enabled) && (!BIZ || k.biz.includes(BIZ) || BIZ.includes(k.biz)));
  // 效率分 = 线索数/轮次近似(视频数/4≈轮次); 未测词(lastTest空)优先探索
  cand.sort((a, b) => {
    const ea = a.videos ? a.leads / (a.videos / 4) : (a.lastTest ? 0 : 99);
    const eb = b.videos ? b.leads / (b.videos / 4) : (b.lastTest ? 0 : 99);
    if (eb !== ea) return eb - ea;
    return (a.lastTest || "").localeCompare(b.lastTest || ""); // 最久未测优先
  });
  cand.slice(0, N).forEach(k => console.log(k.word));
})();

module.exports = { isKeywordEnabled };
