// push-videos.js <harvest_tsv> <采收批次> —— 视频落「视频池」表(全链可观察的 discovery 节点)
// VIDEO 行: _,视频ID,短链,标题,关键词,采到评论数;按视频ID去重(今天搜明天又搜到=跳过,只吃增量)
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const [,, TSV, BATCH] = process.argv;
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", VPOOL = "tblKHYTMZceFBwHr";
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const seen = new Set(); let pt = "";
  do {
    const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${VPOOL}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
    for (const it of r.data.items||[]) {
      const v = it.fields["视频ID"];
      const s = Array.isArray(v)?v.map(x=>x.text||x).join(""):String(v||"");
      if (s) seen.add(s);
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("VIDEO\t"));
  let created = 0, dup = 0;
  for (const ln of lines) {
    const [, vid, url, title, kw, cc] = ln.split("\t");
    const key = vid || url || title;
    if (!key) continue;
    if (seen.has(key)) { dup++; continue; }
    const body = { fields: {
      "视频ID": vid || "id未取到",
      "视频链接": url && url.startsWith("http") ? { link: url, text: url } : undefined,
      "视频标题/文案": title || "", "命中关键词": kw || "",
      "评论数": Number(cc) || 0, "发现时间": now,
      "处理状态": "评论已采", "采收批次": BATCH || "manual",
    }};
    if (!body.fields["视频链接"]) delete body.fields["视频链接"];
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${VPOOL}/records`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
    if (res.code === 0) { created++; seen.add(key); }
    else console.log("FAIL", title, JSON.stringify(res).slice(0,100));
  }
  console.log(`视频落池 ${created} | 去重跳过 ${dup} | 输入 ${lines.length}`);
})();
