// push-raw-comments.js <harvest_tsv> <运行批次> —— 采收产出全量落「原始评论池」(异步分拣进水口)
// 架构(主理人 0914 拍板): 采收(手机侧,锁独占)与分拣(纯文本判断)解耦——
// 采收 worker 只管倒池,分拣 agent 异步消费池子,合格线索再进线索表。
// LEAD 12列: _,昵称,抖音号,类型,评论,日期,地区,标题,关键词,IP,主页链接,作品链接
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
// 0916: 按业务线路由 base/table(悦升有独立 base,写死会让它的数据无处可去——见 line-routes.js)
const { routeOf } = require("./line-routes.js");
const [,, TSV, BATCH, LINE] = process.argv;
const ROUTE = routeOf(LINE);
const acc = cfg.channels.feishu.accounts[ROUTE.account];
const B = ROUTE.base, POOL = ROUTE.pool;
if (!B || !POOL) { console.error("line-route: pool 表未配置(业务线=" + (LINE||"(空)") + "),跳过"); process.exit(0); }
console.error("line-route: " + ROUTE.key + " base=" + B + " POOL=" + POOL);
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  // 0916: 两条线的表结构有历史差异(悦升「采集时间」是日期型 type5,金诺是文本)。
  // 读一次字段类型,写入时按类型自适应——避免 DatetimeFieldConvFail 把整批打回。
  const FT = {};
  try {
    const fr = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/" + B + "/tables/" + POOL + "/fields?page_size=100", { headers: H })).json();
    for (const f of (fr.data && fr.data.items) || []) FT[f.field_name] = f.type;
  } catch (e) { console.error("字段类型读取失败,按文本写入: " + String(e).slice(0, 60)); }
  const asTime = (name, v) => (FT[name] === 5 ? Date.now() : v);
  const seen = new Set(); let pt = "";
  do {
    const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${POOL}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
    for (const it of r.data.items||[]) {
      const v = it.fields["原始评论ID"];
      const s = Array.isArray(v)?v.map(x=>x.text||x).join(""):String(v||"");
      if (s) seen.add(s);
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("LEAD\t"));
  let created = 0, dup = 0;
  for (const ln of lines) {
    const f = ln.split("\t");
    const [, nick, id, atype, comment, cdate, region, video, kw, pip, purl, vurl] = f;
    const rid = `${nick}|${id||"noid"}|${(comment||"").slice(0,20)}`;
    if (seen.has(rid)) { dup++; continue; }
    const body = { fields: {
      "原始评论ID": rid, "运行批次": BATCH || "manual",
      "采集时间": asTime("采集时间", now), "命中关键词": kw || "",
      "来源视频": (video||"").slice(0,100),
      "评论作品视频链接": (vurl && vurl.startsWith("http")) ? vurl : "",
      "评论原文": comment || "", "评论者昵称": nick || "",
      // 0915 主理人逐列验收拍板: 独立字段成列;「用户主页标识」拼串保留双写(存量兼容,勿再新增读取方)
      "用户主页标识": [id||"", purl||"", atype||""].filter(Boolean).join(" | "),
      "抖音号": id || "", "主页链接": purl || "", "账号类型": atype || "",
      "留言时间": cdate || "", "主页IP": (pip||"").trim(),
      "地区": region || "", "处理状态": "待分拣",
    }};
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${POOL}/records`, { method: "POST", headers: H, body: JSON.stringify(body) })).json();
    if (res.code === 0) { created++; seen.add(rid); }
    else console.log("FAIL", nick, JSON.stringify(res).slice(0,100));
  }
  console.log(`落池 ${created} | 去重 ${dup} | 输入 ${lines.length}`);
})();
