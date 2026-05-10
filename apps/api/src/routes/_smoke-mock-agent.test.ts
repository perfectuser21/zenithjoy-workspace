/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Path 2 Sprint B-1 architecture hotfix — _smoke/mock-agent dev-only endpoint
 *
 * 用途：lead 自验脚本走完 sign-up + 飞书 bind 后，需要在 agents 表插一行
 * status='online' 行（模拟客户已装 Agent），让后续 qr-bind 走通 agentContext
 * middleware。生产 NODE_ENV=production 时 endpoint 必返 404。
 *
 * 覆盖：
 *  - [SECURITY] NODE_ENV=production → 404
 *  - [SECURITY] 缺 X-Smoke-Token → 403
 *  - [SECURITY] X-Smoke-Token 错 → 403
 *  - [BEHAVIOR] 正常 → 200 + UPSERT agents 行 + 返 agent_uuid
 *  - [BEHAVIOR] 缺 tenant_id → 400 TENANT_ID_REQUIRED
 *  - [BEHAVIOR] 缺 agent_id_text → 400 AGENT_ID_TEXT_REQUIRED
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

import pool from '../db/connection';
import smokeMockAgentRouter from './_smoke-mock-agent';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/_smoke', smokeMockAgentRouter);
  return app;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_TOKEN = process.env.SMOKE_TOKEN;

describe('_smoke/mock-agent endpoint [SECURITY + BEHAVIOR]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    process.env.NODE_ENV = 'test';
    process.env.SMOKE_TOKEN = 'smoke-secret-2026';
  });
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.SMOKE_TOKEN = ORIGINAL_TOKEN;
  });

  it('[SECURITY] NODE_ENV=production → 404 (endpoint disabled)', async () => {
    process.env.NODE_ENV = 'production';
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'smoke-secret-2026')
      .send({ tenant_id: 'aaa', agent_id_text: 'x' });
    expect(r.status).toBe(404);
  });

  it('[SECURITY] 缺 X-Smoke-Token → 403', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .send({ tenant_id: 'aaa', agent_id_text: 'x' });
    expect(r.status).toBe(403);
  });

  it('[SECURITY] X-Smoke-Token 错 → 403', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'wrong-token')
      .send({ tenant_id: 'aaa', agent_id_text: 'x' });
    expect(r.status).toBe(403);
  });

  it('[BEHAVIOR] 缺 tenant_id → 400 TENANT_ID_REQUIRED', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'smoke-secret-2026')
      .send({ agent_id_text: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('TENANT_ID_REQUIRED');
  });

  it('[BEHAVIOR] 缺 agent_id_text → 400 AGENT_ID_TEXT_REQUIRED', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'smoke-secret-2026')
      .send({ tenant_id: 'aaa' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('AGENT_ID_TEXT_REQUIRED');
  });

  it('[BEHAVIOR] 正常 → 200 + UPSERT agents 行 + 返 agent_uuid', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '99999999-9999-9999-9999-999999999999' }],
    } as any);
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'smoke-secret-2026')
      .send({
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        agent_id_text: 'xian-rog-agent',
      });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.agent_uuid).toBe('99999999-9999-9999-9999-999999999999');

    // 验证 SQL 是 UPSERT INTO agents (status='online')
    const callArg = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(callArg).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
    expect(callArg).toMatch(/ON\s+CONFLICT/i);
    expect(callArg).toMatch(/'online'/);
  });
});
