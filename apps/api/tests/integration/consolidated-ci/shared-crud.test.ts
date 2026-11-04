import { afterAll, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import app from '../../../src/app';
import pool from '../../../src/db/connection';
afterAll(() => pool.end());
const internal = { 'X-Internal-Token': 'isolated-contract-token' };
async function member() {
  const tenant = randomUUID(), id = `member-${randomUUID()}`;
  await pool.query("INSERT INTO zenithjoy.tenants(id,name,license_key,plan) VALUES($1,'crud',$2,'free')", [tenant, `crud-${tenant}`]);
  await pool.query("INSERT INTO zenithjoy.tenant_members(tenant_id,feishu_user_id,role) VALUES($1,$2,'owner')", [tenant, id]);
  return { tenant, headers: { 'X-Feishu-User-Id': id } };
}
it('fields CRUD uses actual tenant identities, SQL rows and foreign-tenant denial', async () => {
  const a = await member(), b = await member();
  expect((await request(app).get('/api/fields')).status).toBe(401);
  const created = await request(app).post('/api/fields').set(a.headers).send({ field_name: 'fixture-field', field_type: 'text' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.id;
  expect((await pool.query('SELECT tenant_id,field_name FROM zenithjoy.field_definitions WHERE id=$1', [id])).rows).toEqual([{ tenant_id: a.tenant, field_name: 'fixture-field' }]);
  expect((await request(app).get('/api/fields').set(b.headers)).body).toEqual([]);
  expect((await request(app).delete(`/api/fields/${id}`).set(b.headers)).status).toBe(404);
  expect((await request(app).delete(`/api/fields/${id}`).set(a.headers)).status).toBe(200);
  expect((await pool.query('SELECT id FROM zenithjoy.field_definitions WHERE id=$1', [id])).rows).toHaveLength(0);
});
it('topics and pacing mutations read back exact values within the disposable database', async () => {
  expect((await request(app).get('/api/topics')).status).toBe(401);
  const created = await request(app).post('/api/topics').set(internal).send({ title: 'isolated-topic', status: '待研究' });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = created.body.data.id;
  expect((await request(app).patch(`/api/topics/${id}`).set(internal).send({ status: '已通过' })).status).toBe(200);
  expect((await pool.query('SELECT title,status FROM zenithjoy.topics WHERE id=$1', [id])).rows).toEqual([{ title: 'isolated-topic', status: '已通过' }]);
  const listed = await request(app).get('/api/topics').set(internal);
  expect(listed.body.data.items.some((row: { id: string }) => row.id === id)).toBe(true);
  expect((await request(app).delete(`/api/topics/${id}`).set(internal)).status).toBe(200);
  expect((await pool.query('SELECT deleted_at FROM zenithjoy.topics WHERE id=$1', [id])).rows[0].deleted_at).not.toBeNull();
  expect((await request(app).patch('/api/pacing-config').set(internal).send({ daily_limit: 17 })).status).toBe(200);
  expect((await request(app).get('/api/pacing-config').set(internal)).body.data.daily_limit).toBe(17);
  expect((await pool.query("SELECT value FROM zenithjoy.pacing_config WHERE key='daily_limit'")).rows).toEqual([{ value: '17' }]);
  expect((await request(app).patch('/api/pacing-config').set(internal).send({ daily_limit: -1 })).status).toBe(400);
});
it('snapshots upsert exact metrics and publish-log CRUD preserves work ownership', async () => {
  const a = await member(), b = await member(), content = `snapshot-${randomUUID()}`;
  for (const views of [100, 101]) {
    const response = await request(app).post('/api/snapshots/ingest').send({ platform: 'douyin', items: [{ content_id: content, scraped_date: '2026-11-04', views, likes: 5 }] });
    expect(response.status).toBe(200); expect(response.body.inserted).toBe(1);
  }
  expect((await pool.query('SELECT views,likes FROM zenithjoy.daily_snapshots WHERE content_id=$1', [content])).rows).toEqual([{ views: 101, likes: 5 }]);
  const snapshots = await request(app).get('/api/snapshots/douyin');
  expect(snapshots.body.data.some((row: { content_id: string }) => row.content_id === content)).toBe(true);
  const work = await request(app).post('/api/works').set(a.headers).send({ title: 'isolated-work', content_type: 'video', status: 'ready' });
  expect(work.status, JSON.stringify(work.body)).toBe(201);
  const wid = work.body.id;
  const log = await request(app).post(`/api/works/${wid}/publish-logs`).set(a.headers).send({ work_id: wid, platform: 'douyin', status: 'pending' });
  expect(log.status, JSON.stringify(log.body)).toBe(201);
  expect((await request(app).get(`/api/works/${wid}/publish-logs`).set(b.headers)).status).toBe(404);
  expect((await request(app).post(`/api/works/${wid}/publish-logs`).set(b.headers).send({ platform: 'kuaishou', status: 'pending' })).status).toBe(404);
  expect((await request(app).put(`/api/publish-logs/${log.body.id}`).set(b.headers).send({ status: 'failed' })).status).toBe(404);
  expect((await pool.query('SELECT status FROM zenithjoy.publish_logs WHERE id=$1', [log.body.id])).rows).toEqual([{ status: 'pending' }]);
  const update = await request(app).put(`/api/publish-logs/${log.body.id}`).set(a.headers).send({ status: 'published', platform_post_id: content });
  expect(update.status, JSON.stringify(update.body)).toBe(200);
  expect((await pool.query('SELECT status,platform_post_id FROM zenithjoy.publish_logs WHERE id=$1', [log.body.id])).rows).toEqual([{ status: 'published', platform_post_id: content }]);
  expect((await request(app).get(`/api/snapshots/work/${wid}`)).status).toBe(200);
});
