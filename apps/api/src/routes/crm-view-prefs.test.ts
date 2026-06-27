/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GET/PUT /api/crm/view-prefs — CRM 列偏好服务端持久化（多视图扩展结构）
 *
 * 存储结构 prefs JSONB：
 *   { views: [{ id, name, columnState, sortModel, filterModel, quickFilter }], activeViewId }
 *
 * 鉴权：requireCsReadAccess（GET）/ requireCsWriteAccess('wechatId')（PUT）
 * scope：(tenant_id, cs_wechat_id)——每个运营一行。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockConnect } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery, connect: mockConnect, end: vi.fn() },
}));

vi.mock('../middleware/cs-config-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/cs-config-guard')>();
  const inject = (req: any, _res: any, next: any) => {
    if (req.headers['x-test-super-admin'] === 'true') {
      req.tenantRole = 'super-admin';
      return next();
    }
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) {
      req.tenantId = t;
      req.tenantRole = (req.headers['x-test-role'] as string) || 'owner';
      return next();
    }
    return _res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'no session (mock)' },
      timestamp: new Date().toISOString(),
    });
  };
  return {
    ...actual,
    requireCsReadAccess: inject,
    requireCsWriteAccess: () => inject,
    requireServiceCredential: inject,
  };
});

import crmRouter from './crm';

const TENANT = 'bbbbbbbb-2222-3333-4444-555555555555';
const CS_WECHAT = 'cs-viewprefs-test';

const DEFAULT_PREFS = {
  views: [
    {
      id: 'default',
      name: '默认视图',
      columnState: [],
      sortModel: [],
      filterModel: {},
      quickFilter: '',
    },
  ],
  activeViewId: 'default',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/crm', crmRouter);
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockConnect.mockReset();
});

// ─── GET /api/crm/view-prefs ─────────────────────────────────────────────────

describe('GET /api/crm/view-prefs — 读取列偏好（服务端持久化）', () => {
  it('普通运营带 cs_wechat_id → 200 返回 prefs（有记录时）', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ prefs: DEFAULT_PREFS }],
      rowCount: 1,
    } as any);

    const res = await request(buildApp())
      .get('/api/crm/view-prefs')
      .query({ cs_wechat_id: CS_WECHAT })
      .set('x-test-tenant-id', TENANT)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { prefs: DEFAULT_PREFS },
    });
  });

  it('无记录时 → 200 prefs=null（前端用默认值）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const res = await request(buildApp())
      .get('/api/crm/view-prefs')
      .query({ cs_wechat_id: CS_WECHAT })
      .set('x-test-tenant-id', TENANT);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { prefs: null },
    });
  });

  it('不带 cs_wechat_id → 400 CS_WECHAT_ID_REQUIRED', async () => {
    const res = await request(buildApp())
      .get('/api/crm/view-prefs')
      .set('x-test-tenant-id', TENANT);

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('CS_WECHAT_ID_REQUIRED');
  });

  it('未登录 → 401', async () => {
    const res = await request(buildApp())
      .get('/api/crm/view-prefs')
      .query({ cs_wechat_id: CS_WECHAT });

    expect(res.status).toBe(401);
  });
});

// ─── PUT /api/crm/view-prefs ─────────────────────────────────────────────────

describe('PUT /api/crm/view-prefs — 保存列偏好（服务端持久化）', () => {
  it('普通运营（owner）→ 200 写入 prefs', async () => {
    // resolveServiceWriteTenant: cs_wechat_id → tenant_id
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT }],
      rowCount: 1,
    } as any);
    // upsert prefs
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const res = await request(buildApp())
      .put('/api/crm/view-prefs')
      .send({ wechat_id: CS_WECHAT, prefs: DEFAULT_PREFS })
      .set('x-test-tenant-id', TENANT)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });

  it('body 缺 prefs → 400 PREFS_REQUIRED', async () => {
    const res = await request(buildApp())
      .put('/api/crm/view-prefs')
      .send({ wechat_id: CS_WECHAT })
      .set('x-test-tenant-id', TENANT)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('PREFS_REQUIRED');
  });

  it('prefs 结构不含 views 数组 → 400 PREFS_INVALID', async () => {
    const res = await request(buildApp())
      .put('/api/crm/view-prefs')
      .send({ wechat_id: CS_WECHAT, prefs: { invalid: true } })
      .set('x-test-tenant-id', TENANT)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(400);
    expect(res.body.error?.code).toBe('PREFS_INVALID');
  });

  it('未登录 → 401', async () => {
    const res = await request(buildApp())
      .put('/api/crm/view-prefs')
      .send({ wechat_id: CS_WECHAT, prefs: DEFAULT_PREFS });

    expect(res.status).toBe(401);
  });

  it('prefs 含多视图结构 → 200（向前兼容）', async () => {
    const multiViewPrefs = {
      views: [
        { id: 'default', name: '默认视图', columnState: [{ colId: 'name', width: 200 }], sortModel: [], filterModel: {}, quickFilter: '' },
        { id: 'v2', name: '精简视图', columnState: [], sortModel: [], filterModel: {}, quickFilter: 'vip' },
      ],
      activeViewId: 'v2',
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }], rowCount: 1 } as any);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const res = await request(buildApp())
      .put('/api/crm/view-prefs')
      .send({ wechat_id: CS_WECHAT, prefs: multiViewPrefs })
      .set('x-test-tenant-id', TENANT)
      .set('x-test-role', 'owner');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true });
  });
});
