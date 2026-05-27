import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS7 — e2e-verify.ps1 final-e2e 脚本 [BEHAVIOR]', () => {
  const ps1Path = 'sprints/line00-session-health-medium/e2e-verify.ps1';

  it('e2e-verify.ps1 文件存在', () => {
    expect(fs.existsSync(ps1Path)).toBe(true);
  });

  it('e2e-verify.ps1 含 operator-sessions.spec.ts 引用', () => {
    const content = fs.readFileSync(ps1Path, 'utf8');
    expect(content).toContain('operator-sessions.spec.ts');
  });

  it('e2e-verify.ps1 含 npm.cmd Windows 兼容写法', () => {
    const content = fs.readFileSync(ps1Path, 'utf8');
    expect(content).toContain('npm.cmd');
  });

  it('e2e-verify.ps1 含 Test-NetConnection 端口检测', () => {
    const content = fs.readFileSync(ps1Path, 'utf8');
    expect(content).toContain('Test-NetConnection');
  });

  it('e2e-verify.ps1 含端口 5174', () => {
    const content = fs.readFileSync(ps1Path, 'utf8');
    expect(content).toContain('5174');
  });

  it('e2e-verify.ps1 含 Set-StrictMode（错误传播保证）', () => {
    const content = fs.readFileSync(ps1Path, 'utf8');
    expect(content).toContain('Set-StrictMode');
  });
});
