/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * OpenClaw 信号桥·件2 — POST /api/devices/:agentId/actions
 *
 * 红线防护（prep-prd，全部 fail-closed）：
 *  1. 只走 internalAuth（无 license 路径）；production 且无 ZENITHJOY_INTERNAL_TOKEN → 503 拒服务
 *  2. 租户开关 remote_control_config：无行=默认开；DB 异常→503；disabled→403
 *     tenant 一律从 zenithjoy.agents.tenant_id 按 :agentId 推导，绝不信请求体
 *  3. action 白名单 8 个，未知→400
 *  4. 频控原子化：单条 INSERT...SELECT WHERE count<limit 写 pending 行；未插入=429；SQL 异常=503
 *  5. 契约硬语义：504=结果未知 outcome:'unknown'；409 DEVICE_BUSY；502 AGENT_DISCONNECTED；
 *     旧版 agent 快速失败 409 AGENT_TOO_OLD
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../db/connection', () => ({ default: { query: vi.fn() } }));
vi.mock('../../services/agent-registry', () => ({ agentRegistry: { get: vi.fn(), on: vi.fn() } }));
vi.mock('../../services/command-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/command-bridge')>();
  return { ...actual, commandBridge: { dispatchAndWait: vi.fn() } };
});

import pool from '../../db/connection';
import { agentRegistry } from '../../services/agent-registry';
import { commandBridge } from '../../services/command-bridge';
import devicesRouter from '../devices';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/devices', devicesRouter);
  return app;
}
const app = makeApp();

const AID = '22222222-2222-4222-8222-222222222222';
const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDEM = '99999999-9999-4999-8999-999999999999';

const entry = (version: string, capabilities: string[] = ['android']) => ({
  agentId: AID, meta: { version, capabilities, tenantId: TENANT }, busy: false,
});

interface DbOpts {
  agentRows?: unknown[] | 'error';
  config?: unknown[] | 'error';
  insert?: { rowCount: number } | 'error';
  existingMsg?: unknown[];
}
const insertCalls = () => (pool.query as any).mock.calls.filter((c: any[]) => /INSERT INTO zenithjoy\.device_command_log/i.test(c[0]));
const updateCalls = () => (pool.query as any).mock.calls.filter((c: any[]) => /UPDATE zenithjoy\.device_command_log/i.test(c[0]));

function mockDb(opts: DbOpts = {}) {
  (pool.query as any).mockImplementation(async (sql: string) => {
    if (/FROM zenithjoy\.agents/i.test(sql)) {
      if (opts.agentRows === 'error') throw new Error('agents db down');
      return { rows: opts.agentRows ?? [{ tenant_id: TENANT }] };
    }
    if (/remote_control_config/i.test(sql)) {
      if (opts.config === 'error') throw new Error('config db down');
      return { rows: opts.config ?? [] };
    }
    if (/INSERT INTO zenithjoy\.device_command_log/i.test(sql)) {
      if (opts.insert === 'error') throw new Error('log db down');
      return { rowCount: (opts.insert ?? { rowCount: 1 }).rowCount, rows: [] };
    }
    if (/SELECT .*FROM zenithjoy\.device_command_log/i.test(sql)) {
      return { rows: opts.existingMsg ?? [] };
    }
    if (/UPDATE zenithjoy\.device_command_log/i.test(sql)) {
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  });
}

const post = (body: Record<string, unknown> = { action: 'tap', x: 1, y: 2 }, agentId = AID) =>
  request(app).post(`/api/devices/${agentId}/actions`).send(body);

const okDispatch = (payload: Record<string, unknown> = { ok: true, foregroundPkg: 'com.x' }) =>
  (commandBridge.dispatchAndWait as any).mockResolvedValue(payload);
const rejectDispatch = (code: string) =>
  (commandBridge.dispatchAndWait as any).mockRejectedValue(Object.assign(new Error(code), { code }));

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.ZENITHJOY_INTERNAL_TOKEN;
  mockDb();
  (agentRegistry.get as any).mockReturnValue(entry('2.1.48'));
  okDispatch();
});
afterEach(() => { delete process.env.ZENITHJOY_INTERNAL_TOKEN; });

