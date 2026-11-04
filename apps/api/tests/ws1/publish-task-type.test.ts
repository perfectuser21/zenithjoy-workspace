import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import pool from '../../src/db/connection';
import { createPublishTask } from '../../src/services/walking-skeleton.service';
import { publishWsRouter } from '../../src/routes/walking-skeleton';
import { requireDisposableDatabases } from '../pg-contracts/disposable-db';

const app = express();
app.use(express.json());
app.use('/api/publish', publishWsRouter);
const agentId = randomUUID();
const licenseKey = `pg-type-${randomUUID()}`;
beforeAll(async () => {
  requireDisposableDatabases();
  const tenant = await pool.query(`INSERT INTO zenithjoy.tenants(name,license_key,plan) VALUES ('PG type contract',$1,'free') RETURNING id`, [licenseKey]);
  const license = await pool.query(`INSERT INTO zenithjoy.licenses(license_key,tenant_id,tier,max_machines,expires_at) VALUES ($1,$2,'basic',1,NOW()+interval '1 day') RETURNING id`, [licenseKey,tenant.rows[0].id]);
  await pool.query(`INSERT INTO zenithjoy.agents(id,tenant_id,agent_id,license_id,hostname,status) VALUES ($1,$2,$3,$4,'fixture-type-agent','online')`, [agentId,tenant.rows[0].id,`fixture-${agentId}`,license.rows[0].id]);
});
afterAll(async () => { await pool.end(); });

const countTasks = async () => (await pool.query(`SELECT count(*)::int AS count FROM zenithjoy.publish_tasks WHERE agent_id=$1`, [agentId])).rows[0].count;
describe('publish_tasks.type — real migration, SQL constraints, service and authenticated route', () => {
  it('NOT NULL and CHECK reject null/unknown values in PostgreSQL', async () => {
    const col = await pool.query(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='publish_tasks' AND column_name='type'`);
    expect(col.rows).toEqual([{is_nullable:'NO'}]);
    for (const [type, code] of [[null, '23502'], ['banana', '23514']]) {
      await expect(pool.query(`INSERT INTO zenithjoy.publish_tasks(agent_id,platform,type,status) VALUES ($1,'douyin',$2,'pending')`, [agentId,type])).rejects.toMatchObject({code});
    }
    expect(await countTasks()).toBe(0);
  });

  it.each(['video','image','article'] as const)('createPublishTask persists %s and its payload', async type => {
    const task = await createPublishTask({ agentId, platform:'douyin', type, payload:{title:'contract fixture'} });
    expect((await pool.query(`SELECT type, result FROM zenithjoy.publish_tasks WHERE id=$1`, [task.id])).rows).toEqual([{type,result:{payload:{title:'contract fixture'}}}]);
  });

  it('authenticated POST without type defaults to image and persists it', async () => {
    const res = await request(app).post('/api/publish/task').set('Authorization',`Bearer ${licenseKey}`).send({agent_id:agentId,platform:'douyin',payload:{title:'default'}});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.type).toBe('image');
    expect((await pool.query(`SELECT type FROM zenithjoy.publish_tasks WHERE id=$1`, [res.body.task_id])).rows).toEqual([{type:'image'}]);
  });

  it('authenticated invalid type is 422 and creates no task; missing license is 401', async () => {
    const before = await countTasks();
    const body = {agent_id:agentId,platform:'douyin',type:'banana',payload:{}};
    const res = await request(app).post('/api/publish/task').set('Authorization',`Bearer ${licenseKey}`).send(body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('INVALID_TYPE');
    expect((await request(app).post('/api/publish/task').send(body)).status).toBe(401);
    expect(await countTasks()).toBe(before);
  });
});
