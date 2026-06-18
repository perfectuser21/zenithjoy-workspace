/**
 * Line04 客服层多租户隔离（tenant scope）— regression（先红后绿，永久留 CI）
 *
 * 越权根因：客服读写路径（scheduler-tick 客户枚举 / draft-generate 写入）原本全量查，
 * 不带租户过滤 → 租户A 可能看到 / 处理租户B 的客户数据。
 *
 * 隔离链路：agent_platform_sessions.agent_id → zenithjoy.agents.id → agents.tenant_id。
 * tenant scope = JOIN agents ON agents.id = aps.agent_id WHERE agents.tenant_id = $当前租户。
 *
 * 验证方式：supertest + mock pg pool（repo 既有路由测试约定）。DB 是外部边界（可 mock），
 * 被测真实逻辑 = 「查询是否带 tenant scope」+「缺租户是否拒绝、不回退全量」。
 * 断言对象是 route 真实发给 pool.query 的 SQL 文本与绑定参数 → generator 不写真隔离 SQL 无法转绿。
 *
 * commit-1 RED；commit-2 GREEN。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// vi.mock factory 在 hoist 后执行，用 vi.hoisted 确保 mock 就绪
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock('../../src/db/connection', () => ({
  default: { query: mockQuery, connect: vi.fn(), end: vi.fn() },
}));
vi.mock('../../src/services/task-dispatch', () => ({
  dispatchTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/llm/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue({ content: 'mock' }),
}));

const { generateMomentDraftMock, generateChatDraftMock } = vi.hoisted(() => ({
  generateMomentDraftMock: vi.fn(),
  generateChatDraftMock: vi.fn(),
}));
vi.mock('../../src/services/wechat-draft', () => ({
  generateMomentDraft: generateMomentDraftMock,
  generateChatDraft: generateChatDraftMock,
}));

// 必须在 mock 之后 import app
import app from '../../src/app';

const TENANT_A = 'aaaaaaaa-1111-2222-3333-444444444444';
const TENANT_B = 'bbbbbbbb-1111-2222-3333-444444444444';

/** 找到客服客户枚举那次 DB 查询（FROM agent_platform_sessions） */
function findCustomerEnumCall(): unknown[] | undefined {
  return mockQuery.mock.calls.find((c) => /agent_platform_sessions/i.test(String(c[0])));
}

beforeEach(() => {
  mockQuery.mockReset();
  // 默认任何查询返回 1 个客户（含 customer 列），让枚举路径可继续
  mockQuery.mockResolvedValue({ rows: [{ customer: 'wxid_seed' }], rowCount: 1 });
  generateMomentDraftMock.mockReset();
  generateMomentDraftMock.mockResolvedValue({ ok: true });
  generateChatDraftMock.mockReset();
  generateChatDraftMock.mockResolvedValue({
    task_id: 't1',
    draft_id: 'd1',
    status: 'pending_review',
  });
});

