#!/usr/bin/env node
// fetch-seen-videos.js [业务线] —— 拉取「视频池」表已存在的视频ID,逐行打印到 stdout
// 供 harvest-keyword.sh 采集前查重用。不传业务线时按 line-routes.js 默认路由(金诺)。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const { routeOf } = require("./line-routes.js");
const LINE = process.argv[2] || "";
const ROUTE = routeOf(LINE);
if (!ROUTE.video) process.exit(0); // 该业务线无视频池,视为无历史记录
const acc = cfg.channels.feishu.accounts[ROUTE.account];
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  let pt = "";
  do {
    const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${ROUTE.base}/tables/${ROUTE.video}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
    for (const it of r.data.items || []) {
      const v = it.fields["视频ID"];
      const s = Array.isArray(v) ? v.map(x => x.text || x).join("") : String(v || "");
      if (s) console.log(s);
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
})();
