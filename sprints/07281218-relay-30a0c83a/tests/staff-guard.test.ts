/**
 * 合同测试骨架 — BEHAVIOR-STAFF-GUARD
 *
 * 验证所有 /api/staff/ability-acceptance/* 端点在缺少有效 staff header 时返回 403。
 *
 * 运行前提：API_BASE 指向运行中的 API 服务
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';

const ENDPOINTS = [
  { method: 'GET', path: '/api/staff/ability-acceptance/templates' },
  { method: 'GET', path: '/api/staff/ability-acceptance/runs' },
  { method: 'POST', path: '/api/staff/ability-acceptance/runs' },
];

describe('[BEHAVIOR-STAFF-GUARD] staffGuard 保护所有 ability-acceptance 端点', () => {
  for (const endpoint of ENDPOINTS) {
    it(`${endpoint.method} ${endpoint.path} — 无 header 返回 403`, async () => {
      const res = await fetch(`${API_BASE}${endpoint.path}`, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        ...(endpoint.method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status).toBe(403);

      const body = await res.json() as { success: boolean; error: { code: string } };
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('FORBIDDEN');
    });

    it(`${endpoint.method} ${endpoint.path} — 非白名单邮箱返回 403`, async () => {
      const res = await fetch(`${API_BASE}${endpoint.path}`, {
        method: endpoint.method,
        headers: {
          'Content-Type': 'application/json',
          'X-User-Email': 'notastaff@random-domain-12345.com',
        },
        ...(endpoint.method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status).toBe(403);
    });
  }

  it('带有效 STAFF_EMAIL 的 GET /templates 返回 200 或 非403', async () => {
    const STAFF_EMAIL = process.env.STAFF_EMAIL;
    if (!STAFF_EMAIL) {
      console.warn('STAFF_EMAIL 未设置，跳过正向 staffGuard 测试');
      return;
    }

    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/templates`, {
      headers: { 'X-User-Email': STAFF_EMAIL },
    });
    expect(res.status).not.toBe(403);
  });
});
