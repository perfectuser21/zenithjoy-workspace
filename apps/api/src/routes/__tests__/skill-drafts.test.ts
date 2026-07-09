/**
 * skill-drafts 路由合同测试（Red 基线 — commit 1）
 *
 * 覆盖合同 [BEHAVIOR] 1-7：
 *   [BEHAVIOR] 1  — POST /api/staff/skill-drafts 创建草稿，返回 id + status=chatting
 *   [BEHAVIOR] 2  — GET /api/staff/skill-drafts/:id 返回历史 messages_json
 *   [BEHAVIOR] 3  — POST /api/staff/skill-drafts/:id/chat 响应 SSE (text/event-stream)
 *   [BEHAVIOR] 4  — SSH 超时时 /chat 发送 event: error 并关闭
 *   [BEHAVIOR] 5  — POST /api/staff/skill-drafts/:id/generate → status=done + job_id 写 DB
 *   [BEHAVIOR] 6  — skill_drafts 状态机四条路径（idle→chatting / chatting→generating / generating→done / generating→error）
 *   [BEHAVIOR] 7  — 所有端点无认证头时 403 FORBIDDEN
 *
 * sprint_dir: sprints/07091721-conversational-skill-creation
 * task_id: 8541996f-7bc1-43c5-aac7-cec5ef8cb398
 *
 * 这些测试在实现前**必须是 Red**（全部失败）。
 * 实现完成后这些测试应全部通过（Green）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Mock 基础依赖 ─────────────────────────────────────────────────────────────

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

// Mock child_process.spawn（用于 SSH 转发）
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import app from '../../app';

// ─── [BEHAVIOR] 7：staffGuard 集成 ────────────────────────────────────────────

describe('[BEHAVIOR] 7 — staffGuard 保护所有 skill-drafts 端点', () => {
  it('POST /api/staff/skill-drafts 无认证头返回 403', async () => {
    const res = await request(app)
      .post('/api/staff/skill-drafts')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('GET /api/staff/skill-drafts/:id 无认证头返回 403', async () => {
    const res = await request(app)
      .get('/api/staff/skill-drafts/some-draft-id');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('POST /api/staff/skill-drafts/:id/chat 无认证头返回 403', async () => {
    const res = await request(app)
      .post('/api/staff/skill-drafts/some-draft-id/chat')
      .send({ message: 'hello' });
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('POST /api/staff/skill-drafts/:id/generate 无认证头返回 403', async () => {
    const res = await request(app)
      .post('/api/staff/skill-drafts/some-draft-id/generate');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });
});

// ─── [BEHAVIOR] 1：创建草稿 ────────────────────────────────────────────────────

describe('[BEHAVIOR] 1 — POST /api/staff/skill-drafts 创建草稿', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('返回 HTTP 201，body 含 data.id（UUID）且 data.status === "chatting"', async () => {
    const res = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(res.body.data.status).toBe('chatting');
  });
});

// ─── [BEHAVIOR] 2：读取历史消息 ────────────────────────────────────────────────

describe('[BEHAVIOR] 2 — GET /api/staff/skill-drafts/:id 返回历史 messages_json', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('返回 HTTP 200，body 含 data.messages_json 数组', async () => {
    // Red 阶段：端点尚未实现，期望 404 或 500 → 测试失败（Red）
    // Green 阶段：实现后返回 { data: { messages_json: [...] } }
    const res = await request(app)
      .get('/api/staff/skill-drafts/test-draft-id-001')
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.messages_json)).toBe(true);
  });

  it(
    '断点续聊：创建草稿 → 发消息等 SSE done → GET → messages_json.length === 2',
    async () => {
      // 这个测试在 integration 层需要真实 DB 或 mock DB；Red 阶段直接失败
      // TODO: 实现时需要 mock DB 查询返回 messages_json
      expect(true).toBe(false); // Red：强制失败，等实现后删除这行
    }
  );
});

// ─── [BEHAVIOR] 3：SSE 流式回复 ───────────────────────────────────────────────

describe('[BEHAVIOR] 3 — POST /api/staff/skill-drafts/:id/chat SSE 流', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('响应 Content-Type 包含 text/event-stream', async () => {
    // mock SSH spawn 返回固定 stream-json 输出
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    const fakeProcess = {
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(fakeProcess);

    // 发出固定 SSE 输出后立即 emit close
    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from('{"type":"text","text":"hello"}\n')
      );
      (fakeStdout as NodeJS.EventEmitter).emit('end');
    }, 10);

    const res = await request(app)
      .post('/api/staff/skill-drafts/test-draft-id-001/chat')
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '你好' });

    // Red：端点未实现时此断言失败
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('至少收到 1 条 data: 行且最后收到 event: done', async () => {
    // Red：待实现后补充完整 SSE 响应断言
    expect(true).toBe(false); // Red
  });
});

// ─── [BEHAVIOR] 4：SSH 超时错误处理 ──────────────────────────────────────────

describe('[BEHAVIOR] 4 — SSH 超时时 /chat 发送 event: error', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('SSH 超时（mock 无输出）→ SSE 发送 event: error 并关闭连接', async () => {
    // mock SSH spawn：不发任何 stdout，让超时逻辑（10s）触发
    // 在测试中把超时缩短到 50ms 以加快跑速
    const { EventEmitter } = await import('events');
    const fakeProcess = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') setTimeout(() => cb(1), 50); // 50ms 后以非零退出码关闭
      }),
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(fakeProcess);

    // Red：端点未实现，此测试失败
    expect(true).toBe(false); // Red
  });
});

// ─── [BEHAVIOR] 5：生成 + 提交评测 ───────────────────────────────────────────

describe('[BEHAVIOR] 5 — POST /api/staff/skill-drafts/:id/generate 生成 + 提交', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    axiosPostMock.mockReset();
  });

  it('mock SSH skill-creator + mock upload → status=done + job_id 写入 DB', async () => {
    // mock: SSH skill-creator 成功（exit 0，stdout 返回 zip 路径）
    // mock: POST /api/staff/skill-eval/upload → { job_id: "gen-job-001" }
    axiosPostMock.mockResolvedValue({
      status: 200,
      data: { success: true, data: { job_id: 'gen-job-001' } },
    });

    const { EventEmitter } = await import('events');
    const fakeProcess = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') {
          // mock: skill-creator 成功并在 /tmp/test-skill.zip 产出 zip
          setTimeout(() => cb(0), 10);
        }
      }),
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(fakeProcess);

    const res = await request(app)
      .post('/api/staff/skill-drafts/test-draft-id-001/generate')
      .set('X-User-Email', 'staff@test.com');

    // Red：端点未实现
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('done');
    expect(res.body.data.job_id).toBe('gen-job-001');
  });
});

// ─── [BEHAVIOR] 6：skill_drafts 状态机 ────────────────────────────────────────

describe('[BEHAVIOR] 6 — skill_drafts 状态机四条路径（unit）', () => {
  // 注意：状态机逻辑应抽取为独立函数/类，便于 unit 测试（不依赖 HTTP）
  // Green 阶段：import { transitionStatus } from '../../services/skillDraftStateMachine'
  // 并用纯函数断言状态转移

  it('idle → chatting：创建草稿时 status 设为 chatting', () => {
    // Red：服务层模块尚未创建
    expect(true).toBe(false); // Red
  });

  it('chatting → generating：触发生成时 status 变为 generating', () => {
    // Red
    expect(true).toBe(false); // Red
  });

  it('generating → done：生成完成 + 提交成功时 status 变为 done', () => {
    // Red
    expect(true).toBe(false); // Red
  });

  it('generating → error：生成失败或 SSH 错误时 status 变为 error', () => {
    // Red
    expect(true).toBe(false); // Red
  });
});

// ─── [BEHAVIOR] 9（断点续聊集成）───────────────────────────────────────────────

describe('[BEHAVIOR] 9（=E2E-3）— 断点续聊集成', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('POST 建草稿 → POST chat（1 条消息）→ GET → messages_json.length === 2', async () => {
    // Red：完整链路需要真实 DB mock，实现时补全
    expect(true).toBe(false); // Red
  });
});
