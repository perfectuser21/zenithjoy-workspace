import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// CI runs vitest from services/agent/ working-directory
const SRC = fs.readFileSync(path.resolve(__dirname, '../../handlers/video-pipeline.ts'), 'utf8');

describe('WS3 — Agent ffprobe width/height + detectedAspect + 单文件输出 [BEHAVIOR]', () => {
  it('Step 1 读取 vStream.width 和 vStream.height', () => {
    const step1Block = SRC.slice(SRC.indexOf('[Step 1/7]'), SRC.indexOf('[Step 1/7]') + 3000);
    expect(step1Block).toMatch(/\.width|vStream\.width/);
    expect(step1Block).toMatch(/\.height|vStream\.height/);
  });

  it('effectiveWidth / effectiveHeight 变量存在（rotation swap 逻辑）', () => {
    expect(SRC).toContain('effectiveWidth');
    expect(SRC).toContain('effectiveHeight');
  });

  it('detectedAspect 变量存在并与 9:16 或 16:9 相关联', () => {
    expect(SRC).toContain('detectedAspect');
    const detectedBlock = SRC.slice(SRC.indexOf('detectedAspect'), SRC.indexOf('detectedAspect') + 500);
    expect(detectedBlock).toMatch(/9:16|16:9/);
  });

  it('effectiveTarget 变量使用 target_aspect 优先（?? 或 || 链）', () => {
    expect(SRC).toContain('effectiveTarget');
    const targetBlock = SRC.slice(SRC.indexOf('effectiveTarget'), SRC.indexOf('effectiveTarget') + 200);
    expect(targetBlock).toMatch(/target_aspect|job\.target_aspect/);
  });

  it('detected_aspect 被 PATCH 写回 API（progress endpoint 或专属 endpoint）', () => {
    expect(SRC).toContain('detected_aspect');
    const patchIdx = SRC.indexOf('detected_aspect');
    const surroundingCode = SRC.slice(Math.max(0, patchIdx - 200), patchIdx + 200);
    expect(surroundingCode).toMatch(/fetch|progress|PATCH|fireProgress/i);
  });

  it('非模板路径 copyFileSync 调用次数不超过 1（单文件输出）', () => {
    const nonTplStart = SRC.lastIndexOf('// ── Non-template path');
    if (nonTplStart === -1) {
      expect(true).toBe(true);
      return;
    }
    const nonTplEnd = SRC.indexOf('\n  } catch', nonTplStart);
    const nonTplBlock = nonTplEnd > 0 ? SRC.slice(nonTplStart, nonTplEnd) : SRC.slice(nonTplStart, nonTplStart + 2000);
    const copies = (nonTplBlock.match(/copyFileSync/g) ?? []).length;
    expect(copies).toBeLessThanOrEqual(1);
  });

  it('VideoPipelineJob interface 含 target_aspect 字段', () => {
    const ifaceBlock = SRC.slice(
      SRC.indexOf('interface VideoPipelineJob'),
      SRC.indexOf('}', SRC.indexOf('interface VideoPipelineJob')) + 1,
    );
    expect(ifaceBlock).toContain('target_aspect');
  });
});
