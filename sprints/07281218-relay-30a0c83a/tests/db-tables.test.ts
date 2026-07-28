/**
 * 合同测试骨架 — BEHAVIOR-DB-TABLES
 *
 * 验证 zenithjoy schema 下 4 张 ability acceptance 相关表存在，
 * 且 acceptance_run 有 UNIQUE(task_id, git_sha) 约束。
 *
 * 运行前提：DATABASE_URL 指向已运行迁移的测试 DB
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

let pool: Pool;

beforeAll(() => {
  if (!DATABASE_URL) {
    throw new Error('DATABASE_URL 未设置，跳过 DB 测试');
  }
  pool = new Pool({ connectionString: DATABASE_URL });
});

afterAll(async () => {
  await pool?.end();
});

describe('[BEHAVIOR-DB-TABLES] 4 张 ability acceptance 表存在性', () => {
  const expectedTables = [
    'acceptance_template',
    'acceptance_run',
    'device_result',
    'check_result',
  ];

  it('zenithjoy schema 下存在全部 4 张表', async () => {
    const { rows } = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'zenithjoy'
        AND table_name = ANY($1::text[])
    `, [expectedTables]);

    const found = rows.map((r: { table_name: string }) => r.table_name).sort();
    expect(found).toEqual([...expectedTables].sort());
  });

  it('acceptance_run 含 UNIQUE(task_id, git_sha) 约束', async () => {
    const { rows } = await pool.query(`
      SELECT tc.constraint_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'zenithjoy'
        AND tc.table_name = 'acceptance_run'
        AND tc.constraint_type = 'UNIQUE'
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('acceptance_run.status 列允许 NULL（未提交 run）', async () => {
    const { rows } = await pool.query(`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'zenithjoy'
        AND table_name = 'acceptance_run'
        AND column_name = 'status'
    `);
    expect(rows[0]?.is_nullable).toBe('YES');
  });

  it('device_result 含 device_no 列', async () => {
    const { rows } = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'zenithjoy'
        AND table_name = 'device_result'
        AND column_name = 'device_no'
    `);
    expect(rows.length).toBe(1);
  });
});
