/**
 * WS1 — DB migration: tenant_feishu_bindings 表结构
 *
 * commit-1 时 RED（migration 文件还没建）；commit-2 实现后 GREEN。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../apps/api/db/migrations');

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

describe('Workstream 1 — tenant_feishu_bindings migration [BEHAVIOR]', () => {
  it('migration 文件存在（文件名含 tenant_feishu_bindings）', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const target = files.find((f) => f.includes('tenant_feishu_bindings') && f.endsWith('.sql'));
    expect(target, '应有 *_tenant_feishu_bindings.sql migration').toBeDefined();
  });

  it('迁移后 zenithjoy.tenant_feishu_bindings 表存在', async () => {
    const { rows } = await pool.query(
      `SELECT to_regclass('zenithjoy.tenant_feishu_bindings') AS tbl`
    );
    expect(rows[0].tbl).toBe('zenithjoy.tenant_feishu_bindings');
  });

  it('表含 8 个必需列', async () => {
    const { rows } = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='tenant_feishu_bindings'
    `);
    const cols = new Set(rows.map((r) => r.column_name));
    [
      'tenant_id',
      'tenant_access_token',
      'expires_at',
      'app_token',
      'table_id_lead_profile',
      'table_id_target_videos',
      'table_id_leads',
      'last_refreshed_at',
    ].forEach((c) => {
      expect(cols.has(c), `应有列 ${c}`).toBe(true);
    });
  });

  it('FK tenant_id → zenithjoy.tenants(id) 且 ON DELETE CASCADE', async () => {
    const { rows } = await pool.query(`
      SELECT confdeltype FROM pg_constraint
       WHERE conname LIKE '%tenant_feishu_bindings%tenant_id%fkey%'
          OR conname LIKE '%tfb%tenant%fkey%'
    `);
    expect(rows.length, 'FK 必须存在').toBeGreaterThanOrEqual(1);
    expect(rows[0].confdeltype, 'CASCADE = c').toBe('c');
  });

  it('索引 idx_tfb_tenant 存在', async () => {
    const { rows } = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE schemaname='zenithjoy' AND tablename='tenant_feishu_bindings'`
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('idx_tfb_tenant');
  });
});
