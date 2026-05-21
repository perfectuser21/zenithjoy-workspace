import { describe, it, expect } from 'vitest';

describe('clips route helpers', () => {
  it('detectPlatform returns null for invalid URL', async () => {
    const { detectPlatform } = await import('../services/clips.service');
    expect(detectPlatform('https://unknown.com')).toBeNull();
  });

  it('parseOutputUrl identifies notion type', async () => {
    const { parseOutputUrl } = await import('../services/clip-output.service');
    const notion = parseOutputUrl('https://notion.so/770c40c2ba6383ea86d001eba832c218');
    expect(notion?.type).toBe('notion');
  });

  it('parseOutputUrl identifies feishu type', async () => {
    const { parseOutputUrl } = await import('../services/clip-output.service');
    const feishu = parseOutputUrl('https://abc.feishu.cn/base/MYTOKEN?table=MYTABLE');
    expect(feishu?.type).toBe('feishu');
  });
});
