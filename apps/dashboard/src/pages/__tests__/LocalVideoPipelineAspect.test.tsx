import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// CI runs vitest from apps/dashboard/ working-directory
const PAGE_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../pages/LocalVideoPipelinePage.tsx'),
  'utf8',
);
const E2E_SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../../../e2e/agent-video-pipeline.spec.js'),
  'utf8',
);

describe('WS4 — Dashboard UI original_script + aspect selector + E2E 更新 [BEHAVIOR]', () => {
  it('LocalVideoPipelinePage 含 original_script 状态变量', () => {
    expect(PAGE_SRC).toContain('original_script');
  });

  it('LocalVideoPipelinePage createJob API call 传 original_script', () => {
    // Match the entire axios.post block (from post call to closing })
    const axiosMatch = PAGE_SRC.match(/axios\.post[\s\S]{0,2000}ai-video[\s\S]{0,2000}original_script/);
    expect(axiosMatch).not.toBeNull();
  });

  it('LocalVideoPipelinePage createJob API call 传 target_aspect', () => {
    const axiosMatch = PAGE_SRC.match(/axios\.post[\s\S]{0,2000}ai-video[\s\S]{0,2000}target_aspect/);
    expect(axiosMatch).not.toBeNull();
  });

  it('UI 含画幅选择器选项 9:16 和 16:9', () => {
    expect(PAGE_SRC).toContain('9:16');
    expect(PAGE_SRC).toContain('16:9');
  });

  it('UI 不含禁用字段名 aspect_ratio / raw_script / source_script', () => {
    expect(PAGE_SRC).not.toContain('aspect_ratio:');
    expect(PAGE_SRC).not.toContain('raw_script:');
    expect(PAGE_SRC).not.toContain('source_script:');
  });

  it('E2E spec 含 original_script 字段引用', () => {
    expect(E2E_SRC).toContain('original_script');
  });

  it('E2E spec 含 detected_aspect 字段断言', () => {
    expect(E2E_SRC).toContain('detected_aspect');
  });
});
