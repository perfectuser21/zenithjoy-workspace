/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 排程看板读写面的路由守卫（task 3abb7f8c）
 *
 * 这里守的是「换个人构造请求会怎样」和「后台断了页面看到什么」，
 * 纯计算的部分在 services/__tests__/schedule-service.test.ts。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const brainQuery = vi.fn();
const localQuery = vi.fn();
let brainAvailable = true;

vi.mock('../../middleware/tenant-context', () => ({
  tenantContext: (req: any, _res: any, next: any) => {
    req.tenantId = req.headers['x-feishu-user-id'] || '';
    next();
  },
}));
vi.mock('../../middleware/simple-rate-limit', () => ({
  simpleRateLimit: () => (_req: any, _res: any, next: any) => next(),
  tenantKeyFn: () => 't',
}));
vi.mock('../../db/connection', () => ({ default: { query: (...a: any[]) => localQuery(...a) } }));
vi.mock('../../db/brain-pool', () => ({
  getBrainPool: () => (brainAvailable ? { query: (...a: any[]) => brainQuery(...a) } : null),
  BRAIN_CONNECT_TIMEOUT_MS: 8000,
}));

import { scheduleRouter } from '../schedule';

const MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHERS = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/schedule', scheduleRouter);
  return app;
}
const app = makeApp();

/** 本租户只有 MINE 这台设备 */
function localReturnsMyAgent() {
  localQuery.mockResolvedValue({
    // agents.agent_id 在中台的真实形态就是 phone-<序列号>（推帧器注册时写的）
    rows: [{ id: MINE, nickname: '金诺工作机', agent_id: 'phone-ANGYVB4227006983', status: 'online', last_seen: new Date() }],
  });
}

