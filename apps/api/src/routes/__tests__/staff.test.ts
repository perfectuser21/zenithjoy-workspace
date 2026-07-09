/**
 * staff 路由合同测试
 *
 * 覆盖：
 *   FR9  — POST /api/staff/skill-eval/upload 不带认证头 → 403
 *   FR11 — GET  /api/staff/skill-eval/status/:jobId 不带认证头 → 403
 *
 * 注：staffGuard 的详细行为由 middleware/staff.test.ts 覆盖。
 * 本文件只验证 HTTP 层路由注册 + staffGuard 集成效果。
 *
 * 合同对应：contract-dod.md BEHAVIOR FR9/FR10/FR11
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import app from '../../app';

describe('staff routes — staffGuard 集成', () => {
  it('POST /api/staff/skill-eval/upload 不带认证头返回 403', async () => {
    const res = await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('Content-Type', 'multipart/form-data');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('GET /api/staff/skill-eval/status/:jobId 不带认证头返回 403', async () => {
    const res = await request(app)
      .get('/api/staff/skill-eval/status/test-job-001');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('带白名单外邮箱时 POST /api/staff/skill-eval/upload 返回 403', async () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const res = await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('X-User-Email', 'unknown@test.com')
      .set('Content-Type', 'multipart/form-data');
    expect(res.status).toBe(403);
    vi.unstubAllEnvs();
  });
});
