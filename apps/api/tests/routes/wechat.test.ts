/**
 * ws1 中台 /api/wechat 3 端点 zod 校验测试。
 *
 * 校验：
 *   1) POST /api/wechat/qr-bind 缺字段 → 400 + 错误含字段名 platform / agent_id
 *   2) POST /api/wechat/qr-bind 完整字段 → 200 + {task_id, status:'dispatched'}
 *   3) POST /api/wechat/draft-review-poll → 200 + {polled, dispatched}
 *   4) GET /api/wechat/draft-review-poll?task_id=不存在 UUID → 404
 *   5) POST /api/wechat/scheduler-tick → 200 + {generated, skipped}
 *
 * 用 supertest + mock pg pool（不真连 DB）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// vi.mock 的 factory 在 hoist 后执行，不能引用模块顶层 const，
// 用 vi.hoisted() 确保 mockQuery 在 mock factory 调用前已就绪
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// Mock pg connection — 各端点查询全部走 mock
vi.mock('../../src/db/connection', () => ({
  default: {
    query: mockQuery,
    connect: vi.fn(),
    end: vi.fn(),
  },
}));

// Mock task-dispatch（qr-bind 内部派 task）— 避免连 ws
vi.mock('../../src/services/task-dispatch', () => ({
  dispatchTask: vi.fn().mockResolvedValue(undefined),
}));

// Mock OpenRouter（poll/tick 内部如果触发 LLM 调用）
vi.mock('../../src/llm/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue({ content: 'mock' }),
}));

// 必须在 import app 之前 mock
import app from '../../src/app';

describe('ws1 POST /api/wechat/qr-bind — zod 校验', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    // 默认 INSERT 返回成功
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  });

  it('缺字段空 body → 400 + 错误信息含 platform 和 agent_id', async () => {
    const res = await request(app).post('/api/wechat/qr-bind').send({});
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/platform/);
    expect(body).toMatch(/agent_id/);
  });

  it('platform 不合法 → 400', async () => {
    const res = await request(app)
      .post('/api/wechat/qr-bind')
      .send({ platform: 'wechat_work', agent_id: 'agent-1' });
    expect(res.status).toBe(400);
  });

  it('完整字段 → 200 + {task_id, status:"dispatched"}', async () => {
    const res = await request(app)
      .post('/api/wechat/qr-bind')
      .send({ platform: 'wechat_personal', agent_id: 'agent-test-1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'dispatched',
    });
    expect(typeof res.body.task_id).toBe('string');
    expect(res.body.task_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

describe('ws1 GET/POST /api/wechat/draft-review-poll', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('POST 空 body → 200 + {polled, dispatched}', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).post('/api/wechat/draft-review-poll').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.polled).toBe('number');
    expect(typeof res.body.dispatched).toBe('number');
  });

  it('GET ?task_id=00000000-0000-0000-0000-000000000000 不存在 → 404', async () => {
    // 第一次 query: SELECT WHERE task_id = ... → 空
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app).get(
      '/api/wechat/draft-review-poll?task_id=00000000-0000-0000-0000-000000000000',
    );
    expect(res.status).toBe(404);
  });
});

describe('ws1 POST /api/wechat/scheduler-tick', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('空 body → 200 + {generated, skipped}', async () => {
    const res = await request(app).post('/api/wechat/scheduler-tick').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.generated).toBe('number');
    expect(Array.isArray(res.body.skipped)).toBe(true);
  });

  it('{force:true, customer:"X"} → 200 + 结构合法', async () => {
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ force: true, customer: '客户A' });
    expect(res.status).toBe(200);
    expect(typeof res.body.generated).toBe('number');
    expect(Array.isArray(res.body.skipped)).toBe(true);
  });
});

// ─── ws3 /api/wechat/draft-generate ─────────────────────────────────────────

vi.mock('../../src/services/wechat-draft', () => ({
  generateChatDraft: vi.fn(),
}));

import { generateChatDraft } from '../../src/services/wechat-draft';

describe('ws3 POST /api/wechat/draft-generate — zod 校验 + 转 service', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    (generateChatDraft as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('空 body → 400 + 错误含 sender / wechat_id / content', async () => {
    const res = await request(app).post('/api/wechat/draft-generate').send({});
    expect(res.status).toBe(400);
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/sender/);
    expect(body).toMatch(/wechat_id/);
    expect(body).toMatch(/content/);
  });

  it('完整字段 + 名单内 sender → 200 + {task_id, status:"pending_review"}', async () => {
    (generateChatDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 'pending_review',
      task_id: '11111111-1111-4111-8111-111111111111',
      draft_id: 'rec_x_1',
    });
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户A', wechat_id: 'test_a', content: '在吗' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'pending_review',
    });
    expect(typeof res.body.task_id).toBe('string');
    expect(generateChatDraft).toHaveBeenCalledWith(
      expect.objectContaining({ sender: '客户A', wechat_id: 'test_a', content: '在吗' }),
    );
  });

  it('body 带 mode:"auto" → 透传到 generateChatDraft（schema 必须保留 mode 字段）', async () => {
    // 根因：DraftGenerateSchema 未声明 mode，zod strip 掉 → auto 模式丢失，不返回 reply。
    (generateChatDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 'pending_review',
      task_id: '22222222-2222-4222-8222-222222222222',
      draft_id: 'rec_x_2',
      reply: '您好，在的',
    });
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户A', wechat_id: 'test_a', content: '在吗', mode: 'auto' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toBe('您好，在的');
    expect(generateChatDraft).toHaveBeenCalledWith(
      expect.objectContaining({ sender: '客户A', wechat_id: 'test_a', content: '在吗', mode: 'auto' }),
    );
  });

  it('body 带非法 mode → 400（schema enum 校验）', async () => {
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户A', wechat_id: 'test_a', content: '在吗', mode: 'bogus' });
    expect(res.status).toBe(400);
  });

  it('名单外 sender → 200 + {ok:false, reason:"not_in_whitelist"}（service 决定，路由透传）', async () => {
    (generateChatDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'not_in_whitelist',
    });
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '陌生人', wechat_id: 'unknown_x', content: '嗨' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'not_in_whitelist' });
  });
});

// ─── ws4 /api/wechat/scheduler-tick 真逻辑（generateMomentDraft 串联）─────────

vi.mock('../../src/services/wechat-draft', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    generateChatDraft: vi.fn(),
    generateMomentDraft: vi.fn(),
  };
});

import { generateMomentDraft } from '../../src/services/wechat-draft';

describe('ws4 POST /api/wechat/scheduler-tick — 真逻辑分发到 generateMomentDraft', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    (generateMomentDraft as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  it('{force:true, customer:"客户A"} 画像齐全 → {generated:1, skipped:[]}', async () => {
    (generateMomentDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 'pending_review',
      task_id: '22222222-2222-4222-8222-222222222222',
      draft_id: 'rec_schedule_x',
    });
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ force: true, customer: '客户A' });
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(1);
    expect(Array.isArray(res.body.skipped)).toBe(true);
    expect(res.body.skipped).toEqual([]);
    expect(generateMomentDraft).toHaveBeenCalledWith(
      expect.objectContaining({ customer: '客户A' }),
    );
  });

  it('画像缺失 customer → {generated:0, skipped:[{customer, reason:"profile_missing"}]}', async () => {
    (generateMomentDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'profile_missing',
    });
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ force: true, customer: '客户B' });
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(0);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ customer: '客户B', reason: 'profile_missing' }),
      ]),
    );
  });

  it('同日重复触发 → {generated:0, skipped:[{reason:"already_generated_today"}]}', async () => {
    (generateMomentDraft as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'already_generated_today',
    });
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ force: true, customer: '客户A' });
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(0);
    expect(res.body.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customer: '客户A',
          reason: 'already_generated_today',
        }),
      ]),
    );
  });

  it('未指定 customer → 拉 DB 已绑微信 sessions 名单，逐个调 generateMomentDraft', async () => {
    // mock SELECT agent_platform_sessions WHERE platform='wechat_personal' AND status='bound'
    // 返回 2 个客户
    mockQuery.mockResolvedValueOnce({
      rows: [{ customer: '客户A' }, { customer: '客户B' }],
      rowCount: 2,
    });
    (generateMomentDraft as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 'pending_review',
        task_id: '33333333-3333-4333-8333-333333333333',
        draft_id: 'rec_a',
      })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'profile_missing',
      });
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ force: false });
    expect(res.status).toBe(200);
    expect(res.body.generated).toBe(1);
    expect(res.body.skipped.length).toBe(1);
    expect(res.body.skipped[0]).toMatchObject({ reason: 'profile_missing' });
    expect((generateMomentDraft as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

// ─── ws5 /api/wechat/draft-review-poll 触发 pollOnce ─────────────────────────

vi.mock('../../src/services/feishu-poll', () => ({
  pollOnce: vi.fn(),
  startFeishuPoll: vi.fn(),
  stopFeishuPoll: vi.fn(),
}));

import { pollOnce } from '../../src/services/feishu-poll';

describe('ws5 POST /api/wechat/draft-review-poll — 触发 feishu-poll pollOnce', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    (pollOnce as unknown as ReturnType<typeof vi.fn>).mockReset();
    (pollOnce as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      polled: 1,
      dispatched: 1,
    });
  });

  it('POST 空 body 触发 pollOnce 一次（不带 task_id 走批量轮询）', async () => {
    const res = await request(app).post('/api/wechat/draft-review-poll').send({});
    expect(res.status).toBe(200);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(typeof res.body.polled).toBe('number');
    expect(typeof res.body.dispatched).toBe('number');
  });

  it('GET ?task_id=<exists> 单查模式 → 不触发 pollOnce', async () => {
    mockQuery.mockResolvedValue({
      rows: [
        {
          task_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          approval_status: 'pending_review',
          approval_source: null,
          content_draft: 'x',
          feishu_record_id: 'rec_x',
        },
      ],
      rowCount: 1,
    });
    const res = await request(app).get(
      '/api/wechat/draft-review-poll?task_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    expect(res.status).toBe(200);
    expect(pollOnce).not.toHaveBeenCalled();
  });
});
