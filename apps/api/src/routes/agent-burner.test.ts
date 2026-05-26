/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Path 2 Sprint B-1 — agent-burner router unit tests
 *
 * Sprint B-1 architecture hotfix（2026-05-10）: 接入 tenantContext + agentContext
 * middleware，让 frontend 仅传 { account_label } 就能完成 qr-bind 派单。
 *
 * 覆盖：
 *  - [ARCH] POST /qr-bind 仅传 { account_label } + tenantId/agentId 由 middleware 注入 → 200
 *  - [ARCH] POST /qr-bind 没 agentContext（无 active agent）→ 401 NO_AGENT_CONTEXT
 *  - [ARCH] POST /crawl-comments 同模式 → 200
 *  - [BACK-COMPAT] POST /qr-bind 显式传 body { tenant_id, agent_id, account_label } → 200（现有 supertest）
 *
 * Mock pool + middleware（注入 req.tenantId / req.agentId）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

// Mock tenantContext + agentContext middleware
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'] || req.body?.tenant_id || '';
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));
vi.mock('../middleware/agent-context', () => ({
  agentContext: (req: any, res: any, next: any) => {
    // 优先 body explicit
    if (req.body?.agent_id) {
      req.agentId = req.body.agent_id;
      return next();
    }
    const a = req.headers['x-test-agent-id'];
    if (typeof a === 'string' && a.length > 0) {
      req.agentId = a;
      return next();
    }
    res.status(401).json({
      success: false,
      error: { code: 'NO_AGENT_CONTEXT', message: 'no agent (mock)' },
      timestamp: new Date().toISOString(),
    });
  },
}));

// Mock services
vi.mock('../services/lead-writer', () => ({
  writeLeadsFromComments: vi.fn().mockResolvedValue({ lead_write_status: 'success' }),
}));

import pool from '../db/connection';
import agentBurnerRouter from './agent-burner';

const TENANT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_UUID = '11111111-1111-1111-1111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/burner', agentBurnerRouter);
  return app;
}

describe('agent-burner router [ARCH agentContext]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('[ARCH] POST /qr-bind 仅传 account_label + middleware 注入 → 200 + task_id', async () => {
    // existing-burner check returns no rows → no conflict
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // INSERT publish_tasks → returns task_id UUID
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '99999999-9999-9999-9999-999999999999' }],
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .set('X-Test-Agent-Id', AGENT_UUID)
      .send({ account_label: '装修小号B1' });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('99999999-9999-9999-9999-999999999999');

    // 验证 INSERT 用的是 middleware 注入的 AGENT_UUID
    const insertCall = vi.mocked(pool.query).mock.calls[1];
    expect(insertCall[1]).toContain(AGENT_UUID); // agent_id 参数
    expect(insertCall[1]).toContain(TENANT_UUID); // tenant_id 参数
  });

  it('[ARCH] POST /qr-bind 没 agent → 401 NO_AGENT_CONTEXT (middleware 拦)', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .send({ account_label: '装修小号B2' });

    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('NO_AGENT_CONTEXT');
    // pool 不应被 query
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });

  it('[ARCH] POST /crawl-comments 仅传 account_label + video_url → 200', async () => {
    // getFeishuBinding (binding row)
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ app_token: 'bascn_test', table_id_leads: 'tbl_l_test' }],
    } as any);
    // burner session check
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any);
    // INSERT crawl task
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '88888888-8888-8888-8888-888888888888' }],
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/crawl-comments')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .set('X-Test-Agent-Id', AGENT_UUID)
      .send({
        account_label: '装修小号B1',
        video_url: 'https://www.douyin.com/video/7000',
      });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('88888888-8888-8888-8888-888888888888');

    // 验证 burner session check 用 AGENT_UUID
    const sessionCall = vi.mocked(pool.query).mock.calls[1];
    expect(sessionCall[1]).toEqual([AGENT_UUID, '装修小号B1']);
  });

  it('[BACK-COMPAT] POST /qr-bind 显式 body 传 tenant_id + agent_id → 200（既有 supertest 兼容）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '77777777-7777-7777-7777-777777777777' }],
    } as any);

    const app = buildApp();
    // 不设 X-Test-Tenant-Id / X-Test-Agent-Id 头 — 仅靠 body
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({
        tenant_id: TENANT_UUID,
        agent_id: AGENT_UUID,
        account_label: '装修小号C',
      });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('77777777-7777-7777-7777-777777777777');
  });
});
