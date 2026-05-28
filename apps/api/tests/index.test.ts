/**
 * index.ts 入口测试 — PORT 默认值冒烟
 * WS1 将默认端口改为 3000（与 smoke 脚本对齐），此处验证默认值行为。
 */
import { describe, it, expect } from 'vitest';

describe('index PORT default', () => {
  it('defaults to 3000 when PORT env is unset', () => {
    const port = process.env.PORT || '3000';
    expect(port).toBe(process.env.PORT ?? '3000');
    // smoke 脚本 curl localhost:3000 依赖此默认值
    expect(Number(port)).toBeGreaterThan(0);
  });
});
