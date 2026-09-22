import { test } from "node:test";
import assert from "node:assert/strict";
import {
  commentDedupKey,
  upsertVideo,
  listPendingVideos,
  markVideoJudgment,
  upsertComment,
  listPendingComments,
  markCommentJudgment,
  upsertLead,
} from "../leadgen-db-lib.js";

// 假pool:记录每次调用的sql+params,按调用顺序返回预设的rows。
function fakePool(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const r = responses[i++] || { rows: [] };
      return r;
    },
  };
}

test("commentDedupKey: 昵称+抖音号+评论前20字,跟push-raw-comments.js现有rid逻辑一致", () => {
  assert.equal(commentDedupKey("沉", "LHJ20001024", "怎么报名这个证书呀"), "沉|LHJ20001024|怎么报名这个证书呀");
  assert.equal(commentDedupKey("沉", "", "怎么报名"), "沉|noid|怎么报名");
  assert.equal(commentDedupKey("", null, ""), "|noid|");
  // 超过20字要截断
  const long = "a".repeat(30);
  assert.equal(commentDedupKey("x", "y", long), `x|y|${"a".repeat(20)}`);
});

test("upsertVideo: 必填字段缺失抛错", async () => {
  const pool = fakePool([]);
  await assert.rejects(() => upsertVideo(pool, { lineKey: "jinuo" }), /videoId 必填/);
  await assert.rejects(() => upsertVideo(pool, { videoId: "v1" }), /lineKey\/videoId 必填/);
});

test("upsertVideo: 插入成功返回inserted=true", async () => {
  const pool = fakePool([{ rows: [{ id: "uuid-1" }] }]);
  const r = await upsertVideo(pool, { lineKey: "jinuo", videoId: "v1", title: "标题" });
  assert.equal(r.inserted, true);
  assert.equal(r.id, "uuid-1");
  assert.match(pool.calls[0].sql, /ON CONFLICT \(line_key, video_id\) DO NOTHING/);
});

test("upsertVideo: 已存在(去重命中)返回inserted=false", async () => {
  const pool = fakePool([{ rows: [] }]);
  const r = await upsertVideo(pool, { lineKey: "jinuo", videoId: "v1", title: "标题" });
  assert.equal(r.inserted, false);
  assert.equal(r.id, null);
});

test("listPendingVideos: 按line_key+pending状态查询", async () => {
  const pool = fakePool([{ rows: [{ id: "1", video_id: "v1" }] }]);
  const rows = await listPendingVideos(pool, "jinuo", 10);
  assert.equal(rows.length, 1);
  assert.deepEqual(pool.calls[0].params, ["jinuo", 10]);
});

test("markVideoJudgment: verdict非法值拒绝写库(不能有pending/uncertain这种中间态落库)", () => {
  const pool = fakePool([]);
  assert.throws(() => markVideoJudgment(pool, { lineKey: "jinuo", videoId: "v1", verdict: "uncertain" }), /matched\/rejected/);
  assert.equal(pool.calls.length, 0, "非法verdict不应该发出任何query");
});

test("markVideoJudgment: matched/rejected合法写入", async () => {
  const pool = fakePool([{ rows: [] }]);
  await markVideoJudgment(pool, { lineKey: "jinuo", videoId: "v1", verdict: "matched", reason: "画像匹配", transcript: "转写文案" });
  assert.deepEqual(pool.calls[0].params, ["jinuo", "v1", "matched", "画像匹配", "转写文案"]);
});

test("upsertComment: 用commentDedupKey算出的key去重,写入全部字段", async () => {
  const pool = fakePool([{ rows: [{ id: "c1" }] }]);
  const r = await upsertComment(pool, {
    lineKey: "yuesheng", nickname: "只悦己", douyinId: "abc123",
    commentBody: "你的关注,失业金正在交社保", sourceVideo: "视频标题",
  });
  assert.equal(r.inserted, true);
  assert.equal(r.dedupKey, "只悦己|abc123|你的关注,失业金正在交社保".slice(0, "只悦己|abc123|".length + 20));
});

test("listPendingComments: 按line_key+待分拣状态查询,限制返回条数", async () => {
  const pool = fakePool([{ rows: [] }]);
  await listPendingComments(pool, "jinuo", 5);
  assert.deepEqual(pool.calls[0].params, ["jinuo", 5]);
});

test("markCommentJudgment: relevance非法值拒绝", () => {
  const pool = fakePool([]);
  assert.throws(() => markCommentJudgment(pool, { lineKey: "jinuo", dedupKey: "k", relevance: "拿不准" }), /相关\/不相关/);
});

test("markCommentJudgment: intentGrade非法值拒绝(A/B/C之外)", () => {
  const pool = fakePool([]);
  assert.throws(
    () => markCommentJudgment(pool, { lineKey: "jinuo", dedupKey: "k", relevance: "相关", intentGrade: "D" }),
    /A\/B\/C/
  );
});

test("markCommentJudgment: 不相关时intentGrade可以是null", async () => {
  const pool = fakePool([{ rows: [] }]);
  await markCommentJudgment(pool, { lineKey: "jinuo", dedupKey: "k", relevance: "不相关", reason: "广告号" });
  assert.deepEqual(pool.calls[0].params, ["jinuo", "k", "不相关", null, "广告号"]);
});

test("upsertLead: 第一次出现,新建记录dupHitCount=0", async () => {
  const pool = fakePool([{ rows: [] }, { rows: [{ id: "lead-1" }] }]);
  const r = await upsertLead(pool, { lineKey: "jinuo", nickname: "只悦己", douyinId: "abc123" });
  assert.equal(r.created, true);
  assert.equal(r.dupHitCount, 0);
  assert.equal(r.id, "lead-1");
});

test("upsertLead: 重复出现(按昵称命中),dupHitCount递增,不新建", async () => {
  const pool = fakePool([
    { rows: [{ id: "lead-1", dup_hit_count: 2 }] }, // 查询命中已有记录
    { rows: [] }, // update
  ]);
  const r = await upsertLead(pool, {
    lineKey: "jinuo", nickname: "只悦己", sourceVideo: "第二条视频", commentBody: "又来问了",
  });
  assert.equal(r.created, false);
  assert.equal(r.dupHitCount, 3);
  assert.equal(r.id, "lead-1");
  // 第二次query(update)必须带上新的dup_hit_count和追加的轨迹文本
  assert.equal(pool.calls[1].params[1], 3);
  assert.match(pool.calls[1].params[2], /\[再现3\]/);
});

test("upsertLead: lineKey/nickname缺失时抛错", async () => {
  const pool = fakePool([]);
  await assert.rejects(() => upsertLead(pool, { lineKey: "jinuo" }), /lineKey\/nickname 必填/);
});
