/**
 * Agent 路由测试 — v1.2 Day 1-2
 *
 * POST /api/agent/register 4 大场景：success / invalid / expired / quota_exceeded
 * + 已绑定续签 / bad_request 边界
 *
 * 沿用项目现有 mock pool 约定。
 */

import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';

vi.mock('../../src/db/connection', () => ({
  default: { query: vi.fn(), end: vi.fn(), connect: vi.fn() },
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;

const LICENSE_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const FAR_FUTURE = new Date(Date.now() + 365 * 86400_000).toISOString();
const PAST = new Date(Date.now() - 86400_000).toISOString();

function makeLicenseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LICENSE_UUID,
    license_key: 'ZJ-B-ABCDEFGH',
    tier: 'basic',
    max_machines: 1,
    customer_id: null,
    customer_name: '测试客户',
    customer_email: null,
    status: 'active',
    issued_at: '2026-04-28T10:44:00Z',
    expires_at: FAR_FUTURE,
    revoked_at: null,
    notes: null,
    created_at: '2026-04-28T10:44:00Z',
    updated_at: '2026-04-28T10:44:00Z',
    ...overrides,
  };
}

describe('POST /api/agent/register — 4 大场景', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LICENSE_HMAC_SECRET = 'test-secret-at-least-16-chars-long';
  });

  const validBody = {
    license_key: 'ZJ-B-ABCDEFGH',
    machine_id: 'machine-fingerprint-xyz',
    hostname: 'test-pc',
    agent_id: 'agent-test-1',
    version: '1.2.0',
  };

  it('success：新装机注册成功，签发 ws_token', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeLicenseRow()] }) // findLicenseByKey
      .mockResolvedValueOnce({ rows: [] }) // existing machine：空
      .mockResolvedValueOnce({ rows: [{ count: 0 }] }) // count
      .mockResolvedValueOnce({ rows: [] }); // INSERT machine

    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tier).toBe('basic');
    expect(res.body.max_machines).toBe(1);
    expect(res.body.registered_machine_id).toBe('machine-fingerprint-xyz');
    expect(res.body.ws_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('success：已绑定 machine 续签（不占新名额）', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeLicenseRow()] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'mm-1',
            license_id: LICENSE_UUID,
            machine_id: validBody.machine_id,
            agent_id: 'old',
            hostname: 'old',
            first_seen: '2026-04-20T00:00:00Z',
            last_seen: '2026-04-25T00:00:00Z',
            status: 'active',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }); // UPDATE last_seen

    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ws_token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('invalid：license key 不存在 → 401', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('INVALID_LICENSE');
  });

  it('expired：license expires_at 已过 → 403', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLicenseRow({ expires_at: PAST })],
    });
    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
    expect(res.body.code).toBe('EXPIRED');
  });

  it('expired：status=revoked → 403', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [makeLicenseRow({ status: 'revoked' })],
    });
    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('EXPIRED');
  });

  it('quota_exceeded：basic 已绑 1 台，新机超额 → 403', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [makeLicenseRow()] })
      .mockResolvedValueOnce({ rows: [] }) // existing machine：空（新机）
      .mockResolvedValueOnce({ rows: [{ count: 1 }] }); // count：已 1，basic max=1

    const res = await request(app).post('/api/agent/register').send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.message).toContain('1');
  });

  it('badrequest：license_key 格式错 → 400', async () => {
    const res = await request(app)
      .post('/api/agent/register')
      .send({ ...validBody, license_key: 'not-a-license' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  it('badrequest：machine_id 太短 → 400', async () => {
    const res = await request(app)
      .post('/api/agent/register')
      .send({ ...validBody, machine_id: 'a' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });
});
