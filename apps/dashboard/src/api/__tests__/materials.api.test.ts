/**
 * 素材库 API 客户端单测。
 *
 * 这层有两块真逻辑值得守：
 *  ① isVideo —— mime 不可靠时能不能靠扩展名兜住。快捷指令传上来的有时是
 *     application/octet-stream，判错的后果是视频被当图片塞进 <img src>，渲染成破图。
 *  ② 换 token 那一步 —— Dashboard 用登录态、素材端点认 X-Upload-Token，
 *     两套鉴权对不上。这里必须真的带上 header，否则整页 401。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock 会被 hoist 到文件顶部，工厂里引用不到下面声明的普通变量。
// vi.hoisted 让这个声明跟着一起提上去。
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../client', () => ({ apiClient: { get } }));

import { listMaterials, isVideo, formatSize, MAX_PAGE_SIZE } from '../materials.api';

describe('isVideo — mime 不可靠时退回看扩展名', () => {
  it('mime 是 video/* → 是视频', () => {
    expect(isVideo({ mime_type: 'video/mp4', file_name: 'x.bin' })).toBe(true);
  });

  it('mime 是 octet-stream 但扩展名是 .MOV → 仍认成视频', () => {
    // 快捷指令传上来的常常是 octet-stream，判错会把视频塞进 <img> 渲染成破图
    expect(isVideo({ mime_type: 'application/octet-stream', file_name: 'IMG_0001.MOV' })).toBe(true);
  });

  it('mime 为 null 也能靠扩展名判断', () => {
    expect(isVideo({ mime_type: null, file_name: 'a.mp4' })).toBe(true);
    expect(isVideo({ mime_type: null, file_name: 'a.jpg' })).toBe(false);
  });

  it('图片不会被误判成视频', () => {
    expect(isVideo({ mime_type: 'image/jpeg', file_name: 'IMG_7757.jpg' })).toBe(false);
  });
});

describe('formatSize', () => {
  it('各量级都给人类可读的值', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2 KB');
    expect(formatSize(1_427_586)).toBe('1.4 MB');
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe('3.00 GB');
  });

  it('非法值给占位而不是 NaN', () => {
    expect(formatSize(Number.NaN)).toBe('-');
    expect(formatSize(-1)).toBe('-');
  });
});

describe('listMaterials — 先换 token 再列素材', () => {
  beforeEach(() => { get.mockReset(); });

  it('用登录态调 /account 拿 license_key，再带 X-Upload-Token 调 /materials', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'ZJ-F-TESTKEY' } } };
      if (url === '/materials') return { data: { data: { items: [], limit: 30, offset: 0, count: 0 } } };
      throw new Error('unexpected url ' + url);
    });

    await listMaterials({ limit: 60 });

    const call = get.mock.calls.find((c) => c[0] === '/materials');
    expect(call).toBeTruthy();
    // 不带这个 header 的话整页 401 —— Dashboard 的登录态素材端点不认
    expect(call![1].headers['X-Upload-Token']).toBe('ZJ-F-TESTKEY');
    expect(call![1].params.limit).toBe(60);
  });

  it('账号还没有 license_key → 报可读的错，不是塞个 undefined 进 header', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: null } };
      throw new Error('不该走到这里');
    });
    await expect(listMaterials()).rejects.toThrow(/上传凭据/);
    expect(get.mock.calls.some((c) => c[0] === '/materials')).toBe(false);
  });

  it('不提供 tenant_id 参数 —— 租户由服务端从凭据反查，前端传了也不作数', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/account') return { data: { license: { license_key: 'k' } } };
      return { data: { data: { items: [], limit: 30, offset: 0, count: 0 } } };
    });
    await listMaterials();
    const call = get.mock.calls.find((c) => c[0] === '/materials');
    expect(Object.keys(call![1].params)).not.toContain('tenant_id');
  });

  it('MAX_PAGE_SIZE 与服务端硬上限一致', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
  });
});
