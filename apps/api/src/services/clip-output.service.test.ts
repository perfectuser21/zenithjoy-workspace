import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn(),
  },
}));
vi.mock('./clips.service', () => ({
  upsertFeishuBinding: vi.fn(),
}));
vi.mock('./clips-auth.service', () => ({
  refreshFeishuToken: vi.fn(),
}));

describe('pushClipOutput', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('无绑定时返回 no_binding（skipped 模式）', async () => {
    const { default: pool } = await import('../db/connection');
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ notion_token: null, feishu_user_token: null, feishu_refresh_token: null, feishu_token_expires_at: null }], rowCount: 1 } as never);

    const { pushClipOutput } = await import('./clip-output.service');
    const result = await pushClipOutput({
      id: 'clip1',
      user_id: 'user1',
      url: 'https://v.douyin.com/test',
      platform: 'douyin',
      output_url: 'https://www.notion.so/mydb/abcd1234567890abcdef1234567890ab',
      output_type: 'notion',
      title: '测试',
      transcript: null,
      images: [],
      author: null,
      author_id: null,
      like_count: null,
      comment_count: null,
      share_count: null,
      cover_url: null,
      video_url: null,
      output_status: null,
      error_msg: null,
      retry_count: 0,
      raw_response: null,
      status: 'done',
      created_at: new Date(),
      processed_at: new Date(),
      updated_at: new Date(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('no_binding');
  });

  it('无 output_url 时返回 no_output_configured', async () => {
    const { pushClipOutput } = await import('./clip-output.service');
    const result = await pushClipOutput({
      id: 'clip2',
      user_id: 'user1',
      url: 'https://v.douyin.com/test',
      platform: 'douyin',
      output_url: null,
      output_type: null,
      title: null,
      transcript: null,
      images: [],
      author: null,
      author_id: null,
      like_count: null,
      comment_count: null,
      share_count: null,
      cover_url: null,
      video_url: null,
      output_status: null,
      error_msg: null,
      retry_count: 0,
      raw_response: null,
      status: 'done',
      created_at: new Date(),
      processed_at: new Date(),
      updated_at: new Date(),
    });
    expect(result.error).toBe('no_output_configured');
  });
});
