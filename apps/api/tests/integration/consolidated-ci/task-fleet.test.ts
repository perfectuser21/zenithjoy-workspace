import { afterAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
vi.mock('../../../src/services/task-dispatch', () => ({ dispatchTask: vi.fn().mockResolvedValue(undefined), handleTaskResult: vi.fn() }));
import { dispatchTask } from '../../../src/services/task-dispatch';
import pool from '../../../src/db/connection';
import app from '../../../src/app';
afterAll(() => pool.end());
it('current debug task API derives identity from tenant membership and refuses caller-selected tenants before dispatch', async () => {
  const [a, b] = [randomUUID(), randomUUID()];
  for (const [index, tenant] of [a, b].entries()) {
    await pool.query("INSERT INTO zenithjoy.tenants(id,name,license_key,plan) VALUES($1,'fleet-contract',$2,'free')", [tenant, `fleet-contract-${tenant}`]);
    await pool.query("INSERT INTO zenithjoy.tenant_members(tenant_id,feishu_user_id,role) VALUES($1,$2,'owner')", [tenant, `debug-member-${index}`]);
  }
  const auth = { 'X-Feishu-User-Id': 'debug-member-0' };
  expect((await request(app).post('/api/agent/tasks').send({ tenantId: a, skill: 'wechat_draft' })).status).toBe(401);
  expect((await request(app).get(`/api/agent/tasks?tenantId=${a}`)).status).toBe(401);
  expect(dispatchTask).not.toHaveBeenCalled();
  expect((await request(app).post('/api/agent/tasks').set(auth).send({ tenantId: b, skill: 'wechat_draft' })).status).toBe(403);
  expect((await request(app).get(`/api/agent/tasks?tenantId=${b}`).set(auth)).status).toBe(403);
  expect((await pool.query('SELECT id FROM zenithjoy.tasks WHERE tenant_id=ANY($1::uuid[])', [[a, b]])).rows).toHaveLength(0);
  const created = await request(app).post('/api/agent/tasks').set(auth).send({ skill: 'wechat_draft', params: { title: 'fixture' } });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  expect(created.body.task.tenantId).toBe(a);
  expect(dispatchTask).toHaveBeenCalledTimes(1);
  expect(dispatchTask).toHaveBeenCalledWith(expect.objectContaining({ id: created.body.task.id, tenantId: a }));
  const foreign = (await pool.query("INSERT INTO zenithjoy.tasks(tenant_id,skill,params) VALUES($1,'wechat_draft','{}') RETURNING id", [b])).rows[0].id;
  const listed = await request(app).get('/api/agent/tasks').set(auth);
  expect(listed.status).toBe(200); expect(listed.body.tasks.map((task: { id: string }) => task.id)).toEqual([created.body.task.id]);
  expect((await request(app).get(`/api/agent/tasks/${created.body.task.id}`).set(auth)).status).toBe(200);
  expect((await request(app).get(`/api/agent/tasks/${foreign}`).set(auth)).status).toBe(404);
});
