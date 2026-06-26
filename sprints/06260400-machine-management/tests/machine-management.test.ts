/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 机器管理模块 — 路由层 supertest（TDD Red）
 *
 * 被测：apps/api 新增 machines 端点（GET 列表 / GET 详情 / PUT 改名），按 tenant scope。
 *   GET  /api/agent/machines        → { machines: [...] }（每台含 machine_role / status / douyin_account_count）
 *   GET  /api/agent/machines/:id     → { machine, accounts:[{role, valid, ...}] }
 *   PUT  /api/agent/machines/:id     → { success, machine:{nickname, machine_role} }；空名/非法角色 400 INVALID_INPUT
 *
 * Red 证据：`../../../apps/api/src/routes/agent-machines` 路由尚未实现 → import 失败 → 全部 FAIL。
 * Generator 实现后转 Green。DB 用 vi.mock 注入，不连真库（真库验证在 contract-dod.md 的 manual:bash BEHAVIOR）。
 */
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock('../../../apps/api/src/db/connection', () => ({
  default: { query: mockQuery },
}));

// 鉴权中间件 stub：x-test-tenant-id → 运营；都没 → 401
vi.mock('../../../apps/api/src/middleware/tenant-context', () => ({
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));

// 尚未实现的目标路由（Red：模块不存在 → import 抛错 → 测试全红）
import { agentMachinesRouter } from '../../../apps/api/src/routes/agent-machines';

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

describe('GET /api/agent/machines [BEHAVIOR]', () => {
  it('运营 → 只列自己租户机器，含 machine_role/status/douyin_account_count', async () => {
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
    expect(Array.isArray(r.body.machines)).toBe(true);
    expect(r.body.machines[0]).toMatchObject({ machine_role: 'main', status: 'online', douyin_account_count: 2 });
    // 禁用字段反向：机器角色字段名是 machine_role，不是 role
    expect(r.body.machines[0].role).toBeUndefined();
  });

  it('未登录（无 tenant）→ 401，不查库', async () => {
    const r = await request(buildApp()).get('/api/agent/machines');
    expect(r.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/machines/:id [BEHAVIOR]', () => {
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
});

describe('PUT /api/agent/machines/:id [BEHAVIOR]', () => {
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
});
