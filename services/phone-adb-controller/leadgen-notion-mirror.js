// leadgen-notion-mirror.js —— 获客业务数据 PG → Notion 镜像（任务 f6ad056e，决策 a029a7a7）
//
// 真身：hk-vps zenithjoy 库 zenithjoy.leadgen_videos / leadgen_comments / leadgen_leads（获客流程写）。
// 镜子：Notion「数据落脚总台账 › 获客业务数据（PG 镜像）」下三张库：获客·视频 / 获客·评论 / 获客·线索（内部看，视觉好）。
// 飞书多维表照旧由 push-videos.js / push-raw-comments.js / push-leads.js / next-outreach.js 写（客户交付），本脚本不碰飞书。
//
// 为什么跑在 MMV、不在 Brain：hk-vps 的 PG 只监听 127.0.0.1，us-vps（Brain）既没有到它的隧道、本机也没有 zenithjoy 库；
// MMV 已有常驻隧道 com.zenithjoy.pg-tunnel-hk（127.0.0.1:15532 → hk-vps:5432）和获客脚本运行目录，
// 本文件随 deploy.sh 的 MMV_JS_FILES 自动下发到 ~/.openclaw/leadgen-scripts/，由 launchd com.zenithjoy.leadgen-notion-mirror
// 每 5 分钟跑一轮（模板 launchd/com.zenithjoy.leadgen-notion-mirror.plist）。
//
// 用法：node leadgen-notion-mirror.js            三表各同步一轮，stdout 打一行 JSON 汇总，有失败 exit 1
//   凭据：DATABASE_URL 缺省读 ~/.credentials/zenithjoy-db.env；NOTION_API_KEY 缺省读 ~/.credentials/notion.env（不打印）。
//   父页：LEADGEN_NOTION_PARENT_PAGE_ID 覆盖默认父页。
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { P, syncMirror, createNotionReq } = require("./pg-notion-mirror-lib.js");
const { ROUTES } = require("./line-routes.js");

// Notion「数据落脚总台账」下的「获客业务数据（PG 镜像）」页
const DEFAULT_PARENT_PAGE_ID = "3f5c40c2-ba63-811c-a1da-e55b6c1ed1e9";

/** 路由键 → 客户语义的业务线名；认不出原样显示（不兜底成别家业务线，同 line-routes 0922 规矩） */
function lineLabel(lineKey) {
  const r = ROUTES.find((x) => x.key === lineKey || (x.profiles || []).includes(lineKey));
  return r ? r.line : lineKey || "";
}

/** 线索意向等级：评论池分拣等级优先，其次 AI 判定理由「[X] …」前缀 */
function leadGrade(row) {
  if (row.comment_grade) return row.comment_grade;
  const m = /^\s*\[([A-E])\]/.exec(row.ai_judgment_reason || "");
  return m ? m[1] : null;
}

const VIDEO_JUDGMENT = { pending: "待判定", matched: "合格", rejected: "不合格" };
const GRADE_OPTIONS = { select: { options: [
  { name: "A", color: "red" }, { name: "B", color: "orange" }, { name: "C", color: "yellow" }, { name: "D", color: "gray" }, { name: "E", color: "default" },
] } };
const LINE_OPTIONS = { select: { options: ROUTES.map((r, i) => ({ name: r.line, color: ["blue", "purple", "green", "pink"][i % 4] })) } };
const T = { title: {} }, TXT = { rich_text: {} }, SEL = { select: {} }, NUM = { number: { format: "number" } }, URL = { url: {} }, DATE = { date: {} };

function buildVideoProps(r) {
  return {
    "视频标题": P.title(r.title || r.video_id),
    "业务线": P.select(lineLabel(r.line_key)),
    "视频链接": P.url(r.video_url),
    "视频ID": P.text(r.video_id),
    "搜索关键词": P.text(r.keyword),
    "处理进度": P.select(r.process_status),
    "判定结论": P.select(VIDEO_JUDGMENT[r.judgment_status] || r.judgment_status),
    "判定理由": P.text(r.judgment_reason),
    "评论数": P.number(r.comment_count),
    "采集批次": P.text(r.harvest_batch),
    "视频文案": P.text(r.transcript),
    "发现时间": P.date(r.discovered_at),
    "更新时间": P.date(r.updated_at),
  };
}

