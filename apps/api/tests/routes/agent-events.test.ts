/**
 * Agent 观测事件路由测试 — Line02/Agent 观测
 *
 * 契约：scratchpad/observability-contract.md
 *   POST /api/agent/events                 agent 上报（x-license-key 鉴权，tenant 来自 license）
 *   GET  /api/agent/machines/:id/events     dashboard 读（tenantContextOptional）
 *
 * 鉴权说明：
 *   - POST 走 licenseAuth → validateLicense 先查 licenses 表（mock 第 1 次 query），再 INSERT（第 2 次）。
 *     license 不存在 → 401；kind 非法 → 400（不落库）。
 *   - GET 走 tenantContextOptional，用 X-Tenant-Id 头驱动已认证租户（参照 agent-machines.test 修复后写法）；
 *     绝不信 query.tenant_id。先查 agents（tenant 双过滤），不属本租户 → 404。
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
const AGENT_TEXT = 'agent-text-1';
const LICENSE_KEY = 'LIC-TEST-123';
const AUTH = { 'X-Tenant-Id': TENANT };

// licenseAuth 校验时 validateLicense 查 licenses 表返回的行
function licenseRow(overrides = {}) {
  return {
    id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    license_key: LICENSE_KEY,
    tenant_id: TENANT,
    status: 'active',
    expires_at: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('POST /api/agent/events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path：单条 log 事件落库，tenant 来自 license', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [licenseRow()] }) // validateLicense
      .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] }); // INSERT

    const res = await request(app)
      .post('/api/agent/events')
      .set('x-license-key', LICENSE_KEY)
      .send({ agent_id: AGENT_TEXT, kind: 'log', level: 'error', message: '崩了' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('evt-1');
    // INSERT 第 1 参必须是 license 解析出的 tenant，不信客户端
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[1][0]).toBe(TENANT);
    expect(insertCall[1][1]).toBe(AGENT_TEXT);
    expect(insertCall[1][2]).toBe('log');
  });

  it('happy path：批量 {events:[...]} 落库返回 count', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [licenseRow()] }) // validateLicense
      .mockResolvedValueOnce({ rows: [{ id: 'evt-a' }] }) // INSERT 1
      .mockResolvedValueOnce({ rows: [{ id: 'evt-b' }] }); // INSERT 2

    const res = await request(app)
      .post('/api/agent/events')
      .set('x-license-key', LICENSE_KEY)
      .send({
        events: [
          { agent_id: AGENT_TEXT, kind: 'upgrade', phase: 'download', percent: 30 },
          { agent_id: AGENT_TEXT, kind: 'upgrade', phase: 'done', percent: 100 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.ids).toEqual(['evt-a', 'evt-b']);
  });

  it('license 无效 → 401，不落库', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // validateLicense 查不到

    const res = await request(app)
      .post('/api/agent/events')
      .set('x-license-key', 'BAD-KEY')
      .send({ agent_id: AGENT_TEXT, kind: 'log', message: 'x' });

    expect(res.status).toBe(401);
    // 只查了 licenses，没 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('kind 非法 → 400，不落库', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [licenseRow()] }); // validateLicense 过

    const res = await request(app)
      .post('/api/agent/events')
      .set('x-license-key', LICENSE_KEY)
      .send({ agent_id: AGENT_TEXT, kind: 'metric', message: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_EVENT');
    // 只查了 licenses，没 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/agent/machines/:id/events', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path：分类返回 logs + upgrades', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ agent_id: AGENT_TEXT }] }) // agents 查找
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'u1',
            kind: 'upgrade',
            level: null,
            module: 'line04',
            phase: 'done',
            percent: 100,
            message: '升级完成',
            created_at: '2026-06-26T07:00:00.000Z',
          },
          {
            id: 'l1',
            kind: 'log',
            level: 'error',
            module: 'line04',
            phase: null,
            percent: null,
            message: '出错了',
            created_at: '2026-06-26T06:00:00.000Z',
          },
        ],
      });

    const res = await request(app)
      .get(`/api/agent/machines/${AGENT_UUID}/events`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.logs).toHaveLength(1);
    expect(res.body.data.logs[0]).toEqual({
      id: 'l1',
      level: 'error',
      module: 'line04',
      message: '出错了',
      created_at: '2026-06-26T06:00:00.000Z',
    });
    expect(res.body.data.upgrades).toHaveLength(1);
    expect(res.body.data.upgrades[0]).toEqual({
      id: 'u1',
      module: 'line04',
      phase: 'done',
      percent: 100,
      message: '升级完成',
      created_at: '2026-06-26T07:00:00.000Z',
    });
    // agents 查找必须带租户隔离
    expect(mockQuery.mock.calls[0][1]).toContain(TENANT);
  });

  it('tenant 隔离：机器不属本租户 → 404，不查 events', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // agents 查不到

    const res = await request(app)
      .get(`/api/agent/machines/${AGENT_UUID}/events`)
      .set(AUTH);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MACHINE_NOT_FOUND');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('无任何认证上下文 → 401', async () => {
    const res = await request(app).get(`/api/agent/machines/${AGENT_UUID}/events`);
    expect(res.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('limit query 生效（传进 SQL 参数）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ agent_id: AGENT_TEXT }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/agent/machines/${AGENT_UUID}/events?limit=5`)
      .set(AUTH);

    expect(res.status).toBe(200);
    // events 查询的最后一个参数 = limit 5
    const eventsParams = mockQuery.mock.calls[1][1];
    expect(eventsParams[eventsParams.length - 1]).toBe(5);
  });

  it('kind=log 过滤：拼进 events 查询参数', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ agent_id: AGENT_TEXT }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .get(`/api/agent/machines/${AGENT_UUID}/events?kind=log`)
      .set(AUTH);

    expect(res.status).toBe(200);
    expect(mockQuery.mock.calls[1][1]).toContain('log');
  });
});
