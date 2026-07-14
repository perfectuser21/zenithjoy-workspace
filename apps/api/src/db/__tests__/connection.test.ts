/**
 * DB 连接层 search_path 隔离（P0 事故配套修复，2026-07-13）
 *
 * 背景：Cecelia 侧 migration 341 把 user/session/account/verification/
 * operator_sessions 这 5 张 Better Auth 裸表从 public schema 挪进了
 * zenithjoy schema。原方案曾用 `ALTER DATABASE cecelia SET search_path`
 * 做数据库级别全局设置，导致 Brain 自己的同名 public.tasks 查询被
 * zenithjoy.tasks 抢先解析，Brain 生产容器 crash-loop。
 *
 * 修复：search_path 改在 ZenithJoy 自己的 pg.Pool 连接配置里设置
 * （PostgreSQL 连接级 session 参数，通过 startup packet 传递），
 * 只影响 ZenithJoy 自己发起的连接，不影响共享库里的其他消费方（Brain）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PoolMock = vi.fn(() => ({ on: vi.fn() }));

vi.mock('pg', () => ({
  Pool: PoolMock,
}));

describe('DB connection — search_path 隔离到 ZenithJoy 自己的连接', () => {
  beforeEach(() => {
    PoolMock.mockClear();
    vi.resetModules();
  });

  it('Pool 配置含 options: -c search_path=zenithjoy,public（连接级别，非数据库级别全局设置）', async () => {
    await import('../connection');
    expect(PoolMock).toHaveBeenCalledTimes(1);
    const config = PoolMock.mock.calls[0][0];
    expect(config.options).toBe('-c search_path=zenithjoy,public');
  });

  it('不改变已有连接参数（host/port/database/user/password/max/timeouts 保持不变）', async () => {
    await import('../connection');
    const config = PoolMock.mock.calls[0][0];
    expect(config).toMatchObject({
      max: 20,
      // 2026-07-14 调大：低流量间歇连接超时→采集500根因修复（见 ../connection.test.ts REGRESSION）
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
    });
  });
});
