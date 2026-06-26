/**
 * 机器管理路由测试 — Path 2 机器管理
 *
 * 契约：sprints/06260400-machine-management/contract.md
 *   GET    /api/agent/machines           列机器（tenant 隔离 + session_count）
 *   GET    /api/agent/machines/:id        机器详情 + 抖音号列表
 *   PUT    /api/agent/machines/:id        改 nickname / machine_role
 *
 * 覆盖：三端点 happy path + tenant 隔离(跨租户 404) + PUT 非法 machine_role 400 + 无号 sessions:[]
 * 沿用项目 mock pool 约定（vi.mock pg.Pool / supertest）。
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function machineRow(overrides = {}) {
  return {
    id: AGENT_UUID,
    agent_id: 'agent-text-1',
    hostname: 'DESKTOP-XXX',
    nickname: '主力机',
    machine_role: 'main',
    status: 'online',
    version: '1.0.70',
    last_seen: '2026-06-26T06:00:00.000Z',
    session_count: '2',
    ...overrides,
  };
}

function sessionRow(overrides = {}) {
  return {
    account_label: 'perfect-01',
    role: 'main',
    status: 'active',
    platform: 'douyin',
    account_nickname: '默易',
    bound_at: '2026-06-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('GET /api/agent/machines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path：列出本租户机器，含 session_count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [machineRow()] });

    const res = await request(app).get(`/api/agent/machines?tenant_id=${TENANT}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe(AGENT_UUID);
    expect(res.body.data[0].hostname).toBe('DESKTOP-XXX');
    expect(res.body.data[0].nickname).toBe('主力机');
    expect(res.body.data[0].machine_role).toBe('main');
    expect(res.body.data[0].session_count).toBe(2);

    const call = mockQuery.mock.calls[0];
    expect(call[1]).toContain(TENANT);
  });

  it('tenant 隔离：缺 tenant_id → 空列表（不跨租户全表扫）', async () => {
    const res = await request(app).get('/api/agent/machines');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('GET /api/agent/machines/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path：机器详情 + 抖音号列表', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [machineRow()] })
      .mockResolvedValueOnce({ rows: [sessionRow()] });

    const res = await request(app).get(
      `/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.machine.id).toBe(AGENT_UUID);
    expect(res.body.data.machine.session_count).toBe(2);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0].account_label).toBe('perfect-01');
    expect(res.body.data.sessions[0].platform).toBe('douyin');
    expect(res.body.data.sessions[0].account_nickname).toBe('默易');
  });

  it('机器存在但无号 → sessions: []', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [machineRow({ session_count: '0' })] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(
      `/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.sessions).toEqual([]);
    expect(res.body.data.machine.session_count).toBe(0);
  });

  it('tenant 隔离：跨租户机器 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get(
      `/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MACHINE_NOT_FOUND');
  });
});

describe('PUT /api/agent/machines/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path：改 nickname + machine_role 成功', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [machineRow({ nickname: '备用机', machine_role: 'sub' })],
    });

    const res = await request(app)
      .put(`/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`)
      .send({ nickname: '备用机', machine_role: 'sub' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.nickname).toBe('备用机');
    expect(res.body.data.machine_role).toBe('sub');
  });

  it('非法 machine_role → 400', async () => {
    const res = await request(app)
      .put(`/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`)
      .send({ machine_role: 'backup' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('INVALID_MACHINE_ROLE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('两字段都缺 → 400', async () => {
    const res = await request(app)
      .put(`/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NO_UPDATE_FIELDS');
  });

  it('tenant 隔离：跨租户机器 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put(`/api/agent/machines/${AGENT_UUID}?tenant_id=${TENANT}`)
      .send({ nickname: '改个名' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MACHINE_NOT_FOUND');
  });
});