function futureWindow(minutes = 60) {
  const start = new Date(Date.now() + 30 * 60_000);
  return { window_start: start.toISOString(), window_end: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

beforeEach(() => {
  vi.clearAllMocks();
  brainAvailable = true;
  localReturnsMyAgent();
  brainQuery.mockResolvedValue({ rows: [] });
});

describe('鉴权', () => {
  it('没有租户上下文一律 401', async () => {
    const r = await request(app).get('/api/schedule');
    expect(r.status).toBe(401);
  });
});

describe('读面：读不到 ≠ 今天没活', () => {
  it('Brain 库未配置时 stale=true 且带原因（页面据此说"读取失败"）', async () => {
    brainAvailable = false;
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    expect(r.status).toBe(200);
    expect(r.body.data.stale).toBe(true);
    expect(r.body.data.stale_reason).toBeTruthy();
    expect(r.body.data.mock).toBe(false);
  });

  it('跨境读 Brain 抛错时同样 stale=true，不把异常伪装成空排期', async () => {
    brainQuery.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    expect(r.status).toBe(200);
    expect(r.body.data.stale).toBe(true);
    expect(r.body.data.stale_reason).toBeTruthy();
  });

  it('额度未上移前显式标 quotas_stale，不拿空数组冒充"额度为 0"', async () => {
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    expect(r.body.data.devices[0].quotas_stale).toBe(true);
  });

  it('读面吐给页面的 serial 必须是裸序列号——页面会拿它往下传到真机', async () => {
    // 生产事故：读面返回 phone-<序列号>，页面原样当 profile 传下去，
    // 工作机报 "unknown phone profile: phone-…" rc=2（单 03aa758d）。
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    expect(r.body.data.devices[0].serial).toBe('ANGYVB4227006983');
  });

  it('Brain 不可用的降级分支里，serial 同样是裸值（两条出口不能只修一条）', async () => {
    brainAvailable = false;
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    expect(r.body.data.devices[0].serial).toBe('ANGYVB4227006983');
  });

  it('取数按本租户 agent id 收窄（Brain 表无租户维度，必须中台自己拦）', async () => {
    await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    const [sql, params] = brainQuery.mock.calls[0];
    expect(sql).toMatch(/assigned_to\s*=\s*ANY/i);
    expect(params[0]).toEqual([MINE]);
  });

  it('别家设备的活即便被 Brain 返回也不会出现在结果里（双保险）', async () => {
    brainQuery.mockResolvedValueOnce({
      rows: [
        { id: 'j1', title: '我的活', task_type: 'device_job', status: 'queued', dept: '智能获客', assigned_to: MINE, due_at: '2026-09-21T14:00:00.000Z', row_version: 0, payload: {} },
        { id: 'j2', title: '别家的活', task_type: 'device_job', status: 'queued', dept: '智能获客', assigned_to: OTHERS, due_at: '2026-09-21T14:00:00.000Z', row_version: 0, payload: {} },
      ],
    });
    const r = await request(app).get('/api/schedule').set('x-feishu-user-id', 'tenant-1');
    const titles = r.body.data.devices.flatMap((d: any) => d.slots.map((s: any) => s.title));
    expect(titles).toEqual(['我的活']);
  });
});

describe('派单', () => {
  const base = { agent_id: MINE, dept: '智能获客', title: '触达一单' };

  it('对外动作窗口不足 30 分钟被拒（铁律 27bb6d1a）', async () => {
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow(20) });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('WINDOW_TOO_TIGHT');
  });

  it('对内动作（视频剪辑）允许精确到分', async () => {
    const start = new Date(Date.now() + 30 * 60_000).toISOString();
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'new-1', row_version: 0 }] });
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, dept: '视频剪辑', window_start: start, window_end: start });
    expect(r.status).toBe(201);
  });

  it('给别家设备派单表现为「不存在」而不是 403（403 会确认资源存在）', async () => {
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, agent_id: OTHERS, ...futureWindow() });
    expect(r.status).toBe(404);
  });

  it('窗口落在过去被拒', async () => {
    const past = new Date(Date.now() - 3 * 3600_000).toISOString();
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, window_start: past, window_end: new Date(Date.now() - 3600_000).toISOString() });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('WINDOW_PAST');
  });

  it('payload.serial 存的必须是 adb 看得到的裸序列号，不是中台的 phone- 形态', async () => {
    // 这是派单与真机之间唯一的握手。存成 phone-XXX 会和领单器发的裸序列号对不上，
    // 单子永远领不走 —— 页面上显示排着、谁也不动（生产实证：单 550326e5 卡 queued）。
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'new-1', row_version: 0 }] });
    await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow() });
    const insertCall = brainQuery.mock.calls.find(([sql]: any[]) => /INSERT INTO tasks/i.test(sql));
    const payload = JSON.parse(insertCall[1][5]);
    expect(payload.serial, 'serial 存成了中台形态，领单器认不出').toBe('ANGYVB4227006983');
  });

  it('建单必须标 trigger_source=manual —— 这是人派的活，不是系统自产的', async () => {
    // Brain 的 escalation「优雅降级」会在压力下暂停低优先级任务，但它只碰系统自产的
    // （trigger_source ∈ SYSTEM_AUTO_TRIGGER_SOURCES）。tasks.trigger_source 的库默认值
    // 恰恰是 'brain_auto'，不显式指定的话主理人手动派的活会被归进系统自产桶，
    // 被 escalation 静默暂停成 paused，领单器（只认 queued）从此永远领不到。
    // 生产实证：单 0f6f26e3 被 [Escalation] Paused，error_message=escalation_graceful_degrade。
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'new-1', row_version: 0 }] });
    await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow() });
    const insertCall = brainQuery.mock.calls.find(([sql]: any[]) => /INSERT INTO tasks/i.test(sql));
    expect(insertCall[0], 'INSERT 没写 trigger_source，会落进库默认的 brain_auto').toMatch(/trigger_source/i);
    expect(insertCall[1]).toContain('manual');
  });

  it('建单必须带 headed_manual=true —— 少了它这条活会被 tick 抢去当编码任务跑', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'new-1', row_version: 0 }] });
    await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow() });
    const insertCall = brainQuery.mock.calls.find(([sql]: any[]) => /INSERT INTO tasks/i.test(sql));
    expect(insertCall).toBeTruthy();
    const payload = JSON.parse(insertCall[1][5]);
    expect(payload.headed_manual).toBe(true);
    expect(payload.source).toBe('oneoff');
  });

  it('落点必须在窗口内（随机抖动不能跑到窗口外）', async () => {
    const w = futureWindow(45);
    brainQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 'new-1', row_version: 0 }] });
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1').send({ ...base, ...w });
    const t = Date.parse(r.body.data.planned_at);
    expect(t).toBeGreaterThanOrEqual(Date.parse(w.window_start));
    expect(t).toBeLessThanOrEqual(Date.parse(w.window_end));
  });

  it('同一幂等键重复提交只留一条（跨境超时重试不产生第二批）', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-1' }] });
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow(), idempotency_key: 'k-1' });
    expect(r.status).toBe(200);
    expect(r.body.data.deduped).toBe(true);
  });

  it('Brain 不可用时明确 503，不静默假装派成功', async () => {
    brainAvailable = false;
    const r = await request(app).post('/api/schedule/jobs').set('x-feishu-user-id', 'tenant-1')
      .send({ ...base, ...futureWindow() });
    expect(r.status).toBe(503);
  });
});

