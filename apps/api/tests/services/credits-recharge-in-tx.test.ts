/**
 * rechargeInTx 事务内入账测试 — Task 3 修复
 *
 * 背景：结算（支付订单 CAS + 入账）需要在调用方自己的事务里原子完成。
 * recharge() 自己 pool.connect()+BEGIN/COMMIT，若被结算流程直接调用，
 * 会退化成「订单 CAS」和「入账」两个独立事务：入账先提交而订单事务随后
 * 回滚时，积分已加但订单状态退回 pending，下一次重复回调会再次 CAS
 * 成功并重复加积分。
 *
 * 覆盖：
 *   - rechargeInTx 使用传入的 client，不调用 pool.connect()
 *   - rechargeInTx 不发出 BEGIN/COMMIT/ROLLBACK（事务由调用方掌控）
 *   - rechargeInTx 命中 23505 且传了 orderId → 抛 DuplicateCreditError，且不自行 ROLLBACK
 *   - rechargeInTx 返回的余额结构与 recharge 一致
 *   - recharge() 仍然自己管理事务（BEGIN/COMMIT 齐全），行为与修改前一致
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pool from '../../src/db/connection';
import { recharge, rechargeInTx, DuplicateCreditError } from '../../src/services/credits.service';

vi.mock('../../src/db/connection', () => {
  const client = { query: vi.fn(), release: vi.fn() };
  return { default: { connect: vi.fn(async () => client) }, __client: client };
});

const client = (await import('../../src/db/connection') as any).__client;

beforeEach(() => {
  client.query.mockReset();
  client.release.mockReset();
  (pool.connect as ReturnType<typeof vi.fn>).mockClear();
});

describe('rechargeInTx — 事务内入账（调用方自管事务）', () => {
  it('使用传入的 client 执行 SQL，不调用 pool.connect()', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    await rechargeInTx(client, 't-1', 100, 'settlement', { orderNo: 'x' }, 'order-1');

    expect(pool.connect).not.toHaveBeenCalled();
    // 调用方传入的 client 被用于执行 SQL
    expect(client.query).toHaveBeenCalled();
  });

  it('不发出 BEGIN / COMMIT / ROLLBACK，事务由调用方掌控', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    await rechargeInTx(client, 't-1', 100, 'settlement');

    const calledSql = client.query.mock.calls.map((c: any[]) => String(c[0]).trim());
    expect(calledSql.some((s: string) => /^BEGIN/i.test(s))).toBe(false);
    expect(calledSql.some((s: string) => /^COMMIT/i.test(s))).toBe(false);
    expect(calledSql.some((s: string) => /^ROLLBACK/i.test(s))).toBe(false);
  });

  it('命中 23505 且传了 orderId → 抛 DuplicateCreditError，且不自行 ROLLBACK', async () => {
    client.query.mockImplementation(async (sql: string) => {
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
      rechargeInTx(client, 't-1', 100, 'settlement', undefined, 'order-dup')
    ).rejects.toBeInstanceOf(DuplicateCreditError);

    const calledSql = client.query.mock.calls.map((c: any[]) => String(c[0]).trim());
    expect(calledSql.some((s: string) => /^ROLLBACK/i.test(s))).toBe(false);
  });

  it('返回的余额结构与 recharge 一致', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 200, total_recharged: 200, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    const r = await rechargeInTx(client, 't-1', 200, 'settlement');
    expect(r).toEqual({ balance: 200, total_recharged: 200, total_consumed: 0 });
  });
});

describe('recharge() — 仍自己管理事务，行为与修改前一致', () => {
  it('BEGIN/COMMIT 齐全', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('BEGIN') || sql.startsWith('COMMIT')) return {};
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      return { rows: [] };
    });

    const r = await recharge('t-1', 100, 'recharge', { provider: 'mock' }, 'order-1');

    expect(pool.connect).toHaveBeenCalled();
    const calledSql = client.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(calledSql).toContain('BEGIN');
    expect(calledSql).toContain('COMMIT');
    expect(r).toEqual({ balance: 100, total_recharged: 100, total_consumed: 0 });
    expect(client.release).toHaveBeenCalled();
  });

  it('23505 冲突时 ROLLBACK 并抛 DuplicateCreditError', async () => {
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

    const calledSql = client.query.mock.calls.map((c: any[]) => String(c[0]));
    expect(calledSql).toContain('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });

  // I-6：此前只要「传了 orderId」就把任何 23505 当作"这单已入过账"自愈处理。
  // 将来给 credit_transactions 加任何其它唯一约束，命中的都会被误判成已入账，
  // 触发自愈路径吞掉一个本该向上抛出的真实错误。必须核对 err.constraint 确实是
  // idx_credit_tx_order 才能判定为"重复入账"。
  it('I-6：命中 23505 但 constraint 不是 idx_credit_tx_order（未来新增的其它唯一约束）→ 不误判为重复入账，原样抛出原始错误', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO zenithjoy\.tenant_credits/i.test(sql)) {
        return { rows: [{ balance: 100, total_recharged: 100, total_consumed: 0 }] };
      }
      if (/INSERT INTO zenithjoy\.credit_transactions/i.test(sql)) {
        const err: any = new Error('duplicate key value violates unique constraint "some_other_idx"');
        err.code = '23505';
        err.constraint = 'some_other_idx';
        throw err;
      }
      return { rows: [] };
    });

    const err: any = await rechargeInTx(
      client, 't-1', 100, 'settlement', undefined, 'order-dup'
    ).catch((e) => e);

    expect(err).not.toBeInstanceOf(DuplicateCreditError);
    expect(err.code).toBe('23505');
    expect(err.constraint).toBe('some_other_idx');
  });
});
