// judge-video.js —— 视频文案判定主脚本(阶段3:V1扫池→V2便宜闸→V3转写→V4判定)
//
// 用法: node judge-video.js <line_key|profile> <manifest.json>  (profile 名经 line-routes.js 归一)
//   manifest.json: [{videoId, audioPath?, transcript?}, ...] —— 由真机侧(harvest-keyword.sh
//   配合douyin-phone-adb的record-start/record-stop/record-extract-audio)产出音频文件后,
//   生成这份清单交给本脚本处理。本脚本自己不碰ADB/真机,只负责"转写+判定+写库"这一段。
//
// ⚠️ 目标客户画像(TARGET_PROFILES)目前是写死在本文件里的占位值,后续要不要挪到飞书
// 配置表(像GOLD/JUNK_WORDS现在也是写死在sort-comments.js里一样)由主理人后续拍板。
"use strict";
const fs = require("fs");
const { routeOf } = require("./line-routes.js");
const { shouldSkipCheapGate, resolveTranscriptSource } = require("./judge-video-lib.js");

const TARGET_PROFILES = {
  jinuo: "AI人工智能训练师考证意向人群:关注AI技能证书、求职提升、培训报名的用户",
  yuesheng: "悦升云端目标客户:企业级AI部署决策者/OPC小微主体主/AI办公入门学习者",
};

// 生产依赖惰性加载:单测经 deps 注入假实现,不触发 pg / 网络模块。
function defaultDeps() {
  const db = require("./leadgen-db-lib.js");
  return {
    listPendingVideos: db.listPendingVideos,
    markVideoJudgment: db.markVideoJudgment,
    markVideoJudgeError: db.markVideoJudgeError,
    discoverVideo: db.discoverVideo,
    getVideo: db.getVideo,
    markVideoCollected: db.markVideoCollected,
    transcribeAudio: require("./transcribe-qwen-audio.js").transcribeAudio,
    judgeContent: require("./judge-jev.js").judgeContent,
  };
}

// 单个视频判定(V2-V4)——批量重判(runJudgeVideo)与先判后采的行内判定(qualify-video.js,任务 8bb3af55)共用一套口径。
// 回 { outcome: matched|rejected|pending, reason, kind, transcript }:
//   cheap_gate      零评论便宜闸(只在 cheapGate=true 时;行内判定时评论数尚未读到,传 false 关掉)
//   empty_transcript 死寂/静音音频转写为空 → rejected(不是"没判成",重试也不会变好)
//   transcribe_error 转写调用失败(网络/超时/鉴权) → pending,下一轮重试
//   no_source        既无转写也无标题 → pending
//   judge_error      判定 API 故障(JudgeApiError 口径:OpenRouter 402/429/网络) → pending,judgment_reason 记「判定异常(待重判)」
//   judged           正常判定 → matched/rejected(已写库)
async function judgeOneVideo({ video, manifestEntry, lineKey, targetProfile, pool, deps = defaultDeps(), cheapGate = true }) {
  if (cheapGate && shouldSkipCheapGate(video)) {
    const reason = "V2便宜闸:零评论";
    await deps.markVideoJudgment(pool, { lineKey, videoId: video.video_id, verdict: "rejected", reason });
    return { outcome: "rejected", reason, kind: "cheap_gate" };
  }
  const src = resolveTranscriptSource(video, manifestEntry);

  let transcript = src.text;
  if (src.source === "needs_transcription") {
    try {
      transcript = await deps.transcribeAudio(src.audioPath);
    } catch (e) {
      const msg = String(e.message || e).slice(0, 120);
      console.error(`  转写失败 video=${video.video_id}: ${msg}`);
      // 0929修复(DoD审计发现,用户拍板): 空转写(死寂/静音音频)不是"没判成"，是"真的没内容"，
      // 直接判rejected，不再无限期占pending队列重试；其余(网络/超时/鉴权)仍留pending重试。
      if (e.emptyTranscript) {
        const reason = "转写为空(死寂/静音音频)";
        await deps.markVideoJudgment(pool, { lineKey, videoId: video.video_id, verdict: "rejected", reason });
        return { outcome: "rejected", reason, kind: "empty_transcript" };
      }
      // 转写调用本身失败(网络/超时/鉴权)先跳过,留pending,下一轮重试,不误判成rejected
      return { outcome: "pending", reason: `转写失败: ${msg}`, kind: "transcribe_error" };
    }
  }
  if (src.source === "none" || !transcript) {
    console.error(`  video=${video.video_id} 没有任何可判定的文本来源(既无转写也无标题),跳过`);
    return { outcome: "pending", reason: "无可判定文本", kind: "no_source" };
  }

  let verdict;
  try {
    verdict = await deps.judgeContent(transcript, targetProfile);
  } catch (e) {
    // 0929: 判定 API 故障(OpenRouter 402/429/网络)≠内容不相关。不写 rejected,
    // 保持 pending 并在 judgment_reason 记原因,充值/恢复后下一轮自然重判。
    const msg = String((e && e.message) || e).slice(0, 200);
    console.error(`  判定异常 video=${video.video_id}: ${msg}(保持pending,待重判)`);
    const reason = `判定异常(待重判): ${msg}`;
    await deps.markVideoJudgeError(pool, { lineKey, videoId: video.video_id, reason, transcript });
    return { outcome: "pending", reason, kind: "judge_error" };
  }
  await deps.markVideoJudgment(pool, {
    lineKey, videoId: video.video_id, verdict: verdict.verdict, reason: verdict.reason, transcript,
  });
  return { outcome: verdict.verdict === "matched" ? "matched" : "rejected", reason: verdict.reason, kind: "judged" };
}

