// leadgen-db-lib.js 先判后采三件（任务 8bb3af55）：discoverVideo / getVideo / markVideoCollected。
// 契约 discovery.persist_candidates：候选视频在「发现」时就落 leadgen_videos（pending），不是等配送才落；
// 契约 collection.mark_video_collected：process_status=评论已采 只写给 matched 视频。
import { test } from "node:test";
import assert from "node:assert/strict";
import db from "../leadgen-db-lib.js";

const { discoverVideo, getVideo, markVideoCollected } = db;

function fakePool(responses) {
  const calls = [];
  let i = 0;
  return { calls, query: async (sql, params) => { calls.push({ sql, params }); return responses[i++] || { rows: [] }; } };
}

test("discoverVideo: 新视频落库为 pending/待判定，带本批 harvest_batch 与关键词，回报 status", async () => {
  const pool = fakePool([{ rows: [{ judgment_status: "pending", has_transcript: false, inserted: true }] }]);
  const out = await discoverVideo(pool, { lineKey: "jinuo", videoId: "v1", videoUrl: "https://v", title: "t", keyword: "kw", harvestBatch: "auto1" });
  assert.deepEqual(out, { status: "pending", has_transcript: false, inserted: true });
  const { sql, params } = pool.calls[0];
  assert.match(sql, /INSERT INTO zenithjoy\.leadgen_videos/);
  assert.match(sql, /ON CONFLICT \(line_key, video_id\) DO UPDATE/);
  assert.match(sql, /harvest_batch = EXCLUDED\.harvest_batch/, "再次遇到的视频归到本批(探针按本批读回)");
  assert.doesNotMatch(sql, /judgment_status\s*=\s*EXCLUDED/, "绝不覆盖已有判定");
  assert.ok(params.includes("待判定"), "新落库的候选不是「评论已采」");
  assert.ok(params.includes("auto1") && params.includes("kw"));
});

test("discoverVideo: 已判过的视频回报库里的判定（缓存，不重录不重判）", async () => {
  const pool = fakePool([{ rows: [{ judgment_status: "rejected", has_transcript: true, inserted: false }] }]);
  const out = await discoverVideo(pool, { lineKey: "jinuo", videoId: "v1" });
  assert.equal(out.status, "rejected");
  assert.equal(out.has_transcript, true);
});

test("discoverVideo: lineKey/videoId 必填", async () => {
  await assert.rejects(() => discoverVideo(fakePool([]), { lineKey: "jinuo" }), /必填/);
});

test("getVideo: 取单个视频（含判定与转写），不存在返回 null", async () => {
  const pool = fakePool([{ rows: [{ video_id: "v1", judgment_status: "pending" }] }, { rows: [] }]);
  assert.equal((await getVideo(pool, "jinuo", "v1")).video_id, "v1");
  assert.equal(await getVideo(pool, "jinuo", "v2"), null);
  assert.deepEqual(pool.calls[0].params, ["jinuo", "v1"]);
});

test("markVideoCollected: 只给 matched 视频写「评论已采」+评论数，回报更新行数", async () => {
  const pool = fakePool([{ rows: [{ id: 1 }] }, { rows: [] }]);
  assert.deepEqual(await markVideoCollected(pool, { lineKey: "jinuo", videoId: "v1", commentCount: 5 }), { updated: 1 });
  assert.match(pool.calls[0].sql, /process_status = '评论已采'/);
  assert.match(pool.calls[0].sql, /judgment_status = 'matched'/);
  assert.deepEqual(pool.calls[0].params, ["jinuo", "v1", 5]);
  assert.deepEqual(await markVideoCollected(pool, { lineKey: "jinuo", videoId: "v2", commentCount: 0 }), { updated: 0 });
});
