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
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const axiosPostMock = vi.hoisted(() => vi.fn());
const axiosGetMock = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    post: axiosPostMock,
    get: axiosGetMock,
    isAxiosError: () => false,
  },
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

describe('staff routes — 下游 Cecelia skill-eval 契约转发', () => {
  // Bug: 下游 /api/skill-eval/upload 强制要求 multipart 字段 skill_name（缺则 400
  // "skill_name is required"，真实复现——白名单邮箱账号也会失败，因为本路由此前
  // 从未转发这个字段）。同时下游成功响应是 { task_id, queue_position }，本路由
  // 早期实现直接透传给前端，但前端读的是 data.job_id —— 这也是臆造字段，从未
  // 对齐过下游真实契约。
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    axiosPostMock.mockReset();
    axiosGetMock.mockReset();
  });

  it('[BEHAVIOR] 上传请求转发给下游时携带 skill_name（从文件名派生）+ submitter（X-User-Email）', async () => {
    axiosPostMock.mockResolvedValue({ status: 200, data: { task_id: 'real-task-1', queue_position: 0 } });

    await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('X-User-Email', 'staff@test.com')
      .attach('file', Buffer.from('zip-bytes'), 'my-skill.zip');

    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    const [, formData] = axiosPostMock.mock.calls[0];
    // FormData 无法直接断言字段值，走 get() 读取
    expect((formData as FormData).get('skill_name')).toBe('my-skill');
    expect((formData as FormData).get('submitter')).toBe('staff@test.com');
  });

  it('[BEHAVIOR] 上传响应把下游的 task_id 映射成前端期望的 data.job_id', async () => {
    axiosPostMock.mockResolvedValue({ status: 200, data: { task_id: 'real-task-2', queue_position: 1 } });

    const res = await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('X-User-Email', 'staff@test.com')
      .attach('file', Buffer.from('zip-bytes'), 'other.zip');

    expect(res.status).toBe(200);
    expect(res.body.data.job_id).toBe('real-task-2');
  });

  it('[BEHAVIOR] 状态查询响应把下游的 task_id 映射成前端期望的 data.job_id', async () => {
    axiosGetMock.mockResolvedValue({
      status: 200,
      data: { task_id: 'real-task-3', status: 'completed', report_url: 'http://localhost:5221/x', failure_reason: null },
    });

    const res = await request(app)
      .get('/api/staff/skill-eval/status/real-task-3')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.job_id).toBe('real-task-3');
    expect(res.body.data.status).toBe('completed');
  });

  it('[BEHAVIOR] GET /api/staff/skill-eval/report/:jobId 转发下游 report（?format=json）', async () => {
    axiosGetMock.mockResolvedValue({ status: 200, data: { verdict: { level: 'pass', text: 'ok' }, summary: '能用' } });

    const res = await request(app)
      .get('/api/staff/skill-eval/report/real-task-4')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.verdict.level).toBe('pass');
    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining('/report/real-task-4'),
      expect.objectContaining({ params: { format: 'json' } })
    );
  });
});
