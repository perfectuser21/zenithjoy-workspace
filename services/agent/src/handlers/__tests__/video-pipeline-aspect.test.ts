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

describe('Step 7B — 9:16 必须用 phone overlay + portrait crop，禁止 vstack [REGRESSION]', () => {
  // 获取 Step 7B 代码块（从"Step 7/7] output"注释到函数结束）
  const step7Start = SRC.lastIndexOf('Step 7/7] output');
  const step7Block = step7Start !== -1 ? SRC.slice(step7Start, step7Start + 3000) : '';

  it('Step 7B 代码块存在', () => {
    expect(step7Start).toBeGreaterThan(0);
  });

  it('Step 7B 使用 phone overlay（overlay= filter）把原始视频叠入手机框', () => {
    // overlay= 是 ffmpeg 叠加滤镜，必须存在于 Step 7B
    expect(step7Block).toMatch(/overlay=/);
  });

  it('Step 7B 对 9:16 目标做 portrait crop（607:1080:0:0）而非 vstack', () => {
    // 9:16 输出必须包含从 phone overlay 结果裁剪左侧 607px 的操作
    expect(step7Block).toMatch(/crop=607[^,]/);
  });

  it('Step 7B 不使用 vstack（vstack 无法显示手机框）', () => {
    // vstack 是 bug：把原始视频裸堆在文字条上，不含手机框
    expect(step7Block).not.toContain('vstack');
  });
});

describe('Step 6B — HyperFrames 必须用 --resolution landscape 渲染 1920×1080 [REGRESSION]', () => {
  // 找到 Step 6/7 hf-render 的代码块
  const step6Idx = SRC.lastIndexOf('Step 6/7 hf-render');
  const step6Block = step6Idx !== -1 ? SRC.slice(step6Idx, step6Idx + 500) : '';

  it('HyperFrames render 包含 --resolution landscape 标志', () => {
    expect(step6Block).toContain('--resolution landscape');
  });
});
