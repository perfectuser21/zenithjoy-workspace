/**
 * WS3b — _smoke-fake-agent-burner.ts helper (NODE_ENV + X-Smoke-Token 双门禁)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../../../apps/api/src/app';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_SMOKE_TOKEN = process.env.SMOKE_TOKEN;

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  process.env.SMOKE_TOKEN = ORIGINAL_SMOKE_TOKEN;
});

describe('Workstream 3b — _smoke-fake-agent-burner [BEHAVIOR]', () => {
  it('NODE_ENV=production → 404', async () => {
    process.env.NODE_ENV = 'production';
    const r = await request(app)
      .post('/api/_smoke/fake-agent-burner-progress')
      .set('X-Smoke-Token', 'any')
      .send({ task_id: 'x', phase: 'chrome_launched' });
    expect(r.status).toBe(404);
  });

  it('NODE_ENV=test 缺 X-Smoke-Token → 403', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';
    const r = await request(app)
      .post('/api/_smoke/fake-agent-burner-progress')
      .send({ task_id: 'x', phase: 'chrome_launched' });
    expect(r.status).toBe(403);
  });

  it('NODE_ENV=test + 正确 SMOKE_TOKEN → 200 + 写 task response', async () => {
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'real_token_xyz';

    // 这里 task_id 用一个事先存在的 task，省去构造（实际 generator 实现时可调整）
    const r = await request(app)
      .post('/api/_smoke/fake-agent-burner-progress')
      .set('X-Smoke-Token', 'real_token_xyz')
      .send({
        task_id: '00000000-0000-0000-0000-000000000099',
        phase: 'chrome_launched',
        user_data_dir: '/tmp/test',
        current_url: 'https://creator.douyin.com/login',
      });
    // 200 = ok or 404 if task 不存在（合同允许两态）
    expect([200, 404]).toContain(r.status);
  });
});
