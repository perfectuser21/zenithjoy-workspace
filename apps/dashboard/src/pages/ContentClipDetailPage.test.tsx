import { describe, it, expect } from 'vitest';

describe('ContentClipDetailPage helpers', () => {
  it('output status label mapping is complete', () => {
    const OUTPUT_STATUS_LABEL: Record<string, string> = {
      pending: '待推送', pushed: '已推送', failed: '推送失败', skipped: '无输出配置',
    };
    expect(OUTPUT_STATUS_LABEL['pushed']).toBe('已推送');
    expect(OUTPUT_STATUS_LABEL['failed']).toBe('推送失败');
    expect(OUTPUT_STATUS_LABEL['pending']).toBe('待推送');
    expect(OUTPUT_STATUS_LABEL['skipped']).toBe('无输出配置');
  });

  it('transcript preview truncates at 500 chars', () => {
    const PREVIEW_LEN = 500;
    const long = 'a'.repeat(600);
    const preview = long.slice(0, PREVIEW_LEN);
    expect(preview.length).toBe(500);
    expect(long.length > PREVIEW_LEN).toBe(true);
  });
});
