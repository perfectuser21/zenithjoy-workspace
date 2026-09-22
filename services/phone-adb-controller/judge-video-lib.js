// judge-video-lib.js —— 视频文案判定的纯逻辑部分(V1-V4),供judge-video.js调用
// 不碰网络/数据库,方便单测覆盖边界情况。
"use strict";

// V2便宜闸:零评论视频不值得花钱转写+判定(跟douyin-phone-adb里"零评论视频不点开
// 评论区"是同一个判断依据的另一半——0913主理人拍板:评论数是详情页树上零成本的字段,
// 必须随开页输出,零评论的视频不许流向录屏/ASR这类最贵的工序)。
function shouldSkipCheapGate(video) {
  return !video || Number(video.comment_count || 0) === 0;
}

// 决定这条视频该用哪份文案去判定:
// 1. 数据库里已经有转写文案(之前跑过一次转写,不用重复花钱)→ 直接用
// 2. manifest里这条视频带了现成的transcript(比如人工提供或别的来源)→ 用它
// 3. manifest里只带了audioPath(还没转写过)→ 返回needsTranscription标记,交给调用方转写
// 4. 什么都没有 → 只能退回用视频标题当判定依据(信息量最少,但至少不是完全跳过)
function resolveTranscriptSource(video, manifestEntry) {
  if (video && video.transcript) return { source: "db", text: video.transcript };
  if (manifestEntry && manifestEntry.transcript) return { source: "manifest", text: manifestEntry.transcript };
  if (manifestEntry && manifestEntry.audioPath) return { source: "needs_transcription", audioPath: manifestEntry.audioPath };
  if (video && video.title) return { source: "title_only", text: video.title };
  return { source: "none", text: "" };
}

module.exports = { shouldSkipCheapGate, resolveTranscriptSource };
