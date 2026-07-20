/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Path 2 Sprint B-1 — agent-burner router unit tests
 *
 * Sprint B-1 architecture hotfix（2026-05-10）: 接入 tenantContext + agentContext
 * middleware，让 frontend 仅传 { account_label } 就能完成 qr-bind 派单。
 *
 * 覆盖：
 *  - [ARCH] POST /qr-bind 仅传 { account_label } + tenantId/agentId 由 middleware 注入 → 200
 *  - [ARCH] POST /qr-bind 没 agentContext（无 active agent）→ 401 NO_AGENT_CONTEXT
 *  - [ARCH] POST /crawl-comments 同模式 → 200
 *  - [BACK-COMPAT] POST /qr-bind 显式传 body { tenant_id, agent_id, account_label } → 200（现有 supertest）
 *
 * Mock pool + middleware（注入 req.tenantId / req.agentId）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../db/connection', () => ({
  default: { query: vi.fn() },
}));

// Mock tenantContext + agentContext middleware
vi.mock('../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'];
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
  tenantContextOptional: (req: any, _res: any, next: any) => {
    const t = req.headers['x-test-tenant-id'] || req.body?.tenant_id || '';
    if (typeof t === 'string' && t.length > 0) req.tenantId = t;
    next();
  },
}));
vi.mock('../middleware/agent-context', () => ({
  agentContext: (req: any, res: any, next: any) => {
    // 优先 body explicit
    if (req.body?.agent_id) {
      req.agentId = req.body.agent_id;
      return next();
    }
    const a = req.headers['x-test-agent-id'];
    if (typeof a === 'string' && a.length > 0) {
      req.agentId = a;
      return next();
    }
    res.status(401).json({
      success: false,
      error: { code: 'NO_AGENT_CONTEXT', message: 'no agent (mock)' },
      timestamp: new Date().toISOString(),
    });
  },
}));

// Mock services
vi.mock('../services/lead-writer', () => ({
  writeDmOutreachStatus: vi.fn().mockResolvedValue({ lead_write_status: 'success' }),
}));

import pool from '../db/connection';
import agentBurnerRouter from './agent-burner';

const TENANT_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const AGENT_UUID = '11111111-1111-1111-1111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agent/burner', agentBurnerRouter);
  return app;
}

describe('agent-burner router [ARCH agentContext]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('[ARCH] POST /qr-bind 仅传 account_label + middleware 注入 → 200 + task_id', async () => {
    // existing-burner check returns no rows → no conflict
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    // INSERT publish_tasks → returns task_id UUID
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '99999999-9999-9999-9999-999999999999' }],
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .set('X-Test-Agent-Id', AGENT_UUID)
      .send({ account_label: '装修小号B1' });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('99999999-9999-9999-9999-999999999999');

    // 验证 INSERT 用的是 middleware 注入的 AGENT_UUID
    const insertCall = vi.mocked(pool.query).mock.calls[1];
    expect(insertCall[1]).toContain(AGENT_UUID); // agent_id 参数
    expect(insertCall[1]).toContain(TENANT_UUID); // tenant_id 参数
  });

  it('[ARCH] POST /qr-bind 没 agent → 401 NO_AGENT_CONTEXT (middleware 拦)', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .send({ account_label: '装修小号B2' });

    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('NO_AGENT_CONTEXT');
    // pool 不应被 query
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });

  it('[ARCH] POST /crawl-comments 仅传 account_label + video_url → 200', async () => {
    // burner session check（飞书绑定门卫已移除，不再有第一次 Feishu DB 查询）
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any);
    // INSERT crawl task
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '88888888-8888-8888-8888-888888888888' }],
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/crawl-comments')
      .set('X-Test-Tenant-Id', TENANT_UUID)
      .set('X-Test-Agent-Id', AGENT_UUID)
      .send({
        account_label: '装修小号B1',
        video_url: 'https://www.douyin.com/video/7000',
      });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('88888888-8888-8888-8888-888888888888');

    // 验证 burner session check 用 AGENT_UUID（索引 0，飞书查询已删）
    const sessionCall = vi.mocked(pool.query).mock.calls[0];
    expect(sessionCall[1]).toEqual([AGENT_UUID, '装修小号B1']);
  });

  it('[BACK-COMPAT] POST /qr-bind 显式 body 传 tenant_id + agent_id → 200（既有 supertest 兼容）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '77777777-7777-7777-7777-777777777777' }],
    } as any);

    const app = buildApp();
    // 不设 X-Test-Tenant-Id / X-Test-Agent-Id 头 — 仅靠 body
    const r = await request(app)
      .post('/api/agent/burner/qr-bind')
      .send({
        tenant_id: TENANT_UUID,
        agent_id: AGENT_UUID,
        account_label: '装修小号C',
      });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe('77777777-7777-7777-7777-777777777777');
  });
});

