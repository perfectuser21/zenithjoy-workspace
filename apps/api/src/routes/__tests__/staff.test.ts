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

  // Bug: 原始独立页面（packages/brain/src/skill-eval-page/index.html）有"来源平台"+
  // "归属线"两个必填下拉选择，ZenithJoy 版本此前完全没转发这两个字段
  it('[BEHAVIOR] 上传请求转发给下游时携带前端选择的 platform + journey_id 字段', async () => {
    axiosPostMock.mockResolvedValue({ status: 200, data: { task_id: 'real-task-6', queue_position: 0 } });

    await request(app)
      .post('/api/staff/skill-eval/upload')
      .set('X-User-Email', 'staff@test.com')
      .field('platform', 'Codex')
      .field('journey_id', 'line04')
      .attach('file', Buffer.from('zip-bytes'), 'my-skill.zip');

    expect(axiosPostMock).toHaveBeenCalledTimes(1);
    const [, formData] = axiosPostMock.mock.calls[0];
    expect((formData as FormData).get('platform')).toBe('Codex');
    expect((formData as FormData).get('journey_id')).toBe('line04');
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

  // Bug（用户真实吐槽）：下游 renderReportHtml 是团队专门做的一套完整可视化报告
  // （skill-eval-report-render.js，381行，SVG输入盒→圆核→输出盒图 + 折叠详解表）。
  // 本路由此前默认拉 ?format=json 再由前端自己拼一张简陋卡片，等于把这套已经做好
  // 的可视化报告完全丢掉。改成默认拉下游的 HTML（不传 format，下游默认就是 HTML），
  // 原样透传，前端直接内嵌显示，不再自己臆造展示层。
  it('[BEHAVIOR] GET /api/staff/skill-eval/report/:jobId 默认转发下游真实 HTML 可视化报告（不再重新拼简陋卡片）', async () => {
    const fakeHtml = '<html><body><div class="head"><h1>wechat-moments-planner</h1></div></body></html>';
    axiosGetMock.mockResolvedValue({ status: 200, data: fakeHtml });

    const res = await request(app)
      .get('/api/staff/skill-eval/report/real-task-4')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toBe(fakeHtml);
    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining('/report/real-task-4'),
      expect.objectContaining({ params: undefined, responseType: 'text' })
    );
  });

  it('[BEHAVIOR] ?format=json 时仍可拉原始 report_data JSON（调试/兼容用）', async () => {
    axiosGetMock.mockResolvedValue({ status: 200, data: { verdict: { level: 'pass', text: 'ok' }, summary: '能用' } });

    const res = await request(app)
      .get('/api/staff/skill-eval/report/real-task-5?format=json')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.verdict.level).toBe('pass');
    expect(axiosGetMock).toHaveBeenCalledWith(
      expect.stringContaining('/report/real-task-5'),
      expect.objectContaining({ params: { format: 'json' } })
    );
  });
});

