/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Path 2 Sprint A hotfix — feishu-oauth router unit tests
 *
 * 覆盖：
 *  - [BEHAVIOR] GET /status with binding row → returns {bound: true, app_token, ...}
 *  - [BEHAVIOR] GET /status without binding row → returns {bound: false}
 *  - [BEHAVIOR] GET /status non-existent tenant → 404 TENANT_NOT_FOUND
 *  - [BEHAVIOR] POST /start uses req.tenantId from tenantContext (no X-Tenant-Id header needed)
 *  - [ARCH] POST /bind happy — 0-touch provision (app credentials, 不走 OAuth)
 *  - [ARCH] POST /bind 缺 app_id → 400 MISSING_FIELDS
 *  - [ARCH] POST /bind ALREADY_BOUND → 400 + rebind_required:true
 *  - [ARCH] POST /bind provisionBitable fail → 502 PROVISION_FAILED
 *  - [ARCH] POST /rebuild happy — 删 binding 行 + 重 provision
 *
 * Mock pg.Pool 不连真 DB；mock tenantContext 注入 req.tenantId。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock pg pool
vi.mock('../db/connection', () => ({
  default: {
    query: vi.fn(),
  },
}));

// Mock tenantContext middleware — 注入 req.tenantId
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    req.tenantId = req.headers['x-test-tenant-id'] || '';
    next();
  },
}));

// Mock feishu-token / feishu-bitable services（POST /start 用）
vi.mock('../services/feishu-token', () => ({
  getAuthorizeUrl: vi.fn().mockResolvedValue('https://open.feishu.cn/test/authorize'),
  handleCallback: vi.fn(),
}));
vi.mock('../services/feishu-bitable-multitenant', () => {
  class ProvisionFailedError extends Error {
    code = 'PROVISION_FAILED';
    constructor(msg: string) {
      super(msg);
      this.name = 'ProvisionFailedError';
    }
  }
  return {
    provisionBitable: vi.fn(),
    ProvisionFailedError,
  };
});

import pool from '../db/connection';
import feishuOauthRouter from './feishu-oauth';
import { provisionBitable, ProvisionFailedError } from '../services/feishu-bitable-multitenant';

const app = express();
app.use(express.json());
app.use('/api/feishu/oauth', feishuOauthRouter);

