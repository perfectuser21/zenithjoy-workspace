import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../');
const WORKER = join(ROOT, 'services/agent/src/handlers/video-pipeline.ts');

describe('WS3 — ffprobe width/height + detectedAspect + 比例选择 [BEHAVIOR]', () => {
  it('detectAspect 函数在 video-pipeline.ts 中定义', () => {
    const src = readFileSync(WORKER, 'utf8');
    // WS3 实现前: 无 detectAspect → FAIL
    expect(src).toContain('detectAspect');
  });

  it('detectAspect 含 rotation swap 逻辑 (rotation=90 → 交换 width/height)', () => {
    const src = readFileSync(WORKER, 'utf8');
    // rotation swap 的特征：有 90° 相关判断 + 宽高互换
    const hasSwap =
      (src.includes('90') && (
        src.includes('[h, w]') ||
        src.includes('[height, width]') ||
        src.includes('effectiveW') ||
        src.includes('swap') ||
        src.match(/rotation.*90[\s\S]{0,50}width.*height|rotation.*90[\s\S]{0,50}height.*width/)
      ));
    // WS3 实现前: 无 rotation swap → FAIL
    expect(hasSwap).toBe(true);
  });

  it('migration 含 detected_aspect 列定义', () => {
    const migrDir = join(ROOT, 'apps/api/db/migrations');
    const files = readdirSync(migrDir).filter((f) => f.endsWith('.sql'));
    const found = files.some((f) => {
      try {
        const c = readFileSync(join(migrDir, f), 'utf8');
        return c.includes('detected_aspect') && c.includes('ai_video_pipeline_jobs');
      } catch {
        return false;
      }
    });
    // WS3 实现前: 无 migration → FAIL
    expect(found).toBe(true);
  });

  it('LocalVideoPipelinePage 含 target_aspect 比例选择器 (9:16 / 16:9)', () => {
    const src = readFileSync(
      join(ROOT, 'apps/dashboard/src/pages/LocalVideoPipelinePage.tsx'),
      'utf8',
    );
    // WS3 实现前: 无比例选择器 → FAIL
    expect(src).toContain('target_aspect');
    expect(src).toContain('9:16');
  });

  it('video-pipeline.ts 含 effectiveTarget 单文件逻辑（非模板路径）', () => {
    const src = readFileSync(WORKER, 'utf8');
    // WS3 实现前: effectiveTarget 不存在 → FAIL
    expect(src).toContain('effectiveTarget');
    // 强制双文件逻辑（output916 + output169 无条件并写）应已删除
    const hasUnconditionalDouble =
      /copyFileSync[^;]+9_16[^;]+;[\s\S]{0,300}copyFileSync[^;]+16_9[^;]+;/.test(src) &&
      !/if|effectiveTarget|target/.test(
        src.slice(src.indexOf('copyFileSync'), src.indexOf('copyFileSync') + 500),
      );
    expect(hasUnconditionalDouble).toBe(false);
  });
});
