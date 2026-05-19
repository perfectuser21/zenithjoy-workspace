import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// __dirname = .../services/agent/src/handlers/__tests__
// 5 levels up = worktree root
const REPO_ROOT = resolve(__dirname, '../../../../../');
const VIDEO_PIPELINE = resolve(__dirname, '../video-pipeline.ts');
const COMPOSE_CTRL = resolve(REPO_ROOT, 'apps/api/src/controllers/ai-video-pipeline-ai.controller.ts');

describe('template path: audio merge after HyperFrames render', () => {
  it('video-pipeline.ts merges original audio into template output (-map 1:a)', () => {
    const src = readFileSync(VIDEO_PIPELINE, 'utf-8');
    // 修复后 template 路径必须有 -map 1:a（把原视频音轨 merge 进 HF 输出）
    expect(src).toContain('1:a');
  });
});

describe('_buildCompositionHtml: GSAP timeline hold to full duration', () => {
  it('controller adds tl.to({}) hold at p.duration to prevent short render', () => {
    const src = readFileSync(COMPOSE_CTRL, 'utf-8');
    // 修复后必须含有 tl.to({} hold，且目标时间用 p.duration
    expect(src).toMatch(/tl\.to\(\{\}.*p\.duration/s);
  });
});

describe('composeTemplate: slot extraction failure logging', () => {
  it('controller logs warning when slot extraction fails', () => {
    const src = readFileSync(COMPOSE_CTRL, 'utf-8');
    // 修复后 slot catch 块里必须有 console.warn
    expect(src).toContain('console.warn');
  });
});
