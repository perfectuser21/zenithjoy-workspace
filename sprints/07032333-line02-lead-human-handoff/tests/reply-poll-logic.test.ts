/**
 * TDD Red — Line02 回复轮询逻辑层单测
 *
 * 测试对象：services/agent/src/line02/reply-poller.ts 的 pollReplies 函数
 *
 * 设计原则（与 douyin-dm-outreach.test.ts 同模式）：
 *   - 注入 CommentFetcher 接口（fake 替代真实 CDP/HTTP，接缝清单 #2 保持 logic-done-pending）
 *   - 注入 LeadWriter 接口（fake DB，可断言调用参数）
 *   - 验证纯逻辑：回复匹配、时间排序、DB 写入参数、孤儿路径
 *   - 不 mock 模块（不使用 vi.mock()）
 *
 * PRD 来源：E2E 验收点3「模拟对方回复评论数据→轮询逻辑写入latest_reply」
 *           接缝清单 #2 真实 Douyin session 标 logic-done-pending，逻辑层可纯 fake 覆盖
 */
import { describe, it, expect, vi } from 'vitest';

// ─── 接口定义（Generator 必须实现的形状）─────────────────────────────────────

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

/** 注入接口 — 真机实现 = 真实抖音 CDP 请求（接缝清单 #2） */
export interface CommentFetcher {
  fetchVideoComments(videoId: string, sessionKey?: string): Promise<DouyinComment[]>;
}

