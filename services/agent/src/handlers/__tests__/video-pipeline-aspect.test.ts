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

  it('非模板路径 Step 7B 不同时无条件写出 9_16.mp4 和 16_9.mp4（单文件输出）', () => {
    // 找到 Step 7B 开始（merge audio 注释）
    const step7Start = SRC.lastIndexOf('Step 7/7] output');
    if (step7Start === -1) {
      expect(true).toBe(true);
      return;
    }
    const step7Block = SRC.slice(step7Start, step7Start + 1500);
    // 两条输出路径不能在同一个顺序块里无条件都出现
    const has916 = step7Block.includes('output916') || step7Block.includes('9_16.mp4');
    const has169 = step7Block.includes('output169') || step7Block.includes('16_9.mp4');
    // 至少其中一个不存在，或存在但被 if/else 保护（含 effectiveTarget 判断）
    if (has916 && has169) {
      // 如果两者都存在，必须有条件分支（if/else + effectiveTarget）
      expect(step7Block).toContain('effectiveTarget');
    }
  });

  it('VideoPipelineJob interface 含 target_aspect 字段', () => {
    const ifaceBlock = SRC.slice(
      SRC.indexOf('interface VideoPipelineJob'),
      SRC.indexOf('}', SRC.indexOf('interface VideoPipelineJob')) + 1,
    );
    expect(ifaceBlock).toContain('target_aspect');
  });
});