// ── Path 2 抖音私信主动触达（dm_outreach）3 端点 ──
describe('agent-burner router [dm_outreach]', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('POST /dm-outreach 派单 → 200 + data 只含 task_id', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any) // burner session active
      .mockResolvedValueOnce({ rows: [{ app_token: 'bascn_x', table_id_leads: 'tbl_b1_leads' }] } as any) // feishu binding
      .mockResolvedValueOnce({ rows: [{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }] } as any); // INSERT

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach')
      .send({
        tenant_id: TENANT_UUID,
        agent_id: AGENT_UUID,
        account_label: '装修小号1',
        profile_url: 'https://www.douyin.com/user/MS4w1',
        message: '您好',
      });

    expect(r.status).toBe(200);
    expect(Object.keys(r.body.data).sort()).toEqual(['task_id']);
    expect(r.body.data.task_id).toBe('dddddddd-dddd-dddd-dddd-dddddddddddd');
    // INSERT 落 task_type=dm_outreach / platform=douyin
    const insertSql = vi.mocked(pool.query).mock.calls[2][0] as string;
    expect(insertSql).toMatch(/'dm_outreach'/);
    expect(insertSql).toMatch(/'douyin'/);
  });

  it('POST /dm-outreach 缺 profile_url → 400 MISSING_PROFILE_URL（不落库）', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach')
      .send({ tenant_id: TENANT_UUID, agent_id: AGENT_UUID, account_label: '号1', message: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_PROFILE_URL');
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });

  it('POST /dm-outreach 缺 message → 400 MISSING_MESSAGE', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach')
      .send({ tenant_id: TENANT_UUID, agent_id: AGENT_UUID, account_label: '号1', profile_url: 'https://x' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_MESSAGE');
  });

  it('POST /dm-outreach 无 active burner → 400 NO_BURNER_SESSION', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any); // 无 session
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach')
      .send({
        tenant_id: TENANT_UUID,
        agent_id: AGENT_UUID,
        account_label: '不存在的号',
        profile_url: 'https://x',
        message: 'x',
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('NO_BURNER_SESSION');
  });

  it('POST /dm-outreach tenant 未绑飞书 → 400 FEISHU_NOT_BOUND', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as any) // burner active
      .mockResolvedValueOnce({ rows: [] } as any); // 无 feishu binding
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach')
      .send({
        tenant_id: TENANT_UUID,
        agent_id: AGENT_UUID,
        account_label: '号1',
        profile_url: 'https://x',
        message: 'x',
      });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('FEISHU_NOT_BOUND');
  });

  it('POST /dm-outreach-result sent → task done + data schema 恰 4 键（无 session_disabled）', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{ tenant_id: TENANT_UUID, payload: { account_label: '号1', agent_id: AGENT_UUID, profile_url: 'https://x' } }],
      } as any) // task lookup
      .mockResolvedValueOnce({ rows: [{ app_token: 'bascn_x', table_id_leads: 'tbl_b1_leads' }] } as any) // binding
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // UPDATE task

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach-result')
      .send({ task_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', agent_id: AGENT_UUID, account_label: '号1', status: 'sent', profile_url: 'https://x' });

    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('sent');
    expect(r.body.data.lead_write_status).toBe('success');
    expect(Object.keys(r.body.data).sort()).toEqual(['feishu_bitable_url', 'lead_write_status', 'status', 'task_id']);
  });

  it('POST /dm-outreach-result failed+SESSION_EXPIRED → session_disabled=true + 停用该号', async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({
        rows: [{ tenant_id: TENANT_UUID, payload: { account_label: '号1', agent_id: AGENT_UUID, profile_url: 'https://x' } }],
      } as any) // task lookup
      .mockResolvedValueOnce({ rows: [{ app_token: 'bascn_x', table_id_leads: 'tbl_b1_leads' }] } as any) // binding
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any) // UPDATE session expired
      .mockResolvedValueOnce({ rowCount: 1, rows: [] } as any); // UPDATE task

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach-result')
      .send({ task_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', agent_id: AGENT_UUID, account_label: '号1', status: 'failed', error_code: 'SESSION_EXPIRED', profile_url: 'https://x' });

    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('failed');
    expect(r.body.data.session_disabled).toBe(true);
    // 第 3 个 query 是 UPDATE agent_platform_sessions expired
    const killSql = vi.mocked(pool.query).mock.calls[2][0] as string;
    expect(killSql).toMatch(/agent_platform_sessions/);
    expect(killSql).toMatch(/expired/);
  });

  it('POST /dm-outreach-result 未知 task → 404 TASK_NOT_FOUND', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/dm-outreach-result')
      .send({ task_id: '00000000-0000-0000-0000-000000000000', status: 'sent' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('TASK_NOT_FOUND');
  });

  it('GET /dm-tasks/:id 终态 → 200 done/sent', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
        status: 'done',
        response: { dm_status: 'sent', feishu_bitable_url: 'https://feishu.cn/base/bascn_x', profile_url: 'https://x', account_label: '号1' },
        created_at: '2026-06-13T00:00:00Z',
        updated_at: '2026-06-13T00:00:01Z',
      }],
    } as any);
    const app = buildApp();
    const r = await request(app).get('/api/agent/burner/dm-tasks/dddddddd-dddd-dddd-dddd-dddddddddddd');
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('done');
    expect(r.body.data.dm_status).toBe('sent');
    expect(typeof r.body.data.feishu_bitable_url).toBe('string');
  });

  it('GET /dm-tasks/:id 未知 → 404 NO_DM_TASK', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    const app = buildApp();
    const r = await request(app).get('/api/agent/burner/dm-tasks/00000000-0000-0000-0000-000000000000');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NO_DM_TASK');
  });
});