function buildCommentProps(r) {
  return {
    "评论": P.title(`${r.nickname || ""}：${r.comment_body || ""}`, 120),
    "评论内容": P.text(r.comment_body),
    "昵称": P.text(r.nickname),
    "抖音号": P.text(r.douyin_id),
    "抖音主页链接": P.url(r.profile_url),
    "业务线": P.select(lineLabel(r.line_key)),
    "意向等级": P.select(r.intent_grade),
    "相关性": P.select(r.relevance),
    "分拣状态": P.select(r.process_status),
    "来源视频": P.text(r.source_video),
    "来源视频链接": P.url(r.source_video_url),
    "搜索关键词": P.text(r.keyword),
    "账号类型": P.select(r.account_type),
    "地区": P.text(r.region || r.profile_ip),
    "评论时间": P.text(r.comment_time),
    "判定理由": P.text(r.judgment_reason),
    "采集批次": P.text(r.harvest_batch),
    "采集时间": P.date(r.collected_at),
  };
}

function buildLeadProps(r) {
  return {
    "昵称": P.title(r.nickname),
    "抖音号": P.text(r.douyin_id),
    "抖音主页链接": P.url(r.profile_url),
    "意向等级": P.select(leadGrade(r)),
    "触达状态": P.select(r.status),
    "发送状态": P.select(r.send_status),
    "来源视频": P.text(r.source_video),
    "来源视频链接": P.url(r.source_video_url),
    "业务线": P.select(lineLabel(r.line_key)),
    "评论内容": P.text(r.comment_body),
    "AI判定理由": P.text(r.ai_judgment_reason),
    "重复命中次数": P.number(r.dup_hit_count),
    "话术版本": P.text(r.script_version),
    "触达时间": P.date(r.reached_at),
    "入库时间": P.date(r.created_at),
    "更新时间": P.date(r.updated_at),
  };
}

const marker = (table) => `PG zenithjoy.${table} → Notion 只读镜子（leadgen-notion-mirror.js，任务 f6ad056e）；改数据请改 PG，Notion 手改会被覆盖`;

const SPECS = [
  {
    key: "videos", title: "获客·视频", marker: marker("leadgen_videos"),
    properties: { "视频标题": T, "业务线": LINE_OPTIONS, "视频链接": URL, "视频ID": TXT, "搜索关键词": TXT, "处理进度": SEL,
      "判定结论": { select: { options: [{ name: "合格", color: "green" }, { name: "不合格", color: "red" }, { name: "待判定", color: "gray" }] } },
      "判定理由": TXT, "评论数": NUM, "采集批次": TXT, "视频文案": TXT, "发现时间": DATE, "更新时间": DATE },
    selectSql: `SELECT id, line_key, video_id, video_url, title, keyword, comment_count, discovered_at, harvest_batch, process_status,
                       judgment_status, judgment_reason, left(transcript, 1900) AS transcript, updated_at
                  FROM zenithjoy.leadgen_videos ORDER BY discovered_at, id`,
    buildProps: buildVideoProps,
  },
  {
    key: "comments", title: "获客·评论", marker: marker("leadgen_comments"),
    properties: { "评论": T, "评论内容": TXT, "昵称": TXT, "抖音号": TXT, "抖音主页链接": URL, "业务线": LINE_OPTIONS, "意向等级": GRADE_OPTIONS,
      "相关性": SEL, "分拣状态": SEL, "来源视频": TXT, "来源视频链接": URL, "搜索关键词": TXT, "账号类型": SEL, "地区": TXT,
      "评论时间": TXT, "判定理由": TXT, "采集批次": TXT, "采集时间": DATE },
    selectSql: `SELECT id, line_key, harvest_batch, collected_at, keyword, source_video, source_video_url, comment_body, nickname, douyin_id,
                       profile_url, account_type, comment_time, profile_ip, region, process_status, relevance, intent_grade, judgment_reason
                  FROM zenithjoy.leadgen_comments ORDER BY collected_at, id`,
    buildProps: buildCommentProps,
  },
  {
    key: "leads", title: "获客·线索", marker: marker("leadgen_leads"),
    properties: { "昵称": T, "抖音号": TXT, "抖音主页链接": URL, "意向等级": GRADE_OPTIONS, "触达状态": SEL, "发送状态": SEL, "来源视频": TXT,
      "来源视频链接": URL, "业务线": LINE_OPTIONS, "评论内容": TXT, "AI判定理由": TXT, "重复命中次数": NUM, "话术版本": TXT,
      "触达时间": DATE, "入库时间": DATE, "更新时间": DATE },
    // 意向等级与来源视频链接：线索表没有这两列，取评论池同业务线同昵称（优先同抖音号）的最近一条
    selectSql: `SELECT l.id, l.line_key, l.nickname, l.douyin_id, l.profile_url, l.comment_body, l.source_video, l.status, l.send_status,
                       l.ai_judgment_reason, l.dup_hit_count, l.script_version, l.reached_at, l.created_at, l.updated_at,
                       c.intent_grade AS comment_grade, c.source_video_url
                  FROM zenithjoy.leadgen_leads l
                  LEFT JOIN LATERAL (
                    SELECT intent_grade, source_video_url FROM zenithjoy.leadgen_comments c
                     WHERE c.line_key = l.line_key AND c.nickname = l.nickname
                     ORDER BY (c.douyin_id IS NOT DISTINCT FROM l.douyin_id) DESC, (c.intent_grade IS NOT NULL) DESC, c.updated_at DESC
                     LIMIT 1) c ON true
                 ORDER BY l.created_at, l.id`,
    buildProps: buildLeadProps,
  },
];

