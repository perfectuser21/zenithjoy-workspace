/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * knowledgeAuthGuard 受控反转态的单元测试（mock 会话 + 成员表，无 PG，跑在 L3）。
 *
 * 命门② LIMIT1「静默取最早一条」反转为按 active_org 解析：≥2 家未选 → 409 ORG_SELECTION_REQUIRED。
 * 真库端到端断言在 sprints/08221800-org-context-switch-core/tests/（真 PG，L4）。
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

import { knowledgeAuthGuard } from './knowledge-auth';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/probe', knowledgeAuthGuard as any, (req: any, res) => {
    res.json({ orgId: req.knowledgeIdentity?.orgId });
  });
  return app;
}

/** getSession 返回一个带 activeOrg 的会话 */
function session(userId: string | null, activeOrg: string | null) {
  if (!userId) return null;
  return { user: { id: userId }, session: { activeOrg, token: 'tok' } };
}
/** queryMemberOrgIds 的 SELECT DISTINCT 返回这些 tenant_id */
function memberRows(...ids: string[]) {
  mockQuery.mockResolvedValue({ rows: ids.map((tenant_id) => ({ tenant_id })) } as any);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetSession.mockReset();
});

describe('knowledgeAuthGuard 五态', () => {
  it('无会话 → 401 SESSION_REQUIRED', async () => {
    mockGetSession.mockResolvedValue(session(null, null));
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('SESSION_REQUIRED');
  });

  it('会话 + 单企业 → 透明解析放行（orgId=那一家）', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberRows('org-A');
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(200);
    expect(r.body.orgId).toBe('org-A');
  });

  it('会话 + ≥2 家未选 → 409 ORG_SELECTION_REQUIRED（不静默取最早一条）', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    memberRows('org-A', 'org-B');
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ORG_SELECTION_REQUIRED');
  });

  it('会话 + ≥2 家 + active_org ∈ 集合 → 解析为选中的那家', async () => {
    mockGetSession.mockResolvedValue(session('u1', 'org-B'));
    memberRows('org-A', 'org-B');
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(200);
    expect(r.body.orgId).toBe('org-B');
  });

  it('会话 + active_org 伪造（∉ 集合）→ 403 ORG_FORBIDDEN', async () => {
    mockGetSession.mockResolvedValue(session('u1', 'org-C'));
    memberRows('org-A', 'org-B');
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ORG_FORBIDDEN');
  });

  it('成员表查询失败 → 503 LEDGER_UNREACHABLE（不吞成没权限）', async () => {
    mockGetSession.mockResolvedValue(session('u1', null));
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const r = await request(buildApp()).get('/probe');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('LEDGER_UNREACHABLE');
  });
});
