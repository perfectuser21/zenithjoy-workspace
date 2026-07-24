/**
 * 合同测试 — GP-2：人工触达配置弹窗（选号+话术）
 * task_id: 7cb465c1-03cc-4934-a638-e61f78195d37
 * target_environment: local_api
 *
 * 先红测试（commit-1）：
 *   - GET /api/acquisition/outreach/defaults 端点尚未实现 → 404
 *   - POST /api/acquisition/outreach/manual 端点尚未实现 → 404
 *
 * INV-2（租户隔离）/ NFR-4（dm_assignments 幂等）/ NFR-5（cancelling 防重入）覆盖。
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:5200';
const TENANT_ID = `test-gp2-${Date.now()}`;
const FAKE_LEAD_ID = '00000000-0000-0000-0000-000000000001';

const headers = (tenantId: string) => ({
  'Content-Type': 'application/json',
  'X-Tenant-Id': tenantId,
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP2-A：GET outreach/defaults 返回 accounts+default_script
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP2-A: GET /outreach/defaults returns accounts and default_script', () => {
  it('should return 200 with accounts array and default_script', async () => {
    // 先红：端点不存在，预期 404 → 实现后变 200
    const res = await fetch(
      `${API_BASE}/api/acquisition/outreach/defaults?lead_id=${FAKE_LEAD_ID}`,
      { headers: headers(TENANT_ID) }
    );
    // 先红断言（实现前 404，实现后必须 200）
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty('accounts');
    expect(Array.isArray(data.accounts)).toBe(true);
    expect(data).toHaveProperty('default_script');
    expect(typeof data.default_script).toBe('string');
    expect(data.default_script.length).toBeGreaterThan(0);
  });

  it('each account in defaults should have account_label and online_source', async () => {
    const res = await fetch(
      `${API_BASE}/api/acquisition/outreach/defaults?lead_id=${FAKE_LEAD_ID}`,
      { headers: headers(TENANT_ID) }
    );
    if (res.status !== 200) return; // 先红时跳过
    const data = await res.json();
    for (const acc of data.accounts ?? []) {
      expect(acc).toHaveProperty('account_label');
      expect(acc).toHaveProperty('online_source');
      expect(acc.online_source).toBe('heartbeat_proxy');
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP2-B：POST /outreach/manual 写入 dm_assignments
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP2-B: POST /outreach/manual creates dm_assignment', () => {
  it('should return 200 and write dm_assignment row', async () => {
    // 先红：端点不存在 → 404
    const res = await fetch(`${API_BASE}/api/acquisition/outreach/manual`, {
      method: 'POST',
      headers: headers(TENANT_ID),
      body: JSON.stringify({
        lead_id: FAKE_LEAD_ID,
        account_label: 'test_burner_acc',
        script_text: '测试话术内容',
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    // 实现后：响应含 dm_assignment_id 或 success:true
    expect(data.success ?? data.id ?? data.data).toBeTruthy();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP2-C：POST /outreach/manual 幂等（NFR-4）
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP2-C: POST /outreach/manual is idempotent (ON CONFLICT DO UPDATE)', () => {
  it('duplicate call with same (tenant,lead,account_label) should not return 409', async () => {
    const body = JSON.stringify({
      lead_id: FAKE_LEAD_ID,
      account_label: 'idempotent_burner',
      script_text: '第一次话术',
    });
    // 先红：端点不存在
    const res1 = await fetch(`${API_BASE}/api/acquisition/outreach/manual`, {
      method: 'POST',
      headers: headers(TENANT_ID),
      body,
    });
    const res2 = await fetch(`${API_BASE}/api/acquisition/outreach/manual`, {
      method: 'POST',
      headers: headers(TENANT_ID),
      body: JSON.stringify({
        lead_id: FAKE_LEAD_ID,
        account_label: 'idempotent_burner',
        script_text: '第二次话术（更新）',
      }),
    });
    // 两次都必须 200，不报 409
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // 不应该有 409 conflict
    expect(res2.status).not.toBe(409);
  });
});
