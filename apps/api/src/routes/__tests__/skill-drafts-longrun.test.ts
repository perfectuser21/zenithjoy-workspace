/**
 * skill-drafts 长跑改造合同测试（Red 基线 — commit 1）
 *
 * 覆盖合同 [BEHAVIOR] B-01 ~ B-16：
 *   B-01  — [BEHAVIOR] chatting→running 合法触发
 *   B-02  — [BEHAVIOR] error→running 重试合法
 *   B-03  — [BEHAVIOR] running 状态互斥拒绝
 *   B-04  — [BEHAVIOR] needs_input 状态拒绝 generate
 *   B-05  — [BEHAVIOR] callback done 终态
 *   B-06  — [BEHAVIOR] callback needs_input 暂停
 *   B-07  — [BEHAVIOR] callback error 终态
 *   B-08  — [BEHAVIOR] callback token 不匹配拒绝
 *   B-09  — [BEHAVIOR] callback token 单次绑定
 *   B-10  — [BEHAVIOR] answer 在 needs_input 合法
 *   B-11  — [BEHAVIOR] answer 在非 needs_input 拒绝
 *   B-12  — [BEHAVIOR] 软超时兜底
 *   B-13  — [BEHAVIOR] GET 响应新字段
 *   B-14  — [BEHAVIOR] done 终态封闭
 *   B-15  — [BEHAVIOR] 子进程 detached unref
 *   B-16  — [BEHAVIOR] DB migration 字段存在
 *
 * sprint_dir: sprints/07101942-skill-create-longrun
 * task_id: 574bcc6e-44ac-4b2c-a369-c75619747a73
 *
 * 这些测试在实现前**必须是 Red**（全部失败）。
 * 实现完成后这些测试应全部通过（Green）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

const readFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:fs/promises', () => ({
  readFile: readFileMock,
}));

// Mock child_process.spawn（用于后台子进程 detached + unref）
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import { EventEmitter } from 'events';
import pool from '../../db/connection';
import app from '../../app';

// ─── 辅助：构造 fake detached 子进程 ──────────────────────────────────────────

function makeFakeDetachedChild() {
  const proc = new EventEmitter() as NodeJS.EventEmitter & {
    unref: ReturnType<typeof vi.fn>;
    stdin: { end: ReturnType<typeof vi.fn> } | null;
    stdout: NodeJS.EventEmitter;
    stderr: NodeJS.EventEmitter;
  };
  proc.unref = vi.fn();
  proc.stdin = { end: vi.fn() };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  return proc;
}

// ─── 辅助：构造 DB mock 返回特定 draft ─────────────────────────────────────────

function mockDbDraft(overrides: {
  id?: string;
  status?: string;
  session_id?: string | null;
  callback_token?: string | null;
  pending_question?: string | null;
  result_json?: object | null;
  messages_json?: unknown[];
  updated_at?: string;
}) {
  const now = new Date().toISOString();
  const draft = {
    id: overrides.id ?? 'test-draft-longrun-001',
    session_id: overrides.session_id ?? 'sess-abc123',
    messages_json: overrides.messages_json ?? [],
    status: overrides.status ?? 'chatting',
    job_id: null,
    callback_token: overrides.callback_token ?? null,
    pending_question: overrides.pending_question ?? null,
    result_json: overrides.result_json ?? null,
    created_at: now,
    updated_at: overrides.updated_at ?? now,
  };
  const poolMock = pool as { query: ReturnType<typeof vi.fn> };
  poolMock.query.mockResolvedValue({ rows: [draft] });
  return draft;
}

// ─── [BEHAVIOR] B-01：chatting→running 合法触发 ───────────────────────────────

describe('[BEHAVIOR] B-01 — chatting→running 合法触发', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('POST /:id/generate 在 chatting 状态返回 HTTP 200 body.status=running，spawn 调用 1 次且调用 unref()', async () => {
    // 先创建草稿
    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    expect(createRes.status).toBe(201);
    const draftId: string = createRes.body.data.id;

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // 子进程必须 unref()，父进程退出后子进程继续运行
    const spawnedChild = spawnMock.mock.results[0]?.value;
    expect(spawnedChild?.unref).toHaveBeenCalledTimes(1);
  });
});

// ─── [BEHAVIOR] B-02：error→running 重试合法 ──────────────────────────────────

describe('[BEHAVIOR] B-02 — error→running 重试合法', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('error 状态的草稿可以重新 generate，返回 HTTP 200 body.status=running，生成新 callback_token', async () => {
    // 先创建一个 draft 并让它进入 error 状态
    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com')
      .send({});
    const draftId: string = createRes.body.data.id;

    // 先触发 generate（进入 running）
    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    // 拿 callback_token，用 error callback 让 draft 进入 error 状态（内存内）
    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;
    expect(callbackToken).toBeTruthy();

    await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'error', error_message: '生成失败' });

    // 确认 draft 已进入 error 状态
    const afterError = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(afterError.body.data.status).toBe('error');

    // 准备第二次 generate 的 mock
    vi.clearAllMocks();
    const child2 = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child2);

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    // error 状态可以重新 generate
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

// ─── [BEHAVIOR] B-03：running 状态互斥拒绝 ────────────────────────────────────

describe('[BEHAVIOR] B-03 — running 状态互斥拒绝重复 generate', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('running 状态的草稿再次 POST generate 返回 HTTP 409，spawn 调用次数=0，状态保持 running', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    // 第一次 generate
    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    // 清掉 mock 计数，第二次应被拒绝
    spawnMock.mockClear();

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(409);
    expect(spawnMock).toHaveBeenCalledTimes(0);
  });
});

// ─── [BEHAVIOR] B-04：needs_input 状态拒绝 generate ──────────────────────────

describe('[BEHAVIOR] B-04 — needs_input 状态拒绝 generate', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('needs_input 状态草稿 POST generate 返回 HTTP 409', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    // generate → running（首次）
    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    // 内部 callback → needs_input
    // 先获取 callback_token（从 GET 接口或者 DB）
    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');

    const callbackToken: string = getRes.body.data.callback_token;
    expect(callbackToken).toBeTruthy();

    await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'needs_input', question: '你想要什么功能？' });

    // 现在 status=needs_input，再次 generate 应返回 409
    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(409);
  });
});

// ─── [BEHAVIOR] B-05：callback done 终态 ─────────────────────────────────────

describe('[BEHAVIOR] B-05 — callback event=done 写入终态', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('token 匹配 + event=done → draft status=done，result_json.zip_path 写入', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    const res = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'done', zip_path: '/tmp/my-skill.zip' });

    expect(res.status).toBe(200);

    const afterGet = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(afterGet.body.data.status).toBe('done');
    expect(afterGet.body.data.result_json?.zip_path).toBe('/tmp/my-skill.zip');
  });
});

// ─── [BEHAVIOR] B-06：callback needs_input 暂停 ───────────────────────────────

describe('[BEHAVIOR] B-06 — callback event=needs_input 暂停', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('token 匹配 + event=needs_input → status=needs_input，pending_question 写入', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    const res = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'needs_input', question: '你想要什么功能？' });

    expect(res.status).toBe(200);

    const afterGet = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(afterGet.body.data.status).toBe('needs_input');
    expect(afterGet.body.data.pending_question).toBe('你想要什么功能？');
  });
});

// ─── [BEHAVIOR] B-07：callback error 终态 ────────────────────────────────────

describe('[BEHAVIOR] B-07 — callback event=error 终态', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('token 匹配 + event=error → status=error，result_json.error_message 写入', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    const res = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'error', error_message: 'skill-creator 调用失败' });

    expect(res.status).toBe(200);

    const afterGet = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(afterGet.body.data.status).toBe('error');
    expect(afterGet.body.data.result_json?.error_message).toBe('skill-creator 调用失败');
  });
});

// ─── [BEHAVIOR] B-08：callback token 不匹配拒绝 ──────────────────────────────

describe('[BEHAVIOR] B-08 — callback token 不匹配返回 400，状态不变', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('错误 token 的 callback 返回 HTTP 400，draft 状态保持不变', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const wrongToken = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: wrongToken, event: 'done', zip_path: '/tmp/x.zip' });

    expect(res.status).toBe(400);

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(getRes.body.data.status).toBe('running');
  });
});

// ─── [BEHAVIOR] B-09：callback token 单次绑定 ────────────────────────────────

describe('[BEHAVIOR] B-09 — callback token 单次绑定', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('同一 token 第二次调用 callback 返回 HTTP 400', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    // 第一次调用成功
    const first = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'needs_input', question: '你想要什么？' });
    expect(first.status).toBe(200);

    // 第二次同一 token → 400（token 单次绑定，已消费）
    const second = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'done', zip_path: '/tmp/x.zip' });
    expect(second.status).toBe(400);
  });
});

// ─── [BEHAVIOR] B-10：answer 在 needs_input 合法 ──────────────────────────────

describe('[BEHAVIOR] B-10 — answer 在 needs_input 状态合法', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('needs_input 状态提交 answer 返回 HTTP 200 status=running，重新 spawn 子进程', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'needs_input', question: '你想要什么功能？' });

    // 清掉之前的 spawn 计数
    spawnMock.mockClear();
    const child2 = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child2);

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/answer`)
      .set('X-User-Email', 'staff@test.com')
      .send({ answer: '我想要一个帮助用户记账的功能' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('running');
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });
});

// ─── [BEHAVIOR] B-11：answer 在非 needs_input 拒绝 ───────────────────────────

describe('[BEHAVIOR] B-11 — answer 在非 needs_input 状态拒绝', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('chatting 状态草稿 POST answer 返回 HTTP 409', async () => {
    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/answer`)
      .set('X-User-Email', 'staff@test.com')
      .send({ answer: '我想要记账功能' });

    expect(res.status).toBe(409);
  });

  it('done 状态草稿 POST answer 返回 HTTP 409', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'done', zip_path: '/tmp/x.zip' });

    const res = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/answer`)
      .set('X-User-Email', 'staff@test.com')
      .send({ answer: '不管了' });

    expect(res.status).toBe(409);
  });
});

// ─── [BEHAVIOR] B-12：软超时兜底 ──────────────────────────────────────────────

describe('[BEHAVIOR] B-12 — 软超时兜底', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('status=running 且 updated_at > 2h 前，GET /:id 返回 status=error 含超时信息', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    // 手动将进程内缓存的 updated_at 设为 3 小时前
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

    // 通过调用内部接口（使用 app 内部缓存）我们无法直接改 updated_at
    // 所以需要访问模块内的 drafts Map。这里用黑盒方式：测试直接通过
    // mock DB 返回超时的 draft（模拟重启后从 DB 读取）
    const poolMock = pool as { query: ReturnType<typeof vi.fn> };
    poolMock.query.mockResolvedValue({
      rows: [{
        id: draftId,
        session_id: 'sess-abc',
        messages_json: [],
        status: 'running',
        job_id: null,
        callback_token: 'some-token',
        pending_question: null,
        result_json: null,
        created_at: new Date().toISOString(),
        updated_at: threeHoursAgo,
      }],
    });

    // 使用不同的 draftId（不在进程内缓存中），从 DB 读取
    const timeoutDraftId = 'timeout-draft-' + Date.now();
    const res = await request(app)
      .get(`/api/staff/skill-drafts/${timeoutDraftId}`)
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('error');
    expect(res.body.data.result_json?.error_message).toMatch(/超时/);
  });
});

// ─── [BEHAVIOR] B-13：GET 响应新字段 ─────────────────────────────────────────

describe('[BEHAVIOR] B-13 — GET 响应含新字段', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('GET /:id 响应含 pending_question 和 result_json 字段', async () => {
    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    const res = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');

    expect(res.status).toBe(200);
    expect('pending_question' in res.body.data).toBe(true);
    expect('result_json' in res.body.data).toBe(true);
  });
});

// ─── [BEHAVIOR] B-14：done 终态封闭 ──────────────────────────────────────────

describe('[BEHAVIOR] B-14 — done 终态封闭', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('done 状态的草稿：generate → 409，answer → 409，callback → 400', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    const getRes = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    const callbackToken: string = getRes.body.data.callback_token;

    await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'done', zip_path: '/tmp/x.zip' });

    // 确认已进入 done 状态
    const getAfterDone = await request(app)
      .get(`/api/staff/skill-drafts/${draftId}`)
      .set('X-User-Email', 'staff@test.com');
    expect(getAfterDone.body.data.status).toBe('done');

    // generate → 409
    const genRes = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');
    expect(genRes.status).toBe(409);

    // answer → 409
    const answerRes = await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/answer`)
      .set('X-User-Email', 'staff@test.com')
      .send({ answer: '试试看' });
    expect(answerRes.status).toBe(409);

    // callback（token 已消费，但即使拿到新 token 也应被 done 状态拒绝）
    // 这里用旧 token（已单次消费），也应返回 400
    const cbRes = await request(app)
      .post(`/internal/skill-drafts/${draftId}/callback`)
      .send({ token: callbackToken, event: 'done', zip_path: '/tmp/x2.zip' });
    expect(cbRes.status).toBe(400);
  });
});

// ─── [BEHAVIOR] B-15：子进程 detached unref ──────────────────────────────────

describe('[BEHAVIOR] B-15 — 子进程 detached + unref()', () => {
  beforeEach(() => {
    vi.stubEnv('STAFF_EMAILS', 'staff@test.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('spawn 调用时 options 包含 detached:true，且调用 unref()', async () => {
    const child = makeFakeDetachedChild();
    spawnMock.mockReturnValue(child);

    const createRes = await request(app)
      .post('/api/staff/skill-drafts')
      .set('X-User-Email', 'staff@test.com');
    const draftId: string = createRes.body.data.id;

    await request(app)
      .post(`/api/staff/skill-drafts/${draftId}/generate`)
      .set('X-User-Email', 'staff@test.com');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    // 验证 spawn 的第 3 个参数（options）含 detached: true
    const spawnOptions = spawnMock.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(spawnOptions?.detached).toBe(true);
    // 验证调用了 unref()
    expect(child.unref).toHaveBeenCalledTimes(1);
  });
});

// ─── [BEHAVIOR] B-16：DB migration 字段存在（单测）────────────────────────────

describe('[BEHAVIOR] B-16 — DB migration 字段存在', () => {
  it('migration SQL 文件存在且包含 pending_question、result_json、callback_token 三个字段定义', () => {
    // 注意：node:fs/promises 在模块级被 vi.mock mock 了，这里直接用同步 fs
    // 避开 mock 来真实读取文件系统（migration 文件是静态 artifact，不需要异步 IO）
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs');
    const migrationPath =
      '/workspace/apps/api/db/migrations/20260710_194200_skill_drafts_longrun.sql';
    let content: string;
    try {
      content = fs.readFileSync(migrationPath, 'utf8');
    } catch {
      throw new Error(`migration 文件不存在: ${migrationPath}`);
    }
    expect(content).toMatch(/pending_question/);
    expect(content).toMatch(/result_json/);
    expect(content).toMatch(/callback_token/);
  });
});
