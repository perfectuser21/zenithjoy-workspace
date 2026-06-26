/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent-machines.test.ts — Line02 机器管理 API vitest 单测（ARTIFACT）
 *
 * 覆盖四端点：GET 列表（schema + 号数 + 禁用字段反向）/ GET 详情（machine+sessions+valid 派生）/
 * PUT 改名改角色（含非法 machine_role 400 不写库）/ POST add-douyin 派单。
 * pool 与 tenant-context 中间件均 mock，不依赖真库。oracle 真验在 contract-dod.md mode-A BEHAVIOR。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery },
}));

// tenantContextOptional：x-test-tenant-id → req.tenantId；否则透传（端点用 ?tenant_id= 回退）
vi.mock('../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));

import machinesRouter from './agent-machines';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/machines', machinesRouter);
  app.use((_req, res) =>
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'x' } }),
  );
  return app;
}

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const MID = 'bbbbbbbb-1111-2222-3333-444444444444';

beforeEach(() => vi.clearAllMocks());

describe('GET /api/agent/machines', () => {
  it('列表返回 tenant 机器，行含 7 字段，无禁用 drift 字段', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MID,
          nickname: '主力机',
          hostname: 'pc-1',
          status: 'online',
          version: '1.0.70',
          machine_role: 'main',
          douyin_account_count: 2,
        },
      ],
    });
    const res = await request(buildApp()).get(`/api/agent/machines?tenant_id=${TENANT}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.machines)).toBe(true);
    const row = res.body.data.machines[0];
    for (const k of [
      'id',
      'nickname',
      'hostname',
      'status',
      'version',
      'machine_role',
      'douyin_account_count',
    ]) {
      expect(row).toHaveProperty(k);
    }
    expect(row).not.toHaveProperty('name');
    expect(row).not.toHaveProperty('role');
    expect(row).not.toHaveProperty('account_count');
  });

  it('无 tenant → 400 MISSING_TENANT，不查库', async () => {
    const res = await request(buildApp()).get('/api/agent/machines');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_TENANT');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/machines/:id', () => {
  it('详情返回 machine + sessions，valid 派生自 status', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: MID,
            nickname: '主力机',
            hostname: 'pc-1',
            status: 'online',
            version: '1.0.70',
            machine_role: 'main',
            douyin_account_count: 2,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { account_label: 'main', role: 'main', status: 'active', account_nickname: 'n', bound_at: null },
          { account_label: 'dead', role: 'burner', status: 'expired', account_nickname: null, bound_at: null },
        ],
      });
    const res = await request(buildApp()).get(`/api/agent/machines/${MID}?tenant_id=${TENANT}`);
    expect(res.status).toBe(200);
    expect(res.body.data.machine.id).toBe(MID);
    expect(res.body.data.sessions[0].valid).toBe(true);
    expect(res.body.data.sessions[1].valid).toBe(false);
  });

  it('跨租户/不存在 → 404 MACHINE_NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(buildApp()).get(`/api/agent/machines/${MID}?tenant_id=${TENANT}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MACHINE_NOT_FOUND');
  });
});

describe('PUT /api/agent/machines/:id', () => {
  it('改 nickname + machine_role → 200', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: MID, nickname: '主力机A', machine_role: 'main' }] });
    const res = await request(buildApp())
      .put(`/api/agent/machines/${MID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ nickname: '主力机A', machine_role: 'main' });
    expect(res.status).toBe(200);
    expect(res.body.data.nickname).toBe('主力机A');
    expect(res.body.data.machine_role).toBe('main');
  });

  it('非法 machine_role → 400 INVALID_ROLE，不写库', async () => {
    const res = await request(buildApp())
      .put(`/api/agent/machines/${MID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ machine_role: 'boss' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ROLE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('nickname 与 machine_role 都缺 → 400 EMPTY_UPDATE', async () => {
    const res = await request(buildApp())
      .put(`/api/agent/machines/${MID}`)
      .set('x-test-tenant-id', TENANT)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('EMPTY_UPDATE');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('POST /api/agent/machines/:id/add-douyin', () => {
  it('派单返回 task_id', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MID, tenant_id: TENANT }] }) // 机器属租户校验
      .mockResolvedValueOnce({ rows: [{ id: 'cccccccc-1111-2222-3333-444444444444' }] }); // publish_tasks insert
    const res = await request(buildApp())
      .post(`/api/agent/machines/${MID}/add-douyin`)
      .set('x-test-tenant-id', TENANT)
      .send({ account_label: 'xh1' });
    expect(res.status).toBe(200);
    expect(typeof res.body.data.task_id).toBe('string');
  });

  it('缺 account_label → 400 MISSING_ACCOUNT_LABEL', async () => {
    const res = await request(buildApp())
      .post(`/api/agent/machines/${MID}/add-douyin`)
      .set('x-test-tenant-id', TENANT)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MISSING_ACCOUNT_LABEL');
  });
});
