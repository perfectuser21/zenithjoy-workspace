// qualify-video.js —— 逐视频「先判后采」的远端判定入口（任务 8bb3af55，决策 f18f56b8①）。
//
// 事故形状：batch2.sh 在落池之后才跑 judge-video.js，判定不挡采集——不合格视频的评论早已采完落池，
// 「先采后判则判定无意义」。纠正后 harvest-keyword.sh 每个视频在开评论区之前经 ssh 调本脚本：
//   discover → 候选视频落 leadgen_videos（pending，带本批 harvest_batch/keyword），并回报已有判定（缓存）
//   judge    → 转写+判定单个视频，写库后回报 matched/rejected/pending
//   collected→ 采完评论后把 process_status 标成「评论已采」（只写给 matched 视频）
// 判定接口出错（JudgeApiError 口径：OpenRouter 402/429/网络）→ 视频保持 pending、reason 记「判定异常(待重判)」，
// 回报 verdict=pending，调用方本轮跳过采集、留待重判，绝不当成 rejected，也不挡后面的视频。
import { test } from "node:test";
import assert from "node:assert/strict";
import qualify from "../qualify-video.js";
import judgeVideo from "../judge-video.js";

const { runQualify, parseArgs } = qualify;
const { judgeOneVideo, TARGET_PROFILES } = judgeVideo;

function fakeDeps(over = {}) {
  const calls = { discover: [], get: [], mark: [], judgeErr: [], collected: [], transcribe: [], judge: [] };
  const deps = {
    discoverVideo: async (_p, row) => { calls.discover.push(row); return { status: "pending", has_transcript: false, inserted: true }; },
    getVideo: async (_p, lineKey, videoId) => { calls.get.push({ lineKey, videoId }); return { video_id: videoId, title: "AI训练师证书怎么考", comment_count: 0, judgment_status: "pending", transcript: null }; },
    markVideoJudgment: async (_p, a) => { calls.mark.push(a); },
    markVideoJudgeError: async (_p, a) => { calls.judgeErr.push(a); },
    markVideoCollected: async (_p, a) => { calls.collected.push(a); return { updated: 1 }; },
    transcribeAudio: async (path) => { calls.transcribe.push(path); return "口播转写文案"; },
    judgeContent: async (text, profile) => { calls.judge.push({ text, profile }); return { verdict: "matched", reason: "jev:matched(confidence=0.9)" }; },
    ...over,
  };
  return { calls, deps };
}

test("parseArgs: --k v 形式，title/keyword 走 base64 防 ssh 引号", () => {
  const a = parseArgs(["discover", "--line", "jinoshengyuan-work", "--video-id", "v1", "--title-b64", Buffer.from("标题'引号").toString("base64")]);
  assert.equal(a.cmd, "discover");
  assert.equal(a.line, "jinoshengyuan-work");
  assert.equal(a.videoId, "v1");
  assert.equal(a.title, "标题'引号");
});

test("discover: 候选落库带路由键/本批 batch/关键词，回报已有判定状态", async () => {
  const { calls, deps } = fakeDeps({ discoverVideo: async (_p, row) => { calls.discover.push(row); return { status: "rejected", has_transcript: true, inserted: false }; } });
  const out = await runQualify({ cmd: "discover", args: { line: "jinoshengyuan-work", videoId: "v1", videoUrl: "https://v.douyin.com/x", title: "t", keyword: "AI证书", batch: "auto09292200" }, pool: {}, deps });
  assert.deepEqual(out, { status: "rejected", has_transcript: true, inserted: false });
  assert.equal(calls.discover[0].lineKey, "jinuo", "库里 line_key 存路由键");
  assert.equal(calls.discover[0].harvestBatch, "auto09292200");
  assert.equal(calls.discover[0].keyword, "AI证书");
});

test("discover: 库不可达 → status=error（调用方按 pending 处理，本轮不采）", async () => {
  const { deps } = fakeDeps({ discoverVideo: async () => { throw new Error("ECONNREFUSED"); } });
  const out = await runQualify({ cmd: "discover", args: { line: "jinuo", videoId: "v1" }, pool: {}, deps });
  assert.equal(out.status, "error");
  assert.match(out.error, /ECONNREFUSED/);
});

test("judge: 有音频 → 转写后判定，写库，回报 matched；采集前不看评论数（行内判定时评论数未知，不走便宜闸）", async () => {
  const { calls, deps } = fakeDeps();
  const out = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1", audio: "/tmp/a.wav" }, pool: {}, deps });
  assert.equal(out.verdict, "matched");
  assert.deepEqual(calls.transcribe, ["/tmp/a.wav"]);
  assert.equal(calls.mark[0].verdict, "matched");
  assert.equal(calls.mark[0].transcript, "口播转写文案");
  assert.equal(calls.judge[0].profile, TARGET_PROFILES.jinuo);
});

