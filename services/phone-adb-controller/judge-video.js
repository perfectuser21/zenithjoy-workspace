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
    transcribeAudio: require("./transcribe-qwen-audio.js").transcribeAudio,
    judgeContent: require("./judge-jev.js").judgeContent,
  };
}

// 0929 生产实证: batch2.sh 传的是账号 profile 名(legacy/jinoshengyuan-work/yueshengyun-work),
// 而画像与 leadgen_videos.line_key 都按路由键(jinuo/yuesheng)——入口不归一,每晚都
// 「未配置line_key=legacy的目标客户画像」退出,230 条视频从上线起没判过一条。
// 入口一律经 routeOf() 归一:profile 名、路由键、业务线名都认;认不出就抛错,不猜。
async function runJudgeVideo({ lineHint, manifest = [], pool, deps = defaultDeps() }) {
  const lineKey = routeOf(lineHint).key;
  const targetProfile = TARGET_PROFILES[lineKey];
  if (!targetProfile) throw new Error(`judge-video: 未配置line_key=${lineKey}的目标客户画像`);
  const manifestByVideoId = new Map(manifest.map((m) => [m.videoId, m]));

  const pending = await deps.listPendingVideos(pool, lineKey, 200);

  const stats = { pending: pending.length, skipped: 0, matched: 0, rejected: 0, noSource: 0 };
  for (const video of pending) {
    if (shouldSkipCheapGate(video)) {
      stats.skipped++;
      await deps.markVideoJudgment(pool, { lineKey, videoId: video.video_id, verdict: "rejected", reason: "V2便宜闸:零评论" });
      continue;
    }
    const src = resolveTranscriptSource(video, manifestByVideoId.get(video.video_id));

    let transcript = src.text;
    if (src.source === "needs_transcription") {
      try {
        transcript = await deps.transcribeAudio(src.audioPath);
      } catch (e) {
        console.error(`  转写失败 video=${video.video_id}: ${String(e.message || e).slice(0, 120)}`);
        // 0929修复(DoD审计发现,用户拍板): 空转写(死寂/静音音频)不是"没判成"，是"真的没内容"，
        // 直接判rejected，不再无限期占pending队列重试；其余(网络/超时/鉴权)仍留pending重试。
        if (e.emptyTranscript) {
          await markVideoJudgment(pool, { lineKey, videoId: video.video_id, verdict: "rejected", reason: "转写为空(死寂/静音音频)" });
          rejected++;
          continue;
        }
        continue; // 转写调用本身失败(网络/超时/鉴权)先跳过,留pending,下一轮重试,不误判成rejected
      }
    }
    if (src.source === "none" || !transcript) {
      stats.noSource++;
      console.error(`  video=${video.video_id} 没有任何可判定的文本来源(既无转写也无标题),跳过`);
      continue;
    }

    const verdict = await deps.judgeContent(transcript, targetProfile);
    await deps.markVideoJudgment(pool, {
      lineKey, videoId: video.video_id, verdict: verdict.verdict, reason: verdict.reason, transcript,
    });
    if (verdict.verdict === "matched") stats.matched++; else stats.rejected++;
  }

  console.log(`judge-video: 业务线${lineKey}(入参${lineHint}) | 待判定${stats.pending} | 便宜闸跳过${stats.skipped} | matched${stats.matched} | rejected${stats.rejected} | 无来源${stats.noSource}`);
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

module.exports = { main, runJudgeVideo, TARGET_PROFILES };
