/**
 * WS4 RED tests — golden-path-1-smoke.sh Step 6 扩展 + e2e-verify.ps1
 *
 * 当前 smoke.sh Step 6 不含 dispatch chain；e2e-verify.ps1 不存在。
 * 测试**必须 RED**，实现后转绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, accessSync } from 'node:fs';
import { join } from 'node:path';

const SMOKE_SCRIPT = join(__dirname, '..', '..', '..', '..', '.github', 'workflows', 'scripts', 'smoke', 'golden-path-1-smoke.sh');
const E2E_SCRIPT = join(__dirname, '..', '..', 'e2e-verify.ps1');

describe('WS4 — smoke Step 6 expansion + e2e-verify.ps1 [BEHAVIOR]', () => {
  it('golden-path-1-smoke.sh Step 6 正文应含 api/works 的 curl 调用（非注释行）', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf8');
    const nonCommentLines = src.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    expect(nonCommentLines).toContain('/api/works/');
  });

  it('golden-path-1-smoke.sh 应含 task-ack 调用', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf8');
    expect(src).toContain('task-ack');
  });

  it('golden-path-1-smoke.sh 应含 publish_status 的 jq/python 断言（非注释行）', () => {
    const src = readFileSync(SMOKE_SCRIPT, 'utf8');
    const nonCommentLines = src.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
    expect(nonCommentLines).toContain('publish_status');
  });

  it('sprints/step6-dispatch-chain/e2e-verify.ps1 应存在（windows_cloud final-e2e）', () => {
    expect(() => accessSync(E2E_SCRIPT)).not.toThrow();
    const src = readFileSync(E2E_SCRIPT, 'utf8');
    expect(src).toContain('ZENITHJOY_API_BASE');
    expect(src).toContain('task-ack');
  });
});
