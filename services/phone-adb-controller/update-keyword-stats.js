// update-keyword-stats.js —— 效果回写:线索表/评论池/视频池 按词统计 → 回写「关键词配置」表
// Manager 层的地基:关键词表从输入表变成经营仪表盘(词的赛马数据),上游出词 Agent 与 Manager 都吃它。
// 用法: node update-keyword-stats.js [业务线]
//
// 0923: 这个脚本此前把金诺的 base/table/account 全部写死,连 line-routes.js 都没 require
// ——0916 那次「按业务线路由」改了四个写库脚本,漏了这一个。后果是悦升的效果回写
// 从来没跑过:关键词表 35 行,最后测试时间/有效线索数/搜索视频数/最近效果 全部 0 行有值
// (金诺同期 39/2/29/52)。词的赛马数据是选词的依据,没有数据 = 悦升一直在盲选。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/Users/administrator/.openclaw/clawdbot.json"));
const { routeOf } = require("./line-routes.js");
const { buildStatFields, enabledValueFor, tallyFromPool } = require("./keyword-stats-lib.js");
const ROUTE = routeOf(process.argv[2]);
const acc = cfg.channels.feishu.accounts[ROUTE.account];
const B = ROUTE.base;
const KW = ROUTE.keyword, LEADS = ROUTE.lead, POOL = ROUTE.pool, VPOOL = ROUTE.video;
console.error("line-route: " + ROUTE.key + " base=" + B + " KW=" + KW);
function txt(v) { return Array.isArray(v) ? v.map(x => x.text || x).join("") : (v && v.name) ? v.name : String(v || ""); }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  async function all(table) {
    // 悦升 base 暂无视频池(ROUTE.video=null) —— 当空表处理,不能让整个脚本挂掉
    if (!table) return [];
    const rows = []; let pt = "";
    do {
      const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${table}/records?page_size=100${pt?"&page_token="+pt:""}`, { headers: H })).json();
      rows.push(...(r.data.items || []));
      pt = r.data.has_more ? r.data.page_token : "";
    } while (pt);
    return rows;
  }
  const [leads, pool, vids, kws] = await Promise.all([all(LEADS), all(POOL), all(VPOOL), all(KW)]);
  // 0923: 按目标列的真实类型写值。悦升「最后测试时间」是日期型(type 5),写文本字符串
  // 会 DatetimeFieldConvFail —— 飞书是**整条记录失败**,连「有效线索数」都跟着写不进去。
  // push-raw-comments.js / sort-comments.js 早就各有一份自适应,这里补上并抽成共享的。
  const FT = {}, FMETA = {};
  try {
    const fr = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/fields?page_size=200`, { headers: H })).json();
    for (const f of (fr.data && fr.data.items) || []) {
      FT[f.field_name] = f.type;
      FMETA[f.field_name] = { type: f.type, options: ((f.property && f.property.options) || []).map(o => o.name) };
    }
  } catch (e) { console.error("字段类型读取失败,按文本写入: " + String(e).slice(0, 60)); }
  // 0923: 有效线索数/重复线索数改从评论池数。原实现按 线索表.fields["命中关键词"] 统计,
  // 而**两家线索表都没有这一列**(各34列,逐列查过) —— `if (!kw) return;` 每次都命中,
  // 两个数永远是 0(金诺 58 行里那 2 个有值的是人手填的)。
  // 池里「进入最终线索=true」就是有效线索的定义,PR#1961 之后两本账已对平。
  const stat = tallyFromPool(pool);
  const bump = (kw, key, n = 1) => { if (!kw) return; stat[kw] = stat[kw] || { leads: 0, dup: 0, comments: 0, videos: 0 }; stat[kw][key] += n; };
  for (const r of vids) bump(txt(r.fields["命中关键词"]), "videos");
  const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
  // 0916 bugfix: 原来给 stat 里**每个**词都写 now,而 stat 是从池全量重算的(含所有历史词),
  // 于是每跑一次,全表「最后测试时间」被刷成同一时刻 → next-keywords 的"最久未测优先"
  // 排序彻底失效,词表轮换退化成瞎转(0916 实测: 35 个词的最后测试时间全是同一天)。
  // 修: 只给**本轮真跑过**的词打时间戳 —— 判据是评论池里该词有最近 RECENT_H 小时的新行。
  // 拿不到入表时间(字段缺失/全为空)时回落"全量打戳"以保持历史行为,不静默丢失统计。
  const RECENT_H = Number(process.env.KWSTATS_RECENT_HOURS || 4);
  const RECENT = new Set();
  let sawTs = false;
  for (const r of pool) {
    const raw = r.fields["入表时间"] ?? r.fields["采集时间"];
    if (raw == null || raw === "") continue;
    const ms = typeof raw === "number" ? raw : Date.parse(String(raw).replace("(UTC+8)", "").trim());
    if (!Number.isFinite(ms)) continue;
    sawTs = true;
    if (Date.now() - ms <= RECENT_H * 3600e3) RECENT.add(txt(r.fields["命中关键词"]));
  }
  const stampAll = !sawTs || RECENT.size === 0;
  console.error(`lasttest: 本轮判定跑过 ${RECENT.size} 词 (窗口${RECENT_H}h)` + (stampAll ? " —— 判据不可用,回落全量打戳" : ""));
  const kwIndex = {};
  for (const r of kws) kwIndex[txt(r.fields["抖音获客-关键词配置"])] = r.record_id;
  let upd = 0, created = 0;
  for (const [kw, s] of Object.entries(stat)) {
    // 只有本轮真跑过的词才更新时间戳(判据不可用时回落全量,见上)
    const fields = buildStatFields({ stat: s, now, fieldTypes: FT, stamp: stampAll || RECENT.has(kw) });
    if (kwIndex[kw]) {
      const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/records/${kwIndex[kw]}`, { method: "PUT", headers: H, body: JSON.stringify({ fields }) })).json();
      if (res.code === 0) upd++; else console.log("UPD_FAIL", kw, JSON.stringify(res).slice(0,80));
    } else {
      fields["抖音获客-关键词配置"] = kw;
      // 悦升那列是单选、选项只有[启用|停用],写死"是"会让飞书自动新增一个选项,
      // 一次次把客户的下拉框塞满垃圾(线索表的「合规核验状态」已经被这么污染过)。
      fields["是否启用"] = enabledValueFor(FMETA["是否启用"]);
      fields["备注"] = "效果回写自动建行(实战已用词,原配置表缺失)";
      const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${KW}/records`, { method: "POST", headers: H, body: JSON.stringify({ fields }) })).json();
      if (res.code === 0) created++; else console.log("ADD_FAIL", kw, JSON.stringify(res).slice(0,80));
    }
  }
  console.log(`效果回写[${ROUTE.key}]: 更新${upd}词 | 补建${created}词 | 词效率榜:`);
  Object.entries(stat).sort((a,b)=>b[1].leads-a[1].leads).slice(0,10).forEach(([k,s])=>console.log(`  ${k}: 线索${s.leads} 重现${s.dup} 评论${s.comments} 视频${s.videos}`));
})();
