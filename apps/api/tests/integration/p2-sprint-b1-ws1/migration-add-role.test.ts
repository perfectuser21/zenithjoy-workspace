/**
 * WS1 — DB migration: agent_platform_sessions add role 字段
 *
 * commit-1 时 RED（migration 文件未建）；commit-2 GREEN。
 * 测试覆盖：role 列存在 + 默认 'main' + CHECK 约束 + 已有 main 行幂等。
 *
 * CI 实跑落点（apps/api integration config 自动 pick）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// landing path: apps/api/tests/integration/p2-sprint-b1-ws1/ (4 deep) → ../../../db/migrations
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../db/migrations');

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

describe('Workstream 1 — agent_platform_sessions add role migration [BEHAVIOR]', () => {
  it('migration 文件存在（文件名含 agent_platform_sessions_add_role）', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    const target = files.find(
      (f) => f.includes('agent_platform_sessions_add_role') && f.endsWith('.sql')
    );
    expect(target, '应有 *_agent_platform_sessions_add_role.sql migration').toBeDefined();
  });

  it('迁移后 agent_platform_sessions 表含 role 列 NOT NULL DEFAULT main', async () => {
    const { rows } = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='agent_platform_sessions' AND column_name='role'
    `);
    expect(rows.length, 'role 列应存在').toBe(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].column_default).toMatch(/'main'/);
  });

  it('CHECK 约束拒绝 role NOT IN (main, burner)', async () => {
    // 用一个 dummy agent_id 试 INSERT 非法 role
    const dummyAgent = '00000000-0000-0000-0000-000000000099';
    await expect(
      pool.query(
        `INSERT INTO zenithjoy.agent_platform_sessions (agent_id, platform, account_label, role) VALUES ($1, 'douyin', 'test_invalid_role', 'invalid_role_xyz')`,
        [dummyAgent]
      )
    ).rejects.toThrow();
  });

  it('已存在的 main 行 migration 后 role=main（幂等保护）', async () => {
    // 模拟生产场景：migration 跑前已有 session 行
    const { rows } = await pool.query(`
      SELECT count(*) FILTER (WHERE role IS NULL) AS null_count
        FROM zenithjoy.agent_platform_sessions
    `);
    expect(parseInt(rows[0].null_count, 10)).toBe(0);
  });
});
