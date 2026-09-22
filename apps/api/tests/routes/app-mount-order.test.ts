import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const app = readFileSync(join(__dirname, '../../src/app.ts'), 'utf8');

describe('app.ts 挂载顺序', () => {
  it('支付回调路由挂在全局 express.json() 之前（APIv3 验签需要原始字节）', () => {
    const callbackIdx = app.indexOf("'/api/payment/callback'");
    // 用真正的挂载调用 app.use(express.json( 定位，而非裸 'express.json('——
    // 后者会先撞上 line 95 附近既有的 better-auth 说明性注释
    // （"必须在 express.json() 之前 mount"），误判挂载顺序。
    const jsonIdx = app.indexOf('app.use(express.json(');
    expect(callbackIdx).toBeGreaterThan(-1);
    expect(jsonIdx).toBeGreaterThan(-1);
    expect(callbackIdx).toBeLessThan(jsonIdx);
  });

  it('回调路由使用 express.raw 而非 json', () => {
    const seg = app.slice(0, app.indexOf('app.use(express.json('));
    expect(seg).toMatch(/express\.raw\(/);
  });
});
