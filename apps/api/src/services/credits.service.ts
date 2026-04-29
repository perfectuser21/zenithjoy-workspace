/**
 * Credits 业务服务 — PR-C 积分基建
 *
 * 职责：
 *   - getBalance：读取 tenant 余额（不存在返回 null）
 *   - recharge：原子事务充值（upsert tenant_credits + INSERT transaction）
 *   - consume：原子事务扣减（SELECT...FOR UPDATE → 检查 balance → UPDATE → INSERT tx）
 *   - listTransactions：返回最近 N 条流水，倒序
 *
 * 单价常量 CREDIT_COSTS：业务端点用 createCreditCharger(reasonKey) 自动扣减。
 *
 * 事务一致性：所有写操作都用 pool.connect() + BEGIN/COMMIT/ROLLBACK，
 * 确保余额变更与流水落库原子化。
 */

import pool from '../db/connection';

// ==================== 单价常量 ====================
//
// 主理人决策（2026-04-29）：暂定值，便于后续调整。
//
export const CREDIT_COSTS = {
  ai_writing: 5,
  competitor_research: 10,
} as const;

export type CreditReasonKey = keyof typeof CREDIT_COSTS;

// ==================== 类型 ====================

export interface BalanceRow {
  balance: number;
  total_recharged: number;
  total_consumed: number;
}

export interface TransactionRow {
  id: string;
  tenant_id: string;
  amount: number;
  reason: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ==================== 自定义错误 ====================

export class InsufficientCreditsError extends Error {
  public readonly code = 'INSUFFICIENT_CREDITS';
  public readonly required: number;
  public readonly current: number;

  constructor(required: number, current: number) {
    super(`INSUFFICIENT_CREDITS: 需要 ${required} 积分，当前余额 ${current}`);
    this.name = 'InsufficientCreditsError';
    this.required = required;
    this.current = current;
  }
}

// ==================== getBalance ====================

export async function getBalance(tenantId: string): Promise<BalanceRow | null> {
  const { rows } = await pool.query<BalanceRow>(
    `SELECT balance, total_recharged, total_consumed
       FROM zenithjoy.tenant_credits
      WHERE tenant_id = $1
      LIMIT 1`,
    [tenantId]
  );
  if (rows.length === 0) return null;
  // 确保 number 类型（pg INTEGER 已是 number，但保险起见）
  const r = rows[0];
  return {
    balance: Number(r.balance),
    total_recharged: Number(r.total_recharged),
    total_consumed: Number(r.total_consumed),
  };
}

// ==================== recharge ====================

export async function recharge(
  tenantId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>
): Promise<BalanceRow> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`INVALID_AMOUNT: 充值 amount 必须是正整数（得到 ${amount}）`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // upsert tenant_credits
    const { rows } = await client.query<BalanceRow>(
      `INSERT INTO zenithjoy.tenant_credits
         (tenant_id, balance, total_recharged, total_consumed, updated_at)
       VALUES ($1, $2, $2, 0, now())
       ON CONFLICT (tenant_id) DO UPDATE
         SET balance = zenithjoy.tenant_credits.balance + EXCLUDED.balance,
             total_recharged = zenithjoy.tenant_credits.total_recharged + EXCLUDED.balance,
             updated_at = now()
       RETURNING balance, total_recharged, total_consumed`,
      [tenantId, amount]
    );

    // INSERT transaction（amount 正数 = 充值）
    await client.query(
      `INSERT INTO zenithjoy.credit_transactions (tenant_id, amount, reason, metadata)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, amount, reason, metadata ? JSON.stringify(metadata) : null]
    );

    await client.query('COMMIT');
    const r = rows[0];
    return {
      balance: Number(r.balance),
      total_recharged: Number(r.total_recharged),
      total_consumed: Number(r.total_consumed),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ==================== consume ====================

export async function consume(
  tenantId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>
): Promise<BalanceRow> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`INVALID_AMOUNT: 扣减 amount 必须是正整数（得到 ${amount}）`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 锁行检查余额（FOR UPDATE 防并发超扣）
    const cur = await client.query<{ balance: number }>(
      `SELECT balance
         FROM zenithjoy.tenant_credits
        WHERE tenant_id = $1
        FOR UPDATE`,
      [tenantId]
    );

    const currentBalance = cur.rows[0] ? Number(cur.rows[0].balance) : 0;
    if (cur.rows.length === 0 || currentBalance < amount) {
      await client.query('ROLLBACK');
      throw new InsufficientCreditsError(amount, currentBalance);
    }

    // UPDATE 扣减 + 累计 total_consumed
    const upd = await client.query<BalanceRow>(
      `UPDATE zenithjoy.tenant_credits
          SET balance = balance - $2,
              total_consumed = total_consumed + $2,
              updated_at = now()
        WHERE tenant_id = $1
        RETURNING balance, total_recharged, total_consumed`,
      [tenantId, amount]
    );

    // INSERT transaction（amount 负数 = 消耗）
    await client.query(
      `INSERT INTO zenithjoy.credit_transactions (tenant_id, amount, reason, metadata)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, -amount, reason, metadata ? JSON.stringify(metadata) : null]
    );

    await client.query('COMMIT');
    const r = upd.rows[0];
    return {
      balance: Number(r.balance),
      total_recharged: Number(r.total_recharged),
      total_consumed: Number(r.total_consumed),
    };
  } catch (err) {
    if (!(err instanceof InsufficientCreditsError)) {
      // InsufficientCreditsError 上面已 ROLLBACK
      try {
        await client.query('ROLLBACK');
      } catch {
        // 忽略二次 rollback 错误
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

// ==================== listTransactions ====================

export async function listTransactions(
  tenantId: string,
  limit = 50
): Promise<TransactionRow[]> {
  const { rows } = await pool.query<TransactionRow>(
    `SELECT id, tenant_id, amount, reason, metadata, created_at
       FROM zenithjoy.credit_transactions
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [tenantId, limit]
  );
  return rows.map((r) => ({
    ...r,
    amount: Number(r.amount),
  }));
}
