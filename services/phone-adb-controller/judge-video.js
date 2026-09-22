// judge-video.js —— 视频文案判定主脚本(阶段3:V1扫池→V2便宜闸→V3转写→V4判定)
//
// 用法: node judge-video.js <line_key> <manifest.json>
//   manifest.json: [{videoId, audioPath?, transcript?}, ...] —— 由真机侧(harvest-keyword.sh
//   配合douyin-phone-adb的record-start/record-stop/record-extract-audio)产出音频文件后,
//   生成这份清单交给本脚本处理。本脚本自己不碰ADB/真机,只负责"转写+判定+写库"这一段。
//
// ⚠️ 目标客户画像(TARGET_PROFILES)目前是写死在本文件里的占位值,后续要不要挪到飞书
// 配置表(像GOLD/JUNK_WORDS现在也是写死在sort-comments.js里一样)由主理人后续拍板。
"use strict";
const fs = require("fs");
const { getPool } = require("./leadgen-db-connect.js");
const { listPendingVideos, markVideoJudgment } = require("./leadgen-db-lib.js");
const { transcribeAudio } = require("./transcribe-qwen-audio.js");
const { judgeContent } = require("./judge-jev.js");
const { shouldSkipCheapGate, resolveTranscriptSource } = require("./judge-video-lib.js");

const TARGET_PROFILES = {
  jinuo: "AI人工智能训练师考证意向人群:关注AI技能证书、求职提升、培训报名的用户",
  yuesheng: "悦升云端目标客户:企业级AI部署决策者/OPC小微主体主/AI办公入门学习者",
};

async function main() {
  const [, , lineKey, manifestPath] = process.argv;
  if (!lineKey || !manifestPath) {
    console.error("usage: node judge-video.js <line_key> <manifest.json>");
    process.exit(1);
  }
  const targetProfile = TARGET_PROFILES[lineKey];
  if (!targetProfile) {
    console.error(`judge-video: 未配置line_key=${lineKey}的目标客户画像`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const manifestByVideoId = new Map(manifest.map((m) => [m.videoId, m]));

  const pool = getPool();
  const pending = await listPendingVideos(pool, lineKey, 200);

  let skipped = 0, matched = 0, rejected = 0, noSource = 0;
  for (const video of pending) {
    if (shouldSkipCheapGate(video)) {
      skipped++;
      await markVideoJudgment(pool, { lineKey, videoId: video.video_id, verdict: "rejected", reason: "V2便宜闸:零评论" });
      continue;
    }
    const manifestEntry = manifestByVideoId.get(video.video_id);
    const src = resolveTranscriptSource(video, manifestEntry);

    let transcript = src.text;
    if (src.source === "needs_transcription") {
      try {
        transcript = await transcribeAudio(src.audioPath);
      } catch (e) {
        console.error(`  转写失败 video=${video.video_id}: ${String(e.message || e).slice(0, 120)}`);
        continue; // 转写失败先跳过,留pending,下一轮重试,不误判成rejected
      }
    }
    if (src.source === "none" || !transcript) {
      noSource++;
      console.error(`  video=${video.video_id} 没有任何可判定的文本来源(既无转写也无标题),跳过`);
      continue;
    }

    const verdict = await judgeContent(transcript, targetProfile);
    await markVideoJudgment(pool, {
      lineKey, videoId: video.video_id, verdict: verdict.verdict, reason: verdict.reason, transcript,
    });
    if (verdict.verdict === "matched") matched++; else rejected++;
  }

  console.log(`judge-video: 待判定${pending.length} | 便宜闸跳过${skipped} | matched${matched} | rejected${rejected} | 无来源${noSource}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error("judge-video: 致命错误", e);
    process.exit(1);
  });
}

module.exports = { main, TARGET_PROFILES };
