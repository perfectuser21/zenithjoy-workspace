// kpi-gate.js <业务线> —— KPI 闸: 读「获客｜经营目标」表 + 今日实际线索,决定本批跑不跑/跑几词
// 0916 主理人要求"KPI驱动自动获客"。表是 SSOT: 改目标改表,不改代码不改 cron。
// 输出单行 JSON 供 harvest-cron.sh 消费: {verdict:"go"|"done"|"off", target, actual, gap, words, reason}
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const BIZ = process.argv[2] || "AI人工智能训练师";
const DEFAULT_WORDS = parseInt(process.argv[3] || "6", 10);
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", GOAL = "tblpwc9GF9mIhdAG", LEAD = "tblTLFj69CflUqSr";
const g = v => Array.isArray(v) ? v.map(x => x.text || x).join("") : (v && v.name) ? v.name : String(v || "");
const out = o => { console.log(JSON.stringify(o)); process.exit(0); };
(async () => {
  try {
    const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
    const tok = (await tr.json()).tenant_access_token;
    const H = { Authorization: "Bearer " + tok };
    // 1. 目标行
    const gr = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${GOAL}/records?page_size=100`, { headers: H })).json();
    const row = (gr.data.items || []).find(it => g(it.fields["业务线"]) === BIZ);
    if (!row) out({ verdict: "go", words: DEFAULT_WORDS, reason: `目标表无 ${BIZ} 行,按默认词数放行(fail-open:宁可多采不可停摆)` });
    if (g(row.fields["状态"]) !== "启用") out({ verdict: "go", words: DEFAULT_WORDS, reason: "该线目标未启用(只采不考核),按默认词数放行" });
    const target = Number(row.fields["日线索目标"]) || 0;
    if (target <= 0) out({ verdict: "go", words: DEFAULT_WORDS, reason: "目标为0,按默认词数放行" });
    // 2. 今日实际(UTC+8 自然日,线索表「采集时间」)
    const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
    let pt = "", actual = 0;
    do {
      const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEAD}/records?page_size=500` + (pt ? "&page_token=" + pt : ""), { headers: H })).json();
      for (const it of (r.data.items || [])) if (g(it.fields["采集时间"]).slice(0, 10) === today) actual++;
      pt = r.data.has_more ? r.data.page_token : "";
    } while (pt);
    const gap = target - actual;
    if (gap <= 0) out({ verdict: "done", target, actual, gap, words: 0, reason: `今日已达标(${actual}/${target}),本批退让省资源` });
    // 3. 缺口→词数。经验值: 1词≈0.3条有效线索(0915实测 24词次→7条)。上限12防单批过长(6词≈2小时)。
    const words = Math.max(DEFAULT_WORDS, Math.min(12, Math.ceil(gap / 0.3 / 4)));
    out({ verdict: "go", target, actual, gap, words, reason: `缺口${gap}条(${actual}/${target}),本批取${words}词` });
  } catch (e) {
    // fail-open: KPI 闸自身故障绝不能停掉生产(宪法:帮不拦)
    out({ verdict: "go", words: DEFAULT_WORDS, reason: "KPI闸异常(" + String(e).slice(0, 80) + "),fail-open按默认词数放行" });
  }
})();
