/**
 * pool.ts 配套单元测试（lint-test-pairing 要求）
 *
 * pool.ts 是一个命名导出包装层，把 db/connection 的默认导出重新以 `pool` 命名导出，
 * 使测试里可以用 vi.mock('../db/pool', () => ({ pool: mockPool })) 拦截。
 *
 * 本测试验证：
 *   1. `pool` 命名导出存在且非 null/undefined
 *   2. `pool` 与 connection 默认导出是同一引用（包装不引入副本）
 *   3. `pool` 具有 pg Pool 接口所需的 `query` 和 `connect` 方法
 */
import { describe, it, expect, vi } from 'vitest';

// mock pg Pool 以避免真实数据库连接
const mockConnection = {
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
  on: vi.fn(),
};

vi.mock('./connection', () => ({
  default: mockConnection,
}));

import { pool } from './pool';

describe('db/pool — 命名导出包装层', () => {
  it('pool 导出存在且非 null', () => {
    expect(pool).toBeDefined();
    expect(pool).not.toBeNull();
  });

  it('pool 与 connection 默认导出是同一引用', async () => {
    const { default: connection } = await import('./connection');
    expect(pool).toBe(connection);
  });

  it('pool 具有 query 方法（pg Pool 接口）', () => {
    expect(typeof pool.query).toBe('function');
  });

  it('pool 具有 connect 方法（pg Pool 接口）', () => {
    expect(typeof pool.connect).toBe('function');
  });
});