describe('改时间：乐观锁', () => {
  it('版本不匹配返回 409 并附当前值，绝不静默覆盖', async () => {
    brainQuery
      .mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'queued', row_version: 5 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await request(app).patch('/api/schedule/jobs/j1/time').set('x-feishu-user-id', 'tenant-1')
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 3 });
    expect(r.status).toBe(409);
    expect(r.body.current.row_version).toBe(5);
    expect(r.body.message).toMatch(/重试/);
  });

  it('已经开跑的活给出的是「已开跑」而不是「被人改过」（两种失败不能含糊）', async () => {
    brainQuery
      .mockResolvedValueOnce({ rows: [{ id: 'j1', status: 'in_progress', row_version: 5 }] })
      .mockResolvedValueOnce({ rows: [] });
    const r = await request(app).patch('/api/schedule/jobs/j1/time').set('x-feishu-user-id', 'tenant-1')
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 5 });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/in_progress/);
  });

  it('别家的活改时间表现为「不存在」', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [] });
    const r = await request(app).patch('/api/schedule/jobs/j9/time').set('x-feishu-user-id', 'tenant-1')
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 0 });
    expect(r.status).toBe(404);
  });

  it('改到过去被拒', async () => {
    const r = await request(app).patch('/api/schedule/jobs/j1/time').set('x-feishu-user-id', 'tenant-1')
      .send({ planned_at: new Date(Date.now() - 3600_000).toISOString(), row_version: 0 });
    expect(r.status).toBe(400);
  });
});

describe('取消：留痕不删', () => {
  it('取消走 UPDATE 标记而不是 DELETE（所有活必须留痕）', async () => {
    // 两次：第一次是取行做 read_only 判断，第二次才是真正的 UPDATE。
    // 老实现只查一次也不受影响 —— 反正只消费第一个 Once。
    brainQuery
      .mockResolvedValueOnce({ rows: [{ id: 'j1', row_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'j1', row_version: 2 }] });
    const r = await request(app).post('/api/schedule/jobs/j1/cancel').set('x-feishu-user-id', 'tenant-1').send({});
    expect(r.status).toBe(200);
    const [sql] = brainQuery.mock.calls.at(-1)!;
    expect(sql).toMatch(/UPDATE tasks/i);
    expect(sql).not.toMatch(/DELETE/i);
    expect(sql).toMatch(/cancelled/i);
  });

  it('已开跑的活取消不了，返回 409', async () => {
    brainQuery.mockResolvedValueOnce({ rows: [] });
    const r = await request(app).post('/api/schedule/jobs/j1/cancel').set('x-feishu-user-id', 'tenant-1').send({});
    expect(r.status).toBe(409);
  });
});

describe('只读行拒绝写操作', () => {
  beforeEach(() => {
    brainQuery.mockResolvedValue({
      rows: [{ id: 'brain-1', status: 'in_progress', row_version: 1,
               payload: { read_only: true, source: 'cron', serial: 'ANGYVB4227006983' } }],
    });
  });

  it('改时间：镜像行必须拒绝 —— CAS 对真机零作用，让人以为改了其实没改', async () => {
    const res = await request(app).patch('/api/schedule/jobs/brain-1/time')
      .set('X-Feishu-User-Id', 'u1')
      .send({ planned_at: new Date(Date.now() + 3600_000).toISOString(), row_version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('READ_ONLY_JOB');
  });

  it('取消：镜像行必须拒绝 —— 运营点了取消，手机照跑，这比看不见更坏', async () => {
    const res = await request(app).post('/api/schedule/jobs/brain-1/cancel')
      .set('X-Feishu-User-Id', 'u1').send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('READ_ONLY_JOB');
  });

  it('错误信息要说人话，告诉运营该去哪停，不能只甩错误码', async () => {
    const res = await request(app).post('/api/schedule/jobs/brain-1/cancel')
      .set('x-feishu-user-id', 'tenant-1').send({});
    expect(res.body.message).toContain('工作机');
    expect(res.body.message).toMatch(/cron|自发/);
  });
});
