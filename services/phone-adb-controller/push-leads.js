// push-leads.js <tsv路径> <搜索账号标识> —— KPI夜写表器
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/Users/administrator/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const { buildLeadCoreFields, extractSeenEntries } = require("./lead-fields-lib.js");
const [,, TSV, SRCACC] = process.argv;
const provenanceIndex=process.argv.indexOf('--provenance');
const provenance=provenanceIndex<0?null:JSON.parse(fs.readFileSync(process.argv[provenanceIndex+1],'utf8'));
if(provenanceIndex>=0){
  if(!provenance||typeof provenance!=='object'||Array.isArray(provenance))throw Error('显式PG来源必须为普通对象');
  const {routeOf}=require('./line-routes.js');
  const validUuid=v=>typeof v==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v);
  if(routeOf(SRCACC).key!=='jinuo'||provenance.line_key!=='jinuo'||provenance.source_account!==SRCACC||!validUuid(provenance.lead_id)||!validUuid(provenance.comment_id)||!/^[A-Za-z0-9_-]{1,120}$/.test(provenance.source_run||'')||!Number.isFinite(Date.parse(provenance.collected_at))||!['A','B','C','D','E'].includes(provenance.intent_grade)||typeof provenance.ai_judgment_reason!=='string'||!provenance.ai_judgment_reason.startsWith('['+provenance.intent_grade+']'))throw Error('显式PG来源/评分/账号合同不符');
  const rows=fs.readFileSync(TSV,'utf8').trim().split('\n').filter(s=>s.startsWith('LEAD\t'));
  if(rows.length!==1)throw Error('显式PG桥接仅允许单条真实来源');
  const f=rows[0].split('\t');
  if(f.length!==12||f[1]!==provenance.nickname||f[2].toLowerCase()!==String(provenance.douyin_id||'').toLowerCase()||f[4]!==provenance.comment_body||f[7]!==provenance.source_video||f[11]!==provenance.source_video_url||f[10]!==provenance.profile_url||!/^https:\/\/(?:v|www)\.douyin\.com\/[A-Za-z0-9._/-]+$/.test(f[10]))throw Error('显式PG来源与待写订单身份/正文/主页链接不符');
}
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", TBL = "tblTLFj69CflUqSr";
  let seen = new Set(), normalizedIds=new Set(), pt = "";
  do {
    const r = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=100"+(pt?"&page_token="+pt:""), { headers: H })).json();
    for (const e of extractSeenEntries(r.data.items)) {
      if (e.nick) seen.add(e.nick);
      if (e.dyid) seen.add(e.dyid);
      if(e.dyid)normalizedIds.add(e.dyid.toLowerCase());
    }
    pt = r.data.has_more ? r.data.page_token : "";
  } while (pt);
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16) + "(UTC+8)";
  const lines = fs.readFileSync(TSV,"utf8").trim().split("\n").filter(l=>l.startsWith("LEAD\t"));
  let created = 0;
  for (const ln of lines) {
    const f = ln.split("\t");
    // 第9列(命中关键词)在线索表字段收敛后不再写入线索表,仅原样跳过位置
    const [, nick, id, atype, comment, cdate, region, video, , pip, purl, vurl] = f; // 0914 六刀融合: 第11列purl=主页直链,第12列vurl=原爆款作品地址
    if (atype === "organization") { console.log("跳过同行:", nick); continue; }
    if ((id && (seen.has(id)||provenance&&normalizedIds.has(id.toLowerCase()))) || seen.has(nick)) { console.log("去重:", nick); continue; }
    const body = { fields: {
      "抖音获客-线索表": nick + " / " + (id || "id待核验"),
      ...buildLeadCoreFields({ nick, dyid: id, purl, comment, video, vurl }),
      "业务线": "AI人工智能训练师", "关键词层级": "精准词",
      "AI判断理由": "评论显示相关意向(" + comment.slice(0,30) + ")," + (region.includes("陕西")?"IP陕西,":"") + "KPI夜采集线索。",
      "状态": "待触达", "发送状态": "未发送",
      "搜索账号": SRCACC,
      "搜索意图": "证书/学习/求职", "目标人群": "考证人群",
      "采集时间": now,
      "合规核验状态": "KPI夜直采(0914)｜真机评论区采集,身份经主页复验(主页IP:"+(pip||"未读")+";评论"+cdate+" IP:"+region+")｜仅内部写入,未触达。"
    }};
    if(provenance){
      body.fields['AI判断理由']=provenance.ai_judgment_reason;
      body.fields['采集时间']=new Date(Date.parse(provenance.collected_at)+8*3600e3).toISOString().replace('T',' ').slice(0,16)+'(UTC+8)';
      body.fields['合规核验状态']=`PG归档来源｜line=${provenance.line_key}｜lead=${provenance.lead_id}｜comment=${provenance.comment_id}｜batch=${provenance.source_run}｜grade=${provenance.intent_grade}｜actor=Codex｜仅内部写入，未触达。`;
    }
    const res = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records", { method: "POST", headers: H, body: JSON.stringify(body) })).json();
    if (res.code === 0) { created++; seen.add(nick); if(id) seen.add(id); console.log("OK", nick); }
    else console.log("FAIL", nick, JSON.stringify(res).slice(0,120));
  }
  const cnt = await (await fetch("https://open.feishu.cn/open-apis/bitable/v1/apps/"+B+"/tables/"+TBL+"/records?page_size=1", { headers: H })).json();
  console.log("写入", created, "| 总行数:", cnt.data.total);
})();
