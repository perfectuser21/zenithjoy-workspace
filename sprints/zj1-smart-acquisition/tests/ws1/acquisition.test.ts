import { describe, it, expect } from 'vitest';
import request from 'supertest';
// TDD Red: apps/api/src/routes/acquisition.ts 尚未实现，import 将失败
import app from '../../../../apps/api/src/app';

describe('Workstream 1 — GET /api/acquisition/overview [BEHAVIOR]', () => {
  it('返回 HTTP 200 且 Content-Type 为 JSON', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/json/);
  });

  it('enabled 字段值为 true（boolean）', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.body.enabled).toBe(true);
  });

  it('feature 字面量精确等于 "smart-acquisition"', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.body.feature).toBe('smart-acquisition');
  });

  it('capabilities 值为 ["overview"]', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.body.capabilities).toEqual(['overview']);
  });

  it('version 值为 "1.0.0"', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    expect(res.body.version).toBe('1.0.0');
  });

  it('Schema 完整性 — 顶层 keys 完全等于 [capabilities,enabled,feature,version]', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['capabilities', 'enabled', 'feature', 'version']);
  });

  it('禁用字段 status/data/result/payload/info/meta 不存在', async () => {
    const res = await request(app).get('/api/acquisition/overview');
    const body = res.body;
    for (const field of ['status', 'data', 'result', 'payload', 'info', 'meta']) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('error path — 不存在子路由返回 404', async () => {
    const res = await request(app).get('/api/acquisition/nonexistent');
    expect(res.status).toBe(404);
  });
});
