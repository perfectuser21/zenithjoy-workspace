/**
 * 合同测试骨架 — BEHAVIOR-IDEMPOTENT-RUN
 *
 * 验证相同 task_id + git_sha 连续 POST /api/staff/ability-acceptance/runs 两次，
 * 均返回 200 且 run id 相同（幂等）。
 *
 * 运行前提：
 *   - API_BASE 指向运行中的 API 服务（e.g. http://localhost:3000）
 *   - STAFF_EMAIL 在 STAFF_EMAILS 白名单中
 *   - ACCEPTANCE_TEMPLATE_ID 指向有效的 Line02/Android 模板 id
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3000';
const STAFF_EMAIL = process.env.STAFF_EMAIL ?? 'test@zenithjoy.com';
const TEMPLATE_ID = process.env.ACCEPTANCE_TEMPLATE_ID ?? '';

const headers = {
  'Content-Type': 'application/json',
  'X-User-Email': STAFF_EMAIL,
};

const IDEMPOTENT_PAYLOAD = {
  templateId: TEMPLATE_ID,
  taskId: `idempotent-test-${Date.now()}`,
  gitSha: 'deadbeef0001cafe0001cafe0001cafe00000001',
  env: 'staging',
};

describe('[BEHAVIOR-IDEMPOTENT-RUN] 同 task_id+git_sha 幂等创建 run', () => {
  let runId1: string;
  let runId2: string;

  beforeAll(async () => {
    if (!TEMPLATE_ID) {
      console.warn('ACCEPTANCE_TEMPLATE_ID 未设置，跳过幂等测试');
      return;
    }

    // 第一次 POST
    const res1 = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(IDEMPOTENT_PAYLOAD),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json() as { data: { id: string } };
    runId1 = body1.data.id;

    // 第二次 POST（相同 payload）
    const res2 = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(IDEMPOTENT_PAYLOAD),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as { data: { id: string } };
    runId2 = body2.data.id;
  });

  it('两次 POST 均返回 200 且 run id 相同', () => {
    expect(runId1).toBeTruthy();
    expect(runId2).toBeTruthy();
    expect(runId1).toBe(runId2);
  });

  it('GET run 详情可查到该 run', async () => {
    if (!runId1) return;
    const res = await fetch(`${API_BASE}/api/staff/ability-acceptance/runs/${runId1}`, {
      headers: { 'X-User-Email': STAFF_EMAIL },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string; taskId: string; gitSha: string } };
    expect(body.data.id).toBe(runId1);
    expect(body.data.taskId).toBe(IDEMPOTENT_PAYLOAD.taskId);
    expect(body.data.gitSha).toBe(IDEMPOTENT_PAYLOAD.gitSha);
  });
});