const VALID_TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const NOT_FOUND_TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('Path 2 hotfix — feishu-oauth router', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('[BEHAVIOR] GET /status with binding row returns bound=true + table_ids', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        bound: true,
        app_token: 'bascn1234567890ABC',
        bound_at: new Date('2026-05-09T10:00:00Z'),
        needs_retry: false,
        table_id_lead_profile: 'tbl1aaaaaaaaaaaaaa',
        table_id_target_videos: 'tbl1bbbbbbbbbbbbbb',
        table_id_leads: 'tbl1cccccccccccccc',
      }],
    } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', VALID_TENANT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bound).toBe(true);
    expect(res.body.data.app_token).toBe('bascn1234567890ABC');
    expect(res.body.data.bitable_doc_url).toContain('bascn1234567890ABC');
    expect(res.body.data.table_ids.lead_profile).toBe('tbl1aaaaaaaaaaaaaa');
    expect(res.body.data.needs_retry).toBe(false);
  });

  it('[BEHAVIOR] GET /status without binding row returns bound=false', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        bound: false,
        app_token: null,
        bound_at: null,
        needs_retry: false,
        table_id_lead_profile: null,
        table_id_target_videos: null,
        table_id_leads: null,
      }],
    } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', VALID_TENANT);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bound).toBe(false);
    expect(res.body.data.app_token).toBeNull();
    expect(res.body.data.bitable_doc_url).toBeNull();
  });

  it('[BEHAVIOR] GET /status non-existent tenant returns 404 TENANT_NOT_FOUND', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const res = await request(app)
      .get('/api/feishu/oauth/status')
      .set('x-test-tenant-id', NOT_FOUND_TENANT);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
  });

  it('[BEHAVIOR] POST /start uses req.tenantId from tenantContext (no X-Tenant-Id header needed)', async () => {
    vi.mocked(pool.query).mockImplementation(((sql: string) => {
      if (sql.includes('SELECT t.id')) {
        return Promise.resolve({ rows: [{ id: VALID_TENANT, already_bound: false }] } as any);
      }
      // UPDATE tenants
      return Promise.resolve({ rows: [], rowCount: 1 } as any);
    }) as any);

    const res = await request(app)
      .post('/api/feishu/oauth/start')
      .set('x-test-tenant-id', VALID_TENANT)  // tenantContext mock 把它放进 req.tenantId
      .send({ app_id: 'cli_test', app_secret: 'secret_test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.authorize_url).toContain('open.feishu.cn');
    // 关键：没传 X-Tenant-Id 仍然 work（tenantContext mock 把 x-test-tenant-id 当 tenantId）
  });

  // -------------------------------------------------------------------
  // [ARCH] POST /bind — 0-touch app credentials provision (no OAuth)
  // -------------------------------------------------------------------

  it('[ARCH] POST /bind happy path — 0-touch provision returns 4 IDs + bitable_doc_url', async () => {
    // SELECT tenants + UPDATE tenants 阶段
    vi.mocked(pool.query).mockImplementation(((sql: string) => {
      if (sql.includes('SELECT t.id')) {
        return Promise.resolve({ rows: [{ id: VALID_TENANT, already_bound: false }] } as any);
      }
      return Promise.resolve({ rows: [], rowCount: 1 } as any);
    }) as any);

    vi.mocked(provisionBitable).mockResolvedValueOnce({
      app_token: 'bascnNEW9999999999',
      table_id_lead_profile: 'tbl1aaaaaaaaaaaaaa',
      table_id_target_videos: 'tbl1bbbbbbbbbbbbbb',
      table_id_leads: 'tbl1cccccccccccccc',
    } as any);

    const res = await request(app)
      .post('/api/feishu/oauth/bind')
      .set('x-test-tenant-id', VALID_TENANT)
      .send({ app_id: 'cli_arch_test', app_secret: 'secret_arch_test' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.app_token).toBe('bascnNEW9999999999');
    expect(res.body.data.bitable_doc_url).toContain('bascnNEW9999999999');
    expect(res.body.data.table_ids.lead_profile).toBe('tbl1aaaaaaaaaaaaaa');
    expect(res.body.data.table_ids.target_videos).toBe('tbl1bbbbbbbbbbbbbb');
    expect(res.body.data.table_ids.leads).toBe('tbl1cccccccccccccc');
    expect(provisionBitable).toHaveBeenCalledWith(VALID_TENANT);
  });

  it('[ARCH] POST /bind 缺 app_id → 400 MISSING_FIELDS', async () => {
    const res = await request(app)
      .post('/api/feishu/oauth/bind')
      .set('x-test-tenant-id', VALID_TENANT)
      .send({ app_secret: 'secret_only' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MISSING_FIELDS');
  });

  it('[ARCH] POST /bind ALREADY_BOUND → 400 + rebind_required:true', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: VALID_TENANT, already_bound: true }],
    } as any);

    const res = await request(app)
      .post('/api/feishu/oauth/bind')
      .set('x-test-tenant-id', VALID_TENANT)
      .send({ app_id: 'cli_already', app_secret: 'secret_already' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('ALREADY_BOUND');
    expect(res.body.data?.rebind_required).toBe(true);
  });

  it('[ARCH] POST /bind provisionBitable throws ProvisionFailedError → 502', async () => {
    vi.mocked(pool.query).mockImplementation(((sql: string) => {
      if (sql.includes('SELECT t.id')) {
        return Promise.resolve({ rows: [{ id: VALID_TENANT, already_bound: false }] } as any);
      }
      return Promise.resolve({ rows: [], rowCount: 1 } as any);
    }) as any);

    vi.mocked(provisionBitable).mockRejectedValueOnce(
      new ProvisionFailedError('createBitable failed: code=99991663')
    );

    const res = await request(app)
      .post('/api/feishu/oauth/bind')
      .set('x-test-tenant-id', VALID_TENANT)
      .send({ app_id: 'cli_bad', app_secret: 'secret_bad' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('PROVISION_FAILED');
  });

  // -------------------------------------------------------------------
  // [ARCH] POST /rebuild — 强制 re-provision
  // -------------------------------------------------------------------

  it('[ARCH] POST /rebuild happy — 删 binding 行 + 重 provision', async () => {
    // DELETE binding + (provisionBitable 内部不走 DB mock 因为已经 mock 了 service)
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // DELETE

    vi.mocked(provisionBitable).mockResolvedValueOnce({
      app_token: 'bascnRBLD',
      table_id_lead_profile: 'tblrbld_a',
      table_id_target_videos: 'tblrbld_b',
      table_id_leads: 'tblrbld_c',
    } as any);

    const res = await request(app)
      .post('/api/feishu/oauth/rebuild')
      .set('x-test-tenant-id', VALID_TENANT)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.app_token).toBe('bascnRBLD');
    expect(provisionBitable).toHaveBeenCalledWith(VALID_TENANT);
  });
});