describe('GET /sessions — tenant 从 session 解析，不信 query [BEHAVIOR]', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('带 x-test-tenant-id → 200，pool 用该 tenant 查（不用 query）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ account_label: 'live101942', role: 'burner', status: 'active', bound_at: null, created_at: null, account_nickname: null }] } as any);
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent/burner/sessions?tenant_id=current')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.status).toBe(200);
    expect(res.body?.data?.sessions?.[0]?.account_label).toBe('live101942');
    // 关键：pool 拿的是 session tenant，不是 query 的 'current'
    const calledWith = vi.mocked(pool.query).mock.calls[0][1];
    expect(calledWith).toContain('4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(JSON.stringify(calledWith)).not.toContain('current');
  });

  it('无 tenant 上下文（只带 ?tenant_id=current）→ 401，绝不崩/不拿 current 查', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/agent/burner/sessions?tenant_id=current');
    expect(res.status).toBe(401);
    expect(res.body?.error?.code).toBe('NO_TENANT');
    expect(vi.mocked(pool.query)).not.toHaveBeenCalled();
  });

  it('pool 抛错 → 500 JSON（try/catch 兜，不抛崩进程）', async () => {
    vi.mocked(pool.query).mockRejectedValueOnce(new Error('invalid input syntax for type uuid'));
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent/burner/sessions')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.status).toBe(500);
    expect(res.body?.success).toBe(false);
  });

  // 方案 D：Dashboard 采集任务弹窗要能显示"绑定机器名"，返回结构须带 hostname/nickname
  it('返回结构带 hostname + nickname（Dashboard 显示绑定机器名要用）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        account_label: 'live101942', role: 'burner', status: 'active',
        bound_at: null, created_at: null, account_nickname: null,
        hostname: 'ROG-PC', nickname: '西安ROG',
      }],
    } as any);
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent/burner/sessions')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.body?.data?.sessions?.[0]?.hostname).toBe('ROG-PC');
    expect(res.body?.data?.sessions?.[0]?.nickname).toBe('西安ROG');
    const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(sql).toMatch(/a\.hostname/);
    expect(sql).toMatch(/a\.nickname/);
  });

  it('返回结构带 device_type（区分Web小号/安卓设备账号 — decision 8dbe91ee）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{
        account_label: 'live101942', role: 'burner', status: 'active',
        bound_at: null, created_at: null, account_nickname: null,
        hostname: 'ROG-PC', nickname: '西安ROG', device_type: 'android',
      }],
    } as any);
    const app = buildApp();
    const res = await request(app)
      .get('/api/agent/burner/sessions')
      .set('x-test-tenant-id', '4807edc7-da2a-4e8d-9223-31f4d25c12c6');
    expect(res.body?.data?.sessions?.[0]?.device_type).toBe('android');
    const sql = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(sql).toMatch(/s\.device_type/);
  });
});

