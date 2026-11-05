/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import pool from '../db/connection';
import { acquisitionRouter } from './acquisition';
import { acquisitionDispatchRouter } from './acquisition-dispatch';
import { buildAssignments, dispatchDue, scoreLeads } from '../services/acquisition-dispatch';

vi.mock('../db/connection', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => { req.tenantId = req.headers['x-test-tenant']; next(); },
  tenantContextOptional: (req: any, _res: any, next: any) => { req.tenantId = req.headers['x-test-tenant']; next(); },
}));
vi.mock('../services/acquisition-dispatch', () => ({
  buildAssignments: vi.fn(), dispatchDue: vi.fn(), scoreLeads: vi.fn(),
  getConfig: vi.fn(), mergeConfigPatch: vi.fn(), upsertConfig: vi.fn(), validateConfigPatch: vi.fn(),
  cookieHealth: vi.fn(), rescoreLead: vi.fn(),
}));

const app = express();
app.use(express.json());
app.use('/api/acquisition', acquisitionDispatchRouter, acquisitionRouter);
const retired = ['/collect/start', '/account-scan/trigger', '/build-assignments', '/dispatch/build', '/dispatch/run', '/warmup/run'];

describe('retired Kotlin acquisition entry points', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ id: 'fixture-task' }] } as any);
    vi.mocked(scoreLeads).mockResolvedValue({ scored: 0 } as any);
    vi.mocked(buildAssignments).mockResolvedValue({ assigned: 0 } as any);
    vi.mocked(dispatchDue).mockResolvedValue({ dispatched: 0 } as any);
  });
  for (const path of retired) {
    it(`${path} retains tenant authentication and rejects new work without business side effects`, async () => {
      const unauth = await request(app).post(`/api/acquisition${path}`).send({ keywords: ['test'] });
      expect(unauth.status).toBe(401);
      const result = await request(app).post(`/api/acquisition${path}`).set('x-test-tenant', 'tenant-a').send({ keywords: ['test'] });
      expect(result.status).toBe(410);
      expect(result.body.success).toBe(false);
      expect(result.body.error.code).toBe('LEGACY_ACQUISITION_RETIRED');
      expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
      expect(vi.mocked(pool.connect)).not.toHaveBeenCalled();
      expect(buildAssignments).not.toHaveBeenCalled();
      expect(dispatchDue).not.toHaveBeenCalled();
      expect(scoreLeads).not.toHaveBeenCalled();
    });
  }
  it('history reads remain available and tenant scoped', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const response = await request(app).get('/api/acquisition/dispatch/plan').set('x-test-tenant', 'tenant-a');
    expect(response.status).toBe(200);
    expect(vi.mocked(pool.query)).toHaveBeenCalled();
    expect(vi.mocked(pool.query).mock.calls[0][1]).toContain('tenant-a');
  });
  it('in-flight cancellation and agent report are not intercepted by retirement guard', async () => {
    const cancel = await request(app).post('/api/acquisition/collect/cancel').set('x-test-tenant', 'tenant-a').send({});
    const report = await request(app).post('/api/acquisition/collect/report').send({});
    expect(cancel.status).not.toBe(410);
    expect(report.status).not.toBe(410);
  });
});