describe('入口守卫', () => {
  it('agentId 非 uuid → 400 INVALID_AGENT_ID，不碰 DB 不 dispatch', async () => {
    const r = await post(undefined, 'not-a-uuid');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('INVALID_AGENT_ID');
    expect(pool.query).not.toHaveBeenCalled();
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('production 且无 ZENITHJOY_INTERNAL_TOKEN → 503 SERVICE_UNAVAILABLE（internalAuth fail-open 必须包死）', async () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const r = await post();
      expect(r.status).toBe(503);
      expect(r.body.error).toBe('SERVICE_UNAVAILABLE');
      expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
    } finally { process.env.NODE_ENV = old; }
  });

  it('token 已配置且请求 token 错 → 401（只认 internalAuth，无 license 路径）', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    const r = await request(app).post(`/api/devices/${AID}/actions`)
      .set('X-Internal-Token', 'wrong').set('X-Agent-License', 'ZJ-X-AAAA1111')
      .send({ action: 'tap', x: 1, y: 2 });
    expect(r.status).toBe(401);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('token 已配置且正确 → 放行到执行', async () => {
    process.env.ZENITHJOY_INTERNAL_TOKEN = 'secret';
    const r = await request(app).post(`/api/devices/${AID}/actions`)
      .set('X-Internal-Token', 'secret').send({ action: 'device_info' });
    expect(r.status).toBe(200);
  });
});

describe('agent / 租户开关（fail-closed）', () => {
  it('agent 不存在 → 404 AGENT_NOT_FOUND', async () => {
    mockDb({ agentRows: [] });
    const r = await post();
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('AGENT_NOT_FOUND');
  });

  it('agent 查询 DB 异常 → 503（fail-closed）', async () => {
    mockDb({ agentRows: 'error' });
    const r = await post();
    expect(r.status).toBe(503);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('remote_control_config 查询异常 → 503（闸不能因故障放行）', async () => {
    mockDb({ config: 'error' });
    const r = await post();
    expect(r.status).toBe(503);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('enabled=false → 403 REMOTE_CONTROL_DISABLED', async () => {
    mockDb({ config: [{ enabled: false, actions_per_minute: 60, taps_per_minute: 30 }] });
    const r = await post();
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('REMOTE_CONTROL_DISABLED');
  });

  it('无配置行 → 默认开（Alex 拍板），走到执行', async () => {
    mockDb({ config: [] });
    const r = await post();
    expect(r.status).toBe(200);
  });
});

describe('action 白名单 + 请求体', () => {
  it('未知 action → 400 UNKNOWN_ACTION，不写 log 不 dispatch', async () => {
    const r = await post({ action: 'rm -rf /' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('UNKNOWN_ACTION');
    expect(insertCalls()).toHaveLength(0);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('缺 action → 400', async () => {
    const r = await post({});
    expect(r.status).toBe(400);
  });

  it('tenant 绝不从请求体取：body 里的 tenant_id 被无视，log 行用 agents 表推导的租户', async () => {
    const r = await post({ action: 'tap', x: 1, y: 2, tenant_id: 'evil-tenant' });
    expect(r.status).toBe(200);
    const params = insertCalls()[0][1] as unknown[];
    expect(params).toContain(TENANT);
    expect(params).not.toContain('evil-tenant');
  });

  it('idempotencyKey 非 uuid → 400', async () => {
    const r = await post({ action: 'tap', x: 1, y: 2, idempotencyKey: 'not-uuid' });
    expect(r.status).toBe(400);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });
});

describe('频控（原子 INSERT...SELECT，count 含 pending）', () => {
  it('窗口超限（INSERT 未插入且 msg_id 不存在）→ 429 RATE_LIMITED，不 dispatch', async () => {
    mockDb({ insert: { rowCount: 0 }, existingMsg: [] });
    const r = await post();
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('RATE_LIMITED');
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('频控 SQL 异常 → 503（fail-closed，绝不放行）', async () => {
    mockDb({ insert: 'error' });
    const r = await post();
    expect(r.status).toBe(503);
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('tap 走双闸：INSERT 参数带 actions_per_minute=60 和 taps_per_minute=30（默认值）', async () => {
    await post({ action: 'tap', x: 1, y: 2 });
    const params = insertCalls()[0][1] as unknown[];
    expect(params).toContain(60);
    expect(params).toContain(30);
    expect(params).toContain(true); // isTap 双闸开
  });

  it('screenshot 只走 actions_per_minute（防免费投屏计入总闸，taps 闸关闭）', async () => {
    await post({ action: 'screenshot' });
    const params = insertCalls()[0][1] as unknown[];
    expect(params).toContain(60);
    expect(params).toContain(false); // isTap=false
  });

  it('idempotencyKey 重发（msg_id 冲突未插入但行已存在）→ 不 429，复用行继续 dispatch', async () => {
    mockDb({ insert: { rowCount: 0 }, existingMsg: [{ msg_id: IDEM }] });
    const r = await post({ action: 'tap', x: 1, y: 2, idempotencyKey: IDEM });
    expect(r.status).toBe(200);
    expect((commandBridge.dispatchAndWait as any).mock.calls[0][4]).toBe(IDEM);
    expect(insertCalls()).toHaveLength(1); // 只试插一次，不重复 INSERT
  });
});

describe('版本检查（件1 能力判据）', () => {
  it('registry 无 entry → 503 NOT_CONNECTED（不白等）', async () => {
    (agentRegistry.get as any).mockReturnValue(undefined);
    const r = await post();
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('NOT_CONNECTED');
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('version=2.1.47 且无 cmd capability → 409 AGENT_TOO_OLD（件1 未 bump 版本，2.1.47 二义按无能力算）', async () => {
    (agentRegistry.get as any).mockReturnValue(entry('2.1.47'));
    const r = await post();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('AGENT_TOO_OLD');
    expect(commandBridge.dispatchAndWait).not.toHaveBeenCalled();
  });

  it('capabilities 含 cmd → 放行（逃生口，版本再低也认）', async () => {
    (agentRegistry.get as any).mockReturnValue(entry('2.1.40', ['android', 'cmd']));
    const r = await post();
    expect(r.status).toBe(200);
  });

  it('version=2.1.48 → 放行', async () => {
    (agentRegistry.get as any).mockReturnValue(entry('2.1.48'));
    const r = await post();
    expect(r.status).toBe(200);
  });
});

describe('dispatch 与回执映射', () => {
  it('成功回执 → 200 透传 {ok,errorCode,foregroundPkg,data} + outcome:completed，log UPDATE status=done', async () => {
    okDispatch({ inReplyTo: 'm1', ok: false, errorCode: 'COORD_OUT_OF_BOUNDS', foregroundPkg: 'com.x', data: { d: 1 } });
    const r = await post();
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data).toMatchObject({
      ok: false, errorCode: 'COORD_OUT_OF_BOUNDS', foregroundPkg: 'com.x', data: { d: 1 }, outcome: 'completed',
    });
    const upd = updateCalls();
    expect(upd.length).toBeGreaterThan(0);
    expect(upd[0][1]).toContain('done');
  });

  it('args 只透传业务字段：action/timeoutMs/idempotencyKey 不进 args；timeoutMs clamp 到下限', async () => {
    await post({ action: 'swipe', x1: 1, y1: 2, x2: 3, y2: 4, timeoutMs: 100, idempotencyKey: IDEM });
    const [agentId, action, args, timeoutMs, msgId] = (commandBridge.dispatchAndWait as any).mock.calls[0];
    expect(agentId).toBe(AID);
    expect(action).toBe('swipe');
    expect(args).toEqual({ x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(timeoutMs).toBe(3000);
    expect(msgId).toBe(IDEM);
  });

  it('缺 timeoutMs → 默认 35000', async () => {
    await post({ action: 'device_info' });
    expect((commandBridge.dispatchAndWait as any).mock.calls[0][3]).toBe(35000);
  });

  it('超时 → 504 DEVICE_TIMEOUT + outcome:unknown（结果未知非未执行），log UPDATE status=timeout', async () => {
    rejectDispatch('DEVICE_TIMEOUT');
    const r = await post();
    expect(r.status).toBe(504);
    expect(r.body.error).toBe('DEVICE_TIMEOUT');
    expect(r.body.outcome).toBe('unknown');
    expect(updateCalls()[0][1]).toContain('timeout');
  });

  it('在途占位冲突 → 409 DEVICE_BUSY', async () => {
    rejectDispatch('DEVICE_BUSY');
    const r = await post();
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('DEVICE_BUSY');
  });

  it('下发时不可达 → 503 NOT_CONNECTED', async () => {
    rejectDispatch('NOT_CONNECTED');
    const r = await post();
    expect(r.status).toBe(503);
    expect(r.body.error).toBe('NOT_CONNECTED');
  });

  it('等待中掉线 → 502 AGENT_DISCONNECTED', async () => {
    rejectDispatch('AGENT_DISCONNECTED');
    const r = await post();
    expect(r.status).toBe(502);
    expect(r.body.error).toBe('AGENT_DISCONNECTED');
  });
});