/** 三表依次同步；单表失败不阻断后面的表。返回 { ok, tables: [stat…] } */
async function runOnce({ pool, notionReq, parentPageId, syncImpl = syncMirror, log = (m) => console.error(m) }) {
  const tables = [];
  for (const spec of SPECS) {
    try {
      tables.push(await syncImpl({ pool, notionReq, parentPageId, spec, log }));
    } catch (err) {
      tables.push({ key: spec.key, failed: 1, fatal: true, errors: [String(err?.message || err).slice(0, 200)] });
    }
  }
  return { ok: tables.every((t) => !t.failed && !t.fatal), tables };
}

/** env 文件文本 → 对象（认 export 前缀、单/双引号、注释） */
function parseEnvText(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function loadCredential(name, file) {
  if (process.env[name]) return process.env[name];
  try { return parseEnvText(fs.readFileSync(path.join(os.homedir(), ".credentials", file), "utf8"))[name] || null; } catch { return null; }
}

/** 同机防并发：mkdir 锁，超过 30 分钟视为上轮崩溃残留 */
function acquireLock(dir = path.join(os.tmpdir(), "leadgen-notion-mirror.lock")) {
  try { fs.mkdirSync(dir); } catch {
    let age = 0;
    try { age = Date.now() - fs.statSync(dir).mtimeMs; } catch { /* 刚被释放 */ }
    if (age < 30 * 60 * 1000) return null;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir);
  }
  return () => fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  const release = acquireLock();
  if (!release) { console.log(JSON.stringify({ skipped: "locked" })); return 0; }
  let pool;
  try {
    const dbUrl = loadCredential("DATABASE_URL", "zenithjoy-db.env");
    const token = loadCredential("NOTION_API_KEY", "notion.env");
    if (!dbUrl || !token) throw new Error(`缺凭据：${!dbUrl ? "DATABASE_URL " : ""}${!token ? "NOTION_API_KEY" : ""}`);
    process.env.DATABASE_URL = dbUrl;
    pool = require("./leadgen-db-connect.js").getPool();
    const started = Date.now();
    const out = await runOnce({ pool, notionReq: createNotionReq(token), parentPageId: process.env.LEADGEN_NOTION_PARENT_PAGE_ID || DEFAULT_PARENT_PAGE_ID });
    console.log(JSON.stringify({ at: new Date().toISOString(), ms: Date.now() - started, ...out }));
    return out.ok ? 0 : 1;
  } catch (err) {
    console.log(JSON.stringify({ at: new Date().toISOString(), ok: false, error: String(err?.message || err).slice(0, 300) }));
    return 1;
  } finally {
    if (pool) await pool.end().catch(() => {});
    release();
  }
}

if (require.main === module) main().then((code) => process.exit(code));

module.exports = { SPECS, DEFAULT_PARENT_PAGE_ID, buildVideoProps, buildCommentProps, buildLeadProps, leadGrade, lineLabel, runOnce, parseEnvText };
