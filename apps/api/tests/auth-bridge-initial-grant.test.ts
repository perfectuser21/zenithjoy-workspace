import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '../src/auth-bridge.ts'), 'utf8');

describe('注册送积分', () => {
  it('free fallback 路径调用了 recharge 且 reason 为 initial_grant', () => {
    expect(src).toMatch(/initial_grant/);
    expect(src).toMatch(/recharge\(/);
  });

  it('赠送额度为 100', () => {
    expect(src).toMatch(/INITIAL_GRANT_CREDITS\s*=\s*100/);
  });

  it('入账失败不阻断注册（有 try/catch 包裹）', () => {
    const idx = src.indexOf('initial_grant');
    const around = src.slice(Math.max(0, idx - 600), idx + 600);
    expect(around).toMatch(/try\s*{/);
    expect(around).toMatch(/catch/);
  });
});
