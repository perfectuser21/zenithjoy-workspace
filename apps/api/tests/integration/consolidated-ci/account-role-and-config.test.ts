import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import pool from '../../../src/db/connection';
import { disposableConnection } from './connection';
import { getCSConfig, saveCSConfig } from '../../../src/services/wechat/cs-account-config-store';
afterAll(() => pool.end());

it('actual account migration CLI dry-run writes nothing and cutover maps all three health values once', async () => {
  const tenant = randomUUID(), agent = randomUUID();
  await pool.query("INSERT INTO zenithjoy.tenants(id,name,license_key,plan) VALUES($1,'migration',$2,'free')", [tenant, `migration-${tenant}`]);
  await pool.query("INSERT INTO zenithjoy.agents(id,tenant_id,agent_id,status) VALUES($1,$2,$3,'online')", [agent, tenant, `migration-${agent}`]);
  for (const health of ['ok', 'expired', 'unknown']) await pool.query(
    "INSERT INTO zenithjoy.line02_account_sessions(tenant_id,agent_id,account_label,role,health,platform) VALUES($1,$2,$3,'burner',$4,'douyin')",
    [tenant, agent, health, health]);
  const connection = disposableConnection();
  const url = new URL('postgresql://127.0.0.1');
  url.hostname = connection.host!; url.port = String(connection.port); url.username = connection.user!;
  url.password = connection.password ?? ''; url.pathname = '/' + connection.database;
  const cli = (args: string[]) => spawnSync(process.execPath, ['scripts/account-role-migrate.js', ...args], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, DATABASE_URL: url.toString() },
  });
  const dry = cli(['--dry-run']);
  expect(dry.error).toBeUndefined(); expect(dry.status, dry.stderr).toBe(0);
  expect(dry.stdout).toContain('dry-run complete');
  expect((await pool.query('SELECT * FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1', [agent])).rows).toHaveLength(0);
  expect((await pool.query('SELECT * FROM zenithjoy.line02_account_sessions WHERE agent_id=$1 AND write_disabled=false', [agent])).rows).toHaveLength(3);
  for (let attempt = 0; attempt < 2; attempt++) {
    const cutover = cli([]); expect(cutover.error).toBeUndefined(); expect(cutover.status, cutover.stderr).toBe(0);
  }
  const sessions = await pool.query('SELECT account_label,status,role FROM zenithjoy.agent_platform_sessions WHERE agent_id=$1 ORDER BY account_label', [agent]);
  expect(sessions.rows).toEqual([
    { account_label: 'expired', status: 'expired', role: 'burner' },
    { account_label: 'ok', status: 'active', role: 'burner' },
    { account_label: 'unknown', status: 'pending', role: 'burner' },
  ]);
  expect((await pool.query('SELECT * FROM zenithjoy.line02_account_sessions WHERE agent_id=$1 AND write_disabled=true', [agent])).rows).toHaveLength(3);
});

it('actual legacy config migration replays without overwriting current per-account personas or defaults', async () => {
  const first = `account-a-${randomUUID()}`, second = `account-b-${randomUUID()}`;
  await saveCSConfig(first, { persona: { self_name: '账号甲' }, auto_agent_enabled: true, whitelist: ['客户甲'] });
  await saveCSConfig(second, { persona: { self_name: '账号乙' }, auto_agent_enabled: false, whitelist: ['客户乙'] });
  expect((await getCSConfig(first))?.persona.self_name).toBe('账号甲');
  expect((await getCSConfig(second))?.persona.self_name).toBe('账号乙');
  await pool.query("INSERT INTO zenithjoy.wechat_cs_config(key,value) VALUES('persona',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify({ self_name: '历史客服' })]);
  const migration = await readFile('db/migrations/20260622_210000_create_wechat_cs_account_config.sql', 'utf8');
  await pool.query(migration); await pool.query(migration);
  expect((await pool.query("SELECT persona FROM zenithjoy.wechat_cs_account_config WHERE wechat_id='wxid_legacy_global'")).rows).toEqual([{ persona: { self_name: '历史客服' } }]);
  expect((await getCSConfig(first))?.auto_agent_enabled).toBe(true);
  expect((await getCSConfig(first))?.whitelist).toEqual(['客户甲']);
  expect((await getCSConfig(second))?.auto_agent_enabled).toBe(false);
  expect((await getCSConfig(second))?.whitelist).toEqual(['客户乙']);
  expect((await pool.query('SELECT COUNT(*)::int AS n FROM zenithjoy.wechat_cs_account_config WHERE wechat_id=$1', [first])).rows[0].n).toBe(1);
});
