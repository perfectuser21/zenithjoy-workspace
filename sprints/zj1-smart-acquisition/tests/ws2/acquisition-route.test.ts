import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../apps/api/src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn() },
}));

// Red: apps/api/src/routes/acquisition.ts 未创建时此 import 会失败
import acquisitionRouter from '../../apps/api/src/routes/acquisition';

describe('WS2 — GET /api/acquisition/overview [BEHAVIOR]', () => {
  it('无 Authorization 头返回 401 + error 字段', async () => {
    const express = await import('express');
    const app = express.default();
    app.use('/api/acquisition', acquisitionRouter);

    const res = await request(app).get('/api/acquisition/overview');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('有效 license 返回 200 + enabled == true', async () => {
    vi.mock('../../apps/api/src/services/walking-skeleton.service', () => ({
      validateLicense: vi.fn().mockResolvedValue({
        ok: true,
        license: { id: 'test-id', license_key: 'ZJ-B-TESTKEY1', tenant_id: 'tenant-1' },
      }),
    }));

    const express = await import('express');
    const app = express.default();
    app.use('/api/acquisition', acquisitionRouter);

    const res = await request(app)
      .get('/api/acquisition/overview')
      .set('Authorization', 'Bearer ZJ-B-TESTKEY1');

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('response 顶层 keys 完全等于 PRD schema — [capabilities,enabled,feature,version]', async () => {
    const express = await import('express');
    const app = express.default();
    app.use('/api/acquisition', acquisitionRouter);

    const res = await request(app)
      .get('/api/acquisition/overview')
      .set('Authorization', 'Bearer ZJ-B-TESTKEY1');

    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['capabilities', 'enabled', 'feature', 'version']);
  });

  it('feature 字面量精确为 "smart_acquisition"（禁用变体）', async () => {
    const express = await import('express');
    const app = express.default();
    app.use('/api/acquisition', acquisitionRouter);

    const res = await request(app)
      .get('/api/acquisition/overview')
      .set('Authorization', 'Bearer ZJ-B-TESTKEY1');

    expect(res.body.feature).toBe('smart_acquisition');
    expect(res.body.feature).not.toBe('acquisition');
    expect(res.body.feature).not.toBe('smartAcquisition');
  });

  it('禁用字段 data/payload/result/status/info 不存在', async () => {
    const express = await import('express');
    const app = express.default();
    app.use('/api/acquisition', acquisitionRouter);

    const res = await request(app)
      .get('/api/acquisition/overview')
      .set('Authorization', 'Bearer ZJ-B-TESTKEY1');

    expect(res.body).not.toHaveProperty('data');
    expect(res.body).not.toHaveProperty('payload');
    expect(res.body).not.toHaveProperty('result');
    expect(res.body).not.toHaveProperty('status');
    expect(res.body).not.toHaveProperty('info');
  });
});
