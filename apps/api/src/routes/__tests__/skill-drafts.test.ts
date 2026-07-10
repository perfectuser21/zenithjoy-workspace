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
      const { EventEmitter } = await import('events');
      const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
      const fakeProcess = {
        stdout: fakeStdout,
        stderr: new EventEmitter(),
        on: vi.fn(),
        kill: vi.fn(),
      };
      spawnMock.mockReturnValue(fakeProcess);

      const createRes = await request(app)
        .post('/api/staff/skill-drafts')
        .set('X-User-Email', 'staff@test.com')
        .send({});
      const draftId: string = createRes.body.data.id;

      setTimeout(() => {
        (fakeStdout as NodeJS.EventEmitter).emit(
          'data',
          Buffer.from('{"type":"assistant","session_id":"real-session-1","message":{"content":[{"type":"text","text":"好的，收到"}]}}\n')
        );
        (fakeStdout as NodeJS.EventEmitter).emit('end');
      }, 10);

      await request(app)
        .post(`/api/staff/skill-drafts/${draftId}/chat`)
        .set('X-User-Email', 'staff@test.com')
        .send({ message: '帮我做一个日报skill' });

      const getRes = await request(app)
        .get(`/api/staff/skill-drafts/${draftId}`)
        .set('X-User-Email', 'staff@test.com');

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.messages_json.length).toBe(2);
      expect(getRes.body.data.messages_json[0].role).toBe('user');
      expect(getRes.body.data.messages_json[1].role).toBe('assistant');
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
        Buffer.from('{"type":"assistant","session_id":"real-session-hello","message":{"content":[{"type":"text","text":"hello"}]}}\n')
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
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    const fakeProcess = {
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(fakeProcess);

    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from('{"type":"assistant","session_id":"real-session-hello","message":{"content":[{"type":"text","text":"hello"}]}}\n')
      );
      (fakeStdout as NodeJS.EventEmitter).emit('end');
    }, 10);

    const res = await request(app)
      .post('/api/staff/skill-drafts/test-draft-id-002/chat')
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '你好' });

    expect(res.text).toContain('data:');
    expect(res.text).toContain('event: done');
  });
});

// ─── [BEHAVIOR] 11：真实会话生命周期（首条消息不传 --resume，避免"会话不存在"）───

