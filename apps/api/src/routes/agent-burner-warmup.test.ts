/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Line02 warmup 回传端点单测
 *  POST /api/agent/burner/warmup-result — 设备级按真实昵称写 agent_warmup_liveness
 *  GET  /api/agent/burner/warmup-liveness — dashboard 查询
 *
 * 覆盖：tenant 服务端按 task_id 反查；error_code 空→upsert liveness+task done；
 *      error_code 非空→不 upsert（保留上次）；幂等（已 done→短路）；task_id 缺失→400。
 * Mock pool（vi.fn）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _r: any, n: any) => { const t = req.headers['x-test-tenant-id']; if (t) req.tenantId = t; n(); },
  tenantContextOptional: (req: any, _r: any, n: any) => { const t = req.headers['x-test-tenant-id'] || req.body?.tenant_id; if (t) req.tenantId = t; n(); },
}));
vi.mock('../middleware/agent-context', () => ({ agentContext: (_req: any, _r: any, n: any) => n() }));
vi.mock('../services/lead-writer', () => ({ writeLeadsFromComments: vi.fn(), writeDmOutreachStatus: vi.fn() }));
vi.mock('../services/device-platform', () => ({ isDuplicateDmOutreachResult: vi.fn(() => false) }));

import pool from '../db/connection';
import router from './agent-burner';

const app = express();
app.use(express.json());
app.use('/api/agent/burner', router);
const q = pool.query as any;

beforeEach(() => { q.mockReset(); });

describe('POST /api/agent/burner/warmup-result', () => {
  it('error_code 空 → publish_tasks done + 每号 upsert agent_warmup_liveness', async () => {
    q.mockResolvedValueOnce({ rows: [{ tenant_id: 't1', status: 'queued', agent_id: 'a1' }] }); // SELECT task
    q.mockResolvedValue({ rows: [], rowCount: 1 }); // UPDATE + INSERT×2
    const r = await request(app).post('/api/agent/burner/warmup-result').send({
      task_id: 'tk1', agent_id: 'a1', device_id: 'd1', total: 2, alive: 1, offline: 1,
      results: [
        { nickname: 'A', alive: true, followers: 1196, reason: 'ok' },
        { nickname: 'B', alive: false, followers: null, reason: 'x' },
      ],
      error_code: '',
    });
    expect(r.status).toBe(200);
    const sqls = q.mock.calls.map((c: any) => String(c[0]));
    expect(sqls.some((s: string) => /UPDATE zenithjoy\.publish_tasks/.test(s))).toBe(true);
    const upserts = sqls.filter((s: string) => /INSERT INTO zenithjoy\.agent_warmup_liveness/.test(s));
    expect(upserts.length).toBe(2); // 每号一条 upsert
  });

  it('error_code 非空 → 不 upsert liveness（保留上次）', async () => {
    q.mockResolvedValueOnce({ rows: [{ tenant_id: 't1', status: 'queued', agent_id: 'a1' }] });
    q.mockResolvedValue({ rows: [], rowCount: 1 });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({
      task_id: 'tk1', agent_id: 'a1', total: 0, alive: 0, offline: 0, results: [], error_code: 'MUTEX_BUSY',
    });
    expect(r.status).toBe(200);
    const sqls = q.mock.calls.map((c: any) => String(c[0]));
    expect(sqls.some((s: string) => /agent_warmup_liveness/.test(s))).toBe(false);
    expect(sqls.some((s: string) => /UPDATE zenithjoy\.publish_tasks/.test(s))).toBe(true);
  });

  it('幂等：publish_tasks 已 done → 短路不写', async () => {
    q.mockResolvedValueOnce({ rows: [{ tenant_id: 't1', status: 'done', agent_id: 'a1' }] });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({ task_id: 'tk1', results: [], error_code: '' });
    expect(r.status).toBe(200);
    expect(q.mock.calls.length).toBe(1); // 仅那次 SELECT
  });

  it('task_id 缺失 → 400', async () => {
    const r = await request(app).post('/api/agent/burner/warmup-result').send({});
    expect(r.status).toBe(400);
  });

  it('task_id 未找到 → 404', async () => {
    q.mockResolvedValueOnce({ rows: [] });
    const r = await request(app).post('/api/agent/burner/warmup-result').send({ task_id: 'nope', results: [], error_code: '' });
    expect(r.status).toBe(404);
  });
});

describe('GET /api/agent/burner/warmup-liveness', () => {
  it('返回该 agent 最近每号验活', async () => {
    q.mockResolvedValueOnce({ rows: [
      { nickname: 'A', alive: true, followers: 1196, reason: 'ok', checked_at: '2026-07-07T00:00:00Z' },
      { nickname: 'B', alive: false, followers: null, reason: 'x', checked_at: '2026-07-07T00:00:00Z' },
    ] });
    const r = await request(app).get('/api/agent/burner/warmup-liveness?agent_id=a1');
    expect(r.status).toBe(200);
    expect(r.body.data.liveness.length).toBe(2);
    expect(r.body.data.liveness[1].alive).toBe(false);
  });

  it('agent_id 缺失 → 400', async () => {
    const r = await request(app).get('/api/agent/burner/warmup-liveness');
    expect(r.status).toBe(400);
  });
});
