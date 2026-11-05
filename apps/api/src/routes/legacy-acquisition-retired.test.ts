import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { legacyAcquisitionRetired } from './legacy-acquisition-retired';

describe('legacy acquisition retirement guard', () => {
  it.each([{ tenant: '', status: 401, code: 'NO_TENANT' }, { tenant: 'tenant-a', status: 410, code: 'LEGACY_ACQUISITION_RETIRED' }])(
    'returns $status and does not invoke downstream for tenant $tenant', async ({ tenant, status, code }) => {
      const nextHandler = vi.fn((_req, res) => res.status(200).end());
      const app = express();
      app.post('/retired', (req, _res, next) => { req.tenantId = tenant; next(); }, legacyAcquisitionRetired, nextHandler);
      const response = await request(app).post('/retired');
      expect(response.status).toBe(status);
      expect(response.body).toMatchObject({ success: false, error: { code } });
      expect(nextHandler).not.toHaveBeenCalled();
    },
  );
});
