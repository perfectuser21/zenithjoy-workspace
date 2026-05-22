import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./clips.service', () => ({
  getSettings: vi.fn(),
  upsertFeishuBinding: vi.fn(),
}));
vi.mock('./clips-auth.service', () => ({
  refreshFeishuToken: vi.fn(),
}));

describe('pushClipOutput', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('无绑定时返回 no_binding（skipped 模式）', async () => {
    const { getSettings } = await import('./clips.service');
    vi.mocked(getSettings).mockResolvedValue({
      defaultOutputUrl: null,
      defaultOutputType: null,
      notionBound: false,
      feishuBound: false,
    });

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
