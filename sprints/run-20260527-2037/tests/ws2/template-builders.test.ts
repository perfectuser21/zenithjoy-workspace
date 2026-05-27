import { describe, it, expect } from 'vitest';
import * as fs from 'fs';

const CTRL_SRC = fs.readFileSync('apps/api/src/controllers/ai-video-pipeline-ai.controller.ts', 'utf8');

describe('WS2 — 三模板专属 Builder 函数存在 [BEHAVIOR]', () => {
  it('_buildWGHtml 函数在 controller 源码中 export', () => {
    expect(CTRL_SRC).toMatch(/export\s+(function|const)\s+_buildWGHtml/);
  });

  it('_buildCHtml 函数在 controller 源码中 export', () => {
    expect(CTRL_SRC).toMatch(/export\s+(function|const)\s+_buildCHtml/);
  });

  it('_buildRHtml 函数在 controller 源码中 export', () => {
    expect(CTRL_SRC).toMatch(/export\s+(function|const)\s+_buildRHtml/);
  });
});

describe('WS2 — 模板专属视觉标识 [BEHAVIOR]', () => {
  it('_buildWGHtml 实现中含 W-G 专属背景色 #ede4d2 或强调色 d39c4a', () => {
    const fnIdx = CTRL_SRC.indexOf('_buildWGHtml');
    expect(fnIdx, '_buildWGHtml 函数未找到').toBeGreaterThan(-1);
    const chunk = CTRL_SRC.slice(fnIdx, fnIdx + 4000);
    expect(chunk).toMatch(/#ede4d2|d39c4a|ede4d2/i);
  });

  it('_buildCHtml 实现中含 C 模板专属背景色 #0a0a0a 或强调色 c9a23d', () => {
    const fnIdx = CTRL_SRC.indexOf('_buildCHtml');
    expect(fnIdx, '_buildCHtml 函数未找到').toBeGreaterThan(-1);
    const chunk = CTRL_SRC.slice(fnIdx, fnIdx + 4000);
    expect(chunk).toMatch(/#0a0a0a|c9a23d|0a0a0a/i);
  });

  it('_buildRHtml 实现中含 R 模板专属背景色 #1d1410 或玫瑰金 c08e6a', () => {
    const fnIdx = CTRL_SRC.indexOf('_buildRHtml');
    expect(fnIdx, '_buildRHtml 函数未找到').toBeGreaterThan(-1);
    const chunk = CTRL_SRC.slice(fnIdx, fnIdx + 4000);
    expect(chunk).toMatch(/#1d1410|c08e6a|1d1410/i);
  });
});

describe('WS2 — composeTemplate dispatch + response schema [BEHAVIOR]', () => {
  it('composeTemplate 函数体内调用 _buildWGHtml、_buildCHtml、_buildRHtml', () => {
    const composeIdx = CTRL_SRC.indexOf('async function composeTemplate');
    expect(composeIdx, 'composeTemplate 函数未找到').toBeGreaterThan(-1);
    const composeEnd = CTRL_SRC.indexOf('\nexport ', composeIdx + 10);
    const fn = CTRL_SRC.slice(composeIdx, composeEnd > 0 ? composeEnd : composeIdx + 5000);
    expect(fn).toContain('_buildWGHtml');
    expect(fn).toContain('_buildCHtml');
    expect(fn).toContain('_buildRHtml');
  });

  it('compose-template res.json() 不含禁用字段 content/result/ratio/output', () => {
    const resJsons = CTRL_SRC.match(/res\.json\(\{[\s\S]*?\}\)/g) ?? [];
    const combined = resJsons.join('');
    expect(combined).not.toMatch(/\bcontent:/);
    expect(combined).not.toMatch(/\bresult:/);
    expect(combined).not.toMatch(/\bratio:/);
    expect(combined).not.toMatch(/\boutput:/);
  });

  it('未知 templateId 返回 400 status + error 字段', () => {
    expect(CTRL_SRC).toContain('status(400)');
    expect(CTRL_SRC).toContain('unknown template');
  });
});
