/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * H-2 Bug 3 hotfix — mock-agent endpoint 生产可调（X-Smoke-Token 单门禁）
 *
 * 旧合同 (NODE_ENV=production 一律 404) 阻塞 lead 自验脚本生产模式调用。现拆掉硬 404，
 * 由 X-Smoke-Token 单一承担鉴权。生产环境必须显式设 SMOKE_TOKEN env 才接受调用，
 * 防 default fallback 'smoke-secret-2026' 泄漏导致生产可被任意人调。
 *
 * 覆盖:
 *  - [SECURITY] 缺 X-Smoke-Token → 403
 *  - [SECURITY] X-Smoke-Token 错 → 403
 *  - [SECURITY] NODE_ENV=production + 未设 SMOKE_TOKEN env → 503 SMOKE_TOKEN_NOT_CONFIGURED
 *  - [SECURITY] NODE_ENV=production + SMOKE_TOKEN env 已设 + 正确 header → 200（生产可调）
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
    if (ORIGINAL_TOKEN === undefined) {
      delete process.env.SMOKE_TOKEN;
    } else {
      process.env.SMOKE_TOKEN = ORIGINAL_TOKEN;
    }
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

  it('[SECURITY] NODE_ENV=production + 未设 SMOKE_TOKEN env → 503 SMOKE_TOKEN_NOT_CONFIGURED', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.SMOKE_TOKEN;
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'whatever')
      .send({ tenant_id: 'aaa', agent_id_text: 'x' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('SMOKE_TOKEN_NOT_CONFIGURED');
  });

  it('[SECURITY] NODE_ENV=production + SMOKE_TOKEN env 已设 + 正确 header → 200（生产可调）', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SMOKE_TOKEN = 'prod-explicit-secret-xyz';
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '88888888-8888-8888-8888-888888888888' }],
    } as any);
    const app = buildApp();
    const r = await request(app)
      .post('/api/_smoke/mock-agent')
      .set('X-Smoke-Token', 'prod-explicit-secret-xyz')
      .send({
        tenant_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        agent_id_text: 'lead-prod-test',
      });
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.agent_uuid).toBe('88888888-8888-8888-8888-888888888888');
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

    const callArg = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(callArg).toMatch(/INSERT\s+INTO\s+zenithjoy\.agents/i);
    expect(callArg).toMatch(/ON\s+CONFLICT/i);
    expect(callArg).toMatch(/'online'/);
  });
});
