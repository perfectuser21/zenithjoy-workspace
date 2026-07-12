/**
 * dm_assignments.status CHECK 约束缺 'cancelled' — [REGRESSION]
 *
 * acquisition-dispatch.ts rescoreLead() 的 FR-8 逻辑：outreach_eligible 变 false 时
 * UPDATE dm_assignments SET status='cancelled'。但 chk_dm_assign_status 约束
 * （20260626_214500_acquisition_dispatch.sql / 20260703_dm_assignments_dispatch_reason.sql
 * 两次迁移都没加 'cancelled'）只允许 queued/dispatched/sent/limited/failed/pending_dispatch，
 * 真机验收(PR#1237后续)复现：该 UPDATE 直接违反 CHECK 约束报错，FR-8 降级取消逻辑在生产打不通。
 *
 * commit-1 时 RED（约束未加 cancelled）；commit-2 GREEN（migration 补齐）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

let pool: Pool;

beforeAll(async () => {
  pool = new Pool({
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    database: process.env.DATABASE_NAME || 'cecelia',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });
});

afterAll(async () => {
  await pool?.end();
});

describe('dm_assignments chk_dm_assign_status 允许 cancelled [REGRESSION]', () => {
  it('CHECK 约束的定义里含 cancelled 枚举值', async () => {
    const { rows } = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
       WHERE conname = 'chk_dm_assign_status'
         AND conrelid = 'zenithjoy.dm_assignments'::regclass
    `);
    expect(rows.length, 'chk_dm_assign_status 约束应存在').toBe(1);
    expect(rows[0].def).toMatch(/'cancelled'/);
  });
});
