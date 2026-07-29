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
import fs from 'fs';
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

// feishu-login 挂了按 IP 限流(5次/5分钟)，functional 测试会在同一进程内连续发很多请求，
// 会互相触发限流导致误判——这里 mock 成直通，限流本身的行为由文件末尾独立一段真实验证。
vi.mock('../../middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  tenantKeyFn: () => 'anonymous',
  ipKeyFn: () => 'anonymous',
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

  it('[BEHAVIOR] 飞书账号未绑定邮箱，且 openId 也不在白名单 → 403', async () => {
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

  it('[BEHAVIOR] 飞书账号未绑定邮箱，但 openId 在 STAFF_FEISHU_OPENIDS 白名单 → 登录成功（真实场景：部分飞书账号从不返回email）', async () => {
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_f8fea87de8cc141b1b94914780eed76b');
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: { open_id: 'ou_f8fea87de8cc141b1b94914780eed76b', name: '', email: '', access_token: 'tok' },
        },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user).toEqual({
      id: 'ou_f8fea87de8cc141b1b94914780eed76b',
      name: 'ou_f8fea87de8cc141b1b94914780eed76b',
      email: '',
      feishu_user_id: 'ou_f8fea87de8cc141b1b94914780eed76b',
      access_token: 'tok',
    });
  });

  it('[BEHAVIOR] openId 不在白名单、email 也不在白名单 → 403（openId 白名单不会误放行陌生账号）', async () => {
    vi.stubEnv('STAFF_FEISHU_OPENIDS', 'ou_f8fea87de8cc141b1b94914780eed76b');
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { open_id: 'ou_stranger', name: '路人', email: '', access_token: 'tok' } },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('[BEHAVIOR] email 字段为空但 enterprise_email 有值 → 用 enterprise_email 兜底核对白名单', async () => {
    axiosPostMock
      .mockResolvedValueOnce({ data: { code: 0, app_access_token: 'app-token-abc', expire: 7200 } })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: { open_id: 'ou_777', name: '企业邮箱用户', email: '', enterprise_email: 'staff@test.com', access_token: 'tok' },
        },
      });

    const res = await request(app)
      .post('/api/staff/feishu-login')
      .send({ code: 'real-feishu-auth-code' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.email).toBe('staff@test.com');
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

describe('staff routes — feishu-login 真实限流行为（不走上面的passthrough mock）', () => {
  it('[BEHAVIOR] 同一 IP 超过 5 次/5分钟 → 第 6 次 429（CodeQL missing-rate-limiting 要求的真实mitigation）', async () => {
    const express = (await import('express')).default;
    const { ipKeyGenerator } = await import('express-rate-limit');
    const { simpleRateLimit: realSimpleRateLimit } = await vi.importActual<
      typeof import('../../middleware/simple-rate-limit')
    >('../../middleware/simple-rate-limit');

    const testApp = express();
    const limiter = realSimpleRateLimit({
      windowMs: 5 * 60_000,
      max: 5,
      keyFn: (req) => ipKeyGenerator(req.ip || 'unknown'),
    });
    testApp.use(limiter);
    testApp.get('/probe', (_req, res) => res.json({ ok: true }));

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      // supertest 每次新连接默认同一个本地回环地址，落在同一限流桶里
      const res = await request(testApp).get('/probe');
      statuses.push(res.status);
    }

    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});

// ─── 业务线健康看板（GP3 / line_health）────────────────────────────────────
// Sprint 07281207-staff-line-health-dashboard 合同：三个新端点的聚合/降级/鉴权行为。
// 本文件顶部已整体 mock axios（Brain + GitHub 全打桩），真实链路由
// .github/workflows/scripts/smoke/staff-line-health-smoke.sh 与 sprint 合同测试承担。

const LINE04_JOURNEY_ID = 'e675da0f-1117-4301-a801-cd4753beb8c8';
const STAGING_VERSION_URL = 'http://zenithjoy-api-staging:5200/version';
const PROD_VERSION_URL = 'http://zenithjoy-api-prod:5200/version';
const FAKE_SHA = 'b'.repeat(40); // production /version sha
const STAGING_SHA = 'e'.repeat(40);
const RECENT_SHA = 'f'.repeat(40); // main 上按路径过滤的最近提交（与部署状态无关）

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** 按 URL 分派 apps/api 自身 /version（内网直连）与 Brain / GitHub commits / search */
function routeLineHealthMocks(options: {
  brain?: () => Promise<unknown>;
  recentCommitDaysAgo?: number | null;
  searchFails?: boolean;
  stagingUnreachable?: boolean;
  productionUnreachable?: boolean;
} = {}) {
  const recentCommitDaysAgo = options.recentCommitDaysAgo ?? 3;
  axiosGetMock.mockImplementation((url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === STAGING_VERSION_URL) {
      if (options.stagingUnreachable) return Promise.reject(new Error('econnrefused'));
      return Promise.resolve({ status: 200, data: { sha: STAGING_SHA, version: '1.0.1', buildTime: daysAgo(1) } });
    }
    if (url === PROD_VERSION_URL) {
      if (options.productionUnreachable) return Promise.reject(new Error('econnrefused'));
      return Promise.resolve({ status: 200, data: { sha: FAKE_SHA, version: '1.0.1', buildTime: daysAgo(3) } });
    }
    if (url.includes('/journey_features')) {
      if (options.brain) return options.brain();
      const journeyId = config?.params?.journey_id;
      if (journeyId === LINE04_JOURNEY_ID) {
        return Promise.resolve({
          status: 200,
          data: [
            { id: 'gpb', name: 'GP-B 被动接待', status: 'planned', thickness: 'thin', kind: 'ability', updated_at: '2026-07-28T00:00:00Z' },
            { id: 'gpc', name: 'GP-C 主动触达', status: 'done', thickness: 'thin', kind: 'ability', updated_at: '2026-07-28T00:00:00Z' },
          ],
        });
      }
      return Promise.resolve({ status: 200, data: [] });
    }
    if (url.includes('/search/issues')) {
      if (options.searchFails) return Promise.reject(new Error('search rate limited'));
      return Promise.resolve({
        status: 200,
        data: { items: [{ number: 1487, title: 'fix(staff): wechat', html_url: 'https://github.com/x/y/pull/1487', state: 'closed', updated_at: '2026-07-28T00:00:00Z' }] },
      });
    }
    // 单条 commit 查询（fetchCommitDate，production sha 的真实提交时间）
    if (/\/commits\/[0-9a-z]+$/.test(url)) {
      return Promise.resolve({ status: 200, data: { commit: { author: { date: daysAgo(3) } } } });
    }
    // 分支提交列表：main + path，per_page:1（recent_commit）或 since（待发布变更清单）
    if (url.endsWith('/commits')) {
      const params = config?.params ?? {};
      if (params.since) return Promise.resolve({ status: 200, data: [] });
      if (recentCommitDaysAgo === null) return Promise.resolve({ status: 200, data: [] });
      return Promise.resolve({
        status: 200,
        data: [{
          sha: RECENT_SHA,
          html_url: `https://github.com/x/y/commit/${RECENT_SHA}`,
          commit: { message: 'feat: line04', author: { date: daysAgo(recentCommitDaysAgo) } },
        }],
      });
    }
    return Promise.resolve({ status: 200, data: { workflow_runs: [] } });
  });
}

describe('staff routes — line health 业务线健康看板', () => {
  beforeEach(async () => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    vi.stubEnv('CECELIA_BRAIN_URL', 'http://brain.test');
    vi.stubEnv('STAFF_HUB_GITHUB_REPO', 'perfectuser21/zenithjoy-workspace');
    axiosGetMock.mockReset();
    const { clearLineHealthCache } = await import('../../services/line-health');
    clearLineHealthCache();
    routeLineHealthMocks();
  });

  it('[BEHAVIOR] GET /api/staff/line-health 返回 line01/line02/line04 三条，三条线均已接入 Brain（原 Path 健康 line01/02 映射已合并进本页面）', async () => {
    const res = await request(app).get('/api/staff/line-health').set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((d: { line_key: string }) => d.line_key)).toEqual(['line01', 'line02', 'line04']);
    expect(res.body.source).toBe('product_map');
    expect(res.body.fallback_reason).toBeNull();
    // 2026-07-29 二次修正：staging/production 版本是三条线共享的部署摘要，只在顶层出现一次
    expect(res.body.deployment.staging.sha).toBe(STAGING_SHA);
    expect(res.body.deployment.production.sha).toBe(FAKE_SHA);

    const line01 = res.body.data[0];
    // 原 Path 健康 path1 映射：智能发布 journey c019cdeb
    expect(line01.journey_id).toBe('c019cdeb-d90b-4f8b-a658-ae333663ac35');
    expect(line01.journey_name).toBe('智能发布');
    expect(line01.maturity).toBe('thin');
    // 2026-07-29：总览卡片去掉 smoke 匹配后，availability 只反映 Brain 是否报错——
    // Brain 正常返回空数组（0 features）本身不是错误，应为 ready
    expect(line01.availability).toBe('ready');
    expect(line01.message).toBeNull();
    expect(line01.feature_counts).toEqual({ total: 0, done: 0, working: 0, planned: 0 });
    expect(Object.keys(line01).sort()).toEqual(
      ['availability', 'feature_counts', 'journey_id', 'journey_name', 'label', 'line_key', 'maturity', 'message', 'pending_changes'].sort()
    );
    expect(line01).not.toHaveProperty('path_key');
    expect(line01).not.toHaveProperty('status');

    const line02 = res.body.data[1];
    // 原 Path 健康 path2 映射：客户智能获客路径 journey afa6abca
    expect(line02.journey_id).toBe('afa6abca-53c0-4815-8594-b7fb81ca547f');
    expect(line02.journey_name).toBe('客户智能获客路径');
  });

  it('[BEHAVIOR] line04 journey_id 必须是整合后的"智能客服" journey，且能力计数来自 Brain', async () => {
    const res = await request(app).get('/api/staff/line-health').set('X-User-Email', 'staff@test.com');
    const line04 = res.body.data.find((d: { line_key: string }) => d.line_key === 'line04');
    expect(line04.journey_id).toBe(LINE04_JOURNEY_ID);
    expect(line04.journey_name).toBe('智能客服');
    expect(line04.feature_counts).toEqual({ total: 2, done: 1, working: 0, planned: 1 });
  });

  it('[BEHAVIOR] Brain 查询失败时三条线均 degraded（HTTP 仍 200）——三条线现在都真实接入 Brain，故障是全局性的', async () => {
    routeLineHealthMocks({ brain: () => Promise.reject(new Error('brain down')) });
    const res = await request(app).get('/api/staff/line-health').set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item.availability).toBe('degraded');
      expect(item.message).toContain('Brain:');
    }
  });

  it('[BEHAVIOR] product-map.json 读取失败时降级为兜底清单，source=fallback 且仍返回 3 条线', async () => {
    const spy = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });
    const res = await request(app).get('/api/staff/line-health').set('X-User-Email', 'staff@test.com');
    spy.mockRestore();

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('fallback');
    expect(typeof res.body.fallback_reason).toBe('string');
    expect(res.body.fallback_reason.length).toBeGreaterThan(0);
    expect(res.body.data).toHaveLength(3);
  });

  it('[BEHAVIOR] deployment 返回 staging/production 真实 /version + recent_commit（main 上按路径过滤的最近提交）+ related_prs 恒为数组', async () => {
    const res = await request(app)
      .get('/api/staff/line-health/line04/deployment')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.staging.sha).toBe(STAGING_SHA);
    expect(res.body.data.production.sha).toBe(FAKE_SHA);
    expect(res.body.data.production.version).toBe('1.0.1');

    expect(res.body.data.recent_commit.sha).toBe(RECENT_SHA);
    expect(Array.isArray(res.body.data.related_prs)).toBe(true);
    expect(res.body.data.related_prs[0].number).toBe(1487);
    expect(res.body.data).not.toHaveProperty('environments');
    expect(res.body.data).not.toHaveProperty('deploy_version');
  });

  it('[BEHAVIOR] apps/api /version 不可达时该环境 sha 为 null（不是抛异常/假数据），related_prs 独立降级为 []', async () => {
    routeLineHealthMocks({ stagingUnreachable: true, searchFails: true });
    const res = await request(app)
      .get('/api/staff/line-health/line04/deployment')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.staging).toEqual({ sha: null, version: null, build_time: null });
    expect(res.body.data.production.sha).toBe(FAKE_SHA);
    expect(res.body.data.related_prs).toEqual([]);
  });

  it('[BEHAVIOR] GitHub 数据 5 分钟缓存 — 同一业务线第二次 deployment 请求不再打 GitHub', async () => {
    await request(app).get('/api/staff/line-health/line04/deployment').set('X-User-Email', 'staff@test.com');
    const firstCount = axiosGetMock.mock.calls.length;
    expect(firstCount).toBeGreaterThan(0);

    await request(app).get('/api/staff/line-health/line04/deployment').set('X-User-Email', 'staff@test.com');
    expect(axiosGetMock.mock.calls.length).toBe(firstCount);
  });

  it('[BEHAVIOR] line01/line02（原 Path 健康路径）deployment/abilities 现在均 connected=true，不再落回未接入空态', async () => {
    const deploy = await request(app)
      .get('/api/staff/line-health/line01/deployment')
      .set('X-User-Email', 'staff@test.com');
    expect(deploy.status).toBe(200);
    expect(deploy.body.data.connected).toBe(true);
    expect(deploy.body.data.staging.sha).toBe(STAGING_SHA);
    expect(deploy.body.data.production.sha).toBe(FAKE_SHA);

    const abilities = await request(app)
      .get('/api/staff/line-health/line02/abilities')
      .set('X-User-Email', 'staff@test.com');
    expect(abilities.status).toBe(200);
    expect(abilities.body.data.connected).toBe(true);
    expect(Array.isArray(abilities.body.data.abilities)).toBe(true);
  });

  it('[BEHAVIOR] abilities 返回 Brain 全量能力清单，字段齐全', async () => {
    const res = await request(app)
      .get('/api/staff/line-health/line04/abilities')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.message).toBeNull();
    expect(res.body.data.abilities).toHaveLength(2);
    expect(res.body.data.abilities[0]).toEqual({
      id: 'gpb',
      name: 'GP-B 被动接待',
      status: 'planned',
      thickness: 'thin',
      kind: 'ability',
      updated_at: '2026-07-28T00:00:00Z',
    });
  });

  it('[BEHAVIOR] abilities 在 Brain 查询失败时返回 [] + "Brain:" 前缀 message，不 500', async () => {
    routeLineHealthMocks({ brain: () => Promise.reject(new Error('brain down')) });
    const res = await request(app)
      .get('/api/staff/line-health/line04/abilities')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.abilities).toEqual([]);
    expect(res.body.data.message).toContain('Brain:');
  });

  it('[BEHAVIOR] error path — 未知 lineKey 在 deployment/abilities 均返回 404，不静默 200 空数据', async () => {
    for (const suffix of ['deployment', 'abilities']) {
      const res = await request(app)
        .get(`/api/staff/line-health/bogus-line/${suffix}`)
        .set('X-User-Email', 'staff@test.com');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('[BEHAVIOR] error path — 三个 line-health 端点无认证头一律 403（staffGuard 不遗漏）', async () => {
    for (const path of [
      '/api/staff/line-health',
      '/api/staff/line-health/line04/deployment',
      '/api/staff/line-health/line04/abilities',
    ]) {
      const res = await request(app).get(path);
      expect(res.status).toBe(403);
    }
  });
});
