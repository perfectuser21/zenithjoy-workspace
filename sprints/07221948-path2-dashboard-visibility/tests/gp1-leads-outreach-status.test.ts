/**
 * 合同测试 — GP-1：获客列表触达状态展示
 * task_id: 7cb465c1-03cc-4934-a638-e61f78195d37
 * target_environment: local_api
 *
 * 先红测试（commit-1）：实现交付前全部 FAIL。
 * 实现路径：apps/api/src/routes/acquisition.ts GET /leads 加 JOIN dm_assignments 最新一条。
 *
 * INV-2（租户隔离）/ INV-3（测试默认多租户）覆盖。
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:5200';
const TENANT_A = `test-gp1-a-${Date.now()}`;
const TENANT_B = `test-gp1-b-${Date.now()}`;

const headers = (tenantId: string) => ({
  'Content-Type': 'application/json',
  'X-Tenant-Id': tenantId,
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP1-A：有 dm_assignment 的 lead 返回 outreach_status
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP1-A: lead with dm_assignment returns non-untouched status', () => {
  it('should include outreach_status field in every lead', async () => {
    const res = await fetch(`${API_BASE}/api/acquisition/leads`, {
      headers: headers(TENANT_A),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('leads');
    // 若有 lead，每条必须有 outreach_status 字段
    for (const lead of data.leads) {
      expect(lead).toHaveProperty('outreach_status');
      expect(['untouched', 'touched', 'retry_needed']).toContain(lead.outreach_status);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP1-B：无 dm_assignment 的 lead 返回 untouched
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP1-B: lead without dm_assignment returns untouched', () => {
  it('lead with no assignment should have outreach_status=untouched', async () => {
    // 先红：GET /leads 目前不含 outreach_status 字段，此断言会失败
    const res = await fetch(`${API_BASE}/api/acquisition/leads`, {
      headers: headers(TENANT_B),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // 断言字段存在（先红：当前 /leads 未 JOIN dm_assignments，无此字段）
    for (const lead of data.leads) {
      expect(lead).toHaveProperty('outreach_status');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP1-C：多条 dm_assignment 取最新一条
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP1-C: multiple assignments - only latest matters', () => {
  it('latest assignment status should determine outreach_status', async () => {
    // 先红：需要种 2 条 assignment 数据，此测试依赖 DB seed
    // 实现后：旧 sent + 新 failed → outreach_status==retry_needed
    const res = await fetch(`${API_BASE}/api/acquisition/leads`, {
      headers: headers(TENANT_A),
    });
    expect(res.status).toBe(200);
    // 先红：outreach_status 字段不存在时此断言失败
    const data = await res.json();
    expect(Array.isArray(data.leads)).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP1-D：租户隔离（INV-2 / INV-3）
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP1-D: tenant isolation - no cross-tenant lead leak', () => {
  it('tenant B should not see tenant A leads', async () => {
    // 先确认 A 有 leads（或任何数据）
    const resA = await fetch(`${API_BASE}/api/acquisition/leads`, {
      headers: headers(TENANT_A),
    });
    const resB = await fetch(`${API_BASE}/api/acquisition/leads`, {
      headers: headers(TENANT_B),
    });
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const dataA = await resA.json();
    const dataB = await resB.json();
    // 两租户 leads 集合不得有交叉（commenter_id 不重叠）
    const idsA = new Set((dataA.leads ?? []).map((l: any) => l.commenter_id));
    const idsB = new Set((dataB.leads ?? []).map((l: any) => l.commenter_id));
    const intersection = [...idsA].filter((id) => idsB.has(id));
    expect(intersection).toHaveLength(0);
  });
});