describe('[BEHAVIOR] 11 — 真实 claude CLI 会话生命周期', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    spawnMock.mockReset();
  });

  it('首条消息（草稿无 session_id）不传 --resume，让 claude 自己开新会话', async () => {
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValue({
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;

    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"new-real-session-xyz","message":{"content":[{"type":"text","text":"你好"}]}}\n'
        )
      );
      (fakeStdout as NodeJS.EventEmitter).emit('end');
    }, 10);

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '第一条消息' });

    // ssh 远程命令现在拼成一条字符串传（防 shell 元字符解析问题），
    // 断言改成在这条字符串里找子串
    const sshArgs = spawnMock.mock.calls[0][1] as string[];
    const remoteCmd = sshArgs[1];
    expect(remoteCmd).not.toContain('--resume');
    expect(remoteCmd).toContain('--verbose');
  });

  it('第二条消息（草稿已有 session_id）传 --resume 续接同一会话', async () => {
    const { EventEmitter } = await import('events');
    const fakeStdout1 = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValueOnce({
      stdout: fakeStdout1,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;

    setTimeout(() => {
      (fakeStdout1 as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"established-session-1","message":{"content":[{"type":"text","text":"好的"}]}}\n'
        )
      );
      (fakeStdout1 as NodeJS.EventEmitter).emit('end');
    }, 10);

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '第一条消息' });

    const fakeStdout2 = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValueOnce({
      stdout: fakeStdout2,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });

    setTimeout(() => {
      (fakeStdout2 as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"established-session-1","message":{"content":[{"type":"text","text":"继续说"}]}}\n'
        )
      );
      (fakeStdout2 as NodeJS.EventEmitter).emit('end');
    }, 10);

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '第二条消息' });

    const secondCallArgs = spawnMock.mock.calls[1][1] as string[];
    const secondRemoteCmd = secondCallArgs[1];
    expect(secondRemoteCmd).toContain('--resume');
    expect(secondRemoteCmd).toContain('established-session-1');
  });

  it('死会话（--resume 时 is_error 且报"会话不存在"）自动清session_id重试一次，员工看不到报错', async () => {
    const { EventEmitter } = await import('events');

    // 第一次带 session_id 起会话
    const fakeStdout0 = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValueOnce({
      stdout: fakeStdout0,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });
    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;
    setTimeout(() => {
      (fakeStdout0 as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"dead-session-abc","message":{"content":[{"type":"text","text":"好的"}]}}\n'
        )
      );
      (fakeStdout0 as NodeJS.EventEmitter).emit('end');
    }, 10);
    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '第一条消息' });

    // 第二条消息：--resume dead-session-abc 失败（会话已死），应自动清session_id重试
    const fakeStdout1 = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValueOnce({
      stdout: fakeStdout1,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });
    setTimeout(() => {
      (fakeStdout1 as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"result","is_error":true,"errors":["No conversation found with session ID: dead-session-abc"]}\n'
        )
      );
      (fakeStdout1 as NodeJS.EventEmitter).emit('end');
    }, 10);

    // 重试的第二次 spawn（不带 --resume）真的回复了
    const fakeStdout2 = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValueOnce({
      stdout: fakeStdout2,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });
    setTimeout(() => {
      (fakeStdout2 as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"fresh-session-xyz","message":{"content":[{"type":"text","text":"重新开始"}]}}\n'
        )
      );
      (fakeStdout2 as NodeJS.EventEmitter).emit('end');
    }, 30);

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '第二条消息' });

    // 员工看不到任何报错，只看到重试后的真实回复
    expect(res.text).not.toContain('event: error');
    expect(res.text).toContain('重新开始');
    expect(res.text).toContain('event: done');

    // 第三次 spawn（重试那次）确实没传 --resume
    const retrySpawnArgs = spawnMock.mock.calls[2][1] as string[];
    expect(retrySpawnArgs[1]).not.toContain('--resume');
  });

  it('回归：stdout end 和 process close 都真实触发时，assistant 回复只写入 messages_json 一次（不重复）', async () => {
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    let closeHandler: ((code: number | null) => void) | undefined;
    spawnMock.mockReturnValue({
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'close') closeHandler = cb as (code: number | null) => void;
      }),
      kill: vi.fn(),
    });

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;

    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"assistant","session_id":"dup-check-session","message":{"content":[{"type":"text","text":"只应该出现一次"}]}}\n'
        )
      );
      // 真实场景里 stdout 'end' 和 child 'close' 都会各自触发一次——都手动模拟
      (fakeStdout as NodeJS.EventEmitter).emit('end');
      closeHandler?.(0);
    }, 10);

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '你好' });

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');

    const assistantMessages = (getRes.body.data.messages_json as Array<{ role: string }>).filter(
      (m) => m.role === 'assistant'
    );
    expect(assistantMessages.length).toBe(1);
  });

  it('真实 result 事件 is_error=true（如"会话不存在"/认证过期）→ event: error，不当成功空回复处理', async () => {
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    spawnMock.mockReturnValue({
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    });

    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from(
          '{"type":"result","is_error":true,"errors":["No conversation found with session ID: xxx"]}\n'
        )
      );
      (fakeStdout as NodeJS.EventEmitter).emit('end');
    }, 10);

    const res = await request(app)
      .post('/api/staff/skill-drafts/test-draft-error/chat')
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '你好' });

    expect(res.text).toContain('event: error');
    expect(res.text).not.toContain('event: done');
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

    const res = await request(app)
      .post('/api/staff/skill-drafts/test-draft-id-003/chat')
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '你好' });

    expect(res.text).toContain('event: error');
    expect(res.text).toContain('AI 暂时连不上，稍后重试');
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
  it('idle → chatting：创建草稿时 status 设为 chatting', async () => {
    const { transition } = await import('../../services/skillDraftStateMachine');
    expect(transition('idle', 'CREATE')).toBe('chatting');
  });

  it('chatting → generating：触发生成时 status 变为 generating', async () => {
    const { transition } = await import('../../services/skillDraftStateMachine');
    expect(transition('chatting', 'GENERATE')).toBe('generating');
  });

  it('generating → done：生成完成 + 提交成功时 status 变为 done', async () => {
    const { transition } = await import('../../services/skillDraftStateMachine');
    expect(transition('generating', 'DONE')).toBe('done');
  });

  it('generating → error：生成失败或 SSH 错误时 status 变为 error', async () => {
    const { transition } = await import('../../services/skillDraftStateMachine');
    expect(transition('generating', 'ERROR')).toBe('error');
  });
});

// ─── [BEHAVIOR] 9（断点续聊集成）───────────────────────────────────────────────

describe('[BEHAVIOR] 9（=E2E-3）— 断点续聊集成', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  it('POST 建草稿 → POST chat（1 条消息）→ GET → messages_json.length === 2', async () => {
    const { EventEmitter } = await import('events');
    const fakeStdout = new EventEmitter() as NodeJS.ReadableStream & { destroy?: () => void };
    const fakeProcess = {
      stdout: fakeStdout,
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    };
    spawnMock.mockReturnValue(fakeProcess);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;

    setTimeout(() => {
      (fakeStdout as NodeJS.EventEmitter).emit(
        'data',
        Buffer.from('{"type":"assistant","session_id":"real-session-2","message":{"content":[{"type":"text","text":"没问题，我来帮你"}]}}\n')
      );
      (fakeStdout as NodeJS.EventEmitter).emit('end');
    }, 10);

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/chat`)
      .set('X-User-Email', 'staff@test.com')
      .send({ message: '我想做一个日报skill' });

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.messages_json.length).toBe(2);
  });
});
