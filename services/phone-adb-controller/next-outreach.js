// next-outreach.js —— 触达选单器(0914 主理人拍板: 明早8点-晚10点批量开闸)
// 模式:
//   next            → 从线索表挑下一个待触达(重复高亮优先→A级→B级),按分配规则选话术+发送账号,
//                     预写「触达中」防重入,输出 JSON 单
//   done <rid> sent|failed <备注b64> → 按结果回写(已触达/发送状态/触达时间/分发号/话术四件)
// 话术分配(话术库表规则近似): 每10单 B=5 / A1=3 / A2=2;账号轮流: 主号/小诺各半。
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync("/root/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts.jinoshengyuan;
const B = "GNuwbzY0da8GP0sv6MGcOTu9ntd", LEADS = "tblTLFj69CflUqSr", SCRIPTS = "tblZZWdv0YUNojqI";
const MODE = process.argv[2] || "next";
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

  if (MODE === "done") {
    const [,,, rid, result, noteB64] = process.argv;
    const note = noteB64 ? Buffer.from(noteB64, "base64").toString() : "";
    const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
    // 0915: 失败单转「触达受阻」——不回待触达,防高优先级单(重复高亮)无限重选死循环;
    // 受阻单人工复核或走"来源视频评论区反向进主页"路线(字母号搜索不可达实证: LHJ20001024 首屏8卡全是近似号)
    const fields = result === "sent"
      ? { "状态": "已触达", "发送状态": "已发送", "触达时间": now }
      : result === "requeue"
      ? { "状态": "待触达" }  // 环境性失败(锁忙/设备离线): 回队列,不算受阻
      : { "状态": "触达受阻", "发送状态": "发送失败", "回复结果": ("[受阻]" + note).slice(0,200) };
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${rid}`, { method: "PUT", headers: H, body: JSON.stringify({ fields }) })).json();
    console.log(res.code === 0 ? "MARKED " + result : "MARK_FAIL " + JSON.stringify(res).slice(0,120));
    return;
  }

  // next: 选单
  const [leads, scripts] = await Promise.all([all(LEADS), all(SCRIPTS)]);
  const sent = leads.filter(r => txt(r.fields["状态"]) === "已触达").length;
  const pending = leads.filter(r => {
    const st = txt(r.fields["状态"]);
    if (st !== "待触达") return false;
    // 必须有抖音号(第二段 token 非"id待核验")
    const parts = txt(r.fields["抖音昵称/主页链接"]).split("/").map(s=>s.trim());
    return parts[1] && parts[1] !== "id待核验" && /^[A-Za-z0-9._]{4,}$/.test(parts[1]);
  });
  if (!pending.length) { console.log("NO_PENDING"); return; }
  const grade = r => { const j = txt(r.fields["AI判断理由"]); return j.startsWith("[A") ? 0 : j.startsWith("[B") ? 1 : 2; };
  pending.sort((a, b) => (Number(b.fields["重复命中次数"])||0) - (Number(a.fields["重复命中次数"])||0) || grade(a) - grade(b));
  const pick = pending[0];
  const parts = txt(pick.fields["抖音昵称/主页链接"]).split("/").map(s=>s.trim());
  const nick = parts[0], dyid = parts[1];
  // 话术分配: 序号n(已触达数): n%10∈{0,2,4,6,8}→B; {1,5,9}→A1; {3,7}→A2
  const slot = sent % 10;
  const ver = [0,2,4,6,8].includes(slot) ? "B" : [1,5,9].includes(slot) ? "A1" : "A2";
  const sc = scripts.find(s => txt(s.fields["子版本"]) === ver && txt(s.fields["启用状态"]) === "启用");
  if (!sc) { console.log("NO_SCRIPT " + ver); return; }
  const msg = txt(sc.fields["话术正文"]);
  // 账号轮流: 偶数单主号,奇数单小诺
  const sender = sent % 2 === 0
    ? { profile: "jinoshengyuan-work", id: "langzi63485", label: "小号1 躺赢AI学姐" }
    : { profile: "legacy", id: "44997267357", label: "小号2 人工智能小诺考评" };
  // 预写触达中(防 tick 重入)
  await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${pick.record_id}`, { method: "PUT", headers: H, body: JSON.stringify({ fields: {
    "状态": "触达中", "话术ID": txt(sc.fields["话术ID"]), "话术版本": ver,
    "话术内容": msg, "客服编号": txt(sc.fields["客服编号"]) || "无", "客服电话": txt(sc.fields["客服电话"]) || "",
    "实际分发号": sender.label + "(" + sender.id + ")", "分配序号": sent + 1,
  }}) });
  console.log(JSON.stringify({ rid: pick.record_id, nick, dyid, ver, script_id: txt(sc.fields["话术ID"]),
    msg_b64: Buffer.from(msg).toString("base64"), profile: sender.profile, sender_id: sender.id, seq: sent + 1, dup: Number(pick.fields["重复命中次数"])||0 }));
})();
