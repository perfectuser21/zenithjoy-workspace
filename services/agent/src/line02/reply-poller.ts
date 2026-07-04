/**
 * Line02 回复轮询逻辑层
 *
 * 纯逻辑函数，通过注入接口隔离真实抖音 session（接缝清单 #2 logic-done-pending）。
 * 真机实现：CommentFetcher = 真实抖音 CDP；LeadWriter = psql Pool。
 */

export interface DouyinReply {
  user_nickname: string;
  text: string;
  publish_time: string; // ISO 8601
}

export interface DouyinComment {
  comment_id: string;
  user_nickname: string;
  text: string;
  replies: DouyinReply[];
}

export interface CommentFetcher {
  fetchVideoComments(videoId: string, sessionKey?: string): Promise<DouyinComment[]>;
}

export interface LeadWriter {
  updateLeadReply(opts: {
    leadId: string;
    tenantId: string;
    latestReply: string;
    latestReplyAt: string;
  }): Promise<void>;
  insertOrphanReply(opts: {
    videoId: string;
    commenterNickname: string;
    replyText: string;
    tenantId: string;
    capturedAt: string;
  }): Promise<void>;
}

export interface PollRepliesResult {
  updated: boolean;
  latestReply: string | null;
  latestReplyAt: string | null;
}

export interface PollRepliesOptions {
  leadId: string;
  tenantId: string;
  videoId: string;
  myCommentNickname: string;
  sessionKey?: string;
  commentFetcher: CommentFetcher;
  leadWriter: LeadWriter;
}

/**
 * 轮询视频评论区，找到对方对我方评论的回复后写库。
 *
 * - leadId 为空字符串 → 孤儿路径：写 acquisition_orphan_replies，不崩溃
 * - 多条回复 → 按 publish_time 降序取最新一条
 * - 无我方评论或无回复 → updated=false，不写 DB
 */
export async function pollReplies(opts: PollRepliesOptions): Promise<PollRepliesResult> {
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
  const allReplies: DouyinReply[] = [];
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
