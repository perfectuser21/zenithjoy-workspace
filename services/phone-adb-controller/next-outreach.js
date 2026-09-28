// next-outreach.js —— 触达选单器(0914 主理人拍板: 明早8点-晚10点批量开闸)
// 模式:
//   next            → 从线索表挑下一个待触达(重复高亮优先→A级→B级),按分配规则选话术+发送账号,
//                     预写「触达中」防重入,输出 JSON 单
//   done <rid> sent|failed <备注b64> → 按结果回写(已触达/发送状态/触达时间/分发号/话术四件)
// 话术分配(话术库表规则近似): 每10单 B=5 / A1=3 / A2=2;账号轮流: 主号/小诺各半。
const fs = require("fs");
const lib = require("./next-outreach-lib.js");
const { routeOf } = require("./line-routes.js");
// base/表 id 一律取自路由表（line-routes.js 死规矩：禁止各脚本写死）。触达目前只跑金诺线。
const ROUTE = routeOf("jinuo");
const cfg = JSON.parse(fs.readFileSync("/Users/administrator/.openclaw/clawdbot.json"));
const acc = cfg.channels.feishu.accounts[ROUTE.account];
const B = ROUTE.base, LEADS = ROUTE.lead, SCRIPTS = ROUTE.script;
const MODE = process.argv[2] || "next";
const txt = lib.txt;
// 悬空「触达中」回收阈值：预写后 40 分钟仍没回写（tick 崩溃/回写失败）视为悬空。
const INFLIGHT_TTL_MS = 40 * 60 * 1000;
const SWEEP_TAG = "[触达中悬空回收]";
// 发送账号池（profile=手机 profile 名，id=抖音号，label=写进「实际分发号」的展示名）
const SENDERS = [
  { profile: "jinoshengyuan-work", id: "langzi63485", label: "小号1 躺赢AI学姐" },
  { profile: "legacy", id: "44997267357", label: "小号2 人工智能小诺考评" },
];
function argValue(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
(async () => {
  const tr = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ app_id: acc.appId, app_secret: acc.appSecret }) });
  const tok = (await tr.json()).tenant_access_token;
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  async function all(table) {
    const rows = []; let pt = "";
    do {
      const r = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${table}/records?page_size=100&automatic_fields=true${pt?"&page_token="+pt:""}`, { headers: H })).json();
      rows.push(...(r.data.items || []));
      pt = r.data.has_more ? r.data.page_token : "";
    } while (pt);
    return rows;
  }

  if (MODE === "done") {
    const [,,, rid, result, noteB64] = process.argv;
    const note = noteB64 ? Buffer.from(noteB64, "base64").toString() : "";
    const now = new Date(Date.now()+8*3600e3).toISOString().replace("T"," ").slice(0,16)+"(UTC+8)";
    let fields;
    if (result === "sent") {
      // 0919: 真机ADB二进制目前无法探测"对方未加好友",降级写"待确认"而非冒充"是"；
      // 原始设备输出(note)透传进回复结果供人工核实(判定点 e035dad8 范畴)。
      fields = { "状态": "已触达", "发送状态": "已发送", "触达时间": now, "成功触达": "待确认", "回复结果": ("[老链路待人工核验]" + note).slice(0, 200) };
    } else if (result === "restricted") {
      // 0919 真机实证: 气泡渲染成功但对方"仅互关可发消息"限制生效,消息实际收不到,不冒充"是"
      fields = lib.restrictedFields(note, now);
    } else if (result === "requeue") {
      fields = { "状态": "待触达" };  // 环境性失败(锁忙/设备离线): 回队列,不算受阻
    } else if (result === "rate_limited") {
      // 0923真机实证(单#172原始XML): 气泡渲染成功≠真送达的第二种情形——短期内私信陌生人
      // 过于频繁撞平台风控,之前被当"sent"计成功。这是账号级、不是这条线索的问题,状态回
      // 待触达(下次账号限流解除后能正常重发),但note要落进回复结果留痕,不能只写本机日志
      // (人工/质检回看这条线索时,要能看出"不是没送到人,是账号那天被限流了"，不是猜的)。
      fields = { "状态": "待触达", "回复结果": ("[触发风控,待限流解除后重发]" + note).slice(0, 200) };
    } else if (result === "requeue_transient") {
      // 瞬时失败(IME/前台波动)执行内10次用尽: 1轮回队/2轮受阻(决策 c5828297)
      const cur = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${rid}`, { headers: H })).json();
      const prev = txt(cur?.data?.record?.fields?.["回复结果"]);
      fields = lib.requeueTransientFields(prev, note, now);
    } else {
      // 0915: 失败单转「触达受阻」——不回待触达,防高优先级单(重复高亮)无限重选死循环;
      // 受阻单人工复核或走"来源视频评论区反向进主页"路线(字母号搜索不可达实证: LHJ20001024 首屏8卡全是近似号)
      fields = { "状态": "触达受阻", "发送状态": "发送失败", "回复结果": ("[受阻]" + note).slice(0,200) };
    }
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${rid}`, { method: "PUT", headers: H, body: JSON.stringify({ fields }) })).json();
    console.log(res.code === 0 ? "MARKED " + result : "MARK_FAIL " + JSON.stringify(res).slice(0,120));
    return;
  }

  // next: 选单
  const RECORD_URL = (rid) => `https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${rid}`;
  const putRecord = async (rid, fields) => (await fetch(RECORD_URL(rid), { method: "PUT", headers: H, body: JSON.stringify({ fields }) })).json();
  const excluded = lib.parseExclude(argValue("--exclude"));
  const [leads, scripts] = await Promise.all([all(LEADS), all(SCRIPTS)]);
  // 悬空回收: 「触达中」超过 40 分钟没回写 = tick 崩溃/回写失败留下的悬空单，放回「待触达」(留痕在回复结果)。
  // 回收本身失败只跳过，不阻塞选单；数量走 stderr，stdout 只放选单 JSON/哨兵字样。
  let swept = 0;
  const nowMs = Date.now();
  for (const r of leads) {
    if (!lib.isStaleInflight(r, nowMs, INFLIGHT_TTL_MS)) continue;
    const reply = txt(r.fields["回复结果"]);
    const newReply = (reply.includes(SWEEP_TAG) ? reply : SWEEP_TAG + reply).slice(0, 200);
    try {
      const res = await putRecord(r.record_id, { "状态": "待触达", "回复结果": newReply });
      if (res.code === 0) { swept++; r.fields["状态"] = "待触达"; r.fields["回复结果"] = newReply; }
    } catch (e) { /* 回收失败不阻塞选单 */ }
  }
  if (swept) console.error("swept_inflight=" + swept);
  const sent = leads.filter(r => txt(r.fields["状态"]) === "已触达").length;
  let pending = [];
  const noLink = [];
  for (const r of leads) {
    if (txt(r.fields["状态"]) !== "待触达") continue;
    (lib.classifyPending(r.fields) === "ok" ? pending : noLink).push(r);
  }
  // 缺链接上游闸(决策 c5828297): 链接=出单必备件,缺件单标「待补链」交回采集补链,
  // 不再送搜索路线撞墙。写新 select 值失败(字段选项受限)降级只写备注,不阻塞选单。
  let gated = 0;
  for (const r of noLink) {
    gated++;
    const reply = txt(r.fields["回复结果"]);
    if (reply.includes("[待补链]")) continue; // 降级标记过的行不重写
    const mark = { "回复结果": ("[待补链]" + reply).slice(0, 200) };
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${r.record_id}`, { method: "PUT", headers: H, body: JSON.stringify({ fields: { "状态": "待补链", ...mark } }) })).json();
    if (res.code !== 0) {
      await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${r.record_id}`, { method: "PUT", headers: H, body: JSON.stringify({ fields: mark }) });
    }
  }
  if (gated) console.error("gated_no_link=" + gated);
  // 触达等级门槛(决策 67762358): 只触达路由表 outreachGrades 里的等级；被滤掉的线索保持「待触达」不动。
  const beforeGrade = pending.length;
  pending = pending.filter(r => lib.gradeAllowed(lib.leadGrade(r.fields), ROUTE.outreachGrades));
  if (beforeGrade - pending.length) console.error("grade_filtered=" + (beforeGrade - pending.length));
  if (!pending.length) { console.log("NO_PENDING"); return; }
  const gradeOf = r => lib.gradeRank(lib.leadGrade(r.fields));
  pending.sort((a, b) => (Number(b.fields["重复命中次数"])||0) - (Number(a.fields["重复命中次数"])||0) || gradeOf(a) - gradeOf(b));
  const pick = pending[0];
  // 选号: 避开 tick 传来的 --exclude(熔断/当日停发/撞上限的账号)。全被排除 → NO_SENDER。
  // 必须在预写「触达中」之前判定,不能动线索(否则又是一次无谓回队列/空转)。
  const sender = lib.pickSender(SENDERS, excluded);
  if (!sender) { console.log("NO_SENDER"); return; }
  const lead = lib.extractLead(pick.fields);
  const nick = lead.nick, dyid = lead.dyid;
  // 话术分配: 序号n(已触达数): n%10∈{0,2,4,6,8}→B; {1,5,9}→A1; {3,7}→A2
  const slot = sent % 10;
  const ver = [0,2,4,6,8].includes(slot) ? "B" : [1,5,9].includes(slot) ? "A1" : "A2";
  const sc = scripts.find(s => txt(s.fields["子版本"]) === ver && txt(s.fields["启用状态"]) === "启用");
  if (!sc) { console.log("NO_SCRIPT " + ver); return; }
  const msg = txt(sc.fields["话术正文"]);
  // 0922真机实证: 原按 sent(今日已触达数)奇偶轮流分配账号——但 sent 只在真正成功
  // 触达后才变化,若队首这条(pending[0]确定性排序,失败不会挪到队尾)恰好分给一个
  // 暂停/故障账号,sent 永远不变→死循环永远选中同一个坏账号,整条队列(含legacy)
  // 全部卡死(0922实测:同一条记录连续3个tick原地重试,legacy完全轮不上)。
  // 改成每次调用独立随机选号(lib.pickSender,rand 默认 Math.random): 队首记录卡在坏账号上时,
  // 下次调用有机会随机换到健康账号;0928 起更进一步——tick 把不可用账号经 --exclude 传进来,
  // 选单器根本不会再选到它们(此前熔断后每 ~20 秒空转一轮)。
  // 预写触达中(防 tick 重入)——0928 起写后必须回读校验(状态/分发号/话术ID),
  // 写失败也照发会让单子悬空、下个 tick 又被重复选中。
  const scriptId = txt(sc.fields["话术ID"]);
  const senderLabel = sender.label + "(" + sender.id + ")";
  let claimErr = "", claimUncertain = false;
  try {
    const res = await putRecord(pick.record_id, {
      "状态": "触达中", "话术ID": scriptId, "话术版本": ver,
      "话术内容": msg, "客服编号": txt(sc.fields["客服编号"]) || "无", "客服电话": txt(sc.fields["客服电话"]) || "",
      "实际分发号": senderLabel, "分配序号": sent + 1,
    });
    if (res.code !== 0) {
      claimErr = "PUT code=" + res.code;
    } else {
      const back = await (await fetch(RECORD_URL(pick.record_id), { headers: H })).json();
      const v = lib.verifyClaim(back?.data?.record?.fields, { sender_label_with_id: senderLabel, script_id: scriptId });
      if (!v.ok) { claimErr = "回读不符 " + v.reason; claimUncertain = true; }
    }
  } catch (e) {
    claimErr = "异常 " + String(e && e.message || e).slice(0, 80);
    claimUncertain = true;
  }
  if (claimErr) {
    // PUT 已成功但回读不符/异常: 尽力把状态改回待触达一次,失败也别抛。
    if (claimUncertain) { try { await putRecord(pick.record_id, { "状态": "待触达" }); } catch (e) { /* 尽力而为 */ } }
    console.log("CLAIM_FAILED " + claimErr);
    return;
  }
  console.log(JSON.stringify({ rid: pick.record_id, nick, dyid, profile_url: lead.profileUrl, ver, script_id: txt(sc.fields["话术ID"]),
    msg_b64: Buffer.from(msg).toString("base64"), profile: sender.profile, sender_id: sender.id, seq: sent + 1, dup: Number(pick.fields["重复命中次数"])||0 }));
})();