// ── Regression: qr-bind-result agent_id=null crash (#1004) ──
describe('agent-burner router [qr-bind-result agent_id fallback]', () => {
  const TASK_UUID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('[REGRESSION] qr-bind-result body 无 agent_id → 从 task payload 兜底 → 200 不 crash', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ payload: { account_label: '测试1', agent_id: AGENT_UUID, tenant_id: TENANT_UUID } }],
    } as any);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind-result')
      .send({
        task_id: TASK_UUID,
        qr_login: 'success',
        cookie_local_path: 'C:\\sessions\\测试1.json',
        account_nickname: '测试账号',
      });

    expect(r.status).toBe(200);
    expect(r.body.data.task_id).toBe(TASK_UUID);
    const insertCall = vi.mocked(pool.query).mock.calls[1];
    expect(insertCall[1]?.[0]).toBe(AGENT_UUID);
  });

  it('[REGRESSION] qr-bind-result body 无 agent_id 且 payload 也无 → 400 不 crash', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ payload: { account_label: '测试2' } }],
    } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/qr-bind-result')
      .send({ task_id: TASK_UUID, qr_login: 'success' });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_AGENT_ID');
    expect(vi.mocked(pool.query).mock.calls.length).toBe(1);
  });
});

// ── account-scan-result — Line02 Step7 账号扫描结果写回 agent_platform_sessions ──
// bugfix（cp-0720073537）：闭环 publish_tasks——手动触发场景(Task 2 新代码路径)request_id
// 对应真实 queued 行时须推进到 done/failed，否则 getQueuedTasks() 永远重复派发同一行，
// 手机每 ~30s 重扫一次账号，无限循环。内部定时循环(runAccountScanLoop)生成的 requestId
// 从未写库，查无该行时必须优雅跳过（不能 404），保持既有上报流程不变。
describe('POST /account-scan-result — 账号扫描结果写回', () => {
  const TASK_UUID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
  });

  it('ok=true + account_ids 非空 + request_id 非 UUID 格式（内部定时循环场景 "scan-abc123"）→ 不查询 publish_tasks，每个昵称 upsert 一行 agent_platform_sessions，不报错', async () => {
    // 非 UUID 格式的 request_id 应在查库前就被挡下——不再有 SELECT publish_tasks 调用，
    // 只剩每个昵称一次 upsert。
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: 'scan-abc123', // 内部循环生成的 requestId，非 UUID，从未写库
        ok: true,
        stale: false,
        account_ids: ['大湖', '秦军餐饮'],
      });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(2);
    const calls = vi.mocked(pool.query).mock.calls;
    // 只有两条 upsert，没有 publish_tasks 相关查询
    expect(calls.length).toBe(2);
    expect(calls.every((c) => !/publish_tasks/i.test(String(c[0])))).toBe(true);
    expect(calls[0][0]).toMatch(/agent_platform_sessions/);
    expect(calls[0][1]).toEqual([AGENT_UUID, '大湖']);
    expect(calls[1][1]).toEqual([AGENT_UUID, '秦军餐饮']);
  });

  it('非 UUID request_id（真实内部定时循环格式 "scan-<base36>"，AgentService.kt runAccountScanLoop）→ 绝不对 publish_tasks 发起 SELECT（否则真实 Postgres 会因 22P02 invalid UUID syntax 崩溃挂死请求），200 且 session 正常写入', async () => {
    // 模拟真实 Postgres 行为：id 是 UUID 列，若代码真的拿非 UUID 字符串去查 publish_tasks，
    // 会抛 22P02，而不是像旧测试那样天真地 mock 成 rows:[]。这个 mock 会让任何触碰
    // publish_tasks 的查询直接抛错——只有代码在查库前就用 UUID_RE 挡掉非法格式的 request_id，
    // 这个测试才能通过。
    vi.mocked(pool.query).mockImplementation(async (sql: any) => {
      if (/publish_tasks/i.test(String(sql))) {
        const err: any = new Error('invalid input syntax for type uuid: "scan-1a2b3c4d"');
        err.code = '22P02';
        throw err;
      }
      return { rows: [] };
    });

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: 'scan-1a2b3c4d', // AgentService.kt: "scan-${System.currentTimeMillis().toString(36)}"
        ok: true,
        account_ids: ['大湖'],
      });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(1);
    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.some((c) => /publish_tasks/i.test(String(c[0])))).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatch(/agent_platform_sessions/);
  });

  it('request_id 对应真实 queued publish_tasks 行 + ok:true → 行更新为 status=done', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any); // SELECT publish_tasks
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any); // upsert + UPDATE

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: TASK_UUID,
        ok: true,
        account_ids: ['大湖'],
      });

    expect(r.status).toBe(200);
    const calls = vi.mocked(pool.query).mock.calls;
    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.publish_tasks/i.test(String(c[0])));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual([TASK_UUID, 'done', expect.any(String)]);
  });

  it('request_id 对应真实 queued publish_tasks 行 + ok:false → 行更新为 status=failed', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any); // SELECT publish_tasks

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: TASK_UUID,
        ok: false,
        account_ids: [],
      });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(0);
    const calls = vi.mocked(pool.query).mock.calls;
    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.publish_tasks/i.test(String(c[0])));
    expect(updateCall).toBeTruthy();
    expect(updateCall![1]).toEqual([TASK_UUID, 'failed', expect.any(String)]);
  });

  it('ok:false + error_code 存在 → response 落库带上 error_code（诊断真机失败原因必需字段）', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'queued' }] } as any); // SELECT publish_tasks

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: TASK_UUID,
        ok: false,
        account_ids: [],
        error_code: 'OPEN_PANEL_FAILED',
      });

    expect(r.status).toBe(200);
    const calls = vi.mocked(pool.query).mock.calls;
    const updateCall = calls.find((c) => /UPDATE\s+zenithjoy\.publish_tasks/i.test(String(c[0])));
    expect(updateCall).toBeTruthy();
    const responseJson = JSON.parse(updateCall![1][2] as string);
    expect(responseJson.error_code).toBe('OPEN_PANEL_FAILED');
    expect(responseJson.ok).toBe(false);
  });

  it('request_id 对应行已是终态 done → 幂等短路，不重复写 agent_platform_sessions / publish_tasks', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'done' }] } as any); // SELECT publish_tasks

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({
        agent_id: AGENT_UUID,
        request_id: TASK_UUID,
        ok: true,
        account_ids: ['大湖'],
      });

    expect(r.status).toBe(200);
    expect(r.body.data.idempotent).toBe(true);
    // 仅那一次 SELECT，没有后续 upsert / UPDATE
    expect(vi.mocked(pool.query).mock.calls.length).toBe(1);
  });

  it('request_id 对应行已是终态 failed → 幂等短路', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [{ status: 'failed' }] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ agent_id: AGENT_UUID, request_id: TASK_UUID, ok: true, account_ids: ['大湖'] });

    expect(r.status).toBe(200);
    expect(r.body.data.idempotent).toBe(true);
    expect(vi.mocked(pool.query).mock.calls.length).toBe(1);
  });

  it('request_id 缺失（旧客户端 / 边界场景）→ 不报错，跳过 publish_tasks 查询与更新，agent_platform_sessions 写入照常', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ agent_id: AGENT_UUID, ok: true, account_ids: ['大湖'] });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(1);
    const calls = vi.mocked(pool.query).mock.calls;
    // 没有 request_id → 不应有任何 SELECT/UPDATE publish_tasks 查询，只有 1 条 upsert
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toMatch(/agent_platform_sessions/);
  });

  it('ok=false → 不写 agent_platform_sessions，200 返回 written=0', async () => {
    // request_id='req-2' 非 UUID 格式 → 不会触发任何 publish_tasks 查询
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ agent_id: AGENT_UUID, request_id: 'req-2', ok: false, account_ids: [] });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(0);
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });

  it('account_ids 为空数组 → 不写 agent_platform_sessions，200 返回 written=0', async () => {
    // request_id='req-3' 非 UUID 格式 → 不会触发任何 publish_tasks 查询
    vi.mocked(pool.query).mockResolvedValue({ rows: [] } as any);

    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ agent_id: AGENT_UUID, request_id: 'req-3', ok: true, account_ids: [] });

    expect(r.status).toBe(200);
    expect(r.body.data.written).toBe(0);
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });

  it('缺 agent_id → 400 MISSING_AGENT_ID，不查询 publish_tasks', async () => {
    const app = buildApp();
    const r = await request(app)
      .post('/api/agent/burner/account-scan-result')
      .send({ request_id: 'req-4', ok: true, account_ids: ['大湖'] });

    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MISSING_AGENT_ID');
    expect(vi.mocked(pool.query).mock.calls.length).toBe(0);
  });
});
