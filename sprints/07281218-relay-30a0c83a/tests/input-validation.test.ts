/**
 * 合同测试骨架 — BEHAVIOR-INPUT-VALIDATION
 *
 * 验证 Zod 输入校验：非法输入返回 422。
 *
 * 运行前提：
 *   - API_BASE 指向运行中的 API 服务
 *   - STAFF_EMAIL 在 STAFF_EMAILS 白名单中
 */

import { describe, it, expect } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? 'test@zenithjoy.com';
const TEMPLATE_ID = process.env.ACCEPTANCE_TEMPLATE_ID ?? 'some-template-id';
const TEST_RUN_ID = process.env.TEST_RUN_ID ?? '00000000-0000-0000-0000-000000000000';

const authHeaders = {
  'Content-Type': 'application/json',
  'X-User-Email': STAFF_EMAIL,
};

describe('[BEHAVIOR-INPUT-VALIDATION] POST /runs — 非法输入返回 422', () => {
  it('git_sha 为空字符串 → 422', async () => {
    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        taskId: 'validation-test-001',
        gitSha: '',
        env: 'staging',
      }),
    });
    expect(res.status).toBe(422);
  });

  it('env 为非法值 → 422', async () => {
    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        taskId: 'validation-test-002',
        gitSha: 'abc123',
        env: 'development',  // 非法值，只允许 staging|production
      }),
    });
    expect(res.status).toBe(422);
  });

  it('缺少必填字段 taskId → 422', async () => {
    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        templateId: TEMPLATE_ID,
        gitSha: 'abc123',
        env: 'staging',
        // taskId 缺失
      }),
    });
    expect(res.status).toBe(422);
  });
});

describe('[BEHAVIOR-INPUT-VALIDATION] PATCH /runs/:id/devices/:deviceNo — 非法 device_no', () => {
  it('device_no = 6（超出 [1,5] 范围）→ 422', async () => {
    const res = await fetch(
      `${API_BASE}/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/6`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'PASS' }),
      },
    );
    expect(res.status).toBe(422);
  });

  it('device_no = 0（低于 1）→ 422', async () => {
    const res = await fetch(
      `${API_BASE}/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/0`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'PASS' }),
      },
    );
    expect(res.status).toBe(422);
  });

  it('status = UNKNOWN（非法状态值）→ 422', async () => {
    const res = await fetch(
      `${API_BASE}/api/staff/ability-acceptance/runs/${TEST_RUN_ID}/devices/1`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ status: 'UNKNOWN' }),
      },
    );
    expect(res.status).toBe(422);
  });
});
