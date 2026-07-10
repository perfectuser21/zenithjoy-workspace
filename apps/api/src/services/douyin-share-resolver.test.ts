import { describe, it, expect } from 'vitest';
import {
  extractShareUrl,
  parseMediaFromUrl,
  resolveShareUrl,
  type HttpHead,
} from './douyin-share-resolver';

describe('extractShareUrl — 从分享文案抽 v.douyin.com 短链', () => {
  it('从含中文前后缀的分享文案里抽出短链', () => {
    const text = '7.68 复制打开抖音，看看【某某的作品】https://v.douyin.com/iRNBho6G/ 快来！';
    expect(extractShareUrl(text)).toBe('https://v.douyin.com/iRNBho6G/');
  });

  it('容忍 emoji / 换行，抽第一个短链', () => {
    const text = '🔥超好看\nhttps://v.douyin.com/AbC123\n👇';
    expect(extractShareUrl(text)).toBe('https://v.douyin.com/AbC123');
  });

  it('去掉尾部中文标点', () => {
    expect(extractShareUrl('看这个 https://v.douyin.com/xYz789。')).toBe('https://v.douyin.com/xYz789');
  });

  it('无短链返回 null', () => {
    expect(extractShareUrl('这是一段没有链接的文字')).toBeNull();
    expect(extractShareUrl('')).toBeNull();
  });

  it('非 v.douyin.com 域名不抽（防钓鱼链接）', () => {
    expect(extractShareUrl('https://evil.com/v.douyin.com/x')).toBeNull();
  });
});

describe('parseMediaFromUrl — 从最终 URL 抽 kind+id', () => {
  it('video 详情页抽 19 位数字 id', () => {
    expect(parseMediaFromUrl('https://www.douyin.com/video/7412345678901234567')).toEqual({
      kind: 'video',
      id: '7412345678901234567',
    });
  });

  it('note 图文详情页抽 id', () => {
    expect(parseMediaFromUrl('https://www.iesdouyin.com/share/note/7412345678901234567/?x=1')).toEqual({
      kind: 'note',
      id: '7412345678901234567',
    });
  });

  it('拒绝 <10 位的短数字（页面里其他数字）', () => {
    expect(parseMediaFromUrl('https://www.douyin.com/video/12345')).toBeNull();
  });

  it('登录/验证页无 /video|/note 结构返回 null', () => {
    expect(parseMediaFromUrl('https://www.douyin.com/passport/web/login')).toBeNull();
  });
});

// 注入式 httpGet：不真发网络，模拟每一跳的 status + Location
function fakeHops(hops: Array<{ status: number; location?: string }>): HttpHead {
  let i = 0;
  return async (_url: string) => {
    const h = hops[i] ?? { status: 200 };
    i += 1;
    return { status: h.status, location: h.location ?? null };
  };
}

describe('resolveShareUrl — 手动跟随 302 拿真实 media', () => {
  it('单跳 302 → /video/<id> 提取成功', async () => {
    const httpGet = fakeHops([{ status: 302, location: 'https://www.douyin.com/video/7412345678901234567' }]);
    await expect(resolveShareUrl('https://v.douyin.com/iRNBho6G/', { httpGet })).resolves.toEqual({
      kind: 'video',
      id: '7412345678901234567',
    });
  });

  it('多级跳转（≤3 跳）也能拿到', async () => {
    const httpGet = fakeHops([
      { status: 301, location: 'https://www.iesdouyin.com/share/video/7412345678901234567/?a=1' },
      { status: 200 },
    ]);
    await expect(resolveShareUrl('https://v.douyin.com/x/', { httpGet })).resolves.toEqual({
      kind: 'video',
      id: '7412345678901234567',
    });
  });

  it('note 短链解析出 note 类型', async () => {
    const httpGet = fakeHops([{ status: 302, location: 'https://www.iesdouyin.com/share/note/7412345678901234567/' }]);
    await expect(resolveShareUrl('https://v.douyin.com/n/', { httpGet })).resolves.toEqual({
      kind: 'note',
      id: '7412345678901234567',
    });
  });

  it('重定向到登录/验证页 → null（不误抽）', async () => {
    const httpGet = fakeHops([{ status: 302, location: 'https://www.douyin.com/passport/web/login?redirect=1' }]);
    await expect(resolveShareUrl('https://v.douyin.com/x/', { httpGet })).resolves.toBeNull();
  });

  it('超过最大跳数仍未命中 → null', async () => {
    const httpGet = fakeHops([
      { status: 302, location: 'https://www.douyin.com/a' },
      { status: 302, location: 'https://www.douyin.com/b' },
      { status: 302, location: 'https://www.douyin.com/c' },
      { status: 302, location: 'https://www.douyin.com/video/7412345678901234567' },
    ]);
    await expect(resolveShareUrl('https://v.douyin.com/x/', { httpGet, maxHops: 3 })).resolves.toBeNull();
  });

  it('跳出抖音域名（SSRF 防护）→ 停止跟随返回 null', async () => {
    const httpGet = fakeHops([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]);
    await expect(resolveShareUrl('https://v.douyin.com/x/', { httpGet })).resolves.toBeNull();
  });

  it('HTTP 抛错 → null（吞掉网络异常不崩）', async () => {
    const httpGet: HttpHead = async () => {
      throw new Error('ETIMEDOUT');
    };
    await expect(resolveShareUrl('https://v.douyin.com/x/', { httpGet })).resolves.toBeNull();
  });

  it('传入非 v.douyin.com 短链直接 null', async () => {
    const httpGet = fakeHops([{ status: 302, location: 'https://www.douyin.com/video/7412345678901234567' }]);
    await expect(resolveShareUrl('https://evil.com/x', { httpGet })).resolves.toBeNull();
  });
});
