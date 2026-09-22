import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../src/db/connection';
import { recharge, DuplicateCreditError } from '../../src/services/credits.service';

vi.mock('../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client) }, __client: client };
});

const client = (await import('../../src/db/connection') as any).__client;

beforeEach(() => {
  client.query.mockReset();
  client.release.mockReset();
});

describe('recharge 幂等参数', () => {
  it('传 orderId 时写入 credit_transactions.order_id', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    await recharge('t-1', 100, 'recharge', { provider: 'mock' }, 'order-1');

    const txInsert = client.query.mock.calls.find(
      (c: any[]) => /INSERT INTO zenithjoy\.credit_transactions/i.test(c[0])
    );
    expect(txInsert).toBeDefined();
    expect(txInsert[0]).toMatch(/order_id/);
    expect(txInsert[1]).toContain('order-1');
  });

  it('order_id 唯一索引冲突(23505) → 抛 DuplicateCreditError 且已 ROLLBACK', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('ROLLBACK')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      if (/INSERT INTO zenithjoy\.credit_transactions/i.test(sql)) {
        const err: any = new Error('duplicate key');
        err.code = '23505';
        err.constraint = 'idx_credit_tx_order';
        throw err;
      }
      return { rows: [] };
    });

    await expect(
      recharge('t-1', 100, 'recharge', undefined, 'order-dup')
    ).rejects.toBeInstanceOf(DuplicateCreditError);

    expect(client.query.mock.calls.some((c: any[]) => c[0] === 'ROLLBACK')).toBe(true);
  });

  it('不传 orderId 时行为与旧版一致（向后兼容）', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 50, total_recharged: 50, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    const r = await recharge('t-2', 50, 'initial_grant');
    expect(r.balance).toBe(50);

    const txInsert = client.query.mock.calls.find(
      (c: any[]) => /INSERT INTO zenithjoy\.credit_transactions/i.test(c[0])
    );
    expect(txInsert[1][4]).toBeNull();
  });
});
