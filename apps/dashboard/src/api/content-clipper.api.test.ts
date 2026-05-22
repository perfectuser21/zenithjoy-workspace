import { describe, it, expect } from 'vitest';
import type { Clip, ClipSettings } from './content-clipper.api';

describe('content-clipper.api types', () => {
  it('Clip type has required fields', () => {
    const clip: Clip = {
      id: 'abc', user_id: 'u1', url: 'https://x.com', platform: 'douyin',
      status: 'pending', title: null, transcript: null, images: [],
      author: null, like_count: null, cover_url: null, video_url: null,
      output_url: null, output_type: null, output_status: null,
      error_msg: null, retry_count: 0, created_at: '2026-01-01', processed_at: null,
    };
    expect(clip.id).toBe('abc');
    expect(clip.status).toBe('pending');
  });

  it('ClipSettings type has required fields including binding status', () => {
    const s: ClipSettings = {
      defaultOutputUrl: null,
      defaultOutputType: null,
      notionBound: false,
      feishuBound: false,
    };
    expect(s.defaultOutputUrl).toBeNull();
    expect(s.notionBound).toBe(false);
    expect(s.feishuBound).toBe(false);
  });
});
