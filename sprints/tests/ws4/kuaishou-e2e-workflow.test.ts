// sprints/tests/ws4/kuaishou-e2e-workflow.test.ts
// TDD Red — WS4: .github/workflows/kuaishou-e2e.yml 新建
//
// 文件不存在 → readFileSync 抛 ENOENT → content 为空 → 所有断言 FAIL → Red ✅
// WS4 完成后文件存在且断言 PASS → Green ✅

import { describe, it, expect } from 'vitest';
import fs from 'fs';

const WORKFLOW_PATH = '/workspace/.github/workflows/kuaishou-e2e.yml';

let content = '';
try { content = fs.readFileSync(WORKFLOW_PATH, 'utf8'); } catch { /* Red: file not exist */ }

describe('.github/workflows/kuaishou-e2e.yml 新建 [BEHAVIOR]', () => {
  it('文件存在（readFileSync 不抛 → content 非空）', () => {
    expect(content.length).toBeGreaterThan(0);
  });

  it('含 windows-latest runner 配置', () => {
    expect(content).toContain('windows-latest');
  });

  it('含 KUAISHOU_COOKIES secret 引用', () => {
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 image-dryrun 脚本执行步骤', () => {
    expect(content).toContain('kuaishou-image-dryrun');
  });

  it('含 video-dryrun 脚本执行步骤', () => {
    expect(content).toContain('kuaishou-video-dryrun');
  });

  it('含 upload-artifact 步骤（if: always()）', () => {
    expect(content).toContain('upload-artifact');
    expect(content).toContain('always()');
  });
});
