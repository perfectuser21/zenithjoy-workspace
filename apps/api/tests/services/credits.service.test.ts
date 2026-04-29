/**
 * Credits service 单元测试 — PR-C 积分基建
 *
 * 覆盖：
 *   - getBalance 不存在 tenant → null
 *   - recharge 新 tenant → 创建行 + balance/total_recharged 正确
 *   - recharge amount<=0 → 抛错
 *   - consume 余额不足 → INSUFFICIENT_CREDITS
 *   - consume 成功 → balance 扣减 + transaction 记录
 *   - listTransactions → 倒序
 *   - CREDIT_COSTS 常量
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../src/db/connection';
import {
  getBalance,
  recharge,
  consume,
  listTransactions,
  CREDIT_COSTS,
  InsufficientCreditsError,
} from '../../src/services/credits.service';

vi.mock('../../src/db/connection', () => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(),
      end: vi.fn(),
      connect: vi.fn(async () => client),
      __client: client,
    },
  };
});

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockClient = (pool as any).__client as {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

const TENANT_ID = 'aaaaaaaa-1111-2222-3333-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('credits.service: CREDIT_COSTS 常量', () => {
  it('ai_writing = 5', () => {
    expect(CREDIT_COSTS.ai_writing).toBe(5);
  });
  it('competitor_research = 10', () => {
    expect(CREDIT_COSTS.competitor_research).toBe(10);
  });
});

describe('credits.service: getBalance', () => {
  it('tenant 不存在 → 返回 null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await getBalance(TENANT_ID);
    expect(r).toBeNull();
  });

  it('tenant 存在 → 返回 balance/total_recharged/total_consumed', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ balance: 80, total_recharged: 100, total_consumed: 20 }],
    });
    const r = await getBalance(TENANT_ID);
    expect(r).toEqual({
      balance: 80,
      total_recharged: 100,
      total_consumed: 20,
    });
  });
});

describe('credits.service: recharge', () => {
  it('amount <= 0 → 抛错', async () => {
    await expect(recharge(TENANT_ID, 0, 'recharge')).rejects.toThrow(
      /amount/i
    );
    await expect(recharge(TENANT_ID, -10, 'recharge')).rejects.toThrow(
      /amount/i
    );
  });

  it('新 tenant 充值 → 走事务（BEGIN/upsert/insert tx/COMMIT）', async () => {
    // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // upsert tenant_credits → 返回新 balance
    mockClient.query.mockResolvedValueOnce({
      rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }],
    });
    // insert transaction
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'tx-1' }] });
    // COMMIT
    mockClient.query.mockResolvedValueOnce({ rows: [] });

    const r = await recharge(TENANT_ID, 100, 'initial_grant');
    expect(r.balance).toBe(100);
    expect(r.total_recharged).toBe(100);
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('SQL 抛错 → ROLLBACK', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockRejectedValueOnce(new Error('boom'));
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(recharge(TENANT_ID, 50, 'recharge')).rejects.toThrow('boom');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('credits.service: consume', () => {
  it('amount <= 0 → 抛错', async () => {
    await expect(consume(TENANT_ID, 0, 'ai_writing')).rejects.toThrow(
      /amount/i
    );
  });

  it('余额不足 → 抛 INSUFFICIENT_CREDITS（带 ROLLBACK）', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    // SELECT current row（FOR UPDATE）
    mockClient.query.mockResolvedValueOnce({
      rows: [{ balance: 3 }],
    });
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(consume(TENANT_ID, 5, 'ai_writing')).rejects.toThrow(
      InsufficientCreditsError
    );
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('tenant 未初始化（balance row 不存在）→ INSUFFICIENT_CREDITS', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // SELECT 无行
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    await expect(consume(TENANT_ID, 5, 'ai_writing')).rejects.toThrow(
      InsufficientCreditsError
    );
  });

  it('成功扣减 → 余额减少 + 写 transaction 负数 + COMMIT', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [{ balance: 100 }] }); // SELECT
    mockClient.query.mockResolvedValueOnce({
      rows: [{ balance: 95, total_recharged: 100, total_consumed: 5 }],
    }); // UPDATE
    mockClient.query.mockResolvedValueOnce({ rows: [{ id: 'tx-2' }] }); // INSERT tx
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // COMMIT

    const r = await consume(TENANT_ID, 5, 'ai_writing');
    expect(r.balance).toBe(95);
    expect(r.total_consumed).toBe(5);
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');

    // 验证 INSERT transaction 的 amount 是负数
    const insertCall = mockClient.query.mock.calls.find((c) =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO zenithjoy.credit_transactions')
    );
    expect(insertCall).toBeTruthy();
    expect(insertCall![1]).toContain(-5);
  });
});

describe('credits.service: listTransactions', () => {
  it('返回倒序最近 N 条', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 't2', tenant_id: TENANT_ID, amount: -5, reason: 'ai_writing', metadata: null, created_at: '2026-04-29T10:00:00Z' },
        { id: 't1', tenant_id: TENANT_ID, amount: 100, reason: 'initial_grant', metadata: null, created_at: '2026-04-29T09:00:00Z' },
      ],
    });
    const r = await listTransactions(TENANT_ID, 50);
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe('t2');
    // SQL 应带 ORDER BY created_at DESC + LIMIT
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toMatch(/ORDER BY .*created_at DESC/i);
    expect(sql).toMatch(/LIMIT/i);
  });

  it('默认 limit=50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await listTransactions(TENANT_ID);
    const params = mockQuery.mock.calls[0][1] as unknown[];
    expect(params).toContain(50);
  });
});
