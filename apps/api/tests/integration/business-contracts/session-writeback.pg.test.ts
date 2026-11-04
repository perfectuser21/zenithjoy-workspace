import './setup-env';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { type Server } from 'node:http';
import app from '../../../src/app';
import pool from '../../../src/db/connection';
import { postSessionStatus } from '../../../../../scripts/sessions/check-health.js';
let server: Server;
let base: string;
beforeAll(async () => {
 server = app.listen(0, '127.0.0.1');
 await new Promise<void>(resolve => server.once('listening', resolve));
 base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); });
const token = process.env.ZENITHJOY_INTERNAL_TOKEN!;
const results = (status = 'ok', checkedAt = '2026-11-04T01:02:03.000Z') => [
 { platform: '抖音主号', secretEnv: 'DOUYIN_COOKIES', status, checkedAt },
 { platform: '抖音小号1', secretEnv: 'DOUYIN_SUB_1', status: 'expired', checkedAt },
 { platform: '飞书 API Key', secretEnv: 'FEISHU_API_KEY', status: 'ok', checkedAt },
];
const post = (body: unknown, headers = {}) => fetch(base + '/api/operator/sessions/status', {
 method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
it('real loopback sender authenticates, writes canonical main status, and Dashboard reads exact SQL timestamps', async () => {
 const updates = [{ platform: 'douyin', status: 'active', checkedAt: '2026-11-04T01:02:03Z' }];
 expect((await post({ updates }, { 'x-internal-secret': token })).status).toBe(401);
 expect((await post({ updates })).status).toBe(401);
 expect(await postSessionStatus(results(), { env: { OPERATOR_API_URL: base, ZENITHJOY_INTERNAL_TOKEN: 'wrong' } })).toBe(401);
 expect((await pool.query('SELECT * FROM operator_sessions')).rows).toHaveLength(0);
 const env = { OPERATOR_API_URL: base, ZENITHJOY_INTERNAL_TOKEN: token };
 expect(await postSessionStatus(results(), { env })).toBe(200);
 const stored = (await pool.query('SELECT platform,secret_name,status,last_checked_at,last_valid_at FROM operator_sessions')).rows;
 expect(stored).toHaveLength(1);
 expect(stored[0]).toMatchObject({ platform: 'douyin', secret_name: 'DOUYIN_COOKIES', status: 'active' });
 expect(stored[0].last_checked_at.toISOString()).toBe('2026-11-04T01:02:03.000Z');
 expect(stored[0].last_valid_at.toISOString()).toBe('2026-11-04T01:02:03.000Z');
 const dashboard = await (await fetch(base + '/api/operator/sessions')).json();
 expect(dashboard.find((row: { platform: string }) => row.platform === 'douyin')).toMatchObject({ status: 'active', lastCheckedAt: '2026-11-04T01:02:03.000Z', secretName: 'DOUYIN_COOKIES' });
 expect(await postSessionStatus(results('expired', '2026-11-04T02:03:04.000Z'), { env })).toBe(200);
 const expired = (await pool.query("SELECT status,last_checked_at,last_valid_at FROM operator_sessions WHERE platform='douyin'")).rows[0];
 expect(expired.status).toBe('expired');
 expect(expired.last_checked_at.toISOString()).toBe('2026-11-04T02:03:04.000Z');
 expect(expired.last_valid_at.toISOString()).toBe('2026-11-04T01:02:03.000Z');
});
it('invalid batches write nothing; actual SQL constraint failure is atomic and sender receives failure', async () => {
 const headers = { 'X-Internal-Token': token };
 for (const updates of [null, [], [null], [{ platform: 'douyin', status: 'active' }, { platform: 'not-a-platform', status: 'active' }], [{ status: 'active' }], [{ platform: '抖音主号', status: 'active' }], [{ platform: 'douyin', status: 'ok' }], [{ platform: 'douyin', status: 'active', checkedAt: 'bad' }], [{ platform: 'douyin', status: 'active' }, { platform: 'douyin', status: 'expired' }]]) {
  expect((await post({ updates }, headers)).status).toBe(400);
 }
 await pool.query("ALTER TABLE operator_sessions ADD CONSTRAINT fixture_reject_kuaishou CHECK(platform <> 'kuaishou')");
 try {
  const response = await post({ updates: [{ platform: 'douyin', status: 'active' }, { platform: 'kuaishou', status: 'active' }] }, headers);
  expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ ok: false });
  expect((await pool.query('SELECT platform,status FROM operator_sessions')).rows).toEqual([{ platform: 'douyin', status: 'expired' }]);
  expect(await postSessionStatus([{ platform: '快手主号', secretEnv: 'KUAISHOU_COOKIES', status: 'ok' }], { env: { OPERATOR_API_URL: base, ZENITHJOY_INTERNAL_TOKEN: token } })).toBe(500);
 } finally { await pool.query('ALTER TABLE operator_sessions DROP CONSTRAINT fixture_reject_kuaishou'); }
});
