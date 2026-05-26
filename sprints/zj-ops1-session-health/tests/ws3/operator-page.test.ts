import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const operatorPagePath = 'apps/dashboard/src/pages/OperatorPage.tsx';
const navConfigPath = 'apps/dashboard/src/config/navigation.config.ts';

describe('WS3 — OperatorPage.tsx + navigation.config.ts [BEHAVIOR]', () => {
  it('OperatorPage.tsx 文件应存在（新建页面）', () => {
    expect(existsSync(operatorPagePath)).toBe(true);
  });

  it('OperatorPage.tsx 应包含 is_operator 权限判断（邮件或角色标志）', () => {
    const code = readFileSync(operatorPagePath, 'utf-8');
    const hasAuth = code.includes('xuxiao21xx@icloud.com') ||
      code.includes('is_operator') ||
      code.includes('isOperator');
    expect(hasAuth).toBe(true);
  });

  it('OperatorPage.tsx 应包含多平台状态矩阵展示逻辑', () => {
    const code = readFileSync(operatorPagePath, 'utf-8');
    const hasStatusDisplay =
      code.includes('🟢') || code.includes('🔴') || code.includes('⚫') ||
      (code.includes('status') && (code.includes('green') || code.includes('online') || code.includes('offline')));
    expect(hasStatusDisplay).toBe(true);
  });

  it('OperatorPage.tsx 应包含手动触发同步按钮', () => {
    const code = readFileSync(operatorPagePath, 'utf-8');
    const hasButton =
      code.includes('手动触发') ||
      code.includes('触发同步') ||
      (code.includes('Button') && (code.includes('sync') || code.includes('Sync') || code.includes('同步')));
    expect(hasButton).toBe(true);
  });

  it('OperatorPage.tsx 应包含非 operator 用户访问保护', () => {
    const code = readFileSync(operatorPagePath, 'utf-8');
    const hasProtection =
      code.includes('navigate') ||
      code.includes('redirect') ||
      code.includes('无权限') ||
      code.includes('Access Denied') ||
      code.includes('return null');
    expect(hasProtection).toBe(true);
  });

  it('navigation.config.ts 应包含 /operator 路由注册', () => {
    const nav = readFileSync(navConfigPath, 'utf-8');
    expect(nav).toContain('/operator');
  });

  it('navigation.config.ts 应包含 OperatorPage 懒加载映射', () => {
    const nav = readFileSync(navConfigPath, 'utf-8');
    expect(nav).toContain('OperatorPage');
  });
});
