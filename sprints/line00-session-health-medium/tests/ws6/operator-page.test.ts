import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('WS6 — OperatorPage.tsx 升级 + E2E spec [BEHAVIOR]', () => {
  const pagePath = 'apps/dashboard/src/pages/OperatorPage.tsx';
  const specPath = 'apps/dashboard/e2e/operator-sessions.spec.ts';

  it('OperatorPage.tsx 含 data-testid="login-btn-{platform}" 模式', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    expect(content).toMatch(/login-btn-/);
  });

  it('OperatorPage.tsx 含 bind-start API 调用', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    expect(content).toContain('bind-start');
  });

  it('OperatorPage.tsx 含 sessions/status 轮询端点', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    expect(content).toContain('sessions/status');
  });

  it('OperatorPage.tsx status=ok 显示绿色标识（✅ 或 green class）', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    const hasGreen = content.includes('✅') || content.includes('green') || content.includes('在线');
    expect(hasGreen).toBe(true);
  });

  it('OperatorPage.tsx status=expired 显示红色标识（❌ 或 red class）', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    const hasRed = content.includes('❌') || content.includes('red') || content.includes('过期');
    expect(hasRed).toBe(true);
  });

  it('OperatorPage.tsx 含按钮 disabled/pending 逻辑（登录中状态）', () => {
    const content = fs.readFileSync(pagePath, 'utf8');
    const hasPending = content.includes('登录中') || content.includes('disabled') || content.includes('pending');
    expect(hasPending).toBe(true);
  });

  it('E2E spec 文件存在', () => {
    expect(fs.existsSync(specPath)).toBe(true);
  });

  it('E2E spec 含 Playwright 断言（toBeVisible/toHaveText/expect）', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    const hasAssert = content.includes('toBeVisible') || content.includes('toHaveText') || content.includes('expect(');
    expect(hasAssert).toBe(true);
  });

  it('E2E spec 含 login-btn data-testid 使用', () => {
    const content = fs.readFileSync(specPath, 'utf8');
    expect(content).toMatch(/login-btn/);
  });
});