describe('staff routes — path health 聚合', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    vi.stubEnv('CECELIA_BRAIN_URL', 'http://brain.test');
    vi.stubEnv('STAFF_HUB_GITHUB_REPO', 'perfectuser21/zenithjoy-workspace');
    axiosGetMock.mockReset();
  });

  it('[BEHAVIOR] GET /api/staff/path-health 返回 Path1/2/4 三项，含 features 与 smoke', async () => {
    axiosGetMock.mockImplementation((url: string, config?: { params?: { journey_id?: string } }) => {
      if (url.includes('/journey_features')) {
        const journeyId = config?.params?.journey_id;
        if (journeyId === 'c019cdeb-d90b-4f8b-a658-ae333663ac35') {
          return Promise.resolve({
            data: [{ id: 'f1', name: '发布链路', status: 'done', thickness: 'thin', kind: 'feature', updated_at: '2026-07-21T00:00:00Z' }],
          });
        }
        if (journeyId === 'afa6abca-53c0-4815-8594-b7fb81ca547f') {
          return Promise.resolve({
            data: [{ id: 'f2', name: '获客链路', status: 'working', thickness: 'medium', kind: 'ability', updated_at: '2026-07-21T00:00:00Z' }],
          });
        }
        return Promise.resolve({
          data: [{ id: 'f4', name: '客服链路', status: 'planned', thickness: 'thin', kind: 'feature', updated_at: '2026-07-21T00:00:00Z' }],
        });
      }

      return Promise.resolve({
        data: {
          workflow_runs: [
            { id: 11, name: 'golden-path-1-smoke', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1', run_started_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:03:00Z' },
            { id: 22, name: 'golden-path-2-smoke', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/2', run_started_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:04:00Z' },
            { id: 44, name: 'golden-path-4-smoke', status: 'completed', conclusion: 'success', html_url: 'https://example.com/4', run_started_at: '2026-07-21T00:00:00Z', updated_at: '2026-07-21T00:05:00Z' },
          ],
        },
      });
    });

    const res = await request(app)
      .get('/api/staff/path-health')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0].path_key).toBe('path1');
    expect(res.body.data[0].features[0].name).toBe('发布链路');
    expect(res.body.data[0].smoke.conclusion).toBe('success');
    expect(res.body.data[1].path_key).toBe('path2');
    expect(res.body.data[2].path_key).toBe('path4');
  });

  it('[BEHAVIOR] 上游部分失败时仍返回 200，并把 path 标记为 degraded', async () => {
    axiosGetMock
      .mockRejectedValueOnce(new Error('brain down'))
      .mockResolvedValueOnce({
        data: { workflow_runs: [{ id: 11, name: 'golden-path-1-smoke', status: 'completed', conclusion: 'success', html_url: 'https://example.com/1' }] },
      })
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error('github down'))
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: { workflow_runs: [] } });

    const res = await request(app)
      .get('/api/staff/path-health')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data[0].availability).toBe('degraded');
    expect(res.body.data[0].message).toContain('Brain:');
    expect(res.body.data[1].availability).toBe('degraded');
    expect(res.body.data[1].message).toContain('GitHub:');
  });
});

describe('staff routes — POST /api/staff/feishu-login（公开路由，不受 staffGuard 保护）', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com,boss@zenithjoy.local');
    vi.stubEnv('FEISHU_APP_ID', 'cli_test_app_id');
    vi.stubEnv('FEISHU_APP_SECRET', 'test_app_secret');
    axiosPostMock.mockReset();
  });

  it('[BEHAVIOR] 不带 X-User-Email 头也能访问（不受 staffGuard 拦截）', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { open_id: 'ou_123', name: '张三', email: 'staff@test.com', access_token: 'user-token-xyz' } },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(200);
  });

  it('[BEHAVIOR] 白名单内邮箱：交换app_access_token→交换用户信息→返回user对象', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { open_id: 'ou_123', name: '张三', email: 'staff@test.com', access_token: 'user-token-xyz' } },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({
      id: 'ou_123',
      name: '张三',
      email: 'staff@test.com',
      feishu_user_id: 'ou_123',
      access_token: 'user-token-xyz',
    });
    expect(axiosPostMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/open-apis/auth/v3/app_access_token/internal'),
      { app_id: 'cli_test_app_id', app_secret: 'test_app_secret' },
      expect.anything()
    );
    expect(axiosPostMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('/open-apis/authen/v1/access_token'),
      { grant_type: 'authorization_code', code: 'real-feishu-auth-code' },
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer app-token-abc' }) })
    );
  });

  it('[BEHAVIOR] 邮箱不在白名单 → 403，且不泄露"账号是否存在"细节', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { open_id: 'ou_999', name: '路人', email: 'stranger@gmail.com', access_token: 'tok' } },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.user).toBeUndefined();
  });

  it('[BEHAVIOR] 飞书账号未绑定邮箱 → 403（无法核对白名单）', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { open_id: 'ou_888', name: '无邮箱用户', email: '', access_token: 'tok' } },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('[BEHAVIOR] 缺少 code 参数 → 400', async () => {
    const res = await request(app).post('/api/staff/feishu-login').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it('[BEHAVIOR] 服务端未配置 FEISHU_APP_ID/SECRET → 500', async () => {
    vi.stubEnv('FEISHU_APP_ID', '');
    vi.stubEnv('FEISHU_APP_SECRET', '');

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('[BEHAVIOR] 飞书 app_access_token 接口返回错误 → 502，不 500 崩溃', async () => {
    axiosPostMock.mockResolvedValueOnce({ data: { code: 10003, msg: 'invalid app_secret' } });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });

  it('[BEHAVIOR] 飞书用户信息接口返回错误(code非法/过期) → 502', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({ data: { code: 20009, msg: 'invalid authorization code' } });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'expired-or-reused-code' });

    expect(res.status).toBe(502);
    expect(res.body.success).toBe(false);
  });
});
