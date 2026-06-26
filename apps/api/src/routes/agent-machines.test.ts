/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * agent-machines 路由层单测（与 sprints/06260400-machine-management/tests 同被测，配套 pairing）
 *
 * 被测：GET /machines（租户 scope + 禁用字段反向）/ GET /machines/:id（accounts role+valid）/
 *       PUT /machines/:id（改名+标主副 + INVALID_INPUT + CROSS_TENANT）。
 * DB 用 vi.mock 注入（真库验证在 contract-dod.md 的 manual:bash BEHAVIOR + smoke）。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../db/connection', () => ({
  default: { query: mockQuery },
}));

// 鉴权中间件 stub：x-test-tenant-id → 运营；都没 → handler 内 401
vi.mock('../middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));

import { agentMachinesRouter } from './agent-machines';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const MACHINE_ID = 'bbbbbbbb-1111-2222-3333-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent', agentMachinesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/agent/machines', () => {
  it('运营 → 列机器含 machine_role/status/douyin_account_count，无 role 漂移字段', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: MACHINE_ID, agent_id: 'agent-1', hostname: 'pc-01', nickname: '主控机A',
          machine_role: 'main', status: 'online', version: '1.0.70', douyin_account_count: 2,
        },
      ],
    });
    const r = await request(buildApp()).get('/api/agent/machines').set('x-test-tenant-id', TENANT);
    expect(r.status).toBe(200);
    expect(r.body.machines).toHaveLength(1);
    expect(r.body.machines[0]).toMatchObject({ machine_role: 'main', status: 'online', douyin_account_count: 2 });
    expect(r.body.machines[0].role).toBeUndefined();
    // 带请求者 tenantId 去 scope（参数化查询第一个参数 = TENANT）
    expect(mockQuery.mock.calls[0][1]).toEqual([TENANT]);
  });

  it('未登录（无 tenant）→ 401，不查库', async () => {
    const r = await request(buildApp()).get('/api/agent/machines');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/machines/:id', () => {
  it('返回 {machine, accounts}，号含 role + valid(boolean)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: MACHINE_ID, nickname: '主控机A', machine_role: 'main', status: 'online' }] })
      .mockResolvedValueOnce({
        rows: [{ account_label: 'burner-1', role: 'burner', status: 'active', nickname: '小号X', valid: true }],
      });
    const r = await request(buildApp()).get(`/api/agent/machines/${MACHINE_ID}`).set('x-test-tenant-id', TENANT);
    expect(r.status).toBe(200);
    expect(r.body.machine.id).toBe(MACHINE_ID);
    expect(Array.isArray(r.body.accounts)).toBe(true);
    expect(typeof r.body.accounts[0].valid).toBe('boolean');
    expect(r.body.accounts[0].role).toBe('burner');
  });

  it('机器不存在/非本租户 → 404 MACHINE_NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await request(buildApp()).get(`/api/agent/machines/${MACHINE_ID}`).set('x-test-tenant-id', TENANT);
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('MACHINE_NOT_FOUND');
  });
});

describe('PUT /api/agent/machines/:id', () => {
  it('改名 + 标主副 → 200 success，回显新值', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: MACHINE_ID, nickname: '副机B', machine_role: 'sub' }] });
    const r = await request(buildApp())
      .put(`/api/agent/machines/${MACHINE_ID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ nickname: '副机B', machine_role: 'sub' });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.machine).toMatchObject({ nickname: '副机B', machine_role: 'sub' });
  });

  it('改名为空 → 400 INVALID_INPUT，不写库', async () => {
    const r = await request(buildApp())
      .put(`/api/agent/machines/${MACHINE_ID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ nickname: '', machine_role: 'main' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('角色非法值 → 400 INVALID_INPUT', async () => {
    const r = await request(buildApp())
      .put(`/api/agent/machines/${MACHINE_ID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ nickname: 'x', machine_role: 'boss' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_INPUT');
  });

  it('跨租户改写（UPDATE 0 行）→ 403 CROSS_TENANT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r = await request(buildApp())
      .put(`/api/agent/machines/${MACHINE_ID}`)
      .set('x-test-tenant-id', TENANT)
      .send({ nickname: '窃改', machine_role: 'main' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CROSS_TENANT');
  });
});
