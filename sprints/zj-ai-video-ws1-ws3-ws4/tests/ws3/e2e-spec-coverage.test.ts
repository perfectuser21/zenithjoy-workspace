import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// Red test — WS3: E2E spec 更新 + GHA version 更新
// 如果 e2e/agent-video-pipeline.spec.js 未加新步骤则 FAIL
// 如果 agent-e2e-video.yml default version 仍为 1.1.17 则 FAIL

describe('WS3 — E2E spec 覆盖新场景 [BEHAVIOR]', () => {
  const SPEC_PATH = 'e2e/agent-video-pipeline.spec.js';

  it('E2E spec 含 original_script 填写步骤', () => {
    let content: string;
    try {
      content = readFileSync(SPEC_PATH, 'utf8');
    } catch {
      throw new Error(`FAIL: 文件未找到 ${SPEC_PATH}`);
    }
    expect(content).toContain('original_script');
  });

  it('E2E spec 含 W-G 模板选择（W-G 或 WG 关键词）', () => {
    const content = readFileSync(SPEC_PATH, 'utf8');
    const hasWG = content.includes('W-G') || content.includes('WG') || content.includes('W_G');
    expect(hasWG).toBe(true);
  });

  it('E2E spec 含 detected_aspect 字段验证', () => {
    const content = readFileSync(SPEC_PATH, 'utf8');
    expect(content).toContain('detected_aspect');
  });

  it('E2E spec detected_aspect 验证含 expect/断言（非 log）', () => {
    const content = readFileSync(SPEC_PATH, 'utf8');
    // 找到 detected_aspect 出现的上下文，确认有 expect/assert 或非空校验
    const idx = content.indexOf('detected_aspect');
    expect(idx).toBeGreaterThan(-1);
    const context = content.slice(Math.max(0, idx - 200), idx + 200);
    const hasAssertion =
      context.includes('expect') ||
      context.includes('!= null') ||
      context.includes('!== null') ||
      context.includes('toBe') ||
      context.includes('toEqual');
    expect(hasAssertion).toBe(true);
  });

  it('E2E spec 含 screenshot 调用', () => {
    const content = readFileSync(SPEC_PATH, 'utf8');
    expect(content).toContain('screenshot');
  });
});

describe('WS3 — GHA workflow version 更新 [BEHAVIOR]', () => {
  const WORKFLOW_PATH = '.github/workflows/agent-e2e-video.yml';

  it('agent-e2e-video.yml agent_version default 为 1.1.29', () => {
    let content: string;
    try {
      content = readFileSync(WORKFLOW_PATH, 'utf8');
    } catch {
      throw new Error(`FAIL: workflow 文件不存在 ${WORKFLOW_PATH}`);
    }
    expect(content).toContain('1.1.29');
  });

  it('agent-e2e-video.yml 不再含旧 default version 1.1.17', () => {
    const content = readFileSync(WORKFLOW_PATH, 'utf8');
    // default 行不能含旧版本号
    const defaultLine = content
      .split('\n')
      .find(l => l.includes('default:') && l.includes('1.1.'));
    expect(defaultLine).toBeDefined();
    expect(defaultLine).not.toContain('1.1.17');
    expect(defaultLine).toContain('1.1.29');
  });
});
