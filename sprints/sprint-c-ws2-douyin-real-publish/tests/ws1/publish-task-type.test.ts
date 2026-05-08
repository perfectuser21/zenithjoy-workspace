import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';

const DB = process.env.DB || process.env.DATABASE_URL || 'postgresql://localhost/zenithjoy';

function psql(sql: string): string {
  return execSync(`psql "${DB}" -tAc "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim();
}

describe('Workstream 1 — publish_tasks.type 字段 + createPublishTask 接 type [BEHAVIOR]', () => {
  it('publish_tasks 表有 type 字段，NOT NULL，CHECK 约束限定 video/image/article', () => {
    const colExists = psql(`SELECT column_name FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='publish_tasks' AND column_name='type';`);
    expect(colExists).toBe('type');
    const notNull = psql(`SELECT is_nullable FROM information_schema.columns WHERE table_schema='zenithjoy' AND table_name='publish_tasks' AND column_name='type';`);
    expect(notNull).toBe('NO');
    const checkClause = psql(`SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='zenithjoy.publish_tasks'::regclass AND pg_get_constraintdef(oid) ILIKE '%type%';`);
    expect(checkClause).toMatch(/video.*image.*article|image.*video.*article|article.*video.*image/);
  });

  it('createPublishTask({type:"video"}) 持久化 type=video 到 DB', async () => {
    const { createPublishTask } = await import('../../../../apps/api/src/services/walking-skeleton.service.js');
    const task = await createPublishTask({
      agentId: '00000000-0000-0000-0000-000000000001',
      platform: 'douyin',
      type: 'video',
      payload: { video_path: '/tmp/x.mp4', title: 't' },
    } as any);
    expect(task).toBeTruthy();
    const dbType = psql(`SELECT type FROM zenithjoy.publish_tasks WHERE id='${(task as any).id}';`);
    expect(dbType).toBe('video');
  });

  it('POST /api/publish/task 缺 type 字段 → 422 或缺省 image (策略需明确)', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('../../../../apps/api/src/app.js');
    const res = await supertest(app).post('/api/publish/task').send({ platform: 'douyin', payload: {} });
    if (res.status === 200 || res.status === 201) {
      expect(res.body.type).toBe('image');
    } else {
      expect(res.status).toBe(422);
    }
  });

  it('POST /api/publish/task type="banana" → 422 invalid value', async () => {
    const supertest = (await import('supertest')).default;
    const { app } = await import('../../../../apps/api/src/app.js');
    const res = await supertest(app).post('/api/publish/task').send({ platform: 'douyin', type: 'banana', payload: {} });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(/type|invalid|enum/i);
  });
});
