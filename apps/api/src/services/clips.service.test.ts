import { describe, it, expect } from 'vitest';
import { detectPlatform } from './clips.service';

describe('detectPlatform', () => {
  it('detects douyin.com', () => {
    expect(detectPlatform('https://www.douyin.com/video/123')).toBe('douyin');
  });
  it('detects v.douyin.com short link', () => {
    expect(detectPlatform('https://v.douyin.com/abc123/')).toBe('douyin');
  });
  it('detects xiaohongshu.com', () => {
    expect(detectPlatform('https://www.xiaohongshu.com/explore/xxx')).toBe('xiaohongshu');
  });
  it('detects xhslink.com short link', () => {
    expect(detectPlatform('http://xhslink.com/o/601Ky先复制再打开')).toBe('xiaohongshu');
  });
  it('returns null for unknown', () => {
    expect(detectPlatform('https://youtube.com/watch')).toBeNull();
  });
});
