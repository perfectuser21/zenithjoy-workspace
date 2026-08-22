/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * org-context 路由的单元测试（mock 会话 + 成员表，无 PG，跑在 L3）。
 * 真库端到端在 sprints/08221800-org-context-switch-core/tests/。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery, mockGetSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetSession: vi.fn(),
}));
vi.mock('../db/connection', () => ({ default: { query: mockQuery } }));
vi.mock('../auth', () => ({ auth: { api: { getSession: mockGetSession } } }));

import { orgContextRouter } from './org-context';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/knowledge/org', orgContextRouter);
  return app;
}
function session(userId: string | null, activeOrg: string | null) {
  if (!userId) return null;
  return { user: { id: userId }, session: { activeOrg, token: 'tok' } };
}
/** 按 SQL 分派：JOIN tenants → 带名的 orgs；SELECT DISTINCT → 纯 tenant_id；其余 → 空 */
function memberOrgs(...ids: string[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (/JOIN zenithjoy\.tenants/i.test(sql))
      return { rows: ids.map((id) => ({ org_id: id, name: `企业-${id}`, role: 'member' })) };
    if (/SELECT DISTINCT/i.test(sql)) return { rows: ids.map((id) => ({ tenant_id: id })) };
    return { rows: [] };
  });
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe('GET /api/knowledge/org', () => {
  it('无会话 → 401', async () => {
    mockGetSession.mockResolvedValue(session(null, null));
    const r = await request(buildApp()).get('/api/knowledge/org');
    expect(r.status).toBe(401);
  });

  it('0 家 → 403 NO_TENANT', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberOrgs();
    const r = await request(buildApp()).get('/api/knowledge/org');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NO_TENANT');
  });

  it('单企业 → active_org_id=那一家、needs_selection=false', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberOrgs('org-A');
    const r = await request(buildApp()).get('/api/knowledge/org');
    expect(r.status).toBe(200);
    expect(r.body.data.active_org_id).toBe('org-A');
    expect(r.body.data.needs_selection).toBe(false);
  });

  it('≥2 家未选 → active_org_id=null、needs_selection=true', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberOrgs('org-A', 'org-B');
    const r = await request(buildApp()).get('/api/knowledge/org');
    expect(r.status).toBe(200);
    expect(r.body.data.orgs).toHaveLength(2);
    expect(r.body.data.active_org_id).toBeNull();
    expect(r.body.data.needs_selection).toBe(true);
  });
});

describe('POST /api/knowledge/org/switch', () => {
  it('缺 org_id → 400 VALIDATION_FAILED', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberOrgs('org-A', 'org-B');
    const r = await request(buildApp()).post('/api/knowledge/org/switch').send({});
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('目标 ∉ 成员集合 → 403 ORG_FORBIDDEN，绝不切换', async () => {
    mockGetSession.mockResolvedValue(session('u1', 'org-A'));
    memberOrgs('org-A', 'org-B');
    const r = await request(buildApp()).post('/api/knowledge/org/switch').send({ org_id: 'org-Z' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORG_FORBIDDEN');
  });

  it('目标 ∈ 成员集合 → 200，返回 active_org_id', async () => {
    mockGetSession.mockResolvedValue(session('u1', 'org-A'));
    memberOrgs('org-A', 'org-B');
    const r = await request(buildApp()).post('/api/knowledge/org/switch').send({ org_id: 'org-B' });
    expect(r.status).toBe(200);
    expect(r.body.data.active_org_id).toBe('org-B');
  });
});
