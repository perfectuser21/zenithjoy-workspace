/**
 * P4 WS1 — DB schema: wechat_publish_task + llm_audit migrations
 *
 * commit-1 RED (migration 文件未建); commit-2 GREEN.
 * 测试: 表存在 + approval_source CHECK enforce + llm_audit INSERT/SELECT.
 *
 * CI 实跑落点 (apps/api integration config 自动 pick).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

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

describe('P4 WS1 — wechat_publish_task + llm_audit [BEHAVIOR]', () => {
  it('migration 文件存在 (create_wechat_publish_task + create_llm_audit)', () => {
    const files = fs.readdirSync(MIGRATIONS_DIR);
    expect(files.some(f => /^2026.*create_wechat_publish_task.*\.sql$/.test(f))).toBe(true);
    expect(files.some(f => /^2026.*create_llm_audit.*\.sql$/.test(f))).toBe(true);
  });

  it('zenithjoy.wechat_publish_task 表存在含 approval_source 列', async () => {
    const tbl = await pool.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='wechat_publish_task'"
    );
    expect(tbl.rowCount).toBeGreaterThan(0);
    const col = await pool.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='wechat_publish_task' AND column_name='approval_source'"
    );
    expect(col.rowCount).toBe(1);
  });

  it('approval_source CHECK 包含 feishu_user + feishu_api', async () => {
    const { rows } = await pool.query(`
      SELECT pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE rel.relname='wechat_publish_task' AND nsp.nspname='zenithjoy' AND con.contype='c'
    `);
    const hasCheck = rows.some(
      r => r.def.includes('approval_source') && r.def.includes('feishu_user') && r.def.includes('feishu_api')
    );
    expect(hasCheck).toBe(true);
  });

  // 注意：Line04 无审批自动回复闭环（20260622 迁移）放开 approval_source 容 'system'
  //（AI 无人审自动发，来源是系统而非飞书人审）。此处由「system 被拒」更新为
  // 「system 现被接受 + 真正非法值仍 23514 拒」，与新契约 SSOT 一致。
  it('INSERT approval_source=system 现被接受（自动回复闭环）；非法值仍抛 23514', async () => {
    // ① system 现可写（迁移放开后）
    let systemCode: string | undefined;
    try {
      await pool.query(`
        INSERT INTO zenithjoy.wechat_publish_task
          (agent_id, task_type, content, scheduled_at, status, approval_source)
        VALUES
          (gen_random_uuid(), 'moments', 'test-system', NOW(), 'draft', 'system')
      `);
    } catch (e: any) {
      systemCode = e.code;
    }
    expect(systemCode).toBeUndefined();
    // 清理本测试插入的行，避免污染其它计数类断言
    await pool.query(`DELETE FROM zenithjoy.wechat_publish_task WHERE content='test-system'`);

    // ② 真正非法的 approval_source 仍被 CHECK 拒（23514）
    let badCode: string | undefined;
    try {
      await pool.query(`
        INSERT INTO zenithjoy.wechat_publish_task
          (agent_id, task_type, content, scheduled_at, status, approval_source)
        VALUES
          (gen_random_uuid(), 'moments', 'test', NOW(), 'draft', 'hacker_ai')
      `);
    } catch (e: any) {
      badCode = e.code;
    }
    expect(badCode).toBe('23514');
  });

  it('zenithjoy.llm_audit INSERT/SELECT roundtrip', async () => {
    const ins = await pool.query(`
      INSERT INTO zenithjoy.llm_audit
        (request_purpose, model, prompt_tokens, completion_tokens, total_tokens,
         cost_usd, duration_ms, success)
      VALUES ('p4_ws1_test', 'deepseek/deepseek-chat', 10, 5, 15, 0.000004, 123, true)
      RETURNING id
    `);
    const id = ins.rows[0].id;
    const sel = await pool.query('SELECT * FROM zenithjoy.llm_audit WHERE id=$1', [id]);
    expect(sel.rows[0].request_purpose).toBe('p4_ws1_test');
    expect(sel.rows[0].total_tokens).toBe(15);
    expect(Number(sel.rows[0].cost_usd)).toBeCloseTo(0.000004, 6);
    await pool.query('DELETE FROM zenithjoy.llm_audit WHERE id=$1', [id]);
  });
});