describe('Line04 客服层多租户隔离 [BEHAVIOR]', () => {
  // ── Golden Path Step 1：以租户A 查客户列表 → 只命中 A ──
  it('租户A 客户枚举按 agents.tenant_id 过滤并绑定 A 参数', async () => {
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ tenant_id: TENANT_A });
    expect(res.status).toBe(200);

    const call = findCustomerEnumCall();
    expect(call, '应执行客户枚举查询').toBeTruthy();
    const sql = String(call![0]);
    const params = (call![1] ?? []) as unknown[];
    expect(sql, '客户枚举必须 JOIN agents 取 tenant').toMatch(/agents/i);
    expect(sql, '客户枚举必须按 tenant_id 过滤').toMatch(/tenant_id/i);
    expect(params, '必须绑定当前租户 A 的 tenant_id 参数').toContain(TENANT_A);
  });

  // ── Golden Path Step 2：以租户B 查 → 只命中 B，物理隔离不串 A ──
  it('租户B 客户枚举绑定 B 参数，绝不串到租户A', async () => {
    const res = await request(app)
      .post('/api/wechat/scheduler-tick')
      .send({ tenant_id: TENANT_B });
    expect(res.status).toBe(200);

    const call = findCustomerEnumCall();
    expect(call).toBeTruthy();
    const params = (call![1] ?? []) as unknown[];
    expect(params, '应绑定租户 B').toContain(TENANT_B);
    expect(params, '租户B 查询绝不能出现租户A 的 id').not.toContain(TENANT_A);
  });

  // ── Golden Path Step 4 + 边界：缺租户上下文 → 拒绝，绝不回退全量 ──
  it('缺租户上下文时拒绝（4xx）且绝不执行无 tenant_id 过滤的全量客户查询', async () => {
    const res = await request(app).post('/api/wechat/scheduler-tick').send({});
    expect(res.status, '缺租户必须拒绝，不回退全量').toBeGreaterThanOrEqual(400);

    const unscoped = mockQuery.mock.calls.find(
      (c) =>
        /agent_platform_sessions/i.test(String(c[0])) && !/tenant_id/i.test(String(c[0])),
    );
    expect(unscoped, '缺租户时绝不允许执行未带 tenant_id 过滤的客户枚举').toBeFalsy();
    expect(generateMomentDraftMock, '缺租户时不得处理任何客户').not.toHaveBeenCalled();
  });

  // ── Golden Path Step 3：draft-generate 写入路径带 tenant scope（缺租户拒绝） ──
  it('draft-generate 缺租户上下文时拒绝且绝不写入草稿', async () => {
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户X', wechat_id: 'wxid_x', content: '你好' });
    expect(res.status, '缺租户必须拒绝').toBeGreaterThanOrEqual(400);
    expect(generateChatDraftMock, '缺租户绝不写入草稿').not.toHaveBeenCalled();
  });

  // ── Golden Path Step 3 正路径：带租户上下文放行并把 scope 透传到写入 ──
  it('draft-generate 带租户上下文时放行并按当前租户写入', async () => {
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户X', wechat_id: 'wxid_x', content: '你好', tenant_id: TENANT_A });
    expect(res.status).toBe(200);
    expect(generateChatDraftMock, '带租户应放行写入').toHaveBeenCalled();
    const arg = generateChatDraftMock.mock.calls[0][0];
    expect(arg, 'generateChatDraft 必须收到当前租户 scope').toMatchObject({ tenant_id: TENANT_A });
  });

  // ── 生产 bug 修复（NO_TENANT_CONTEXT 全拒）：listen_chat 不传 tenant_id 只传 agent_id，
  //    中台从 agents.tenant_id 反查推导租户。agents.agent_id 是 text UNIQUE 列。 ──
  it('draft-generate 仅传 agent_id 时从 agents.tenant_id 推导租户并放行写入', async () => {
    // agents 反查命中 → 返回 tenant_id；其余查询走默认 mock
    mockQuery.mockImplementation((sql: string) => {
      if (/from\s+zenithjoy\.agents\s+where\s+agent_id/i.test(String(sql))) {
        return Promise.resolve({ rows: [{ tenant_id: TENANT_A }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [{ customer: 'wxid_seed' }], rowCount: 1 });
    });

    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户X', wechat_id: 'wxid_x', content: '你好', agent_id: 'agent-burner-1' });
    expect(res.status, 'agent_id 能推导出租户应放行').toBe(200);

    // 必须真按 agent_id 文本列查 agents 表
    const lookup = mockQuery.mock.calls.find((c) =>
      /from\s+zenithjoy\.agents\s+where\s+agent_id/i.test(String(c[0])),
    );
    expect(lookup, '应执行 agents.agent_id 反查 tenant').toBeTruthy();
    expect((lookup![1] ?? []) as unknown[], '反查必须绑定 agent_id').toContain('agent-burner-1');

    expect(generateChatDraftMock, '推导出租户后应放行写入').toHaveBeenCalled();
    const arg = generateChatDraftMock.mock.calls[0][0];
    expect(arg, '写入必须归属反查到的租户A').toMatchObject({ tenant_id: TENANT_A });
  });

  // ── 边界：agent_id 查不到对应 agent → 仍拒绝，绝不回退全量（保持隔离）──
  it('draft-generate agent_id 查不到 agent 时拒绝且绝不写入', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (/from\s+zenithjoy\.agents\s+where\s+agent_id/i.test(String(sql))) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      return Promise.resolve({ rows: [{ customer: 'wxid_seed' }], rowCount: 1 });
    });

    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({ sender: '客户X', wechat_id: 'wxid_x', content: '你好', agent_id: 'agent-unknown' });
    expect(res.status, 'agent_id 查不到必须拒绝').toBeGreaterThanOrEqual(400);
    expect(res.body.error).toBe('NO_TENANT_CONTEXT');
    expect(generateChatDraftMock, '查不到租户绝不写入').not.toHaveBeenCalled();
  });

  // ── 兼容：显式 tenant_id 与 agent_id 同传时，显式 tenant_id 优先（不触发反查）──
  it('draft-generate 显式 tenant_id 优先于 agent_id 反查', async () => {
    const res = await request(app)
      .post('/api/wechat/draft-generate')
      .send({
        sender: '客户X',
        wechat_id: 'wxid_x',
        content: '你好',
        tenant_id: TENANT_B,
        agent_id: 'agent-burner-1',
      });
    expect(res.status).toBe(200);
    const agentLookup = mockQuery.mock.calls.find((c) =>
      /from\s+zenithjoy\.agents\s+where\s+agent_id/i.test(String(c[0])),
    );
    expect(agentLookup, '显式 tenant_id 时不应触发 agents 反查').toBeFalsy();
    const arg = generateChatDraftMock.mock.calls[0][0];
    expect(arg, '显式 tenant_id 优先').toMatchObject({ tenant_id: TENANT_B });
  });
});
