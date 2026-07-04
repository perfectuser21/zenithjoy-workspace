'use strict';
// CJS shim for sprint vitest require() — production code uses .ts
Object.defineProperty(exports, '__esModule', { value: true });

/**
 * 轮询视频评论区，找到对方对我方评论的回复后写库。
 *
 * - leadId 为空字符串 → 孤儿路径：写 acquisition_orphan_replies，不崩溃
 * - 多条回复 → 按 publish_time 降序取最新一条
 * - 无我方评论或无回复 → updated=false，不写 DB
 */
async function pollReplies(opts) {
  const { leadId, tenantId, videoId, myCommentNickname, sessionKey, commentFetcher, leadWriter } = opts;

  const comments = await commentFetcher.fetchVideoComments(videoId, sessionKey);

  // leadId 为空 → 孤儿路径：在评论区中找任意有回复的评论写孤儿日志
  if (!leadId) {
    for (const comment of comments) {
      if (comment.replies && comment.replies.length > 0) {
        const reply = comment.replies[0];
        await leadWriter.insertOrphanReply({
          videoId,
          commenterNickname: reply.user_nickname,
          replyText: reply.text,
          tenantId,
          capturedAt: reply.publish_time,
        });
      }
    }
    return { updated: false, latestReply: null, latestReplyAt: null };
  }

  // 找到我方发出的评论（user_nickname 匹配）
  const myComments = comments.filter((c) => c.user_nickname === myCommentNickname);

  // 收集所有针对我方评论的回复
  const allReplies = [];
  for (const comment of myComments) {
    if (comment.replies) {
      allReplies.push(...comment.replies);
    }
  }

  if (allReplies.length === 0) {
    return { updated: false, latestReply: null, latestReplyAt: null };
  }

  // 按 publish_time 降序取最新一条
  allReplies.sort((a, b) => {
    return new Date(b.publish_time).getTime() - new Date(a.publish_time).getTime();
  });

  const latest = allReplies[0];

  await leadWriter.updateLeadReply({
    leadId,
    tenantId,
    latestReply: latest.text,
    latestReplyAt: latest.publish_time,
  });

  return {
    updated: true,
    latestReply: latest.text,
    latestReplyAt: latest.publish_time,
  };
}

exports.pollReplies = pollReplies;
