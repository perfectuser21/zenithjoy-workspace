import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import { acquisitionRouter } from '../../../../apps/api/src/routes/acquisition';

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionRouter);

describe('WS2 POST /api/acquisition/keyword-search [BEHAVIOR]', () => {
  it('[BEHAVIOR] 返回 HTTP 200，body 顶层 keys 精确等于 ["keywords","task_id"]', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['keywords', 'task_id']);
  });

  it('[BEHAVIOR] task_id 为 UUID 格式，keywords 长度为 5', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });
    expect(res.body.task_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.keywords).toHaveLength(5);
    expect(Array.isArray(res.body.keywords)).toBe(true);
  });

  it('[BEHAVIOR] keywords 含原词（"装修" 在数组中）', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });
    expect(res.body.keywords).toContain('装修');
  });

  it('[BEHAVIOR] 禁用字段 result/data/expanded/variants/id/job_id 不在 response 中', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '装修' });
    const banned = ['result', 'data', 'expanded', 'variants', 'id', 'job_id'];
    for (const f of banned) {
      expect(res.body).not.toHaveProperty(f);
    }
  });

  it('[BEHAVIOR] keyword 缺失时返回 HTTP 400 + error="MISSING_KEYWORD"', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('MISSING_KEYWORD');
  });

  it('[BEHAVIOR] keyword 为空字符串时返回 HTTP 400', async () => {
    const res = await request(app)
      .post('/api/acquisition/keyword-search')
      .send({ keyword: '' });
    expect(res.status).toBe(400);
  });
});
