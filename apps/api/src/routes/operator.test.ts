import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('../middleware/super-admin', () => ({
  superAdminGuard: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

import * as fs from 'node:fs';
import { operatorRouter } from './operator';

const app = express();
app.use(express.json());
app.use('/api/operator', operatorRouter);

const SAMPLE_REPORT = [
  { platform: '抖音主号',  secretEnv: 'DOUYIN_MAIN',   status: 'ok',      checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '抖音小号1', secretEnv: 'DOUYIN_SUB_1',  status: 'expired', checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '快手主号',  secretEnv: 'KUAISHOU_MAIN',  status: 'missing', checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
  { platform: '飞书 API Key', secretEnv: 'FEISHU_API_KEY', status: 'ok', checkedAt: '2026-05-28T01:00:00.000Z', expiresAt: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/operator/sessions/sync', () => {
  it('returns matrix from session-health-report.json', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE_REPORT));
    const res = await request(app).post('/api/operator/sessions/sync');
    expect(res.status).toBe(200);
    expect(res.body.matrix['抖音']['MAIN']).toEqual({
      status: 'ok',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
    expect(res.body.matrix['抖音']['SUB_1']).toEqual({
      status: 'expired',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
    expect(res.body.matrix['快手']['MAIN']).toEqual({
      status: 'missing',
      lastSync: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
    });
  });

  it('excludes API key entries from matrix', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(SAMPLE_REPORT));
    const res = await request(app).post('/api/operator/sessions/sync');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.matrix)).not.toContain('飞书 API Key');
    expect(Object.keys(res.body.matrix)).not.toContain('飞书');
  });

  it('returns empty matrix when file does not exist', async () => {
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    const res = await request(app).post('/api/operator/sessions/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matrix: {} });
  });

  it('returns empty matrix when file content is invalid JSON', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not-json');
    const res = await request(app).post('/api/operator/sessions/sync');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matrix: {} });
  });
});
