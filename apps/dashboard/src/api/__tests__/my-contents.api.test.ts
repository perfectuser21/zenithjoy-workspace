/**
 * 「我的作品」API 客户端单测。
 *
 * 两块真逻辑值得守：
 *  ① 三个函数都要先换 token 再带 X-Upload-Token 调对应端点——漏了整页 401
 *     （同 materials.api.ts 的坑）。
 *  ② publishMyContent 的 platforms 子集语义——不传 = 整单按原平台发布；
 *     传子集（重发失败平台场景）body 必须只带这个子集，不能整单重派。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 会被 hoist 到文件顶部，工厂里引用不到下面声明的普通变量，
// 用 vi.hoisted 让这些声明跟着一起提上去。
const { get, patch, post } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));
vi.mock('../client', () => ({ apiClient: { get, patch, post } }));

import { listMyContents, updateMyContent, publishMyContent } from '../my-contents.api';

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  post.mockReset();
});

describe('listMyContents — 先换 token 再列作品', () => {
  it('用登录态调 /account 拿 license_key，再带 X-Upload-Token 调 GET /contents', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/contents') return { data: { data: { items: [] } } };
      throw new Error('unexpected url ' + url);
    });

    await listMyContents({ status: 'failed' });

    const call = get.mock.calls.find((c) => c[0] === '/contents');
    expect(call).toBeTruthy();
    expect(call![1].headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
    expect(call![1].params.status).toBe('failed');
  });

  it('账号还没有 license_key → 报可读的错，不去调 /contents', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: null } };
      throw new Error('不该走到这里');
    });
    await expect(listMyContents()).rejects.toThrow(/上传凭据/);
    expect(get.mock.calls.some((c) => c[0] === '/contents')).toBe(false);
  });
});

describe('updateMyContent — 带 X-Upload-Token 调 PATCH /contents/:id', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      throw new Error('unexpected url ' + url);
    });
    patch.mockResolvedValue({ data: { data: { id: 'c1', updated: true } } });
  });

  it('只把改动的字段原样传给 PATCH，且带凭据头', async () => {
    await updateMyContent('c1', { title: '新标题' });
    expect(patch).toHaveBeenCalledWith(
      '/contents/c1',
      { title: '新标题' },
      { headers: { 'X-Upload-Token': 'ZJ-F-TESTKEY' } },
    );
  });
});

describe('publishMyContent — platforms 子集语义（重发失败平台的关键断言）', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      throw new Error('不该走到这里');
    });
    post.mockResolvedValue({ data: { data: {} } });
  });

  it('不传 platforms → body 里不带 platforms（整单按原平台发布），但仍带凭据头', async () => {
    await publishMyContent('c1');
    expect(post).toHaveBeenCalledWith(
      '/contents/c1/publish',
      {},
      { headers: { 'X-Upload-Token': 'ZJ-F-TESTKEY' } },
    );
  });

  it('传 platforms 子集 → body 只带这个子集，绝不整单重派', async () => {
    await publishMyContent('c2', ['weibo']);
    expect(post).toHaveBeenCalledWith(
      '/contents/c2/publish',
      { platforms: ['weibo'] },
      { headers: { 'X-Upload-Token': 'ZJ-F-TESTKEY' } },
    );
  });
});
