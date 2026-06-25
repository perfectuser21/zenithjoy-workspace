/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * tenant-context self-heal 补偿 — 修 partial-bridge 漏网（登录无 tenant_members 行但名下有带 tenant 的 license）
 *
 * 背景（真实生产事故）：苏彦卿/徐啸 走非标准路径建了 license+tenant，但那条路没补 tenant_members owner 行，
 * 导致登录 tenantContext 解不出 tenantId → 403 NO_TENANT → per-operator 看不到自己客户。
 * 正常邮箱注册(auth-bridge)会补 owner 行，但飞书 oauth / 历史导入 / 特殊账号路径会漏。
 *
 * self-heal：tenantContext 查不到 tenant_members 行时，按 licenses.customer_id = 当前用户 反查
 *   名下带 tenant 的 active license；命中 → 自动 INSERT owner member（ON CONFLICT DO NOTHING）并用该 tenant 放行。
 *   这样以后注册/登录走任何路径都不再漏（悦升云端注册后也会自动绑），系统性根治。
 *
 * 断言：
 *  1. 无成员行 + 名下有带 tenant 的 license → 自愈补 owner + req.tenantId=该 license tenant + next()
 *  2. 无成员行 + 名下无任何带 tenant 的 license → 维持 403 NO_TENANT（不凭空造租户）
 *  3. 已有成员行 → 走原路（不触发自愈、不多查 license）
 *
 * Mock：../auth(session 返 null → 走 X-Feishu-User-Id 头) + ../db/connection。
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

describe('tenantContext self-heal — partial-bridge 漏网自愈', () => {
  it('无成员行 + 名下有带 tenant 的 license → 自动补 owner + 解出 tenantId + 放行', async () => {
    // 1) tenant_members 查询：无行
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any);
    // 2) self-heal：按 customer_id 反查名下带 tenant 的 license → 命中
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT }], rowCount: 1 } as any);
    // 3) INSERT owner member（自愈）
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 } as any);

    const app = buildApp();
    const r = await request(app).get('/probe').set('x-feishu-user-id', USER);

    expect(r.status).toBe(200);
    expect(r.body.tenantId).toBe(TENANT);
    expect(r.body.tenantRole).toBe('owner');
    // 第 3 条 SQL 必须是 INSERT tenant_members（真把 owner 行补进去，不只是临时放行）
    const insertSql = String(mockQuery.mock.calls[2][0]);
    expect(insertSql).toContain('INSERT INTO');
    expect(insertSql).toContain('tenant_members');
    expect(mockQuery.mock.calls[2][1]).toEqual([TENANT, USER, 'owner']);
  });

  it('无成员行 + 名下无带 tenant 的 license → 维持 403 NO_TENANT（不凭空造租户）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // tenant_members 无行
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as any); // self-heal license 反查无行

    const app = buildApp();
    const r = await request(app).get('/probe').set('x-feishu-user-id', USER);

    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe('NO_TENANT');
  });

  it('已有成员行 → 走原路，不触发自愈（不查 license、不 INSERT）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT, role: 'admin' }], rowCount: 1 } as any);

    const app = buildApp();
    const r = await request(app).get('/probe').set('x-feishu-user-id', USER);

    expect(r.status).toBe(200);
    expect(r.body.tenantId).toBe(TENANT);
    expect(r.body.tenantRole).toBe('admin');
    // 只查了一次（tenant_members），没走 self-heal 的 license 反查 / INSERT
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
