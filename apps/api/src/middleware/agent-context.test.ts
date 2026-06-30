/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Path 2 Sprint B-1 architecture hotfix — agentContext middleware unit tests
 *
 * 覆盖：
 *  - [ARCH] happy: req.tenantId set + agents 表有 online 行 → req.agentId set + next()
 *  - [ARCH] NO_AGENT_CONTEXT: tenant 没 active agent → 401
 *  - [ARCH] 多 agent 取最新（created_at DESC）
 *  - [ARCH] req.tenantId 缺 → 401 NO_TENANT_FOR_AGENT_CONTEXT（应先经 tenantContext）
 *  - [ARCH] DB 错 → 500 AGENT_LOOKUP_FAILED
 *  - [ARCH] body explicit agent_id 已传 → middleware skip resolve（向后兼容）
 *
 * Mock pg.Pool 不连真 DB。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db/connection';
import { agentContext } from './agent-context';

function buildApp() {
  const app = express();
  app.use(express.json());
  // 模拟 tenantContext 已 run：通过 X-Test-Tenant-Id 注入 req.tenantId
  app.use((req: any, _res, next) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  });
  app.post('/test', agentContext, (req: any, res) => {
    res.json({ agentId: req.agentId, tenantId: req.tenantId });
  });
  return app;
}

describe('agentContext middleware [ARCH]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy: tenantId set + agents online row → req.agentId set + 200', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: '11111111-1111-1111-1111-111111111111' }],
    });
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({ account_label: '小号A' });
    expect(r.status).toBe(200);
    expect(r.body.agentId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('NO_AGENT_CONTEXT: tenant 没 active agent → 401', async () => {
    (pool.query as any).mockResolvedValueOnce({ rows: [] });
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({ account_label: '小号A' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('NO_AGENT_CONTEXT');
  });

  it('身份统一：派单优先 license.pinned_agent_id（与心跳/me/status 对齐）', async () => {
    // SQL 必须引用 pinned_agent_id，确保与心跳投递落到同一去重行
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: '33333333-3333-3333-3333-333333333333' }],
    });
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({});
    expect(r.status).toBe(200);
    expect(r.body.agentId).toBe('33333333-3333-3333-3333-333333333333');
    const callArg = (pool.query as any).mock.calls[0][0] as string;
    expect(callArg).toMatch(/pinned_agent_id/i);
  });

  it('pinned agent 超时时退化为最近心跳行（ORDER BY last_heartbeat_at DESC LIMIT 1）', async () => {
    (pool.query as any).mockResolvedValueOnce({
      rows: [{ id: '55555555-5555-5555-5555-555555555555' }],
    });
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({});
    expect(r.status).toBe(200);
    // 兜底改为 last_heartbeat_at DESC（pinned agent 超 5 分钟无心跳时选最活跃行）
    const callArg = (pool.query as any).mock.calls[0][0] as string;
    expect(callArg).toMatch(/ORDER\s+BY[\s\S]*last_heartbeat_at\s+DESC/i);
    expect(callArg).toMatch(/LIMIT\s+1/i);
  });

  it('req.tenantId 缺 → 401 NO_TENANT_FOR_AGENT_CONTEXT', async () => {
    const app = buildApp();
    const r = await request(app).post('/test').send({});
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('NO_TENANT_FOR_AGENT_CONTEXT');
    // pool 不应被 query
    expect((pool.query as any).mock.calls.length).toBe(0);
  });

  it('DB error → 500 AGENT_LOOKUP_FAILED', async () => {
    (pool.query as any).mockRejectedValueOnce(new Error('boom'));
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({});
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('AGENT_LOOKUP_FAILED');
  });

  it('body explicit agent_id 已传 → middleware skip resolve（向后兼容）', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/test')
      .set('X-Test-Tenant-Id', '22222222-2222-2222-2222-222222222222')
      .send({ agent_id: '44444444-4444-4444-4444-444444444444' });
    expect(r.status).toBe(200);
    expect(r.body.agentId).toBe('44444444-4444-4444-4444-444444444444');
    // pool 不应被 query — 显式 body 优先
    expect((pool.query as any).mock.calls.length).toBe(0);
  });
});
