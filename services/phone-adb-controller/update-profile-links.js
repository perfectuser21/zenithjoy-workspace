// update-profile-links.js <refill_tsv> —— 按抖音号把主页直链回写进「主页链接」字段
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const { findByDyid } = require("./lead-fields-lib.js");
const TSV = process.argv[2];
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || ""); }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", TBL = "tblTLFj69CflUqSr";
  // 1. 全表: dyid -> {record_id, purl}
  const rows = []; let pt = "";
  do {
    const r = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=100"+(pt?"&page_token="+pt:""), { headers: H })).json();
    for (const it of r.data.items) {
      rows.push({ id: it.record_id, dyid: txt(it.fields["抖音号"]), purl: txt(it.fields["主页链接"]) });
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  // 2. refill TSV
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("REFILL\t"));
  let updated = 0, already = 0, miss = 0;
  for (const ln of lines) {
    const [, dyid, purl] = ln.split("\t");
    if (!dyid || !purl || !purl.startsWith("http")) continue;
    const hit = findByDyid(rows, dyid);
    if (!hit) { console.log("MISS", dyid); miss++; continue; }
    if (hit.purl.includes("douyin.com/user/")) { already++; continue; }
    const res = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records/"+hit.id, { method: "PUT", headers: H, body: JSON.stringify({ fields: { "主页链接": purl } }) })).json();
    if (res.code === 0) { updated++; hit.purl = purl; console.log("OK", dyid); }
    else console.log("FAIL", dyid, JSON.stringify(res).slice(0,100));
  }
  console.log("回写", updated, "| 已有链接", already, "| 未匹配", miss, "| 输入", lines.length);
})();
