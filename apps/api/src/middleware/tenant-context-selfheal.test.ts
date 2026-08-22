/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * tenant-context selfHealOwnerMember 退役 —— 多组织切换第一刀·Gate 0 四处同刀
 *
 * 历史 self-heal：tenant_members 无行时按 licenses.customer_id 反查名下带 tenant 的 active license，
 * 命中即自动 INSERT owner 成员行并放行。多组织从非法反转为合法后，这条「按 license LIMIT1 自动补行」
 * 会在迁移窗口把成员写进错误企业（LIMIT1 复活在成员创建层，feedback P1-5），故必须与三闸同刀退役。
 *
 * 退役后语义：成员行只由显式供给（feishu-login / admin / auth-bridge）产生，tenant-context 不再自动补。
 *
 * 断言（反转自旧 self-heal 三条）：
 *  1. 无成员行（哪怕名下有带 tenant 的 license）→ 直接 403 NO_TENANT，绝不自动补行、绝不再查 license
 *  2. 已有成员行 → 走原路（不变）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../db/connection', () => ({ default: { query: mockQuery } }));

// better-auth session 一律返 null → tenantContext 回落 X-Feishu-User-Id 头路径
vi.mock('../auth', () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

import { tenantContext } from './tenant-context';

const USER = 'user-uid-xyz';
const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get('/probe', tenantContext as any, (req: any, res) => {
    res.json({ tenantId: req.tenantId, tenantRole: req.tenantRole });
  });
  return app;
}

beforeEach(() => {
  mockQuery.mockReset();
});

describe('tenantContext selfHealOwnerMember 退役 —— 不再自动补成员行', () => {
  it('无成员行 → 直接 403 NO_TENANT，绝不自动补 owner、绝不再查 license（只查一次 tenant_members）', async () => {
    // tenant_members 查询：无行。退役后到此即 403，不再有 license 反查 / INSERT 的第二三条 SQL。
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);

    const app = buildApp();
    const r = await request(app).get('/probe').set('x-feishu-user-id', USER);

    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('NO_TENANT');
    // 关键：只查了一次（tenant_members），没有 self-heal 的 license 反查，也没有 INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const onlySql = String(mockQuery.mock.calls[0][0]);
    expect(onlySql).toContain('tenant_members');
    expect(onlySql).not.toContain('licenses');
    // 全程无任何 INSERT（不自动补行）
    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toContain('INSERT INTO');
    }
  });

  it('已有成员行 → 走原路解出 tenantId（不变）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT, role: 'admin' }], rowCount: 1 } as any);

    const app = buildApp();
    const r = await request(app).get('/probe').set('x-feishu-user-id', USER);

    expect(r.status).toBe(200);
    expect(r.body.tenantId).toBe(TENANT);
    expect(r.body.tenantRole).toBe('admin');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
