import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/feishu-customer-list', () => {
  class FeishuFetchError extends Error {
    code = 'FEISHU_FETCH_FAILED';
    constructor(msg: string) {
      super(msg);
      this.name = 'FeishuFetchError';
    }
  }
  return {
    FeishuFetchError,
    provisionCustomerListTable: vi.fn(),
    syncCustomerList: vi.fn(),
  };
});

import router from './feishu-customer-list';
import {
  provisionCustomerListTable,
  syncCustomerList,
  FeishuFetchError,
} from '../services/feishu-customer-list';

const SMOKE = 'smoke-secret-2026';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/feishu/customer-list', router);
  return app;
}

describe('routes/feishu-customer-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMOKE_TOKEN = SMOKE;
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  });

  it('缺 X-Smoke-Token → 403 FORBIDDEN', async () => {
    const res = await request(makeApp()).post('/api/feishu/customer-list/provision').send({ tenant_id: 't1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(provisionCustomerListTable).not.toHaveBeenCalled();
  });

  it('provision 缺 tenant_id → 400', async () => {
    const res = await request(makeApp())
      .post('/api/feishu/customer-list/provision')
      .set('X-Smoke-Token', SMOKE)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TENANT_ID_REQUIRED');
  });

  it('provision 成功 → 200 + data', async () => {
    (provisionCustomerListTable as ReturnType<typeof vi.fn>).mockResolvedValue({
      app_token: 'bascn_x',
      table_id: 'tbl_x',
      reused: false,
    });
    const res = await request(makeApp())
      .post('/api/feishu/customer-list/provision')
      .set('X-Smoke-Token', SMOKE)
      .send({ tenant_id: 't1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.table_id).toBe('tbl_x');
  });

  it('sync 拉取失败（FeishuFetchError）→ 502 + 不当 500', async () => {
    (syncCustomerList as ReturnType<typeof vi.fn>).mockRejectedValue(
      new FeishuFetchError('飞书拉取失败 code=91402')
    );
    const res = await request(makeApp())
      .post('/api/feishu/customer-list/sync')
      .set('X-Smoke-Token', SMOKE)
      .send({ tenant_id: 't1' });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('FEISHU_FETCH_FAILED');
  });

  it('sync 成功 → 200 + 透传 inject_error/mock_records 给 service', async () => {
    (syncCustomerList as ReturnType<typeof vi.fn>).mockResolvedValue({ synced: 2, soft_deleted: 1 });
    const res = await request(makeApp())
      .post('/api/feishu/customer-list/sync')
      .set('X-Smoke-Token', SMOKE)
      .send({ tenant_id: 't1', inject_error: 'R3_NOT_FOUND', mock_records: [] });
    expect(res.status).toBe(200);
    expect(res.body.data.synced).toBe(2);
    expect(syncCustomerList).toHaveBeenCalledWith('t1', {
      injectError: 'R3_NOT_FOUND',
      mockRecords: [],
    });
  });

  it('X-Internal-Token 命中 ZENITHJOY_INTERNAL_TOKEN → 放行', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'internal-abc';
    (provisionCustomerListTable as ReturnType<typeof vi.fn>).mockResolvedValue({
      app_token: 'a',
      table_id: 'b',
      reused: true,
    });
    const res = await request(makeApp())
      .post('/api/feishu/customer-list/provision')
      .set('X-Internal-Token', 'internal-abc')
      .send({ tenant_id: 't1' });
    expect(res.status).toBe(200);
  });
});
