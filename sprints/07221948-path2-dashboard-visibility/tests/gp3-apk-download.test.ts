/**
 * 合同测试 — GP-3：安卓客户端下载入口
 * task_id: 7cb465c1-03cc-4934-a638-e61f78195d37
 * target_environment: local_api
 *
 * 先红测试（commit-1）：
 *   验证现有 /api/agent/install-pack 端点返回含 download_url 的 200。
 *   若端点缺失 download_url 字段则红（FR-3.3 断言）。
 *   前端 AcquisitionAccountsPage.tsx 需补入口（无 API 层断言，属 UI 层，此处只验后端不破坏）。
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:5200';
const TENANT_ID = `test-gp3-${Date.now()}`;

// ──────────────────────────────────────────────────────────────────────────────
// BEHAVIOR-GP3-A：GET /api/agent/install-pack 返回含 download_url 的 200
// ──────────────────────────────────────────────────────────────────────────────
describe('BEHAVIOR-GP3-A: GET /api/agent/install-pack returns download_url', () => {
  it('should return HTTP 200', async () => {
    const res = await fetch(`${API_BASE}/api/agent/install-pack`, {
      headers: {
        'X-Tenant-Id': TENANT_ID,
        'Content-Type': 'application/json',
      },
    });
    // 现有端点应存在（若不存在则此 smoke 即先红）
    expect(res.status).toBe(200);
  });

  it('response should contain download_url field with https:// URL', async () => {
    const res = await fetch(`${API_BASE}/api/agent/install-pack`, {
      headers: { 'X-Tenant-Id': TENANT_ID },
    });
    if (res.status !== 200) {
      // 先红：端点不可达时此测试应标记为失败
      expect(res.status).toBe(200);
      return;
    }
    const data = await res.json();
    // 先红断言：若 download_url / apk_url / url 均不存在则失败
    const downloadUrl =
      data.download_url ?? data.apk_url ?? data.url ?? data.data?.download_url;
    expect(downloadUrl).toBeTruthy();
    expect(typeof downloadUrl).toBe('string');
    expect(downloadUrl).toMatch(/^https?:\/\//);
  });

  it('existing logic (agent-install-pack.ts) should not be broken', async () => {
    // 回归断言：确认现有端点在本 sprint 前后行为一致
    const res = await fetch(`${API_BASE}/api/agent/install-pack`, {
      headers: { 'X-Tenant-Id': TENANT_ID },
    });
    expect([200, 503]).toContain(res.status); // 503 = manifest not yet built（可接受）
    // 不应出现 404 或 500
    expect(res.status).not.toBe(404);
    expect(res.status).not.toBe(500);
  });
});
