/**
 * db/index.ts re-export 测试
 *
 * db/index.ts 只是 re-export connection pool（让 `import pool from '../db'` 与
 * `import pool from '../db/connection'` 等价，方便 vitest vi.mock）。
 * 此测试验证 export 存在且为非 null 对象，同时对 pg.Pool 做 mock 避免真实连接。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PoolMock = vi.fn(() => ({ on: vi.fn() }));

vi.mock('pg', () => ({
  Pool: PoolMock,
}));

describe('db/index re-export', () => {
  beforeEach(() => {
    PoolMock.mockClear();
    vi.resetModules();
  });

  it('default export 存在且不为 null（re-export pool 完整透传）', async () => {
    const mod = await import('../index');
    expect(mod.default).toBeDefined();
    expect(mod.default).not.toBeNull();
  });

  it('db/index default export 与 db/connection default export 是同一对象', async () => {
    const idxMod = await import('../index');
    const connMod = await import('../connection');
    expect(idxMod.default).toBe(connMod.default);
  });
});
