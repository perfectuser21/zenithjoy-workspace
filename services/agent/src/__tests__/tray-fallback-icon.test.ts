// services/agent/src/__tests__/tray-fallback-icon.test.ts
//
// Sprint 06240003 — Agent 形态收口：托盘图标兜底必须是悦升云端 logo，绝不是 1x1 透明空白。
//
// 背景（Issue 5c770b55）：tray.ts 读 build/tray-icon.png 失败时旧版兜底成 1×1 透明 PNG，
// 用户看到的就是「空白托盘」。本测试真解码内嵌兜底 base64，断言它是一张可辨识的
// 32×32 PNG（= 悦升云端缩略图），而非 1×1（旧空白兜底的特征尺寸）。
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import {
  _getFallbackIconBase64ForTest,
  _loadIconBase64ForTest,
} from '../tray';

// 从 PNG 字节读取 IHDR 宽高（width/height 各 4 字节大端，紧跟在 8 字节签名 + 4 长度 + 4 "IHDR" 后）
function pngSize(buf: Buffer): { width: number; height: number } {
  // PNG 签名
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(buf.subarray(0, 8).equals(sig)).toBe(true);
  // IHDR 数据从偏移 16 开始：width(16..20) height(20..24)
  expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('托盘兜底图标 — 悦升云端 logo，非 1x1 透明空白', () => {
  it('内嵌兜底 base64 解码为有效 PNG 且尺寸 = 32x32（非 1x1 空白）', () => {
    const b64 = _getFallbackIconBase64ForTest();
    expect(b64.length).toBeGreaterThan(200); // 1x1 透明 PNG 的 base64 极短(~90)，logo 远大于此
    const buf = Buffer.from(b64, 'base64');
    const { width, height } = pngSize(buf);
    expect(width).toBe(32);
    expect(height).toBe(32);
    // 明确排除旧空白兜底特征：1×1
    expect(width).not.toBe(1);
    expect(height).not.toBe(1);
  });

  it('all platform icon candidates missing returns the embedded fallback PNG', () => {
    // Make the absence explicit, including Windows icon.ico candidates.
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    const read = vi.spyOn(fs, 'readFileSync');
    try {
      const out = _loadIconBase64ForTest();
      expect(exists).toHaveBeenCalledTimes(3);
      expect(read).not.toHaveBeenCalled();
      expect(out).toBe(_getFallbackIconBase64ForTest());
      const buf = Buffer.from(out, 'base64');
      const { width, height } = pngSize(buf);
      expect(width).toBeGreaterThan(1);
      expect(height).toBeGreaterThan(1);
      expect(width).toBe(32);
      expect(height).toBe(32);
    } finally {
      read.mockRestore();
      exists.mockRestore();
    }
  });
});
