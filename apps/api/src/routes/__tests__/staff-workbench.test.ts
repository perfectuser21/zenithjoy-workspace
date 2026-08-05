/**
 * staff 工作台（Workbench）路由测试 — TDD Red commit
 *
 * Task: 9cc10ff2（军师台落地序列第 8 件，决策 af0d0818 执行层）
 * 覆盖 HTTP 层语义（Brain 转发逻辑由 services/__tests__/workbench.test.ts 覆盖）：
 *   GET  /api/staff/workbench/summary   — 200 + metrics/pending_runs/ai_tasks/availability 透传
 *   POST /api/staff/workbench/feedback  — 空 content → 400；service 抛错 → 502；成功 → 200 回执
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const fetchWorkbenchSummaryMock = vi.hoisted(() => vi.fn());
const submitWorkbenchFeedbackMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/workbench', () => ({
  fetchWorkbenchSummary: fetchWorkbenchSummaryMock,
  submitWorkbenchFeedback: submitWorkbenchFeedbackMock,
}));

import app from '../../app';

describe('staff routes — 员工工作台（Workbench）', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    fetchWorkbenchSummaryMock.mockReset();
    submitWorkbenchFeedbackMock.mockReset();
  });

  it('[BEHAVIOR] GET /api/staff/workbench/summary 返回 200 + metrics/pending_runs/ai_tasks', async () => {
    fetchWorkbenchSummaryMock.mockResolvedValue({
      availability: 'ready',
      metrics: { pending_acceptance: 2, ai_running: 1, completed_7d: 5 },
      pending_runs: [{ run_key: 'r1', gp_title: 'GP-X', checks_total: 3 }],
      ai_tasks: [{ id: 't1', title: '军师台UI③', task_type: 'dev' }],
      message: null,
    });

    const res = await request(app)
      .get('/api/staff/workbench/summary')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.metrics.pending_acceptance).toBe(2);
    expect(res.body.pending_runs).toHaveLength(1);
    expect(res.body.ai_tasks[0].title).toContain('军师台');
  });

  it('[BEHAVIOR] GET summary 在 Brain degraded 时仍 200，透传 degraded（不 500）', async () => {
    fetchWorkbenchSummaryMock.mockResolvedValue({
      availability: 'degraded',
      metrics: { pending_acceptance: 0, ai_running: 0, completed_7d: 0 },
      pending_runs: [],
      ai_tasks: [],
      message: 'Brain: connect ECONNREFUSED',
    });

    const res = await request(app)
      .get('/api/staff/workbench/summary')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.availability).toBe('degraded');
    expect(res.body.message).toContain('ECONNREFUSED');
  });

  it('[BEHAVIOR] POST /api/staff/workbench/feedback 空 content → 400，service 不被调', async () => {
    const res = await request(app)
      .post('/api/staff/workbench/feedback')
      .set('X-User-Email', 'staff@test.com')
      .send({ content: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(submitWorkbenchFeedbackMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] POST feedback 成功 → 200 + capture 回执 id', async () => {
    submitWorkbenchFeedbackMock.mockResolvedValue({ id: 'cap-1', status: 'clarified', dedupe_hit: false });

    const res = await request(app)
      .post('/api/staff/workbench/feedback')
      .set('X-User-Email', 'staff@test.com')
      .send({ content: '发布按钮点了没反应', nature: 'issue', link: 'https://github.com/x/y/pull/1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.capture.id).toBe('cap-1');
    expect(submitWorkbenchFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ content: '发布按钮点了没反应', nature: 'issue' })
    );
  });

  it('[BEHAVIOR] POST feedback service 抛错 → 502', async () => {
    submitWorkbenchFeedbackMock.mockRejectedValue(new Error('brain down'));

    const res = await request(app)
      .post('/api/staff/workbench/feedback')
      .set('X-User-Email', 'staff@test.com')
      .send({ content: '有个问题' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
