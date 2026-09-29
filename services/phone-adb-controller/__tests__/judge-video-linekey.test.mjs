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
