import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = readFileSync(join(__dirname, '../../src/app.ts'), 'utf8');

describe('app.ts 挂载顺序', () => {
  it('支付回调路由挂在全局 express.json() 之前（APIv3 验签需要原始字节）', () => {
    const callbackIdx = app.indexOf("'/api/payment/callback'");
    const jsonIdx = app.indexOf('express.json(');
    expect(callbackIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(callbackIdx).toBeLessThan(jsonIdx);
  });

  it('回调路由使用 express.raw 而非 json', () => {
    const seg = app.slice(0, app.indexOf('express.json('));
    expect(seg).toMatch(/express\.raw\(/);
  });
});
