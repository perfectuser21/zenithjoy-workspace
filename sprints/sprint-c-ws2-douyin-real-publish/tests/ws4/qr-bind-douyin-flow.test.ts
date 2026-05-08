import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const DB = process.env.DB || process.env.DATABASE_URL || 'postgresql://localhost/zenithjoy';
function psql(sql: string): string {
  return execSync(`psql "${DB}" -tAc "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

describe('Workstream 4 — 抖音首次扫码绑定流程 [BEHAVIOR]', () => {
  it('POST /api/publish/task {platform:"qr_bind:douyin"} → 写入任务 status=queued', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('../../../../apps/api/src/app.js');
    const res = await supertest(app).post('/api/publish/task').send({ platform: 'qr_bind:douyin', payload: {} });
    expect([200, 201]).toContain(res.status);
    const taskId = res.body.task_id || res.body.id;
    expect(taskId).toBeTruthy();
    const status = psql(`SELECT status FROM zenithjoy.publish_tasks WHERE id='${taskId}';`);
    expect(status).toBe('queued');
  });

  it('Agent complete 时 result.cookie_local_path 持久化到 DB JSONB', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('../../../../apps/api/src/app.js');
    const create = await supertest(app).post('/api/publish/task').send({ platform: 'qr_bind:douyin', payload: {} });
    const taskId = create.body.task_id || create.body.id;
    await supertest(app).post(`/api/agent/task/${taskId}/complete`)
      .set('x-license-key', process.env.TEST_LICENSE_KEY || 'test-key')
      .send({ status: 'completed', result: { qr_login: 'success', cookie_local_path: '~/.zenithjoy/cookies/douyin.json' } });
    const cookiePath = psql(`SELECT result->>'cookie_local_path' FROM zenithjoy.publish_tasks WHERE id='${taskId}';`);
    expect(cookiePath).toMatch(/cookies\/douyin/);
  });

  it('GET /api/publish/task/:id 返回 result.qr_screenshot 字段', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('../../../../apps/api/src/app.js');
    const create = await supertest(app).post('/api/publish/task').send({ platform: 'qr_bind:douyin', payload: {} });
    const taskId = create.body.task_id || create.body.id;
    await supertest(app).post(`/api/agent/task/${taskId}/complete`)
      .set('x-license-key', process.env.TEST_LICENSE_KEY || 'test-key')
      .send({ status: 'completed', result: { qr_screenshot: 'data:image/png;base64,iVBORw0KGgo=' } });
    const get = await supertest(app).get(`/api/publish/task/${taskId}`);
    expect(get.status).toBe(200);
    expect(get.body.result?.qr_screenshot).toMatch(/^data:image\/png;base64/);
  });
});
