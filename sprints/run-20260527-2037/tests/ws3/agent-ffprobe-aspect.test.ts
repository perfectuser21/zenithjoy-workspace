import { describe, it, expect } from 'vitest';
// ⚠️ RED 证据：WS3 实现前 video-pipeline.ts 不导出 computeDetectedAspect
// → import 报 "does not provide an export named 'computeDetectedAspect'"
// → vitest 运行失败（模块错误），提供真实 TDD Red 证据
// WS3 实现后，此 import 通过，测试变绿
import { computeDetectedAspect } from '../../../../services/agent/src/handlers/video-pipeline';

describe('WS3 — computeDetectedAspect 精确行为 [BEHAVIOR]', () => {
  it('portrait video (width < height, rotation=0) → "9:16"', () => {
    expect(computeDetectedAspect(1080, 1920, 0)).toBe('9:16');
  });

  it('landscape video (width > height, rotation=0) → "16:9"', () => {
    expect(computeDetectedAspect(1920, 1080, 0)).toBe('16:9');
  });

  it('iPhone rotation=90° swaps dimensions → 9:16', () => {
    // iPhone 录制：物理 width=1920, height=1080, rotation=90°
    // effectiveWidth=height=1080 < effectiveHeight=width=1920 → "9:16"
    expect(computeDetectedAspect(1920, 1080, 90)).toBe('9:16');
  });

  it('iPhone rotation=270° swaps dimensions → 9:16', () => {
    expect(computeDetectedAspect(1920, 1080, 270)).toBe('9:16');
  });

  it('rotation=0° landscape stays 16:9', () => {
    expect(computeDetectedAspect(1920, 1080, 0)).toBe('16:9');
  });

  it('rotation=180° does NOT swap → stays 16:9', () => {
    // 180° 是上下翻转，不是横竖转换，effectiveWidth/Height 不 swap
    expect(computeDetectedAspect(1920, 1080, 180)).toBe('16:9');
  });

  it('square video (width == height) → "16:9"（width 不小于 height）', () => {
    expect(computeDetectedAspect(1080, 1080, 0)).toBe('16:9');
  });
});
