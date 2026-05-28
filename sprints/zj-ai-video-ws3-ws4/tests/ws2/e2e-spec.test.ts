import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const E2E_PATH = path.resolve('e2e/agent-video-pipeline.spec.js');
const SRC = fs.readFileSync(E2E_PATH, 'utf8');

describe('WS2 — E2E spec W-G + 9:16 + detected_aspect 非空强断言 [BEHAVIOR]', () => {
  it('spec 含 W-G 模板选择点击代码', () => {
    expect(SRC).toContain('W-G');
    // click 交互出现在同一文件
    const wgIdx = SRC.indexOf('W-G');
    const surroundingCode = SRC.slice(Math.max(0, wgIdx - 200), wgIdx + 200);
    expect(surroundingCode).toMatch(/click|locator|getByText/i);
  });

  it('spec 含 9:16 画幅按钮点击，且出现在提交按钮之前', () => {
    expect(SRC).toContain('9:16');
    const aspectIdx = SRC.indexOf('9:16');
    const submitIdx = SRC.indexOf('开始处理');
    expect(aspectIdx).toBeLessThan(submitIdx);
  });

  it('detected_aspect 断言使用严格 toMatch 或 toBe（不含 null 在合法值集中）', () => {
    const strictPattern = /toMatch\([^)]*9:16[^)]*16:9|toBe\([^)]*9:16|toBe\([^)]*16:9|toMatch.*\/(9:16\|16:9)/;
    expect(strictPattern.test(SRC)).toBe(true);
  });

  it('spec 不再含 [\'9:16\', \'16:9\', null].toContain 形式的宽松 null 断言', () => {
    const hasLooseNull = SRC.includes("'16:9', null") || SRC.includes('"16:9", null') || SRC.includes('null].toContain');
    expect(hasLooseNull).toBe(false);
  });
});
