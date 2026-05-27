import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../');

describe('WS4 — Agent v1.1.29 + E2E spec 更新 [BEHAVIOR]', () => {
  it('Agent package.json version 精确等于 1.1.29', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'services/agent/package.json'), 'utf8'));
    // WS4 实现前: version=1.1.28 → FAIL
    expect(pkg.version).toBe('1.1.29');
  });

  it('E2E spec 含 original_script 字段填写逻辑', () => {
    const src = readFileSync(join(ROOT, 'e2e/agent-video-pipeline.spec.js'), 'utf8');
    // WS4 实现前: spec 无此代码 → FAIL
    expect(src).toContain('original_script');
  });

  it('E2E spec 含 W-G 模板选择代码', () => {
    const src = readFileSync(join(ROOT, 'e2e/agent-video-pipeline.spec.js'), 'utf8');
    // WS4 实现前: spec 无此代码 → FAIL
    expect(src).toContain('W-G');
  });

  it('E2E spec 含 9:16 比例选择 + 断言', () => {
    const src = readFileSync(join(ROOT, 'e2e/agent-video-pipeline.spec.js'), 'utf8');
    // WS4 实现前: spec 无此代码 → FAIL
    expect(src).toContain('9:16');
    // 必须有断言（不仅是注释）
    const hasAssert =
      src.includes('original_script') &&
      (src.includes('toBe(') || src.includes('toEqual(') || src.includes('==='));
    expect(hasAssert).toBe(true);
  });

  it('GHA workflow agent_version 默认值含 1.1.29', () => {
    const src = readFileSync(join(ROOT, '.github/workflows/agent-e2e-video.yml'), 'utf8');
    // WS4 实现前: 默认值仍是旧版本 → FAIL
    expect(src).toContain('1.1.29');
    expect(src).toContain('windows-latest');
  });
});
