// leadgen-db-lib.js —— ADB获客链路数据库正本读写层(0922建库正本第一刀)
//
// 纯逻辑 + 依赖注入:所有函数第一个参数是 pool(任何实现了 async query(sql, params) 的对象),
// 不在本文件里 require('pg')、不自己建连接——真实连接由 leadgen-db-connect.js 提供,
// 单测传一个假 pool 进来即可,不需要装 pg 依赖、不需要真实数据库。
// (services/phone-adb-controller/__tests__/*.test.mjs 在 CI 的 openclaw-scripts-test job
//  里是"纯 node --test,不装依赖"跑的——见 .github/workflows/ci-l3-code.yml 注释,这个文件
//  和它的测试绝不能让 node --test 走到 require('pg') 这一步,否则 CI 直接找不到模块炸掉。)
"use strict";

// 评论去重key:昵称+抖音号+评论前20字,跟 push-raw-comments.js 现有的 rid 逻辑保持一致
// (那边是内存 Set 去重,这里换成数据库唯一约束(line_key, dedup_key)兜底,双保险不冲突)。
function commentDedupKey(nick, douyinId, commentBody) {
  return `${nick || ""}|${douyinId || "noid"}|${(commentBody || "").slice(0, 20)}`;
}

// ── 视频池 ──────────────────────────────────────────────────────────
async function upsertVideo(pool, row) {
  const {
    lineKey, videoId, videoUrl = null, title = "", keyword = null,
    commentCount = 0, harvestBatch = null, processStatus = "评论已采",
  } = row;
  if (!lineKey || !videoId) throw new Error("upsertVideo: lineKey/videoId 必填");
  const res = await pool.query(
    `INSERT INTO zenithjoy.leadgen_videos
       (line_key, video_id, video_url, title, keyword, comment_count, harvest_batch, process_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (line_key, video_id) DO NOTHING
     RETURNING id`,
    [lineKey, videoId, videoUrl, title, keyword, commentCount, harvestBatch, processStatus]
  );
  return { inserted: res.rows.length > 0, id: res.rows[0] ? res.rows[0].id : null };
}

async function listPendingVideos(pool, lineKey, limit = 50) {
  const res = await pool.query(
    `SELECT id, video_id, video_url, title, keyword, comment_count
       FROM zenithjoy.leadgen_videos
      WHERE line_key = $1 AND judgment_status = 'pending'
      ORDER BY discovered_at ASC
      LIMIT $2`,
    [lineKey, limit]
  );
  return res.rows;
}

// verdict 必须是 matched 或 rejected 之一(pending 只是初始值,不该由判定逻辑写回)。
function markVideoJudgment(pool, { lineKey, videoId, verdict, reason = null, transcript = null }) {
  if (verdict !== "matched" && verdict !== "rejected") {
    throw new Error(`markVideoJudgment: verdict 必须是 matched/rejected,收到 ${verdict}`);
  }
  return pool.query(
    `UPDATE zenithjoy.leadgen_videos
        SET judgment_status = $3, judgment_reason = $4, transcript = COALESCE($5, transcript), updated_at = now()
      WHERE line_key = $1 AND video_id = $2`,
    [lineKey, videoId, verdict, reason, transcript]
  );
}

// ── 原始评论池 ──────────────────────────────────────────────────────
async function upsertComment(pool, row) {
  const {
    lineKey, harvestBatch = null, keyword = null, sourceVideo = null, sourceVideoUrl = null,
    commentBody = "", nickname = "", douyinId = null, profileUrl = null, accountType = null,
    commentTime = null, profileIp = null, region = null,
  } = row;
  if (!lineKey) throw new Error("upsertComment: lineKey 必填");
  const dedupKey = commentDedupKey(nickname, douyinId, commentBody);
  const res = await pool.query(
    `INSERT INTO zenithjoy.leadgen_comments
       (line_key, dedup_key, harvest_batch, keyword, source_video, source_video_url,
        comment_body, nickname, douyin_id, profile_url, account_type, comment_time, profile_ip, region)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (line_key, dedup_key) DO NOTHING
     RETURNING id`,
    [lineKey, dedupKey, harvestBatch, keyword, sourceVideo, sourceVideoUrl,
     commentBody, nickname, douyinId, profileUrl, accountType, commentTime, profileIp, region]
  );
  return { inserted: res.rows.length > 0, id: res.rows[0] ? res.rows[0].id : null, dedupKey };
}

