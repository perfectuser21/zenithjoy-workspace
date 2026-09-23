/**
 * 对标分析接入积分扣减 — Task 9
 *
 * 两类断言：
 *   1. 源码断言（挂载结构）：createCreditCharger 是否接入、顺序是否在 tenantContext 之后。
 *      —— 只能防"没挂/顺序错"，防不住"挂了个空实现"。
 *   2. 行为断言：真正打一遍 HTTP 请求，mock 掉 credits.service 的 consume，验证扣减真的发生、
 *      余额不足时真的会拦住业务（不能钱没扣成却把活儿干了）。
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/app';
import pool from '../../src/db/connection';
import { auth } from '../../src/auth';
import { consume, InsufficientCreditsError } from '../../src/services/credits.service';
import { spawn } from 'child_process';

const src = readFileSync(join(__dirname, '../../src/routes/competitor-research.ts'), 'utf8');

describe('对标分析接入积分扣减（源码断言：挂载结构）', () => {
  it('POST /start 挂了 createCreditCharger("competitor_research")', () => {
    expect(src).toMatch(/createCreditCharger\(\s*['"]competitor_research['"]\s*\)/);
  });

  it('charger 必须挂在 tenantContext 之后（否则拿不到 req.tenantId），限流必须挂在最前面', () => {
    // 匹配到 handler 的 `=> {` 而不是第一个 `)`——simpleRateLimit(...) 自己就带一层
    // 括号，非贪婪匹配到第一个 `)` 会在 tenantContext/createCreditCharger 之前截断。
    const startLine = src.match(/router\.post\(\s*['"]\/start['"][\s\S]{0,400}?=>\s*\{/);
    expect(startLine).not.toBeNull();
    const seg = startLine![0];
    const rateLimitIdx = seg.indexOf('simpleRateLimit');
    const tenantIdx = seg.indexOf('tenantContext');
    const chargerIdx = seg.indexOf('createCreditCharger');
    expect(rateLimitIdx).toBeGreaterThan(-1);
    expect(tenantIdx).toBeGreaterThan(-1);
    expect(chargerIdx).toBeGreaterThan(-1);
    // CodeQL js/missing-rate-limiting：限流必须是第一个中间件，否则 tenantContext
    // 自己的 DB 查询（SELECT tenant_members）不受限流保护，照样会被判 high。
    expect(rateLimitIdx).toBeLessThan(tenantIdx);
    expect(chargerIdx).toBeGreaterThan(tenantIdx);
  });
});

// ──────────────────────────────────────────────────────────────────
// 行为断言：上面两条源码断言证明不了"扣减真的发生"——有人把
// createCreditCharger 换成空实现，那两条照样绿。这里真的打一遍 HTTP
// 请求，mock 掉 consume：
//   ①余额充足 → consume 真的被调用（参数正确）、请求真的走到 handler；
//   ②余额不足（InsufficientCreditsError）→ 402，请求真的没有到达
//     handler（子进程采集脚本不应被启动）。
// ──────────────────────────────────────────────────────────────────

vi.mock('../../src/db/connection', () => {
  const client = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    default: {
      query: vi.fn(),
      end: vi.fn(),
      connect: vi.fn(async () => client),
      __client: client,
    },
  };
});

vi.mock('../../src/auth', () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock('../../src/services/credits.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/credits.service')>();
  return {
    ...actual,
    consume: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

const mockQuery = pool.query as ReturnType<typeof vi.fn>;
const mockGetSession = auth.api.getSession as unknown as ReturnType<typeof vi.fn>;
const mockConsume = consume as ReturnType<typeof vi.fn>;
const mockSpawn = spawn as ReturnType<typeof vi.fn>;

const TENANT_A = 'cccccccc-1111-2222-3333-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockSpawn.mockReturnValue({
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  });
});

describe('POST /api/competitor-research/start（行为断言：真扣减）', () => {
  it('余额充足 → consume 被调用（参数正确）、请求走到 handler（200 + jobId）', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A, role: 'owner' }] }); // tenantContext 查 tenant_members
    mockConsume.mockResolvedValueOnce({ balance: 90, total_recharged: 100, total_consumed: 10 });

    const res = await request(app)
      .post('/api/competitor-research/start')
      .set('X-Feishu-User-Id', 'ou_user_a')
      .send({ topic: '测试选题' });

    expect(res.status).toBe(200);
    expect(typeof res.body.jobId).toBe('string');
    expect(mockConsume).toHaveBeenCalledTimes(1);
    expect(mockConsume).toHaveBeenCalledWith(TENANT_A, 10, 'competitor_research', undefined);
  });

  it('余额不足（InsufficientCreditsError）→ 402，请求没有到达 handler', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: TENANT_A, role: 'owner' }] }); // tenantContext 查 tenant_members
    mockConsume.mockRejectedValueOnce(new InsufficientCreditsError(10, 3));

    const res = await request(app)
      .post('/api/competitor-research/start')
      .set('X-Feishu-User-Id', 'ou_user_a')
      .send({ topic: '测试选题' });

    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(res.body.jobId).toBeUndefined();
    // 扣费失败必须拦住业务：handler 不能被跑到 —— 子进程采集脚本不应被启动
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
