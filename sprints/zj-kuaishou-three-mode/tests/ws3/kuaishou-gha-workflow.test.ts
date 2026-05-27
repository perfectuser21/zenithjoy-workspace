import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WORKFLOW_PATH = path.resolve(
  __dirname,
  '../../../../.github/workflows/kuaishou-e2e.yml'
);

describe('WS3 — .github/workflows/kuaishou-e2e.yml 新建 [BEHAVIOR]', () => {
  it('workflow 文件已创建', () => {
    expect(fs.existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it('使用 windows-latest runner', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('windows-latest');
  });

  it('含 KUAISHOU_COOKIES secret 引用（CI cookie 注入机制）', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('KUAISHOU_COOKIES');
  });

  it('含 image-dryrun 脚本调用步骤', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('image-dryrun');
  });

  it('含 video-dryrun 脚本调用步骤', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('video-dryrun');
  });

  it('含 upload-artifact 步骤（截图上传为可审查证据）', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('upload-artifact');
  });

  it('upload-artifact 有 if: always()（失败时也上传截图）', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('always()');
  });

  it('含 SCREENSHOT_DIR 环境变量传递', () => {
    const content = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content).toContain('SCREENSHOT_DIR');
  });
});
