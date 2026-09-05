/**
 * COS 实现里能在 CI 里真测的部分：分片决策（纯函数），以及 presignPut/
 * headObject 的参数拼装与错误分支（打桩 SDK）。
 *
 * 真正联网、真的连 bucket 属于环境接缝，由 smoke 在真环境验
 * （.github/workflows/scripts/smoke/material-upload-smoke.sh）。
 * 分片判断错了的后果是大文件走单请求上传，超时、失败重头再来，症状是
 * 「偶尔传不上去」这种最难查的形态。
 * presignPut/headObject 打桩验证的是参数是否传对、404 与非 404 错误是否
 * 被正确区分——尤其是最后一条：把网络故障误判成「文件不存在」会让
 * complete 阶段把本来传成功的素材当失败丢掉。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { shouldSliceUpload, SLICE_THRESHOLD_BYTES } from '../material-storage-cos';

const getObjectUrl = vi.fn();
const headObjectFn = vi.fn();
vi.mock('cos-nodejs-sdk-v5', () => ({
  default: class {
    getObjectUrl = getObjectUrl;
    headObject = headObjectFn;
  },
}));

const ENV = {
  COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key',
  COS_BUCKET: 'b', COS_REGION: 'ap-guangzhou',
} as NodeJS.ProcessEnv;

describe('shouldSliceUpload — 大文件必须走分片', () => {
  it('小文件走普通上传', () => {
    expect(shouldSliceUpload(1024)).toBe(false);
    expect(shouldSliceUpload(SLICE_THRESHOLD_BYTES - 1)).toBe(false);
  });

  it('到阈值就走分片', () => {
    expect(shouldSliceUpload(SLICE_THRESHOLD_BYTES)).toBe(true);
  });

  it('iPhone 1080p 短视频（约 100MB）走分片', () => {
    expect(shouldSliceUpload(100 * 1024 * 1024)).toBe(true);
  });

  it('2GB 上限的文件走分片 —— 单请求传 2GB 必超时', () => {
    expect(shouldSliceUpload(2 * 1024 * 1024 * 1024)).toBe(true);
  });

  it('阈值不高于 COS 分片最小片大小的合理倍数（20MB）', () => {
    expect(SLICE_THRESHOLD_BYTES).toBe(20 * 1024 * 1024);
  });

  it('0 字节不走分片（空文件走普通路径，让上层去拒）', () => {
    expect(shouldSliceUpload(0)).toBe(false);
  });
});

describe('CosMaterialStorage.presignPut', () => {
  beforeEach(() => { getObjectUrl.mockReset(); });

  it('用 Method=PUT 且 Sign=true 签发，过期秒数透传', async () => {
    getObjectUrl.mockImplementation((_p: unknown, cb: (e: unknown, d: { Url: string }) => void) =>
      cb(null, { Url: 'https://cos/x?sig=1' }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    const url = await new CosMaterialStorage(ENV).presignPut('t1/m1/a.jpg', 7200);
    expect(url).toBe('https://cos/x?sig=1');
    const params = getObjectUrl.mock.calls[0][0];
    expect(params.Method).toBe('PUT');
    expect(params.Sign).toBe(true);
    expect(params.Key).toBe('t1/m1/a.jpg');
    expect(params.Expires).toBe(7200);
  });
});

describe('CosMaterialStorage.headObject', () => {
  beforeEach(() => { headObjectFn.mockReset(); });

  it('对象存在 → 返回真实大小', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown, d: unknown) => void) =>
      cb(null, { headers: { 'content-length': '4096' } }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    expect(await new CosMaterialStorage(ENV).headObject('t1/m1/a.jpg')).toEqual({ sizeBytes: 4096 });
  });

  it('404 → 返回 null，不抛异常', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown) => void) => cb({ statusCode: 404 }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    expect(await new CosMaterialStorage(ENV).headObject('t1/m1/missing.jpg')).toBeNull();
  });

  it('非 404 的错误必须抛出——不能把网络故障当成「文件不存在」', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown) => void) =>
      cb({ statusCode: 503, message: 'service unavailable' }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    await expect(new CosMaterialStorage(ENV).headObject('t1/m1/a.jpg')).rejects.toThrow();
  });
});