async function listPendingComments(pool, lineKey, limit = 200) {
  const res = await pool.query(
    `SELECT id, dedup_key, comment_body, nickname, douyin_id, profile_url, source_video
       FROM zenithjoy.leadgen_comments
      WHERE line_key = $1 AND process_status = '待分拣'
      ORDER BY collected_at ASC
      LIMIT $2`,
    [lineKey, limit]
  );
  return res.rows;
}

// relevance 必须是 相关/不相关;intentGrade 只有 relevance=相关 时才有意义(A/B/C),
// 不相关的行 intentGrade 允许为 null。
function markCommentJudgment(pool, { lineKey, dedupKey, relevance, intentGrade = null, reason = null }) {
  if (relevance !== "相关" && relevance !== "不相关") {
    throw new Error(`markCommentJudgment: relevance 必须是 相关/不相关,收到 ${relevance}`);
  }
  if (relevance === "相关" && intentGrade !== null && !["A", "B", "C"].includes(intentGrade)) {
    throw new Error(`markCommentJudgment: intentGrade 必须是 A/B/C 之一,收到 ${intentGrade}`);
  }
  return pool.query(
    `UPDATE zenithjoy.leadgen_comments
        SET process_status = '已分拣', relevance = $3, intent_grade = $4, judgment_reason = $5, updated_at = now()
      WHERE line_key = $1 AND dedup_key = $2`,
    [lineKey, dedupKey, relevance, intentGrade, reason]
  );
}

// ── 线索表(含0914拍板的"重复=强意向信号"去重高亮逻辑)────────────────
// 按 (lineKey, nickname) 或 (lineKey, douyinId) 命中已有记录 → 不新建,dup_hit_count+1、
// 追加 dup_trace;命中不到 → 新建一条,dup_hit_count=0。跟现有 sort-comments.js write模式
// 里那段"seen Map"逻辑等价,只是把内存态换成了数据库唯一约束+查询。
async function upsertLead(pool, row) {
  const {
    lineKey, nickname, douyinId = null, profileUrl = null, commentBody = null,
    sourceVideo = null, aiJudgmentReason = null,
  } = row;
  if (!lineKey || !nickname) throw new Error("upsertLead: lineKey/nickname 必填");

  const existing = await pool.query(
    `SELECT id, dup_hit_count FROM zenithjoy.leadgen_leads
      WHERE line_key = $1 AND (nickname = $2 OR (douyin_id IS NOT NULL AND douyin_id = $3))
      LIMIT 1`,
    [lineKey, nickname, douyinId]
  );

  if (existing.rows.length > 0) {
    const hit = existing.rows[0];
    const newDup = (hit.dup_hit_count || 0) + 1;
    const traceLine = `[再现${newDup}] 又在《${(sourceVideo || "").slice(0, 40)}》评论: ${(commentBody || "").slice(0, 50)}`;
    await pool.query(
      `UPDATE zenithjoy.leadgen_leads
          SET dup_hit_count = $2, dup_trace = COALESCE(dup_trace || E'\\n', '') || $3, updated_at = now()
        WHERE id = $1`,
      [hit.id, newDup, traceLine]
    );
    return { created: false, id: hit.id, dupHitCount: newDup };
  }

  const res = await pool.query(
    `INSERT INTO zenithjoy.leadgen_leads
       (line_key, nickname, douyin_id, profile_url, comment_body, source_video, ai_judgment_reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id`,
    [lineKey, nickname, douyinId, profileUrl, commentBody, sourceVideo, aiJudgmentReason]
  );
  return { created: true, id: res.rows[0].id, dupHitCount: 0 };
}

module.exports = {
  commentDedupKey,
  upsertVideo,
  listPendingVideos,
  markVideoJudgment,
  upsertComment,
  listPendingComments,
  markCommentJudgment,
  upsertLead,
};
