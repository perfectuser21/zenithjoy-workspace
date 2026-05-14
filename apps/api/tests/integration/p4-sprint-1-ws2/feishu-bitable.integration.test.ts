/**
 * P4 Sprint 1 WS2 — feishu-bitable 集成测试
 * 验证 DB 列存在 + pushWechatTaskToFeishu 静默行为
 */
import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432'),
  user: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'cecelia',
});

describe('P4 WS2 — DB 列存在', () => {
  it('tenant_feishu_bindings 有 table_id_wechat_approval 列', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='tenant_feishu_bindings'
       AND column_name='table_id_wechat_approval'`
    );
    expect(r.rows.length).toBe(1);
  });

  it('wechat_publish_task 有 feishu_record_id 列', async () => {
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='zenithjoy' AND table_name='wechat_publish_task'
       AND column_name='feishu_record_id'`
    );
    expect(r.rows.length).toBe(1);
  });
});

describe('P4 WS2 — pushWechatTaskToFeishu', () => {
  it('tenant 不存在时静默返回 undefined', async () => {
    const { pushWechatTaskToFeishu } = await import('../../../src/services/feishu-bitable-multitenant');
    await expect(pushWechatTaskToFeishu('no-such-id', 'no-such-tenant')).resolves.toBeUndefined();
  });
});

afterAll(async () => {
  await pool.end();
});