// 0929 生产实证: batch2.sh 传的是账号 profile 名(legacy/jinoshengyuan-work/yueshengyun-work),
// 而画像与 leadgen_videos.line_key 都按路由键(jinuo/yuesheng)——入口不归一,每晚都
// 「未配置line_key=legacy的目标客户画像」退出,230 条视频从上线起没判过一条。
// 入口一律经 routeOf() 归一:profile 名、路由键、业务线名都认;认不出就抛错,不猜。
function resolveLine(lineHint) {
  const lineKey = routeOf(lineHint).key;
  const targetProfile = TARGET_PROFILES[lineKey];
  if (!targetProfile) throw new Error(`judge-video: 未配置line_key=${lineKey}的目标客户画像`);
  return { lineKey, targetProfile };
}

// 批量重判(8bb3af55 之后不再挂在 batch2.sh 落池之后跑——那时评论早已采完;保留给人工/补判扫 pending 池用)
async function runJudgeVideo({ lineHint, manifest = [], pool, deps = defaultDeps() }) {
  const { lineKey, targetProfile } = resolveLine(lineHint);
  const manifestByVideoId = new Map(manifest.map((m) => [m.videoId, m]));

  const pending = await deps.listPendingVideos(pool, lineKey, 200);

  const stats = { pending: pending.length, skipped: 0, matched: 0, rejected: 0, noSource: 0, judgeError: 0 };
  for (const video of pending) {
    const r = await judgeOneVideo({ video, manifestEntry: manifestByVideoId.get(video.video_id), lineKey, targetProfile, pool, deps });
    if (r.kind === "cheap_gate") stats.skipped++;
    else if (r.kind === "no_source") stats.noSource++;
    else if (r.kind === "judge_error") stats.judgeError++;
    else if (r.outcome === "matched") stats.matched++;
    else if (r.outcome === "rejected") stats.rejected++;
  }

  console.log(`judge-video: 业务线${lineKey}(入参${lineHint}) | 待判定${stats.pending} | 便宜闸跳过${stats.skipped} | matched${stats.matched} | rejected${stats.rejected} | 无来源${stats.noSource} | 判定异常${stats.judgeError}条(保持pending待重判)`);
  return stats;
}

async function main() {
  const [, , lineHint, manifestPath] = process.argv;
  if (!lineHint || !manifestPath) {
    console.error("usage: node judge-video.js <line_key|profile> <manifest.json>");
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const { getPool } = require("./leadgen-db-connect.js");
  const pool = getPool();
  try {
    await runJudgeVideo({ lineHint, manifest, pool });
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error("judge-video: 致命错误", e);
    process.exit(1);
  });
}

module.exports = { main, runJudgeVideo, judgeOneVideo, resolveLine, defaultDeps, TARGET_PROFILES };
