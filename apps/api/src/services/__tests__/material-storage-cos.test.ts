/**
 * COS 实现里唯一能在 CI 里真测的部分：分片决策。
 *
 * 上传本身要联网、要真 bucket，属于环境接缝，由 smoke 在真环境验
 * （.github/workflows/scripts/smoke/material-upload-smoke.sh）。
 * 这里只守那个纯判断——它错了的后果是大文件走单请求上传，超时、失败重头再来，
 * 而且症状是「偶尔传不上去」这种最难查的形态。
 */
import { describe, it, expect } from 'vitest';
import { shouldSliceUpload, SLICE_THRESHOLD_BYTES } from '../material-storage-cos';

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
