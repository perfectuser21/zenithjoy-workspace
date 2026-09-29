// qualify-video.js —— 先判后采的逐视频远端判定入口(任务 8bb3af55,决策 f18f56b8①「判定合格的视频才采集」)
//
// harvest-keyword.sh 在执行机(xian-m4/M1)上逐视频经 ssh 到 mmv 调本脚本(PG 与模型凭据只在 mmv):
//   node qualify-video.js discover  --line L --video-id V [--video-url U] [--title-b64 B] [--keyword-b64 K] [--batch T]
//     → 候选视频落 leadgen_videos(pending/待判定,本批 harvest_batch/keyword),回报已有判定当缓存
//   node qualify-video.js judge     --line L --video-id V [--audio /tmp/x.wav]
//     → 转写+判定单个视频并写库(已判过的直接回报库里结论,不重复花钱)
//   node qualify-video.js collected --line L --video-id V --count N
//     → 采完评论标 process_status=评论已采(只写给 matched 视频)
// stdout 最后一行恰好一条 `QUAL_DISCOVER|QUAL_RESULT|QUAL_COLLECTED {json}`(stats-line.js 形状),永远 exit 0:
//   调用方只认 verdict=matched 才开评论区;任何出错(库不可达/判定接口故障/写库失败)都回 pending——
//   视频留 pending 本轮不采、留待重判,不挡同批其它视频(JudgeApiError 口径,见 judge-video.js judgeOneVideo)。
// title/keyword 走 base64:经 ssh 远端 shell 传中文与引号不必再转义。
"use strict";
const { statsLine } = require("./stats-line.js");
const { judgeOneVideo, resolveLine, defaultDeps } = require("./judge-video.js");

const TAG = { discover: "QUAL_DISCOVER", judge: "QUAL_RESULT", collected: "QUAL_COLLECTED" };
const errMsg = (e) => String((e && e.message) || e).slice(0, 200);
const b64 = (v) => (v ? Buffer.from(v, "base64").toString("utf8") : "");

function parseArgs(argv) {
  const a = { cmd: argv[0] || "" };
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    if (k.endsWith("B64")) a[k.slice(0, -3)] = b64(v); else a[k] = v;
  }
  return a;
}

async function discover(args, pool, deps, lineKey) {
  try {
    return await deps.discoverVideo(pool, {
      lineKey, videoId: args.videoId, videoUrl: args.videoUrl || null, title: args.title || "",
      keyword: args.keyword || null, harvestBatch: args.batch || null,
    });
  } catch (e) {
    return { status: "error", error: errMsg(e) };
  }
}

async function judge(args, pool, deps, lineKey, targetProfile) {
  let video;
  try {
    video = await deps.getVideo(pool, lineKey, args.videoId);
  } catch (e) {
    return { verdict: "pending", kind: "db_error", error: errMsg(e) };
  }
  if (!video) return { verdict: "pending", kind: "not_discovered", reason: "视频未落库(discover 没成功),本轮不采" };
  if (video.judgment_status === "matched" || video.judgment_status === "rejected") {
    return { verdict: video.judgment_status, kind: "cached", reason: video.judgment_reason || "" };
  }
  try {
    const manifestEntry = args.audio ? { videoId: args.videoId, audioPath: args.audio } : undefined;
    const r = await judgeOneVideo({ video, manifestEntry, lineKey, targetProfile, pool, deps, cheapGate: false });
    return { verdict: r.outcome, kind: r.kind, reason: r.reason || "" };
  } catch (e) {
    // 写库失败/判定器内部异常:库里没落下 matched 就不许采
    return { verdict: "pending", kind: "error", error: errMsg(e) };
  }
}

async function collected(args, pool, deps, lineKey) {
  try {
    return await deps.markVideoCollected(pool, { lineKey, videoId: args.videoId, commentCount: Number(args.count) || 0 });
  } catch (e) {
    return { updated: 0, error: errMsg(e) };
  }
}

async function runQualify({ cmd, args, pool, deps = defaultDeps() }) {
  if (!TAG[cmd]) return { verdict: "pending", error: `未知子命令: ${cmd}` };
  let line;
  try {
    line = resolveLine(args.line);
  } catch (e) {
    return cmd === "discover" ? { status: "error", error: errMsg(e) } : { verdict: "pending", updated: 0, error: errMsg(e) };
  }
  if (!args.videoId) return { verdict: "pending", status: "error", error: "缺 --video-id" };
  if (cmd === "discover") return discover(args, pool, deps, line.lineKey);
  if (cmd === "judge") return judge(args, pool, deps, line.lineKey, line.targetProfile);
  return collected(args, pool, deps, line.lineKey);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tag = TAG[args.cmd] || "QUAL_RESULT";
  let pool;
  let out;
  try {
    pool = require("./leadgen-db-connect.js").getPool();
    out = await runQualify({ cmd: args.cmd, args, pool });
  } catch (e) {
    out = { verdict: "pending", status: "error", error: errMsg(e) };
  }
  if (pool) await pool.end().catch(() => {});
  process.stdout.write(`${statsLine(tag, out)}\n`, () => process.exit(0));
}

if (require.main === module) main();

module.exports = { runQualify, parseArgs };
