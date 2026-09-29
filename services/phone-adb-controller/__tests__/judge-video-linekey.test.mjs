// judge-video.js 入口业务线归一(0929 生产实证)
//
// batch2.sh 调 `judge-video.js $LINE <manifest>` 传的是账号 profile 名
// (legacy / jinoshengyuan-work / yueshengyun-work),而判定脚本按路由键(jinuo/yuesheng)
// 查画像、查 leadgen_videos.line_key——西安采收机日志里每晚都是
// 「judge-video: 未配置line_key=legacy的目标客户画像」,230 条视频从上线起没判过一条。
// 契约: profile 名与路由键都要能用,入口一律经 line-routes.js 的 routeOf() 归一。
import { test } from "node:test";
import assert from "node:assert/strict";
import judgeVideo from "../judge-video.js";

const { runJudgeVideo, TARGET_PROFILES } = judgeVideo;

function fakeDeps({ pending = [], verdict = { verdict: "matched", reason: "jev:matched(confidence=0.9)" } } = {}) {
  const calls = { list: [], mark: [], judge: [] };
  return {
    calls,
    deps: {
      listPendingVideos: async (_pool, lineKey, limit) => { calls.list.push({ lineKey, limit }); return pending; },
      markVideoJudgment: async (_pool, args) => { calls.mark.push(args); },
      markVideoJudgeError: async () => {},
      transcribeAudio: async () => "转写",
      judgeContent: async (text, profile) => { calls.judge.push({ text, profile }); return verdict; },
    },
  };
}

for (const [hint, key] of [
  ["legacy", "jinuo"],
  ["jinoshengyuan-work", "jinuo"],
  ["yueshengyun-work", "yuesheng"],
  ["jinuo", "jinuo"],
  ["yuesheng", "yuesheng"],
]) {
  test(`runJudgeVideo: 传 ${hint} → 按路由键 ${key} 查库/取画像/写库`, async () => {
    assert.equal(typeof runJudgeVideo, "function", "judge-video.js 必须导出 runJudgeVideo(可注入依赖)");
    const { calls, deps } = fakeDeps({ pending: [{ video_id: "v1", title: "AI训练师证书怎么考", comment_count: 3 }] });
    const stats = await runJudgeVideo({ lineHint: hint, manifest: [], pool: {}, deps });
    assert.equal(calls.list[0].lineKey, key, "查 pending 必须用路由键(库里 line_key 存的是路由键)");
    assert.equal(calls.judge[0].profile, TARGET_PROFILES[key], "画像必须按路由键取");
    assert.equal(calls.mark[0].lineKey, key, "写库必须用路由键");
    assert.equal(stats.matched, 1);
  });
}

test("runJudgeVideo: 认不出的业务线 → 抛错(不猜,不兜底进金诺)", async () => {
  assert.equal(typeof runJudgeVideo, "function");
  const { calls, deps } = fakeDeps();
  await assert.rejects(() => runJudgeVideo({ lineHint: "xiaolongxia", manifest: [], pool: {}, deps }), /未配路由/);
  assert.equal(calls.list.length, 0, "路由认不出时不该碰库");
});

// ── 0929: 判定 API 故障 → 视频保持 pending,judgment_reason 写明失败原因 ──────
// OpenRouter 09-29 余额耗尽(402)。旧链路会把 API 故障判成 rejected 落库,充值后也捞不回来。
test("runJudgeVideo: judgeContent 抛API错误 → 不写rejected,调markVideoJudgeError留pending并记原因,继续下一条", async () => {
  const marks = [], errors = [];
  const apiErr = Object.assign(new Error("openrouter:primary HTTP 402 Insufficient credits"), { name: "JudgeApiError" });
  let n = 0;
  const deps = {
    listPendingVideos: async () => [
      { video_id: "v1", title: "AI训练师证书", comment_count: 5 },
      { video_id: "v2", title: "AI训练师报名", comment_count: 5 },
    ],
    markVideoJudgment: async (_p, a) => { marks.push(a); },
    markVideoJudgeError: async (_p, a) => { errors.push(a); },
    transcribeAudio: async () => "转写",
    judgeContent: async () => { n++; if (n === 1) throw apiErr; return { verdict: "matched", reason: "jev:matched" }; },
  };
  const stats = await runJudgeVideo({ lineHint: "legacy", manifest: [], pool: {}, deps });
  assert.deepEqual(marks.map((m) => m.videoId), ["v2"], "API 故障那条绝不能写成 matched/rejected");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].lineKey, "jinuo");
  assert.equal(errors[0].videoId, "v1");
  assert.match(errors[0].reason, /判定异常/);
  assert.match(errors[0].reason, /402/);
  assert.equal(stats.judgeError, 1);
  assert.equal(stats.matched, 1);
});

// #1999 空转写分流(死寂音频直接判 rejected)必须走注入依赖——变基合并时曾残留旧的顶层变量引用,
// 运行到这条分支即 ReferenceError,整批炸穿。
test("runJudgeVideo: 空转写(emptyTranscript) → 判rejected并计数;转写网络失败 → 留pending不写库", async () => {
  const marks = [];
  const deps = {
    listPendingVideos: async () => [
      { video_id: "v1", title: "t", comment_count: 5 },
      { video_id: "v2", title: "t", comment_count: 5 },
    ],
    markVideoJudgment: async (_p, a) => { marks.push(a); },
    markVideoJudgeError: async () => { throw new Error("不该走到判定异常"); },
    transcribeAudio: async (p) => {
      if (p === "a1") throw Object.assign(new Error("转写为空"), { emptyTranscript: true });
      throw new Error("ETIMEDOUT");
    },
    judgeContent: async () => { throw new Error("不该走到判定"); },
  };
  const manifest = [{ videoId: "v1", audioPath: "a1" }, { videoId: "v2", audioPath: "a2" }];
  const stats = await runJudgeVideo({ lineHint: "yueshengyun-work", manifest, pool: {}, deps });
  assert.deepEqual(marks.map((m) => [m.videoId, m.verdict, m.lineKey]), [["v1", "rejected", "yuesheng"]]);
  assert.equal(stats.rejected, 1);
});