test("judge: 无音频 → 退回标题判定（title_only），不转写", async () => {
  const { calls, deps } = fakeDeps();
  const out = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1" }, pool: {}, deps });
  assert.equal(out.verdict, "matched");
  assert.equal(calls.transcribe.length, 0);
  assert.equal(calls.judge[0].text, "AI训练师证书怎么考");
});

test("judge: 判定 API 故障（JudgeApiError 口径）→ 保持 pending、reason 记待重判，回报 pending，不写 rejected", async () => {
  const { calls, deps } = fakeDeps({ judgeContent: async () => { const e = new Error("OpenRouter 402 Payment Required"); e.name = "JudgeApiError"; throw e; } });
  const out = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1", audio: "/tmp/a.wav" }, pool: {}, deps });
  assert.equal(out.verdict, "pending");
  assert.equal(out.kind, "judge_error");
  assert.equal(calls.mark.length, 0, "不得写 matched/rejected");
  assert.match(calls.judgeErr[0].reason, /判定异常\(待重判\)/);
  assert.equal(calls.judgeErr[0].transcript, "口播转写文案", "转写结果顺手存下，重判不再花钱转写");
});

test("judge: 转写调用失败（网络/超时）→ pending 留待重判；空转写（死寂）→ rejected", async () => {
  const a = fakeDeps({ transcribeAudio: async () => { throw new Error("ETIMEDOUT"); } });
  const outA = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1", audio: "/tmp/a.wav" }, pool: {}, deps: a.deps });
  assert.equal(outA.verdict, "pending");
  assert.equal(a.calls.mark.length, 0);
  const b = fakeDeps({ transcribeAudio: async () => { const e = new Error("empty"); e.emptyTranscript = true; throw e; } });
  const outB = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1", audio: "/tmp/a.wav" }, pool: {}, deps: b.deps });
  assert.equal(outB.verdict, "rejected");
  assert.match(b.calls.mark[0].reason, /转写为空/);
});

test("judge: 已判过的视频（matched/rejected）直接回报库里的结论，不重复花钱", async () => {
  const { calls, deps } = fakeDeps({ getVideo: async () => ({ video_id: "v1", title: "t", judgment_status: "rejected", judgment_reason: "jev:不相关" }) });
  const out = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1", audio: "/tmp/a.wav" }, pool: {}, deps });
  assert.deepEqual({ verdict: out.verdict, reason: out.reason }, { verdict: "rejected", reason: "jev:不相关" });
  assert.equal(calls.transcribe.length + calls.judge.length + calls.mark.length, 0);
});

test("judge: 视频不在库（discover 没落成）/ 库不可达 → pending（不采），不抛", async () => {
  const a = fakeDeps({ getVideo: async () => null });
  assert.equal((await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1" }, pool: {}, deps: a.deps })).verdict, "pending");
  const b = fakeDeps({ getVideo: async () => { throw new Error("ECONNREFUSED"); } });
  const outB = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1" }, pool: {}, deps: b.deps });
  assert.equal(outB.verdict, "pending");
  assert.match(outB.error, /ECONNREFUSED/);
});

test("judge: 写库失败（matched 没落库）→ 回报 pending，调用方不采（库里没有 matched 就不许采）", async () => {
  const { deps } = fakeDeps({ markVideoJudgment: async () => { throw new Error("db down"); } });
  const out = await runQualify({ cmd: "judge", args: { line: "jinuo", videoId: "v1" }, pool: {}, deps });
  assert.equal(out.verdict, "pending");
});

test("collected: 采完评论标「评论已采」并写真实评论数", async () => {
  const { calls, deps } = fakeDeps();
  const out = await runQualify({ cmd: "collected", args: { line: "jinuo", videoId: "v1", count: "7" }, pool: {}, deps });
  assert.equal(out.updated, 1);
  assert.deepEqual(calls.collected[0], { lineKey: "jinuo", videoId: "v1", commentCount: 7 });
});

test("未知子命令 → error，不抛", async () => {
  const { deps } = fakeDeps();
  const out = await runQualify({ cmd: "bogus", args: { line: "jinuo" }, pool: {}, deps });
  assert.match(out.error, /未知子命令/);
});

test("judgeOneVideo: cheapGate 默认开（批量重判沿用零评论便宜闸），行内判定传 false 关闭", async () => {
  const { calls, deps } = fakeDeps();
  const video = { video_id: "v1", title: "t", comment_count: 0 };
  const on = await judgeOneVideo({ video, lineKey: "jinuo", targetProfile: "p", pool: {}, deps });
  assert.equal(on.outcome, "rejected"); assert.equal(on.kind, "cheap_gate");
  const off = await judgeOneVideo({ video, lineKey: "jinuo", targetProfile: "p", pool: {}, deps, cheapGate: false });
  assert.equal(off.outcome, "matched");
  assert.equal(calls.judge.length, 1);
});
