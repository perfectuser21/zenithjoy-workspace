import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../');
const CONTROLLER = join(ROOT, 'apps/api/src/controllers/ai-video-pipeline-ai.controller.ts');

describe('WS2 — 模板专属 HTML 构建函数 [BEHAVIOR]', () => {
  it('_buildWGHtml 函数定义存在于 controller 文件', () => {
    const src = readFileSync(CONTROLLER, 'utf8');
    // WS2 实现前: 无此函数 → FAIL
    expect(src).toContain('_buildWGHtml');
  });

  it('_buildCHtml 和 _buildRHtml 函数定义存在', () => {
    const src = readFileSync(CONTROLLER, 'utf8');
    // WS2 实现前: 无此函数 → FAIL
    expect(src).toContain('_buildCHtml');
    expect(src).toContain('_buildRHtml');
  });

  it('_buildDynamicTemplateHtml 分发到 _buildWGHtml（switch 或条件语句）', () => {
    const src = readFileSync(CONTROLLER, 'utf8');
    // 找 _buildDynamicTemplateHtml 函数体，验证其内调用 _buildWGHtml
    const funcStart = src.indexOf('_buildDynamicTemplateHtml');
    expect(funcStart).toBeGreaterThan(-1);
    const funcBody = src.slice(funcStart, funcStart + 2000);
    // WS2 实现前: 无分发逻辑 → FAIL
    expect(funcBody).toMatch(/_buildWGHtml|case.*W-G|'W-G'.*_build/);
  });

  it('W-G 专属函数包含 #ede4d2 PrepPRD 底色 + 1080px / 1920px 竖版尺寸', () => {
    const src = readFileSync(CONTROLLER, 'utf8');
    // WS2 实现前: 函数不存在，以下 expect 均 FAIL
    const wgStart = src.indexOf('_buildWGHtml');
    expect(wgStart).toBeGreaterThan(-1);
    const wgBody = src.slice(wgStart, src.indexOf('\n}', wgStart) + 2);
    expect(wgBody).toContain('ede4d2');
    // 尺寸（硬编码在函数内）
    expect(src).toContain('1080');
    expect(src).toContain('1920');
  });
});
