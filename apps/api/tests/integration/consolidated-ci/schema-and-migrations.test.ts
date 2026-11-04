import { afterAll, expect, it } from 'vitest';
import { Pool } from 'pg';
import { disposableConnection } from './connection';
const db = new Pool(disposableConnection());
afterAll(() => db.end());
it('owns a fresh isolated database with real OAuth and scheduling columns', async () => {
  expect((await db.query('SELECT current_database() AS db')).rows[0].db).toBe('zenithjoy_consolidation_test');
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='user_clip_settings'")).rows.map(row => row.column_name);
  for (const name of ['notion_token', 'feishu_user_token', 'feishu_refresh_token', 'feishu_user_id', 'feishu_user_name', 'feishu_token_expires_at']) expect(columns).toContain(name);
  expect((await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='contents' AND column_name='scheduled_at'")).rows).toHaveLength(1);
});
