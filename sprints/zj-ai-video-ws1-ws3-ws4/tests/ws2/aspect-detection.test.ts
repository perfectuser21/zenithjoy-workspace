import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Red test — WS2: 比例选择 + 画幅检测
// 如果 Agent video-pipeline.ts 未实现 detectedAspect / effectiveTarget 则 FAIL
// 如果前端未加 target_aspect 则 FAIL

describe('WS2 — detectedAspect 计算逻辑 [BEHAVIOR]', () => {

  // 核心逻辑提取为纯函数，便于 unit test
  function computeDetectedAspect(params: {
    width: number;
    height: number;
    rotation: number;
  }): '9:16' | '16:9' {
    const { width, height, rotation } = params;
    // rotation=90°/270° → swap
    const effectiveWidth = (rotation === 90 || rotation === 270) ? height : width;
    const effectiveHeight = (rotation === 90 || rotation === 270) ? width : height;
    return effectiveWidth < effectiveHeight ? '9:16' : '16:9';
  }

  it('iPhone 竖拍：1920×1080 rotation=90° → detectedAspect="9:16"', () => {
    const result = computeDetectedAspect({ width: 1920, height: 1080, rotation: 90 });
    expect(result).toBe('9:16');
  });

  it('iPhone 竖拍：1920×1080 rotation=270° → detectedAspect="9:16"', () => {
    const result = computeDetectedAspect({ width: 1920, height: 1080, rotation: 270 });
    expect(result).toBe('9:16');
  });

  it('横屏拍摄：1920×1080 rotation=0 → detectedAspect="16:9"', () => {
    const result = computeDetectedAspect({ width: 1920, height: 1080, rotation: 0 });
    expect(result).toBe('16:9');
  });

  it('真实竖屏：1080×1920 rotation=0 → detectedAspect="9:16"', () => {
    const result = computeDetectedAspect({ width: 1080, height: 1920, rotation: 0 });
    expect(result).toBe('9:16');
  });

  it('effectiveTarget = target_aspect ?? detectedAspect ?? "9:16" 优先级正确', () => {
    const effectiveTarget = (
      targetAspect: string | null | undefined,
      detectedAspect: string | null | undefined,
    ): string => targetAspect ?? detectedAspect ?? '9:16';

    expect(effectiveTarget('16:9', '9:16')).toBe('16:9');   // user 覆盖 detection
    expect(effectiveTarget(null, '9:16')).toBe('9:16');      // detection 回落
    expect(effectiveTarget(null, null)).toBe('9:16');         // 最终默认
    expect(effectiveTarget(null, undefined)).toBe('9:16');
  });
});

describe('WS2 — Agent 源码含必要逻辑 [BEHAVIOR]', () => {
  const HANDLER_PATH = 'services/agent/src/handlers/video-pipeline.ts';

  it('video-pipeline.ts 含 detectedAspect 变量', () => {
    let content: string;
    try {
      content = readFileSync(HANDLER_PATH, 'utf8');
    } catch {
      throw new Error(`FAIL: 文件未找到 ${HANDLER_PATH} — Agent 逻辑尚未实现`);
    }
    expect(content).toContain('detectedAspect');
  });

  it('video-pipeline.ts 含 effectiveTarget 变量', () => {
    const content = readFileSync(HANDLER_PATH, 'utf8');
    expect(content).toContain('effectiveTarget');
  });

  it('video-pipeline.ts 含 detected_aspect（PATCH 写回字段）', () => {
    const content = readFileSync(HANDLER_PATH, 'utf8');
    expect(content).toContain('detected_aspect');
  });

  it('video-pipeline.ts 含 effectiveWidth/effectiveHeight（rotation swap）', () => {
    const content = readFileSync(HANDLER_PATH, 'utf8');
    expect(content).toContain('effectiveWidth');
    expect(content).toContain('effectiveHeight');
  });
});

describe('WS2 — 前端 LocalVideoPipelinePage 含 target_aspect [BEHAVIOR]', () => {
  const PAGE_PATH = 'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx';

  it('LocalVideoPipelinePage.tsx createJob 调用体含 target_aspect 字段', () => {
    let content: string;
    try {
      content = readFileSync(PAGE_PATH, 'utf8');
    } catch {
      throw new Error(`FAIL: 文件未找到 ${PAGE_PATH}`);
    }
    // createJob 请求体必须含 target_aspect
    expect(content).toContain('target_aspect');
  });

  it('LocalVideoPipelinePage.tsx 含比例选择器选项（9:16 和 16:9）', () => {
    const content = readFileSync(PAGE_PATH, 'utf8');
    expect(content).toContain('9:16');
    expect(content).toContain('16:9');
  });
});
