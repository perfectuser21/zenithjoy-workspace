/**
 * staff 验收模块路由测试
 *
 * 覆盖 HTTP 层语义（反代逻辑本身由 services/__tests__/acceptance.test.ts 覆盖）：
 *   GET  /api/staff/acceptance/pending          — 200 + availability 字段透传
 *   GET  /api/staff/acceptance/history          — 缺 gp_id → 400；带 gp_id → 200
 *   POST /api/staff/acceptance/results          — 空数组 → 400；service 抛错 → 502；成功 → 200
 *
 * 参照 staff.test.ts 里 line-health 路由测试的 supertest app 构造方式。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../../db/connection', () => ({
  default: { query: vi.fn() },
}));

vi.mock('../../auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

const fetchPendingRunsMock = vi.hoisted(() => vi.fn());
const fetchHistoryByGpIdMock = vi.hoisted(() => vi.fn());
const submitResultsMock = vi.hoisted(() => vi.fn());
vi.mock('../../services/acceptance', () => ({
  fetchPendingRuns: fetchPendingRunsMock,
  fetchHistoryByGpId: fetchHistoryByGpIdMock,
  submitResults: submitResultsMock,
}));

import app from '../../app';

describe('staff routes — 验收模块（Staff Hub 直连 Brain）', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    fetchPendingRunsMock.mockReset();
    fetchHistoryByGpIdMock.mockReset();
    submitResultsMock.mockReset();
  });

  it('[BEHAVIOR] GET /api/staff/acceptance/pending 返回 200 + availability 字段', async () => {
    fetchPendingRunsMock.mockResolvedValue({ availability: 'ready', runs: [{ run_key: 'r1', checks: [] }], message: null });

    const res = await request(app)
      .get('/api/staff/acceptance/pending')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.availability).toBe('ready');
    expect(res.body.runs).toHaveLength(1);
  });

  it('[BEHAVIOR] GET /api/staff/acceptance/pending 在 Brain degraded 时仍 200，透传 degraded', async () => {
    fetchPendingRunsMock.mockResolvedValue({ availability: 'degraded', runs: [], message: 'Brain: connect ECONNREFUSED' });

    const res = await request(app)
      .get('/api/staff/acceptance/pending')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.availability).toBe('degraded');
    expect(res.body.runs).toEqual([]);
  });

  it('[BEHAVIOR] GET /api/staff/acceptance/history 缺 gp_id → 400', async () => {
    const res = await request(app)
      .get('/api/staff/acceptance/history')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(fetchHistoryByGpIdMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] GET /api/staff/acceptance/history 带 gp_id → 200，透传 runs', async () => {
    fetchHistoryByGpIdMock.mockResolvedValue({ availability: 'ready', runs: [{ run_key: 'r1', version: '1.21' }], message: null });

    const res = await request(app)
      .get('/api/staff/acceptance/history?gp_id=gp1')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.runs[0].run_key).toBe('r1');
    expect(fetchHistoryByGpIdMock).toHaveBeenCalledWith('gp1');
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 空数组 → 400', async () => {
    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ results: [] });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(submitResultsMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 缺 results 字段 → 400', async () => {
    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 缺 run_key → 400，不打到 Brain', async () => {
    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ results: [{ check_key: 'S3-c1', result: '通过' }] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toMatch(/run_key/);
    expect(submitResultsMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results run_key 全是空白 → 400（空白不算作用域）', async () => {
    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ run_key: '   ', results: [{ check_key: 'S3-c1', result: '通过' }] });

    expect(res.status).toBe(400);
    expect(submitResultsMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results service 抛错 → 502', async () => {
    submitResultsMock.mockRejectedValue(new Error('Brain 500'));

    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '通过' }] });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BRAIN_UNAVAILABLE');
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 成功提交 → 200，submitted_by 取自 X-User-Email', async () => {
    submitResultsMock.mockResolvedValue({ updated: 1, runs: [{ run_key: 'r1', pass_rate: 1, status: 'passed' }] });

    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '通过' }] });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updated).toBe(1);
    expect(submitResultsMock).toHaveBeenCalledWith(
      [{ check_key: 'r1:001', result: '通过' }],
      'staff@test.com',
      'r1'
    );
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 合法 X-Feishu-User-Id + 伪造的 X-User-Email → submitted_by 取自 open_id，伪造邮箱不生效', async () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_f8fea87de8cc141b1b94914780eed76b');
    submitResultsMock.mockResolvedValue({ updated: 1, runs: [{ run_key: 'r1', pass_rate: 1, status: 'passed' }] });

    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-Feishu-User-Id', 'ou_f8fea87de8cc141b1b94914780eed76b')
      .set('X-User-Email', 'forged-not-in-whitelist@evil.com')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '通过' }] });

    expect(res.status).toBe(200);
    expect(submitResultsMock).toHaveBeenCalledWith(
      [{ check_key: 'r1:001', result: '通过' }],
      'ou_f8fea87de8cc141b1b94914780eed76b',
      'r1'
    );
  });

  it('[BEHAVIOR] POST /api/staff/acceptance/results 只带合法 X-User-Email → submitted_by 取自该邮箱', async () => {
    submitResultsMock.mockResolvedValue({ updated: 1, runs: [{ run_key: 'r1', pass_rate: 1, status: 'passed' }] });

    const res = await request(app)
      .post('/api/staff/acceptance/results')
      .set('X-User-Email', 'staff@test.com')
      .send({ run_key: 'r1', results: [{ check_key: 'r1:001', result: '通过' }] });

    expect(res.status).toBe(200);
    expect(submitResultsMock).toHaveBeenCalledWith(
      [{ check_key: 'r1:001', result: '通过' }],
      'staff@test.com',
      'r1'
    );
  });

  it('[BEHAVIOR] error path — 三个验收端点无认证头一律 403（staffGuard 不遗漏）', async () => {
    const getRes1 = await request(app).get('/api/staff/acceptance/pending');
    const getRes2 = await request(app).get('/api/staff/acceptance/history?gp_id=gp1');
    const postRes = await request(app).post('/api/staff/acceptance/results').send({ results: [{ check_key: 'r1:001', result: '通过' }] });

    expect(getRes1.status).toBe(403);
    expect(getRes2.status).toBe(403);
    expect(postRes.status).toBe(403);
  });
});
