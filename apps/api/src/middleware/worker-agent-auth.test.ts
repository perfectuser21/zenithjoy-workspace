/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * worker-agent-auth 单测 — 覆盖路由层契约测试（routes/__tests__/workers-executor.test.ts）
 * 之外的分支：license 状态不可用、agent 不存在、路径上没有 agentId、GET 直通、
 * dev 放行、内部 token 命中时不去查 license。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../services/walking-skeleton.service', () => ({ validateLicense: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: vi.fn() } }));
import { validateLicense } from '../services/walking-skeleton.service';
import pool from '../db/connection';
import { workerPostAuth } from './worker-agent-auth';
import { simpleRateLimit, ipKeyFn } from './simple-rate-limit';

const AID = '22222222-2222-4222-8222-222222222222';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LICENSE_KEY = 'ZJ-TESTORG-AAAA1111';

const app = express();
app.use(express.json());
// 限流先于鉴权 —— 与 workers-executor 的真实接线同序（鉴权 handler 本身也要被限流覆盖，
// CodeQL js/missing-rate-limiting）。max 取大值，只为保持接线形状，不干扰用例。
app.use('/api/workers', simpleRateLimit({ windowMs: 60_000, max: 10_000, keyFn: ipKeyFn }));
app.use('/api/workers', workerPostAuth);
app.all('/api/workers/*', (_req, res) => { res.status(200).json({ reached: true }); });

const licenseOk = (tenantId: string) => ({
  ok: true as const,
  license: { id: 'lic-1', license_key: LICENSE_KEY, tenant_id: tenantId, status: 'active', expires_at: '2099-01-01T00:00:00Z' },
});
const withLicense = (path = `/api/workers/${AID}/frame`) =>
  request(app).post(path).set('X-Agent-License', LICENSE_KEY);

beforeEach(() => { vi.clearAllMocks(); process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret'; });

describe('workerPostAuth — 非 POST / 无需 license 的直通路径', () => {
  it('GET 直接放行（读面挂同一前缀，无差别拦会把 GET 401 掉）', async () => {
    const r = await request(app).get(`/api/workers/${AID}/activity`);
    expect(r.status).toBe(200);
    expect(validateLicense).not.toHaveBeenCalled();
  });

  it('env 未设置 → dev 放行，不查 license', async () => {
    delete process.env.ZENITHJOY_INTERNAL_TOKEN;
    const r = await withLicense();
    expect(r.status).toBe(200);
    expect(validateLicense).not.toHaveBeenCalled();
  });

  it('内部 token 命中 → 放行且不去查 license', async () => {
    const r = await request(app).post(`/api/workers/${AID}/frame`).set('X-Internal-Token', 'secret');
    expect(r.status).toBe(200);
    expect(validateLicense).not.toHaveBeenCalled();
  });

  it('内部 token 错误且无 license → 401（既有 internalAuth 行为不回退）', async () => {
    const r = await request(app).post(`/api/workers/${AID}/frame`).set('X-Internal-Token', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('workerPostAuth — agent license 路径', () => {
  it('license 认不出（INVALID_LICENSE）→ 401', async () => {
    (validateLicense as any).mockResolvedValue({ ok: false, code: 'INVALID_LICENSE', message: 'license 不存在' });
    const r = await withLicense();
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_LICENSE');
    expect(pool.query).not.toHaveBeenCalled();
  });

  it.each(['REVOKED', 'SUSPENDED', 'EXPIRED', 'NO_TENANT'])(
    'license 认得出但不可用（%s）→ 403',
    async (code) => {
      (validateLicense as any).mockResolvedValue({ ok: false, code, message: 'x' });
      const r = await withLicense();
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe(code);
    }
  );

  it('agent 不存在 → 404 AGENT_NOT_FOUND', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockResolvedValue({ rows: [] });
    const r = await withLicense();
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('AGENT_NOT_FOUND');
  });

  it('agent 存在但 tenant_id 为空 → 403，不当成"两边都空所以相等"放行', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockResolvedValue({ rows: [{ tenant_id: null }] });
    const r = await withLicense();
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('路径上没有 agentId（/tasks/:id/steps）→ 401，license 不能顶内部 token', async () => {
    const r = await withLicense('/api/workers/tasks/11111111-1111-4111-8111-111111111111/steps');
    expect(r.status).toBe(401);
    expect(validateLicense).not.toHaveBeenCalled();
  });

  it('agent tenant 查询抛错 → 500 AGENT_LOOKUP_FAILED，不静默放行', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockRejectedValue(new Error('connection refused'));
    const r = await withLicense();
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('AGENT_LOOKUP_FAILED');
  });

  it('validateLicense 抛错 → 500 LICENSE_LOOKUP_FAILED，不静默放行', async () => {
    (validateLicense as any).mockRejectedValue(new Error('db down'));
    const r = await withLicense();
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('LICENSE_LOOKUP_FAILED');
  });

  it('同租户 → 放行，且按路径上的 agentId 查 agents 表', async () => {
    (validateLicense as any).mockResolvedValue(licenseOk(TENANT_A));
    (pool.query as any).mockResolvedValue({ rows: [{ tenant_id: TENANT_A }] });
    const r = await withLicense();
    expect(r.status).toBe(200);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('FROM zenithjoy.agents'), [AID]);
  });
});