/** 注入接口 — 真机实现 = psql Pool */
export interface LeadWriter {
  updateLeadReply(opts: {
    leadId: string;
    tenantId: string;
    latestReply: string;
    latestReplyAt: string; // ISO 8601
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
  /** 已触达 lead 的 DB id；空字符串表示无对应 lead（孤儿回复路径） */
  leadId: string;
  tenantId: string;
  videoId: string;
  /** 我方发评论时使用的账号昵称（用于识别哪条评论的 replies 是针对我方的） */
  myCommentNickname: string;
  sessionKey?: string;
  commentFetcher: CommentFetcher;
  leadWriter: LeadWriter;
}

// ─── 被测函数（Generator 实现前会抛 Error → TDD Red）────────────────────────

let pollReplies: (opts: PollRepliesOptions) => Promise<PollRepliesResult>;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../../services/agent/src/line02/reply-poller');
  pollReplies = mod.pollReplies;
} catch {
  pollReplies = async () => {
    throw new Error('pollReplies not implemented — Generator 尚未实现 services/agent/src/line02/reply-poller.ts');
  };
}

// ─── 测试套件 ────────────────────────────────────────────────────────────────

describe('pollReplies — 回复轮询逻辑层 [BEHAVIOR]（mock Douyin API，PRD E2E点3）', () => {
  function makeFetcher(comments: DouyinComment[]): CommentFetcher {
    return { fetchVideoComments: vi.fn().mockResolvedValue(comments) };
  }

  function makeWriter() {
    return {
      updateLeadReply: vi.fn().mockResolvedValue(undefined),
      insertOrphanReply: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('找到对方对我方评论的回复 → 写入 latest_reply + latest_reply_at，updated=true', async () => {
    const writer = makeWriter();
    const fetcher = makeFetcher([
      {
        comment_id: 'c001',
        user_nickname: '我方小号',
        text: '您好，欢迎了解我们的服务',
        replies: [
          {
            user_nickname: '潜在客户甲',
            text: '感谢你的回复，我很感兴趣',
            publish_time: '2026-07-03T10:00:00Z',
          },
        ],
      },
    ]);

    const result = await pollReplies({
      leadId: 'lead-abc-001',
      tenantId: 'tenant-xyz',
      videoId: 'video-001',
      myCommentNickname: '我方小号',
      commentFetcher: fetcher,
      leadWriter: writer,
    });

    expect(result.updated).toBe(true);
    expect(result.latestReply).toBe('感谢你的回复，我很感兴趣');
    expect(result.latestReplyAt).toBe('2026-07-03T10:00:00Z');

    // 断言：updateLeadReply 被调用且参数正确
    expect(writer.updateLeadReply).toHaveBeenCalledOnce();
    expect(writer.updateLeadReply).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-abc-001',
        tenantId: 'tenant-xyz',
        latestReply: '感谢你的回复，我很感兴趣',
        latestReplyAt: '2026-07-03T10:00:00Z',
      }),
    );
    // 孤儿写入不应触发
    expect(writer.insertOrphanReply).not.toHaveBeenCalled();
  });

  it('多条回复 → 按 publish_time 降序取最新一条写入 latest_reply', async () => {
    const writer = makeWriter();
    const fetcher = makeFetcher([
      {
        comment_id: 'c002',
        user_nickname: '我方小号',
        text: '我方评论',
        replies: [
          { user_nickname: 'u', text: '第一条回复', publish_time: '2026-07-01T08:00:00Z' },
          { user_nickname: 'u', text: '最新一条回复', publish_time: '2026-07-03T12:00:00Z' },
          { user_nickname: 'u', text: '第二条回复', publish_time: '2026-07-02T09:00:00Z' },
        ],
      },
    ]);

    const result = await pollReplies({
      leadId: 'lead-multi-reply',
      tenantId: 'tenant-xyz',
      videoId: 'video-002',
      myCommentNickname: '我方小号',
      commentFetcher: fetcher,
      leadWriter: writer,
    });

    expect(result.updated).toBe(true);
    // 必须取 publish_time 最大的那条
    expect(result.latestReply).toBe('最新一条回复');
    expect(result.latestReplyAt).toBe('2026-07-03T12:00:00Z');
  });

  it('无回复 → updated=false，latestReply=null，不调用 updateLeadReply', async () => {
    const writer = makeWriter();
    const fetcher = makeFetcher([
      {
        comment_id: 'c003',
        user_nickname: '我方小号',
        text: '我方评论',
        replies: [],
      },
    ]);

    const result = await pollReplies({
      leadId: 'lead-no-reply',
      tenantId: 'tenant-xyz',
      videoId: 'video-003',
      myCommentNickname: '我方小号',
      commentFetcher: fetcher,
      leadWriter: writer,
    });

    expect(result.updated).toBe(false);
    expect(result.latestReply).toBeNull();
    expect(result.latestReplyAt).toBeNull();
    expect(writer.updateLeadReply).not.toHaveBeenCalled();
    expect(writer.insertOrphanReply).not.toHaveBeenCalled();
  });

  it('对应 lead 不存在（leadId 为空）→ 写入 acquisition_orphan_replies，不崩溃（Invariant: 不丢失）', async () => {
    const writer = makeWriter();
    // 评论区有他人（非我方账号）带回复的评论 — 触发孤儿路径
    const fetcher = makeFetcher([
      {
        comment_id: 'c004',
        user_nickname: '陌生账号A',
        text: '不是我方发的评论',
        replies: [
          {
            user_nickname: '某用户B',
            text: '这是回复陌生评论的',
            publish_time: '2026-07-03T11:00:00Z',
          },
        ],
      },
    ]);

    const result = await pollReplies({
      leadId: '',        // 无匹配 lead → 孤儿路径
      tenantId: 'tenant-xyz',
      videoId: 'video-orphan',
      myCommentNickname: '我方小号',
      commentFetcher: fetcher,
      leadWriter: writer,
    });

    // 孤儿路径不更新 lead
    expect(result.updated).toBe(false);
    // Invariant：孤儿回复必须写入 acquisition_orphan_replies
    expect(writer.insertOrphanReply).toHaveBeenCalledOnce();
    expect(writer.insertOrphanReply).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: 'video-orphan',
        tenantId: 'tenant-xyz',
      }),
    );
  });
});
