import { describe, it, expect } from 'vitest';

describe('ContentClipperPage helpers', () => {
  it('extractUrl extracts URL from mixed Chinese text', () => {
    const extractUrl = (text: string): string => {
      const m = text.match(/https?:\/\/[^\s一-鿿　-〿【】，。、！？]+/);
      return m ? m[0].replace(/[.,;:!?）)]+$/, '') : text.trim();
    };
    expect(extractUrl('http://xhslink.com/o/abc先复制再打开【小红书】...')).toBe('http://xhslink.com/o/abc');
    expect(extractUrl('https://v.douyin.com/xyz/')).toBe('https://v.douyin.com/xyz/');
    expect(extractUrl('https://v.douyin.com/xyz/,')).toBe('https://v.douyin.com/xyz/');
  });

  it('detectOutputType identifies notion URL', () => {
    const detectOutputType = (url: string): string | null => {
      if (!url) return null;
      if (url.includes('notion.so') || url.includes('notion.site')) return 'notion';
      if (url.includes('feishu.cn') || url.includes('larksuite.com')) return 'feishu';
      return null;
    };
    expect(detectOutputType('https://notion.so/mydb/xxx')).toBe('notion');
    expect(detectOutputType('https://abc.feishu.cn/base/xxx')).toBe('feishu');
    expect(detectOutputType('https://google.com')).toBeNull();
  });
});
